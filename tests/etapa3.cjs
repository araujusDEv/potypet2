'use strict';
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  crypto = require('node:crypto');
const { spawn } = require('node:child_process'),
  { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..'),
  base = 'http://127.0.0.1:3184',
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'appet-etapa3-')),
  queueKey = crypto.randomBytes(32);
let child;
const passed = [];
function pass(name) {
  passed.push(name);
  console.log('OK etapa3 — ' + name);
}
async function start() {
  let log = '';
  child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      EMAIL_TRANSPORT: 'file',
      MAIL_FROM: 'appet@example.test',
      MAIL_QUEUE_KEY: queueKey.toString('base64'),
      PUBLIC_BASE_URL: base,
      BACKUP_AUTO: '0',
      SEED_SAMPLE_DATA: '0',
      SEED_DEMO_ACCOUNTS: '1',
      COOKIE_SECURE: '0',
      HOST: '127.0.0.1',
      PORT: '3184',
      DATA_DIR: dataDir,
      ADMIN_EMAIL: 'admin@adotapet.com',
      ADMIN_PASSWORD: '',
      DONOR_EMAIL: 'ong@adotapet.com',
      DONOR_PASSWORD: '',
      ADMIN_RECOVERY_ID: '',
    },
  });
  for (const s of [child.stdout, child.stderr]) s.on('data', (d) => (log += d));
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
    const f = await require('./etapa1-fixtures.cjs')({ base, dataDir, email: true }),
      { owner, other, admin, guest } = f.clients;
    assert.notEqual(f.users.owner.id, f.users.other.id);
    assert.equal((await other.call('GET', '/api/auth/me')).user.emailVerified, true);
    const adoption = (id) =>
      require('./adoption-fixture.cjs')({
        animalId: id,
        responsibility_confirmed: true,
        contactConsent: false,
        clientToken: crypto.randomUUID(),
      });
    const before = await guest.call('GET', '/api/stats'),
      body = adoption(f.animals.approved.id);
    for (const key of [
      'household_agrees',
      'financial_conditions',
      'alone_time',
      'had_pets_before',
      'vet_commitment',
    ])
      await other.call(
        'POST',
        '/api/requests',
        { ...body, questionnaire: { ...body.questionnaire, [key]: '' } },
        400,
      );
    for (const bad of [
      { housing: '' },
      { has_yard: 'sim' },
      { contactConsent: 'true' },
      { experience: false },
    ])
      await other.call('POST', '/api/requests', { ...body, ...bad }, 400);
    pass('perguntas vazias, booleanos falsos e experiência contraditória rejeitados no servidor');
    const r = await other.call('POST', '/api/requests', body, 201),
      id = r.id;
    assert.equal((await other.call('POST', '/api/requests', body)).id, id);
    await other.call(
      'POST',
      '/api/requests',
      { ...body, reason: 'Alteração depois de envio.' },
      409,
    );
    await other.call('POST', '/api/requests', { ...body, clientToken: crypto.randomUUID() }, 409);
    let owned = (await owner.call('GET', '/api/requests')).find((r) => r.id === id);
    assert.equal(owned.requester.email, undefined);
    assert.equal(owned.requester.phone, undefined);
    await guest.call('GET', '/api/requests', undefined, 401);
    await guest.call('GET', '/api/followups', undefined, 401);
    pass('duas contas confirmadas; solicitação idempotente e contatos privados por padrão');
    const message = {
      text: 'Mensagem privada com <script>texto</script>',
      clientToken: crypto.randomUUID(),
    };
    await other.call('POST', `/api/requests/${id}/message`, message);
    await other.call('POST', `/api/requests/${id}/message`, message);
    owned = (await owner.call('GET', '/api/requests')).find((r) => r.id === id);
    assert.equal(owned.messages.length, 1);
    assert.equal(owned.messages[0].text, message.text);
    const outsider = f.client('ONG sem vínculo');
    await outsider.call('POST', '/api/auth/login', {
      email: 'etapa1-org-approved@example.test',
      password: 'TesteSeguro9',
    });
    await outsider.call(
      'POST',
      `/api/requests/${id}/message`,
      { text: 'Invasão', clientToken: crypto.randomUUID() },
      403,
    );
    assert.ok(!(await outsider.call('GET', '/api/requests')).some((x) => x.id === id));
    await other.call('POST', `/api/requests/${id}/share-contact`, { share: true });
    assert.ok((await owner.call('GET', '/api/requests')).find((x) => x.id === id).requester.email);
    await other.call('POST', `/api/requests/${id}/share-contact`, { share: false });
    assert.equal(
      (await owner.call('GET', '/api/requests')).find((x) => x.id === id).requester.email,
      undefined,
    );
    await owner.call('POST', `/api/requests/${id}/share-contact`, { share: true });
    assert.ok((await other.call('GET', '/api/requests')).find((x) => x.id === id).owner.email);
    pass(
      'conversa entre partes, repetição sem duplicação, invasão rejeitada, consentimento e revogação de contatos',
    );
    await owner.call('POST', `/api/requests/${id}/complete`, {}, 409);
    await owner.call('POST', `/api/requests/${id}/handover`, { confirmed: true }, 409);
    await other.call('POST', `/api/requests/${id}/approve`, {}, 403);
    await owner.call('POST', `/api/requests/${id}/analyze`, {});
    await owner.call('POST', `/api/requests/${id}/analyze`, {}, 409);
    await owner.call('POST', `/api/requests/${id}/approve`, {});
    await owner.call('POST', `/api/requests/${id}/approve`, {}, 409);
    await admin.call('PATCH', `/api/animals/${r.animalId}`, { status: 'disponivel' }, 409);
    assert.equal(
      (await guest.call('GET', '/api/stats')).completedAdoptions,
      before.completedAdoptions,
    );
    await owner.call('POST', `/api/requests/${id}/complete`, {}, 409);
    await owner.call('POST', `/api/requests/${id}/interview`, {});
    await owner.call('POST', `/api/requests/${id}/interview`, {}, 409);
    await other.call('POST', `/api/requests/${id}/confirm-receipt`, { confirmed: true }, 409);
    await owner.call('POST', `/api/requests/${id}/handover`, { confirmed: false }, 400);
    const delivered = await owner.call('POST', `/api/requests/${id}/handover`, { confirmed: true });
    assert.equal(delivered.stage, 'entregue');
    assert.ok(delivered.handoverBy);
    await owner.call('POST', `/api/requests/${id}/handover`, { confirmed: true }, 409);
    await owner.call('POST', `/api/requests/${id}/complete`, {}, 409);
    await owner.call('POST', `/api/requests/${id}/reject`, {}, 409);
    await other.call('POST', `/api/requests/${id}/cancel`, {}, 409);
    for (const action of ['withdraw', 'external-adoption'])
      await owner.call('POST', `/api/animals/${r.animalId}/${action}`, { confirmed: true }, 409);
    await owner.call('DELETE', `/api/animals/${r.animalId}`, undefined, 409);
    const receipt = await other.call('POST', `/api/requests/${id}/confirm-receipt`, {
      confirmed: true,
    });
    assert.ok(receipt.receiptConfirmedAt);
    assert.equal(
      (await other.call('POST', `/api/requests/${id}/confirm-receipt`, { confirmed: true }))
        .receiptConfirmedAt,
      receipt.receiptConfirmedAt,
    );
    await owner.call('POST', `/api/requests/${id}/complete`, {});
    await owner.call('POST', `/api/requests/${id}/complete`, {}, 409);
    assert.equal(
      (await guest.call('GET', '/api/stats')).completedAdoptions,
      before.completedAdoptions + 1,
    );
    await admin.call('PATCH', `/api/animals/${r.animalId}`, { status: 'disponivel' }, 409);
    pass(
      'análise, aprovação, entrevista, entrega, recebimento e conclusão separados; estados e indicador coerentes',
    );
    let term = await other.call('GET', `/api/contracts/${id}`);
    assert.equal(term.ownerAcknowledgedAt, null);
    assert.equal(term.adopterAcknowledgedAt, null);
    assert.equal(term.workflowVersion, 3);
    await outsider.call('GET', `/api/contracts/${id}`, undefined, 403);
    await admin.call('POST', `/api/contracts/${id}/acknowledge`, { confirmed: true }, 403);
    await owner.call('POST', `/api/contracts/${id}/acknowledge`, {}, 400);
    term = await owner.call('POST', `/api/contracts/${id}/acknowledge`, { confirmed: true });
    assert.ok(term.ownerAcknowledgedAt);
    assert.equal(term.adopterAcknowledgedAt, null);
    const notificationsBefore = (await owner.call('GET', '/api/notifications')).length;
    term = await other.call('POST', `/api/contracts/${id}/acknowledge`, { confirmed: true });
    assert.ok(term.adopterAcknowledgedAt);
    await other.call('POST', `/api/contracts/${id}/acknowledge`, { confirmed: true });
    assert.equal((await owner.call('GET', '/api/notifications')).length, notificationsBefore + 1);
    assert.equal(
      (await guest.call('GET', '/api/stats')).completedAdoptions,
      before.completedAdoptions + 1,
    );
    pass(
      'termo exige concordância explícita de cada parte; repetição não renotifica nem aumenta adoções',
    );
    const db = new DatabaseSync(path.join(dataDir, 'adotapet.db'));
    try {
      const follow = {
        requestId: id,
        day: 7,
        adaptation: 'dificil',
        health: 'Relato privado de saúde.',
        behavior: 'Preciso de orientação sobre adaptação.',
        needsHelp: true,
        clientToken: crypto.randomUUID(),
      };
      await other.call('POST', '/api/followups', follow, 409);
      const rows = JSON.parse(
        db.prepare("SELECT value FROM app_state WHERE key='requests'").get().value,
      );
      rows.find((x) => x.id === id).completedAt = new Date(
        Date.now() - 100 * 86400000,
      ).toISOString();
      db.prepare("UPDATE app_state SET value=? WHERE key='requests'").run(JSON.stringify(rows));
      const follow7 = await other.call('POST', '/api/followups', follow, 201);
      assert.equal((await other.call('POST', '/api/followups', follow)).id, follow7.id);
      await other.call(
        'POST',
        '/api/followups',
        { ...follow, clientToken: crypto.randomUUID() },
        409,
      );
      for (const day of [30, 90])
        await other.call(
          'POST',
          '/api/followups',
          { ...follow, day, needsHelp: false, clientToken: crypto.randomUUID() },
          201,
        );
      assert.equal(
        (await owner.call('GET', '/api/followups')).filter((x) => x.requestId === id).length,
        3,
      );
      assert.equal((await outsider.call('GET', '/api/followups')).length, 0);
      await other.call(
        'POST',
        `/api/followups/${follow7.id}/respond`,
        { response: 'Invasão' },
        403,
      );
      await owner.call('POST', `/api/followups/${follow7.id}/respond`, { response: '' }, 400);
      const response = await owner.call('POST', `/api/followups/${follow7.id}/respond`, {
        response: 'Vamos conversar na área privada e organizar orientação.',
      });
      assert.equal(response.helpRespondedBy, f.users.owner.id);
      await owner.call(
        'POST',
        `/api/followups/${follow7.id}/respond`,
        { response: 'Duplicado' },
        409,
      );
      assert.ok(
        (await other.call('GET', '/api/followups')).find((x) => x.id === follow7.id).helpResponse,
      );
      pass('acompanhamentos de 7, 30 e 90 dias, prazos, sigilo, ajuda e resposta do responsável');
      const request2 = await other.call(
        'POST',
        '/api/requests',
        adoption(f.animals.ordinary.id),
        201,
      );
      await owner.call('POST', `/api/requests/${request2.id}/reject`, {
        reason: 'Rotina incompatível neste teste.',
      });
      await owner.call('POST', `/api/requests/${request2.id}/approve`, {}, 409);
      const request3 = await other.call(
        'POST',
        '/api/requests',
        adoption(f.animals.ordinary.id),
        201,
      );
      await owner.call('POST', `/api/requests/${request3.id}/approve`, {});
      await other.call('POST', `/api/requests/${request3.id}/cancel`, {});
      assert.equal(
        (await guest.call('GET', '/api/animals')).find((x) => x.id === f.animals.ordinary.id)
          .status,
        'disponivel',
      );
      pass('recusa e cancelamento após aprovação preservam histórico e liberam disponibilidade');
      const request4 = await other.call(
          'POST',
          '/api/requests',
          adoption(f.animals.ordinary.id),
          201,
        ),
        request5 = await outsider.call(
          'POST',
          '/api/requests',
          adoption(f.animals.ordinary.id),
          201,
        );
      await owner.call('POST', `/api/requests/${request4.id}/approve`, {});
      await owner.call('POST', `/api/requests/${request5.id}/approve`, {}, 409);
      const race = await Promise.all(
        [other, other].map(async (c) => {
          const res = await fetch(base + `/api/requests/${request4.id}/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: c.cookie },
            body: '{}',
          });
          return res.status;
        }),
      );
      assert.deepEqual(race.sort(), [200, 409]);
      pass('somente um interessado aprovado; concorrência de cancelamento não duplica transições');
      const m = await owner.call(
        'POST',
        '/api/missing',
        { name: 'Desaparecido fictício', city: 'Apodi', state: 'RN', missing_date: '2026-10-01' },
        201,
      );
      const sight = {
        missingAnimalId: m.id,
        location: 'Referência privada do avistamento.',
        reporter_name: 'Informante',
        reporter_contact: 'Contato privado',
        message: 'Detalhes privados.',
        clientToken: crypto.randomUUID(),
      };
      const s = await guest.call('POST', '/api/sightings', sight, 201);
      assert.deepEqual(Object.keys(s).sort(), ['createdAt', 'id']);
      assert.equal((await guest.call('POST', '/api/sightings', sight)).id, s.id);
      assert.equal((await owner.call('GET', '/api/sightings')).length, 1);
      assert.equal((await other.call('GET', '/api/sightings')).length, 0);
      await guest.call('GET', '/api/sightings', undefined, 401);
      pass('avistamento idempotente e detalhes disponíveis somente ao responsável/admin');
      const events = db.prepare("SELECT * FROM mail_outbox WHERE id LIKE 'event-%'").all();
      assert.ok(events.length >= 10);
      assert.ok(events.every((e) => e.token_hash === null));
      for (const e of events.filter((e) => e.payload)) {
        assert.ok(!e.payload.includes('example.test'));
        const data = Buffer.from(e.payload, 'base64'),
          decipher = crypto.createDecipheriv('aes-256-gcm', queueKey, data.subarray(0, 12));
        decipher.setAuthTag(data.subarray(12, 28));
        const msg = JSON.parse(
          Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]),
        );
        assert.ok(msg.text.includes('/login.html?next='));
        assert.ok(
          !msg.text.includes('Relato privado') &&
            !msg.text.includes('Referência privada') &&
            !msg.text.includes('Mensagem privada com'),
        );
      }
      pass(
        'avisos de eventos persistidos e criptografados, com links internos e sem detalhes pessoais no conteúdo',
      );
      await stop();
      await start();
      let previews = [];
      for (let i = 0; i < 450; i++) {
        previews = fs
          .readdirSync(path.join(dataDir, 'email-preview'))
          .map((file) => JSON.parse(fs.readFileSync(path.join(dataDir, 'email-preview', file))));
        if (
          [
            'nova solicitação',
            'atualização da adoção',
            'novo avistamento',
            'pedido de ajuda pós-adoção',
            'resposta ao pedido de ajuda',
          ].every((t) => previews.some((m) => m.subject.includes(t)))
        )
          break;
        await new Promise((r) => setTimeout(r, 100));
      }
      for (const type of [
        'nova solicitação',
        'atualização da adoção',
        'novo avistamento',
        'pedido de ajuda pós-adoção',
        'resposta ao pedido de ajuda',
      ])
        assert.ok(
          previews.some((m) => m.subject.includes(type)),
          type,
        );
      assert.equal(new Set(previews.map((m) => m.messageId)).size, previews.length);
      pass(
        'fila sobrevive ao reinício e entrega os eventos no transporte local em arquivo; nenhum SMTP real utilizado',
      );
    } finally {
      db.close();
    }
    if (process.env.ETAPA3_RESULTS)
      fs.writeFileSync(
        process.env.ETAPA3_RESULTS,
        JSON.stringify(
          {
            status: 'pass',
            passed,
            limitations: [
              'Dados fictícios em banco isolado.',
              'Datas de conclusão envelhecidas somente no banco de teste para exercer 7/30/90 dias.',
              'Transporte file local, sem envio SMTP ou entrega real a caixas de correio.',
            ],
          },
          null,
          2,
        ),
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
