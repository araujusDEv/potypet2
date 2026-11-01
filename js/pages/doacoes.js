'use strict';
const CAMPAIGN_CATEGORIES = {
  cirurgia: 'Cirurgia',
  tratamento: 'Tratamento',
  alimentacao: 'Alimentação',
  acolhimento: 'Acolhimento',
};
const CAMPAIGN_KEY_TYPES = {
  aleatoria: 'Chave aleatória',
  email: 'E-mail',
  telefone: 'Telefone',
  cpf: 'CPF',
  cnpj: 'CNPJ',
};
const campaignMoney = (cents) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
const campaignDate = (value) =>
  value
    ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T12:00:00' : value).toLocaleDateString(
        'pt-BR',
      )
    : 'Não informada';
let fundraisingCampaigns = [];

function campaignStatus(campaign) {
  return campaign.status === 'draft'
    ? 'Rascunho'
    : campaign.status === 'closed'
      ? 'Encerrada'
      : campaign.canDonate
        ? 'Aberta'
        : 'Pausada';
}
function campaignProgress(campaign) {
  if (campaign.kind === 'ongoing')
    return (
      '<div class="fund-progress-label"><strong>' +
      campaignMoney(campaign.raisedCents) +
      '</strong><span>Apoio contínuo · sem meta fixa</span></div><p class="fund-small">Total informado manualmente em ' +
      campaignDate(campaign.totalUpdatedAt || campaign.createdAt) +
      '.</p>'
    );
  const percent = Math.min(100, Math.round((campaign.raisedCents / campaign.goalCents) * 100));
  return `<div class="fund-progress-label"><strong>${campaignMoney(campaign.raisedCents)}</strong><span>meta ${campaignMoney(campaign.goalCents)}</span></div>
    <progress class="fund-progress" max="100" value="${percent}" aria-label="${percent}% da meta informados como arrecadados">${percent}%</progress>
    <div class="fund-card-meta"><span>${percent}% da meta</span><span>Total informado · ${campaignDate(campaign.totalUpdatedAt || campaign.createdAt)}</span></div>`;
}
function renderCampaigns() {
  const search = document.getElementById('campaign-search').value.trim().toLocaleLowerCase('pt-BR');
  const category = document.getElementById('campaign-category').value;
  const kind = document.getElementById('campaign-kind').value;
  const status = document.getElementById('campaign-status').value;
  const visible = fundraisingCampaigns
    .filter((c) => {
      const haystack = `${c.title} ${c.animalName} ${c.organizer} ${c.city}`.toLocaleLowerCase(
        'pt-BR',
      );
      const matchesStatus =
        status === 'all' ||
        (status === 'active'
          ? c.canDonate
          : status === 'closed'
            ? c.status === 'closed' || (c.status === 'active' && !c.canDonate)
            : c.status === 'draft');
      return (
        (!kind || (c.kind || 'campaign') === kind) &&
        matchesStatus &&
        (!category || c.category === category) &&
        (!search || haystack.includes(search))
      );
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  document.getElementById('campaign-count').textContent =
    `${visible.length} ${visible.length === 1 ? 'campanha encontrada' : 'campanhas encontradas'}`;
  const published = fundraisingCampaigns.filter((c) => c.status !== 'draft');
  document.getElementById('fund-active').textContent = published.filter((c) => c.canDonate).length;
  document.getElementById('fund-raised').textContent = campaignMoney(
    published.reduce((sum, c) => sum + c.raisedCents, 0),
  );
  document.getElementById('campaign-results').innerHTML = visible.length
    ? visible
        .map((c) => {
          const photo = safeImageSrc(c.photo);
          return `<article class="fund-card">
      <div class="fund-card-cover">${photo ? `<img src="${escapeAttr(photo)}" alt="${escapeAttr(c.animalName)}" loading="lazy">` : svgIcon('paw')}<span class="fund-card-category">${escapeHTML(CAMPAIGN_CATEGORIES[c.category])}</span></div>
      <div class="fund-card-body"><p class="fund-card-location">${escapeHTML(c.animalName)} · ${escapeHTML(c.city)}/${escapeHTML(c.state)}</p>
        <h3>${escapeHTML(c.title)}</h3><p class="fund-card-summary">${escapeHTML(c.description)}</p>
        <div class="fund-progress-block">${campaignProgress(c)}</div>
        <p class="fund-small">Valor declarado manualmente, sem confirmação bancária automática.</p>
        ${c.needsAccountability ? '<p class="fund-small fund-notice">Prestação de contas precisa de atualização.</p>' : ''}
        <button type="button" class="btn ${c.canDonate ? 'btn-primary' : 'btn-outline'}" data-fund-open="${c.id}">${c.canDonate ? svgIcon('heart') + ' Quero ajudar' : campaignStatus(c) + ' · Ver detalhes'}</button>
      </div></article>`;
        })
        .join('')
    : `<div class="fund-empty">${svgIcon('heart')}<h3>${fundraisingCampaigns.length ? 'Nenhuma campanha com esses filtros' : 'O próximo gesto de cuidado pode começar aqui'}</h3><p>${fundraisingCampaigns.length ? 'Tente outra causa, situação ou nome para encontrar um pet.' : 'Ainda não há campanhas publicadas. Conhece um pet que precisa de ajuda? Envie a história para nossa equipe.'}</p>${fundraisingCampaigns.length ? '<button type="button" class="btn btn-outline" id="clear-fund-filters">Limpar filtros</button>' : '<a class="btn btn-outline" href="solicitar-campanha.html">Solicitar campanha</a>'}</div>`;
  document.getElementById('clear-fund-filters')?.addEventListener('click', () => {
    document.getElementById('campaign-search').value = '';
    document.getElementById('campaign-category').value = '';
    document.getElementById('campaign-kind').value = '';
    document.getElementById('campaign-status').value = 'all';
    renderCampaigns();
  });
}
async function loadCampaigns() {
  const results = document.getElementById('campaign-results');
  const alert = document.getElementById('campaign-error');
  results.setAttribute('aria-busy', 'true');
  try {
    fundraisingCampaigns = await Store.getCampaigns();
    alert.hidden = true;
    renderCampaigns();
    return true;
  } catch (error) {
    results.innerHTML = '';
    alert.className = 'fund-error';
    alert.hidden = false;
    alert.textContent = error.message;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-outline btn-sm';
    retry.textContent = 'Tentar novamente';
    retry.addEventListener('click', loadCampaigns);
    alert.append(' ', retry);
    return false;
  } finally {
    results.setAttribute('aria-busy', 'false');
  }
}
async function openDonation(id, refresh = true) {
  if (refresh && !(await loadCampaigns())) return;
  const c = fundraisingCampaigns.find((item) => item.id === Number(id));
  if (!c) {
    showToast('Esta campanha não está disponível.');
    return;
  }
  const dialog = document.getElementById('donation-dialog');
  document.getElementById('donation-detail').innerHTML = `
    <div class="fund-dialog-head"><div><span class="eyebrow">${escapeHTML(CAMPAIGN_CATEGORIES[c.category])} · ${campaignStatus(c)}</span><h2 id="donation-title">${escapeHTML(c.title)}</h2></div><button class="fund-close" id="close-donation" type="button" aria-label="Fechar campanha">×</button></div>
    <div class="fund-detail-body"><p class="fund-small">Para ${escapeHTML(c.animalName)} · ${escapeHTML(c.city)}/${escapeHTML(c.state)}</p>
    <p class="fund-story">${escapeHTML(c.description)}</p>${campaignProgress(c)}
    <p class="fund-small">Total declarado pelo responsável e publicado após revisão administrativa. Não representa confirmação bancária automática.</p>
    <h3>Custos previstos</h3><p class="preserve-lines">${escapeHTML(c.costs)}</p>
    <h3>Prestação de contas</h3><p>Data da última apuração publicada: <strong>${campaignDate(c.lastAccountabilityDate)}</strong>.</p>
    ${c.lastAccountabilityPublishedAt ? '<p class="fund-small">Publicada após revisão em ' + campaignDate(c.lastAccountabilityPublishedAt) + '.</p>' : '<p class="fund-small">Ainda não há prestação de contas com data de apuração registrada neste fluxo.</p>'}
    ${c.needsAccountability ? '<p class="fund-notice">A campanha está há pelo menos ' + Number(c.accountabilityDueDays) + ' dias sem prestação de contas atualizada. O recebimento é pausado ao completar ' + Number(c.pauseAfterDays) + ' dias.</p>' : ''}
    ${c.status === 'paused' ? '<p>' + escapeHTML(c.pauseNote) + '</p>' : ''}
    ${c.status === 'closed' ? '<h3>Encerramento</h3><p>' + escapeHTML(c.closureSummary) + ' Data: ' + campaignDate(c.closedAt) + '.</p>' : ''}
    <p class="fund-contact"><strong>Organização ou responsável:</strong> ${escapeHTML(c.organizer)}<br><strong>Contato:</strong> ${escapeHTML(c.contact)}</p>
    ${
      c.canDonate
        ? `<section class="fund-payment" aria-labelledby="pix-title"><h3 id="pix-title">Ajude com um Pix</h3><p>Escolha quanto quer doar. O nome do recebedor é informado pelo responsável, sem confirmação bancária automática.</p><p><strong>Beneficiário:</strong> ${escapeHTML(c.beneficiary)}</p>
      <form id="donation-pix-form">
        <label for="donation-amount">Valor da doação (R$)</label>
        <div class="fund-amount-presets" aria-label="Sugestões de valor"><button type="button" class="btn btn-outline btn-sm" data-pix-amount="10">R$ 10</button><button type="button" class="btn btn-outline btn-sm" data-pix-amount="25">R$ 25</button><button type="button" class="btn btn-outline btn-sm" data-pix-amount="50">R$ 50</button><button type="button" class="btn btn-outline btn-sm" data-pix-amount="100">R$ 100</button></div>
        <div class="fund-key-row fund-amount-row"><input id="donation-amount" type="text" inputmode="decimal" maxlength="10" placeholder="Ex.: 25,00" autocomplete="off" required aria-describedby="donation-amount-help"><button type="submit" id="generate-pix" class="btn btn-primary">Gerar Pix</button></div>
        <p id="donation-amount-help" class="fund-small">Você pode escolher outro valor, a partir de R$ 0,01.</p>
        <p id="generate-pix-status" class="fund-small" role="status"></p>
        <div id="generate-pix-error" class="fund-error" role="alert" hidden></div>
      </form>
      <div id="generated-pix" class="fund-generated-pix" hidden>
        <p id="generated-pix-amount" class="fund-pix-value"></p>
        <div id="donation-qr" class="fund-qr" role="img" aria-label="QR Code para doar por Pix"></div>
        <p>Escaneie com o aplicativo do banco ou copie o código abaixo.</p>
        <label for="donation-pix-code">Pix Copia e Cola</label><textarea id="donation-pix-code" rows="3" readonly spellcheck="false"></textarea>
        <button type="button" id="copy-pix-code" class="btn btn-primary">Copiar código Pix</button>
        <p id="copy-code-status" class="fund-small" role="status"></p>
        <p class="fund-small">Código gerado. O pagamento só acontece quando você confirma no banco. Gerar o código não registra uma doação. O total é declarado manualmente, sem confirmação bancária automática.</p>
      </div>
      <details class="fund-direct-key"><summary>Prefiro usar somente a chave Pix</summary><label for="campaign-pix-key">${escapeHTML(CAMPAIGN_KEY_TYPES[c.pixKeyType])}</label><div class="fund-key-row"><input id="campaign-pix-key" value="${escapeAttr(c.pixKey)}" readonly spellcheck="false"><button type="button" id="copy-pix" class="btn btn-outline">Copiar chave</button></div></details>
      <p class="fund-pix-check">Antes de confirmar o Pix, confira se o nome do recebedor no banco corresponde a <strong>${escapeHTML(c.beneficiary)}</strong>. Em caso de diferença, fale com o responsável.</p><p id="copy-pix-status" class="fund-small" role="status"></p></section>`
        : '<div class="fund-payment"><h3>Esta campanha não está recebendo doações</h3><p>Você pode acompanhar as atualizações e conhecer outras campanhas abertas.</p></div>'
    }
    ${c.reviewSummary ? '<h3>Análise realizada</h3><p>' + escapeHTML(c.reviewSummary) + '</p><p class="fund-small">Registrada pela equipe administrativa em ' + campaignDate(c.reviewedAt) + '.</p>' + (c.reviewedSubjects?.length ? '<p class="fund-small">Assuntos conferidos: ' + escapeHTML(c.reviewedSubjects.join(', ')) + '.</p>' : '') : '<p class="fund-small">Publicação anterior ao fluxo de análise documental. Não há verificações documentais registradas nesta versão.</p>'}
    <p class="fund-small">A análise tem o alcance descrito acima. Arquivo tecnicamente legível não comprova autenticidade. Não há detecção garantida de fotos de IA ou documentos falsificados.</p>
    ${c.organizationId ? '<p><a href="organizacoes.html?id=' + c.organizationId + '">Conhecer a organização</a></p>' : ''}
    <h3>Atualizações da arrecadação</h3>${
      c.updates.length
        ? `<ul class="fund-updates">${[...c.updates]
            .reverse()
            .map(
              (u) =>
                `<li><time datetime="${escapeAttr(u.createdAt)}">${campaignDate(u.createdAt)}</time> · <strong>${campaignMoney(u.raisedCents)} informados</strong><p class="preserve-lines">${escapeHTML(u.note)}</p>${u.expenses ? `<p class="preserve-lines"><strong>Despesas declaradas:</strong> ${escapeHTML(u.expenses)}</p>` : ''}${u.apportionment ? `<p class="preserve-lines"><strong>Apuração:</strong> ${escapeHTML(u.apportionment)}</p>` : ''}${u.accountabilityDate ? `<p>Data da apuração: ${campaignDate(u.accountabilityDate)}.</p>` : ''}</li>`,
            )
            .join('')}</ul>`
        : '<p class="fund-small">Ainda não há atualizações publicadas pelo responsável.</p>'
    }
    <div class="fund-detail-actions">${c.animalUrl ? `<a class="btn btn-outline btn-sm" href="${escapeAttr(c.animalUrl)}">Conhecer o pet</a>` : ''}<button type="button" id="share-campaign" class="btn btn-outline btn-sm">Compartilhar campanha</button></div>
    <p class="fund-small">Última atualização: ${campaignDate(c.updatedAt)}. Valores declarados manualmente pelo responsável, após revisão administrativa; sem confirmação bancária automática. Gerar um código, copiar a chave ou compartilhar não registra uma doação.</p></div>`;
  document.getElementById('close-donation').addEventListener('click', () => dialog.close());
  if (c.canDonate) setupDonationPix(c, dialog);
  document.getElementById('copy-pix')?.addEventListener('click', async () => {
    const status = document.getElementById('copy-pix-status');
    try {
      await navigator.clipboard.writeText(c.pixKey);
      status.textContent =
        'Chave copiada. Abra seu banco e confira o beneficiário antes de confirmar.';
    } catch {
      const input = document.getElementById('campaign-pix-key');
      input.focus();
      input.select();
      status.textContent = 'Selecione e copie a chave acima para usar no seu banco.';
    }
  });
  document.getElementById('share-campaign').addEventListener(
    'click',
    App.click(async () => {
      const url = new URL('doacoes.html', location.href);
      url.searchParams.set('campanha', c.id);
      try {
        if (navigator.share)
          await navigator.share({ title: c.title, text: `Ajude ${c.animalName}`, url: url.href });
        else {
          await navigator.clipboard.writeText(url.href);
          showToast('Link da campanha copiado.');
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          const link = document.createElement('input');
          link.value = url.href;
          link.readOnly = true;
          link.setAttribute('aria-label', 'Link para compartilhar');
          document.querySelector('.fund-detail-actions').appendChild(link);
          link.focus();
          link.select();
          showToast('Copie o link selecionado para compartilhar.');
        }
      }
    }),
  );
  if (!dialog.open) dialog.showModal();
}
function setupDonationPix(campaign, dialog) {
  const form = document.getElementById('donation-pix-form');
  const amount = document.getElementById('donation-amount');
  const button = document.getElementById('generate-pix');
  const result = document.getElementById('generated-pix');
  const status = document.getElementById('generate-pix-status');
  const alert = document.getElementById('generate-pix-error');
  const qr = document.getElementById('donation-qr');
  const code = document.getElementById('donation-pix-code');
  const copyStatus = document.getElementById('copy-code-status');
  let requestVersion = 0;
  function clearPix() {
    requestVersion++;
    result.hidden = true;
    code.value = '';
    qr.replaceChildren();
    status.textContent = '';
    copyStatus.textContent = '';
    alert.hidden = true;
    button.disabled = false;
    button.textContent = 'Gerar Pix';
  }
  amount.addEventListener('input', clearPix);
  dialog.addEventListener('close', clearPix, { once: true });
  form.querySelectorAll('[data-pix-amount]').forEach((preset) =>
    preset.addEventListener('click', () => {
      amount.value = preset.dataset.pixAmount + ',00';
      clearPix();
      amount.focus();
    }),
  );
  form.addEventListener(
    'submit',
    App.form(async (event) => {
      event.preventDefault();
      clearPix();
      const version = requestVersion;
      button.disabled = true;
      button.textContent = 'Gerando…';
      try {
        const amountCents = campaignCents(amount.value.trim().replace(',', '.'));
        if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > 100000000) {
          throw new Error('Informe um valor entre R$ 0,01 e R$ 1.000.000.');
        }
        const pix = await Store.generateCampaignPix(campaign.id, amountCents, campaign.revision);
        // Ignore replies for an old amount, a closed dialog or another campaign.
        if (version !== requestVersion || !dialog.open || !form.isConnected) return;
        code.value = pix.payload;
        document.getElementById('generated-pix-amount').textContent =
          'Seu Pix de ' + campaignMoney(pix.amountCents);
        new QRCode(qr, {
          text: pix.payload,
          width: 192,
          height: 192,
          colorDark: '#000000',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.M,
        });
        qr.querySelectorAll('img').forEach((img) => {
          img.alt = '';
          img.setAttribute('aria-hidden', 'true');
        });
        qr.querySelectorAll('canvas').forEach((canvas) =>
          canvas.setAttribute('aria-hidden', 'true'),
        );
        qr.removeAttribute('title');
        result.hidden = false;
        status.textContent = 'Pix pronto para usar no banco.';
        result.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } catch (error) {
        if (version !== requestVersion || !dialog.open || !form.isConnected) return;
        result.hidden = true;
        code.value = '';
        qr.replaceChildren();
        alert.textContent = error.message;
        alert.hidden = false;
      } finally {
        if (version === requestVersion) {
          button.disabled = false;
          button.textContent = 'Gerar Pix';
        }
      }
    }),
  );
  document.getElementById('copy-pix-code').addEventListener(
    'click',
    App.click(async () => {
      if (!code.value || result.hidden) return;
      const copiedCode = code.value;
      try {
        await navigator.clipboard.writeText(copiedCode);
        if (copiedCode === code.value)
          copyStatus.textContent =
            'Código copiado. Use Pix Copia e Cola no seu banco e confira o valor e o beneficiário.';
      } catch {
        if (copiedCode !== code.value) return;
        code.focus();
        code.select();
        copyStatus.textContent = 'Selecione e copie o código acima para usar no seu banco.';
      }
    }),
  );
}
function campaignCents(value) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error('Informe os valores com até duas casas decimais.');
  return Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
}
App.ready(async () => {
  document.getElementById('campaign-search').addEventListener('input', renderCampaigns);
  for (const id of ['campaign-kind', 'campaign-category', 'campaign-status'])
    document.getElementById(id).addEventListener('change', renderCampaigns);
  document.getElementById('campaign-results').addEventListener('click', (event) => {
    const open = event.target.closest('[data-fund-open]');
    if (open) openDonation(open.dataset.fundOpen);
  });
  if (await loadCampaigns()) {
    const id = new URLSearchParams(location.search).get('campanha');
    if (id) await openDonation(Number(id), false);
  }
});
