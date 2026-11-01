let adminUser = null;
let adminOperationPending = false;
function animalApprovalPolicyText() {
  const rule = App.data.photoPolicy?.approval || { minPhotos: 1, requireDescription: true };
  return `Novas aprovações exigem ${rule.minPhotos} foto(s) tecnicamente válida(s)${rule.minDescriptionChars > 1 ? ' e descrição com pelo menos ' + rule.minDescriptionChars + ' caracteres' : ' e descrição não vazia'}. Exceções são administrativas, explícitas e justificadas. Validade técnica não comprova autenticidade, saúde ou correspondência com o animal, nem detecta IA; confira o caso com pessoas e fontes adequadas. A regra não muda anúncios antigos automaticamente.`;
}

function renderStats() {
  const users = Store.getUsers();
  const animals = Store.getAnimals();
  const requests = Store.getRequests();
  const acceptedWithDate = requests.filter(
    (r) => r.status === 'concluida' && (r.completedAt || r.acceptedAt) && r.createdAt,
  );
  const avgDays = acceptedWithDate.length
    ? Math.round(
        acceptedWithDate.reduce((sum, r) => {
          const ms =
            new Date(r.completedAt || r.acceptedAt).getTime() - new Date(r.createdAt).getTime();
          return sum + Math.max(0, ms / 86400000);
        }, 0) / acceptedWithDate.length,
      )
    : null;

  const stats = {
    totalUsers: users.length,
    totalAnimals: animals.length,
    adopted: animals.filter((a) => a.status === 'adotado').length,
    pendingAnimals: animals.filter((a) => a.approvalStatus === 'pending').length,
    pendingRequests: requests.filter((r) => ['pendente', 'em_analise'].includes(r.status)).length,
    pendingOrganizations: users.filter(
      (u) => u.accountType === 'ong' && u.approvalStatus === 'pendente',
    ).length,
    missing: Store.getMissing().filter((m) => !m.found).length,
    openReports: Store.getReports().filter((r) => r.status === 'aberta').length,
    verified: animals.filter((a) => a.verified).length,
  };
  document.getElementById('stats-grid').innerHTML = `
    <div class="dashboard-stat"><b>${stats.totalUsers}</b>Usuários</div>
    <div class="dashboard-stat"><b>${stats.totalAnimals}</b>Animais cadastrados</div>
    <div class="dashboard-stat"><b>${stats.adopted}</b>Adotados</div>
    <div class="dashboard-stat"><b>${stats.verified}</b>Perfis verificados</div>
    <div class="dashboard-stat"><b>${stats.pendingAnimals}</b>Anúncios pendentes</div>
    <div class="dashboard-stat"><b>${stats.pendingRequests}</b>Solicitações pendentes</div>
    <div class="dashboard-stat"><b>${stats.pendingOrganizations}</b>ONGs aguardando análise</div>
    <div class="dashboard-stat"><b>${stats.missing}</b>Animais desaparecidos</div>
    <div class="dashboard-stat"><b>${stats.openReports}</b>Denúncias/mensagens abertas</div>
    <div class="dashboard-stat"><b>${avgDays !== null ? avgDays : '-'}</b>Dias médios da solicitação à adoção</div>`;
}

function renderPendentesTab() {
  const pending = Store.getAnimals().filter((a) => a.approvalStatus === 'pending');
  const users = Store.getUsers();
  const content = document.getElementById('tab-content');
  if (!pending.length) {
    content.innerHTML =
      '<p class="request-policy">' +
      escapeHTML(animalApprovalPolicyText()) +
      '</p><p>Nenhum anúncio aguardando aprovação.</p>';
    return;
  }
  content.innerHTML =
    '<p class="request-policy">' +
    escapeHTML(animalApprovalPolicyText()) +
    '</p><div class="request-list">' +
    pending
      .map(
        (a) =>
          `<article class="card" style="padding:18px;"><h3>${escapeHTML(a.name)}</h3><p>${escapeHTML(a.city)}/${escapeHTML(a.state)} · ${escapeHTML(a.archivedAt ? 'Anúncio arquivado' : Store.animalPublicationLabel(a))}</p><div style="display:flex;gap:8px;flex-wrap:wrap">${(
            a.photos || []
          )
            .map((photo) => safeImageSrc(photo))
            .filter(Boolean)
            .map(
              (photo) =>
                `<img src="${escapeAttr(photo)}" alt="Foto de ${escapeAttr(a.name)}" style="width:110px;height:90px;object-fit:cover;border-radius:10px;">`,
            )
            .join(
              '',
            )}</div><p>${escapeHTML(a.description || 'Sem descrição')}</p><button class="btn btn-primary btn-sm" data-action="reviewAnimal" data-arg-0="${Number(a.id)}">Revisar anúncio</button></article>`,
      )
      .join('') +
    '</div>';
}

