'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adotapet-regressions-'));
const port = 3171;
const base = `http://127.0.0.1:${port}`;
let server, exited;

async function start() {
  let output = '';
  server = spawn(process.execPath, ['server.js'], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DONOR_EMAIL: 'ong@adotapet.com',
      DONOR_PASSWORD: '',
      ADMIN_RECOVERY_ID: '',
      DONOR_NAME: '',
      NODE_ENV: 'test',
      EMAIL_TRANSPORT: 'disabled',
      SEED_SAMPLE_DATA: '1',
      BACKUP_AUTO: '0',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATA_DIR: dir,
      SEED_DEMO_ACCOUNTS: '1',
      COOKIE_SECURE: '0',
      TRUST_PROXY: '0',
      ADMIN_EMAIL: 'admin@adotapet.com',
      ADMIN_PASSWORD: 'admin123',
    },
  });
  exited = new Promise((resolve) => server.once('exit', resolve));
  server.stdout.on('data', (data) => {
    output += data;
  });
  server.stderr.on('data', (data) => {
    output += data;
  });
  for (let i = 0; !output.includes('PotyPet rodando'); i++) {
    if (server.exitCode !== null || i >= 100) throw Error('Startup failed: ' + output);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal((await fetch(base + '/api/health')).status, 200);
}
async function stop() {
  if (!server) return;
  server.kill();
  await exited;
  server = null;
}
function client() {
  let cookie = '';
  return async (method, route, body, expected = 200) => {
    const response = await fetch(base + route, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body:
        body === undefined
          ? undefined
          : JSON.stringify(
              method === 'POST' && route === '/api/requests'
                ? require('./adoption-fixture.cjs')(body)
                : body,
            ),
    });
    if (response.headers.get('set-cookie'))
      cookie = response.headers.get('set-cookie').split(';')[0];
    const payload = await response.json();
    assert.equal(
      response.status,
      expected,
      `${method} ${route}: ${JSON.stringify(payload).slice(0, 250)}`,
    );
    return payload;
  };
}
async function register(api, name) {
  return api(
    'POST',
    '/api/auth/register',
    {
      name,
      email: `${name}@example.test`,
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
}
const animalBody = {
  name: 'Animal de teste',
  city: 'Apodi',
  state: 'RN',
  description: 'Animal fictício para revisão.',
  photos: ['img/animal1.png'],
};
function rawRequest(requestPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port, path: requestPath, headers },
      (response) => {
        let body = '';
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () =>
          resolve({ status: response.statusCode, headers: response.headers, body }),
        );
      },
    );
    request.on('error', reject);
    request.setTimeout(3000, () => request.destroy(Error('Request timeout')));
    request.end();
  });
}
function editDatabase(edit) {
  const db = new DatabaseSync(path.join(dir, 'adotapet.db'));
  const load = (key) =>
    JSON.parse(db.prepare('SELECT value FROM app_state WHERE key=?').get(key).value);
  const save = (key, value) =>
    db.prepare('UPDATE app_state SET value=? WHERE key=?').run(JSON.stringify(value), key);
  try {
    edit({ db, load, save });
  } finally {
    db.close();
  }
}

