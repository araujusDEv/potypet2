'use strict';
const assert = require('node:assert/strict');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3170';
function client() {
  let cookie = '';
  return async (method, path, body, expected = 200) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const payload = await response.json();
    assert.equal(
      response.status,
      expected,
      `${method} ${path}: esperado ${expected}, recebido ${response.status} (${payload.error || ''})`,
    );
    return payload;
  };
}
const password = 'TesteSeguro9';
async function register(api, email, name = 'Pessoa Teste', accountType = 'usuario') {
  return api(
    'POST',
    '/api/auth/register',
    {
      name,
      email,
      password,
      passwordConfirmation: password,
      accountType,
      city: 'Apodi',
      state: 'RN',
      phone: '(84) 99999-9999',
      termsAccepted: true,
      remember: true,
    },
    201,
  );
}
async function createAnimal(api, name) {
  return await api(
    'POST',
    '/api/animals',
    {
      name,
      species: 'cachorro',
      breed: 'SRD',
      sex: 'macho',
      size: 'medio',
      age_group: 'adulto',
      city: 'Apodi',
      state: 'RN',
      description: 'Animal dócil para adoção responsável.',
      contact: '(84) 99999-9999',
      photos: ['img/animal1.png'],
    },
    201,
  );
}
async function run() {
  const suffix = Date.now();
  const admin = client(),
    owner = client(),
    applicant = client(),
    other = client(),
    ong = client();
  await admin(
    'POST',
    '/api/auth/login',
    { email: 'admin@adotapet.com', password: 'admin123' },
    200,
  );
  await register(owner, `owner${suffix}@test.local`, 'Responsável Teste');
  await register(applicant, `applicant${suffix}@test.local`, 'Interessado Teste');
  await register(other, `other${suffix}@test.local`, 'Outro Usuário');
  const pending = await register(ong, `ong${suffix}@test.local`, 'ONG Teste', 'ong');
  assert.equal(pending.pendingApproval, true);
  await ong('POST', '/api/auth/login', { email: `ong${suffix}@test.local`, password }, 403);
  const users = await admin('GET', '/api/users');
  const ongUser = users.find((u) => u.email === `ong${suffix}@test.local`);
  assert.equal(ongUser.approvalStatus, 'pendente');
  await admin('POST', `/api/users/${ongUser.id}/approve`, {}, 200);
  await ong('POST', '/api/auth/login', { email: `ong${suffix}@test.local`, password }, 200);
  const ongAnimal = await createAnimal(ong, 'Animal da ONG');
  assert.equal(ongAnimal.approvalStatus, 'pending');

  const animal = await createAnimal(owner, 'Animal Fluxo');
  assert.equal(animal.approvalStatus, 'pending');
  await other('PATCH', `/api/animals/${animal.id}`, { name: 'Tentativa indevida' }, 403);
  await admin(
    'PATCH',
    `/api/animals/${animal.id}`,
    {
      status: 'disponivel',
      approvalStatus: 'approved',
      reason: 'Revisão administrativa de fixture de teste.',
    },
    200,
  );
  const requestBody = {
    contactConsent: true,
    animalId: animal.id,
    full_name: 'Interessado Teste',
    age: '25',
    city: 'Apodi',
    housing: 'casa',
    has_yard: true,
    has_pets: false,
    experience: true,
    reason: 'Tenho tempo e estrutura para cuidar.',
    responsibility_confirmed: true,
    questionnaire: {
      household_agrees: 'sim',
      financial_conditions: 'sim',
      alone_time: '2_4h',
      had_pets_before: 'sim',
      vet_commitment: 'sim',
      adaptation_plan: 'Acompanhamento veterinário e adaptação gradual.',
    },
  };
  const first = await applicant('POST', '/api/requests', requestBody, 201);
  const second = await other(
    'POST',
    '/api/requests',
    { ...requestBody, full_name: 'Outro Usuário' },
    201,
  );
  await ong('POST', `/api/requests/${first.id}/analyze`, {}, 403);
  const received = await owner('GET', '/api/requests');
  const receivedFirst = received.find((r) => r.id === first.id);
  assert.ok(receivedFirst.requester.email);
  assert.ok(receivedFirst.requester.phone);
  let reviewed = await owner('POST', `/api/requests/${first.id}/analyze`, {}, 200);
  assert.equal(reviewed.status, 'em_analise');
  assert.ok(reviewed.reviewedBy && reviewed.reviewedAt);
  reviewed = await owner('POST', `/api/requests/${first.id}/approve`, {}, 200);
  assert.equal(reviewed.status, 'aprovada');
  let animals = await owner('GET', '/api/animals');
  assert.equal(
    animals.find((a) => a.id === animal.id).status,
    'em_processo',
    'aprovar não deve concluir adoção',
  );
  await owner('POST', `/api/requests/${first.id}/interview`, {}, 200);
  await owner('POST', '/api/requests/' + first.id + '/handover', { confirmed: true });
  await applicant('POST', '/api/requests/' + first.id + '/confirm-receipt', { confirmed: true });
  reviewed = await owner('POST', `/api/requests/${first.id}/complete`, {}, 200);
  assert.equal(reviewed.status, 'concluida');
  animals = await owner('GET', '/api/animals');
  assert.equal(animals.find((a) => a.id === animal.id).status, 'adotado');
  const otherRequests = await other('GET', '/api/requests');
  assert.equal(otherRequests.find((r) => r.id === second.id).status, 'cancelada');
  const contract = await applicant('GET', `/api/contracts/${first.id}`);
  assert.equal(contract.animalId, animal.id);

  const rejectedAnimal = await createAnimal(owner, 'Animal Reprovação');
  await admin(
    'PATCH',
    `/api/animals/${rejectedAnimal.id}`,
    {
      status: 'disponivel',
      approvalStatus: 'approved',
      reason: 'Revisão administrativa de fixture de teste.',
    },
    200,
  );
  const rejectedRequest = await applicant(
    'POST',
    '/api/requests',
    { ...requestBody, animalId: rejectedAnimal.id },
    201,
  );
  const rejected = await owner(
    'POST',
    `/api/requests/${rejectedRequest.id}/reject`,
    { reason: 'O perfil de rotina não atende às necessidades deste animal.' },
    200,
  );
  assert.equal(rejected.status, 'reprovada');
  assert.ok(rejected.rejectedBy && rejected.reviewedAt);
  assert.match(rejected.rejectionReason, /rotina/);

  const adminAnimal = await createAnimal(owner, 'Animal Administração');
  await admin(
    'PATCH',
    `/api/animals/${adminAnimal.id}`,
    {
      status: 'disponivel',
      approvalStatus: 'approved',
      reason: 'Revisão administrativa de fixture de teste.',
    },
    200,
  );
  const adminRequest = await other(
    'POST',
    '/api/requests',
    { ...requestBody, animalId: adminAnimal.id, full_name: 'Outro Usuário' },
    201,
  );
  const adminReviewed = await admin('POST', `/api/requests/${adminRequest.id}/analyze`, {}, 200);
  assert.equal(adminReviewed.status, 'em_analise');
  const stats = await admin('GET', '/api/stats');
  assert.ok(stats.completedAdoptions >= 1);
  console.log(
    'OK — autenticação, aprovação de ONG, publicação, permissões, análise, aprovação, reprovação, conclusão e termo.',
  );
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
