'use strict';
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite'),
  { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'),
  data = fs.mkdtempSync(path.join(os.tmpdir(), 'appet-backup-tests-'));
const protection = require('../lib/backup-crypto.cjs');
(async () => {
  try {
    const db = new DatabaseSync(path.join(data, 'adotapet.db'));
    db.exec('PRAGMA journal_mode=WAL; CREATE TABLE evidence(id INTEGER PRIMARY KEY, body TEXT);');
    db.prepare('INSERT INTO evidence(body) VALUES(?)').run('Dados privados de teste.');
    const service = require('../lib/backup-service.cjs')({
      root,
      dataDir: data,
      env: { BACKUP_AUTO: '1', BACKUP_KEEP: '2' },
    });
    await service.tick();
    const first = service.summary();
    assert.ok(first.lastBackup);
    assert.equal(first.externalConfigured, false);
    const folder = path.join(data, 'backups');
    assert.equal(fs.readdirSync(folder).filter((f) => f.endsWith('.db')).length, 1);
    await service.tick();
    assert.equal(fs.readdirSync(folder).filter((f) => f.endsWith('.db')).length, 1);
    fs.writeFileSync(path.join(folder, 'meu-arquivo.txt'), 'Não remover.');
    await service.tick(true);
    await service.tick(true);
    assert.equal(fs.readdirSync(folder).filter((f) => f.endsWith('.db')).length, 2);
    assert.ok(fs.existsSync(path.join(folder, 'meu-arquivo.txt')));
    const backup = path.join(
        folder,
        fs.readdirSync(folder).find((f) => f.endsWith('.db')),
      ),
      copied = new DatabaseSync(backup, { readOnly: true });
    try {
      assert.equal(copied.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      assert.equal(
        copied.prepare('SELECT body FROM evidence').get().body,
        'Dados privados de teste.',
      );
    } finally {
      copied.close();
    }
    console.log(
      'OK backup — cópia consistente com WAL ativo, intervalo diário, retenção e preservação de arquivos alheios.',
    );
    const secret = crypto.randomBytes(32).toString('base64'),
      encrypted = path.join(data, 'backup.enc'),
      decrypted = path.join(data, 'restaurado.db');
    await protection.encrypt(backup, encrypted, secret);
    assert.ok(!fs.readFileSync(encrypted, 'utf8').includes('Dados privados de teste.'));
    await protection.decrypt(encrypted, decrypted, secret);
    assert.ok(fs.readFileSync(backup).equals(fs.readFileSync(decrypted)));
    const corrupted = Buffer.from(fs.readFileSync(encrypted));
    corrupted[40] ^= 1;
    fs.writeFileSync(path.join(data, 'alterado.enc'), corrupted);
    await assert.rejects(() =>
      protection.decrypt(
        path.join(data, 'alterado.enc'),
        path.join(data, 'nao-restaurado.db'),
        secret,
      ),
    );
    assert.ok(!fs.existsSync(path.join(data, 'nao-restaurado.db')));
    const existing = path.join(data, 'preservar.db');
    fs.writeFileSync(existing, 'Preservar');
    await assert.rejects(() => protection.decrypt(encrypted, existing, secret));
    assert.equal(fs.readFileSync(existing, 'utf8'), 'Preservar');
    const result = spawnSync(
      process.execPath,
      ['scripts/decrypt-backup.cjs', encrypted, path.join(data, 'cli.db')],
      {
        cwd: root,
        env: { ...process.env, BACKUP_ENCRYPTION_KEY: secret },
        encoding: 'utf8',
        windowsHide: true,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.readFileSync(path.join(data, 'cli.db')).equals(fs.readFileSync(backup)));
    console.log(
      'OK backup — criptografia autenticada, rejeição de adulteração, restauração e destino existente preservado.',
    );
    const sent = [],
      env = {
        BACKUP_AUTO: '1',
        BACKUP_KEEP: '2',
        BACKUP_S3_BUCKET: 'private-test',
        BACKUP_S3_REGION: 'us-east-1',
        BACKUP_S3_ACCESS_KEY_ID: 'qa',
        BACKUP_S3_SECRET_ACCESS_KEY: 'qa-secret',
        BACKUP_ENCRYPTION_KEY: secret,
      };
    let fail = true;
    const remote = require('../lib/backup-service.cjs')({
      root,
      dataDir: data,
      env,
      s3Factory: () => ({
        async send(command) {
          if (fail) throw Error('Falha simulada');
          const chunks = [];
          for await (const chunk of command.input.Body) chunks.push(chunk);
          sent.push({ key: command.input.Key, bytes: Buffer.concat(chunks) });
        },
        destroy() {},
      }),
    });
    await remote.tick();
    assert.equal(remote.summary().pending, true);
    assert.equal(remote.summary().latestExported, false);
    fail = false;
    await remote.tick();
    assert.equal(remote.summary().pending, false);
    assert.ok(remote.summary().latestExported);
    assert.equal(sent.length, 2);
    assert.ok(
      sent.every(
        (s) =>
          s.key.startsWith('appet/') && !s.bytes.toString().includes('Dados privados de teste.'),
      ),
    );
    for (const item of sent) {
      fs.writeFileSync(path.join(data, 'remote.enc'), item.bytes);
      const dest = path.join(data, crypto.randomUUID() + '.db');
      await protection.decrypt(path.join(data, 'remote.enc'), dest, secret);
      const r = new DatabaseSync(dest, { readOnly: true });
      try {
        assert.equal(r.prepare('SELECT body FROM evidence').get().body, 'Dados privados de teste.');
      } finally {
        r.close();
      }
    }
    db.close();
    console.log(
      'OK backup — exportação S3 simulada, falha com retenção e nova tentativa, arquivo externo recuperável.',
    );
    assert.throws(() =>
      require('../lib/backup-service.cjs')({
        root,
        dataDir: data,
        env: { ...env, BACKUP_S3_ENDPOINT: 'http://insecure.example.test' },
      }),
    );
    assert.throws(() =>
      require('../lib/backup-service.cjs')({
        root,
        dataDir: data,
        env: { ...env, BACKUP_ENCRYPTION_KEY: 'invalid' },
      }),
    );
  } finally {
    assert.ok(data.startsWith(os.tmpdir() + path.sep));
    fs.rmSync(data, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
