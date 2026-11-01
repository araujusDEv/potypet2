'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  crypto = require('node:crypto'),
  assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process'),
  { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..'),
  parent = path.dirname(root),
  dataDir = path.join(parent, '.appet-etapa6-test-' + crypto.randomUUID()),
  base = 'http://127.0.0.1:3187';
let child;
fs.mkdirSync(dataDir, { mode: 0o700 });
const pass = (name) => console.log('OK etapa6 — ' + name);
let finished = false;
process.once('beforeExit', () => {
  if (!finished) {
    console.error('Etapa 6 não completou todas as verificações.');
    process.exitCode = 1;
  }
});
const strong = {
  ADMIN_EMAIL: 'admin@adotapet.com',
  ADMIN_PASSWORD: 'AdministradorSeguro123!',
  DONOR_EMAIL: 'ong@adotapet.com',
  DONOR_PASSWORD: 'ResponsavelSeguro456!',
};
async function start(extra = {}) {
  let log = '';
  child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: '3187',
      DATA_DIR: dataDir,
      EMAIL_TRANSPORT: 'disabled',
      BACKUP_AUTO: '0',
      SEED_DEMO_ACCOUNTS: '0',
      SEED_SAMPLE_DATA: '',
      TRUST_PROXY: '0',
      TRUSTED_PROXY_IPS: '',
      PERSISTENT_DISK_PATH: '',
      ADMIN_RECOVERY_ID: '',
      ...strong,
      ...extra,
    },
  });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (d) => (log += d));
  for (let i = 0; !log.includes('PotyPet rodando'); i++) {
    if (i > 200 || child.exitCode !== null) throw Error(log);
    await new Promise((r) => setTimeout(r, 50));
  }
}
async function stop() {
  if (child?.exitCode === null && child.signalCode === null) {
    const done = new Promise((r) => child.once('exit', r));
    child.kill();
    await done;
  }
  child = null;
}
const client = () => {
  let cookie = '';
  return async (method, route, body, expected = 200) => {
    const r = await fetch(base + route, {
      method,
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    const value = await r.json();
    assert.equal(r.status, expected, route + ' ' + JSON.stringify(value));
    return value;
  };
};
function sql(fn) {
  const db = new DatabaseSync(path.join(dataDir, 'adotapet.db'));
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
(async () => {
  try {
    const expected = fs.readFileSync(path.join(root, '.node-version'), 'utf8').trim();
    assert.equal(expected, '24.21.0');
    assert.equal(process.versions.node, expected);
    assert.equal(require('../package.json').engines.node, '>=24.21.0 <25');
    assert.ok(
      fs.readFileSync(path.join(root, 'render.yaml'), 'utf8').includes('value: ' + expected),
    );
    assert.match(
      fs.readFileSync(path.join(root, '.github/workflows/test.yml'), 'utf8'),
      /node-version-file: '\.node-version'/,
    );
    pass('runtime de publicação, pacote, hospedagem e CI alinhados no Node 24.21.0 LTS');
    await start();
    const admin = client(),
      guest = client();
    await admin('POST', '/api/auth/login', {
      email: strong.ADMIN_EMAIL,
      password: strong.ADMIN_PASSWORD,
    });
    for (const route of ['/api/animals', '/api/missing', '/api/support-points'])
      assert.equal((await guest('GET', route)).length, 0);
    const status = await admin('GET', '/api/admin/launch-status');
    assert.equal(status.samplesDisabled, true);
    assert.equal(status.storage.persistenceVerified, false);
    assert.equal(status.runtime.version, expected);
    assert.equal(status.demonstration.weakAccounts.length, 0);
    assert.equal(status.demonstration.records.length, 0);
    await guest('GET', '/api/admin/launch-status', undefined, 401);
    assert.equal(
      (await admin('GET', '/api/users')).find((u) => u.id === 2).name,
      'Perfil responsável inicial',
    );
    pass(
      'instalação nova sem amostras, diagnóstico privado e sem afirmar persistência ou entrega real',
    );
    const pet = await admin(
      'POST',
      '/api/animals',
      {
        name: 'Registro real da fixture, sem exclusão automática',
        city: 'Apodi',
        state: 'RN',
        description: 'Registro fictício preservado na atualização.',
        photos: ['img/animal1.png'],
      },
      201,
    );
    const seed = JSON.parse(fs.readFileSync(path.join(root, 'data/seed.json'), 'utf8'));
    sql((db) => {
      const row = JSON.parse(
        db.prepare("SELECT value FROM app_state WHERE key='animals'").get().value,
      );
      row.push({ ...seed.animals[0], id: 900, ownerId: 2, approvalStatus: 'approved' });
      db.prepare("UPDATE app_state SET value=? WHERE key='animals'").run(JSON.stringify(row));
      db.prepare("UPDATE app_state SET value=? WHERE key='supportPoints'").run(
        JSON.stringify([{ ...seed.supportPoints[0], id: 950 }]),
      );
    });
    const before = sql((db) =>
      db
        .prepare(
          "SELECT key,value FROM app_state WHERE key IN ('animals','supportPoints') ORDER BY key",
        )
        .all(),
    );
    const report = await admin('GET', '/api/admin/launch-status');
    assert.ok(report.demonstration.records.some((r) => r.id === 900));
    assert.ok(!report.demonstration.records.some((r) => r.id === pet.id));
    assert.ok(report.demonstration.placeholders.some((r) => r.id === pet.id));
    assert.equal(report.demonstration.preconfigured.length, 1);
    assert.deepEqual(
      sql((db) =>
        db
          .prepare(
            "SELECT key,value FROM app_state WHERE key IN ('animals','supportPoints') ORDER BY key",
          )
          .all(),
      ),
      before,
    );
    await stop();
    await start({ SEED_SAMPLE_DATA: '1' });
    assert.deepEqual(
      sql((db) =>
        db
          .prepare(
            "SELECT key,value FROM app_state WHERE key IN ('animals','supportPoints') ORDER BY key",
          )
          .all(),
      ),
      before,
    );
    pass(
      'auditoria distingue origem de amostra, foto de exemplo e rede pré-cadastrada; consulta/reinício não apagam nem reimportam registros reais',
    );
    const storage = require('../lib/deployment-storage.cjs');
    assert.throws(
      () => storage({ root, dataDir: root, env: { NODE_ENV: 'production' } }),
      /pasta do código/,
    );
    assert.throws(
      () => storage({ root, dataDir: os.tmpdir(), env: { NODE_ENV: 'production' } }),
      /temporário/,
    );
    const mount = path.join(dataDir, 'mount');
    fs.mkdirSync(mount);
    assert.throws(() => storage({ root, dataDir, env: { PERSISTENT_DISK_PATH: mount } }), /dentro/);
    const checked = storage({
      root,
      dataDir,
      env: { NODE_ENV: 'production', PERSISTENT_DISK_PATH: parent },
    }).summary();
    assert.equal(checked.writable, true);
    assert.equal(checked.withinConfiguredMount, true);
    assert.equal(checked.persistenceVerified, false);
    assert.ok(checked.freeBytes > 0);
    if (process.platform !== 'win32') assert.equal(fs.statSync(dataDir).mode & 0o777, 0o700);
    const link = path.join(dataDir, 'code-link');
    fs.symlinkSync(root, link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(
      () => storage({ root, dataDir: link, env: { NODE_ENV: 'production' } }),
      /inclusive por link/,
    );
    fs.unlinkSync(link);
    pass(
      'diretório gravável, montagem configurada, permissões preparadas (POSIX condicionado ao sistema) e rejeição de pasta temporária/código inclusive por link; provedor permanece não verificado',
    );
    await stop();
    sql((db) => {
      const user = db.prepare('SELECT * FROM users WHERE role=?').get('admin'),
        salt = crypto.randomBytes(16).toString('hex'),
        hash = crypto.scryptSync('admin123', salt, 64).toString('hex');
      db.prepare('UPDATE users SET password_salt=?,password_hash=? WHERE id=?').run(
        salt,
        hash,
        user.id,
      );
    });
    const queueKey = crypto.randomBytes(32).toString('base64'),
      prod = {
        ...process.env,
        ...strong,
        NODE_ENV: 'production',
        DATA_DIR: dataDir,
        PERSISTENT_DISK_PATH: parent,
        SEED_DEMO_ACCOUNTS: '0',
        SEED_SAMPLE_DATA: '0',
        COOKIE_SECURE: '1',
        EMAIL_TRANSPORT: 'smtp',
        PUBLIC_BASE_URL: 'https://appet.example.test',
        MAIL_FROM: 'appet@example.test',
        MAIL_QUEUE_KEY: queueKey,
        SMTP_HOST: 'smtp.example.invalid',
        SMTP_PORT: '465',
        SMTP_USER: 'fixture',
        SMTP_PASSWORD: 'fixture-secret',
        BACKUP_AUTO: '0',
        TRUST_PROXY: '0',
        TRUSTED_PROXY_IPS: '',
        ADMIN_RECOVERY_ID: '',
      };
    const rejected = spawnSync(process.execPath, ['server.js'], {
      cwd: root,
      env: prod,
      windowsHide: true,
      encoding: 'utf8',
    });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /credenciais conhecidas/);
    pass(
      'produção recusa credenciais conhecidas de demonstração existentes sem apagar contas ou vínculos',
    );
    for (const list of ['0.0.0.0/0', '::/0', '127.0.0.1/32/qualquer']) {
      const r = spawnSync(process.execPath, ['-e', "require('./lib/client-ip.cjs')"], {
        cwd: root,
        env: { ...process.env, TRUSTED_PROXY_IPS: list },
        windowsHide: true,
        encoding: 'utf8',
      });
      assert.notEqual(r.status, 0);
    }
    const proxy = spawnSync(
      process.execPath,
      [
        '-e',
        "const f=require('./lib/client-ip.cjs'); console.log(JSON.stringify([f({socket:{remoteAddress:'198.51.100.20'},headers:{'x-forwarded-for':'1.1.1.1'}}),f({socket:{remoteAddress:'::ffff:127.0.0.1'},headers:{'x-forwarded-for':'1.1.1.1, 203.0.113.5'}}),f({socket:{remoteAddress:'127.0.0.1'},headers:{'x-forwarded-for':'invalid'}})]));",
      ],
      {
        cwd: root,
        env: { ...process.env, TRUST_PROXY: '1', TRUSTED_PROXY_IPS: '127.0.0.1/32' },
        windowsHide: true,
        encoding: 'utf8',
      },
    );
    assert.equal(proxy.status, 0);
    assert.deepEqual(JSON.parse(proxy.stdout), ['198.51.100.20', '203.0.113.5', '127.0.0.1']);
    pass(
      'proxy não confiável não usa headers; cadeia termina no primeiro salto não confiável; /0 e listas inválidas são recusados',
    );
    const settings = require('../lib/mail-service.cjs').settings;
    const config = settings(prod);
    assert.equal(config.smtp.secure, true);
    assert.equal(config.smtp.tls.rejectUnauthorized, true);
    assert.equal(config.smtp.tls.minVersion, 'TLSv1.2');
    assert.equal(settings({ ...prod, SMTP_PORT: '587' }).smtp.requireTLS, true);
    assert.throws(() => settings({ ...prod, EMAIL_TRANSPORT: 'file' }));
    assert.throws(() => settings({ ...prod, PUBLIC_BASE_URL: 'http://appet.example.test' }));
    sql((db) => {
      const factory = require('../lib/mail-service.cjs')({
        db,
        dataDir,
        env: prod,
        transportFactory: () => ({
          async sendMail() {
            throw Object.assign(Error('fixture-secret nunca deve aparecer'), { code: 'EAUTH' });
          },
          close() {},
        }),
      });
      assert.equal(factory.summary().inboxDeliveryVerified, false);
      assert.equal(factory.summary().transport, 'smtp');
      factory.stop();
    });
    pass(
      'confirmação/recuperação conservam TLS, origem HTTPS e exigência SMTP em produção; simulação nunca afirma entrega em caixa postal',
    );
    const backups = require('../lib/backup-service.cjs'),
      low = backups({
        root,
        dataDir,
        env: { BACKUP_AUTO: '1', BACKUP_KEEP: '2', BACKUP_MIN_FREE_MB: '1' },
        spaceInfo: () => ({ bavail: 0, bsize: 4096 }),
      });
    await low.tick(true);
    assert.equal(low.summary().pending, true);
    assert.equal(low.summary().errorCategory, 'LOW_SPACE');
    assert.equal(low.summary().retainedCopies, 0);
    const secret = crypto.randomBytes(32).toString('base64'),
      remote = backups({
        root,
        dataDir,
        env: {
          BACKUP_AUTO: '1',
          BACKUP_KEEP: '2',
          BACKUP_MAX_MB: '1',
          BACKUP_MIN_FREE_MB: '0',
          BACKUP_S3_BUCKET: 'fixture-private',
          BACKUP_S3_REGION: 'us-east-1',
          BACKUP_S3_ACCESS_KEY_ID: 'fixture',
          BACKUP_S3_SECRET_ACCESS_KEY: 'fixture-secret',
          BACKUP_ENCRYPTION_KEY: secret,
        },
        s3Factory: () => ({
          async send() {
            throw Error('Falha externa simulada.');
          },
          destroy() {},
        }),
      });
    sql((db) => {
      db.exec('CREATE TABLE capacity_fixture(body BLOB)');
      db.prepare('INSERT INTO capacity_fixture VALUES(?)').run(Buffer.alloc(350 * 1024));
    });
    await remote.tick(true);
    await remote.tick(true);
    const copies = remote.summary().retainedCopies;
    assert.ok(copies >= 1);
    await remote.tick(true);
    await remote.tick(true);
    assert.equal(remote.summary().retainedCopies, copies);
    assert.equal(remote.summary().pending, true);
    assert.equal(remote.summary().latestExported, false);
    assert.equal(remote.summary().externalRestoreVerified, false);
    assert.equal(remote.summary().errorCategory, 'LOCAL_BUDGET');
    assert.ok(remote.summary().localBytes <= 1024 * 1024);
    const refreshDir = path.join(dataDir, 'refresh-budget');
    fs.mkdirSync(refreshDir);
    const refreshDB = new DatabaseSync(path.join(refreshDir, 'adotapet.db'));
    refreshDB.exec('CREATE TABLE example(body BLOB)');
    refreshDB.prepare('INSERT INTO example VALUES(?)').run(Buffer.alloc(300 * 1024));
    refreshDB.close();
    const refresh = backups({
      root,
      dataDir: refreshDir,
      env: { BACKUP_AUTO: '1', BACKUP_KEEP: '3', BACKUP_MAX_MB: '1', BACKUP_MIN_FREE_MB: '0' },
    });
    for (let n = 0; n < 3; n++) await refresh.tick(true);
    assert.equal(refresh.summary().pending, false);
    assert.equal(refresh.summary().retainedCopies, 3);
    const previous = new Set(
      fs.readdirSync(path.join(refreshDir, 'backups')).filter((n) => n.endsWith('.db')),
    );
    await refresh.tick(true);
    assert.equal(refresh.summary().pending, false);
    assert.equal(refresh.summary().retainedCopies, 3);
    assert.ok(
      fs
        .readdirSync(path.join(refreshDir, 'backups'))
        .some((n) => n.endsWith('.db') && !previous.has(n)),
    );
    assert.ok(refresh.summary().localBytes <= 1024 * 1024);
    pass(
      'pouco espaço impede cópia; falha externa conserva backups e limita crescimento; orçamento renova cópias locais sem sacrificar as duas últimas',
    );
    const folder = path.join(dataDir, 'backups'),
      backup = path.join(
        folder,
        fs.readdirSync(folder).find((n) => n.endsWith('.db')),
      ),
      restored = path.join(dataDir, 'restore-isolated');
    const restore = spawnSync(process.execPath, ['scripts/restore-check.cjs', backup, restored], {
      cwd: root,
      windowsHide: true,
      encoding: 'utf8',
    });
    assert.equal(restore.status, 0, restore.stderr);
    assert.equal(JSON.parse(restore.stdout).providerPersistenceVerified, false);
    const copied = new DatabaseSync(path.join(restored, 'adotapet.db'), { readOnly: true });
    try {
      assert.equal(copied.prepare('SELECT COUNT(*) AS n FROM users').get().n, 2);
      assert.ok(
        copied
          .prepare('SELECT value FROM app_state WHERE key=?')
          .get('animals')
          .value.includes(pet.name),
      );
    } finally {
      copied.close();
    }
    const refused = spawnSync(process.execPath, ['scripts/restore-check.cjs', backup, restored], {
      cwd: root,
      windowsHide: true,
      encoding: 'utf8',
    });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /vazio/);
    pass(
      'restauração local em destino isolado preserva contas/fotos/coleções e rejeita sobrescrever diretório existente',
    );
  } finally {
    await stop();
    assert.ok(
      path.resolve(dataDir).startsWith(path.resolve(parent) + path.sep + '.appet-etapa6-test-'),
    );
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
})().then(
  () => {
    finished = true;
  },
  (e) => {
    finished = true;
    console.error(e);
    process.exitCode = 1;
  },
);
