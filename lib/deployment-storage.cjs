// Confere onde os dados são gravados (DATA_DIR) e, em produção, recusa pastas temporárias.
'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  crypto = require('node:crypto');
const inside = (parent, target) => {
  const relative = path.relative(parent, target);
  return (
    !relative ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))
  );
};
module.exports = function storage({ root, dataDir, env = process.env }) {
  const production = env.NODE_ENV === 'production';
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const actual = fs.realpathSync(dataDir),
    code = fs.realpathSync(root);
  if (production && inside(code, actual))
    throw Error(
      'DATA_DIR de produção não pode apontar para a pasta do código, inclusive por link.',
    );
  if (production && inside(fs.realpathSync(os.tmpdir()), actual))
    throw Error('DATA_DIR de produção não pode usar armazenamento temporário.');
  let mount = null;
  if (env.PERSISTENT_DISK_PATH) {
    mount = fs.realpathSync(path.resolve(env.PERSISTENT_DISK_PATH));
    if (!inside(mount, actual)) throw Error('DATA_DIR deve estar dentro de PERSISTENT_DISK_PATH.');
  }
  const dbPath = path.join(actual, 'adotapet.db');
  if (production && fs.existsSync(dbPath) && !inside(actual, fs.realpathSync(dbPath)))
    throw Error('O banco deve estar no diretório persistente dos dados.');
  if (production && process.platform !== 'win32') {
    fs.chmodSync(actual, 0o700);
    if (fs.existsSync(dbPath)) fs.chmodSync(dbPath, 0o600);
  }
  const probe = path.join(actual, '.appet-write-check-' + crypto.randomBytes(8).toString('hex'));
  try {
    fs.writeFileSync(probe, 'ok', { flag: 'wx', mode: 0o600 });
  } finally {
    if (fs.existsSync(probe)) fs.unlinkSync(probe);
  }
  return {
    summary() {
      let freeBytes = null;
      try {
        const stat = fs.statfsSync(actual);
        freeBytes = Number(stat.bavail) * Number(stat.bsize);
      } catch {
        /* sem dados de espaço livre neste sistema */
      }
      return {
        configured: Boolean(env.DATA_DIR),
        writable: true,
        mountConfigured: Boolean(mount),
        withinConfiguredMount: mount ? inside(mount, actual) : null,
        freeBytes,
        persistenceVerified: false,
        permissions:
          process.platform === 'win32'
            ? 'Verifique as ACLs no sistema; modo POSIX não certifica permissões do Windows.'
            : 'Diretório 0700 e banco 0600 em produção.',
        verification:
          'A gravação local foi testada. A permanência após reinício/redeploy precisa de teste no provedor.',
      };
    },
  };
};
module.exports.inside = inside;
