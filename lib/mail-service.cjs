// Envio dos e-mails do sistema (desativado ou por SMTP), com fila e tentativas controladas.
'use strict';
const crypto = require('node:crypto'),
  fs = require('node:fs'),
  path = require('node:path');
const nodemailer = require('nodemailer');
const { validateReturnDestination } = require('../js/auth.js');
const emailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

function settings(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const mode = env.EMAIL_TRANSPORT || (production ? 'smtp' : 'disabled');
  if (!['smtp', 'file', 'disabled'].includes(mode))
    throw Error('EMAIL_TRANSPORT deve ser smtp, file ou disabled.');
  if (production && mode !== 'smtp')
    throw Error('Produção exige EMAIL_TRANSPORT=smtp para confirmar e recuperar contas.');
  if (mode === 'disabled') return { mode, enabled: false };
  const origin =
    env.PUBLIC_BASE_URL ||
    env.RENDER_EXTERNAL_URL ||
    (production ? '' : `http://127.0.0.1:${env.PORT || 3000}`);
  if (!origin) throw Error('Configure PUBLIC_BASE_URL com o endereço HTTPS do site.');
  const base = new URL(origin);
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== '/' ||
    !['http:', 'https:'].includes(base.protocol) ||
    (production && base.protocol !== 'https:')
  )
    throw Error('PUBLIC_BASE_URL deve ser a origem do site, com HTTPS em produção.');
  const from = String(env.MAIL_FROM || '').trim();
  if (!emailPattern.test(from) || from.length > 254)
    throw Error('Configure MAIL_FROM com um endereço remetente válido.');
  const key = Buffer.from(env.MAIL_QUEUE_KEY || '', 'base64');
  if (key.length !== 32 || !/^[A-Za-z0-9+/]+={0,2}$/.test(env.MAIL_QUEUE_KEY || ''))
    throw Error('MAIL_QUEUE_KEY deve ser uma chave aleatória de 32 bytes em base64.');
  const config = { mode, enabled: true, base: base.origin, from, key };
  if (mode === 'smtp') {
    if (!env.SMTP_HOST || /[\s/]/.test(env.SMTP_HOST) || !env.SMTP_USER || !env.SMTP_PASSWORD)
      throw Error('Configure SMTP_HOST, SMTP_USER e SMTP_PASSWORD no painel da hospedagem.');
    const port = Number(env.SMTP_PORT || 587);
    if (![465, 587].includes(port)) throw Error('SMTP_PORT deve ser 465 (TLS) ou 587 (STARTTLS).');
    config.smtp = {
      host: env.SMTP_HOST,
      port,
      secure: port === 465,
      requireTLS: port !== 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    };
  }
  return config;
}

