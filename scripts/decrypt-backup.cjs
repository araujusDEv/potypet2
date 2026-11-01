// Descriptografa um backup e confere a integridade dele (npm run backup:decrypt).
'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  { DatabaseSync } = require('node:sqlite');
(async () => {
  const [source, target] = process.argv.slice(2);
  if (!source || !target)
    throw Error('Uso: node scripts/decrypt-backup.cjs ARQUIVO.enc NOVO_BACKUP.db');
  const destination = path.resolve(target);
  if (fs.existsSync(destination)) throw Error('O destino já existe. Escolha outro caminho.');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = destination + '.partial-' + crypto.randomBytes(8).toString('hex');
  try {
    await require('../lib/backup-crypto.cjs').decrypt(
      path.resolve(source),
      temporary,
      process.env.BACKUP_ENCRYPTION_KEY,
    );
    const db = new DatabaseSync(temporary, { readOnly: true });
    try {
      if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok')
        throw Error('Backup SQLite inválido.');
    } finally {
      db.close();
    }
    // link is atomic and fails if another operation created the target in the meantime.
    fs.linkSync(temporary, destination);
    console.log(
      'Backup descriptografado e íntegro. Restaure somente com o serviço parado, conforme docs/guias/PUBLICAR-HOJE.md.',
    );
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
})().catch(() => {
  console.error(
    'Falha ao abrir o backup. Confira arquivo, chave, permissões e escolha um destino novo.',
  );
  process.exitCode = 1;
});