function renderAnimaisTab() {
  const animals = Store.getAnimals();
  document.getElementById('tab-content').innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Animal</th><th>Publicação</th><th>Disponibilidade</th><th>Verificado</th><th>Destaque</th><th>Ações</th></tr></thead>
    <tbody>${
      animals
        .map(
          (a) => `<tr data-record-id="${Number(a.id)}">
      <td>${escapeHTML(a.name)}</td><td>${escapeHTML(Store.animalPublicationLabel(a))}</td><td>${escapeHTML(ANIMAL_STATUS[a.status] || a.status)}</td>
      <td>${a.verified ? svgIcon('check', 'icon-sm') + ' Sim' : 'Não'}</td><td>${a.featured ? svgIcon('star', 'icon-sm') + ' Sim' : 'Não'}</td>
      <td><a class="btn btn-outline btn-sm" href="animal.html?id=${Number(a.id)}">Abrir</a>${!a.archivedAt ? `<button class="btn btn-primary btn-sm" data-action="reviewAnimal" data-arg-0="${Number(a.id)}">Revisar anúncio</button>` : ''}
      <button class="btn btn-outline btn-sm" data-action="toggleVerified" data-arg-0="${Number(a.id)}">${a.verified ? 'Remover verificação' : 'Verificar perfil'}</button>
      <button class="btn btn-outline btn-sm" data-action="toggleFeatured" data-arg-0="${Number(a.id)}">${a.featured ? 'Remover destaque' : 'Destacar'}</button></td>
    </tr>`,
        )
        .join('') || '<tr><td colspan="6">Nenhum animal cadastrado.</td></tr>'
    }</tbody></table></div>`;
}

function renderUsuariosTab() {
  const users = Store.getUsers();
  document.getElementById('tab-content').innerHTML =
    `<div class="auth-notice" style="margin-bottom:16px">Contas comuns precisam confirmar o e-mail quando o envio está habilitado. Cadastros de ONG precisam ser aprovados aqui antes do primeiro acesso.</div><div class="table-wrap"><table>
    <thead><tr><th>Nome</th><th>E-mail</th><th>Tipo</th><th>Situação</th><th>Cidade</th><th>Ações</th></tr></thead>
    <tbody>${users
      .map(
        (u) => `<tr data-record-id="${Number(u.id)}">
      <td>${escapeHTML(u.name)}</td><td>${escapeHTML(u.email || '-')}</td><td>${escapeHTML({ usuario: 'Usuário', ong: 'ONG / protetor', admin: 'Administrador' }[u.accountType] || u.role)}</td><td>${u.accountType === 'ong' ? `<span class="status-pill status-${u.approvalStatus === 'aprovado' ? 'aprovada' : u.approvalStatus === 'reprovado' ? 'reprovada' : 'pendente'}">${escapeHTML({ aprovado: 'Aprovada', reprovado: 'Reprovada', pendente: 'Pendente', suspenso: 'Suspensa' }[u.approvalStatus] || u.approvalStatus)}</span>` : u.accountSuspended ? 'Suspensa' : 'Ativa'}${u.accountSuspended ? '<br><span class="status-pill status-reprovada">Conta suspensa</span>' : ''}${u.accountModerationHistory?.length ? '<details><summary>Decisões da conta</summary>' + u.accountModerationHistory.map((h) => '<p>' + escapeHTML(h.action === 'suspend' ? 'Suspensão' : 'Reativação') + ' · ' + escapeHTML(h.actorName) + ' · ' + escapeHTML(new Date(h.at).toLocaleString('pt-BR')) + '<br>' + escapeHTML(h.reason) + '</p>').join('') + '</details>' : ''}</td><td>${escapeHTML(u.city || '-')}</td>
      <td><div class="request-actions" style="justify-content:flex-start">${u.accountType === 'ong' && u.approvalStatus !== 'aprovado' ? `<button class="btn btn-primary btn-compact" data-action="approveOrganization" data-arg-0="${Number(u.id)}">Aprovar ONG</button>` : ''}${u.accountType === 'ong' && u.approvalStatus !== 'reprovado' ? `<button class="btn btn-danger-soft btn-compact" data-action="rejectOrganization" data-arg-0="${Number(u.id)}">Reprovar</button>` : ''}${u.accountType === 'ong' && u.approvalStatus === 'aprovado' ? `<button class="btn btn-danger-soft btn-compact" data-action="suspendOrganization" data-arg-0="${Number(u.id)}">Suspender ONG</button>` : ''}${u.role !== 'admin' && u.accountType !== 'admin' ? `<button class="btn btn-danger-soft btn-compact" data-action="${u.accountSuspended ? 'reactivateAccount' : 'suspendAccount'}" data-arg-0="${Number(u.id)}">${u.accountSuspended ? 'Reativar conta' : 'Suspender conta'}</button>` : ''}${u.role !== 'admin' && !u.protected ? `<button class="btn btn-danger-soft btn-compact" data-action="removeUser" data-arg-0="${Number(u.id)}">Remover</button>` : u.protected ? '<span class="muted">Conta inicial protegida</span>' : ''}</div></td>
    </tr>`,
      )
      .join('')}</tbody></table></div>`;
}

function renderDenunciasTab() {
  const reports = Store.getReports().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const content = document.getElementById('tab-content');
  if (!reports.length) {
    content.innerHTML = '<p>Nenhuma denúncia ou mensagem registrada.</p>';
    return;
  }
  content.innerHTML = `<div class="table-wrap"><table tabindex="0" aria-label="Denúncias e mensagens de atendimento">
    <thead><tr><th>Categoria</th><th>Detalhes</th><th>Status</th><th>Data</th><th>Ações</th></tr></thead>
    <tbody>${reports
      .map(
        (r) => `<tr data-record-id="${Number(r.id)}">
      <td>${escapeHTML(REPORT_CATEGORY_LABEL[r.category] || (r.target_type === 'outro' ? 'Contato' : 'Outro'))}</td>
      <td style="max-width:420px;white-space:pre-wrap;overflow-wrap:anywhere;">${r.contactEmail ? `<b>Protocolo APPET-${Number(r.id)}</b><br>${escapeHTML(r.contactName)} · <a href="mailto:${encodeURIComponent(r.contactEmail)}">${escapeHTML(r.contactEmail)}</a><br>` : ''}${escapeHTML(r.reason)}${r.target_type === 'missing' ? `<p><a href="desaparecido.html?id=${Number(r.target_id)}">Revisar desaparecido denunciado</a></p>` : r.target_type === 'animal' ? `<p><a href="animal.html?id=${Number(r.target_id)}">Consultar anúncio denunciado</a></p>` : ''}</td><td>${r.status === 'aberta' ? 'Aberta' : 'Resolvida'}</td>
      <td>${new Date(r.createdAt).toLocaleDateString('pt-BR')}</td>
      <td>${r.status === 'aberta' ? `<button class="btn btn-primary btn-sm" data-action="handleResolveReport" data-arg-0="${Number(r.id)}">Marcar como resolvida</button>` : ''}</td>
    </tr>`,
      )
      .join('')}</tbody></table></div>`;
}

function renderHistoricoTab() {
  const log = Store.getAdminLog();
  document.getElementById('tab-content').innerHTML = log.length
    ? `<div class="request-stepper" style="flex-direction:column;align-items:flex-start;gap:10px;">${log
        .slice(0, 50)
        .map(
          (l) => `
        <div style="font-size:.88rem;border-bottom:1px solid var(--color-border);padding-bottom:8px;width:100%;">
          <b>${escapeHTML(l.adminName)}</b> · <span style="color:var(--color-ink-soft);">${new Date(l.createdAt).toLocaleString('pt-BR')}</span><br>${escapeHTML(l.message)}
        </div>`,
        )
        .join('')}</div>`
    : '<p>Nenhuma ação registrada ainda.</p>';
}

function renderApoioTab() {
  const points = Store.getSupportPoints();
  document.getElementById('tab-content').innerHTML = `<div class="admin-split">
    <form class="card admin-inline-form" id="support-admin-form">
      <h2>Cadastrar ponto verificado</h2><div id="support-admin-alert"></div>
      <div class="form-field"><label for="sp-name">Nome</label><input id="sp-name" required maxlength="160"></div>
      <div class="form-row"><div class="form-field"><label for="sp-category">Categoria</label><select id="sp-category" required><option value="ong">ONG ou protetor</option><option value="veterinario">Hospital ou atendimento veterinário</option><option value="zoonoses">Vigilância de zoonoses</option><option value="castracao">Castração</option><option value="lar_temporario">Lar temporário</option><option value="transporte">Transporte solidário</option><option value="doacao">Doações</option></select></div><div class="form-field"><label for="sp-contact">Contato</label><input id="sp-contact" maxlength="160"></div></div>
      <div class="form-row"><div class="form-field"><label for="sp-city">Cidade</label><input id="sp-city" required maxlength="120"></div><div class="form-field"><label for="sp-state">Estado</label><input id="sp-state" required maxlength="40" value="RN"></div></div>
      <div class="form-field"><label for="sp-address">Endereço</label><input id="sp-address" maxlength="300"></div>
      <div class="form-field"><label for="sp-services">Serviços oferecidos</label><textarea id="sp-services" rows="3" maxlength="1000"></textarea></div>
      <div class="form-field"><label for="sp-source-url">Fonte oficial (link https://)</label><input id="sp-source-url" type="url" maxlength="1000" placeholder="https://..."></div>
      <button class="btn btn-primary" type="submit">Publicar na rede</button>
    </form>
    <div><h2>Pontos publicados</h2>${points.length ? points.map((p) => `<div class="card admin-support-row"><div><b>${escapeHTML(p.name)}</b><small>${escapeHTML(p.city)}/${escapeHTML(p.state)} · ${escapeHTML(p.category)}</small></div><button class="btn btn-danger btn-sm" data-action="removeSupportPoint" data-arg-0="${Number(p.id)}">Remover</button></div>`).join('') : '<p>Nenhum ponto cadastrado. Não publique dados sem antes conferi-los.</p>'}</div>
  </div>`;
  document
    .getElementById('support-admin-form')
    ?.addEventListener('submit', App.form(submitSupportPoint));
}

function submitSupportPoint(event) {
  event.preventDefault();
  return adminAction(
    () =>
      apiRequestAsync('POST', '/api/support-points', {
        name: document.getElementById('sp-name').value,
        category: document.getElementById('sp-category').value,
        contact: document.getElementById('sp-contact').value,
        city: document.getElementById('sp-city').value,
        state: document.getElementById('sp-state').value,
        address: document.getElementById('sp-address').value,
        services: document.getElementById('sp-services').value,
        sourceUrl: document.getElementById('sp-source-url').value,
      }),
    renderCurrentAdminTab,
    {
      resources: ['support'],
      confirm: (point) => confirmAdminRecord('support', point),
      onError: (err) =>
        (document.getElementById('support-admin-alert').innerHTML =
          `<div class="alert alert-error">${escapeHTML(err.message)}</div>`),
    },
  );
}

function removeSupportPoint(id) {
  if (!confirm('Remover este ponto da rede de apoio?')) return;
  return adminAction(
    () => apiRequestAsync('DELETE', '/api/support-points/' + Number(id)),
    renderCurrentAdminTab,
    { resources: ['support'], confirm: (result) => confirmAdminRemoval('support', id, result) },
  );
}

const adminResourceUrls = {
  users: '/api/users',
  animals: '/api/animals/cards?view=manage',
  reports: '/api/reports',
  logs: '/api/admin-log',
  support: '/api/support-points',
  unread: '/api/notifications/summary',
};
async function refreshAdminData(resources) {
  const results = await Promise.allSettled(
    [...new Set([...resources, 'logs', 'unread'])].map(async (key) => {
      // Do not reuse a GET started before the mutation being confirmed.
      const pending = App.inflight.get(key);
      if (pending) await pending.catch(() => {});
      return App.load(key, App.resources[key] || adminResourceUrls[key]);
    }),
  );
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
}
function confirmAdminRecord(key, record) {
  if (!record || !Number.isSafeInteger(record.id))
    throw Error('O servidor não retornou o registro confirmado.');
  const list = App.data[key] || [],
    index = list.findIndex((item) => Number(item.id) === record.id);
  App.data[key] =
    index < 0 ? [...list, record] : list.map((item, i) => (i === index ? record : item));
}
function confirmAdminRemoval(key, id, result) {
  if (result?.ok !== true) throw Error('O servidor não confirmou a remoção.');
  App.data[key] = (App.data[key] || []).filter((item) => Number(item.id) !== Number(id));
}
function renderCurrentAdminTab() {
  renderStats();
  const active = Object.keys(TABS).find((key) =>
    document.getElementById(key)?.classList.contains('active'),
  );
  return (TABS[active] || renderPendentesTab)();
}
async function adminAction(
  action,
  render,
  { resources = [], confirm = () => {}, afterWrite, message, onError } = {},
) {
  if (adminOperationPending) return false;
  adminOperationPending = true;
  // A second action must not replace the table while its first button is busy.
  const controls = [...document.querySelectorAll('#tab-content button, .chips button')].filter(
    (button) => !button.disabled,
  );
  controls.forEach((button) => (button.disabled = true));
  try {
    const fail = async (err) => {
      if (onError) await onError(err);
      else showToast(err.message || 'Não foi possível concluir a ação.');
    };
    let result;
    try {
      result = await action();
      confirm(result);
    } catch (err) {
      await fail(err);
      return false;
    }
    let warning;
    if (afterWrite)
      try {
        await afterWrite(result);
      } catch (err) {
        warning = Error('Alteração confirmada, mas o registro do histórico falhou: ' + err.message);
      }
    try {
      await refreshAdminData(resources);
    } catch (err) {
      warning = Error('Alteração confirmada, mas a atualização dos dados falhou: ' + err.message);
    }
    // The response already confirmed this record, even if a later GET/log fails.
    try {
      await render(result);
    } catch (err) {
      warning = err;
    }
    if (warning) {
      await fail(warning);
      return false;
    }
    if (message) showToast(message);
    return true;
  } finally {
    adminOperationPending = false;
    controls.forEach((button) => {
      if (button.isConnected) button.disabled = false;
    });
  }
}
async function approveAnimal(id) {
  await reviewAnimal(id, 'approved');
}
async function rejectAnimal(id) {
  await reviewAnimal(id, 'rejected');
}
function toggleVerified(id) {
  const animal = Store.getAnimal(id);
  if (!animal) return;
  return adminAction(
    () => apiRequestAsync('PATCH', '/api/animals/' + Number(id), { verified: !animal.verified }),
    renderCurrentAdminTab,
    {
      resources: ['animals'],
      confirm: (result) => confirmAdminRecord('animals', result),
      afterWrite: (result) =>
        apiRequestAsync('POST', '/api/admin-log', {
          message: `${result.verified ? 'Verificou o perfil' : 'Removeu a verificação'} de ${result.name}.`,
        }),
    },
  );
}
function toggleFeatured(id) {
  const animal = Store.getAnimal(id);
  if (!animal) return;
  return adminAction(
    () => apiRequestAsync('PATCH', '/api/animals/' + Number(id), { featured: !animal.featured }),
    renderCurrentAdminTab,
    {
      resources: ['animals'],
      confirm: (result) => confirmAdminRecord('animals', result),
      afterWrite: (result) =>
        apiRequestAsync('POST', '/api/admin-log', {
          message: `${result.featured ? 'Destacou' : 'Removeu o destaque'} o perfil de ${result.name}.`,
        }),
    },
  );
}
function handleResolveReport(id) {
  return adminAction(
    () => apiRequestAsync('POST', '/api/reports/' + Number(id) + '/resolve', {}),
    renderCurrentAdminTab,
    {
      resources: ['reports'],
      confirm: (result) => confirmAdminRecord('reports', result),
      afterWrite: () =>
        apiRequestAsync('POST', '/api/admin-log', {
          message: `Marcou a denúncia/mensagem #${id} como resolvida.`,
        }),
    },
  );
}
function removeUser(id) {
  if (!confirm('Remover este usuário?')) return;
  return adminAction(
    () => apiRequestAsync('DELETE', '/api/users/' + Number(id)),
    renderCurrentAdminTab,
    {
      resources: ['users', 'animals'],
      confirm: (result) => confirmAdminRemoval('users', id, result),
    },
  );
}
function approveOrganization(id) {
  if (!confirm('Aprovar esta ONG e liberar o acesso para publicar animais?')) return;
  return adminAction(
    () => apiRequestAsync('POST', '/api/users/' + Number(id) + '/approve', {}),
    renderCurrentAdminTab,
    {
      resources: ['users', 'animals'],
      confirm: (result) => confirmAdminRecord('users', result?.user),
      message: 'ONG aprovada.',
    },
  );
}
function rejectOrganization(id) {
  const reason = prompt('Motivo da reprovação (opcional):') || '';
  if (!confirm('Confirmar a reprovação deste cadastro de ONG?')) return;
  return adminAction(
    () => apiRequestAsync('POST', '/api/users/' + Number(id) + '/reject', { reason }),
    renderCurrentAdminTab,
    {
      resources: ['users', 'animals'],
      confirm: (result) => confirmAdminRecord('users', result?.user),
      message: 'Cadastro de ONG reprovado.',
    },
  );
}
function changeAccountSuspension(id, action) {
  const reason = prompt(
    action === 'suspend-account'
      ? 'Justificativa da suspensão da conta (obrigatória):'
      : 'Justificativa da reativação da conta (obrigatória):',
  );
  if (reason === null) return;
  if (!reason.trim()) {
    showToast('Informe a justificativa.');
    return;
  }
  if (
    !confirm(
      action === 'suspend-account'
        ? 'Suspender a conta e revogar suas sessões? Vínculos e histórico serão preservados.'
        : 'Retirar a suspensão desta conta? A aprovação cadastral da ONG continuará independente.',
    )
  )
    return;
  return adminAction(
    () => apiRequestAsync('POST', '/api/users/' + Number(id) + '/' + action, { reason }),
    renderCurrentAdminTab,
    {
      resources: ['users', 'animals'],
      confirm: (result) => confirmAdminRecord('users', result?.user),
      message:
        action === 'suspend-account'
          ? 'Conta suspensa; vínculos preservados.'
          : 'Suspensão retirada; aprovação cadastral preservada.',
    },
  );
}
function suspendAccount(id) {
  return changeAccountSuspension(id, 'suspend-account');
}
function reactivateAccount(id) {
  return changeAccountSuspension(id, 'reactivate');
}

