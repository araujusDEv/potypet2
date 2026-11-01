// Confirmação de e-mail e redefinição de senha. Os tokens são aleatórios, guardados em
// hash, com validade e uso único.
'use strict';
const crypto = require('node:crypto');
const { validateReturnDestination } = require('../js/auth.js');
const REGISTER_MESSAGE =
  'Se os dados puderem ser usados, enviaremos orientações para o e-mail informado. Confira também a pasta de spam.';
const RECOVERY_MESSAGE =
  'Se houver uma conta para este e-mail, enviaremos um link para redefinir a senha. Confira também a pasta de spam.';
const VERIFY_MESSAGE =
  'Se houver uma confirmação pendente, enviaremos orientações para o e-mail informado. Confira também a pasta de spam.';
function invalidLink() {
  throw Object.assign(Error('Link inválido, expirado ou já utilizado. Solicite um novo link.'), {
    status: 400,
  });
}
module.exports = function createEmailAuth({
  db,
  mail,
  verifyPassword,
  hashPassword,
  validPassword,
  createUser,
}) {
  db.exec(`CREATE TABLE IF NOT EXISTS auth_tokens (
    token_hash TEXT PRIMARY KEY, purpose TEXT NOT NULL CHECK(purpose IN ('signup','verify','reset')),
    email TEXT NOT NULL, user_id INTEGER, payload TEXT,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  ); CREATE INDEX IF NOT EXISTS idx_auth_tokens_email ON auth_tokens(email, purpose, expires_at);`);
  const digest = (token) => crypto.createHash('sha256').update(token).digest('hex');
  const userFor = (email) =>
    db.prepare('SELECT * FROM users WHERE email=? COLLATE NOCASE').get(email);
  function transaction(callback) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const value = callback();
      db.exec('COMMIT');
      return value;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  function issue(purpose, email, userId = null, payload = null, returnTo = null) {
    const destination = validateReturnDestination(returnTo || payload?.returnTo);
    if (destination) payload = { ...(payload || {}), returnTo: destination };
    const token = crypto.randomBytes(32).toString('base64url'),
      hash = digest(token),
      time = Date.now();
    transaction(() => {
      db.prepare('DELETE FROM auth_tokens WHERE expires_at < ?').run(time - 86400000);
      db.prepare(
        'INSERT INTO auth_tokens(token_hash,purpose,email,user_id,payload,created_at,expires_at) VALUES(?,?,?,?,?,?,?)',
      ).run(
        hash,
        purpose,
        email,
        userId,
        payload ? JSON.stringify(payload) : null,
        time,
        time + (purpose === 'reset' ? 30 * 60000 : 86400000),
      );
      mail.queue(email, purpose === 'reset' ? 'reset' : 'verify', token, hash, destination);
    });
  }
  function find(token, purposes) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) invalidLink();
    const row = db.prepare('SELECT * FROM auth_tokens WHERE token_hash=?').get(digest(token));
    if (!row || row.used_at || row.expires_at <= Date.now() || !purposes.includes(row.purpose))
      invalidLink();
    return row;
  }
  function register(profile, credentials) {
    if (!mail.allow(profile.email, 'register')) return;
    const user = userFor(profile.email);
    if (user?.email_verified_at)
      return mail.queue(profile.email, 'notice', null, null, profile.returnTo);
    if (user) return issue('verify', profile.email, user.id, null, profile.returnTo);
    issue('signup', profile.email, null, {
      ...profile,
      passwordHash: credentials.hash,
      passwordSalt: credentials.salt,
    });
  }
  function resend(email, returnTo = null) {
    if (!mail.allow(email, 'verify')) return;
    const user = userFor(email);
    if (user && !user.email_verified_at) return issue('verify', email, user.id, null, returnTo);
    if (!user) {
      const pending = db
        .prepare(
          "SELECT payload FROM auth_tokens WHERE email=? AND purpose='signup' AND used_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1",
        )
        .get(email, Date.now());
      if (pending) issue('signup', email, null, JSON.parse(pending.payload), returnTo);
    }
  }
  function forgot(email, returnTo = null) {
    if (!mail.allow(email, 'reset')) return;
    const user = userFor(email);
    if (user) return issue('reset', email, user.id, null, returnTo);
    const pending = db
      .prepare(
        "SELECT payload FROM auth_tokens WHERE email=? AND purpose='signup' AND used_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1",
      )
      .get(email, Date.now());
    if (pending) issue('reset', email, null, JSON.parse(pending.payload), returnTo);
  }
  function confirm(token, password) {
    if (typeof password !== 'string' || password.length > 128) invalidLink();
    const result = transaction(() => {
      const row = find(token, ['signup', 'verify']);
      let user = userFor(row.email);
      if (row.purpose === 'signup') {
        const profile = JSON.parse(row.payload);
        if (!verifyPassword(password, profile.passwordSalt, profile.passwordHash)) invalidLink();
        // A different confirmation may already have created this address: never replace its credentials.
        if (user && !verifyPassword(password, user.password_salt, user.password_hash))
          invalidLink();
        if (!user)
          user = createUser(
            profile,
            { hash: profile.passwordHash, salt: profile.passwordSalt },
            true,
          );
      } else if (
        !user ||
        user.id !== row.user_id ||
        !verifyPassword(password, user.password_salt, user.password_hash)
      )
        invalidLink();
      db.prepare('UPDATE users SET email_verified_at=COALESCE(email_verified_at,?) WHERE id=?').run(
        new Date().toISOString(),
        user.id,
      );
      db.prepare(
        "UPDATE auth_tokens SET used_at=?,payload=NULL WHERE email=? AND purpose IN ('signup','verify') AND used_at IS NULL",
      ).run(Date.now(), row.email);
      return {
        user: db.prepare('SELECT * FROM users WHERE id=?').get(user.id),
        returnTo: validateReturnDestination(JSON.parse(row.payload || '{}').returnTo),
      };
    });
    return {
      ok: true,
      ...(result.returnTo ? { returnTo: result.returnTo } : {}),
      pendingApproval:
        result.user.account_type === 'ong' && result.user.approval_status !== 'aprovado',
      message:
        result.user.account_type === 'ong' && result.user.approval_status !== 'aprovado'
          ? 'E-mail confirmado. A ONG precisa da aprovação de um administrador antes do primeiro acesso.'
          : 'E-mail confirmado. Você já pode entrar na sua conta.',
    };
  }
  function reset(token, password, confirmation) {
    if (!validPassword(password))
      throw Object.assign(Error('A senha deve ter ao menos 8 caracteres, uma letra e um número.'), {
        status: 400,
      });
    if (password !== confirmation)
      throw Object.assign(Error('A confirmação da senha não confere.'), { status: 400 });
    const credentials = hashPassword(password);
    transaction(() => {
      const row = find(token, ['reset']);
      let user = userFor(row.email);
      if (!user && row.user_id === null && row.payload)
        user = createUser(JSON.parse(row.payload), credentials, true);
      else if (!user || user.id !== row.user_id) invalidLink();
      db.prepare(
        'UPDATE users SET password_hash=?,password_salt=?,email_verified_at=COALESCE(email_verified_at,?) WHERE id=?',
      ).run(credentials.hash, credentials.salt, new Date().toISOString(), user.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      db.prepare(
        'UPDATE auth_tokens SET used_at=?,payload=NULL WHERE email=? AND used_at IS NULL',
      ).run(Date.now(), row.email);
    });
    return { ok: true, message: 'Senha atualizada. Entre novamente com a nova senha.' };
  }
  async function uniformReply(start, message, extra = {}) {
    const delay = Math.max(0, 180 + crypto.randomInt(31) - (Date.now() - start));
    await new Promise((resolve) => setTimeout(resolve, delay));
    return { ok: true, message, ...extra };
  }
  return {
    register,
    resend,
    forgot,
    confirm,
    reset,
    uniformReply,
    REGISTER_MESSAGE,
    RECOVERY_MESSAGE,
    VERIFY_MESSAGE,
  };
};
