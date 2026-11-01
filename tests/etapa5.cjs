'use strict';
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  crypto = require('node:crypto');
const { spawn } = require('node:child_process'),
  { DatabaseSync } = require('node:sqlite'),
  { PDFDocument } = require('pdf-lib');
const root = path.resolve(__dirname, '..'),
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'appet-etapa5-')),
  base = 'http://127.0.0.1:3186';
let child;
const pass = (name) => console.log('OK etapa5 — ' + name),
  today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
async function start() {
  let output = '';
  child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      EMAIL_TRANSPORT: 'disabled',
      BACKUP_AUTO: '0',
      SEED_SAMPLE_DATA: '0',
      SEED_DEMO_ACCOUNTS: '1',
      HOST: '127.0.0.1',
      PORT: '3186',
      DATA_DIR: dataDir,
      ADMIN_EMAIL: 'admin@adotapet.com',
      ADMIN_PASSWORD: '',
      DONOR_EMAIL: 'ong@adotapet.com',
      DONOR_PASSWORD: '',
      ADMIN_RECOVERY_ID: '',
    },
  });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (d) => (output += d));
  for (let i = 0; !output.includes('PotyPet rodando'); i++) {
    if (i > 200 || child.exitCode !== null) throw Error(output);
    await new Promise((r) => setTimeout(r, 50));
  }
}
async function stop() {
  if (child?.exitCode === null) {
    const done = new Promise((r) => child.once('exit', r));
    child.kill();
    await done;
  }
}
function change(id, fn) {
  const db = new DatabaseSync(path.join(dataDir, 'adotapet.db'));
  try {
    const list = JSON.parse(
      db.prepare("SELECT value FROM app_state WHERE key='campaigns'").get().value,
    );
    fn(list.find((c) => c.id === id));
    db.prepare("UPDATE app_state SET value=? WHERE key='campaigns'").run(JSON.stringify(list));
  } finally {
    db.close();
  }
}
(async () => {
  try {
    await start();
    const f = await require('./etapa1-fixtures.cjs')({ base, dataDir }),
      { owner, other, admin, guest } = f.clients;
    const image = {
        name: 'foto-fixture.png',
        mime: 'image/png',
        base64: fs.readFileSync(path.join(root, 'img/animal1.png')).toString('base64'),
      },
      pdf = await PDFDocument.create();
    pdf.addPage([100, 100]);
    const doc = {
      name: 'documento-privado-fixture.pdf',
      mime: 'application/pdf',
      base64: Buffer.from(await pdf.save()).toString('base64'),
    };
    const draft = {
      kind: 'campaign',
      target: 'animal',
      title: 'Campanha fictícia da rodada cinco',
      beneficiaryName: 'Beneficiário fictício',
      description:
        'Fixture isolada para revisar finalidade, custos e recebimento sem criar anúncio de adoção.',
      category: 'tratamento',
      city: 'Apodi',
      state: 'RN',
      costs: 'Consulta simulada: cem reais. Medicamentos simulados: cinquenta reais.',
      organizer: 'Organizador declarado da fixture',
      contact: 'Contato público fictício',
      goalCents: 15000,
      raisedCents: 0,
      beneficiary: 'Recebedor fictício',
      pixKeyType: 'aleatoria',
      pixKey: '00000000-0000-0000-0000-000000000000',
      receiverRelation: 'responsavel',
      animalId: f.animals.pending.id,
      bankConfirmed: true,
    };
    const get = (id) => owner.call('GET', '/api/campaigns/' + id),
      pub = (id) =>
        guest.call('GET', '/api/campaigns').then((list) => list.find((c) => c.id === id));
    async function create() {
      return owner.call(
        'POST',
        '/api/campaigns',
        { ...draft, clientToken: crypto.randomUUID() },
        201,
      );
    }
    async function upload(c, file) {
      const result = await owner.call(
        'POST',
        '/api/campaigns/' + c.id + '/files',
        { ...file, revision: c.revision },
        201,
      );
      return { c: await get(c.id), file: result };
    }
    async function check(c, extra = {}) {
      const view = await admin.call('GET', '/api/campaigns/' + c.id);
      return admin.call(
        'POST',
        '/api/campaigns/' + c.id + '/checks',
        require('./campaign-review-fixture.cjs')(view, extra),
      );
    }
    async function approve(c, extra = {}, expected = 200) {
      return admin.call(
        'POST',
        '/api/campaigns/' + c.id + '/review',
        {
          revision: c.revision,
          decision: 'approve',
          summary:
            'Fixture: organizador, finalidade, custos, recebedor e arquivos comparados; alcance limitado à simulação.',
          publicSummaryConfirmed: true,
          ...extra,
        },
        expected,
      );
    }
    let c = await create(),
      result = await upload(c, image);
    c = result.c;
    const photo = result.file;
    result = await upload(c, doc);
    c = result.c;
    const document = result.file;
    result = await upload(c, { ...doc, name: 'excesso-fixture.pdf' });
    c = result.c;
    const excess = result.file;
    assert.equal(excess.technicalValidation, 'format_checked');
    assert.equal(excess.authenticity, 'not_automatically_verified');
    assert.equal(excess.sha256.length, 64);
    await guest.call('GET', '/api/campaigns/manage', undefined, 401);
    await other.call('GET', '/api/campaigns/' + c.id, undefined, 404);
    await owner.call('GET', '/api/campaigns/manage', undefined, 403);
    await other.call(
      'DELETE',
      '/api/campaign-files/' + excess.id,
      { revision: c.revision, reason: 'Tentativa indevida de retirada.' },
      404,
    );
    const download = async (client, id, status) => {
      const r = await fetch(base + '/api/campaign-files/' + id, {
        headers: { Cookie: client.cookie },
      });
      assert.equal(r.status, status);
      return r;
    };
    await download(guest, document.id, 401);
    await download(other, document.id, 404);
    assert.match(
      (await download(admin, document.id, 200)).headers.get('cache-control'),
      /no-store/,
    );
    await admin.call(
      'POST',
      '/api/campaigns/' + c.id + '/checks',
      require('./campaign-review-fixture.cjs')(c),
      409,
    );
    c = await owner.call('DELETE', '/api/campaign-files/' + excess.id, {
      revision: c.revision,
      reason: 'Arquivo duplicado sem necessidade para esta análise.',
    });
    await download(owner, excess.id, 404);
    const account = await admin.call('GET', '/api/campaigns/' + c.id);
    assert.equal(account.organizerAccount.id, f.users.owner.id);
    assert.equal(account.organizerAccount.email, f.users.owner.email);
    assert.equal((await get(c.id)).organizerAccount, undefined);
    pass(
      'permissões e privacidade de conta/documentos; validação de formato não comprova autenticidade; retirada de arquivo não utilizado',
    );
    c = await owner.call('PATCH', '/api/campaigns/' + c.id, {
      revision: c.revision,
      photoFileId: photo.id,
      photoConsent: true,
    });
    c = await owner.call('POST', '/api/campaigns/' + c.id + '/submit', { revision: c.revision });
    await approve(c, {}, 400);
    await owner.call(
      'POST',
      '/api/campaigns/' + c.id + '/checks',
      require('./campaign-review-fixture.cjs')(c),
      403,
    );
    await admin.call(
      'POST',
      '/api/campaigns/' + c.id + '/checks',
      require('./campaign-review-fixture.cjs')(c, { external: 'sim' }),
      400,
    );
    await admin.call(
      'POST',
      '/api/campaigns/' + c.id + '/checks',
      require('./campaign-review-fixture.cjs')(c, { scopes: ['inventado'] }),
      400,
    );
    await admin.call(
      'POST',
      '/api/campaigns/' + c.id + '/checks',
      require('./campaign-review-fixture.cjs')(c, { scopes: ['evidence'], fileIds: [] }),
      400,
    );
    c = await check(c, {
      scopes: ['identity'],
      fileIds: [],
      note: 'Fixture privada: conta comparada com o responsável declarado.',
    });
    await admin.call(
      'POST',
      '/api/campaigns/' + c.id + '/review',
      {
        revision: c.revision,
        decision: 'approve',
        summary: 'Fixture: análise ainda incompleta e sem conferência dos outros assuntos.',
        publicSummaryConfirmed: true,
      },
      400,
    );
    c = await check(c, { result: 'uncertain' });
    await admin.call(
      'POST',
      '/api/campaigns/' + c.id + '/review',
      {
        revision: c.revision,
        decision: 'approve',
        summary: 'Fixture: resultado não confirmado, não pode ser aprovado.',
        publicSummaryConfirmed: true,
      },
      400,
    );
    const privateSource =
      'Fonte privada fictícia: clinica-interna@example.test, consulta simulada sem comunicação real.';
    c = await check(c, {
      external: true,
      source: privateSource,
      note: 'Nota privada fictícia: cada assunto foi comparado na simulação. Sem confirmação bancária real.',
    });
    await admin.call(
      'POST',
      '/api/campaigns/' + c.id + '/review',
      {
        revision: c.revision,
        decision: 'approve',
        summary: 'Fixture pública indevida com contato pessoa@example.test e dados privados.',
        publicSummaryConfirmed: true,
      },
      400,
    );
    await admin.call(
      'POST',
      '/api/campaigns/' + c.id + '/review',
      {
        revision: c.revision,
        decision: 'approve',
        summary:
          'Fixture: organizador, custos, recebedor e arquivos comparados; sem garantia bancária.',
      },
      400,
    );
    c = await approve(c);
    let p = await pub(c.id);
    assert.equal(p.canDonate, true);
    assert.equal(p.bankConfirmed, false);
    assert.equal(p.totalsSource, 'manual');
    assert.equal(p.animalUrl, null);
    assert.equal(p.reviewedSubjects.length, 5);
    const publicJSON = JSON.stringify(p);
    for (const secret of [
      privateSource,
      f.users.owner.email,
      document.id,
      'Nota privada fictícia',
      'documento-privado-fixture.pdf',
    ])
      assert.ok(!publicJSON.includes(secret));
    assert.ok(c.checks.at(-1).actorId);
    assert.ok(c.checks.at(-1).at);
    assert.equal(c.decisions.at(-1).evidenceIds.length, 2);
    assert.equal(c.decisions.at(-1).proposedVersion.pixKey, draft.pixKey);
    pass(
      'aprovação exige conferências por assunto e resultado coerente; fonte, administrador, data e evidências ficam privados; resumo público filtrado',
    );
    await admin.call('PATCH', '/api/animals/' + draft.animalId, {
      approvalStatus: 'approved',
      status: 'adotado',
      reason: 'Fixture: situação de adoção independente da campanha.',
    });
    assert.equal((await pub(c.id)).canDonate, true);
    const before = (await pub(c.id)).raisedCents;
    await guest.call('POST', '/api/campaigns/' + c.id + '/pix', {
      revision: p.revision,
      amountCents: 250,
    });
    assert.equal((await pub(c.id)).raisedCents, before);
    const oldKey = p.pixKey,
      oldRevision = p.revision;
    for (const invalid of [
      { accountabilityDate: '2099-01-01' },
      { accountabilityDate: '2026-02-30' },
      { state: 'XX' },
      { raisedCents: 1.2 },
      { raisedCents: -1 },
      { raisedCents: 100000001 },
      { closeRequested: 'true' },
    ])
      await owner.call(
        'PATCH',
        '/api/campaigns/' + c.id,
        { revision: c.revision, ...invalid },
        400,
      );
    c = await owner.call('PATCH', '/api/campaigns/' + c.id, {
      revision: c.revision,
      pixKey: '11111111-1111-1111-1111-111111111111',
      raisedCents: 250,
    });
    await owner.call('POST', '/api/campaigns/' + c.id + '/submit', { revision: c.revision }, 400);
    c = await owner.call('PATCH', '/api/campaigns/' + c.id, {
      revision: c.revision,
      accountabilityDate: today,
      expenseDescription:
        'Fixture: cinquenta centavos de despesas declaradas e dois reais reservados.',
      progressNote: 'Fixture: dois reais e cinquenta declarados após apuração manual.',
    });
    c = await owner.call('POST', '/api/campaigns/' + c.id + '/submit', { revision: c.revision });
    assert.equal((await pub(c.id)).pixKey, oldKey);
    assert.equal((await pub(c.id)).raisedCents, 0);
    await guest.call('POST', '/api/campaigns/' + c.id + '/pix', {
      revision: oldRevision,
      amountCents: 250,
    });
    c = await admin.call('POST', '/api/campaigns/' + c.id + '/review', {
      revision: c.revision,
      decision: 'pause',
      reason: 'Fixture: conferir nova chave antes de retomar.',
      publicNote: 'Recebimento pausado para conferir a atualização do recebedor.',
    });
    await guest.call(
      'POST',
      '/api/campaigns/' + c.id + '/pix',
      { revision: oldRevision, amountCents: 250 },
      409,
    );
    c = await check(c);
    c = await approve(c);
    p = await pub(c.id);
    assert.equal(p.pixKey, '');
    assert.equal(p.raisedCents, 250);
    assert.equal(p.lastAccountabilityDate, today);
    assert.equal(p.updates.at(-1).expenses, c.approved.expenseDescription);
    c = await admin.call('POST', '/api/campaigns/' + c.id + '/review', {
      revision: c.revision,
      decision: 'resume',
    });
    p = await pub(c.id);
    assert.equal(p.pixKey, '11111111-1111-1111-1111-111111111111');
    await guest.call(
      'POST',
      '/api/campaigns/' + c.id + '/pix',
      { revision: oldRevision, amountCents: 250 },
      409,
    );
    const payload = await guest.call('POST', '/api/campaigns/' + c.id + '/pix', {
      revision: p.revision,
      amountCents: 250,
    });
    assert.ok(payload.payload.includes(p.pixKey));
    assert.equal((await pub(c.id)).raisedCents, 250);
    pass(
      'campanha independente da adoção; nova chave e total ficam pendentes; aprovação não reativa pausa; Pix exige versão vigente e não altera arrecadação',
    );
    c = await owner.call('PATCH', '/api/campaigns/' + c.id, {
      revision: c.revision,
      closeRequested: true,
    });
    await owner.call('POST', '/api/campaigns/' + c.id + '/submit', { revision: c.revision }, 400);
    c = await owner.call('PATCH', '/api/campaigns/' + c.id, {
      revision: c.revision,
      accountabilityDate: today,
      expenseDescription: 'Fixture: cinquenta centavos gastos, dois reais sem uso devolvidos.',
      progressNote: 'Fixture: saldo final zero após devolução declarada pelo organizador.',
    });
    c = await owner.call('POST', '/api/campaigns/' + c.id + '/submit', { revision: c.revision });
    c = await check(c);
    c = await approve(c);
    p = await pub(c.id);
    assert.equal(p.status, 'closed');
    assert.ok(p.closedAt);
    assert.ok(p.closureSummary);
    await guest.call(
      'POST',
      '/api/campaigns/' + c.id + '/pix',
      { revision: p.revision, amountCents: 1 },
      409,
    );
    await admin.call(
      'POST',
      '/api/campaigns/' + c.id + '/review',
      { revision: c.revision, decision: 'resume' },
      409,
    );
    await owner.call(
      'PATCH',
      '/api/campaigns/' + c.id,
      { revision: c.revision, pixKey: draft.pixKey },
      409,
    );
    await owner.call(
      'PATCH',
      '/api/campaigns/' + c.id,
      { revision: c.revision, title: 'Reabrir financiamento' },
      409,
    );
    c = await owner.call('PATCH', '/api/campaigns/' + c.id, {
      revision: c.revision,
      raisedCents: 300,
      accountabilityDate: today,
      expenseDescription: 'Fixture: retificação das despesas e devolução do saldo declarados.',
      progressNote: 'Fixture: total declarado corrigido para três reais.',
    });
    c = await owner.call('POST', '/api/campaigns/' + c.id + '/submit', { revision: c.revision });
    c = await check(c);
    c = await approve(c);
    assert.equal((await pub(c.id)).status, 'closed');
    assert.equal((await pub(c.id)).raisedCents, 300);
    pass(
      'encerramento datado, com prestação de contas; retificação financeira não reabre campanha e nunca libera Pix',
    );
    await owner.call(
      'DELETE',
      '/api/campaign-files/' + photo.id,
      { revision: c.revision, reason: 'A capa atual deve ser preservada até outra versão.' },
      409,
    );
    c = await owner.call('DELETE', '/api/campaign-files/' + document.id, {
      revision: c.revision,
      reason: 'Retirar documento antigo de futuras análises e corrigir o orçamento.',
    });
    assert.ok(c.files.find((f) => f.id === document.id).withdrawnAt);
    assert.equal(c.files.find((f) => f.id === document.id).retained, true);
    await download(owner, document.id, 200);
    await download(other, document.id, 404);
    c = await owner.call('PATCH', '/api/campaigns/' + c.id, {
      revision: c.revision,
      accountabilityDate: today,
      expenseDescription: 'Fixture: despesas retificadas sem alteração no total declarado.',
      progressNote: 'Fixture: saldo conferido na simulação.',
    });
    await owner.call('POST', '/api/campaigns/' + c.id + '/submit', { revision: c.revision }, 400);
    result = await upload(c, { ...doc, name: 'orcamento-corrigido-fixture.pdf' });
    c = result.c;
    c = await owner.call('POST', '/api/campaigns/' + c.id + '/submit', { revision: c.revision });
    c = await check(c);
    c = await approve(c);
    assert.ok(!c.decisions.at(-1).evidenceIds.includes(document.id));
    assert.ok(c.retainedEvidenceIds.includes(document.id));
    pass(
      'retirada de evidência usada preserva arquivo e decisões; correção exige novo arquivo ativo e nova revisão',
    );
    let abandoned = await create();
    result = await upload(abandoned, doc);
    abandoned = result.c;
    const abandonedFile = result.file.id;
    change(abandoned.id, (c) => (c.updatedAt = new Date(Date.now() - 91 * 86400000).toISOString()));
    await guest.call('GET', '/api/campaigns');
    abandoned = await get(abandoned.id);
    assert.equal(abandoned.status, 'archived');
    assert.equal(abandoned.history.filter((h) => h.action === 'archive').length, 1);
    await download(owner, abandonedFile, 200);
    await owner.call(
      'PATCH',
      '/api/campaigns/' + abandoned.id,
      { revision: abandoned.revision, title: 'Editar sem restaurar' },
      409,
    );
    abandoned = await owner.call('POST', '/api/campaigns/' + abandoned.id + '/restore', {
      revision: abandoned.revision,
    });
    assert.equal(abandoned.status, 'draft');
    await owner.call('POST', '/api/campaigns/' + c.id + '/archive', { revision: c.revision }, 409);
    const race = await Promise.all([
      owner
        .call(
          'POST',
          '/api/campaigns/' + abandoned.id + '/files',
          { ...doc, revision: abandoned.revision },
          201,
        )
        .then(() => 201)
        .catch((e) => Number(e.message.match(/: (\d{3}) /)?.[1])),
      owner
        .call(
          'POST',
          '/api/campaigns/' + abandoned.id + '/files',
          { ...doc, revision: abandoned.revision },
          201,
        )
        .then(() => 201)
        .catch((e) => Number(e.message.match(/: (\d{3}) /)?.[1])),
    ]);
    assert.deepEqual(race.sort(), [201, 409]);
    pass(
      'rascunho inativo arquivado sem apagar documentos, restauração autorizada e conflito de uploads concorrentes',
    );
    let stale = await create();
    result = await upload(stale, image);
    stale = result.c;
    result = await upload(stale, doc);
    stale = result.c;
    stale = await owner.call('POST', '/api/campaigns/' + stale.id + '/submit', {
      revision: stale.revision,
    });
    stale = await check(stale);
    stale = await approve(stale);
    change(
      stale.id,
      (c) => (c.firstPublishedAt = new Date(Date.now() - 31 * 86400000).toISOString()),
    );
    let warning = await pub(stale.id);
    assert.equal(warning.canDonate, true);
    assert.equal(warning.needsAccountability, true);
    change(
      stale.id,
      (c) => (c.firstPublishedAt = new Date(Date.now() - 61 * 86400000).toISOString()),
    );
    await guest.call(
      'POST',
      '/api/campaigns/' + stale.id + '/pix',
      { revision: warning.revision, amountCents: 1 },
      409,
    );
    stale = await get(stale.id);
    assert.equal(stale.liveState, 'paused');
    await admin.call(
      'POST',
      '/api/campaigns/' + stale.id + '/review',
      { revision: stale.revision, decision: 'resume' },
      409,
    );
    await guest.call('GET', '/api/campaigns');
    assert.equal((await get(stale.id)).history.filter((h) => h.action === 'stale_pause').length, 1);
    pass(
      '30 dias exigem atualização; 60 dias pausam Pix no servidor, sem apagar histórico nem permitir reativação sem contas recentes',
    );
    const stored = await admin.call('GET', '/api/campaigns/' + c.id),
      originalFiles = stored.files;
    assert.ok(stored.decisions.length >= 4);
    await stop();
    await start();
    const restarted = await admin.call('GET', '/api/campaigns/' + c.id);
    assert.deepEqual(restarted.decisions, stored.decisions);
    assert.deepEqual(restarted.files, originalFiles);
    assert.equal((await pub(c.id)).raisedCents, 300);
    assert.equal((await get(stale.id)).liveState, 'paused');
    await download(owner, document.id, 200);
    pass(
      'reinício e migração aditiva preservam decisões, evidências retiradas, valores, vínculos e encerramento',
    );
    let emergency = await create();
    result = await upload(emergency, image);
    emergency = result.c;
    result = await upload(emergency, doc);
    emergency = result.c;
    emergency = await owner.call('POST', '/api/campaigns/' + emergency.id + '/submit', {
      revision: emergency.revision,
    });
    emergency = await check(emergency);
    emergency = await approve(emergency);
    emergency = await owner.call('PATCH', '/api/campaigns/' + emergency.id, {
      revision: emergency.revision,
      pixKey: '22222222-2222-2222-2222-222222222222',
      goalCents: 99999,
    });
    emergency = await owner.call('POST', '/api/campaigns/' + emergency.id + '/submit', {
      revision: emergency.revision,
    });
    emergency = await check(emergency, {
      result: 'inconsistent',
      note: 'Fixture: divergência na nova proposta; encerramento administrativo necessário.',
    });
    emergency = await admin.call('POST', '/api/campaigns/' + emergency.id + '/review', {
      revision: emergency.revision,
      decision: 'close',
      reason: 'Fixture: divergência no recebedor proposto.',
      publicNote: 'Recebimento encerrado após divergência na proposta de atualização.',
    });
    assert.equal(emergency.draft.pixKey, draft.pixKey);
    assert.equal(
      emergency.decisions.at(-1).proposedVersion.pixKey,
      '22222222-2222-2222-2222-222222222222',
    );
    emergency = await owner.call('PATCH', '/api/campaigns/' + emergency.id, {
      revision: emergency.revision,
      raisedCents: 100,
      accountabilityDate: today,
      expenseDescription: 'Fixture: nenhuma despesa, saldo retificado em prestação de contas.',
      progressNote: 'Fixture: um real declarado manualmente após encerramento.',
    });
    emergency = await owner.call('POST', '/api/campaigns/' + emergency.id + '/submit', {
      revision: emergency.revision,
    });
    emergency = await check(emergency);
    emergency = await approve(emergency);
    assert.equal(emergency.approved.pixKey, draft.pixKey);
    assert.equal((await pub(emergency.id)).goalCents, draft.goalCents);
    assert.equal((await pub(emergency.id)).status, 'closed');
    pass(
      'encerramento durante proposta pendente conserva versão aprovada e arquiva proposta divergente; contas posteriores não publicam a chave recusada',
    );
  } finally {
    await stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
