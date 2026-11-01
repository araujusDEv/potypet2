// Procura segredos e dados operacionais na pasta antes de publicar (npm run check:package).
'use strict';
const fs = require('node:fs'),
  path = require('node:path');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..')),
  issues = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', '.git'].includes(entry.name)) continue;
    const file = path.join(directory, entry.name),
      relative = path.relative(root, file).replaceAll(path.sep, '/');
    if (entry.isSymbolicLink()) {
      issues.push({ path: relative, reason: 'link não empacotável' });
      continue;
    }
    if (entry.isDirectory()) {
      if (/(^|\/)(backups|email-preview|derived-media|private-uploads|uploads)$/.test(relative))
        issues.push({ path: relative, reason: 'dados privados/cache' });
      else walk(file);
      continue;
    }
    if (
      entry.name === '.env' ||
      (entry.name.startsWith('.env.') && entry.name !== '.env.production.example') ||
      /\.(?:db|db-wal|db-shm|sqlite|sqlite3|cookies|pem|key|enc)$/i.test(entry.name) ||
      (relative.startsWith('data/') && relative !== 'data/seed.json')
    ) {
      issues.push({ path: relative, reason: 'dado operacional ou segredo fora do pacote' });
      continue;
    }
    if (!/\.(?:js|cjs|json|ya?ml|md|txt|html|conf|example|bat|sh)$/.test(entry.name)) continue;
    const body = fs.readFileSync(file, 'utf8');
    if (
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bAKIA[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{36,255}\b/.test(
        body,
      )
    )
      issues.push({ path: relative, reason: 'padrão de credencial privada' });
  }
}
walk(root);
console.log(
  JSON.stringify(
    {
      status: issues.length ? 'fail' : 'pass',
      issues,
      scope:
        'Padrões de segredos e dados operacionais. Não substitui revisão dos arquivos/credenciais no painel.',
    },
    null,
    2,
  ),
);
if (issues.length) process.exitCode = 1;
