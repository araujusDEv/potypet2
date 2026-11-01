let currentUser = null;
const donorTabs = ['animais', 'solicitacoes', 'desaparecidos', 'acompanhamentos'];
function ownsAnimal(animal) {
  return currentUser.role === 'admin' || Number(animal?.ownerId) === currentUser.id;
}
function ownedAnimals() {
  return Store.getAnimals().filter(ownsAnimal);
}
function photoFor(animal) {
  return safeImageSrc(animal?.photos?.[0]) || 'img/brand-symbol.png';
}
function statusPill(status) {
  return `<span class="status-pill status-${escapeAttr(status)}">${escapeHTML(REQUEST_STATUS[status] || status)}</span>`;
}

function renderAnimaisTab() {
  const animals = ownedAnimals();
  const content = document.getElementById('tab-content');
  if (!animals.length) {
    content.innerHTML =
      '<div class="empty-state"><h3>Você ainda não publicou animais</h3><p>Cadastre um animal para que ele passe pela análise e apareça na busca pública.</p><a href="cadastrar-animal.html" class="btn btn-primary" style="margin-top:12px">Publicar animal</a></div>';
    return;
  }
  content.innerHTML = `<div class="panel-toolbar"><p><b>${animals.length}</b> ${animals.length === 1 ? 'animal cadastrado' : 'animais cadastrados'}</p><a class="btn btn-primary" href="cadastrar-animal.html">${svgIcon('plus')}Publicar animal</a></div><div class="table-wrap"><table><thead><tr><th>Animal</th><th>Local</th><th>Visualizações</th><th>Publicação</th><th>Disponibilidade</th><th>Ações</th></tr></thead><tbody>${animals.map((animal) => `<tr><td><span style="display:flex;align-items:center;gap:10px"><img class="panel-animal-photo" src="${escapeAttr(photoFor(animal))}" alt="" style="width:48px;height:48px;border-radius:10px;object-fit:cover"><b>${escapeHTML(animal.name)}</b></span></td><td>${escapeHTML(animal.city)}/${escapeHTML(animal.state)}</td><td>${Number(animal.views) || 0}</td><td>${escapeHTML(animal.archivedAt ? 'Anúncio arquivado' : Store.animalPublicationLabel(animal))}</td><td>${escapeHTML(animal.archivedAt || animal.adoptionOrigin === 'external' || animal.withdrawnAt || (animal.publicEligible === false && animal.approvalStatus === 'approved') ? Store.animalDisplayStatus(animal) : ANIMAL_STATUS[animal.status] || animal.status)}${animal.approvalStatus !== 'approved' ? '<br><small>Solicitações bloqueadas até aprovação</small>' : ''}</td><td><div class="request-actions" style="justify-content:flex-start"><a class="btn btn-outline btn-compact" href="animal.html?id=${Number(animal.id)}">Abrir</a>${animal.archivedAt ? '<span class="tag">Histórico preservado</span>' : `<a class="btn btn-outline btn-compact" href="cadastrar-animal.html?id=${Number(animal.id)}">Editar</a>${animal.status !== 'adotado' ? `<button class="btn btn-outline btn-compact" data-action="withdrawAnimal" data-arg-0="${Number(animal.id)}">Retirar de adoção</button><button class="btn btn-outline btn-compact" data-action="externalAdoption" data-arg-0="${Number(animal.id)}">Informar adoção fora da plataforma</button>` : ''}${animal.seed ? '<span class="tag">Demonstração</span>' : `<button class="btn btn-danger-soft btn-compact" data-action="removeAnimal" data-arg-0="${Number(animal.id)}">Arquivar</button>`}`}</div></td></tr>`).join('')}</tbody></table></div>`;
  if (currentUser.historicalAccess)
    content.querySelectorAll('button,[href^="cadastrar-animal.html"]').forEach((el) => el.remove());
}
function answer(value, labels = {}) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return 'Não informado';
  return labels[normalized] || normalized;
}
function yesNo(value) {
  if (value === true || value === 'sim') return 'Sim';
  if (value === false || value === 'nao') return 'Não';
  return 'Não informado';
}
function profileItems(request) {
  const q = request.questionnaire || {};
  const user = request.requester || {};
  const items = [
    ['Nome', request.full_name || user.name],
    ['E-mail', user.email],
    ['Telefone', user.phone],
    ['Cidade', request.city || user.city],
    ['Idade', request.age],
    [
      'Moradia',
      answer(request.housing, {
        casa: 'Casa',
        apartamento: 'Apartamento',
        sitio: 'Sítio / chácara',
      }),
    ],
    ['Possui quintal', yesNo(request.has_yard)],
    ['Possui outros animais', yesNo(request.has_pets)],
    ['Experiência com animais', yesNo(request.experience)],
    ['Todos concordam', yesNo(q.household_agrees)],
    ['Condições financeiras', yesNo(q.financial_conditions)],
    ['Cuidados veterinários', yesNo(q.vet_commitment)],
    [
      'Tempo sozinho',
      answer(q.alone_time, {
        menos_2h: 'Menos de 2 horas',
        '2_4h': '2 a 4 horas',
        '4_8h': '4 a 8 horas',
        mais_8h: 'Mais de 8 horas',
      }),
    ],
  ];
  return (
    items
      .map(
        ([label, value]) =>
          `<div class="profile-data"><small>${escapeHTML(label)}</small><b>${escapeHTML(answer(value))}</b></div>`,
      )
      .join('') +
    `<div class="request-questionnaire-text"><span>Motivo da adoção</span><p>${escapeHTML(answer(request.reason))}</p></div><div class="request-questionnaire-text"><span>Plano de adaptação</span><p>${escapeHTML(answer(q.adaptation_plan))}</p></div>`
  );
}
function actionButtons(request) {
  const id = Number(request.id);
  const view = `<button class="btn btn-outline btn-compact" data-action="openProfile" data-arg-0="${id}">Ver perfil</button>`;
  if (currentUser.historicalAccess || !Store.requestAnimal(request))
    return (
      view +
      (request.status === 'concluida'
        ? `<a class="btn btn-outline btn-compact" href="contrato.html?request=${id}">Ver termo</a>`
        : '')
    );
  if (request.status === 'pendente')
    return `${view}<button class="btn btn-outline btn-compact" data-action="analyzeRequest" data-arg-0="${id}">Iniciar análise</button><button class="btn btn-primary btn-compact" data-action="approveRequest" data-arg-0="${id}">Aprovar</button><button class="btn btn-danger-soft btn-compact" data-action="openReject" data-arg-0="${id}">Reprovar</button>`;
  if (request.status === 'em_analise')
    return `${view}<button class="btn btn-primary btn-compact" data-action="approveRequest" data-arg-0="${id}">Aprovar</button><button class="btn btn-danger-soft btn-compact" data-action="openReject" data-arg-0="${id}">Reprovar</button>`;
  if (request.status === 'aprovada') {
    if (request.handoverAt)
      return (
        view +
        (request.receiptConfirmedAt
          ? '<button class="btn btn-primary btn-compact" data-action="completeRequest" data-arg-0="' +
            id +
            '">Concluir adoção</button>'
          : '<span class="tag">Aguardando confirmação de recebimento</span>')
      );
    return (
      view +
      (!request.interviewAt
        ? '<button class="btn btn-outline btn-compact" data-action="markInterview" data-arg-0="' +
          id +
          '">Registrar entrevista</button>'
        : '') +
      '<button class="btn btn-primary btn-compact" data-action="handoverRequest" data-arg-0="' +
      id +
      '">Registrar entrega</button><button class="btn btn-danger-soft btn-compact" data-action="openReject" data-arg-0="' +
      id +
      '">Reprovar</button>'
    );
  }
  if (request.status === 'concluida')
    return `${view}<a class="btn btn-outline btn-compact" href="contrato.html?request=${id}">Ver termo</a>`;
  return view;
}
function managedRequests() {
  const animalIds = new Set(ownedAnimals().map((a) => a.id));
  return Store.getRequests()
    .filter(
      (request) =>
        currentUser.role === 'admin' ||
        (request.ownerId !== undefined
          ? Number(request.ownerId) === currentUser.id
          : animalIds.has(request.animalId)),
    )
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
function renderSolicitacoesTab() {
  const requests = managedRequests();
  const content = document.getElementById('tab-content');
  if (!requests.length) {
    content.innerHTML =
      '<div class="empty-state"><h3>Nenhum interessado ainda</h3><p>Quando alguém enviar o formulário para um animal seu, a análise aparecerá aqui.</p></div>';
    return;
  }
  content.innerHTML = `<div class="panel-toolbar"><p>Analise o perfil e o formulário antes de tomar uma decisão.</p><label class="form-field" style="margin:0;min-width:190px"><span class="sr-only">Filtrar por status</span><select id="request-filter"><option value="">Todos os status</option>${Object.entries(
    REQUEST_STATUS,
  )
    .map(([value, label]) => `<option value="${value}">${escapeHTML(label)}</option>`)
    .join(
      '',
    )}</select></label></div><div class="request-list" id="request-list">${requests.map(requestCard).join('')}</div>`;
  document.getElementById('request-filter').addEventListener('change', (event) => {
    document
      .querySelectorAll('.request-review-card')
      .forEach(
        (card) =>
          (card.hidden = Boolean(event.target.value && card.dataset.status !== event.target.value)),
      );
  });
}
function requestCard(request) {
  const animal = Store.requestAnimal(request);
  const user = request.requester || {};
  return `<article class="request-review-card" data-status="${escapeAttr(request.status)}"><img class="request-animal-photo" src="${escapeAttr(photoFor(animal))}" alt="${escapeAttr(animal?.name || 'Animal')}"><div><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h3>${escapeHTML(animal?.name || request.animalName || 'Registro histórico de animal')} · ${escapeHTML(request.full_name || user.name || 'Interessado')}</h3>${statusPill(request.status)}</div><div class="request-meta"><span>${escapeHTML(user.city || request.city || 'Cidade não informada')}</span>${user.phone ? `<span>${escapeHTML(user.phone)}</span>` : ''}<span>Enviada em ${new Date(request.createdAt).toLocaleDateString('pt-BR')}</span></div><p class="request-message"><b>Por que deseja adotar:</b> ${escapeHTML(answer(request.reason))}</p>${request.cancellationReason ? `<p class="request-message"><b>Motivo do encerramento:</b> ${escapeHTML(request.cancellationReason)}</p>` : ''}${request.rejectionReason ? `<p class="request-message"><b>Motivo da reprovação:</b> ${escapeHTML(request.rejectionReason)}</p>` : ''}<p class="request-policy">${escapeHTML(currentUser.historicalAccess ? 'Consulta restrita: este pedido e seus registros anteriores permanecem disponíveis. Novas ações estão bloqueadas.' : adoptionNextStep(request))}</p>${requestContactHTML(request, currentUser)}</div><div class="request-actions">${actionButtons(request)}</div></article>`;
}
function refreshRequests() {
  renderSolicitacoesTab();
  showToast('Solicitação atualizada.');
}
async function analyzeRequest(id) {
  try {
    await Store.analyzeRequest(id);
    refreshRequests();
  } catch (err) {
    showToast(err.message);
  }
}
async function approveRequest(id) {
  if (
    !confirm(
      'Aprovar esta solicitação para avançar aos próximos passos? O animal ainda não será marcado como adotado.',
    )
  )
    return;
  try {
    await Store.approveRequest(id);
    refreshRequests();
  } catch (err) {
    showToast(err.message);
  }
}
async function markInterview(id) {
  if (!confirm('Confirmar que a entrevista ou o contato com o interessado foi realizado/agendado?'))
    return;
  try {
    await Store.advanceRequestStage(id, 'entrevista');
    refreshRequests();
  } catch (err) {
    showToast(err.message);
  }
}
async function handoverRequest(id) {
  if (
    !confirm(
      'Registrar que você entregou o animal? O interessado precisará confirmar o recebimento. Este registro não é comprovação independente da entrega.',
    )
  )
    return;
  try {
    await Store.handoverRequest(id);
    refreshRequests();
  } catch (err) {
    showToast(err.message);
  }
}
async function completeRequest(id) {
  if (
    !confirm(
      'Confirmar que a adoção foi realmente concluída? O animal será marcado como adotado e o termo será gerado.',
    )
  )
    return;
  try {
    await Store.completeRequest(id);
    refreshRequests();
  } catch (err) {
    showToast(err.message);
  }
}
function openProfile(id) {
  const request = managedRequests().find((item) => item.id === Number(id));
  if (!request) return;
  document.getElementById('profile-dialog-title').textContent =
    `Perfil de ${request.full_name || request.requester?.name || 'interessado'}`;
  document.getElementById('profile-dialog-body').innerHTML =
    `<div class="profile-data-grid">${profileItems(request)}</div>`;
  document.getElementById('profile-dialog').showModal();
}
function openReject(id) {
  document.getElementById('reject-request-id').value = id;
  document.getElementById('reject-reason').value = '';
  document.getElementById('reject-dialog').showModal();
  setTimeout(() => document.getElementById('reject-reason').focus(), 20);
}
async function submitReject() {
  const id = Number(document.getElementById('reject-request-id').value);
  const reason = document.getElementById('reject-reason').value;
  try {
    await Store.rejectRequest(id, reason);
    document.getElementById('reject-dialog').close();
    refreshRequests();
  } catch (err) {
    showToast(err.message);
  }
}
async function removeAnimal(id) {
  if (
    !confirm(
      'Arquivar este anúncio? Interessados ativos serão encerrados. Solicitações, termos e acompanhamentos permanecerão no histórico.',
    )
  )
    return;
  try {
    await Store.deleteAnimal(id);
    renderAnimaisTab();
    showToast('Anúncio arquivado; histórico preservado.');
  } catch (err) {
    showToast(err.message);
  }
}
function renderAcompanhamentosTab() {
  const requests = managedRequests().filter((r) => r.status === 'concluida'),
    ids = new Set(requests.map((r) => r.id));
  const updates = Store.getFollowups().filter((f) => ids.has(f.requestId));
  const pendingHelp = updates.filter((f) => f.needsHelp && !f.helpResponse).length;
  const content = document.getElementById('tab-content');
  content.innerHTML =
    '<p class="alert"><b>' +
    pendingHelp +
    ' pedido(s) de ajuda aguardando resposta.</b> Quem age: responsável. Leia os relatos e envie orientação. Os prazos de 7, 30 e 90 dias começam na conclusão.</p>' +
    requests
      .sort(
        (a, b) =>
          Number(updates.some((f) => f.requestId === b.id && f.needsHelp && !f.helpResponse)) -
          Number(updates.some((f) => f.requestId === a.id && f.needsHelp && !f.helpResponse)),
      )
      .map((r) => {
        const animal = Store.requestAnimal(r);
        return (
          '<article class="card" style="padding:20px;margin-bottom:16px"><h3>' +
          escapeHTML(animal?.name || r.animalName || 'Registro histórico') +
          '</h3><p>Adotante: ' +
          escapeHTML(r.full_name || r.requester?.name || 'Família') +
          '</p><div class="followup-timeline">' +
          [7, 30, 90]
            .map((day) => {
              const f = updates.find((f) => f.requestId === r.id && f.day === day),
                due = new Date(new Date(r.completedAt || r.acceptedAt).getTime() + day * 86400000);
              if (!f)
                return (
                  '<div class="followup-step"><b>' +
                  day +
                  ' dias</b><span>' +
                  (Date.now() >= due.getTime()
                    ? 'Aguardando resposta do adotante'
                    : 'Disponível em ' + due.toLocaleDateString('pt-BR')) +
                  '</span></div>'
                );
              return (
                '<div class="followup-step done"><b>' +
                day +
                ' dias · recebido</b><p>Adaptação: ' +
                escapeHTML(
                  { otima: 'Ótima', boa: 'Boa', dificil: 'Difícil' }[f.adaptation] ||
                    'Não informada',
                ) +
                '</p><p><b>Saúde:</b> ' +
                escapeHTML(f.health) +
                '</p><p><b>Comportamento:</b> ' +
                escapeHTML(f.behavior) +
                '</p>' +
                (safeImageSrc(f.photo)
                  ? '<img style="max-width:100%" src="' +
                    escapeAttr(safeImageSrc(f.photo)) +
                    '" alt="Foto do acompanhamento">'
                  : '') +
                (f.needsHelp
                  ? '<div class="alert ' +
                    (f.helpResponse ? 'alert-success' : 'alert-error') +
                    '">' +
                    (f.helpResponse
                      ? 'Orientação enviada: ' + escapeHTML(f.helpResponse)
                      : 'A família pediu ajuda. O responsável precisa responder.') +
                    '</div>' +
                    (!f.helpResponse && !currentUser.historicalAccess
                      ? '<form class="help-response-form" data-followup="' +
                        f.id +
                        '"><label>Orientação<textarea required maxlength="1500" rows="3"></textarea></label><div role="status"></div><button class="btn btn-primary btn-sm" type="submit">Enviar orientação</button></form>'
                      : '')
                  : '<p>A família não solicitou ajuda.</p>') +
                '</div>'
              );
            })
            .join('') +
          '</div><a href="contrato.html?request=' +
          r.id +
          '">Consultar termo</a></article>'
        );
      })
      .join('') +
    (requests.length
      ? ''
      : '<div class="empty-state"><h3>Nenhuma adoção concluída para acompanhar.</h3></div>');
}
document.addEventListener('submit', async (event) => {
  const form = event.target.closest('.help-response-form');
  if (!form) return;
  event.preventDefault();
  const button = form.querySelector('button');
  if (button.disabled) return;
  button.disabled = true;
  try {
    await Store.respondFollowup(
      Number(form.dataset.followup),
      form.querySelector('textarea').value,
    );
    renderAcompanhamentosTab();
    showToast('Orientação enviada.');
  } catch (err) {
    form.querySelector('[role="status"]').textContent = err.message;
    button.disabled = false;
  }
});
function renderDesaparecidosTab() {
  const records = Store.getMissing().filter(
    (m) => currentUser.role === 'admin' || Number(m.ownerId) === currentUser.id,
  );
  let sightings = [];
  try {
    sightings = Store.getSightings();
  } catch {}
  document.getElementById('tab-content').innerHTML = records.length
    ? `<div class="table-wrap"><table><thead><tr><th>Animal</th><th>Cidade</th><th>Status</th><th>Avistamentos</th><th>Ações</th></tr></thead><tbody>${records.map((m) => `<tr><td>${escapeHTML(m.name || 'Sem nome')}</td><td>${escapeHTML(m.city)}/${escapeHTML(m.state)}</td><td>${m.hiddenAt ? 'Oculto pela administração' : m.found ? 'Encontrado' : 'Desaparecido'}</td><td>${sightings.filter((s) => s.missingAnimalId === m.id).length}</td><td><a href="desaparecido.html?id=${Number(m.id)}" class="btn btn-outline btn-compact">Ver registro</a></td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty-state"><h3>Nenhum animal desaparecido cadastrado.</h3><a href="cadastrar-desaparecido.html" class="btn btn-primary" style="margin-top:12px">Cadastrar desaparecido</a></div>';
}
function activateDonorTab(name, renderer) {
  donorTabs.forEach((tab) =>
    document.getElementById(`tab-${tab}`)?.classList.toggle('active', tab === name),
  );
  history.replaceState(null, '', `${location.pathname}?tab=${name}`);
  renderer();
  if (currentUser.historicalAccess)
    document.querySelectorAll('#tab-content a[href^="cadastrar-"]').forEach((el) => el.remove());
}
App.ready(() => {
  currentUser = Auth.requireAuth();
  if (!currentUser) return;
  if (currentUser.historicalAccess) {
    document.querySelector('main h1').textContent = 'Consultar histórico';
    const intro = document.querySelector('main .dashboard-heading p');
    if (intro)
      intro.textContent =
        'Consulte seus registros autorizados. Publicações, decisões e alterações estão bloqueadas nesta conta.';
    const label = document.querySelector('main .eyebrow');
    if (label) label.textContent = 'Consulta restrita';
    document
      .querySelectorAll('a[href="cadastrar-animal.html"],a[href="cadastrar-desaparecido.html"]')
      .forEach((el) => el.remove());
  }
  const renderers = {
    animais: renderAnimaisTab,
    solicitacoes: renderSolicitacoesTab,
    desaparecidos: renderDesaparecidosTab,
    acompanhamentos: renderAcompanhamentosTab,
  };
  donorTabs.forEach((tab) =>
    document
      .getElementById(`tab-${tab}`)
      ?.addEventListener('click', () => activateDonorTab(tab, renderers[tab])),
  );
  document
    .getElementById('profile-dialog-close')
    .addEventListener('click', () => document.getElementById('profile-dialog').close());
  document
    .getElementById('reject-dialog-close')
    .addEventListener('click', () => document.getElementById('reject-dialog').close());
  document
    .getElementById('reject-cancel')
    .addEventListener('click', () => document.getElementById('reject-dialog').close());
  document.getElementById('reject-confirm').addEventListener('click', App.click(submitReject));
  const initial = donorTabs.includes(getParam('tab')) ? getParam('tab') : 'animais';
  activateDonorTab(initial, renderers[initial]);
});

async function changeAvailability(id, action) {
  const message =
    action === 'withdraw'
      ? 'Retirar este animal de adoção?'
      : 'Informar que este animal foi adotado fora da plataforma? Esta ação não gera termo nem conta uma adoção concluída pelo PotyPet.';
  if (
    !confirm(
      message + ' Interessados ativos serão encerrados e avisados; o histórico será preservado.',
    )
  )
    return;
  const reason = prompt('Motivo ou observação (opcional, até 1000 caracteres):', '');
  if (reason === null) return;
  try {
    await Store.changeAnimalAvailability(id, action, reason);
    renderAnimaisTab();
    showToast('Situação atualizada; interessados avisados.');
  } catch (err) {
    showToast(err.message);
  }
}
async function withdrawAnimal(id) {
  await changeAvailability(id, 'withdraw');
}
async function externalAdoption(id) {
  await changeAvailability(id, 'external-adoption');
}