module.exports = function createMailService({
  db,
  dataDir,
  env = process.env,
  transportFactory = nodemailer.createTransport,
}) {
  const config = settings(env);
  if (!config.enabled)
    return { enabled: false, start() {}, stop() {}, summary: () => ({ enabled: false }) };
  db.exec(`CREATE TABLE IF NOT EXISTS mail_outbox (
    id TEXT PRIMARY KEY, payload TEXT, created_at INTEGER NOT NULL, next_attempt INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, delivered_at INTEGER, failed_at INTEGER,
    token_hash TEXT, last_error TEXT NOT NULL DEFAULT ''
  ); CREATE INDEX IF NOT EXISTS idx_mail_pending ON mail_outbox(delivered_at, failed_at, next_attempt);
  CREATE TABLE IF NOT EXISTS mail_requests (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL, next_allowed INTEGER NOT NULL);`);
  const transport = transportFactory(
    config.mode === 'smtp' ? config.smtp : { jsonTransport: true },
  );
  let timer,
    running = false,
    stopped = false,
    lastCleanup = 0;
  function encrypt(value) {
    const iv = crypto.randomBytes(12),
      cipher = crypto.createCipheriv('aes-256-gcm', config.key, iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
  }
  function decrypt(value) {
    const data = Buffer.from(value, 'base64'),
      decipher = crypto.createDecipheriv('aes-256-gcm', config.key, data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8'),
    );
  }
  function allow(address, purpose) {
    const now = Date.now(),
      key = crypto
        .createHmac('sha256', config.key)
        .update(purpose + ':' + address)
        .digest('hex');
    const row = db.prepare('SELECT * FROM mail_requests WHERE key=?').get(key);
    if (row && row.window_start > now - 3600000 && (row.count >= 3 || row.next_allowed > now))
      return false;
    const count = row && row.window_start > now - 3600000 ? row.count + 1 : 1;
    const window = count === 1 ? now : row.window_start;
    db.prepare(
      `INSERT INTO mail_requests(key,window_start,count,next_allowed) VALUES(?,?,?,?)
      ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,count=excluded.count,next_allowed=excluded.next_allowed`,
    ).run(key, window, count, now + 60000);
    return true;
  }
  function queue(address, kind, token, tokenHash = null, returnTo = null) {
    const destination = validateReturnDestination(returnTo),
      search = destination ? '?next=' + encodeURIComponent(destination) : '';
    const link =
      config.base +
      (kind === 'reset' ? '/redefinir-senha.html' : '/confirmar-email.html') +
      search +
      '#token=' +
      encodeURIComponent(token || '');
    const content =
      kind === 'notice'
        ? {
            subject: 'PotyPet — orientações de acesso',
            text: `Recebemos uma tentativa de cadastro para este e-mail. Você pode entrar na sua conta ou usar "Esqueci minha senha" em ${config.base}/login.html${search}. Se não foi você, ignore esta mensagem.`,
          }
        : kind === 'reset'
          ? {
              subject: 'PotyPet — redefinir sua senha',
              text: `Recebemos um pedido para trocar sua senha. Abra o link abaixo e escolha uma nova senha. O link expira em 30 minutos e funciona uma única vez.\n\n${link}\n\nSe não foi você, ignore esta mensagem. Sua senha continua igual.`,
            }
          : {
              subject: 'PotyPet — confirme seu e-mail',
              text: `Para confirmar seu e-mail no PotyPet, abra o link abaixo e informe a senha que você escolheu para sua conta. O link expira em 24 horas e funciona uma única vez.\n\n${link}\n\nSe não pediu este cadastro ou confirmação, ignore a mensagem.`,
            };
    const html = `<div style="font-family:Arial,sans-serif;color:#173b38;max-width:560px"><h1 style="font-size:24px">PotyPet</h1><p>${escape(content.text).replace(/\n/g, '<br>')}</p>${kind === 'notice' ? '' : `<p><a href="${escape(link)}" style="color:#006d6a">${kind === 'reset' ? 'Escolher nova senha' : 'Confirmar meu e-mail'}</a></p>`}</div>`;
    const id = crypto.randomUUID(),
      now = Date.now();
    db.prepare(
      'INSERT INTO mail_outbox(id,payload,created_at,next_attempt,token_hash) VALUES(?,?,?,?,?)',
    ).run(
      id,
      encrypt({
        from: { name: 'PotyPet', address: config.from },
        to: address,
        ...content,
        html,
        disableFileAccess: true,
        disableUrlAccess: true,
      }),
      now,
      now,
      tokenHash,
    );
  }
  function queueEvent(address, kind, eventKey, destination) {
    const descriptions = {
      listing:
        'Há um anúncio aguardando revisão administrativa. Consulte o painel com uma conta autorizada.',
      moderation:
        'Há uma decisão administrativa disponível. Consulte o estado e a justificativa na área autorizada.',
      request: 'Há uma nova solicitação de adoção. O responsável deve analisar o pedido.',
      decision:
        'Uma etapa da sua solicitação foi atualizada. Confira quem precisa agir e o próximo passo.',
      sighting: 'Há um novo avistamento informado. Consulte os detalhes na área autenticada.',
      help: 'Uma família pediu ajuda no acompanhamento pós-adoção. O responsável deve responder.',
      message: 'Há uma nova mensagem privada em uma solicitação.',
      helpResponse:
        'O responsável respondeu ao seu pedido de ajuda. Consulte a orientação na área autenticada.',
    };
    if (!descriptions[kind] || !emailPattern.test(address))
      throw Error('Evento de e-mail inválido.');
    const safe = validateReturnDestination(destination);
    if (!safe) throw Error('Destino de evento inválido.');
    const link = config.base + '/login.html?next=' + encodeURIComponent(safe);
    const content = {
      subject:
        'PotyPet — ' +
        {
          listing: 'novo anúncio para análise',
          moderation: 'decisão administrativa',
          request: 'nova solicitação',
          decision: 'atualização da adoção',
          sighting: 'novo avistamento',
          help: 'pedido de ajuda pós-adoção',
          message: 'nova mensagem privada',
          helpResponse: 'resposta ao pedido de ajuda',
        }[kind],
      text:
        descriptions[kind] +
        '\n\n' +
        link +
        '\n\nEste aviso não comprova a entrega do animal nem constitui assinatura certificada.',
    };
    const id =
        'event-' +
        crypto
          .createHmac('sha256', config.key)
          .update(eventKey + ':' + address)
          .digest('hex'),
      timestamp = Date.now();
    db.prepare(
      'INSERT OR IGNORE INTO mail_outbox(id,payload,created_at,next_attempt,token_hash) VALUES(?,?,?,?,NULL)',
    ).run(
      id,
      encrypt({
        from: { name: 'PotyPet', address: config.from },
        to: address,
        ...content,
        html: '<p>' + escape(content.text).replace(/\n/g, '<br>') + '</p>',
        disableFileAccess: true,
        disableUrlAccess: true,
      }),
      timestamp,
      timestamp,
    );
  }
  async function pump() {
    if (running || stopped) return;
    running = true;
    try {
      if (Date.now() - lastCleanup >= 3600000) {
        db.prepare('DELETE FROM auth_tokens WHERE expires_at < ?').run(Date.now() - 86400000);
        db.prepare(
          'DELETE FROM mail_outbox WHERE created_at < ? AND (delivered_at IS NOT NULL OR failed_at IS NOT NULL)',
        ).run(Date.now() - 7 * 86400000);
        db.prepare('DELETE FROM mail_requests WHERE window_start < ?').run(
          Date.now() - 7 * 86400000,
        );
        lastCleanup = Date.now();
      }
      const row = db
        .prepare(
          'SELECT * FROM mail_outbox WHERE delivered_at IS NULL AND failed_at IS NULL AND next_attempt<=? ORDER BY created_at LIMIT 1',
        )
        .get(Date.now());
      if (!row) return;
      if (row.token_hash) {
        const token = db
          .prepare('SELECT expires_at,used_at FROM auth_tokens WHERE token_hash=?')
          .get(row.token_hash);
        if (!token || token.used_at || token.expires_at <= Date.now()) {
          db.prepare(
            "UPDATE mail_outbox SET failed_at=?,payload=NULL,last_error='TOKEN_EXPIRED' WHERE id=?",
          ).run(Date.now(), row.id);
          return;
        }
      }
      try {
        const info = await transport.sendMail(decrypt(row.payload));
        if (config.mode === 'file') {
          const directory = path.join(dataDir, 'email-preview');
          fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
          fs.writeFileSync(path.join(directory, row.id + '.json'), info.message, { mode: 0o600 });
        }
        db.prepare(
          'UPDATE mail_outbox SET delivered_at=?,payload=NULL,last_error=? WHERE id=?',
        ).run(Date.now(), '', row.id);
      } catch (err) {
        const attempts = row.attempts + 1,
          failed = attempts >= 5;
        // SMTP responses can contain recipient addresses or credentials: retain only a safe category.
        const category = [
          'EAUTH',
          'ECONNECTION',
          'ETIMEDOUT',
          'ESOCKET',
          'EENVELOPE',
          'EMESSAGE',
        ].includes(err.code)
          ? err.code
          : 'MAIL_ERROR';
        db.prepare(
          'UPDATE mail_outbox SET attempts=?,next_attempt=?,failed_at=?,payload=?,last_error=? WHERE id=?',
        ).run(
          attempts,
          Date.now() + Math.min(3600000, 30000 * 2 ** attempts),
          failed ? Date.now() : null,
          failed ? null : row.payload,
          category,
          row.id,
        );
        console.error(
          'PotyPet: envio de e-mail pendente; categoria ' +
            category +
            '. Confira a configuração do remetente.',
        );
      }
      db.prepare(
        'DELETE FROM mail_outbox WHERE created_at < ? AND (delivered_at IS NOT NULL OR failed_at IS NOT NULL)',
      ).run(Date.now() - 7 * 86400000);
      db.prepare('DELETE FROM mail_requests WHERE window_start < ?').run(Date.now() - 7 * 86400000);
    } catch {
      console.error('PotyPet: fila de e-mail temporariamente indisponível.');
    } finally {
      running = false;
    }
  }
  return {
    enabled: true,
    allow,
    queue,
    queueEvent,
    base: config.base,
    start() {
      if (timer) return;
      stopped = false;
      timer = setInterval(pump, 1000);
      timer.unref();
      void pump();
    },
    stop() {
      stopped = true;
      clearInterval(timer);
      timer = null;
      transport.close?.();
    },
    pump,
    verify: () => transport.verify(),
    summary: () => ({
      enabled: true,
      transport: config.mode,
      inboxDeliveryVerified: false,
      pending: db
        .prepare(
          'SELECT COUNT(*) AS n FROM mail_outbox WHERE delivered_at IS NULL AND failed_at IS NULL',
        )
        .get().n,
      failed: db.prepare('SELECT COUNT(*) AS n FROM mail_outbox WHERE failed_at IS NOT NULL').get()
        .n,
    }),
  };
};
module.exports.settings = settings;
