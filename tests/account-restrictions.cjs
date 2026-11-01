'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  crypto = require('node:crypto'),
  assert = require('node:assert/strict'),
  http = require('node:http');
const { spawn } = require('node:child_process'),
  { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..'),
  base = 'http://127.0.0.1:3196',
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'potypet-restriction-')),
  results = [],
  queueKey = crypto.randomBytes(32).toString('base64');
let server;
function sql(fn) {
  const db = new DatabaseSync(path.join(dir, 'adotapet.db'));
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
const stored = (key) =>
  sql((db) => JSON.parse(db.prepare('SELECT value FROM app_state WHERE key=?').get(key).value));
async function start() {
  let log = '';
  server = spawn(
    process.execPath,
    [
      '--require',
      path.join(__dirname, 'helpers/photo-barrier.cjs'),
      '--require',
      path.join(__dirname, 'helpers/body-observer.cjs'),
      'server.js',
    ],
    {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        POTYPET_CONCURRENCY_PROJECT: root,
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: '3196',
        DATA_DIR: dir,
        EMAIL_TRANSPORT: 'file',
        MAIL_FROM: 'qa@example.test',
        MAIL_QUEUE_KEY: queueKey,
        PUBLIC_BASE_URL: base,
        BACKUP_AUTO: '0',
        COOKIE_SECURE: '0',
        TRUST_PROXY: '0',
        TRUSTED_PROXY_IPS: '',
        PERSISTENT_DISK_PATH: '',
        SEED_DEMO_ACCOUNTS: '1',
        SEED_SAMPLE_DATA: '0',
        USER_ANIMAL_LIMIT: '100',
        ADMIN_EMAIL: 'admin@adotapet.com',
        ADMIN_PASSWORD: '',
        DONOR_EMAIL: 'ong@adotapet.com',
        DONOR_PASSWORD: '',
        ADMIN_RECOVERY_ID: '',
      },
    },
  );
  for (const s of [server.stdout, server.stderr]) s.on('data', (d) => (log += d));
  for (let n = 0; !log.includes('PotyPet rodando'); n++) {
    if (n > 300 || server.exitCode !== null) throw Error(log);
    await new Promise((r) => setTimeout(r, 50));
  }
}
async function stop() {
  if (server?.exitCode === null && server.signalCode === null) {
    const done = new Promise((r) => server.once('exit', r));
    server.kill();
    await done;
  }
  server = null;
}
const signal = (type, id) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      server.off('message', listener);
      reject(Error('Timeout ' + type));
    }, 15000);
    function listener(m) {
      if (m.type === type && m.id === id) {
        clearTimeout(t);
        server.off('message', listener);
        resolve();
      }
    }
    server.on('message', listener);
  });
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, status: 'pass' });
    console.log('OK restrição — ' + name);
  } catch (e) {
    results.push({ name, status: 'fail', error: String(e.stack).slice(0, 2200) });
    console.error('FALHOU restrição — ' + name + ' — ' + e.message);
  }
}
(async () => {
  try {
    await start();
    const f = await require('./etapa1-fixtures.cjs')({ base, dataDir: dir, email: true }),
      { admin, owner, other, guest } = f.clients;
    const login = (c, u) =>
        c.call('POST', '/api/auth/login', { email: u.email, password: 'TesteSeguro9' }),
      suspend = (id) =>
        admin.call('POST', '/api/users/' + id + '/suspend-account', {
          reason: 'Justificativa fictícia de suspensão, sem apagar vínculos.',
        }),
      reactivate = (id) =>
        admin.call('POST', '/api/users/' + id + '/reactivate', {
          reason: 'Revisão fictícia concluída, retirar somente a suspensão.',
        });
    const photo =
        'data:image/png;base64,' +
        fs.readFileSync(path.join(root, 'img/animal1.png')).toString('base64'),
      today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(
        new Date(),
      );
    const missing = await owner.call(
      'POST',
      '/api/missing',
      {
        name: 'Desaparecido de histórico fictício',
        city: 'Apodi',
        state: 'RN',
        missing_date: today,
        photo,
      },
      201,
    );
    await admin.call('POST', '/api/missing/' + missing.id + '/hide', {
      reason: 'Ocultação de QA preservada.',
    });
    const request = await other.call(
      'POST',
      '/api/requests',
      require('./adoption-fixture.cjs')({
        animalId: f.animals.ordinary.id,
        responsibility_confirmed: true,
      }),
      201,
    );
    await owner.call('POST', '/api/requests/' + request.id + '/message', {
      text: 'Conversa anterior fictícia preservada.',
      clientToken: crypto.randomUUID(),
    });
    await owner.call('POST', '/api/requests/' + request.id + '/approve', {});
    await owner.call('POST', '/api/requests/' + request.id + '/handover', { confirmed: true });
    await other.call('POST', '/api/requests/' + request.id + '/confirm-receipt', {
      confirmed: true,
    });
    await owner.call('POST', '/api/requests/' + request.id + '/complete', {});
    sql((db) => {
      const r = stored('requests');
      r.find((x) => x.id === request.id).completedAt = new Date(
        Date.now() - 100 * 86400000,
      ).toISOString();
      db.prepare("UPDATE app_state SET value=? WHERE key='requests'").run(JSON.stringify(r));
    });
    const follow = await other.call(
      'POST',
      '/api/followups',
      {
        requestId: request.id,
        day: 7,
        adaptation: 'boa',
        health: 'Saúde fictícia preservada.',
        behavior: 'Comportamento fictício preservado.',
        needsHelp: true,
        photo,
      },
      201,
    );
    const campaign = await owner.call(
      'POST',
      '/api/campaigns',
      {
        clientToken: crypto.randomUUID(),
        kind: 'campaign',
        target: 'animal',
        title: 'Campanha histórica fictícia',
        description:
          'Campanha fictícia para conferir preservação, evidências e restrição da conta.',
        beneficiaryName: 'Beneficiário fictício',
        organizer: 'Organizador fictício',
        category: 'tratamento',
        city: 'Apodi',
        state: 'RN',
        costs: 'Custos fictícios.',
        contact: 'Contato fictício',
        goalCents: 10000,
        raisedCents: 0,
        beneficiary: 'Recebedor fictício',
        pixKeyType: 'aleatoria',
        pixKey: '00000000-0000-0000-0000-000000000000',
        receiverRelation: 'responsavel',
      },
      201,
    );
    const evidence = await owner.call(
      'POST',
      '/api/campaigns/' + campaign.id + '/files',
      {
        name: 'evidencia-ficticia.png',
        mime: 'image/png',
        base64: photo.split(',')[1],
        revision: campaign.revision,
      },
      201,
    );
    const { PDFDocument } = require('pdf-lib'),
      budget = await PDFDocument.create();
    budget.addPage([100, 100]);
    await owner.call(
      'POST',
      '/api/campaigns/' + campaign.id + '/files',
      {
        revision: evidence.revision,
        name: 'orcamento-ficticio.pdf',
        mime: 'application/pdf',
        base64: Buffer.from(await budget.save()).toString('base64'),
      },
      201,
    );
    let published = await owner.call('GET', '/api/campaigns/' + campaign.id);
    published = await owner.call('POST', '/api/campaigns/' + campaign.id + '/submit', {
      revision: published.revision,
    });
    let review = await admin.call('GET', '/api/campaigns/' + campaign.id);
    review = await admin.call(
      'POST',
      '/api/campaigns/' + campaign.id + '/checks',
      require('./campaign-review-fixture.cjs')(review),
    );
    await admin.call('POST', '/api/campaigns/' + campaign.id + '/review', {
      revision: review.revision,
      decision: 'approve',
      summary:
        'Simulação local: organizador, finalidade, custos, recebedor e arquivo comparados apenas para testar os controles.',
      publicSummaryConfirmed: true,
    });
    const protectedKeys = [
      'animals',
      'missing',
      'requests',
      'contracts',
      'followups',
      'campaigns',
      'organizations',
      'sightings',
    ];
    const before = Object.fromEntries(protectedKeys.map((k) => [k, stored(k)]));
    await test('Suspensão PF registra decisão, revoga sessões e preserva dados/vínculos', async () => {
      const result = await suspend(f.users.owner.id);
      assert.equal(result.user.accountSuspended, true);
      assert.equal(result.user.accountType, 'usuario');
      assert.equal(result.user.role, 'adotante');
      assert.equal(result.user.approvalStatus, f.users.owner.approvalStatus);
      assert.equal(result.user.accountModerationHistory.at(-1).actorId, 1);
      assert.ok(result.user.suspendedAt);
      assert.ok(result.user.suspensionReason);
      await owner.call('GET', '/api/auth/me', undefined, 401);
      for (const k of protectedKeys) assert.deepEqual(stored(k), before[k], k);
      assert.equal(
        sql(
          (db) =>
            db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=?').get(f.users.owner.id).n,
        ),
        0,
      );
    });
    await test('Campanha aprovada preserva versão e bloqueia Pix enquanto organizador está suspenso', async () => {
      assert.ok(!(await guest.call('GET', '/api/campaigns')).some((c) => c.id === campaign.id));
      await guest.call(
        'POST',
        '/api/campaigns/' + campaign.id + '/pix',
        { revision: 1, amountCents: 1000 },
        404,
      );
      assert.deepEqual(
        stored('campaigns').find((c) => c.id === campaign.id).approved,
        before.campaigns.find((c) => c.id === campaign.id).approved,
      );
    });
    await test('Login explícito e confirmado permite somente histórico autorizado', async () => {
      const result = await login(owner, f.users.owner);
      assert.equal(result.user.historicalAccess, true);
      const animal = await owner.call('GET', '/api/animals/' + f.animals.ordinary.id);
      assert.equal(animal.id, f.animals.ordinary.id);
      assert.ok((await owner.call('GET', '/api/requests')).some((r) => r.id === request.id));
      assert.ok(
        (await owner.call('GET', '/api/animals/cards?view=history')).some(
          (a) => a.id === f.animals.ordinary.id,
        ),
      );
      assert.ok((await owner.call('GET', '/api/followups')).some((x) => x.id === follow.id));
      assert.equal((await owner.call('GET', '/api/contracts/' + request.id)).requestId, request.id);
      assert.ok((await owner.call('GET', '/api/missing')).some((x) => x.id === missing.id));
      assert.equal((await owner.call('GET', '/api/campaigns/' + campaign.id)).id, campaign.id);
      const r = await fetch(base + '/api/campaign-files/' + evidence.id, {
        headers: { Cookie: owner.cookie },
      });
      assert.equal(r.status, 200);
      assert.ok((await r.arrayBuffer()).byteLength);
    });
    const writes = [
      ['POST', '/api/animals', {}],
      ['PATCH', '/api/animals/' + f.animals.approved.id, {}],
      ['POST', '/api/animals/' + f.animals.approved.id + '/view', {}],
      ['DELETE', '/api/animals/' + f.animals.approved.id],
      ['POST', '/api/missing', {}],
      ['PATCH', '/api/missing/' + missing.id, {}],
      ['POST', '/api/requests', {}],
      ['POST', '/api/requests/' + request.id + '/message', {}],
      ['POST', '/api/requests/' + request.id + '/share-contact', {}],
      ['POST', '/api/requests/' + request.id + '/cancel', {}],
      ['POST', '/api/contracts/' + request.id + '/acknowledge', { confirmed: true }],
      ['POST', '/api/followups', {}],
      ['POST', '/api/followups/' + follow.id + '/respond', {}],
      ['POST', '/api/campaigns', {}],
      ['PATCH', '/api/campaigns/' + campaign.id, {}],
      ['POST', '/api/campaigns/' + campaign.id + '/files', {}],
      ['DELETE', '/api/campaign-files/' + evidence.id, {}],
      ['PATCH', '/api/users/me', {}],
      ['POST', '/api/favorites/toggle', {}],
      ['POST', '/api/adoption-profile', {}],
      ['POST', '/api/notifications/read', {}],
      ['PUT', '/api/organizations/me', {}],
    ];
    for (const [method, route, body] of writes)
      await test('PF restrita bloqueia escrita ' + method + ' ' + route, () =>
        owner.call(method, route, body, 403),
      );
    await test('Visitante/terceiro não recebem termos, conversas, evidências ou metadados de suspensão', async () => {
      await guest.call('GET', '/api/contracts/' + request.id, undefined, 401);
      await guest.call('GET', '/api/campaigns/' + campaign.id, undefined, 401);
      await guest.call('GET', '/api/users', undefined, 401);
      const third = f.client('terceiro'),
        email = 'terceiro-sem-vinculos@example.test';
      sql((db) => {
        const u = {
          ...db.prepare('SELECT * FROM users WHERE id=?').get(f.users.other.id),
          email,
          name: 'Terceiro fictício sem vínculos',
        };
        delete u.id;
        const keys = Object.keys(u);
        db.prepare(
          'INSERT INTO users(' + keys.join(',') + ') VALUES(' + keys.map(() => '?').join(',') + ')',
        ).run(...keys.map((k) => u[k]));
      });
      await third.call('POST', '/api/auth/login', { email, password: 'TesteSeguro9' });
      await third.call('GET', '/api/contracts/' + request.id, undefined, 403);
      await third.call('GET', '/api/campaigns/' + campaign.id, undefined, 404);
      assert.ok(!(await third.call('GET', '/api/requests')).some((r) => r.id === request.id));
      assert.ok(!(await guest.call('GET', '/api/missing')).some((x) => x.id === missing.id));
      const r = (await other.call('GET', '/api/requests')).find((r) => r.id === request.id);
      assert.ok(!Object.hasOwn(r.owner, 'accountModerationHistory'));
      assert.ok(!Object.hasOwn(r.owner, 'suspensionReason'));
      assert.equal(r.owner.historicalAccess, false);
      await guest.call('GET', '/api/animals/' + f.animals.approved.id, undefined, 404);
    });
    await test('Política anônima e controles contra abuso permanecem sem bloqueio absoluto da pessoa', async () => {
      await guest.call(
        'POST',
        '/api/reports',
        { target_type: 'outro', category: 'outro', reason: 'Denúncia anônima fictícia.' },
        201,
      );
      await guest.call(
        'POST',
        '/api/contact',
        {
          name: 'Contato fictício',
          email: 'qa@example.test',
          message: 'Atendimento anônimo fictício.',
        },
        201,
      );
      const active = await admin.call(
        'POST',
        '/api/missing',
        { name: 'Alerta público fictício', city: 'Apodi', state: 'RN', missing_date: today },
        201,
      );
      await guest.call(
        'POST',
        '/api/sightings',
        { missingAnimalId: active.id, location: 'Local fictício.', message: 'Mensagem fictícia.' },
        201,
      );
      await guest.call('POST', '/api/reports', { target_type: 'outro', reason: '' }, 400);
      for (let n = 0; n < 15; n++) {
        const r = await fetch(base + '/api/reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'QA', target_type: 'outro' }),
        });
        if (r.status === 429) {
          assert.ok(r.headers.get('retry-after'));
          return;
        }
      }
      throw Error('Limite anônimo não foi aplicado.');
    });
    await test('Reativação PF preserva papel, confirmação, aprovação e histórico; revoga sessão restrita', async () => {
      const prior = sql((db) => db.prepare('SELECT * FROM users WHERE id=?').get(f.users.owner.id));
      const result = await reactivate(f.users.owner.id);
      assert.equal(result.user.accountSuspended, false);
      assert.equal(result.user.historicalAccess, false);
      assert.equal(result.user.accountModerationHistory.length, 2);
      await owner.call('GET', '/api/auth/me', undefined, 401);
      const current = sql((db) =>
        db.prepare('SELECT * FROM users WHERE id=?').get(f.users.owner.id),
      );
      for (const key of [
        'role',
        'account_type',
        'approval_status',
        'email_verified_at',
        'password_hash',
        'password_salt',
      ])
        assert.equal(current[key], prior[key], key);
      await login(owner, f.users.owner);
      await owner.call('PATCH', '/api/missing/' + missing.id, { name: missing.name });
      await admin.call('POST', '/api/users/' + f.users.owner.id + '/approve', {}, 400);
      const publicCampaign = (await guest.call('GET', '/api/campaigns')).find(
        (c) => c.id === campaign.id,
      );
      assert.ok(publicCampaign);
      assert.ok(
        (
          await guest.call('POST', '/api/campaigns/' + campaign.id + '/pix', {
            revision: publicCampaign.revision,
            amountCents: 1000,
          })
        ).payload,
      );
    });
    for (const status of ['pending', 'rejected', 'approved'])
      await test(
        'ONG ' + status + ': suspensão/reativação não altera aprovação ou papel',
        async () => {
          const u = f.users.organizations[status],
            prior = sql((db) => db.prepare('SELECT * FROM users WHERE id=?').get(u.id));
          await suspend(u.id);
          const result = await reactivate(u.id);
          assert.equal(result.user.approvalStatus, prior.approval_status);
          assert.equal(result.user.role, prior.role);
          const c = f.client('ONG ' + status);
          if (status === 'approved') {
            await login(c, u);
            assert.equal((await c.call('GET', '/api/auth/me')).user.historicalAccess, false);
          } else
            await c.call(
              'POST',
              '/api/auth/login',
              { email: u.email, password: 'TesteSeguro9' },
              403,
            );
        },
      );
    await test('ONG suspensa/reprovada com vínculos mantém consulta e bloqueia escrita', async () => {
      await stop();
      await start();
      const u = f.users.organizations.approved,
        c = f.client('ONG histórica');
      await login(c, u);
      const animal = await c.call(
        'POST',
        '/api/animals',
        { name: 'ONG com vínculo fictício', city: 'Apodi', state: 'RN' },
        201,
      );
      for (const action of ['suspend', 'reject']) {
        await admin.call('POST', '/api/users/' + u.id + '/' + action, {
          reason: 'Decisão fictícia.',
        });
        await c.call('GET', '/api/auth/me', undefined, 401);
        await login(c, u);
        assert.equal((await c.call('GET', '/api/auth/me')).user.historicalAccess, true);
        await c.call('GET', '/api/animals/' + animal.id);
        await c.call('POST', '/api/animals', {}, 403);
        await c.call('POST', '/api/notifications/read', {}, 403);
        await c.call('POST', '/api/campaigns', {}, 403);
      }
    });
    await test('Administrador, própria conta e último administrador são protegidos', async () => {
      await admin.call(
        'POST',
        '/api/users/1/suspend-account',
        { reason: 'Tentativa fictícia.' },
        409,
      );
      await admin.call('POST', '/api/users/1/reactivate', { reason: 'Tentativa fictícia.' }, 409);
      await owner.call(
        'POST',
        '/api/users/' + f.users.other.id + '/suspend-account',
        { reason: 'Sem permissão.' },
        403,
      );
      const id = sql((db) => {
        const u = db.prepare('SELECT * FROM users WHERE id=1').get(),
          keys = Object.keys(u).filter((k) => k !== 'id');
        u.name = 'Outro administrador fictício';
        u.email = 'outro-admin@example.test';
        return Number(
          db
            .prepare(
              'INSERT INTO users(' +
                keys.join(',') +
                ') VALUES(' +
                keys.map(() => '?').join(',') +
                ')',
            )
            .run(...keys.map((k) => u[k])).lastInsertRowid,
        );
      });
      await admin.call(
        'POST',
        '/api/users/' + id + '/suspend-account',
        { reason: 'Tentativa fictícia.' },
        409,
      );
      assert.equal(
        sql(
          (db) =>
            db
              .prepare('SELECT COUNT(*) n FROM users WHERE role=? AND account_suspended_at IS NULL')
              .get('admin').n,
        ),
        2,
      );
    });
    await test('Suspensão no meio do corpo HTTP impede a gravação final', async () => {
      const id = 'corpo',
        ready = signal('body-armed', id),
        reading = signal('body-reading', id);
      server.send({ type: 'arm-body', id, path: '/api/users/me' });
      await ready;
      const body = JSON.stringify({
        name: 'Não gravar depois da suspensão',
        city: 'Apodi',
        state: 'RN',
        phone: '84999999999',
      });
      let request;
      const response = new Promise((resolve, reject) => {
        request = http.request(
          base + '/api/users/me',
          {
            method: 'PATCH',
            headers: {
              Cookie: owner.cookie,
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
            },
          },
          (r) => {
            let data = '';
            r.on('data', (d) => (data += d));
            r.on('end', () => resolve({ status: r.statusCode, body: JSON.parse(data) }));
          },
        );
        request.on('error', reject);
        request.write(body.slice(0, 8));
      });
      await reading;
      await suspend(f.users.owner.id);
      request.end(body.slice(8));
      assert.equal((await response).status, 401);
      assert.equal(
        sql((db) => db.prepare('SELECT name FROM users WHERE id=?').get(f.users.owner.id).name),
        f.users.owner.name,
      );
      await reactivate(f.users.owner.id);
      await login(owner, f.users.owner);
    });
    await test('Suspensão durante foto impede gravação e preserva registro atual', async () => {
      const id = 'foto',
        armed = signal('armed', id),
        held = signal('held', id);
      server.send({ type: 'arm', kind: 'image', id });
      await armed;
      const before = stored('missing').find((x) => x.id === missing.id),
        pending = owner.call(
          'PATCH',
          '/api/missing/' + missing.id,
          { photo, features: 'Não gravar após suspensão.' },
          401,
        );
      await held;
      try {
        await suspend(f.users.owner.id);
      } finally {
        server.send({ type: 'release', id });
      }
      await pending;
      assert.deepEqual(
        stored('missing').find((x) => x.id === missing.id),
        before,
      );
    });
    await test('Validação, repetição e campos não permitidos preservam a decisão', async () => {
      await admin.call(
        'POST',
        '/api/users/' + f.users.owner.id + '/suspend-account',
        { reason: 'Outra tentativa.' },
        409,
      );
      await admin.call(
        'POST',
        '/api/users/' + f.users.other.id + '/suspend-account',
        { reason: '' },
        400,
      );
      const prior = sql((db) => db.prepare('SELECT * FROM users WHERE id=?').get(f.users.other.id));
      await admin.call('POST', '/api/users/' + f.users.other.id + '/suspend-account', {
        reason: 'Decisão fictícia válida.',
        role: 'admin',
        approvalStatus: 'reprovado',
        actorId: 999,
      });
      const result = await reactivate(f.users.other.id);
      assert.equal(result.user.role, prior.role);
      assert.equal(result.user.approvalStatus, prior.approval_status);
      await admin.call(
        'POST',
        '/api/users/' + f.users.other.id + '/reactivate',
        { reason: 'Outra tentativa.' },
        409,
      );
    });
    await test('Suspensão e reativação não dispensam confirmação de e-mail nem criam sessão automática', async () => {
      const id = sql((db) => {
        const u = {
          ...db.prepare('SELECT * FROM users WHERE id=?').get(f.users.other.id),
          name: 'Não confirmado fictício',
          email: 'nao-confirmado@example.test',
          email_verified_at: null,
          account_suspended_at: null,
          account_suspended_by: null,
          account_suspension_reason: '',
          account_moderation_history: '[]',
        };
        delete u.id;
        const keys = Object.keys(u);
        return Number(
          db
            .prepare(
              'INSERT INTO users(' +
                keys.join(',') +
                ') VALUES(' +
                keys.map(() => '?').join(',') +
                ')',
            )
            .run(...keys.map((k) => u[k])).lastInsertRowid,
        );
      });
      await suspend(id);
      await reactivate(id);
      await guest.call(
        'POST',
        '/api/auth/login',
        { email: 'nao-confirmado@example.test', password: 'TesteSeguro9' },
        403,
      );
      assert.equal(
        sql((db) => db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=?').get(id).n),
        0,
      );
    });
    await test('Suspensão durante PDF impede upload e conserva evidências anteriores', async () => {
      await reactivate(f.users.owner.id);
      await login(owner, f.users.owner);
      const { PDFDocument } = require('pdf-lib'),
        pdf = await PDFDocument.create();
      pdf.addPage([100, 100]);
      const c = await owner.call('GET', '/api/campaigns/' + campaign.id),
        before = sql((db) => db.prepare('SELECT * FROM campaign_files ORDER BY id').all()),
        id = 'pdf',
        armed = signal('armed', id),
        held = signal('held', id);
      server.send({ type: 'arm', kind: 'pdf', id });
      await armed;
      const pending = owner.call(
        'POST',
        '/api/campaigns/' + c.id + '/files',
        {
          revision: c.revision,
          name: 'privado-ficticio.pdf',
          mime: 'application/pdf',
          base64: Buffer.from(await pdf.save()).toString('base64'),
        },
        401,
      );
      await held;
      try {
        await suspend(f.users.owner.id);
      } finally {
        server.send({ type: 'release', id });
      }
      await pending;
      assert.deepEqual(
        sql((db) => db.prepare('SELECT * FROM campaign_files ORDER BY id').all()),
        before,
      );
    });
    await test('Suspensão, metadados, vínculos e decisões sobrevivem ao reinício idempotente', async () => {
      const before = sql((db) => ({
        users: db.prepare('SELECT * FROM users ORDER BY id').all(),
        state: db.prepare('SELECT * FROM app_state ORDER BY key').all(),
      }));
      await stop();
      await start();
      assert.deepEqual(
        sql((db) => ({
          users: db.prepare('SELECT * FROM users ORDER BY id').all(),
          state: db.prepare('SELECT * FROM app_state ORDER BY key').all(),
        })),
        before,
      );
      await login(owner, f.users.owner);
      assert.equal((await owner.call('GET', '/api/auth/me')).user.accountSuspended, true);
      assert.equal((await owner.call('GET', '/api/contracts/' + request.id)).requestId, request.id);
    });
  } finally {
    await stop();
    if (process.env.POTYPET_RESTRICTION_REPORT)
      fs.writeFileSync(
        process.env.POTYPET_RESTRICTION_REPORT,
        JSON.stringify(
          {
            version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version,
            node: process.versions.node,
            cases: results,
            scope:
              'Servidor HTTP/SQLite real; corpos e processamento de foto sincronizados; e-mail file local com confirmação explícita; dados fictícios.',
          },
          null,
          2,
        ),
      );
    assert.ok(dir.startsWith(os.tmpdir() + path.sep + 'potypet-restriction-'));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    if (results.some((r) => r.status !== 'pass') || results.length !== 39) process.exitCode = 1;
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
