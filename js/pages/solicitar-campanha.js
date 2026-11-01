'use strict';
let requestCampaign = null,
  requestUser = null,
  requestStep = 0,
  requestBusy = false;
const requestToken = crypto.randomUUID
  ? crypto.randomUUID()
  : [...crypto.getRandomValues(new Uint8Array(16))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
const requestFields = [
  'kind',
  'target',
  'beneficiaryName',
  'organizer',
  'title',
  'category',
  'description',
  'city',
  'state',
  'costs',
  'contact',
  'beneficiary',
  'receiverRelation',
  'pixKeyType',
  'pixKey',
  'receiverReason',
  'photoFileId',
  'updateText',
  'expenseDescription',
  'progressNote',
  'accountabilityDate',
];
function requestValue(key) {
  return document.getElementById('f-' + key).value;
}
function requestMoney(value) {
  if (!value.trim()) return 0;
  const m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!m) throw Error('Use valores sem separador de milhar, com até duas casas decimais.');
  return Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
}
function requestData() {
  const d = Object.fromEntries(requestFields.map((key) => [key, requestValue(key)]));
  d.state = d.state.toUpperCase();
  for (const key of ['photoConsent', 'receiverAuthorization', 'closeRequested'])
    d[key] = document.getElementById('f-' + key).checked;
  d.animalId =
    d.target === 'animal' && requestValue('animalId') ? Number(requestValue('animalId')) : null;
  d.organizationId =
    d.target === 'organization' && requestValue('organizationId')
      ? Number(requestValue('organizationId'))
      : null;
  d.goalCents = d.kind === 'ongoing' ? 0 : requestMoney(requestValue('goalCents'));
  d.raisedCents = requestMoney(requestValue('raisedCents'));
  return d;
}
function requestConditions() {
  if (requestValue('kind') === 'ongoing')
    document.getElementById('f-target').value = 'organization';
  document.getElementById('f-target').disabled =
    requestValue('kind') === 'ongoing' || requestCampaign?.liveState === 'closed';
  document.getElementById('goal-field').hidden = requestValue('kind') === 'ongoing';
  document.getElementById('animal-link-field').hidden = requestValue('target') !== 'animal';
  document.getElementById('organization-field').hidden = requestValue('target') !== 'organization';
  document.getElementById('third-party-fields').hidden = !['clinica', 'outro'].includes(
    requestValue('receiverRelation'),
  );
}
function requestShowStep(step) {
  requestStep = Math.max(0, Math.min(4, step));
  document
    .querySelectorAll('[data-panel]')
    .forEach((el) => (el.hidden = Number(el.dataset.panel) !== requestStep));
  document.querySelectorAll('[data-step]').forEach((el) => {
    if (Number(el.dataset.step) === requestStep) el.setAttribute('aria-current', 'step');
    else el.removeAttribute('aria-current');
  });
  document.getElementById('previous-step').hidden = requestStep === 0;
  document.getElementById('next-step').hidden = requestStep === 4;
  document.getElementById('submit-campaign').hidden = requestStep !== 4;
  if (requestStep === 4) {
    try {
      document.getElementById('request-preview').innerHTML = campaignPreview(requestData());
    } catch (e) {
      fundError(e);
    }
  }
}
function requestLoading(value) {
  requestBusy = value;
  for (const id of ['save-draft', 'submit-campaign', 'evidence-files'])
    document.getElementById(id).disabled = value;
}
function requestFiles() {
  const list = requestCampaign?.files || [],
    selected = requestValue('photoFileId');
  document.getElementById('evidence-list').innerHTML = list
    .map(
      (f) =>
        '<li><a href="/api/campaign-files/' +
        f.id +
        '" download>' +
        fundEscape(f.name) +
        '</a><span>' +
        Math.ceil(f.size / 1024) +
        ' KB · privado' +
        (f.withdrawnAt
          ? ' · retirada, preservada no histórico'
          : f.retained
            ? ' · utilizada em decisão'
            : ' · sem uso em decisão') +
        '</span>' +
        (!f.withdrawnAt && requestCampaign.approved?.photoFileId !== f.id
          ? '<button type="button" class="btn btn-outline btn-sm" data-remove-evidence="' +
            f.id +
            '">' +
            (f.retained ? 'Retirar de futuras análises' : 'Remover evidência') +
            '</button>'
          : '') +
        '</li>',
    )
    .join('');
  document.getElementById('f-photoFileId').innerHTML =
    '<option value="">Sem foto pública</option>' +
    list
      .filter((f) => f.mime === 'image/png' && !f.withdrawnAt)
      .map((f) => '<option value="' + f.id + '">' + fundEscape(f.name) + '</option>')
      .join('');
  document.getElementById('f-photoFileId').value = selected;
}
async function requestSave() {
  const d = requestData();
  requestCampaign = await fundApi(
    requestCampaign ? 'PATCH' : 'POST',
    requestCampaign ? '/api/campaigns/' + requestCampaign.id : '/api/campaigns',
    {
      ...d,
      ...(requestCampaign ? { revision: requestCampaign.revision } : { clientToken: requestToken }),
    },
  );
  history.replaceState(null, '', 'solicitar-campanha.html?id=' + requestCampaign.id);
  document.getElementById('save-status').textContent =
    'Rascunho salvo no servidor às ' + new Date().toLocaleTimeString('pt-BR') + '.';
  return requestCampaign;
}
App.ready(async () => {
  requestUser = Auth.requireAuth();
  if (!requestUser) return;
  try {
    const animals = Store.getAnimals().filter(
      (a) => Number(a.ownerId) === requestUser.id || requestUser.role === 'admin',
    );
    document.getElementById('f-animalId').innerHTML += animals
      .map(
        (a) =>
          '<option value="' +
          a.id +
          '">' +
          fundEscape(a.name) +
          ' · ' +
          fundEscape(ANIMAL_STATUS[a.status]) +
          '</option>',
      )
      .join('');
    const organizations = (await fundApi('GET', '/api/organizations')).filter(
      (o) => o.id === requestUser.id || requestUser.role === 'admin',
    );
    const isOrg = requestUser.accountType === 'ong' && requestUser.approvalStatus === 'aprovado';
    if (isOrg && !organizations.some((o) => o.id === requestUser.id))
      organizations.push({ id: requestUser.id, name: requestUser.name });
    const canOrg = isOrg || requestUser.role === 'admin';
    document.getElementById('organization-option').hidden = !canOrg;
    document.getElementById('ongoing-option').hidden = !canOrg;
    document.getElementById('f-organizationId').innerHTML += organizations
      .map((o) => '<option value="' + o.id + '">' + fundEscape(o.name) + '</option>')
      .join('');
    if (isOrg) document.getElementById('f-organizationId').value = requestUser.id;
    document.getElementById('f-organizer').value = requestUser.name;
    document.getElementById('f-city').value = requestUser.city || '';
    document.getElementById('f-state').value = requestUser.state || '';
    const params = new URLSearchParams(location.search),
      id = params.get('id');
    if (params.get('tipo') === 'continuo' && canOrg)
      document.getElementById('f-kind').value = 'ongoing';
    if (id) {
      requestCampaign = await fundApi('GET', '/api/campaigns/' + Number(id));
      if (['review', 'archived'].includes(requestCampaign.status)) {
        location.href = 'campanhas.html';
        return;
      }
      const d = requestCampaign.draft;
      for (const key of requestFields)
        if (d[key] !== undefined) document.getElementById('f-' + key).value = d[key];
      for (const key of ['animalId', 'organizationId'])
        document.getElementById('f-' + key).value = d[key] || '';
      for (const key of ['photoConsent', 'receiverAuthorization', 'closeRequested'])
        document.getElementById('f-' + key).checked = !!d[key];
      for (const key of ['goalCents', 'raisedCents'])
        document.getElementById('f-' + key).value = ((d[key] || 0) / 100)
          .toFixed(2)
          .replace('.', ',');
      requestFiles();
      document.getElementById('f-photoFileId').value = d.photoFileId || '';
      document.getElementById('wizard-title').textContent = 'Editar solicitação';
      document.getElementById('published-version-note').hidden = !requestCampaign.approved;
      document.getElementById('update-fields').hidden = !requestCampaign.approved;
      if (requestCampaign.approved && requestCampaign.liveState === 'closed') {
        document.getElementById('wizard-title').textContent =
          'Prestação de contas da campanha encerrada';
        document.querySelector('.workspace-head p').textContent =
          'Atualize a prestação de contas. A campanha continuará encerrada e não receberá novos Pix pelo site.';
        document.getElementById('published-version-note').textContent =
          'Enquanto a prestação de contas é analisada, a versão aprovada permanece pública e o Pix continua bloqueado.';
        const allowed = new Set([
          'updateText',
          'expenseDescription',
          'raisedCents',
          'progressNote',
          'accountabilityDate',
        ]);
        document
          .querySelectorAll('[id^="f-"]')
          .forEach((input) => (input.disabled = !allowed.has(input.id.slice(2))));
      }
    }
    requestConditions();
    requestShowStep(0);
    document
      .querySelectorAll('[data-step]')
      .forEach((el) =>
        el.addEventListener('click', () => requestShowStep(Number(el.dataset.step))),
      );
    document
      .getElementById('next-step')
      .addEventListener('click', () => requestShowStep(requestStep + 1));
    document
      .getElementById('previous-step')
      .addEventListener('click', () => requestShowStep(requestStep - 1));
    for (const key of ['kind', 'target', 'receiverRelation'])
      document.getElementById('f-' + key).addEventListener('change', requestConditions);
    document.getElementById('f-animalId').addEventListener('change', () => {
      const a = animals.find((a) => a.id === Number(requestValue('animalId')));
      if (a) {
        document.getElementById('f-beneficiaryName').value = a.name;
        document.getElementById('f-city').value = a.city;
        document.getElementById('f-state').value = a.state;
      }
    });
    document.getElementById('save-draft').addEventListener(
      'click',
      App.click(async () => {
        if (requestBusy) return;
        requestLoading(true);
        document.getElementById('workspace-error').hidden = true;
        try {
          await requestSave();
        } catch (e) {
          fundError(e);
        } finally {
          requestLoading(false);
        }
      }),
    );
    document.getElementById('evidence-files').addEventListener('change', async (event) => {
      if (requestBusy) return;
      requestLoading(true);
      document.getElementById('workspace-error').hidden = true;
      try {
        const selected = [...event.target.files];
        if (
          selected.length + (requestCampaign?.files?.filter((f) => !f.withdrawnAt).length || 0) >
          12
        )
          throw Error('Use até 12 evidências ativas por campanha.');
        await requestSave();
        for (const file of selected) {
          const uploaded = await fundApi(
            'POST',
            '/api/campaigns/' + requestCampaign.id + '/files',
            { ...(await campaignFile(file)), revision: requestCampaign.revision },
          );
          requestCampaign.revision = uploaded.revision;
          requestCampaign.files.push(uploaded);
          requestFiles();
        }
        event.target.value = '';
        document.getElementById('save-status').textContent = 'Evidências salvas em área privada.';
      } catch (e) {
        fundError(e);
      } finally {
        requestLoading(false);
      }
    });
    document.getElementById('evidence-list').addEventListener(
      'click',
      App.click(async (event) => {
        const button = event.target.closest('[data-remove-evidence]');
        if (!button || requestBusy) return;
        const reason = prompt(
          'Explique a retirada. Evidências utilizadas em decisões permanecerão no histórico privado.',
        );
        if (reason === null) return;
        requestLoading(true);
        try {
          await requestSave();
          requestCampaign = await fundApi(
            'DELETE',
            '/api/campaign-files/' + button.dataset.removeEvidence,
            { revision: requestCampaign.revision, reason },
          );
          requestFiles();
          document.getElementById('save-status').textContent =
            'Retirada registrada. O histórico utilizado em decisões foi preservado.';
        } catch (err) {
          fundError(err);
        } finally {
          requestLoading(false);
        }
      }),
    );
    document.getElementById('campaign-request').addEventListener(
      'submit',
      App.form(async (event) => {
        event.preventDefault();
        if (requestBusy) return;
        requestLoading(true);
        document.getElementById('workspace-error').hidden = true;
        try {
          await requestSave();
          await fundApi('POST', '/api/campaigns/' + requestCampaign.id + '/submit', {
            revision: requestCampaign.revision,
          });
          location.href = 'campanhas.html';
        } catch (e) {
          fundError(e);
        } finally {
          requestLoading(false);
        }
      }),
    );
  } catch (e) {
    fundError(e);
  }
});
