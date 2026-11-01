'use strict';
let workspaceCampaigns = [],
  workspaceAdmin = false,
  currentReview = null;
const historyLabels = {
  draft: 'Rascunho salvo',
  submit: 'Enviado para análise',
  check: 'Verificação registrada',
  approve: 'Aprovado',
  changes: 'Ajustes solicitados',
  reject: 'Reprovado',
  pause: 'Pausado',
  close: 'Encerrado',
  resume: 'Reativado',
  archive: 'Rascunho arquivado',
  restore: 'Rascunho restaurado',
  stale_pause: 'Pausa por falta de prestação de contas',
  evidence_add: 'Evidência adicionada',
  evidence_remove: 'Retirada de evidência',
};
async function loadWorkspace() {
  workspaceCampaigns = await fundApi(
    'GET',
    workspaceAdmin ? '/api/campaigns/manage' : '/api/campaigns/mine',
  );
  renderWorkspace();
}
function renderWorkspace() {
  const filter = document.getElementById('workflow-filter').value;
  const list = workspaceCampaigns
    .filter(
      (c) =>
        !filter ||
        (filter === 'corrections'
          ? c.status === 'changes' || (c.status === 'review' && c.approved)
          : filter === 'active'
            ? c.approved && c.liveState === 'active'
            : c.status === filter),
    )
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  document.getElementById('workspace-list').innerHTML = list.length
    ? list
        .map((c) => {
          const last = [...c.history]
            .reverse()
            .find((h) => ['changes', 'reject', 'pause', 'close'].includes(h.action));
          const editable =
            !Auth.getCurrentUser()?.historicalAccess && !['review', 'archived'].includes(c.status);
          const lifecycle =
            !Auth.getCurrentUser()?.historicalAccess && !c.approved && c.status !== 'review'
              ? '<button type="button" class="btn btn-outline" data-lifecycle="' +
                (c.status === 'archived' ? 'restore' : 'archive') +
                '" data-campaign="' +
                c.id +
                '">' +
                (c.status === 'archived' ? 'Restaurar rascunho' : 'Arquivar rascunho') +
                '</button>'
              : '';
          return (
            '<article class="workspace-card"><div class="workspace-meta">' +
            fundBadge(c.status) +
            '<span>#' +
            c.id +
            ' · ' +
            fundEscape(c.draft.kind === 'ongoing' ? 'Apoio contínuo' : 'Campanha') +
            ' · ' +
            fundDate(c.updatedAt) +
            '</span></div><h2>' +
            fundEscape(c.draft.title || 'Campanha sem título') +
            '</h2><p>' +
            fundEscape(c.draft.beneficiaryName || 'Beneficiário não informado') +
            '</p><div class="next-step">' +
            fundEscape(
              workspaceAdmin
                ? {
                    review: 'Confira as evidências, registre verificações e decida.',
                    changes: 'Aguarde as correções do responsável.',
                    draft: 'Rascunho ainda não enviado pelo responsável.',
                    active: 'Acompanhe a publicação e analise novas atualizações.',
                    rejected: 'Solicitação reprovada. Consulte a justificativa.',
                    paused: 'Confira as pendências antes de reativar.',
                    closed: 'Recebimento encerrado. Novas prestações de contas não reabrem o Pix.',
                    archived: 'Rascunho preservado. Restaure-o para continuar.',
                  }[c.status]
                : CAMPAIGN_STEPS[c.status],
            ) +
            '</div>' +
            (last && ['changes', 'rejected', 'paused', 'closed'].includes(c.status)
              ? '<p><strong>Justificativa:</strong> ' + fundEscape(last.reason) + '</p>'
              : '') +
            (c.approved
              ? '<p class="live-notice">Versão pública: ' +
                fundEscape(CAMPAIGN_STATES[c.liveState]) +
                '. Edições pendentes não alteram o Pix aprovado.</p>'
              : '') +
            '<div class="workspace-actions"><button type="button" class="btn btn-primary" data-review="' +
            c.id +
            '">' +
            (workspaceAdmin ? 'Analisar e gerenciar' : 'Histórico e detalhes') +
            '</button>' +
            (editable
              ? '<a class="btn btn-outline" href="solicitar-campanha.html?id=' +
                c.id +
                '">' +
                (c.approved
                  ? c.liveState === 'closed'
                    ? 'Enviar prestação de contas'
                    : 'Propor atualização'
                  : 'Continuar solicitação') +
                '</a>'
              : '') +
            (c.publicVersion
              ? '<a class="btn btn-ghost" href="doacoes.html?campanha=' +
                c.id +
                '">Ver publicação</a>'
              : '') +
            lifecycle +
            '</div></article>'
          );
        })
        .join('')
    : '<div class="campaign-empty"><h2>Nenhuma campanha nesta situação</h2><p>Uma solicitação pode ajudar um pet, vários animais ou o trabalho de uma organização.</p><a class="btn btn-outline" href="solicitar-campanha.html">Solicitar campanha</a></div>';
  if (Auth.getCurrentUser()?.historicalAccess)
    document.querySelectorAll('a[href^="solicitar-campanha.html"]').forEach((el) => el.remove());
}
async function openReview(id) {
  currentReview = await fundApi('GET', '/api/campaigns/' + Number(id));
  renderReview();
  const dialog = document.getElementById('campaign-review');
  if (!dialog.open) dialog.showModal();
}
function privateChecks(c) {
  return (
    '<h3>Verificações privadas da equipe</h3><p>Arquivo legível e formato aceito não comprovam a autenticidade do caso. Não há detecção garantida de imagens de IA ou documentos falsificados.</p><ul class="history-list">' +
    (c.checks || [])
      .map(
        (v) =>
          '<li><strong>' +
          fundEscape(v.actorName) +
          '</strong> · ' +
          fundDate(v.at) +
          ' · ciclo ' +
          Number(v.cycle || 0) +
          '<p>' +
          fundEscape(
            (v.scopes || []).map((s) => CAMPAIGN_CHECK_SCOPES[s]).join(', ') ||
              'Registro anterior, sem assuntos separados',
          ) +
          ' · ' +
          fundEscape(CAMPAIGN_CHECK_RESULTS[v.result] || 'Resultado não estruturado') +
          '</p><p class="preserve-lines">' +
          fundEscape(v.note) +
          '</p>' +
          (v.external
            ? '<p>Fonte independente utilizada: ' + fundEscape(v.source) + '</p>'
            : '<p>Sem fonte independente registrada nesta conferência.</p>') +
          (v.evidence || [])
            .map(
              (f) =>
                '<p class="preserve-lines">Evidência: ' +
                fundEscape(f.name) +
                ' · SHA-256: ' +
                fundEscape(f.sha256) +
                '</p>',
            )
            .join('') +
          '</li>',
      )
      .join('') +
    '</ul>' +
    (c.status === 'review'
      ? '<form id="check-form" class="workspace-card"><fieldset><legend>Assuntos efetivamente conferidos</legend>' +
        Object.entries(CAMPAIGN_CHECK_SCOPES)
          .map(
            ([key, label]) =>
              '<label class="check-label"><input type="checkbox" name="check-scope" value="' +
              key +
              '"><span>' +
              label +
              '</span></label>',
          )
          .join('') +
        '</fieldset><label for="check-result">Resultado da conferência</label><select id="check-result" required><option value="">Selecione</option>' +
        Object.entries(CAMPAIGN_CHECK_RESULTS)
          .map(([key, label]) => '<option value="' + key + '">' + label + '</option>')
          .join('') +
        '</select><label for="check-note">O que foi conferido, como e qual foi o resultado?</label><textarea id="check-note" required minlength="10" maxlength="2000"></textarea><fieldset><legend>Evidências utilizadas nesta conferência</legend>' +
        c.files
          .filter((f) => !f.withdrawnAt)
          .map(
            (f) =>
              '<label class="check-label"><input type="checkbox" name="check-file" value="' +
              f.id +
              '"><span>' +
              fundEscape(f.name) +
              '</span></label>',
          )
          .join('') +
        '</fieldset><label class="check-label"><input type="checkbox" id="check-external"><span>Utilizei fonte independente para contato ou confirmação.</span></label><label for="check-source">Fonte independente, método e resultado do contato (se utilizado)</label><input id="check-source" maxlength="500"><small>Registre somente o que você realizou. E-mail confirmado não comprova identidade civil. O recebedor deve ser conferido por pessoa; o PotyPet não consulta o banco.</small><button type="submit" class="btn btn-outline">Registrar verificação</button></form>'
      : '')
  );
}
function privateDecisions(c) {
  return (
    '<h3>Decisões e versões preservadas</h3><ul class="history-list">' +
    (c.decisions || [])
      .map(
        (v) =>
          '<li><strong>' +
          fundEscape(historyLabels[v.decision]) +
          '</strong> · ' +
          fundEscape(v.actorName) +
          ' · ' +
          fundDate(v.at) +
          '<p>' +
          fundEscape(v.reason || v.summary) +
          '</p><details><summary>Consultar a versão utilizada na decisão</summary>' +
          campaignPreview(v.proposedVersion) +
          '<p>Pix analisado: ' +
          fundEscape(v.proposedVersion.pixKey) +
          '</p><p class="preserve-lines">' +
          fundEscape(
            [v.proposedVersion.expenseDescription, v.proposedVersion.progressNote]
              .filter(Boolean)
              .join('\n'),
          ) +
          '</p><p>' +
          v.evidenceIds.length +
          ' evidências preservadas nesta decisão.</p></details></li>',
      )
      .join('') +
    '</ul>'
  );
}
function decisionForm(c) {
  if (c.status !== 'review' && (!c.approved || c.liveState === 'closed')) return '';
  const options =
    (c.status === 'review'
      ? '<option value="changes">Pedir ajustes</option><option value="approve">Aprovar versão proposta</option><option value="reject">Reprovar solicitação</option>'
      : '') +
    (c.approved && c.liveState !== 'closed'
      ? '<option value="pause">Pausar recebimento</option><option value="close">Encerrar campanha</option>' +
        (c.liveState === 'paused' ? '<option value="resume">Reativar versão aprovada</option>' : '')
      : '');
  return (
    '<form id="decision-form" class="workspace-card"><label for="review-decision">Decisão</label><select id="review-decision" required><option value="">Selecione</option>' +
    options +
    '</select><label for="review-reason">Justificativa privada para o responsável</label><textarea id="review-reason" maxlength="1500"></textarea><label for="review-summary">Resumo público específico da análise (ao aprovar)</label><textarea id="review-summary" maxlength="600" placeholder="Descreva o que foi conferido, o alcance e as limitações da análise."></textarea><label class="check-label"><input type="checkbox" id="review-summary-confirmed"><span>Revisei o resumo público: não contém documentos, contatos privados ou dados pessoais.</span></label><label for="review-public-note">Explicação pública da pausa ou encerramento (opcional)</label><textarea id="review-public-note" maxlength="600"></textarea><small>Não publique fontes privadas, dados bancários ou selos de garantia. O sistema registra administrador e data na área privada. Atualizar uma campanha pausada exige reativação explícita; uma encerrada permanece encerrada.</small><button class="btn btn-primary" type="submit">Registrar decisão</button></form>'
  );
}
function renderReview() {
  const c = currentReview,
    d = c.draft;
  const same = document.getElementById('review-content').dataset.campaign === String(c.id),
    decisionDraft = same
      ? Object.fromEntries(
          ['review-decision', 'review-reason', 'review-summary', 'review-public-note'].map((id) => [
            id,
            document.getElementById(id)?.value || '',
          ]),
        )
      : {};
  const confirmed = same && document.getElementById('review-summary-confirmed')?.checked;
  document.getElementById('review-content').dataset.campaign = c.id;
  document.getElementById('review-error').hidden = true;
  document.getElementById('review-title').textContent = d.title || 'Solicitação #' + c.id;
  const comparison = c.approved
    ? '<div class="review-comparison"><div><h3>Versão pública aprovada</h3>' +
      campaignPreview(c.approved) +
      '<p><strong>Pix aprovado:</strong> ' +
      fundEscape(c.approved.pixKey) +
      '</p></div><div><h3>Versão proposta</h3>' +
      campaignPreview(d) +
      '<p><strong>Pix proposto:</strong> ' +
      fundEscape(d.pixKey) +
      '</p></div></div>'
    : campaignPreview(d) + '<p><strong>Chave proposta:</strong> ' + fundEscape(d.pixKey) + '</p>';
  const identity =
    workspaceAdmin && c.organizerAccount
      ? '<section class="workspace-card"><h3>Conta do organizador · privado</h3><p>Conta #' +
        c.organizerAccount.id +
        ' · ' +
        fundEscape(c.organizerAccount.name) +
        ' · ' +
        fundEscape(c.organizerAccount.accountType) +
        '</p><p>' +
        fundEscape(c.organizerAccount.email) +
        ' · ' +
        fundEscape(c.organizerAccount.phone || 'Telefone não informado') +
        '</p><p>E-mail confirmado: ' +
        (c.organizerAccount.emailVerified ? 'sim' : 'não') +
        '. A confirmação de e-mail não comprova identidade civil.</p></section>'
      : '';
  document.getElementById('review-content').innerHTML =
    fundBadge(c.status) +
    identity +
    comparison +
    (d.closeRequested
      ? '<p class="next-step">O responsável solicita encerramento. Aprovar esta versão encerrará o recebimento.</p>'
      : '') +
    '<h3>Recebedor</h3><p>' +
    fundEscape(d.receiverRelation) +
    ' · ' +
    fundEscape(d.receiverReason || '') +
    '</p><p>Autorização declarada pelo solicitante: ' +
    (d.receiverAuthorization ? 'sim' : 'não se aplica / não informada') +
    '. A declaração não comprova titularidade.</p>' +
    '<h3>Evidências privadas</h3><p>Validação técnica de formato e legibilidade; autenticidade depende de conferência humana. Somente a capa autorizada pode ficar pública.</p><ul class="file-list">' +
    c.files
      .map(
        (f) =>
          '<li><a href="/api/campaign-files/' +
          f.id +
          '" download>' +
          fundEscape(f.name) +
          '</a><span>' +
          Math.ceil(f.size / 1024) +
          ' KB' +
          (f.withdrawnAt
            ? ' · retirada, preservada'
            : f.retained
              ? ' · utilizada em decisão'
              : ' · ativa') +
          '</span></li>',
      )
      .join('') +
    '</ul>' +
    (d.updateText || d.expenseDescription || d.progressNote
      ? '<h3>Atualização e apuração propostas</h3><p class="preserve-lines">' +
        fundEscape(
          [d.updateText, d.expenseDescription, d.progressNote].filter(Boolean).join('\n'),
        ) +
        '</p><p>Total proposto: ' +
        fundMoney(d.raisedCents) +
        '</p>'
      : '') +
    '<h3>Histórico</h3><ul class="history-list">' +
    c.history
      .map(
        (h) =>
          '<li><strong>' +
          fundEscape(historyLabels[h.action] || h.action) +
          '</strong> · ' +
          fundEscape(h.actorName) +
          '<time>' +
          fundDate(h.at) +
          '</time><p>' +
          fundEscape(h.reason) +
          '</p></li>',
      )
      .join('') +
    '</ul>' +
    (workspaceAdmin ? privateDecisions(c) + privateChecks(c) + decisionForm(c) : '');
  document.getElementById('check-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      currentReview = await fundApi('POST', '/api/campaigns/' + c.id + '/checks', {
        revision: currentReview.revision,
        note: document.getElementById('check-note').value,
        external: document.getElementById('check-external').checked,
        source: document.getElementById('check-source').value,
        scopes: [...document.querySelectorAll('[name="check-scope"]:checked')].map((i) => i.value),
        result: document.getElementById('check-result').value,
        fileIds: [...document.querySelectorAll('[name="check-file"]:checked')].map((i) => i.value),
      });
      renderReview();
      await loadWorkspace();
    } catch (err) {
      fundError(err, 'review-error');
      btn.disabled = false;
    }
  });
  document.getElementById('decision-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      currentReview = await fundApi('POST', '/api/campaigns/' + c.id + '/review', {
        revision: currentReview.revision,
        decision: document.getElementById('review-decision').value,
        reason: document.getElementById('review-reason').value,
        summary: document.getElementById('review-summary').value,
        publicSummaryConfirmed: document.getElementById('review-summary-confirmed').checked,
        publicNote: document.getElementById('review-public-note').value,
      });
      renderReview();
      await loadWorkspace();
    } catch (err) {
      fundError(err, 'review-error');
      btn.disabled = false;
    }
  });
  for (const [id, value] of Object.entries(decisionDraft))
    if (document.getElementById(id)) document.getElementById(id).value = value;
  if (document.getElementById('review-summary-confirmed'))
    document.getElementById('review-summary-confirmed').checked = !!confirmed;
}
App.ready(async () => {
  const user = Auth.requireAuth();
  if (!user) return;
  if (user.historicalAccess)
    document.querySelectorAll('a[href^="solicitar-campanha.html"]').forEach((el) => el.remove());
  workspaceAdmin =
    new URLSearchParams(location.search).get('admin') === '1' && user.role === 'admin';
  if (workspaceAdmin) {
    document.getElementById('workspace-title').textContent = 'Análise de campanhas';
    document.getElementById('workspace-eyebrow').textContent = 'Administração';
    document.getElementById('workspace-description').textContent =
      'Confira evidências, registre verificações e acompanhe as versões aprovadas.';
    document.getElementById('workflow-filter').value = 'review';
  }
  document.getElementById('workflow-filter').addEventListener('change', renderWorkspace);
  document.getElementById('workspace-list').addEventListener(
    'click',
    App.click(async (e) => {
      const button = e.target.closest('[data-review]');
      if (button) {
        try {
          await openReview(button.dataset.review);
        } catch (err) {
          fundError(err);
        }
      }
    }),
  );
  document.getElementById('workspace-list').addEventListener(
    'click',
    App.click(async (e) => {
      const button = e.target.closest('[data-lifecycle]');
      if (!button) return;
      const c = workspaceCampaigns.find((c) => c.id === Number(button.dataset.campaign));
      try {
        await fundApi('POST', '/api/campaigns/' + c.id + '/' + button.dataset.lifecycle, {
          revision: c.revision,
        });
        await loadWorkspace();
      } catch (err) {
        fundError(err);
      }
    }),
  );
  document
    .getElementById('close-review')
    .addEventListener('click', () => document.getElementById('campaign-review').close());
  try {
    await loadWorkspace();
  } catch (e) {
    fundError(e);
  }
});