(async () => {
  try {
    await start();
    const admin = client(),
      owner = client(),
      applicant = client(),
      attacker = client();
    await admin('POST', '/api/auth/login', { email: 'admin@adotapet.com', password: 'admin123' });
    const ownerAccount = await register(owner, 'owner');
    await register(applicant, 'applicant');
    await register(attacker, 'attacker');
    await attacker('GET', '/api/users', undefined, 403);
    assert.ok((await admin('GET', '/api/users')).length >= 5);
    const animal = await owner('POST', '/api/animals', animalBody, 201);
    await admin('PATCH', `/api/animals/${animal.id}`, {
      status: 'disponivel',
      approvalStatus: 'approved',
      reason: 'Revisão administrativa de fixture de teste.',
    });
    const request = await applicant(
      'POST',
      '/api/requests',
      {
        animalId: animal.id,
        full_name: 'Informação privada',
        responsibility_confirmed: true,
        reason: 'Privado',
      },
      201,
    );
    assert.equal(request.ownerId, ownerAccount.user.id);
    assert.ok(
      (await owner('GET', '/api/requests')).find((r) => r.id === request.id).requester.email,
    );
    await applicant('POST', '/api/favorites/toggle', { animalId: animal.id });
    await owner('DELETE', `/api/animals/${animal.id}`);
    const replacement = await attacker('POST', '/api/animals', animalBody, 201);
    assert.ok(replacement.id > animal.id, 'Deleted animal IDs must never be reused');
    assert.ok(!(await attacker('GET', '/api/requests')).some((r) => r.id === request.id));
    await attacker('POST', `/api/requests/${request.id}/analyze`, {}, 403);
    assert.ok(
      !(await applicant('GET', '/api/favorites')).some((f) => f.animalId === replacement.id),
    );
    await attacker('DELETE', `/api/animals/${replacement.id}`);
    await stop();
    await start();
    const afterRestart = await attacker('POST', '/api/animals', animalBody, 201);
    assert.ok(
      afterRestart.id > replacement.id,
      'Counter must survive restart even without remaining references',
    );
    console.log(
      'OK — no ID reuse, no leaked requests, no unauthorized changes, counters survive restart.',
    );

    // Simulate an older database, including orphaned references and previously collided IDs.
    await stop();
    editDatabase(({ db, load, save }) => {
      db.exec('DROP TABLE id_sequences');
      const requests = load('requests');
      requests.push({ ...request, id: 2000, animalId: 5000, ownerId: undefined });
      requests.push({ ...request, id: 2001, animalId: afterRestart.id });
      requests.push({
        ...request,
        id: 2002,
        animalId: afterRestart.id,
        ownerId: undefined,
        createdAt: '2000-01-01T00:00:00.000Z',
      });
      save('requests', requests);
      save('sightings', [{ id: 1, missingAnimalId: 7000 }]);
      save('contracts', [{ id: 1, requestId: 3000, animalId: 6000 }]);
      const animals = load('animals');
      animals.push({ ...afterRestart, id: 9000 });
      save('animals', animals);
    });
    await start();
    await attacker('DELETE', '/api/animals/9000');
    const migratedAnimal = await admin('POST', '/api/animals', animalBody, 201);
    assert.ok(
      migratedAnimal.id > 9000,
      'Startup captures legacy IDs even when deleted before the first allocation',
    );
    const migratedRequest = await applicant(
      'POST',
      '/api/requests',
      { animalId: migratedAnimal.id, responsibility_confirmed: true },
      201,
    );
    assert.ok(migratedRequest.id > 3000, 'Orphaned contracts reserve request IDs');
    const missing = await owner(
      'POST',
      '/api/missing',
      { city: 'Apodi', state: 'RN', missing_date: '2026-09-23' },
      201,
    );
    assert.ok(missing.id > 7000, 'Orphaned sightings reserve missing-animal IDs');
    for (const id of [request.id, 2000, 2001, 2002]) {
      assert.ok(!(await attacker('GET', '/api/requests')).some((r) => r.id === id));
      await attacker('POST', `/api/requests/${id}/analyze`, {}, 403);
    }
    console.log(
      'OK — legacy references reserved; owner mismatch and older colliding requests blocked.',
    );

    for (const [route, headers] of [
      ['/', { Host: '[' }],
      ['/%E0%A4%A', {}],
      ['/%', {}],
    ]) {
      const response = await rawRequest(route, headers);
      assert.equal(response.status, 400);
      assert.equal(response.headers['x-frame-options'], 'DENY');
      assert.equal(
        (await fetch(base + '/api/health')).status,
        200,
        'Server must survive malformed input',
      );
    }
    assert.equal((await rawRequest('/api/users', { Cookie: 'petadopt_session=%' })).status, 401);
    for (const body of ['null', '[]', '"text"', '{broken']) {
      const response = await fetch(base + '/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      assert.equal(response.status, 400);
    }
    assert.equal((await fetch(base + '/api/health')).status, 200);
    console.log('OK — malformed Host, URLs, cookies and JSON do not crash the server.');
  } finally {
    await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
