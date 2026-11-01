'use strict';
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { spawn } = require('node:child_process'),
  { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..'),
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'appet-etapa2-')),
  base = 'http://127.0.0.1:3183';
let child;
const pass = (name) => console.log('OK etapa2 — ' + name);
async function start() {
  let log = '';
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
      COOKIE_SECURE: '0',
      TRUST_PROXY: '0',
      HOST: '127.0.0.1',
      PORT: '3183',
      DATA_DIR: dataDir,
      ADMIN_EMAIL: 'admin@adotapet.com',
      ADMIN_PASSWORD: '',
      DONOR_EMAIL: 'ong@adotapet.com',
      DONOR_PASSWORD: '',
      ADMIN_RECOVERY_ID: '',
    },
  });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (d) => (log += d));
  for (let i = 0; !log.includes('PotyPet rodando'); i++) {
    if (i > 200 || child.exitCode !== null) throw Error(log);
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
(async () => {
  try {
    await start();
    const f = await require('./etapa1-fixtures.cjs')({ base, dataDir }),
      { admin, owner, other, guest } = f.clients;
    const body = {
      name: 'Animal etapa2',
      city: 'Apodi',
      state: 'RN',
      description: 'Animal fictício para revisão.',
      photos: ['img/animal1.png'],
    };
    const adoption = (id) =>
      require('./adoption-fixture.cjs')({ animalId: id, responsibility_confirmed: true });
    const approve = (id) =>
      admin.call('PATCH', '/api/animals/' + id, {
        approvalStatus: 'approved',
        reason: 'Fotos e informações conferidas na fixture local.',
      });
    const org = f.client('ONG');
    await org.call('POST', '/api/auth/login', {
      email: 'etapa1-org-approved@example.test',
      password: 'TesteSeguro9',
    });
    const orgId = f.users.organizations.approved.id,
      orgAnimal = await org.call('POST', '/api/animals', body, 201);
    await approve(orgAnimal.id);
    const existing = await other.call('POST', '/api/requests', adoption(orgAnimal.id), 201);
    assert.ok((await guest.call('GET', '/api/animals')).some((a) => a.id === orgAnimal.id));
    await admin.call('POST', '/api/users/' + orgId + '/suspend', {
      reason: 'Suspensão de teste para proteger o fluxo.',
    });
    assert.ok(!(await guest.call('GET', '/api/animals')).some((a) => a.id === orgAnimal.id));
    assert.ok(!(await guest.call('GET', '/api/organizations')).some((o) => o.id === orgId));
    assert.equal(
      (await admin.call('GET', '/api/animals')).find((a) => a.id === orgAnimal.id).publicEligible,
      false,
    );
    assert.equal(
      (await other.call('GET', '/api/requests')).find((r) => r.id === existing.id).status,
      'pendente',
    );
    await other.call('POST', '/api/requests', adoption(orgAnimal.id), 409);
    await org.call('POST', '/api/animals', body, 401);
    const limited = await org.call('POST', '/api/auth/login', {
      email: 'etapa1-org-approved@example.test',
      password: 'TesteSeguro9',
    });
    assert.equal(limited.user.historicalAccess, true);
    assert.ok((await org.call('GET', '/api/requests')).some((r) => r.id === existing.id));
    await org.call('POST', '/api/animals', body, 403);
    await org.call('POST', '/api/requests', adoption(f.animals.approved.id), 403);
    await admin.call('POST', '/api/requests/' + existing.id + '/analyze', {});
    await admin.call('POST', '/api/requests/' + existing.id + '/reject', {
      reason: 'Tratamento administrativo mantido durante suspensão.',
    });
    await admin.call('POST', '/api/users/' + orgId + '/approve', {});
    assert.ok((await guest.call('GET', '/api/animals')).some((a) => a.id === orgAnimal.id));
    await admin.call('POST', '/api/users/' + orgId + '/reject', { reason: 'Reprovação de teste.' });
    assert.ok(!(await guest.call('GET', '/api/animals')).some((a) => a.id === orgAnimal.id));
    await other.call('POST', '/api/requests', adoption(orgAnimal.id), 409);
    pass(
      'ONG suspensa ou reprovada perde vitrines e novos pedidos; sessões revogadas e pedidos existentes preservados para administração',
    );

    const stranger = f.client('Terceiro');
    await stranger.call(
      'POST',
      '/api/auth/register',
      {
        name: 'Terceiro QA',
        email: 'etapa2-terceiro@example.test',
        password: 'TesteSeguro9',
        passwordConfirmation: 'TesteSeguro9',
        accountType: 'usuario',
        city: 'Apodi',
        state: 'RN',
        phone: '84999999999',
        termsAccepted: true,
      },
      201,
    );
    const completed = await other.call(
      'POST',
      '/api/requests',
      adoption(f.animals.ordinary.id),
      201,
    );
    await owner.call('POST', '/api/requests/' + completed.id + '/approve', {});
    await owner.call('POST', '/api/requests/' + completed.id + '/handover', { confirmed: true });
    await other.call('POST', '/api/requests/' + completed.id + '/confirm-receipt', {
      confirmed: true,
    });
    await owner.call('POST', '/api/requests/' + completed.id + '/complete', {});
    const db = new DatabaseSync(path.join(dataDir, 'adotapet.db'));
    try {
      const rows = JSON.parse(
        db.prepare("SELECT value FROM app_state WHERE key='requests'").get().value,
      );
      const r = rows.find((r) => r.id === completed.id);
      r.completedAt = r.acceptedAt = new Date(Date.now() - 100 * 86400000).toISOString();
      db.prepare("UPDATE app_state SET value=? WHERE key='requests'").run(JSON.stringify(rows));
    } finally {
      db.close();
    }
    const follow = await other.call(
      'POST',
      '/api/followups',
      {
        requestId: completed.id,
        day: 7,
        adaptation: 'boa',
        health: 'Saúde preservada.',
        behavior: 'Adaptação tranquila.',
        needsHelp: false,
      },
      201,
    );
    assert.equal(
      (await owner.call('GET', '/api/requests')).find((r) => r.id === completed.id).requester
        .termsVersion,
      undefined,
    );
    const contract = await other.call('GET', '/api/contracts/' + completed.id),
      requestBefore = (await other.call('GET', '/api/requests')).find((r) => r.id === completed.id);
    await owner.call('DELETE', '/api/animals/' + f.animals.ordinary.id);
    assert.ok(
      !(await guest.call('GET', '/api/animals')).some((a) => a.id === f.animals.ordinary.id),
    );
    for (const c of [owner, other, admin])
      assert.ok(
        (await c.call('GET', '/api/animals')).find((a) => a.id === f.animals.ordinary.id)
          .archivedAt,
      );
    assert.ok(
      !(await stranger.call('GET', '/api/animals')).some((a) => a.id === f.animals.ordinary.id),
    );
    await guest.call(
      'GET',
      '/api/animals/' + f.animals.ordinary.id + '/public-name',
      undefined,
      404,
    );
    assert.deepEqual(await other.call('GET', '/api/contracts/' + completed.id), contract);
    assert.deepEqual(await owner.call('GET', '/api/contracts/' + completed.id), contract);
    await stranger.call('GET', '/api/contracts/' + completed.id, undefined, 403);
    assert.deepEqual(
      (await other.call('GET', '/api/requests')).find((r) => r.id === completed.id),
      requestBefore,
    );
    assert.deepEqual(
      (await owner.call('GET', '/api/followups')).find((r) => r.id === follow.id),
      follow,
    );
    await other.call(
      'POST',
      '/api/followups',
      {
        requestId: completed.id,
        day: 30,
        adaptation: 'otima',
        health: 'Seguimento após arquivo.',
        behavior: 'Vínculo preservado.',
        needsHelp: false,
      },
      201,
    );
    await owner.call(
      'PATCH',
      '/api/animals/' + f.animals.ordinary.id,
      { name: 'Não pode reescrever arquivo' },
      409,
    );
    await admin.call('DELETE', '/api/users/' + f.users.other.id, undefined, 409);
    assert.equal((await guest.call('GET', '/api/stats')).completedAdoptions, 1);
    pass(
      'arquivamento preserva animal, solicitação concluída, contrato e acompanhamentos; partes mantêm acesso e terceiros são bloqueados',
    );

    const withdrew = await other.call(
      'POST',
      '/api/requests',
      adoption(f.animals.approved.id),
      201,
    );
    await stranger.call('POST', '/api/requests', adoption(f.animals.approved.id), 201);
    await stranger.call(
      'POST',
      '/api/animals/' + f.animals.approved.id + '/withdraw',
      { confirmed: true },
      403,
    );
    await owner.call(
      'POST',
      '/api/animals/' + f.animals.approved.id + '/withdraw',
      { confirmed: false },
      400,
    );
    const withdrawal = await owner.call(
      'POST',
      '/api/animals/' + f.animals.approved.id + '/withdraw',
      { confirmed: true, reason: 'Mudança de disponibilidade.' },
    );
    assert.equal(withdrawal.closedRequests, 2);
    assert.equal(
      (await other.call('GET', '/api/requests')).find((r) => r.id === withdrew.id).status,
      'cancelada',
    );
    await other.call('POST', '/api/requests', adoption(f.animals.approved.id), 409);
    const external = await owner.call(
      'POST',
      '/api/animals',
      { ...body, name: 'Adoção externa QA' },
      201,
    );
    await approve(external.id);
    const extRequest = await other.call('POST', '/api/requests', adoption(external.id), 201);
    const beforeStats = await guest.call('GET', '/api/stats');
    const ext = await owner.call('POST', '/api/animals/' + external.id + '/external-adoption', {
      confirmed: true,
      reason: 'Família encontrada fora do site.',
    });
    assert.equal(ext.animal.adoptionOrigin, 'external');
    assert.equal(
      (await guest.call('GET', '/api/stats')).completedAdoptions,
      beforeStats.completedAdoptions,
    );
    assert.equal(
      (await other.call('GET', '/api/requests')).find((r) => r.id === extRequest.id).status,
      'cancelada',
    );
    await other.call('GET', '/api/contracts/' + extRequest.id, undefined, 404);
    await owner.call(
      'POST',
      '/api/animals/' + external.id + '/external-adoption',
      { confirmed: true },
      409,
    );
    const archivedActive = await owner.call(
      'POST',
      '/api/animals',
      { ...body, name: 'Arquivo de pedido pendente' },
      201,
    );
    await approve(archivedActive.id);
    const pending = await other.call('POST', '/api/requests', adoption(archivedActive.id), 201);
    await owner.call('DELETE', '/api/animals/' + archivedActive.id);
    assert.equal(
      (await other.call('GET', '/api/requests')).find((r) => r.id === pending.id).status,
      'cancelada',
    );
    assert.ok(
      (await other.call('GET', '/api/animals')).find((a) => a.id === archivedActive.id).archivedAt,
    );
    pass(
      'retirada, arquivo e adoção externa encerram e avisam interessados ativos sem apagar vínculos nem inflar conclusões do PotyPet',
    );

    const missingBody = {
      name: 'Desaparecido QA',
      city: 'Apodi',
      state: 'RN',
      missing_date: '2026-10-01',
      species: 'gato',
      contact: 'Contato público de teste',
    };
    const missing = await owner.call('POST', '/api/missing', missingBody, 201);
    const sightingReceipt = await guest.call(
      'POST',
      '/api/sightings',
      {
        missingAnimalId: missing.id,
        location: 'Praça de teste',
        reporter_name: 'Pessoa QA',
        reporter_contact: 'Contato restrito',
        message: 'Avistamento válido.',
      },
      201,
    );
    const sighting = (await owner.call('GET', '/api/sightings')).find(
      (s) => s.id === sightingReceipt.id,
    );
    assert.equal(sighting.reporter_contact, 'Contato restrito');
    const report = await guest.call(
      'POST',
      '/api/reports',
      {
        target_type: 'missing',
        target_id: missing.id,
        category: 'informacao_falsa',
        reason: 'Denúncia fictícia para testar o fluxo.',
      },
      201,
    );
    assert.ok((await admin.call('GET', '/api/reports')).some((r) => r.id === report.id));
    await other.call(
      'POST',
      '/api/missing/' + missing.id + '/hide',
      { reason: 'Sem permissão' },
      403,
    );
    await admin.call('POST', '/api/missing/' + missing.id + '/hide', { reason: '' }, 400);
    const hidden = await admin.call('POST', '/api/missing/' + missing.id + '/hide', {
      reason: 'Informação indevida constatada no teste.',
    });
    assert.equal(hidden.hiddenBy, 1);
    assert.ok(hidden.hiddenAt);
    assert.equal(hidden.moderationHistory[0].reason, 'Informação indevida constatada no teste.');
    assert.ok(!(await guest.call('GET', '/api/missing')).some((m) => m.id === missing.id));
    assert.equal((await guest.call('GET', '/api/stats')).missing, 0);
    await guest.call(
      'POST',
      '/api/sightings',
      { missingAnimalId: missing.id, location: 'Praça' },
      404,
    );
    const corrected = await owner.call('PATCH', '/api/missing/' + missing.id, {
      name: 'Nome corrigido',
      state: 'rn',
      city: 'Mossoró',
    });
    assert.ok(corrected.hiddenAt);
    assert.equal(corrected.state, 'RN');
    assert.ok(!(await guest.call('GET', '/api/missing')).some((m) => m.id === missing.id));
    assert.deepEqual(
      (await owner.call('GET', '/api/sightings')).find((s) => s.id === sighting.id),
      sighting,
    );
    await other.call('PATCH', '/api/missing/' + missing.id, { name: 'Ataque' }, 403);
    await admin.call('POST', '/api/missing/' + missing.id + '/restore', {
      reason: 'Correções verificadas pela administração.',
    });
    assert.equal(
      (await guest.call('GET', '/api/missing')).find((m) => m.id === missing.id).name,
      'Nome corrigido',
    );
    assert.equal((await guest.call('GET', '/api/stats')).missing, 1);
    pass(
      'denúncia, ocultação e restauração de desaparecido registram decisão; correção do autor mantém ocultação e avistamentos privados',
    );

    const badAnimals = [
      { state: 'XX' },
      { state: 'Rio Grande do Norte' },
      { species: 'cobra' },
      { sex: 'outro' },
      { size: 'gigante' },
      { age_group: 'desconhecida' },
      { neutered: 'false' },
      { vaccinated: 1 },
      { energy_level: 'extrema' },
      { personality: { energy: 6 } },
      { coexistence: { kids: 'talvez' } },
      { name: 'x'.repeat(121) },
      { description: 'x'.repeat(2001) },
    ];
    for (const bad of badAnimals)
      await owner.call('POST', '/api/animals', { ...body, ...bad }, 400);
    for (const bad of [
      { state: 'XX' },
      { found: 'false' },
      { missing_date: '2026-02-30' },
      { missing_date: '2099-01-01' },
      { missing_date: '10/01/2026' },
      { contact: 'x'.repeat(121) },
      { species: 'ave' },
    ])
      await owner.call('PATCH', '/api/missing/' + missing.id, bad, 400);
    await admin.call('PATCH', '/api/animals/' + external.id, { featured: 'false' }, 400);
    await admin.call('PATCH', '/api/animals/' + external.id, { status: 'qualquer' }, 400);
    await other.call(
      'POST',
      '/api/followups',
      {
        requestId: completed.id,
        day: 90,
        adaptation: 'boa',
        health: 'Válida',
        behavior: 'Válido',
        needsHelp: 'false',
      },
      400,
    );
    await other.call('POST', '/api/adoption-profile', { housing: 'castelo' }, 400);
    await other.call(
      'POST',
      '/api/requests',
      { ...adoption(f.animals.approved.id), animalId: true },
      400,
    );
    await guest.call(
      'POST',
      '/api/sightings',
      { missingAnimalId: true, location: 'Praça de teste' },
      400,
    );
    await owner.call(
      'PATCH',
      '/api/users/me',
      { name: 'Nome QA', city: 'Apodi', state: 'XX', phone: '84999999999' },
      400,
    );
    await guest.call(
      'POST',
      '/api/reports',
      { target_type: 'missing', target_id: String(missing.id), category: 'spam', reason: 'Teste' },
      400,
    );
    await guest.call(
      'POST',
      '/api/reports',
      { target_type: 'outro', category: 'inventada', reason: 'Teste' },
      400,
    );
    await admin.call('POST', '/api/users/' + orgId + '/approve', {});
    await org.call('POST', '/api/auth/login', {
      email: 'etapa1-org-approved@example.test',
      password: 'TesteSeguro9',
    });
    await org.call(
      'PUT',
      '/api/organizations/me',
      {
        city: 'Apodi',
        state: 'XX',
        description: 'Descrição válida com mais de vinte caracteres.',
        area: 'QA',
        contact: '',
        contactConsent: false,
      },
      400,
    );
    await org.call(
      'PUT',
      '/api/organizations/me',
      {
        city: 'Apodi',
        state: 'RN',
        description: 'Descrição válida com mais de vinte caracteres.',
        area: 'QA',
        contact: '',
        contactConsent: 'false',
      },
      400,
    );
    await owner.call(
      'POST',
      '/api/campaigns',
      { clientToken: require('node:crypto').randomUUID(), state: 'XX' },
      400,
    );
    pass(
      'UF, datas existentes sem futuro, booleanos estritos, opções, personalidade e limites rejeitados no servidor sem coerção silenciosa',
    );

    const review = await owner.call(
      'POST',
      '/api/animals',
      { ...body, name: 'Revisão com justificativa' },
      201,
    );
    await admin.call('PATCH', '/api/animals/' + review.id, { approvalStatus: 'rejected' }, 400);
    const rejected = await admin.call('PATCH', '/api/animals/' + review.id, {
      approvalStatus: 'rejected',
      reason: 'Fotos e descrição precisam de correção.',
    });
    assert.equal(rejected.reviewedBy, 1);
    assert.ok(rejected.reviewedAt);
    assert.equal(rejected.moderationHistory[0].reason, 'Fotos e descrição precisam de correção.');
    assert.ok(
      (await owner.call('GET', '/api/notifications')).some((n) =>
        n.message.includes('Revisão com justificativa'),
      ),
    );
    await approve(review.id);
    const publicReview = (await guest.call('GET', '/api/animals')).find((a) => a.id === review.id);
    assert.equal(publicReview.moderationHistory, undefined);
    assert.equal(publicReview.moderationReason, undefined);
    assert.equal(
      (await owner.call('GET', '/api/animals')).find((a) => a.id === review.id).moderationHistory
        .length,
      2,
    );
    const legacyReview = await admin.call('PATCH', '/api/animals/' + review.id, {
      status: 'aguardando_aprovacao',
    });
    assert.equal(legacyReview.approvalStatus, 'pending');
    assert.ok(legacyReview.moderationHistory.at(-1).reason.includes('compatibilidade'));
    await approve(review.id);
    const contactMessage = 'Mensagem de atendimento '.repeat(150) + 'FIM-DA-MENSAGEM';
    assert.ok(contactMessage.length > 3000 && contactMessage.length < 5000);
    const contact = await guest.call(
      'POST',
      '/api/contact',
      { name: 'Pessoa de contato', email: 'contato@example.test', message: contactMessage },
      201,
    );
    assert.match(contact.protocol, /^APPET-\d+$/);
    const stored = (await admin.call('GET', '/api/reports')).find(
      (r) => 'APPET-' + r.id === contact.protocol,
    );
    assert.equal(stored.reason, contactMessage);
    assert.equal(stored.contactEmail, 'contato@example.test');
    await guest.call('GET', '/api/reports', undefined, 401);
    await guest.call(
      'POST',
      '/api/contact',
      { name: 'Pessoa QA', email: 'contato@example.test', message: 'x'.repeat(5001) },
      400,
    );
    await guest.call(
      'POST',
      '/api/contact',
      { name: 'Pessoa QA', email: 'inválido', message: 'Teste de contato' },
      400,
    );
    pass(
      'revisão registra administrador/data/justificativa e notifica autor; atendimento mantém mensagem acima de 3000 caracteres inteira com protocolo',
    );

    await other.call('POST', '/api/requests/' + completed.id + '/story', {
      story: 'História inicialmente privada.',
    });
    assert.ok(!(await guest.call('GET', '/api/stories')).some((s) => s.id === completed.id));
    await other.call('POST', '/api/requests/' + completed.id + '/story', {
      story: 'História autorizada.',
      publish: true,
      displayName: 'Família QA',
    });
    const story = (await guest.call('GET', '/api/stories')).find((s) => s.id === completed.id);
    assert.equal(story.full_name, 'Família QA');
    assert.equal(story.animalName, 'Animal adotado');
    assert.equal(story.photo, '');
    await other.call('POST', '/api/requests/' + completed.id + '/story', {
      story: 'História retirada do público.',
      publish: false,
    });
    assert.ok(!(await guest.call('GET', '/api/stories')).some((s) => s.id === completed.id));
    const me = await other.call('GET', '/api/auth/me');
    assert.equal(me.user.termsVersion, '2026-10-13-potypet-rc6-revisao');
    assert.ok(me.user.termsAcceptedAt);
    assert.equal((await admin.call('GET', '/api/auth/me')).user.termsVersion, null);
    for (const page of ['termos.html', 'privacidade.html']) {
      const response = await fetch(base + '/' + page);
      assert.equal(response.status, 200);
      assert.ok((await response.text()).includes('formulário de contato'));
    }
    const legacyDb = new DatabaseSync(path.join(dataDir, 'adotapet.db'));
    try {
      for (const [key, record] of [
        [
          'requests',
          { ...requestBefore, id: 9001, animalId: 9001, animalName: 'Animal histórico anterior' },
        ],
        [
          'contracts',
          {
            ...contract,
            id: 9001,
            requestId: 9001,
            animalId: 9001,
            animalName: 'Animal histórico anterior',
            code: 'ADT-9001-QA',
          },
        ],
        ['followups', { ...follow, id: 9001, requestId: 9001, animalId: 9001 }],
      ]) {
        const items = JSON.parse(
          legacyDb.prepare('SELECT value FROM app_state WHERE key=?').get(key).value,
        );
        items.push(record);
        legacyDb
          .prepare('UPDATE app_state SET value=? WHERE key=?')
          .run(JSON.stringify(items), key);
      }
    } finally {
      legacyDb.close();
    }
    assert.ok((await owner.call('GET', '/api/requests')).some((r) => r.id === 9001));
    assert.equal(
      (await owner.call('GET', '/api/contracts/9001')).animalName,
      'Animal histórico anterior',
    );
    assert.ok((await owner.call('GET', '/api/followups')).some((f) => f.id === 9001));
    assert.ok(!(await stranger.call('GET', '/api/requests')).some((r) => r.id === 9001));
    await stop();
    await start();
    assert.deepEqual(await other.call('GET', '/api/contracts/' + completed.id), contract);
    assert.ok(
      (await owner.call('GET', '/api/animals')).find((a) => a.id === f.animals.ordinary.id)
        .archivedAt,
    );
    assert.equal((await owner.call('GET', '/api/sightings')).length, 1);
    pass(
      'histórias exigem escolha explícita de publicação; aceite versionado sem retroatividade e reinício preserva histórico e vínculos',
    );
  } finally {
    await stop();
    assert.ok(dataDir.startsWith(os.tmpdir() + path.sep));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
