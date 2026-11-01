'use strict';
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  { spawn } = require('node:child_process'),
  { DatabaseSync } = require('node:sqlite');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adotapet-migration-')),
  root = path.resolve(__dirname, '..');
let child, db;
async function start() {
  child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      ADMIN_EMAIL: 'admin@adotapet.com',
      ADMIN_PASSWORD: '',
      DONOR_EMAIL: 'ong@adotapet.com',
      DONOR_PASSWORD: '',
      ADMIN_RECOVERY_ID: '',
      DONOR_NAME: '',
      NODE_ENV: 'test',
      EMAIL_TRANSPORT: 'disabled',
      SEED_SAMPLE_DATA: '1',
      BACKUP_AUTO: '0',
      HOST: '127.0.0.1',
      PORT: '3173',
      DATA_DIR: dir,
      SEED_DEMO_ACCOUNTS: '1',
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  await new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (output.includes('PotyPet rodando')) {
        clearInterval(timer);
        resolve();
      } else if (child.exitCode !== null) {
        clearInterval(timer);
        reject(Error(output));
      }
    }, 50);
    setTimeout(() => {
      clearInterval(timer);
      reject(Error('Startup timeout ' + output));
    }, 10000).unref();
  });
}
async function stop() {
  if (child && child.exitCode === null) {
    const exited = new Promise((r) => child.once('exit', r));
    child.kill();
    await exited;
  }
  child = null;
}
async function main() {
  try {
    await start();
    await stop();
    db = new DatabaseSync(path.join(dir, 'adotapet.db'));
    const get = (k) =>
      JSON.parse(db.prepare('SELECT value FROM app_state WHERE key=?').get(k).value);
    const set = (k, v) =>
      db.prepare('UPDATE app_state SET value=? WHERE key=?').run(JSON.stringify(v), k);
    // Datas relativas: a campanha precisa continuar dentro do prazo de 60 dias sem prestação de contas.
    const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const old = {
      id: 87,
      animalId: 1,
      animalName: 'Bidu',
      city: 'Apodi',
      state: 'RN',
      title: 'Campanha anterior preservada',
      description: 'Registro de teste representando uma campanha já publicada.',
      category: 'tratamento',
      organizer: 'Equipe anterior',
      beneficiary: 'Beneficiário anterior',
      contact: 'teste@example.test',
      pixKeyType: 'aleatoria',
      pixKey: '00000000-0000-0000-0000-000000000000',
      goalCents: 500000,
      raisedCents: 7500,
      status: 'active',
      revision: 4,
      createdBy: 1,
      createdAt: daysAgo(30),
      updatedAt: daysAgo(10),
      updates: [
        { note: 'Apuração anterior', raisedCents: 7500, createdAt: daysAgo(10) },
      ],
    };
    set('campaigns', [
      old,
      { ...old, id: 88, status: 'draft', title: 'Rascunho privado anterior' },
    ]);
    const animals = get('animals');
    animals[0].status = 'adotado';
    for (const a of animals) delete a.approvalStatus;
    set('animals', animals);
    const keys = [
      'requests',
      'missing',
      'sightings',
      'favorites',
      'reports',
      'adoptionProfiles',
      'notifications',
      'contracts',
      'followups',
      'supportPoints',
    ];
    const preserved = Object.fromEntries(keys.map((k) => [k, get(k)])),
      users = db.prepare('SELECT id,email,password_hash FROM users ORDER BY id').all();
    db.close();
    await start();
    let campaigns = await (await fetch('http://127.0.0.1:3173/api/campaigns')).json();
    assert.equal(campaigns.length, 1);
    assert.equal(campaigns[0].id, 87);
    assert.equal(campaigns[0].animalId, 1);
    assert.equal(campaigns[0].raisedCents, 7500);
    assert.equal(campaigns[0].pixKey, old.pixKey);
    assert.equal(campaigns[0].canDonate, true);
    await stop();
    db = new DatabaseSync(path.join(dir, 'adotapet.db'));
    const upgraded = get('campaigns');
    assert.deepEqual(upgraded[0].legacy, old);
    assert.equal(get('animals')[0].status, 'adotado');
    for (const key of keys) {
      const current = get(key);
      assert.deepEqual(
        key === 'notifications' ? current.slice(0, preserved[key].length) : current,
        preserved[key],
        key + ' preserved',
      );
    }
    assert.ok(
      get('notifications').some(
        (n) => n.message.includes('Campanha #87') && n.message.includes('prestação de contas'),
      ),
    );
    assert.deepEqual(
      db.prepare('SELECT id,email,password_hash FROM users ORDER BY id').all(),
      users,
    );
    db.close();
    await start();
    await stop();
    db = new DatabaseSync(path.join(dir, 'adotapet.db'));
    assert.deepEqual(get('campaigns'), upgraded);
    db.close();
    console.log(
      'OK — migração idempotente preserva contas, senhas, vínculos, Pix, totais, histórico e demais coleções.',
    );
  } finally {
    try {
      db?.close();
    } catch {}
    await stop();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
