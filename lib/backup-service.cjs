// Rotina de backup do banco: gera cópias criptografadas e, se configurado, envia para
// armazenamento externo. Passo a passo em docs/guias/PUBLICAR-HOJE.md.
'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  { spawn } = require('node:child_process');
const protection = require('./backup-crypto.cjs');
const NAME = /^appet-backup-(\d{13})-[a-f0-9]{8}\.db$/;
module.exports = function createBackupService({
  root,
  dataDir,
  env = process.env,
  s3Factory,
  spaceInfo = fs.statfsSync,
}) {
  const enabled =
    env.BACKUP_AUTO === '1' || (env.NODE_ENV === 'production' && env.BACKUP_AUTO !== '0');
  if (!enabled)
    return {
      start() {},
      stop() {},
      async tick() {},
      summary() {
        return {
          enabled: false,
          externalConfigured: false,
          lastBackup: null,
          latestExported: false,
          pending: false,
        };
      },
    };
  const directory = path.join(dataDir, 'backups'),
    retention = Number(env.BACKUP_KEEP || 7);
  if (!Number.isInteger(retention) || retention < 2 || retention > 30)
    throw Error('BACKUP_KEEP deve ser um inteiro entre 2 e 30.');
  const maxMB = Number(env.BACKUP_MAX_MB || 2048),
    minFreeMB = Number(env.BACKUP_MIN_FREE_MB ?? 256);
  if (
    !Number.isSafeInteger(maxMB) ||
    maxMB < 1 ||
    !Number.isSafeInteger(minFreeMB) ||
    minFreeMB < 0
  )
    throw Error('BACKUP_MAX_MB e BACKUP_MIN_FREE_MB devem ser inteiros válidos.');
  const budget = maxMB * 1024 * 1024,
    reserve = minFreeMB * 1024 * 1024;
  const hasRemote = Boolean(env.BACKUP_S3_BUCKET),
    remoteFields = [
      'BACKUP_S3_REGION',
      'BACKUP_S3_ACCESS_KEY_ID',
      'BACKUP_S3_SECRET_ACCESS_KEY',
      'BACKUP_ENCRYPTION_KEY',
    ];
  if (hasRemote && remoteFields.some((name) => !env[name]))
    throw Error('Complete a configuração do backup externo conforme docs/guias/PUBLICAR-HOJE.md.');
  if (!hasRemote && remoteFields.some((name) => env[name]))
    throw Error('Configure BACKUP_S3_BUCKET ou remova as variáveis parciais do backup externo.');
  let client, PutObjectCommand;
  if (hasRemote) {
    protection.key(env.BACKUP_ENCRYPTION_KEY);
    let endpoint;
    if (env.BACKUP_S3_ENDPOINT) {
      const url = new URL(env.BACKUP_S3_ENDPOINT);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
        throw Error('BACKUP_S3_ENDPOINT deve usar HTTPS.');
      endpoint = url.href;
    }
    const s3 = require('@aws-sdk/client-s3');
    PutObjectCommand = s3.PutObjectCommand;
    client = (s3Factory || ((config) => new s3.S3Client(config)))({
      region: env.BACKUP_S3_REGION,
      endpoint,
      forcePathStyle: env.BACKUP_S3_PATH_STYLE === '1',
      credentials: {
        accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID,
        secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY,
      },
      maxAttempts: 3,
    });
  }
  const prefix = env.BACKUP_S3_PREFIX || 'appet/';
  if (!/^[A-Za-z0-9/_-]{1,120}$/.test(prefix)) throw Error('BACKUP_S3_PREFIX inválido.');
  let running = false,
    timer,
    lastError = false,
    lastCategory = null;
  function files() {
    return fs.existsSync(directory)
      ? fs
          .readdirSync(directory)
          .filter((name) => NAME.test(name))
          .sort()
          .reverse()
      : [];
  }
  function location(name) {
    if (!NAME.test(name)) throw Error('Nome de backup inválido.');
    const target = path.resolve(directory, name);
    if (path.dirname(target) !== path.resolve(directory)) throw Error('Backup fora do diretório.');
    return target;
  }
  const size = (name) => fs.statSync(location(name)).size;
  const total = () => files().reduce((sum, name) => sum + size(name), 0);
  function free() {
    const s = spaceInfo(directory);
    return Number(s.bavail) * Number(s.bsize);
  }
  function projected() {
    const { DatabaseSync } = require('node:sqlite'),
      db = new DatabaseSync(path.join(dataDir, 'adotapet.db'), { readOnly: true });
    try {
      return (
        Number(db.prepare('PRAGMA page_count').get().page_count) *
        Number(db.prepare('PRAGMA page_size').get().page_size)
      );
    } finally {
      db.close();
    }
  }
  function guard(bytes, budgetCheck = false) {
    if (budgetCheck && total() + bytes > budget)
      throw Object.assign(Error('Limite de backups locais.'), { category: 'LOCAL_BUDGET' });
    if (free() < bytes + reserve)
      throw Object.assign(Error('Espaço insuficiente para cópia e reserva.'), {
        category: 'LOW_SPACE',
      });
  }
  function prune(extraBytes = 0) {
    while (files().length > retention || total() + extraBytes > budget) {
      // Keep at least the two newest copies. Pending external copies are never discarded.
      const candidate = files()
        .slice(2)
        .reverse()
        .find((name) => !client || fs.existsSync(location(name) + '.uploaded.json'));
      if (!candidate) break;
      const file = location(candidate),
        marker = file + '.uploaded.json';
      fs.unlinkSync(file);
      if (fs.existsSync(marker)) fs.unlinkSync(marker);
    }
  }
  function backup(destination) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(root, 'scripts/backup.cjs'), destination], {
        cwd: root,
        env: { ...env, DATA_DIR: dataDir },
        windowsHide: true,
        stdio: 'ignore',
      });
      const timeout = setTimeout(() => {
        child.kill();
        reject(Error('Backup excedeu o tempo previsto.'));
      }, 120000);
      timeout.unref();
      child.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      child.once('close', (code) => {
        clearTimeout(timeout);
        code === 0 ? resolve() : reject(Error('Falha no backup.'));
      });
    });
  }
  async function upload(name) {
    if (!client || fs.existsSync(path.join(directory, name + '.uploaded.json'))) return;
    const temporary = path.join(
      directory,
      name + '.' + crypto.randomBytes(4).toString('hex') + '.enc',
    );
    try {
      guard(size(name) + 128);
      await protection.encrypt(path.join(directory, name), temporary, env.BACKUP_ENCRYPTION_KEY);
      const remoteKey = prefix.replace(/\/?$/, '/') + name + '.enc';
      const body = fs.createReadStream(temporary);
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: env.BACKUP_S3_BUCKET,
            Key: remoteKey,
            Body: body,
            ContentLength: fs.statSync(temporary).size,
            ContentType: 'application/octet-stream',
          }),
          { abortSignal: AbortSignal.timeout(30000) },
        );
      } finally {
        if (!body.closed)
          await new Promise((resolve) => {
            body.once('close', resolve);
            body.destroy();
          });
      }
      fs.writeFileSync(
        path.join(directory, name + '.uploaded.json'),
        JSON.stringify({ at: new Date().toISOString(), key: remoteKey }),
        { mode: 0o600 },
      );
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  async function tick(force = false) {
    if (running || (!enabled && !force)) return;
    running = true;
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (env.NODE_ENV === 'production' && process.platform !== 'win32')
        fs.chmodSync(directory, 0o700);
      prune();
      let latest = files()[0];
      if (force || !latest || Number(latest.match(NAME)[1]) <= Date.now() - 86400000) {
        const estimate = projected();
        if (total() + estimate > budget) {
          try {
            for (const name of files()
              .filter((name) => !fs.existsSync(location(name) + '.uploaded.json'))
              .reverse()
              .slice(0, retention))
              await upload(name);
          } catch (err) {
            if (total() + estimate > budget) err.category = 'LOCAL_BUDGET';
            throw err;
          }
          prune(estimate);
        }
        guard(estimate, true);
        latest = 'appet-backup-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.db';
        const destination = path.join(directory, latest),
          temporary = destination + '.partial-' + crypto.randomBytes(4).toString('hex');
        try {
          await backup(temporary);
          fs.linkSync(temporary, destination);
        } finally {
          if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        }
      }
      // Keep failed uploads for retry; never delete a local copy that has not been exported.
      for (const name of files()
        .filter((name) => !fs.existsSync(path.join(directory, name + '.uploaded.json')))
        .reverse()
        .slice(0, retention))
        await upload(name);
      prune();
      lastError = false;
      lastCategory = null;
    } catch (err) {
      lastError = true;
      lastCategory = err.category || 'BACKUP_OR_EXPORT';
      console.error(
        'PotyPet: backup pendente. Confira espaço, permissões e configuração do armazenamento externo.',
      );
    } finally {
      running = false;
    }
  }
  return {
    start() {
      if (enabled && !timer) {
        timer = setInterval(() => void tick(), 3600000);
        timer.unref();
        void tick();
      }
    },
    stop() {
      clearInterval(timer);
      timer = null;
      client?.destroy();
    },
    tick,
    summary() {
      const all = files(),
        last = all[0];
      return {
        enabled,
        externalConfigured: hasRemote,
        lastBackup: last ? new Date(Number(last.match(NAME)[1])).toISOString() : null,
        latestExported: Boolean(
          last && fs.existsSync(path.join(directory, last + '.uploaded.json')),
        ),
        pending: lastError,
        errorCategory: lastCategory,
        retainedCopies: all.length,
        localBytes: total(),
        maxLocalBytes: budget,
        minFreeBytes: reserve,
        externalRestoreVerified: false,
        coverage:
          'Banco consistente: contas, fotos armazenadas nele, anexos de campanhas, contratos e históricos. Configurações e arquivos externos ao banco precisam de cópia própria.',
      };
    },
  };
};
