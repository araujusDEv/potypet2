// Gera um backup do banco pela linha de comando (npm run backup).
'use strict';
const fs = require('node:fs'),
  path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const target = process.argv[2];
if (!target) throw Error('Uso: node scripts/backup.cjs CAMINHO_DO_BACKUP.db');
const directory = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(__dirname, '../data');
const destination = path.resolve(target);
if (fs.existsSync(destination))
  throw Error('O destino já existe; escolha outro nome para preservar o backup anterior.');
fs.mkdirSync(path.dirname(destination), { recursive: true });
const db = new DatabaseSync(path.join(directory, 'adotapet.db'), { readOnly: true });
try {
  db.exec('PRAGMA busy_timeout = 1500');
  db.prepare('VACUUM INTO ?').run(destination);
  const check = new DatabaseSync(destination, { readOnly: true });
  try {
    if (check.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok')
      throw Error('Falha na verificação do backup.');
  } finally {
    check.close();
  }
  fs.chmodSync(destination, 0o600);
  console.log('Backup SQLite íntegro: ' + destination);
} finally {
  db.close();
}
