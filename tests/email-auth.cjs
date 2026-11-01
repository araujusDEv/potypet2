'use strict';
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  crypto = require('node:crypto');
const { spawn } = require('node:child_process'),
  { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..'),
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'appet-email-qa-'));
const productionDirectory = path.join(
  path.dirname(root),
  '.appet-email-production-' + crypto.randomUUID(),
);
const base = 'http://127.0.0.1:3181',
  key = crypto.randomBytes(32).toString('base64');
let server, db;
const common = {
  ...process.env,
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: '3181',
  DATA_DIR: directory,
  COOKIE_SECURE: '0',
  TRUST_PROXY: '0',
  SEED_DEMO_ACCOUNTS: '1',
  SEED_SAMPLE_DATA: '0',
  EMAIL_TRANSPORT: 'file',
  PUBLIC_BASE_URL: base,
  MAIL_FROM: 'appet@example.test',
  MAIL_QUEUE_KEY: key,
  BACKUP_AUTO: '0',
  ADMIN_EMAIL: 'admin@adotapet.com',
  ADMIN_PASSWORD: 'admin123',
  DONOR_EMAIL: 'ong@adotapet.com',
  DONOR_PASSWORD: 'doador123',
  ADMIN_RECOVERY_ID: '',
};
async function start(extra = {}) {
  let log = '';
  server = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...common, ...extra },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [server.stdout, server.stderr]) stream.on('data', (chunk) => (log += chunk));
  for (let n = 0; n < 120; n++) {
    if (log.includes('PotyPet rodando')) return;
    if (server.exitCode !== null) throw Error(log);
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error('Startup timeout');
}
async function stop() {
  if (server && server.exitCode === null && server.signalCode === null) {
    const exit = new Promise((r) => server.once('exit', r));
    server.kill();
    await exit;
  }
  server = null;
}
function client() {
  const c = {
    cookie: '',
    call: async (method, route, body, expected = 200, headers = {}) => {
      const response = await fetch(base + route, {
        method,
        headers: { 'Content-Type': 'application/json', Cookie: c.cookie, ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await response.json();
      assert.equal(response.status, expected, route + ': ' + JSON.stringify(data));
      const cookie = response.headers.get('set-cookie');
      if (cookie) c.cookie = cookie.split(';')[0];
      return { data, cookie, status: response.status, headers: response.headers };
    },
  };
  return c;
}
const registration = (email) => ({
  name: 'Pessoa de teste',
  email,
  password: 'TesteSeguro9',
  passwordConfirmation: 'TesteSeguro9',
  accountType: 'usuario',
  city: 'Apodi',
  state: 'RN',
  phone: '84999999999',
  termsAccepted: true,
});
async function message(email, subject) {
  const preview = path.join(directory, 'email-preview');
  for (let n = 0; n < 220; n++) {
    if (fs.existsSync(preview)) {
      for (const name of fs.readdirSync(preview)) {
        const content = JSON.parse(fs.readFileSync(path.join(preview, name), 'utf8'));
        if (content.to.some((to) => to.address === email) && content.subject.includes(subject)) {
          fs.unlinkSync(path.join(preview, name));
          return content;
        }
      }
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error('E-mail fictício não encontrado: ' + email + ' / ' + subject);
}
function tokenOf(message) {
  const link = message.text.match(/https?:\/\/[^\s]+#token=([A-Za-z0-9_-]{43})/);
  assert.ok(link, 'Link esperado no e-mail');
  assert.ok(link[0].startsWith(base));
  return link[1];
}
function hash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
const pass = (name) => console.log('OK email — ' + name);
(async () => {
  try {
    await start();
    db = new DatabaseSync(path.join(directory, 'adotapet.db'));
    const guest = client(),
      admin = client(),
      person = client(),
      other = client();
    await admin.call('POST', '/api/auth/login', {
      email: 'admin@adotapet.com',
      password: 'admin123',
    });
    assert.equal((await guest.call('GET', '/api/animals')).data.length, 0);
    assert.equal((await guest.call('GET', '/api/missing')).data.length, 0);
    pass('instalação limpa não expõe anúncios de exemplo');
    const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    const signup = await guest.call(
      'POST',
      '/api/auth/register',
      registration('nova@example.test'),
      202,
      { Host: 'evil.example' },
    );
    assert.equal(signup.cookie, null);
    assert.equal(signup.data.user, undefined);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, count);
    const signupToken = tokenOf(await message('nova@example.test', 'confirme'));
    assert.ok(!fs.readFileSync(path.join(directory, 'adotapet.db'), 'utf8').includes(signupToken));
    const outbox = db.prepare('SELECT * FROM mail_outbox').all();
    assert.ok(outbox.every((row) => !row.payload || !row.payload.includes('token=')));
    await guest.call(
      'POST',
      '/api/auth/login',
      { email: 'nova@example.test', password: 'TesteSeguro9' },
      401,
    );
    const duplicate = await guest.call(
      'POST',
      '/api/auth/register',
      registration('admin@adotapet.com'),
      202,
    );
    assert.deepEqual(duplicate.data, signup.data);
    assert.equal(duplicate.cookie, null);
    pass(
      'cadastro uniforme, sem sessão/conta antes da confirmação; tokens não ficam em texto no banco',
    );
    const tokenRow = db
      .prepare('SELECT * FROM auth_tokens WHERE token_hash=?')
      .get(hash(signupToken));
    assert.ok(tokenRow);
    assert.equal(tokenRow.expires_at - tokenRow.created_at, 86400000);
    await guest.call(
      'POST',
      '/api/auth/verify-email',
      { token: signupToken, password: 'errada' },
      400,
    );
    assert.equal(
      db.prepare('SELECT used_at FROM auth_tokens WHERE token_hash=?').get(hash(signupToken))
        .used_at,
      null,
    );
    const getLink = await fetch(base + '/confirmar-email.html#token=' + signupToken);
    assert.equal(getLink.status, 200);
    assert.equal(
      db.prepare('SELECT used_at FROM auth_tokens WHERE token_hash=?').get(hash(signupToken))
        .used_at,
      null,
    );
    await guest.call('POST', '/api/auth/verify-email', {
      token: signupToken,
      password: 'TesteSeguro9',
    });
    await guest.call(
      'POST',
      '/api/auth/verify-email',
      { token: signupToken, password: 'TesteSeguro9' },
      400,
    );
    await person.call('POST', '/api/auth/login', {
      email: 'nova@example.test',
      password: 'TesteSeguro9',
    });
    assert.equal((await person.call('GET', '/api/auth/me')).data.user.emailVerified, true);
    pass('confirmação exige a senha escolhida, não consome no GET e funciona uma vez');
    const registered = await guest.call(
      'POST',
      '/api/auth/register',
      registration('nova@example.test'),
      202,
    );
    assert.deepEqual(registered.data, signup.data);
    const existing = db.prepare('SELECT * FROM users WHERE email=?').get('nova@example.test');
    assert.equal(existing.name, 'Pessoa de teste');
    assert.ok(existing.email_verified_at);
    pass('novo cadastro não sobrescreve uma conta existente');
    const unknown = await guest.call('POST', '/api/auth/forgot-password', {
      email: 'ausente@example.test',
    });
    const known = await guest.call('POST', '/api/auth/forgot-password', {
      email: 'nova@example.test',
    });
    assert.deepEqual(unknown.data, known.data);
    assert.equal(known.cookie, null);
    const resetToken = tokenOf(await message('nova@example.test', 'redefinir'));
    const resetRow = db
      .prepare('SELECT * FROM auth_tokens WHERE token_hash=?')
      .get(hash(resetToken));
    assert.equal(resetRow.expires_at - resetRow.created_at, 1800000);
    await guest.call(
      'POST',
      '/api/auth/reset-password',
      { token: signupToken, password: 'NovaSenha10', passwordConfirmation: 'NovaSenha10' },
      400,
    );
    await guest.call(
      'POST',
      '/api/auth/reset-password',
      { token: resetToken, password: 'curta', passwordConfirmation: 'curta' },
      400,
    );
    await guest.call(
      'POST',
      '/api/auth/reset-password',
      { token: resetToken, password: 'NovaSenha10', passwordConfirmation: 'diferente' },
      400,
    );
    const attempts = await Promise.all(
      [1, 2].map(() =>
        fetch(base + '/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: resetToken,
            password: 'NovaSenha10',
            passwordConfirmation: 'NovaSenha10',
          }),
        }),
      ),
    );
    assert.deepEqual(attempts.map((r) => r.status).sort(), [200, 400]);
    await person.call('GET', '/api/auth/me', undefined, 401);
    await admin.call('GET', '/api/auth/me');
    await person.call(
      'POST',
      '/api/auth/login',
      { email: 'nova@example.test', password: 'TesteSeguro9' },
      401,
    );
    await person.call('POST', '/api/auth/login', {
      email: 'nova@example.test',
      password: 'NovaSenha10',
    });
    pass(
      'recuperação uniforme, validade 30 min, um uso mesmo em corrida e revogação só das sessões do titular',
    );
    const org = registration('grupo@example.test');
    org.accountType = 'ong';
    org.organizationKind = 'grupo';
    await guest.call('POST', '/api/auth/register', org, 202);
    const orgToken = tokenOf(await message(org.email, 'confirme'));
    const confirmed = await guest.call('POST', '/api/auth/verify-email', {
      token: orgToken,
      password: org.password,
    });
    assert.equal(confirmed.data.pendingApproval, true);
    await other.call('POST', '/api/auth/login', { email: org.email, password: org.password }, 403);
    const orgUser = db.prepare('SELECT * FROM users WHERE email=?').get(org.email);
    await admin.call('POST', '/api/users/' + orgUser.id + '/approve', {});
    await other.call('POST', '/api/auth/login', { email: org.email, password: org.password });
    pass('confirmar e-mail da ONG preserva a análise administrativa');
    await guest.call('POST', '/api/auth/register', registration('expira@example.test'), 202);
    const expired = tokenOf(await message('expira@example.test', 'confirme'));
    db.prepare('UPDATE auth_tokens SET expires_at=? WHERE token_hash=?').run(
      Date.now() - 1,
      hash(expired),
    );
    await guest.call(
      'POST',
      '/api/auth/verify-email',
      { token: expired, password: 'TesteSeguro9' },
      400,
    );
    pass('link expirado é rejeitado');
    const absent = await guest.call('POST', '/api/auth/resend-verification', {
      email: 'ausente@example.test',
    });
    const verified = await guest.call('POST', '/api/auth/resend-verification', {
      email: 'nova@example.test',
    });
    assert.deepEqual(absent.data, verified.data);
    const pending = await guest.call('POST', '/api/auth/resend-verification', {
      email: 'expira@example.test',
    });
    assert.deepEqual(pending.data, absent.data);
    pass('reenvio uniforme para endereços desconhecidos, confirmados ou pendentes');
    await guest.call(
      'POST',
      '/api/auth/register',
      registration('senha-pendente@example.test'),
      202,
    );
    await guest.call('POST', '/api/auth/forgot-password', { email: 'senha-pendente@example.test' });
    const pendingReset = tokenOf(await message('senha-pendente@example.test', 'redefinir'));
    await guest.call('POST', '/api/auth/reset-password', {
      token: pendingReset,
      password: 'NovaPendente10',
      passwordConfirmation: 'NovaPendente10',
    });
    const recoveredPending = db
      .prepare('SELECT * FROM users WHERE email=?')
      .get('senha-pendente@example.test');
    assert.ok(recoveredPending.email_verified_at);
    assert.equal(recoveredPending.role, 'adotante');
    assert.equal(
      db
        .prepare('SELECT COUNT(*) AS n FROM auth_tokens WHERE email=? AND used_at IS NULL')
        .get('senha-pendente@example.test').n,
      0,
    );
    pass('senha esquecida antes da confirmação também pode ser recuperada pelo titular do e-mail');
    // Simulate migration of a previously registered ordinary user without deleting any data.
    db.prepare('UPDATE users SET email_verified_at=NULL WHERE id=?').run(existing.id);
    await person.call('GET', '/api/auth/me', undefined, 401);
    const blocked = await person.call(
      'POST',
      '/api/auth/login',
      { email: 'nova@example.test', password: 'NovaSenha10' },
      403,
    );
    assert.equal(blocked.data.code, 'EMAIL_NOT_VERIFIED');
    db.prepare('DELETE FROM mail_requests').run();
    await guest.call('POST', '/api/auth/resend-verification', { email: 'nova@example.test' });
    const migrationToken = tokenOf(await message('nova@example.test', 'confirme'));
    await guest.call('POST', '/api/auth/verify-email', {
      token: migrationToken,
      password: 'NovaSenha10',
    });
    assert.equal(
      db.prepare('SELECT id FROM users WHERE email=?').get('nova@example.test').id,
      existing.id,
    );
    pass('migração preserva usuário e senha; sessão antiga é bloqueada até confirmar');
    // A queued message survives a process restart with the same encryption key.
    db.prepare('DELETE FROM mail_requests').run();
    await guest.call('POST', '/api/auth/forgot-password', { email: 'nova@example.test' });
    await stop();
    await start();
    const durable = tokenOf(await message('nova@example.test', 'redefinir'));
    assert.ok(db.prepare('SELECT * FROM auth_tokens WHERE token_hash=?').get(hash(durable)));
    pass('fila e link sobrevivem a reinício');
    const before = db
      .prepare(
        "SELECT COUNT(*) AS n FROM auth_tokens WHERE email='nova@example.test' AND purpose='reset'",
      )
      .get().n;
    await guest.call('POST', '/api/auth/forgot-password', { email: 'nova@example.test' });
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM auth_tokens WHERE email='nova@example.test' AND purpose='reset'",
        )
        .get().n,
      before,
    );
    const codes = [];
    for (let i = 0; i < 7; i++) {
      const r = await fetch(base + '/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'unknown' + i + '@example.test' }),
      });
      codes.push(r.status);
    }
    assert.equal(codes.at(-1), 429);
    pass('reenvios têm intervalo por destinatário e limite por IP');
    await admin.call('GET', '/api/admin/launch-status');
    await guest.call('GET', '/api/admin/launch-status', undefined, 401);
    pass('diagnóstico de publicação é exclusivo do administrador');
    const settings = require('../lib/mail-service.cjs').settings;
    const production = {
      NODE_ENV: 'production',
      EMAIL_TRANSPORT: 'smtp',
      PUBLIC_BASE_URL: 'https://appet.example.test',
      MAIL_FROM: 'sender@example.test',
      MAIL_QUEUE_KEY: key,
      SMTP_HOST: 'smtp.example.test',
      SMTP_USER: 'sender',
      SMTP_PASSWORD: 'test-secret',
    };
    const tls = settings(production);
    assert.equal(tls.smtp.requireTLS, true);
    assert.equal(tls.smtp.tls.rejectUnauthorized, true);
    assert.equal(tls.smtp.logger, false);
    for (const overrides of [
      { EMAIL_TRANSPORT: 'file' },
      { EMAIL_TRANSPORT: 'disabled' },
      { PUBLIC_BASE_URL: 'http://appet.example.test' },
      { PUBLIC_BASE_URL: 'https://appet.example.test/redirect' },
      { MAIL_QUEUE_KEY: 'x' },
      { SMTP_PASSWORD: '' },
      { SMTP_PORT: '25' },
      { MAIL_FROM: 'sender@example.test\r\nBcc: other@example.test' },
    ])
      assert.throws(() => settings({ ...production, ...overrides }));
    pass(
      'produção exige modo SMTP, HTTPS, segredo de fila e configuração TLS; nenhuma entrega real foi testada',
    );
    await stop();
    await start({
      NODE_ENV: 'production',
      DATA_DIR: productionDirectory,
      SEED_DEMO_ACCOUNTS: '0',
      COOKIE_SECURE: '1',
      EMAIL_TRANSPORT: 'smtp',
      PUBLIC_BASE_URL: 'https://appet.example.test',
      SMTP_HOST: 'smtp.example.invalid',
      SMTP_PORT: '465',
      SMTP_USER: 'qa',
      SMTP_PASSWORD: 'test-secret',
      ADMIN_PASSWORD: 'AdministradorSeguro123!',
      DONOR_PASSWORD: 'ResponsavelSeguro456!',
    });
    const operator = client(),
      login = await operator.call('POST', '/api/auth/login', {
        email: 'admin@adotapet.com',
        password: 'AdministradorSeguro123!',
      });
    assert.match(login.cookie, /; Secure/);
    assert.equal((await operator.call('GET', '/api/animals')).data.length, 0);
    const readiness = (await operator.call('GET', '/api/admin/launch-status')).data;
    assert.equal(readiness.production, true);
    assert.equal(readiness.samplesDisabled, true);
    assert.equal(readiness.email.enabled, true);
    pass(
      'inicialização de produção, perfil administrativo, cookie Secure e base vazia; sem conectar ao SMTP',
    );
    console.log('OK — testes de confirmação e recuperação concluídos, sem envio de e-mail real.');
  } finally {
    await stop();
    db?.close();
    assert.ok(directory.startsWith(os.tmpdir() + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
    assert.ok(
      productionDirectory.startsWith(path.dirname(root) + path.sep + '.appet-email-production-'),
    );
    fs.rmSync(productionDirectory, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