const TABS = {
  'tab-pendentes': renderPendentesTab,
  'tab-animais': renderAnimaisTab,
  'tab-usuarios': renderUsuariosTab,
  'tab-denuncias': renderDenunciasTab,
  'tab-historico': renderHistoricoTab,
  'tab-apoio': renderApoioTab,
  'tab-desaparecidos': renderMissingTab,
};

App.ready(() => {
  const user = Auth.requireAuth(['admin']);
  if (!user) return;
  adminUser = user;
  document.getElementById('check-launch-status')?.addEventListener(
    'click',
    App.click(async () => {
      const area = document.getElementById('launch-status');
      area.textContent = 'Conferindo…';
      try {
        const state = await apiRequestAsync('GET', '/api/admin/launch-status'),
          demo = state.demonstration;
        const facts = [
          ['Versão do serviço', state.runtime.version],
          [
            'E-mail',
            state.email.enabled
              ? 'Transporte configurado; entrega real ainda precisa ser conferida.'
              : 'Envio desativado.',
          ],
          [
            'Fila de e-mail',
            (state.email.pending || 0) + ' pendentes; ' + (state.email.failed || 0) + ' falhas.',
          ],
          [
            'Armazenamento',
            state.storage.writable
              ? 'Gravação local conferida. Permanência após reinício/republicação do provedor pendente.'
              : 'Gravação não conferida.',
          ],
          [
            'Cópias de segurança',
            state.backup.enabled
              ? state.backup.pending
                ? 'Há uma pendência de cópia ou exportação.'
                : 'Rotina habilitada; confira o último backup e ensaie restauração.'
              : 'Rotina desativada.',
          ],
          [
            'Cópia externa',
            state.backup.latestExported
              ? 'Envio registrado; recuperação no serviço externo ainda precisa de ensaio.'
              : 'Nenhum envio externo confirmado pela rotina.',
          ],
          [
            'IP dos visitantes',
            state.proxy.mode === 'socket_only'
              ? 'Usa a conexão recebida. Atrás de proxy, visitantes podem compartilhar o limite; confirme a topologia.'
              : 'Usa somente saltos configurados como confiáveis. Validação no provedor ainda pendente.',
          ],
          [
            'Amostras',
            (state.samplesDisabled
              ? 'Importação automática desativada. '
              : 'Amostras explicitamente habilitadas para testes. ') +
              demo.records.length +
              ' registros de origem/semelhança com amostras para revisar; ' +
              demo.placeholders.length +
              ' com fotos de exemplo.',
          ],
          [
            'Contas',
            demo.weakAccounts.length +
              ' com credenciais conhecidas de demonstração; revise sem apagar vínculos.',
          ],
        ];
        area.innerHTML =
          '<dl class="profile-data-grid" style="margin-top:16px;">' +
          facts
            .map(
              ([label, value]) =>
                '<div class="profile-data"><dt>' +
                escapeHTML(label) +
                '</dt><dd style="margin:6px 0;">' +
                escapeHTML(value) +
                '</dd></div>',
            )
            .join('') +
          '</dl><h3>Registros para conferência humana</h3><ul>' +
          demo.records
            .map(
              (r) =>
                '<li>' +
                escapeHTML(r.collection) +
                ' #' +
                Number(r.id) +
                ' · ' +
                escapeHTML(r.name) +
                ' · ' +
                escapeHTML(r.reason) +
                '</li>',
            )
            .join('') +
          demo.preconfigured
            .map(
              (r) =>
                '<li>Rede de apoio #' +
                Number(r.id) +
                ' · ' +
                escapeHTML(r.name) +
                ' · confirme os dados na fonte antes de divulgar.</li>',
            )
            .join('') +
          '</ul><p>Fotos de exemplo, isoladamente, não determinam se um registro é fictício. A conferência não apaga nem altera esses dados.</p>';
      } catch (err) {
        area.textContent = err.message;
      }
    }),
  );
  Object.keys(TABS).forEach((tabId) =>
    document.getElementById(tabId)?.addEventListener(
      'click',
      App.click(async () => {
        if (tabId === 'tab-apoio' && !App.resources.support)
          await App.load('support', adminResourceUrls.support);
        Object.keys(TABS).forEach((id) =>
          document.getElementById(id)?.classList.toggle('active', id === tabId),
        );
        await TABS[tabId]();
      }),
    ),
  );
  renderStats();
  renderPendentesTab();
});

