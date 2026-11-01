'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  crypto = require('node:crypto'),
  assert = require('node:assert/strict'),
  { spawn } = require('node:child_process'),
  { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..'),
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'potypet-review-')),
  base = 'http://127.0.0.1:3203',
  key = crypto.randomBytes(32).toString('base64'),
  cases = [];
let server;
const sql = (fn) => {
  const db = new DatabaseSync(path.join(dir, 'adotapet.db'));
  try {
    return fn(db);
  } finally {
    db.close();
  }
};
function client() {
  const c = {
    cookie: '',
    async call(method, route, body, expected = 200) {
      const r = await fetch(base + route, {
          method,
          headers: { Cookie: c.cookie, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
        data = await r.json();
      assert.equal(r.status, expected, route + ' ' + JSON.stringify(data));
      if (r.headers.get('set-cookie')) c.cookie = r.headers.get('set-cookie').split(';')[0];
      return data;
    },
  };
  return c;
}
async function start() {
  let log = '';
  server = spawn(process.execPath, ['server.js'], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: '3203',
      DATA_DIR: dir,
      EMAIL_TRANSPORT: 'file',
      MAIL_FROM: 'qa@example.test',
      MAIL_QUEUE_KEY: key,
      PUBLIC_BASE_URL: base,
      RENDER_EXTERNAL_URL: '',
      BACKUP_AUTO: '0',
      COOKIE_SECURE: '0',
      SEED_DEMO_ACCOUNTS: '1',
      SEED_SAMPLE_DATA: '0',
      ADMIN_EMAIL: 'admin@adotapet.com',
      ADMIN_PASSWORD: '',
      DONOR_EMAIL: 'ong@adotapet.com',
      DONOR_PASSWORD: '',
      DONOR_NAME: '',
      ADMIN_RECOVERY_ID: '',
    },
  });
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
async function message(address, subject) {
  const directory = path.join(dir, 'email-preview');
  for (let n = 0; n < 800; n++) {
    if (fs.existsSync(directory))
      for (const file of fs.readdirSync(directory)) {
        const m = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
        if (m.to.some((a) => a.address === address) && m.subject.includes(subject)) {
          fs.unlinkSync(path.join(directory, file));
          return m;
        }
      }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error('Mensagem local não encontrada: ' + subject);
}
async function test(name, fn) {
  await fn();
  cases.push({ name, status: 'pass' });
  console.log('OK revisão — ' + name);
}
const register = (email) => ({
  name: 'Pessoa fictícia de revisão',
  email,
  password: 'TesteSeguro9',
  passwordConfirmation: 'TesteSeguro9',
  accountType: 'usuario',
  city: 'Apodi',
  state: 'RN',
  phone: '84000000000',
  termsAccepted: true,
});
async function confirm(address, guest) {
  const m = await message(address, 'confirme');
  await guest.call('POST', '/api/auth/verify-email', {
    token: m.text.match(/#token=([A-Za-z0-9_-]{43})/)[1],
    password: 'TesteSeguro9',
  });
}
(async () => {
  try {
    await start();
    const admin = client(),
      owner = client(),
      third = client(),
      guest = client();
    await admin.call('POST', '/api/auth/login', {
      email: 'admin@adotapet.com',
      password: 'admin123',
    });
    await test('Documentos de revisão declaram pendências, versão, fluxos e canal sem prometer resposta', async () => {
      for (const page of ['termos.html', 'privacidade.html', 'atendimento.html', 'contato.html']) {
        const r = await fetch(base + '/' + page);
        assert.equal(r.status, 200);
        const html = await r.text();
        assert.match(html, /\[A DEFINIR:/);
        assert.match(html, /usuários reais/);
        assert.doesNotMatch(html, /samuelapodi1@gmail\.com|prazo de 48|resposta em 24/);
      }
      const terms = await fetch(base + '/termos.html').then((r) => r.text());
      assert.match(terms, /2026-10-13-potypet-rc6-revisao/);
      assert.match(terms, /não atribui aceite novo retroativamente/);
      assert.match(terms, /Suspender uma conta não identifica a pessoa/);
      await fetch(base + '/docs/historico/PotyPet-4.7.0-rc.5/termos.html').then((r) =>
        assert.equal(r.status, 403),
      );
    });
    await test('Cadastro exige aceite explícito atual e confirmação; sem sessão automática', async () => {
      await guest.call(
        'POST',
        '/api/auth/register',
        { ...register('sem-aceite@example.test'), termsAccepted: false },
        400,
      );
      await owner.call(
        'POST',
        '/api/auth/register',
        { ...register('review-owner@example.test'), termsVersion: '2026-10-12-etapa5' },
        202,
      );
      await owner.call('GET', '/api/auth/me', undefined, 401);
      await confirm('review-owner@example.test', guest);
      await owner.call('GET', '/api/auth/me', undefined, 401);
      await owner.call('POST', '/api/auth/login', {
        email: 'review-owner@example.test',
        password: 'TesteSeguro9',
      });
      const u = (await owner.call('GET', '/api/auth/me')).user;
      assert.equal(u.termsVersion, '2026-10-13-potypet-rc6-revisao');
      assert.ok(u.termsAcceptedAt);
    });
    await test('Confirmação pendente antiga conserva aceite antigo, sem atribuição retroativa', async () => {
      await guest.call('POST', '/api/auth/register', register('pending-old@example.test'), 202);
      const oldAt = '2026-10-12T10:00:00.000Z';
      sql((db) => {
        const row = db
            .prepare(
              "SELECT token_hash,payload FROM auth_tokens WHERE email=? AND purpose='signup'",
            )
            .get('pending-old@example.test'),
          p = JSON.parse(row.payload);
        p.termsVersion = '2026-10-13-potypet-rc1';
        p.termsAcceptedAt = oldAt;
        db.prepare('UPDATE auth_tokens SET payload=? WHERE token_hash=?').run(
          JSON.stringify(p),
          row.token_hash,
        );
      });
      await confirm('pending-old@example.test', guest);
      const u = sql((db) =>
        db.prepare('SELECT * FROM users WHERE email=?').get('pending-old@example.test'),
      );
      assert.equal(u.terms_version, '2026-10-13-potypet-rc1');
      assert.equal(u.terms_accepted_at, oldAt);
    });
    const body = {
      name: 'Nome privado de fixture',
      description: 'Descrição de fixture sem alegação de autenticidade.',
      city: 'Apodi',
      state: 'RN',
      contact: 'contato-privado@example.test',
      photos: ['img/animal1.png'],
    };
    let animal;
    await test('Novo anúncio gera aviso interno e e-mail genérico para administração', async () => {
      animal = await owner.call('POST', '/api/animals', body, 201);
      assert.equal(animal.approvalStatus, 'pending');
      assert.ok(
        (await admin.call('GET', '/api/notifications')).some((n) =>
          n.message.includes('#' + animal.id),
        ),
      );
      const m = await message('admin@adotapet.com', 'novo anúncio');
      assert.match(m.text, /login\.html\?next=%2Fadmin\.html/);
      assert.ok(!m.text.includes(body.name));
      assert.ok(!m.text.includes(body.contact));
      await guest.call('GET', '/api/users', undefined, 401);
      await guest.call('GET', '/api/animals/' + animal.id, undefined, 404);
    });
    await test('Correção do autor reavisa análise sem mudar autorização', async () => {
      await owner.call('PATCH', '/api/animals/' + animal.id, {
        description: 'Correção privada fictícia.',
      });
      const m = await message('admin@adotapet.com', 'novo anúncio');
      assert.ok(!m.text.includes('Correção privada fictícia.'));
      await guest.call('GET', '/api/animals/' + animal.id, undefined, 404);
    });
    await test('Decisão gera aviso ao autor sem nome, motivo ou dados no e-mail', async () => {
      await admin.call('PATCH', '/api/animals/' + animal.id, {
        approvalStatus: 'rejected',
        reason: 'Motivo privado que não deve entrar no e-mail.',
      });
      const m = await message('review-owner@example.test', 'decisão administrativa');
      assert.match(m.text, new RegExp('next=%2Fanimal\\.html%3Fid%3D' + animal.id));
      assert.ok(!m.text.includes('Motivo privado'));
      assert.ok(!m.text.includes(body.name));
      await guest.call('GET', '/api/animals/' + animal.id, undefined, 404);
      assert.equal(
        (await owner.call('GET', '/api/animals/' + animal.id)).approvalStatus,
        'rejected',
      );
    });
    await test('Falha 400/401/403 não gera aviso de decisão bem-sucedida', async () => {
      await guest.call('POST', '/api/auth/register', register('review-third@example.test'), 202);
      await confirm('review-third@example.test', guest);
      await third.call('POST', '/api/auth/login', {
        email: 'review-third@example.test',
        password: 'TesteSeguro9',
      });
      const before = sql((db) => db.prepare('SELECT id FROM mail_outbox ORDER BY id').all());
      await admin.call(
        'PATCH',
        '/api/animals/' + animal.id,
        { approvalStatus: 'approved', reason: '' },
        400,
      );
      await guest.call(
        'PATCH',
        '/api/animals/' + animal.id,
        { approvalStatus: 'approved', reason: 'Sem sessão' },
        401,
      );
      await third.call(
        'PATCH',
        '/api/animals/' + animal.id,
        { approvalStatus: 'approved', reason: 'Indevida' },
        403,
      );
      assert.deepEqual(
        sql((db) => db.prepare('SELECT id FROM mail_outbox ORDER BY id').all()),
        before,
      );
      assert.equal(
        (await owner.call('GET', '/api/animals/' + animal.id)).approvalStatus,
        'rejected',
      );
    });
    await test('Contato completo registra protocolo sem enviar resposta automática', async () => {
      const before = sql((db) => db.prepare('SELECT id FROM mail_outbox ORDER BY id').all());
      const r = await guest.call(
        'POST',
        '/api/contact',
        {
          name: 'Pessoa fictícia',
          email: 'nao-confirmado@example.test',
          message: 'Contestação fictícia de decisão com protocolo.',
        },
        201,
      );
      assert.match(r.protocol, /^APPET-/);
      await guest.call(
        'POST',
        '/api/contact',
        {
          name: 'Pessoa fictícia',
          email: 'nao-confirmado@example.test',
          message: 'x'.repeat(5001),
        },
        400,
      );
      assert.deepEqual(
        sql((db) => db.prepare('SELECT id FROM mail_outbox ORDER BY id').all()),
        before,
      );
      await guest.call('GET', '/api/reports', undefined, 401);
    });
    await test('Suspensão/reativação enviam aviso genérico, preservam histórico e exigem login', async () => {
      const id = (await owner.call('GET', '/api/auth/me')).user.id;
      await admin.call('POST', '/api/users/' + id + '/suspend-account', {
        reason: 'Motivo privado de suspensão fictícia.',
      });
      await owner.call('GET', '/api/auth/me', undefined, 401);
      const m = await message('review-owner@example.test', 'decisão administrativa');
      assert.match(m.text, /next=%2Fconfiguracoes\.html/);
      assert.ok(!m.text.includes('Motivo privado'));
      await owner.call('POST', '/api/auth/login', {
        email: 'review-owner@example.test',
        password: 'TesteSeguro9',
      });
      assert.equal((await owner.call('GET', '/api/auth/me')).user.historicalAccess, true);
      await owner.call('PATCH', '/api/animals/' + animal.id, { description: 'Bloqueado' }, 403);
      await admin.call('POST', '/api/users/' + id + '/reactivate', {
        reason: 'Reativação fictícia.',
      });
      await owner.call('GET', '/api/auth/me', undefined, 401);
      await message('review-owner@example.test', 'decisão administrativa');
    });
    await test('Ocultação de desaparecido avisa com link protegido, sem motivo privado', async () => {
      await owner.call('POST', '/api/auth/login', {
        email: 'review-owner@example.test',
        password: 'TesteSeguro9',
      });
      const m = await owner.call(
        'POST',
        '/api/missing',
        {
          name: 'Desaparecido fictício de revisão',
          city: 'Apodi',
          state: 'RN',
          missing_date: '2026-10-01',
        },
        201,
      );
      await admin.call('POST', '/api/missing/' + m.id + '/hide', {
        reason: 'Motivo privado de ocultação.',
      });
      const e = await message('review-owner@example.test', 'decisão administrativa');
      assert.ok(e.text.includes('next=%2Fdesaparecido.html%3Fid%3D' + m.id));
      assert.ok(!e.text.includes('Motivo privado'));
      assert.ok(!(await guest.call('GET', '/api/missing')).some((x) => x.id === m.id));
      assert.ok((await owner.call('GET', '/api/missing')).some((x) => x.id === m.id && x.hiddenAt));
    });
    await test('Decisões de ONG avisam sem conceder sessão ou liberar conta restrita', async () => {
      const org = client(),
        email = 'review-org@example.test';
      await guest.call(
        'POST',
        '/api/auth/register',
        { ...register(email), accountType: 'ong', organizationKind: 'grupo' },
        202,
      );
      await confirm(email, guest);
      const u = sql((db) => db.prepare('SELECT id FROM users WHERE email=?').get(email));
      await admin.call('POST', '/api/users/' + u.id + '/approve', {});
      await message(email, 'decisão administrativa');
      await org.call('GET', '/api/auth/me', undefined, 401);
      await org.call('POST', '/api/auth/login', { email, password: 'TesteSeguro9' });
      await org.call('POST', '/api/animals', body, 201);
      await message('admin@adotapet.com', 'novo anúncio');
      await admin.call('POST', '/api/users/' + u.id + '/suspend', {
        reason: 'Motivo privado de ONG.',
      });
      const e = await message(email, 'decisão administrativa');
      assert.ok(!e.text.includes('Motivo privado'));
      await org.call('GET', '/api/auth/me', undefined, 401);
      await org.call('POST', '/api/auth/login', { email, password: 'TesteSeguro9' });
      assert.equal((await org.call('GET', '/api/auth/me')).user.historicalAccess, true);
      await org.call('POST', '/api/animals', body, 403);
    });
    await test('Reinício conserva aceites, contas, registros e avisos anteriores sem reenvio', async () => {
      const snap = () =>
        sql((db) => ({
          users: db.prepare('SELECT * FROM users ORDER BY id').all(),
          state: db.prepare('SELECT * FROM app_state ORDER BY key').all(),
          mail: db.prepare('SELECT id,created_at,delivered_at FROM mail_outbox ORDER BY id').all(),
        }));
      const before = snap();
      await stop();
      await start();
      assert.deepEqual(snap(), before);
    });
    await test('PUBLIC_BASE_URL funciona em produção sem variáveis do Render', async () => {
      const settings = require('../lib/mail-service.cjs').settings;
      const s = settings({
        NODE_ENV: 'production',
        EMAIL_TRANSPORT: 'smtp',
        PUBLIC_BASE_URL: 'https://potypet.example.test',
        MAIL_FROM: 'sender@example.test',
        MAIL_QUEUE_KEY: key,
        SMTP_HOST: 'smtp.example.test',
        SMTP_USER: 'fixture',
        SMTP_PASSWORD: 'fixture',
        SMTP_PORT: '465',
      });
      assert.equal(s.base, 'https://potypet.example.test');
      assert.equal(s.smtp.secure, true);
      assert.equal(s.smtp.tls.rejectUnauthorized, true);
    });
    await stop();
    await test('Fila registrada, tentativa controlada e aceitação pelo transporte são distintas de inbox', async () => {
      const db = new DatabaseSync(path.join(dir, 'fake-mail.db'));
      db.exec(
        'CREATE TABLE auth_tokens(token_hash TEXT PRIMARY KEY,expires_at INTEGER,used_at INTEGER);',
      );
      let resolve,
        calls = 0;
      const transport = {
          sendMail() {
            calls++;
            return new Promise((r) => (resolve = r));
          },
          close() {},
        },
        mail = require('../lib/mail-service.cjs')({
          db,
          dataDir: dir,
          env: {
            NODE_ENV: 'test',
            EMAIL_TRANSPORT: 'file',
            PUBLIC_BASE_URL: base,
            MAIL_FROM: 'qa@example.test',
            MAIL_QUEUE_KEY: key,
          },
          transportFactory: () => transport,
        });
      try {
        mail.queueEvent('private@example.test', 'moderation', 'controlled', 'configuracoes.html');
        mail.queueEvent('private@example.test', 'moderation', 'controlled', 'configuracoes.html');
        assert.equal(db.prepare('SELECT COUNT(*) n FROM mail_outbox').get().n, 1);
        assert.equal(calls, 0);
        const pumping = mail.pump();
        assert.equal(calls, 1);
        assert.equal(db.prepare('SELECT delivered_at FROM mail_outbox').get().delivered_at, null);
        resolve({
          message: JSON.stringify({
            to: 'private@example.test',
            text: 'Transporte fictício controlado.',
          }),
        });
        await pumping;
        assert.ok(db.prepare('SELECT delivered_at FROM mail_outbox').get().delivered_at);
        assert.equal(mail.summary().inboxDeliveryVerified, false);
        assert.throws(() =>
          mail.queueEvent(
            'private@example.test',
            'moderation',
            'external',
            'https://evil.example/',
          ),
        );
        assert.throws(() =>
          mail.queueEvent('private@example.test', 'moderation', 'invalid', 'admin.html?role=admin'),
        );
      } finally {
        mail.stop();
        db.close();
      }
    });
  } finally {
    if (process.env.POTYPET_REVIEW_REPORT)
      fs.writeFileSync(
        process.env.POTYPET_REVIEW_REPORT,
        JSON.stringify(
          {
            version: '4.7.0-rc.6',
            cases,
            emailScope: 'file + transporte controlado, nenhuma entrega real',
            operationalProviderVerified: false,
          },
          null,
          2,
        ),
      );
    await stop();
    assert.ok(dir.startsWith(os.tmpdir() + path.sep + 'potypet-review-'));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
