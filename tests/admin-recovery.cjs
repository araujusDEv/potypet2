'use strict';
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { spawn } = require('node:child_process'),
  { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..');
const data = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'appet-recovery-'));
let running = null;
async function stop() {
  if (running) {
    const p = running;
    running = null;
    const exited = new Promise((resolve) => p.once('exit', resolve));
    p.kill();
    await exited;
  }
}
async function start(extra = {}, expectedError = '') {
  let log = '';
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    EMAIL_TRANSPORT: 'disabled',
    SEED_SAMPLE_DATA: '1',
    BACKUP_AUTO: '0',
    PORT: '3188',
    HOST: '127.0.0.1',
    DATA_DIR: data,
    SEED_DEMO_ACCOUNTS: '1',
    ADMIN_EMAIL: 'admin@adotapet.com',
    ADMIN_PASSWORD: '',
    ADMIN_RECOVERY_ID: '',
    DONOR_EMAIL: 'ong@adotapet.com',
    DONOR_PASSWORD: '',
    ...extra,
  };
  const p = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  running = p;
  p.stdout.on('data', (chunk) => (log += chunk));
  p.stderr.on('data', (chunk) => (log += chunk));
  for (let i = 0; i < 200; i++) {
    if (p.exitCode !== null) {
      running = null;
      if (expectedError) {
        assert.ok(log.includes(expectedError), log);
        return log;
      }
      throw Error(log);
    }
    if (log.includes('PotyPet rodando')) {
      assert.equal(expectedError, '', 'Expected rejected configuration');
      return log;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw Error('Startup timeout');
}
async function request(method, route, body, cookie = '') {
  const r = await fetch('http://127.0.0.1:3188' + route, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: r.status,
    body: await r.json(),
    cookie: r.headers.get('set-cookie')?.split(';')[0],
  };
}
function snapshot() {
  const db = new DatabaseSync(path.join(data, 'adotapet.db'), { readOnly: true });
  try {
    return {
      users: db.prepare('SELECT * FROM users ORDER BY id').all(),
      state: db
        .prepare("SELECT * FROM app_state WHERE key NOT LIKE 'admin-recovery:%' ORDER BY key")
        .all(),
      markers: db
        .prepare("SELECT COUNT(*) n FROM app_state WHERE key LIKE 'admin-recovery:%'")
        .get().n,
    };
  } finally {
    db.close();
  }
}
(async () => {
  await start();
  const old = await request('POST', '/api/auth/login', {
    email: 'admin@adotapet.com',
    password: 'admin123',
  });
  assert.equal(old.status, 200);
  const ong = await request('POST', '/api/auth/login', {
    email: 'ong@adotapet.com',
    password: 'doador123',
  });
  assert.equal(ong.status, 200);
  const before = snapshot();
  await stop();
  const id = 'recovery-integration-20261003',
    password = 'NewAdminTestOnly2026';
  const log = await start({ ADMIN_RECOVERY_ID: id, ADMIN_PASSWORD: password });
  assert.ok(log.includes('Recuperacao administrativa concluida'));
  assert.ok(!log.includes(password));
  assert.equal(
    (
      await request('POST', '/api/auth/login', {
        email: 'admin@adotapet.com',
        password: 'admin123',
      })
    ).status,
    401,
  );
  assert.equal(
    (await request('POST', '/api/auth/login', { email: 'admin@adotapet.com', password })).status,
    200,
  );
  assert.equal((await request('GET', '/api/auth/me', null, old.cookie)).status, 401);
  assert.equal((await request('GET', '/api/auth/me', null, ong.cookie)).status, 200);
  const after = snapshot();
  assert.deepEqual(after.state, before.state);
  assert.equal(after.markers, 1);
  assert.deepEqual(after.users[1], before.users[1]);
  for (const key of Object.keys(before.users[0]))
    if (!['password_hash', 'password_salt'].includes(key))
      assert.deepEqual(after.users[0][key], before.users[0][key], key);
  await stop();
  await start({ ADMIN_RECOVERY_ID: id, ADMIN_PASSWORD: 'DifferentPassword2026' });
  assert.equal(
    (await request('POST', '/api/auth/login', { email: 'admin@adotapet.com', password })).status,
    200,
  );
  assert.equal(snapshot().markers, 1);
  await stop();
  await start({
    ADMIN_RECOVERY_ID: 'recovery-another-request',
    ADMIN_PASSWORD: 'SecondNewPassword2026',
  });
  assert.equal(
    (
      await request('POST', '/api/auth/login', {
        email: 'admin@adotapet.com',
        password: 'SecondNewPassword2026',
      })
    ).status,
    200,
  );
  await stop();
  const final = snapshot();
  await start(
    {
      ADMIN_RECOVERY_ID: 'recovery-non-admin-test',
      ADMIN_EMAIL: 'ong@adotapet.com',
      ADMIN_PASSWORD: 'RejectedPassword2026',
    },
    'conta administrativa existente',
  );
  assert.deepEqual(snapshot(), final);
  await start(
    { ADMIN_RECOVERY_ID: 'recovery-invalid-pass', ADMIN_PASSWORD: 'short1' },
    '12 a 128 caracteres',
  );
  assert.deepEqual(snapshot(), final);
  await start();
  assert.equal(
    (
      await request('POST', '/api/auth/login', {
        email: 'admin@adotapet.com',
        password: 'SecondNewPassword2026',
      })
    ).status,
    200,
  );
  console.log(
    'OK — recuperacao unica, nova senha valida, senha anterior e sessoes revogadas, ONG/dados preservados, repeticao ignorada, senha fraca e conta nao administrativa rejeitadas.',
  );
})()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(stop);