function suspendOrganization(id) {
  const reason = prompt('Justificativa da suspensão (obrigatória, até 1000 caracteres):');
  if (reason === null) return;
  if (!reason.trim()) {
    showToast('Informe a justificativa.');
    return;
  }
  if (
    !confirm(
      'Suspender esta ONG? Anúncios sairão das vitrines e novos pedidos serão bloqueados. Os pedidos e históricos existentes serão preservados para tratamento administrativo.',
    )
  )
    return;
  return adminAction(
    () => apiRequestAsync('POST', '/api/users/' + Number(id) + '/suspend', { reason }),
    renderCurrentAdminTab,
    {
      resources: ['users', 'animals'],
      confirm: (result) => confirmAdminRecord('users', result?.user),
      message: 'ONG suspensa; registros preservados.',
    },
  );
}
function renderMissingTab() {
  const records = Store.getMissing();
  document.getElementById('tab-content').innerHTML =
    '<div class="request-list">' +
    records
      .map(
        (m) =>
          `<article class="card" style="padding:18px;"><h3>${escapeHTML(m.name || 'Sem nome')}</h3><p>${escapeHTML(m.city)}/${escapeHTML(m.state)} · ${m.hiddenAt ? 'Oculto pela administração' : m.found ? 'Encontrado' : 'Desaparecido'}</p><a class="btn btn-outline btn-sm" href="desaparecido.html?id=${Number(m.id)}">Ver registro e moderar</a></article>`,
      )
      .join('') +
    '</div>';
}
async function reviewAnimal(id, decision = 'approved') {
  const animal = await Store.fetchAnimal(id);
  if (!animal || animal.archivedAt) return;
  let dialog = document.getElementById('animal-review-dialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'animal-review-dialog';
    dialog.className = 'panel-dialog';
    document.body.append(dialog);
  }
  dialog.style.background = 'var(--color-surface)';
  const owner = Store.getUsers().find((u) => Number(u.id) === Number(animal.ownerId));
  const fields = [
    ['Responsável', owner?.name || 'Cadastro não encontrado'],
    ['Local', animal.city + '/' + animal.state],
    ['Espécie', animal.species],
    ['Sexo', animal.sex],
    ['Porte', animal.size],
    ['Idade', animal.age_group],
    ['Raça', animal.breed],
    ['Contato público', animal.contact],
    ['Castrado', animal.neutered ? 'Sim' : 'Não'],
    ['Vacinado', animal.vaccinated ? 'Sim' : 'Não'],
    ['Vermifugado', animal.dewormed ? 'Sim' : 'Não'],
    ['Necessidades especiais', animal.special_needs],
    ['Saúde', animal.health_notes],
    ['Descrição', animal.description],
    ['História', animal.history],
    ['Energia', animal.energy_level],
    [
      'Convivência',
      Object.entries(animal.coexistence || {})
        .map(([k, v]) => k + ': ' + v)
        .join(', '),
    ],
  ];
  dialog.innerHTML = `<div class="dialog-head"><h2 id="animal-review-title">Revisar ${escapeHTML(animal.name)}</h2><button type="button" id="animal-review-close" class="btn btn-outline btn-sm">Fechar</button></div><div class="dialog-body"><p class="request-policy">${escapeHTML(animalApprovalPolicyText())}</p><p>Confira as fotos e todas as informações antes de registrar uma decisão.</p><div class="form-row">${(
    animal.photos || []
  )
    .map(safeImageSrc)
    .filter(Boolean)
    .map(
      (photo) =>
        `<img src="${escapeAttr(photo)}" alt="Foto de ${escapeAttr(animal.name)}" style="width:100%;max-height:240px;object-fit:contain;">`,
    )
    .join(
      '',
    )}</div><div class="profile-data-grid">${fields.map(([label, value]) => `<div class="profile-data" style="overflow-wrap:anywhere;"><small>${escapeHTML(label)}</small><p style="white-space:pre-wrap;">${escapeHTML(value || 'Não informado')}</p></div>`).join('')}</div><form id="animal-review-form"><div id="animal-review-alert"></div><div class="form-field"><label for="animal-review-decision">Decisão</label><select id="animal-review-decision"><option value="approved">Aprovar publicação</option><option value="rejected">Reprovar publicação</option><option value="pending">Manter em análise</option></select></div><div class="form-field"><label for="animal-review-reason">Justificativa enviada ao autor</label><textarea required maxlength="1000" rows="3" id="animal-review-reason"></textarea></div><label class="checkbox-row"><input type="checkbox" id="animal-review-exception"> Registrar exceção administrativa à regra mínima</label><div class="form-field"><label for="animal-review-exception-reason">Justificativa específica da exceção</label><textarea disabled maxlength="1000" rows="2" id="animal-review-exception-reason" aria-describedby="animal-exception-help"></textarea><small id="animal-exception-help">Use somente quando necessário. Administrador, data, critérios não atendidos e justificativa ficam no histórico privado.</small></div><button type="submit" class="btn btn-primary">Registrar decisão e avisar autor</button></form></div>`;
  dialog.setAttribute('aria-labelledby', 'animal-review-title');
  document.getElementById('animal-review-decision').value = decision;
  document.getElementById('animal-review-close').onclick = () => dialog.close();
  const exceptionBox = document.getElementById('animal-review-exception'),
    exceptionReason = document.getElementById('animal-review-exception-reason'),
    decisionField = document.getElementById('animal-review-decision');
  const syncException = () => {
    exceptionBox.disabled = decisionField.value !== 'approved';
    if (exceptionBox.disabled) exceptionBox.checked = false;
    exceptionReason.disabled = !exceptionBox.checked;
    exceptionReason.required = exceptionBox.checked;
  };
  exceptionBox.onchange = syncException;
  decisionField.onchange = syncException;
  syncException();
  document.getElementById('animal-review-form').onsubmit = App.form(() =>
    adminAction(
      () =>
        apiRequestAsync('PATCH', '/api/animals/' + Number(id), {
          approvalStatus: document.getElementById('animal-review-decision').value,
          reason: document.getElementById('animal-review-reason').value,
          ...(exceptionBox.checked ? { approvalException: { reason: exceptionReason.value } } : {}),
        }),
      () => {
        dialog.close();
        return renderCurrentAdminTab();
      },
      {
        resources: ['animals'],
        confirm: (result) => confirmAdminRecord('animals', result),
        message: 'Decisão registrada; autor avisado.',
        onError: (err) => {
          if (dialog.open)
            document.getElementById('animal-review-alert').innerHTML =
              `<div class="alert alert-error">${escapeHTML(err.message)}</div>`;
          else showToast(err.message);
        },
      },
    ),
  );
  dialog.showModal();
}
