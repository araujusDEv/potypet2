'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  crypto = require('node:crypto'),
  assert = require('node:assert/strict');
const { spawn } = require('node:child_process'),
  { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..'),
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'potypet-photo-race-')),
  base = 'http://127.0.0.1:3194',
  key = crypto.randomBytes(32).toString('base64'),
  cases = [];
let server,
  waits = new Map(),
  seq = 0;
const sql = (fn) => {
  const db = new DatabaseSync(path.join(dir, 'adotapet.db'));
  try {
    return fn(db);
  } finally {
    db.close();
  }
};
const stored = () =>
  sql((db) =>
    JSON.parse(db.prepare("SELECT value FROM app_state WHERE key='animals'").get().value),
  );
async function start() {
  let log = '';
  server = spawn(
    process.execPath,
    ['--require', './tests/helpers/photo-barrier.cjs', 'server.js'],
    {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        POTYPET_CONCURRENCY_PROJECT: root,
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: '3194',
        DATA_DIR: dir,
        EMAIL_TRANSPORT: 'file',
        MAIL_FROM: 'qa@example.test',
        MAIL_QUEUE_KEY: key,
        PUBLIC_BASE_URL: base,
        BACKUP_AUTO: '0',
        COOKIE_SECURE: '0',
        SEED_DEMO_ACCOUNTS: '1',
        SEED_SAMPLE_DATA: '0',
        ADMIN_EMAIL: 'admin@adotapet.com',
        ADMIN_PASSWORD: '',
        DONOR_EMAIL: 'ong@adotapet.com',
        DONOR_PASSWORD: '',
        ADMIN_RECOVERY_ID: '',
        ANIMAL_APPROVAL_MIN_PHOTOS: '1',
        ANIMAL_APPROVAL_REQUIRE_DESCRIPTION: '1',
      },
    },
  );
  server.on('message', (m) => {
    const id = m.type + ':' + m.id,
      w = waits.get(id);
    if (w) {
      clearTimeout(w.timer);
      waits.delete(id);
      w.resolve(m);
    }
  });
  for (const s of [server.stdout, server.stderr]) s.on('data', (d) => (log += d));
  for (let n = 0; !log.includes('PotyPet rodando'); n++) {
    if (n > 300 || server.exitCode !== null) throw Error(log);
    await new Promise((r) => setTimeout(r, 50));
  }
}
function event(type, id) {
  return new Promise((resolve, reject) =>
    waits.set(type + ':' + id, {
      resolve,
      timer: setTimeout(() => {
        waits.delete(type + ':' + id);
        reject(Error('Barreira sem resposta.'));
      }, 15000),
    }),
  );
}
async function raw(client, route, body) {
  const r = await fetch(base + route, {
    method: 'PATCH',
    headers: { Cookie: client.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}
async function pause(call) {
  const id = ++seq,
    armed = event('armed', id);
  server.send({ type: 'arm', kind: 'image', id });
  await armed;
  const held = event('held', id),
    pending = call();
  await held;
  return async () => {
    server.send({ type: 'release', id });
    return pending;
  };
}
async function test(name, fn) {
  await fn();
  cases.push({ name, status: 'pass' });
  console.log('OK revisão concorrente — ' + name);
}
(async () => {
  try {
    await start();
    const f = await require('./etapa1-fixtures.cjs')({ base, dataDir: dir, email: true }),
      { admin, owner } = f.clients,
      id = f.animals.pending.id,
      decision = { approvalStatus: 'approved', reason: 'Revisão fictícia concorrente.' };
    await test('Cadastro durante conferência de aprovação é preservado', async () => {
      const resume = await pause(() => raw(admin, '/api/animals/' + id, decision));
      const created = await owner.call(
        'POST',
        '/api/animals',
        { name: 'Cadastro concorrente fictício', city: 'Apodi', state: 'RN' },
        201,
      );
      assert.equal((await resume()).status, 200);
      assert.ok(stored().some((a) => a.id === created.id));
    });
    await test('Descrição alterada durante conferência exige nova revisão, sem perder edição', async () => {
      const resume = await pause(() => raw(admin, '/api/animals/' + id, decision));
      await owner.call('PATCH', '/api/animals/' + id, {
        description: 'Descrição nova durante revisão.',
      });
      assert.equal((await resume()).status, 409);
      const a = stored().find((a) => a.id === id);
      assert.equal(a.description, 'Descrição nova durante revisão.');
      assert.equal(a.approvalStatus, 'pending');
    });
    await test('Reprovação simultânea não é desfeita pela aprovação atrasada', async () => {
      const resume = await pause(() => raw(admin, '/api/animals/' + id, decision));
      await admin.call('PATCH', '/api/animals/' + id, {
        approvalStatus: 'rejected',
        reason: 'Outra decisão concluída primeiro.',
      });
      const rejected = stored().find((a) => a.id === id);
      assert.equal((await resume()).status, 409);
      assert.deepEqual(
        stored().find((a) => a.id === id),
        rejected,
      );
    });
    await test('Contadores atuais sobrevivem à aprovação após processamento', async () => {
      const resume = await pause(() => raw(admin, '/api/animals/' + id, decision));
      await owner.call('POST', '/api/animals/' + id + '/view', {});
      const views = stored().find((a) => a.id === id).views;
      assert.equal((await resume()).status, 200);
      assert.equal(stored().find((a) => a.id === id).views, views);
    });
    await test('Sessão revogada durante conferência impede aprovação', async () => {
      const before = stored().find((a) => a.id === id),
        resume = await pause(() => raw(admin, '/api/animals/' + id, decision));
      await admin.call('POST', '/api/auth/logout', {});
      assert.equal((await resume()).status, 401);
      assert.deepEqual(
        stored().find((a) => a.id === id),
        before,
      );
      await admin.call('POST', '/api/auth/login', {
        email: 'admin@adotapet.com',
        password: 'admin123',
      });
    });
    await test('Perda de papel administrativo durante conferência impede aprovação', async () => {
      const before = stored().find((a) => a.id === id),
        resume = await pause(() => raw(admin, '/api/animals/' + id, decision));
      sql((db) =>
        db.prepare("UPDATE users SET role='adotante',account_type='usuario' WHERE id=1").run(),
      );
      try {
        assert.equal((await resume()).status, 403);
        assert.deepEqual(
          stored().find((a) => a.id === id),
          before,
        );
      } finally {
        sql((db) =>
          db.prepare("UPDATE users SET role='admin',account_type='admin' WHERE id=1").run(),
        );
      }
    });
  } finally {
    if (process.env.PHOTO_CONCURRENCY_RESULTS)
      fs.writeFileSync(
        process.env.PHOTO_CONCURRENCY_RESULTS,
        JSON.stringify(
          { cases, synchronization: 'IPC privado após decodificação real, fora de transação.' },
          null,
          2,
        ),
      );
    if (server?.exitCode === null && server.signalCode === null) {
      const done = new Promise((r) => server.once('exit', r));
      server.kill();
      await done;
    }
    for (const w of waits.values()) clearTimeout(w.timer);
    assert.ok(dir.startsWith(os.tmpdir() + path.sep + 'potypet-photo-race-'));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
