// Confere a integridade de um backup restaurado (npm run restore:check).
'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  { DatabaseSync } = require('node:sqlite');
function check(source) {
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    if (
      db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' ||
      db.prepare('PRAGMA foreign_key_check').all().length
    )
      throw Error('Banco sem integridade.');
    if (
      !db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get() ||
      !db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_state'").get()
    )
      throw Error('Banco não corresponde ao PotyPet (formato legado compatível).');
    return {
      users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
      collections: db.prepare('SELECT COUNT(*) AS n FROM app_state').get().n,
    };
  } finally {
    db.close();
  }
}
async function hash(file) {
  const digest = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
(async () => {
  try {
    const [source, target] = process.argv.slice(2);
    if (!source) throw Error('Uso: node scripts/restore-check.cjs BACKUP.db [NOVO_DATA_DIR_VAZIO]');
    const original = path.resolve(source),
      result = check(original);
    if (target) {
      const directory = path.resolve(target);
      if (fs.existsSync(directory) && fs.readdirSync(directory).length)
        throw Error(
          'O diretório de restauração deve estar vazio; o banco ativo nunca é substituído por este comando.',
        );
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const destination = path.join(directory, 'adotapet.db');
      fs.copyFileSync(original, destination, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(destination, 0o600);
      check(destination);
      if ((await hash(original)) !== (await hash(destination))) throw Error('Cópia divergente.');
    }
    console.log(
      JSON.stringify({
        integrity: 'ok',
        ...result,
        restoredToNewDirectory: Boolean(target),
        providerPersistenceVerified: false,
        externalStorageVerified: false,
      }),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
})();
