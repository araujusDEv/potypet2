'use strict';
const assert = require('node:assert/strict'),
  crypto = require('node:crypto');
const { PNG } = require('pngjs'),
  { PDFDocument } = require('pdf-lib');
const check = require('./start-check.cjs');
function client() {
  let cookie = '';
  return async function api(method, route, body, expected = 200) {
    if (method === 'POST' && route.endsWith('/checks') && !body.scopes)
      body = {
        ...require('./campaign-review-fixture.cjs')(
          await api('GET', route.replace(/\/checks$/, '')),
        ),
        ...body,
      };
    if (method === 'POST' && route.endsWith('/review') && body.decision === 'approve')
      body = { publicSummaryConfirmed: true, ...body };
    const res = await fetch('http://127.0.0.1:3170' + route, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body:
        body === undefined
          ? undefined
          : JSON.stringify(
              method === 'POST' && route === '/api/requests'
                ? require('./adoption-fixture.cjs')(body)
                : body,
            ),
    });
    if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
    const payload = (res.headers.get('content-type') || '').includes('application/json')
      ? await res.json()
      : Buffer.from(await res.arrayBuffer());
    assert.equal(
      res.status,
      expected,
      method + ' ' + route + ': ' + JSON.stringify(payload).slice(0, 350),
    );
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    return payload;
  };
}
check('Full fundraising workflow, privacy, adoption and continuous support', async () => {
  const admin = client(),
    person = client(),
    other = client(),
    org = client(),
    pending = client(),
    guest = client();
  await admin('POST', '/api/auth/login', { email: 'admin@adotapet.com', password: 'admin123' });
  async function register(api, name, type = 'usuario') {
    return api(
      'POST',
      '/api/auth/register',
      {
        name,
        email: name + '@example.test',
        password: 'TesteSeguro9',
        passwordConfirmation: 'TesteSeguro9',
        accountType: type,
        organizationKind: 'grupo',
        city: 'Apodi',
        state: 'RN',
        phone: '84999999999',
        termsAccepted: true,
      },
      201,
    );
  }
  const owner = await register(person, 'responsavel');
  await register(other, 'outro');
  const organization = await register(org, 'grupo', 'ong');
  await register(pending, 'pendente', 'ong');
  await pending(
    'POST',
    '/api/auth/login',
    { email: 'pendente@example.test', password: 'TesteSeguro9' },
    403,
  );
  await pending('POST', '/api/campaigns', { clientToken: crypto.randomUUID() }, 401);
  await guest('GET', '/api/campaigns/manage', undefined, 401);
  await person('GET', '/api/campaigns/manage', undefined, 403);
  await admin('POST', '/api/users/' + organization.user.id + '/approve', {});
  const approvedOrg = await org('POST', '/api/auth/login', {
    email: 'grupo@example.test',
    password: 'TesteSeguro9',
  });
  assert.equal(approvedOrg.user.organizationKind, 'grupo');
  await org('PUT', '/api/organizations/me', {
    city: 'Apodi',
    state: 'RN',
    description: 'Grupo fictício usado apenas para testes automáticos.',
    area: 'Acolhimento',
    contact: 'Contato privado',
    contactConsent: false,
  });
  let orgPublic = await guest('GET', '/api/organizations/' + organization.user.id);
  assert.equal(orgPublic.contact, '');
  assert.equal(orgPublic.type, 'grupo');
  assert.deepEqual(orgPublic.campaigns, []);
  const png = new PNG({ width: 8, height: 8 });
  png.data.fill(255);
  const image = {
    name: 'foto-teste.png',
    mime: 'image/png',
    base64: PNG.sync.write(png).toString('base64'),
  };
  const pdf = await PDFDocument.create();
  pdf.addPage([100, 100]);
  const document = {
    name: 'orcamento-teste.pdf',
    mime: 'application/pdf',
    base64: Buffer.from(await pdf.save()).toString('base64'),
  };
  const base = {
    clientToken: crypto.randomUUID(),
    kind: 'campaign',
    target: 'animal',
    title: 'Teste de campanha sem adoção',
    beneficiaryName: 'Animal de teste',
    description: 'Campanha fictícia para validar solicitação sem criar anúncio de adoção.',
    category: 'tratamento',
    city: 'Apodi',
    state: 'RN',
    costs: 'Consulta e tratamento conforme orçamento anexo.',
    organizer: 'Responsável de teste',
    contact: 'Contato público de teste',
    goalCents: 150000,
    raisedCents: 0,
    beneficiary: 'Beneficiário de teste',
    pixKeyType: 'aleatoria',
    pixKey: '00000000-0000-0000-0000-000000000000',
    receiverRelation: 'tutor',
    photoFileId: '',
    photoConsent: false,
    animalId: null,
    organizationId: null,
  };
  const before = await person('GET', '/api/animals');
  let c = await person(
    'POST',
    '/api/campaigns',
    { ...base, status: 'active', ownerId: 1, approved: { pixKey: base.pixKey } },
    201,
  );
  assert.equal(c.ownerId, owner.user.id);
  assert.equal(c.status, 'draft');
  assert.equal(c.approved, null);
  const duplicate = await person('POST', '/api/campaigns', base);
  assert.equal(duplicate.id, c.id);
  assert.deepEqual(await person('GET', '/api/animals'), before);
  assert.deepEqual(await guest('GET', '/api/campaigns'), []);
  await other('GET', '/api/campaigns/' + c.id, undefined, 404);
  await other('PATCH', '/api/campaigns/' + c.id, { title: 'Invasão', revision: 1 }, 404);
  await person(
    'POST',
    '/api/campaigns/' + c.id + '/review',
    { decision: 'approve', revision: c.revision },
    403,
  );
  await person('POST', '/api/campaigns/' + c.id + '/submit', { revision: c.revision }, 400);
  await person(
    'POST',
    '/api/campaigns/' + c.id + '/files',
    {
      name: 'falso.pdf',
      mime: 'application/pdf',
      base64: Buffer.from('não é PDF').toString('base64'),
    },
    400,
  );
  await person(
    'POST',
    '/api/campaigns/' + c.id + '/files',
    { ...image, base64: image.base64.slice(0, -8) + 'AAAAAAAA' },
    400,
  );
  const photo = await person('POST', '/api/campaigns/' + c.id + '/files', image, 201);
  const doc = await person('POST', '/api/campaigns/' + c.id + '/files', document, 201);
  c = await person('GET', '/api/campaigns/' + c.id);
  await guest('GET', '/api/campaign-files/' + doc.id, undefined, 401);
  await other('GET', '/api/campaign-files/' + doc.id, undefined, 404);
  assert.ok(Buffer.isBuffer(await admin('GET', '/api/campaign-files/' + doc.id)));
  await guest('GET', '/api/campaign-media/' + photo.id, undefined, 404);
  c = await person('PATCH', '/api/campaigns/' + c.id, {
    revision: c.revision,
    photoFileId: photo.id,
    photoConsent: true,
  });
  c = await person('POST', '/api/campaigns/' + c.id + '/submit', { revision: c.revision });
  assert.equal(c.status, 'review');
  assert.deepEqual(await guest('GET', '/api/campaigns'), []);
  await person('POST', '/api/campaigns/' + c.id + '/submit', { revision: c.revision }, 409);
  await person(
    'PATCH',
    '/api/campaigns/' + c.id,
    { revision: c.revision, title: 'Edição em análise' },
    409,
  );
  await admin(
    'POST',
    '/api/campaigns/' + c.id + '/review',
    { revision: c.revision, decision: 'changes', reason: '' },
    400,
  );
  c = await admin('POST', '/api/campaigns/' + c.id + '/review', {
    revision: c.revision,
    decision: 'changes',
    reason: 'Detalhar os itens do orçamento apresentado.',
  });
  c = await person('PATCH', '/api/campaigns/' + c.id, {
    revision: c.revision,
    costs: 'Consulta: R$ 500. Procedimentos e medicamentos: R$ 1.000.',
  });
  c = await person('POST', '/api/campaigns/' + c.id + '/submit', { revision: c.revision });
  await admin(
    'POST',
    '/api/campaigns/' + c.id + '/review',
    { revision: c.revision, decision: 'approve', summary: 'Orçamento e foto foram analisados.' },
    400,
  );
  c = await admin('POST', '/api/campaigns/' + c.id + '/checks', {
    revision: c.revision,
    note: 'Teste: comparados orçamento, foto e finalidade.',
    external: false,
  });
  c = await admin('POST', '/api/campaigns/' + c.id + '/review', {
    revision: c.revision,
    decision: 'approve',
    summary: 'Foto e composição do orçamento analisadas pela equipe.',
  });
  let pub = (await guest('GET', '/api/campaigns'))[0];
  assert.equal(pub.canDonate, true);
  assert.equal(pub.animalId, null);
  assert.equal(pub.draft, undefined);
  assert.equal(pub.files, undefined);
  assert.equal(pub.checks, undefined);
  assert.equal(pub.ownerId, undefined);
  assert.ok(Buffer.isBuffer(await guest('GET', '/api/campaign-media/' + photo.id)));
  await guest('GET', '/api/campaign-media/' + doc.id, undefined, 404);
  const pix = await guest('POST', '/api/campaigns/' + c.id + '/pix', {
    revision: pub.revision,
    amountCents: 3759,
  });
  assert.ok(pix.payload.includes('540537.59'));
  assert.equal((await guest('GET', '/api/campaigns'))[0].raisedCents, 0);
  const originalKey = pub.pixKey,
    originalRevision = pub.revision;
  c = await person('PATCH', '/api/campaigns/' + c.id, {
    revision: c.revision,
    pixKey: '11111111-1111-1111-1111-111111111111',
    goalCents: 180000,
    raisedCents: 3759,
    progressNote: 'Recebimento conferido no extrato, em teste.',
    updateText: 'Atualização dos cuidados para revisão.',
    accountabilityDate: new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(
      new Date(),
    ),
    expenseDescription: 'Fixture: despesas ainda não realizadas, total reservado aos cuidados.',
  });
  pub = (await guest('GET', '/api/campaigns'))[0];
  assert.equal(pub.pixKey, originalKey);
  assert.equal(pub.goalCents, 150000);
  assert.equal(pub.raisedCents, 0);
  c = await person('POST', '/api/campaigns/' + c.id + '/submit', { revision: c.revision });
  await admin(
    'POST',
    '/api/campaigns/' + c.id + '/review',
    { revision: c.revision, decision: 'approve', summary: 'Nova análise da chave e orçamento.' },
    400,
  );
  c = await admin('POST', '/api/campaigns/' + c.id + '/checks', {
    revision: c.revision,
    note: 'Teste: nova verificação do recebedor e orçamento.',
    external: true,
    source: 'Contato independente registrado apenas como fixture de teste.',
  });
  c = await admin('POST', '/api/campaigns/' + c.id + '/review', {
    revision: c.revision,
    decision: 'approve',
    summary: 'Alteração do recebedor e composição dos custos analisadas.',
  });
  pub = (await guest('GET', '/api/campaigns'))[0];
  assert.equal(pub.pixKey, c.approved.pixKey);
  assert.equal(pub.raisedCents, 3759);
  assert.equal(pub.updates.length, 1);
  await guest(
    'POST',
    '/api/campaigns/' + c.id + '/pix',
    { revision: originalRevision, amountCents: 100 },
    409,
  );
  c = await admin('POST', '/api/campaigns/' + c.id + '/review', {
    revision: c.revision,
    decision: 'pause',
    reason: 'Pausa solicitada para conferir informações.',
  });
  pub = (await guest('GET', '/api/campaigns'))[0];
  assert.equal(pub.canDonate, false);
  assert.equal(pub.pixKey, '');
  await guest(
    'POST',
    '/api/campaigns/' + c.id + '/pix',
    { revision: pub.revision, amountCents: 100 },
    409,
  );
  c = await admin('POST', '/api/campaigns/' + c.id + '/review', {
    revision: c.revision,
    decision: 'resume',
  });
  c = await admin('POST', '/api/campaigns/' + c.id + '/review', {
    revision: c.revision,
    decision: 'close',
    reason: 'Campanha de teste encerrada após conferência.',
  });
  assert.equal(c.status, 'closed');
  await person('PATCH', '/api/campaigns/' + c.id, { revision: c.revision, title: 'Reabrir' }, 409);
  let group = await person(
    'POST',
    '/api/campaigns',
    {
      ...base,
      clientToken: crypto.randomUUID(),
      target: 'group',
      category: 'alimentacao',
      beneficiaryName: 'Animais do abrigo',
    },
    201,
  );
  await person('POST', '/api/campaigns/' + group.id + '/files', document, 201);
  group = await person('GET', '/api/campaigns/' + group.id);
  group = await person('POST', '/api/campaigns/' + group.id + '/submit', {
    revision: group.revision,
  });
  group = await admin('POST', '/api/campaigns/' + group.id + '/review', {
    revision: group.revision,
    decision: 'reject',
    reason: 'Documentos insuficientes neste cenário de teste.',
  });
  assert.equal(group.status, 'rejected');
  assert.ok(!(await guest('GET', '/api/campaigns')).some((p) => p.id === group.id));
  await person(
    'POST',
    '/api/campaigns',
    {
      ...base,
      clientToken: crypto.randomUUID(),
      target: 'organization',
      organizationId: organization.user.id,
    },
    403,
  );
  let continuous = await org(
    'POST',
    '/api/campaigns',
    {
      ...base,
      clientToken: crypto.randomUUID(),
      kind: 'ongoing',
      target: 'organization',
      organizationId: organization.user.id,
      category: 'alimentacao',
      beneficiaryName: 'Grupo de teste',
      goalCents: 0,
      receiverRelation: 'organizacao',
    },
    201,
  );
  await org('POST', '/api/campaigns/' + continuous.id + '/files', document, 201);
  continuous = await org('GET', '/api/campaigns/' + continuous.id);
  continuous = await org('POST', '/api/campaigns/' + continuous.id + '/submit', {
    revision: continuous.revision,
  });
  assert.deepEqual(
    (await guest('GET', '/api/organizations/' + organization.user.id)).campaigns,
    [],
  );
  continuous = await admin('POST', '/api/campaigns/' + continuous.id + '/checks', {
    revision: continuous.revision,
    note: 'Análise de apoio contínuo em teste.',
  });
  continuous = await admin('POST', '/api/campaigns/' + continuous.id + '/review', {
    revision: continuous.revision,
    decision: 'approve',
    summary: 'Custos recorrentes e responsável analisados.',
  });
  orgPublic = await guest('GET', '/api/organizations/' + organization.user.id);
  assert.equal(orgPublic.campaigns[0].goalCents, null);
  assert.equal(orgPublic.campaigns[0].canDonate, true);
  const animal = await person(
    'POST',
    '/api/animals',
    {
      name: 'Animal próprio',
      city: 'Apodi',
      state: 'RN',
      description: 'Animal fictício para revisão.',
      photos: ['img/animal1.png'],
    },
    201,
  );
  assert.equal(animal.approvalStatus, 'pending');
  await other(
    'POST',
    '/api/campaigns',
    { ...base, clientToken: crypto.randomUUID(), animalId: animal.id },
    403,
  );
  await person(
    'POST',
    '/api/campaigns',
    { ...base, clientToken: crypto.randomUUID(), animalId: animal.id },
    201,
  );
  await admin('PATCH', '/api/animals/' + animal.id, { status: 'adotado' });
  const edited = await person('PATCH', '/api/animals/' + animal.id, {
    description: 'Atualização do perfil após adoção.',
  });
  assert.equal(edited.status, 'adotado');
  assert.equal(edited.approvalStatus, 'pending');
  await admin('PATCH', '/api/animals/' + animal.id, {
    approvalStatus: 'approved',
    reason: 'Revisão administrativa de fixture de teste.',
  });
  assert.equal(
    (await person('GET', '/api/animals')).find((a) => a.id === animal.id).status,
    'adotado',
  );
  assert.ok(
    (await admin('GET', '/api/notifications')).some((n) =>
      n.message.includes('aguardando análise'),
    ),
  );
  assert.ok(
    (await person('GET', '/api/notifications')).some((n) => n.message.includes('aprovada')),
  );
  // A correction can be resubmitted after rejection without exposing rejected data.
  group = await person('PATCH', '/api/campaigns/' + group.id, {
    revision: group.revision,
    costs: 'Necessidade detalhada e orçamento corrigido do grupo.',
  });
  group = await person('POST', '/api/campaigns/' + group.id + '/submit', {
    revision: group.revision,
  });
  group = await admin('POST', '/api/campaigns/' + group.id + '/checks', {
    revision: group.revision,
    note: 'Conferência das correções do grupo em teste.',
  });
  group = await admin('POST', '/api/campaigns/' + group.id + '/review', {
    revision: group.revision,
    decision: 'approve',
    summary: 'Necessidade e orçamento do grupo analisados.',
  });
  assert.equal(group.status, 'active');
  let third = await person(
    'POST',
    '/api/campaigns',
    {
      ...base,
      clientToken: crypto.randomUUID(),
      receiverRelation: 'clinica',
      receiverAuthorization: false,
      receiverReason: '',
    },
    201,
  );
  await person('POST', '/api/campaigns/' + third.id + '/files', image, 201);
  await person('POST', '/api/campaigns/' + third.id + '/files', document, 201);
  third = await person('GET', '/api/campaigns/' + third.id);
  await person('POST', '/api/campaigns/' + third.id + '/submit', { revision: third.revision }, 400);
  await person(
    'PATCH',
    '/api/campaigns/' + third.id,
    { revision: third.revision, photoFileId: photo.id },
    400,
  );
  third = await person('PATCH', '/api/campaigns/' + third.id, {
    revision: third.revision,
    receiverAuthorization: true,
    receiverReason: 'O pagamento será feito diretamente à clínica responsável.',
  });
  third = await person('POST', '/api/campaigns/' + third.id + '/submit', {
    revision: third.revision,
  });
  assert.equal(third.status, 'review');
  const support = (await guest('GET', '/api/campaigns')).find((x) => x.id === continuous.id);
  for (let i = 0; i < 27; i++)
    await guest('POST', '/api/campaigns/' + support.id + '/pix', {
      revision: support.revision,
      amountCents: 1,
    });
  await guest(
    'POST',
    '/api/campaigns/' + support.id + '/pix',
    { revision: support.revision, amountCents: 1 },
    429,
  );
  continuous = await org('PATCH', '/api/campaigns/' + continuous.id, {
    revision: continuous.revision,
    closeRequested: true,
    updateText: 'Solicitamos encerrar este apoio de demonstração.',
    accountabilityDate: new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(
      new Date(),
    ),
    expenseDescription: 'Fixture: não houve despesas nesta simulação.',
    progressNote: 'Fixture: total zero apurado, sem recebimentos ou despesas.',
  });
  assert.equal(
    (await guest('GET', '/api/campaigns')).find((x) => x.id === continuous.id).canDonate,
    true,
  );
  continuous = await org('POST', '/api/campaigns/' + continuous.id + '/submit', {
    revision: continuous.revision,
  });
  continuous = await admin('POST', '/api/campaigns/' + continuous.id + '/checks', {
    revision: continuous.revision,
    note: 'Prestação de contas e encerramento conferidos em teste.',
  });
  continuous = await admin('POST', '/api/campaigns/' + continuous.id + '/review', {
    revision: continuous.revision,
    decision: 'approve',
    summary: 'Atualização de encerramento analisada.',
  });
  assert.equal(continuous.status, 'closed');
  assert.equal(
    (await guest('GET', '/api/campaigns')).find((x) => x.id === continuous.id).canDonate,
    false,
  );
  console.log(
    'OK: pessoa, grupo aprovado/pendente, visitante, administração, evidências, revisões, Pix, múltiplos animais e apoio contínuo.',
  );
}).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
