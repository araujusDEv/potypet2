/*
 * PotyPet: servidor.
 *
 * Um único processo Node.js entrega as páginas do site (HTML na raiz e arquivos em css/,
 * js/, img/ e fonts/) e a API em /api/*, usando o SQLite nativo do Node (node:sqlite).
 *
 * Ordem do arquivo:
 *   1. configuração, banco e tabelas
 *   2. funções de apoio: senhas, sessão, limites de tentativas e cabeçalhos de segurança
 *   3. handleApi, com todas as rotas da API
 *   4. serveStatic, que entrega os arquivos do site
 *   5. servidor HTTP e inicialização
 *
 * As regras mais longas ficam em lib/. Para rodar: npm ci e npm start. Para testar: npm test.
 * Variáveis de ambiente: .env.production.example e README.md.
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const validate = require('./lib/input-validation.cjs');
const accountAccess = require('./lib/account-access.cjs');
const clientIp = require('./lib/client-ip.cjs');
const { validateReturnDestination } = require('./js/auth.js');
const { DatabaseSync } = require('node:sqlite');
if (
  Number(process.versions.node.split('.')[0]) !== 24 ||
  Number(process.versions.node.split('.')[1]) < 21
)
  throw Error(
    'Use Node.js 24.21.0 LTS ou uma atualização posterior da linha 24. Veja .node-version.',
  );

const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'adotapet.db');
const SEED_PATH = path.join(ROOT, 'data', 'seed.json');
if (process.env.NODE_ENV === 'production') {
  if (!process.env.DATA_DIR)
    throw Error('Defina DATA_DIR em armazenamento persistente para produção.');
  if (process.env.SEED_DEMO_ACCOUNTS === '1')
    throw Error('Contas demo não são permitidas em produção.');
  if (process.env.COOKIE_SECURE !== '1') throw Error('Produção exige COOKIE_SECURE=1 e HTTPS.');
  if (process.env.SEED_SAMPLE_DATA === '1')
    throw Error('Dados de demonstração não são permitidos em produção.');
  const relativeData = path.relative(ROOT, DATA_DIR);
  if (
    !relativeData ||
    (!path.isAbsolute(relativeData) &&
      !relativeData.startsWith('..' + path.sep) &&
      relativeData !== '..')
  )
    throw Error('DATA_DIR de produção deve ficar fora da pasta do código.');
}
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const BODY_LIMIT = 13 * 1024 * 1024; // Three 3 MB photos encoded in base64, plus form fields.
const photoPolicy = require('./lib/photo-policy.cjs');
const animalApproval = require('./lib/animal-approval.cjs');
const RATE_LIMITS = new Map();
setInterval(
  () => {
    const time = Date.now();
    for (const [key, entry] of RATE_LIMITS) {
      if (entry.resetAt <= time) RATE_LIMITS.delete(key);
    }
  },
  15 * 60 * 1000,
).unref();
let bootstrapCredentials = null;

const storage = require('./lib/deployment-storage.cjs')({ root: ROOT, dataDir: DATA_DIR });
// Banco SQLite. As tabelas são criadas logo abaixo; colunas novas entram por ensureUserColumn,
// sem apagar dados já gravados.
const db = new DatabaseSync(DB_PATH);
if (process.env.NODE_ENV === 'production' && process.platform !== 'win32')
  fs.chmodSync(DB_PATH, 0o600);
db.exec(`
  PRAGMA busy_timeout = 1500;
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('adotante','doador','admin')),
    city TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS id_sequences (
    collection TEXT PRIMARY KEY,
    last_id INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

function ensureUserColumn(name, definition) {
  const columns = db.prepare('PRAGMA table_info(users)').all();
  if (!columns.some((column) => column.name === name))
    db.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
}
ensureUserColumn('organization_kind', "TEXT NOT NULL DEFAULT 'nao_informado'");
ensureUserColumn('account_type', "TEXT NOT NULL DEFAULT 'usuario'");
ensureUserColumn('approval_status', "TEXT NOT NULL DEFAULT 'aprovado'");
ensureUserColumn('approved_by', 'INTEGER');
ensureUserColumn('approved_at', 'TEXT');
ensureUserColumn('approval_reason', "TEXT NOT NULL DEFAULT ''");
ensureUserColumn('email_verified_at', 'TEXT');
ensureUserColumn('terms_version', 'TEXT');
ensureUserColumn('terms_accepted_at', 'TEXT');
ensureUserColumn('account_suspended_at', 'TEXT');
ensureUserColumn('account_suspended_by', 'INTEGER');
ensureUserColumn('account_suspension_reason', "TEXT NOT NULL DEFAULT ''");
ensureUserColumn('account_moderation_history', "TEXT NOT NULL DEFAULT '[]'");
const POLICY_VERSION = '2026-10-13-potypet-rc6-revisao';
db.exec(
  `CREATE INDEX IF NOT EXISTS idx_users_account_approval ON users(account_type, approval_status);`,
);
db.prepare(
  `UPDATE users SET account_type = CASE role WHEN 'admin' THEN 'admin' WHEN 'doador' THEN 'ong' ELSE 'usuario' END
            WHERE account_type IS NULL OR account_type = '' OR (account_type = 'usuario' AND role IN ('admin','doador'))`,
).run();
db.prepare(
  `UPDATE users SET approval_status='aprovado' WHERE approval_status IS NULL OR approval_status=''`,
).run();

const COLLECTIONS = [
  'animals',
  'missing',
  'sightings',
  'requests',
  'favorites',
  'reports',
  'adoptionProfiles',
  'notifications',
  'adminLog',
  'contracts',
  'followups',
  'supportPoints',
  'campaigns',
  'organizations',
];
const mail = require('./lib/mail-service.cjs')({ db, dataDir: DATA_DIR });
const backups = require('./lib/backup-service.cjs')({ root: ROOT, dataDir: DATA_DIR });

function now() {
  return new Date().toISOString();
}
function cleanText(value, max = 5000) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, max);
}
function inputText(value, max = 5000) {
  return validate.optionalText(value, max);
}
function normalizeEmail(value) {
  return inputText(value, 254).toLowerCase();
}
function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function validExternalUrl(value) {
  if (!value) return true;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
// Senhas: scrypt com salt aleatório para cada usuário.
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, expected) {
  const actual = crypto.scryptSync(String(password), salt, 64);
  const target = Buffer.from(expected, 'hex');
  return actual.length === target.length && crypto.timingSafeEqual(actual, target);
}
function validPassword(password) {
  return (
    typeof password === 'string' &&
    password.length >= 8 &&
    password.length <= 128 &&
    /[A-Za-zÀ-ÿ]/.test(password) &&
    /\d/.test(password)
  );
}
function randomBootstrapPassword() {
  return crypto.randomBytes(12).toString('base64url');
}
const dummyLoginCredentials = hashPassword(crypto.randomBytes(32).toString('base64url'));
// Limite de requisições por IP e por tipo de ação. Fica em memória e zera quando o servidor reinicia.
function rateLimit(req, res, bucket, max, windowMs) {
  const ip = clientIp(req);
  const key = `${bucket}:${ip}`;
  const current = RATE_LIMITS.get(key);
  const time = Date.now();
  if (!current || current.resetAt <= time) {
    RATE_LIMITS.set(key, { count: 1, resetAt: time + windowMs });
    return false;
  }
  current.count += 1;
  if (current.count > max) {
    res.setHeader('Retry-After', String(Math.ceil((current.resetAt - time) / 1000)));
    error(res, 429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
    return true;
  }
  return false;
}
// Só as tentativas de login que falham contam, por IP e por conta.
// Assim, quem entra com a senha certa não consome o limite de quem divide a mesma rede.
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_FAILURE_LIMIT_PER_IP = 30;
const LOGIN_FAILURE_LIMIT_PER_ACCOUNT = 8;
function loginFailureKeys(req, email) {
  return { ip: `login-fail-ip:${clientIp(req)}`, account: `login-fail-account:${email}` };
}
function currentFailures(key) {
  const entry = RATE_LIMITS.get(key);
  return entry && entry.resetAt > Date.now() ? entry : null;
}
function loginBlocked(res, keys) {
  const byIp = currentFailures(keys.ip);
  const byAccount = currentFailures(keys.account);
  const blockedIp = byIp && byIp.count >= LOGIN_FAILURE_LIMIT_PER_IP;
  const blockedAccount = byAccount && byAccount.count >= LOGIN_FAILURE_LIMIT_PER_ACCOUNT;
  if (!blockedIp && !blockedAccount) return false;
  const resetAt = Math.max(blockedIp ? byIp.resetAt : 0, blockedAccount ? byAccount.resetAt : 0);
  res.setHeader('Retry-After', String(Math.ceil((resetAt - Date.now()) / 1000)));
  error(res, 429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
  return true;
}
function registerLoginFailure(keys) {
  const time = Date.now();
  for (const key of [keys.ip, keys.account]) {
    const entry = currentFailures(key);
    if (entry) entry.count += 1;
    else RATE_LIMITS.set(key, { count: 1, resetAt: time + LOGIN_FAILURE_WINDOW_MS });
  }
}
// Escritas na API só valem quando vêm do próprio site e em JSON.
// Isso complementa o SameSite=Strict do cookie (um subdomínio vizinho ainda é "same-site").
const NON_JSON_WRITE_TYPES = [
  'text/plain',
  'application/x-www-form-urlencoded',
  'multipart/form-data',
];
function originAllowed(origin, req) {
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  const allowed = [req.headers.host];
  if (process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-host'])
    allowed.push(String(req.headers['x-forwarded-host']).split(',')[0].trim());
  for (const configured of [process.env.PUBLIC_BASE_URL, process.env.RENDER_EXTERNAL_URL]) {
    try {
      if (configured) allowed.push(new URL(configured).host);
    } catch {
      /* URL de ambiente inválida: ignora */
    }
  }
  return allowed.includes(host);
}
function writeRequestProblem(req) {
  const origin = req.headers.origin;
  if (origin && !originAllowed(origin, req))
    return { status: 403, message: 'Origem da requisição não permitida.' };
  const site = req.headers['sec-fetch-site'];
  if (site && !['same-origin', 'none'].includes(site))
    return { status: 403, message: 'Origem da requisição não permitida.' };
  const type = String(req.headers['content-type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (NON_JSON_WRITE_TYPES.includes(type))
    return { status: 415, message: 'Tipo de conteúdo não aceito.' };
  return null;
}
function publicUser(row, includePrivate = false, includePolicy = true) {
  if (!row) return null;
  const base = {
    id: row.id,
    name: row.name,
    role: row.role,
    organizationKind: row.organization_kind || 'nao_informado',
    accountType:
      row.account_type ||
      (row.role === 'admin' ? 'admin' : row.role === 'doador' ? 'ong' : 'usuario'),
    approvalStatus: row.approval_status || 'aprovado',
    approvedBy: row.approved_by || null,
    approvedAt: row.approved_at || null,
    approvalReason: row.approval_reason || '',
    city: row.city || '',
    state: row.state || '',
    createdAt: row.created_at,
    protected: row.id === 2,
    historicalAccess: Boolean(includePrivate && includePolicy && accountAccess.restricted(row)),
  };
  if (includePrivate) {
    if (includePolicy) {
      base.accountSuspended = accountAccess.suspended(row);
      base.suspendedAt = row.account_suspended_at || null;
      base.suspendedBy = row.account_suspended_by || null;
      base.suspensionReason = row.account_suspension_reason || '';
      base.accountModerationHistory = accountAccess.history(row);
    }
    base.email = row.email;
    base.phone = row.phone || '';
    base.emailVerified = Boolean(row.email_verified_at);
    if (includePolicy) {
      base.termsVersion = row.terms_version || null;
      base.termsAcceptedAt = row.terms_accepted_at || null;
    }
  }
  return base;
}
// Várias coleções, como animais e desaparecidos, são guardadas como JSON na tabela app_state.
// loadState lê a lista inteira e saveState grava de volta.
function loadState(key) {
  const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get(key);
  if (!row) return [];
  try {
    return JSON.parse(row.value);
  } catch {
    return [];
  }
}
function saveState(key, value) {
  db.prepare(
    `INSERT INTO app_state(key,value,updated_at) VALUES(?,?,?)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
  ).run(key, JSON.stringify(value), now());
}
function highestKnownId(collection) {
  if (!COLLECTIONS.includes(collection)) throw new Error('Coleção inválida.');
  let highest = 0;
  const include = (value) => {
    const id = Number(value);
    if (Number.isSafeInteger(id) && id > highest) highest = id;
  };
  for (const record of loadState(collection)) include(record.id);
  // Reserve IDs still referenced in databases created before persistent counters.
  const references = {
    animals: [
      ['campaigns', 'animalId'],
      ['requests', 'animalId'],
      ['favorites', 'animalId'],
      ['contracts', 'animalId'],
      ['followups', 'animalId'],
    ],
    requests: [
      ['contracts', 'requestId'],
      ['followups', 'requestId'],
    ],
    missing: [['sightings', 'missingAnimalId']],
  };
  for (const [key, field] of references[collection] || []) {
    for (const record of loadState(key)) include(record[field]);
  }
  if (collection === 'animals' || collection === 'missing') {
    for (const report of loadState('reports')) {
      if (report.target_type === (collection === 'animals' ? 'animal' : 'missing'))
        include(report.target_id);
    }
  }
  return highest;
}
function newId(collection) {
  const highest = highestKnownId(collection);
  // The counter advances atomically and survives deletion and server restarts.
  const row = db
    .prepare(
      'INSERT INTO id_sequences(collection, last_id) VALUES (?, ?) ' +
        'ON CONFLICT(collection) DO UPDATE SET last_id = MAX(last_id + 1, excluded.last_id) RETURNING last_id',
    )
    .get(collection, highest + 1);
  if (!Number.isSafeInteger(row.last_id)) throw new Error('Limite de identificadores atingido.');
  return row.last_id;
}
function getAnimal(id) {
  return loadState('animals').find((a) => a.id === Number(id)) || null;
}
function getMissing(id) {
  return loadState('missing').find((m) => m.id === Number(id)) || null;
}
function getRequest(id) {
  return loadState('requests').find((r) => r.id === Number(id)) || null;
}
const accountLimits = require('./lib/account-limits.cjs')({ db, loadState });
const animalPolicy = require('./lib/animal-policy.cjs')({
  db,
  loadState,
  saveState,
  newId,
  now,
  addNotification,
  addAdminLog,
  canPublish,
  eventMail,
});
const profileMedia = require('./lib/profile-media.cjs')({
  db,
  root: ROOT,
  dataDir: DATA_DIR,
  loadState,
  getAnimal,
  getMissing,
  isPublicAnimal,
  animalPolicy,
  canReadRequest,
  authUser,
  securityHeaders,
  json,
  error,
});
function isPublicAnimal(animal) {
  return animalPolicy.isPublic(animal);
}
function isAvailableAnimal(animal) {
  return animalPolicy.isAvailable(animal);
}
function addNotification(userId, message) {
  if (!userId) return;
  const list = loadState('notifications');
  list.push({
    id: newId('notifications'),
    userId: Number(userId),
    message: cleanText(message, 1000),
    read: false,
    createdAt: now(),
  });
  saveState('notifications', list);
}
function eventMail(userId, kind, eventKey, destination) {
  if (!mail.enabled || !userId) return;
  const recipient = db
    .prepare('SELECT email,email_verified_at FROM users WHERE id=?')
    .get(Number(userId));
  if (recipient?.email_verified_at) mail.queueEvent(recipient.email, kind, eventKey, destination);
}
function notifyAnimalSubmission(animal) {
  const event = crypto.randomUUID();
  addNotification(
    animal.ownerId,
    'Seu anúncio está em análise. Consulte a situação no painel do responsável.',
  );
  for (const admin of db.prepare("SELECT id FROM users WHERE role='admin'").all()) {
    addNotification(admin.id, `Um anúncio aguarda revisão administrativa: #${animal.id}.`);
    eventMail(admin.id, 'listing', 'animal:' + animal.id + ':submission:' + event, 'admin.html');
  }
}
const adoptionWorkflow = require('./lib/adoption-workflow.cjs')({
  db,
  loadState,
  saveState,
  newId,
  now,
  getAnimal,
  canReadRequest,
  canManageRequest,
  recalcAnimalProcessStatus,
  addNotification,
  eventMail,
});
function addAdminLog(admin, message) {
  if (!admin || admin.role !== 'admin') return;
  const list = loadState('adminLog');
  list.push({
    id: newId('adminLog'),
    adminId: admin.id,
    adminName: admin.name,
    message: cleanText(message, 1500),
    createdAt: now(),
  });
  saveState('adminLog', list);
}
function canManageAnimal(user, animal) {
  return Boolean(
    user &&
    animal &&
    (user.role === 'admin' || (Number(animal.ownerId) === user.id && canPublish(user))),
  );
}
function accountType(user) {
  if (!user) return '';
  return (
    user.account_type ||
    (user.role === 'admin' ? 'admin' : user.role === 'doador' ? 'ong' : 'usuario')
  );
}
function canPublish(user) {
  if (!user || accountAccess.restricted(user)) return false;
  if (accountType(user) === 'admin' || accountType(user) === 'usuario') return true;
  return accountType(user) === 'ong' && (user.approval_status || 'aprovado') === 'aprovado';
}
function canManageRequest(user, request) {
  if (!user || !request) return false;
  if (user.role === 'admin') return true;
  const animal = getAnimal(request.animalId);
  if (!animal || Number(animal.ownerId) !== user.id || !canPublish(user)) return false;
  if (request.ownerId !== undefined) return Number(request.ownerId) === user.id;
  // Older requests must not grant access to an animal created after the request.
  const requestedAt = Date.parse(request.createdAt);
  const animalCreatedAt = Date.parse(animal.createdAt);
  return (
    Number.isFinite(requestedAt) &&
    Number.isFinite(animalCreatedAt) &&
    requestedAt >= animalCreatedAt
  );
}
function hasAccountHistory(user) {
  if (!user) return false;
  return ['animals', 'missing', 'requests', 'contracts', 'followups', 'campaigns'].some((key) =>
    loadState(key).some((r) =>
      [r.ownerId, r.requesterId, r.adopterId, r.createdBy].some((v) => Number(v) === user.id),
    ),
  );
}
function canReadRequest(user, request) {
  if (!user || !request) return false;
  if (user.role === 'admin' || Number(request.requesterId) === user.id) return true;
  if (request.ownerId !== undefined) return Number(request.ownerId) === user.id;
  const animal = getAnimal(request.animalId);
  return Boolean(
    animal &&
    Number(animal.ownerId) === user.id &&
    (request.ownerId !== undefined
      ? Number(request.ownerId) === user.id
      : Number.isFinite(Date.parse(request.createdAt)) &&
        Date.parse(request.createdAt) >= Date.parse(animal.createdAt)),
  );
}
function recalcAnimalProcessStatus(animalId) {
  const animals = loadState('animals');
  const idx = animals.findIndex((a) => a.id === Number(animalId));
  if (
    idx < 0 ||
    animals[idx].status === 'adotado' ||
    animals[idx].status === 'indisponivel' ||
    animals[idx].status === 'aguardando_aprovacao'
  )
    return;
  const requests = loadState('requests');
  const hasActiveApproval = requests.some(
    (r) => r.animalId === Number(animalId) && r.status === 'aprovada',
  );
  animals[idx].status = hasActiveApproval ? 'em_processo' : 'disponivel';
  saveState('animals', animals);
}

function ensureSeed() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (!count) {
    const insert =
      db.prepare(`INSERT INTO users(name,email,password_hash,password_salt,role,city,state,phone,created_at,account_type,approval_status,approved_at)
                               VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
    const demo = process.env.SEED_DEMO_ACCOUNTS === '1';
    const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL || 'admin@adotapet.com');
    const adminPassword =
      process.env.ADMIN_PASSWORD || (demo ? 'admin123' : randomBootstrapPassword());
    const donorEmail = normalizeEmail(process.env.DONOR_EMAIL || 'ong@adotapet.com');
    const donorPassword =
      process.env.DONOR_PASSWORD || (demo ? 'doador123' : randomBootstrapPassword());
    if (
      process.env.NODE_ENV === 'production' &&
      (!process.env.ADMIN_EMAIL ||
        !process.env.DONOR_EMAIL ||
        !validEmail(adminEmail) ||
        !validEmail(donorEmail) ||
        adminEmail === donorEmail ||
        !process.env.ADMIN_PASSWORD ||
        !process.env.DONOR_PASSWORD ||
        adminPassword === donorPassword ||
        ![adminPassword, donorPassword].every(
          (password) =>
            validPassword(password) && password.length >= 12 && password.trim() === password,
        ))
    )
      throw Error(
        'Na primeira publicação, configure e-mails distintos e senhas exclusivas de 12 a 128 caracteres, com letras e números, para ADMIN e DONOR.',
      );
    const a = hashPassword(adminPassword);
    insert.run(
      'Administrador',
      adminEmail,
      a.hash,
      a.salt,
      'admin',
      '',
      '',
      '',
      now(),
      'admin',
      'aprovado',
      now(),
    );
    const d = hashPassword(donorPassword);
    insert.run(
      cleanText(
        process.env.DONOR_NAME || (demo ? 'Protetores de Apodi' : 'Perfil responsável inicial'),
        120,
      ),
      donorEmail,
      d.hash,
      d.salt,
      'doador',
      demo ? 'Apodi' : '',
      demo ? 'RN' : '',
      '',
      now(),
      'ong',
      'aprovado',
      now(),
    );
    db.prepare('UPDATE users SET email_verified_at=created_at WHERE email IN (?,?)').run(
      adminEmail,
      donorEmail,
    );
    bootstrapCredentials = {
      adminEmail,
      adminPassword: process.env.ADMIN_PASSWORD ? null : adminPassword,
      donorEmail,
      donorPassword: process.env.DONOR_PASSWORD ? null : donorPassword,
    };
  }
  const useSamples =
    process.env.SEED_SAMPLE_DATA === '1' &&
    !count &&
    !db.prepare('SELECT COUNT(*) AS n FROM app_state').get().n;
  const seed = useSamples
    ? JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'))
    : { animals: [], missing: [], supportPoints: [] };
  for (const key of COLLECTIONS) {
    const row = db.prepare('SELECT key FROM app_state WHERE key = ?').get(key);
    if (!row) {
      const value =
        key === 'animals'
          ? seed.animals
          : key === 'missing'
            ? seed.missing
            : key === 'supportPoints'
              ? seed.supportPoints || []
              : [];
      saveState(key, value);
    }
  }

  // Inclui uma única vez os pontos oficiais adicionados ao catálogo sem
  // apagar pontos cadastrados pelo administrador em bancos já existentes.
  const supportMigrationKey = 'migration:support_points_rn_20260909_v2';
  const supportMigration = db
    .prepare('SELECT key FROM app_state WHERE key = ?')
    .get(supportMigrationKey);
  if (!supportMigration) {
    const current = loadState('supportPoints');
    for (const seededPoint of seed.supportPoints || []) {
      const seededIndex = current.findIndex(
        (point) => point.seedKey && point.seedKey === seededPoint.seedKey,
      );
      if (seededIndex >= 0) continue;
      const alreadyExists = current.some(
        (point) =>
          cleanText(point.name, 160).toLowerCase() ===
            cleanText(seededPoint.name, 160).toLowerCase() &&
          cleanText(point.city, 120).toLowerCase() ===
            cleanText(seededPoint.city, 120).toLowerCase(),
      );
      if (!alreadyExists) current.push({ ...seededPoint, id: newId('supportPoints') });
    }
    saveState('supportPoints', current);
    saveState(supportMigrationKey, { appliedAt: now() });
  }
}
ensureSeed();
// Existing administrators retain operator-managed access during migration. Other accounts confirm ownership by email.
db.prepare(
  "UPDATE users SET email_verified_at=created_at WHERE role='admin' AND email_verified_at IS NULL",
).run();

// Recovery is an operator-only startup action, never an HTTP endpoint.
// A request ID is consumed in the same transaction as the password update.
function recoverAdminFromEnvironment() {
  const requestId = process.env.ADMIN_RECOVERY_ID;
  if (!requestId) return;
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) {
    throw new Error(
      'ADMIN_RECOVERY_ID deve ter de 16 a 128 letras, numeros, hifens ou sublinhados.',
    );
  }
  const marker = 'admin-recovery:' + crypto.createHash('sha256').update(requestId).digest('hex');
  if (db.prepare('SELECT 1 FROM app_state WHERE key=?').get(marker)) {
    console.log('Recuperacao administrativa ja aplicada. Remova ADMIN_RECOVERY_ID do painel.');
    return;
  }
  const email = normalizeEmail(process.env.ADMIN_EMAIL || '');
  const password = process.env.ADMIN_PASSWORD;
  if (
    !validEmail(email) ||
    !validPassword(password) ||
    password.length < 12 ||
    password !== password.trim()
  ) {
    throw new Error(
      'Recuperacao: configure ADMIN_EMAIL e ADMIN_PASSWORD com 12 a 128 caracteres, letras e numeros, sem espacos nas extremidades.',
    );
  }
  const target = db.prepare('SELECT id,role FROM users WHERE email=? COLLATE NOCASE').get(email);
  if (!target || target.role !== 'admin') {
    throw new Error(
      'Recuperacao: ADMIN_EMAIL precisa corresponder a uma conta administrativa existente. Nenhuma conta foi alterada.',
    );
  }
  const credentials = hashPassword(password);
  db.exec('BEGIN IMMEDIATE');
  try {
    // Recheck under the write lock if multiple processes initialize together.
    if (!db.prepare('SELECT 1 FROM app_state WHERE key=?').get(marker)) {
      db.prepare('UPDATE users SET password_hash=?,password_salt=? WHERE id=? AND role=?').run(
        credentials.hash,
        credentials.salt,
        target.id,
        'admin',
      );
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='auth_tokens'").get())
        db.prepare(
          'UPDATE auth_tokens SET used_at=?,payload=NULL WHERE user_id=? AND used_at IS NULL',
        ).run(Date.now(), target.id);
      db.prepare('INSERT INTO app_state(key,value,updated_at) VALUES(?,?,?)').run(
        marker,
        JSON.stringify({ userId: target.id, appliedAt: now(), source: 'hosting-environment' }),
        now(),
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  console.log(
    'Recuperacao administrativa concluida. Sessoes antigas revogadas. Remova ADMIN_RECOVERY_ID do painel.',
  );
}
recoverAdminFromEnvironment();
const demoAudit = require('./lib/demo-audit.cjs')({
  db,
  loadState,
  seedPath: SEED_PATH,
  verifyPassword,
});
if (process.env.NODE_ENV === 'production' && demoAudit.report().weakAccounts.length)
  throw Error(
    'Troque as credenciais conhecidas de demonstração antes da publicação. Preserve as contas e seus vínculos. Veja docs/guias/PUBLICAR-HOJE.md.',
  );

// Preserve adoption status separately from publication approval.
const adoptionRecords = loadState('animals');
let adoptionMigration = false;
for (const animal of adoptionRecords) {
  if (!animal.approvalStatus) {
    animal.approvalStatus = animal.status === 'aguardando_aprovacao' ? 'pending' : 'approved';
    adoptionMigration = true;
  }
  if (animal.status === 'aguardando_aprovacao') {
    animal.status = animal.adoptionStatus || 'disponivel';
    adoptionMigration = true;
  }
}
if (adoptionMigration) saveState('animals', adoptionRecords);
// Capture existing IDs before any record can be deleted on an upgraded database.
const initializeSequence = db.prepare(
  'INSERT INTO id_sequences(collection, last_id) VALUES (?, ?) ' +
    'ON CONFLICT(collection) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)',
);
for (const collection of COLLECTIONS)
  initializeSequence.run(collection, highestKnownId(collection));

function migrateLegacyState() {
  const requests = loadState('requests');
  let changed = false;
  const migrated = requests.map((item) => {
    const request = { ...item };
    if (request.status === 'aceita') {
      request.status = 'concluida';
      request.stage = 'concluida';
      request.completedAt =
        request.completedAt || request.acceptedAt || request.updatedAt || request.createdAt;
      request.approvedAt = request.approvedAt || request.acceptedAt || request.completedAt;
      changed = true;
    } else if (request.status === 'recusada') {
      request.status = 'reprovada';
      request.stage = 'encerrada';
      changed = true;
    } else if (request.status === 'pendente' && request.stage === 'entrevista') {
      request.status = 'aprovada';
      changed = true;
    } else if (request.status === 'pendente' && request.stage === 'em_analise') {
      request.status = 'em_analise';
      changed = true;
    }
    return request;
  });
  if (changed) saveState('requests', migrated);
}
migrateLegacyState();
db.exec('PRAGMA optimize;');
db.prepare('DELETE FROM sessions WHERE created_at < ?').run(
  new Date(Date.now() - SESSION_MAX_AGE_MS).toISOString(),
);

// Cabeçalhos de segurança aplicados a todas as respostas.
function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; frame-ancestors 'none'",
  );
  if (process.env.COOKIE_SECURE === '1')
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}
function json(res, status, payload) {
  securityHeaders(res);
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}
function error(res, status, message) {
  json(res, status, { error: message });
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        if (!tooLarge) {
          tooLarge = true;
          data = '';
          reject(Object.assign(new Error('Dados enviados são grandes demais.'), { status: 413 }));
        }
        return;
      }
      if (!tooLarge) data += chunk;
    });
    req.on('end', () => {
      if (req.authenticatedWrite)
        try {
          assertCurrentWriter(req);
        } catch (err) {
          reject(err);
          return;
        }
      if (!data) return resolve({});
      try {
        const body = JSON.parse(data);
        if (!body || typeof body !== 'object' || Array.isArray(body))
          throw new Error('Objeto JSON esperado.');
        resolve(body);
      } catch {
        reject(Object.assign(new Error('JSON inválido.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}
function tokenFrom(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)petadopt_session=([^;]+)/);
  try {
    return match ? decodeURIComponent(match[1]) : '';
  } catch {
    return '';
  }
}
function setSessionCookie(res, token, remember = false) {
  const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
  const maxAge = remember ? '; Max-Age=604800' : '';
  res.setHeader(
    'Set-Cookie',
    `petadopt_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/${maxAge}${secure}`,
  );
}
function clearSessionCookie(res) {
  const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `petadopt_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`,
  );
}
// Sessão: o token vem do cookie (ou do cabeçalho Authorization) e é procurado na tabela sessions.
function authUser(req) {
  const token = tokenFrom(req);
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT s.token,s.created_at AS session_created,u.*
                          FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?`,
    )
    .get(token);
  if (!row) return null;
  if (mail.enabled && !row.email_verified_at) return null;
  if (Date.now() - new Date(row.session_created).getTime() > SESSION_MAX_AGE_MS) {
    db.prepare('DELETE FROM sessions WHERE token=?').run(token);
    return null;
  }
  return row;
}
function requireUser(req, res, roles = null, allowHistorical = false) {
  const user = authUser(req);
  if (!user) {
    error(res, 401, 'Você precisa entrar na sua conta.');
    return null;
  }
  if (
    accountAccess.restricted(user) &&
    !(allowHistorical && ['GET', 'HEAD'].includes(req.method))
  ) {
    error(res, 403, accountAccess.message(user));
    return null;
  }
  if (roles && !roles.includes(user.role)) {
    error(res, 403, 'Você não tem permissão para esta ação.');
    return null;
  }
  if (req.authenticatedWrite && roles) req.writerRoles = roles;
  return user;
}
function assertCurrentWriter(req) {
  const user = authUser(req);
  if (!user) throw Object.assign(Error('Você precisa entrar na sua conta.'), { status: 401 });
  if (accountAccess.restricted(user))
    throw Object.assign(Error(accountAccess.message(user)), { status: 403 });
  if (req.writerRoles && !req.writerRoles.includes(user.role))
    throw Object.assign(Error('Você não tem permissão para esta ação.'), { status: 403 });
  return user;
}
function anonymousMutation(pathname, method) {
  return (
    method === 'POST' &&
    (/^\/api\/auth\/(login|register|logout|forgot-password|resend-verification|verify-email|reset-password)$/.test(
      pathname,
    ) ||
      ['/api/contact', '/api/reports', '/api/sightings'].includes(pathname) ||
      /^\/api\/campaigns\/\d+\/pix$/.test(pathname) ||
      /^\/api\/animals\/\d+\/view$/.test(pathname))
  );
}
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)').run(
    token,
    userId,
    now(),
  );
  return token;
}

function createRegisteredUser(profile, credentials, verified = false) {
  const { name, email, role, city, state, phone, type, organizationKind } = profile;
  const approvalStatus = type === 'ong' ? 'pendente' : 'aprovado';
  const result = db
    .prepare(
      `INSERT INTO users(name,email,password_hash,password_salt,role,city,state,phone,created_at,account_type,approval_status,approved_at,email_verified_at)
                            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      name,
      email,
      credentials.hash,
      credentials.salt,
      role,
      city,
      state,
      phone,
      now(),
      type,
      approvalStatus,
      type === 'ong' ? null : now(),
      verified ? now() : null,
    );
  const id = Number(result.lastInsertRowid);
  // A valid signup link issued before the rename retains the policy originally accepted.
  if (
    [POLICY_VERSION, '2026-10-13-potypet-rc1', '2026-10-12-etapa5'].includes(
      profile.termsVersion,
    ) &&
    profile.termsAcceptedAt
  )
    db.prepare('UPDATE users SET terms_version=?,terms_accepted_at=? WHERE id=?').run(
      profile.termsVersion,
      profile.termsAcceptedAt,
      id,
    );
  if (type === 'ong') {
    db.prepare('UPDATE users SET organization_kind=? WHERE id=?').run(
      organizationKind === 'ong' ? 'ong' : 'grupo',
      id,
    );
    db.prepare("SELECT id FROM users WHERE role='admin'")
      .all()
      .forEach((admin) => addNotification(admin.id, `Nova ONG aguardando análise: ${name}.`));
  }
  return db.prepare('SELECT * FROM users WHERE id=?').get(id);
}
const emailAuth = require('./lib/email-auth.cjs')({
  db,
  mail,
  verifyPassword,
  hashPassword,
  validPassword,
  createUser: createRegisteredUser,
});

const handleCampaigns = require('./lib/campaigns.cjs')({
  db,
  loadState,
  saveState,
  newId,
  getAnimal,
  authUser,
  requireUser,
  readBody,
  json,
  error,
  securityHeaders,
  rateLimit,
  now,
  addNotification,
  addAdminLog,
  isPublicAnimal,
  accountLimits,
});

// Todas as rotas da API. Cada bloco abaixo trata uma área, e os comentários marcam onde ela começa.
async function handleApi(req, res, url) {
  const method = req.method || 'GET';
  const pathname = url.pathname;
  // Escritas só valem se vierem do próprio site e em JSON (proteção contra CSRF).
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const problem = writeRequestProblem(req);
    if (problem) return error(res, problem.status, problem.message);
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !anonymousMutation(pathname, method)) {
    req.authenticatedWrite = true;
    const user = authUser(req);
    if (user && accountAccess.restricted(user)) return error(res, 403, accountAccess.message(user));
  }
  // Campanhas e Pix: rotas próprias em lib/campaigns.cjs.
  if (await handleCampaigns(req, res, url)) return;
  let match;

  if (method === 'GET' && pathname === '/api/health') {
    return json(res, 200, { ok: true, database: 'SQLite', time: now() });
  }

  // Diagnóstico para o admin, política de fotos e estatísticas.
  if (method === 'GET' && pathname === '/api/admin/launch-status') {
    const admin = requireUser(req, res, ['admin']);
    if (!admin) return;
    return json(res, 200, {
      email: mail.summary(),
      backup: backups.summary(),
      storage: storage.summary(),
      demonstration: demoAudit.report(),
      runtime: { version: process.versions.node, expected: '24.21.0', line: 24 },
      proxy: clientIp.configuration,
      production: process.env.NODE_ENV === 'production',
      secureCookies: process.env.COOKIE_SECURE === '1',
      samplesDisabled: process.env.SEED_SAMPLE_DATA !== '1',
    });
  }

  if (method === 'GET' && pathname === '/api/photo-policy') return json(res, 200, photoPolicy);
  if (method === 'GET' && pathname === '/api/stats') {
    const animals = loadState('animals');
    const missing = loadState('missing');
    const requests = loadState('requests');
    const followups = loadState('followups');
    return json(res, 200, {
      users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
      organizations: handleCampaigns.publicOrganizations().length,
      available: animals.filter(isAvailableAnimal).length,
      adopted: animals.filter((a) => isPublicAnimal(a) && a.status === 'adotado').length,
      urgent: animals.filter(
        (a) =>
          isAvailableAnimal(a) &&
          (a.special_needs ||
            a.age_group === 'idoso' ||
            Date.now() - new Date(a.createdAt).getTime() > 60 * 86400000),
      ).length,
      missing: missing.filter((m) => !m.hiddenAt && !m.found).length,
      found: missing.filter((m) => !m.hiddenAt && m.found).length,
      completedAdoptions: requests.filter((r) => r.status === 'concluida').length,
      postAdoptionUpdates: followups.length,
      supportPoints: loadState('supportPoints').length,
    });
  }

  // Autenticação: login, cadastro, sessão, confirmação de e-mail e redefinição de senha.
  if (method === 'POST' && pathname === '/api/auth/login') {
    const body = await readBody(req);
    const email = normalizeEmail(body.email);
    const failureKeys = loginFailureKeys(req, email);
    if (loginBlocked(res, failureKeys)) return;
    if (typeof body.password !== 'string' || body.password.length > 128) {
      registerLoginFailure(failureKeys);
      return error(res, 401, 'E-mail ou senha inválidos.');
    }
    const user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email);
    const passwordMatches = verifyPassword(
      body.password || '',
      user?.password_salt || dummyLoginCredentials.salt,
      user?.password_hash || dummyLoginCredentials.hash,
    );
    if (!user || !passwordMatches) {
      registerLoginFailure(failureKeys);
      return error(res, 401, 'E-mail ou senha inválidos.');
    }
    RATE_LIMITS.delete(failureKeys.account);
    if (mail.enabled && !user.email_verified_at)
      return json(res, 403, {
        error: 'Confirme seu e-mail antes de entrar. Use a opção de reenviar confirmação.',
        code: 'EMAIL_NOT_VERIFIED',
      });
    if (accountType(user) === 'ong' && accountAccess.restricted(user) && !hasAccountHistory(user)) {
      const message =
        user.approval_status === 'suspenso'
          ? `O cadastro desta ONG está suspenso. Novas publicações e solicitações estão bloqueadas. Motivo: ${user.approval_reason || 'Consulte o atendimento.'}`
          : user.approval_status === 'reprovado'
            ? `O cadastro desta ONG não foi aprovado.${user.approval_reason ? ` Motivo: ${user.approval_reason}` : ''}`
            : 'O cadastro da ONG está aguardando a análise de um administrador.';
      return error(res, 403, message);
    }
    const token = createSession(user.id);
    setSessionCookie(res, token, validate.boolean(body.remember));
    return json(res, 200, { user: publicUser(user, true) });
  }

  if (method === 'POST' && pathname === '/api/auth/register') {
    const start = Date.now();
    if (rateLimit(req, res, 'register', 8, 60 * 60 * 1000)) return;
    const body = await readBody(req);
    const name = inputText(body.name, 120);
    const email = normalizeEmail(body.email);
    if (
      typeof body.password !== 'string' ||
      typeof (body.passwordConfirmation ?? body.password_confirmation) !== 'string'
    )
      return error(res, 400, 'Informe a senha e a confirmação como texto.');
    const password = body.password;
    const passwordConfirmation = body.passwordConfirmation ?? body.password_confirmation;
    if (body.accountType !== undefined) validate.option(body.accountType, ['usuario', 'ong']);
    if (body.organizationKind !== undefined)
      validate.option(body.organizationKind, ['ong', 'grupo']);
    validate.boolean(body.remember);
    const type = body.accountType === 'ong' || body.role === 'doador' ? 'ong' : 'usuario';
    const role = type === 'ong' ? 'doador' : 'adotante';
    const city = inputText(body.city, 120);
    const state = validate.state(body.state);
    const phone = inputText(body.phone, 50);
    if (name.length < 2) return error(res, 400, 'Informe um nome válido.');
    if (!validEmail(email)) return error(res, 400, 'Informe um e-mail válido.');
    if (!city) return error(res, 400, 'Informe sua cidade.');
    if (phone.replace(/\D/g, '').length < 10)
      return error(res, 400, 'Informe um telefone válido com DDD.');
    if (!validPassword(password))
      return error(res, 400, 'A senha deve ter ao menos 8 caracteres, uma letra e um número.');
    if (password !== passwordConfirmation)
      return error(res, 400, 'A confirmação da senha não confere.');
    if (body.termsAccepted !== true && body.terms_accepted !== true)
      return error(res, 400, 'Você precisa aceitar os termos de uso e a política de privacidade.');
    if (mail.enabled) {
      emailAuth.register(
        {
          name,
          email,
          role,
          city,
          state,
          phone,
          type,
          organizationKind: body.organizationKind,
          returnTo: validateReturnDestination(body.returnTo),
          termsVersion: POLICY_VERSION,
          termsAcceptedAt: now(),
        },
        hashPassword(password),
      );
      return json(
        res,
        202,
        await emailAuth.uniformReply(start, emailAuth.REGISTER_MESSAGE, {
          pendingEmailVerification: true,
        }),
      );
    }
    if (db.prepare('SELECT id FROM users WHERE email=? COLLATE NOCASE').get(email)) {
      // Same password work as a successful signup; no explicit account-existence message.
      hashPassword(password);
      return error(
        res,
        400,
        'Não foi possível criar a conta com os dados informados. Confira os dados ou use a recuperação de acesso.',
      );
    }
    const user = createRegisteredUser(
      {
        name,
        email,
        role,
        city,
        state,
        phone,
        type,
        organizationKind: body.organizationKind,
        termsVersion: POLICY_VERSION,
        termsAcceptedAt: now(),
      },
      hashPassword(password),
    );
    if (type === 'ong') {
      return json(res, 201, {
        user: publicUser(user, true),
        pendingApproval: true,
        message:
          'Cadastro enviado. Um administrador precisa aprovar a ONG antes do primeiro acesso.',
      });
    }
    const token = createSession(user.id);
    setSessionCookie(res, token, validate.boolean(body.remember));
    return json(res, 201, { user: publicUser(user, true) });
  }

  if (method === 'POST' && pathname === '/api/auth/forgot-password') {
    const start = Date.now();
    if (rateLimit(req, res, 'forgot-password', 6, 30 * 60 * 1000)) return;
    const body = await readBody(req);
    const email = normalizeEmail(body.email);
    if (mail.enabled) {
      if (validEmail(email)) emailAuth.forgot(email, validateReturnDestination(body.returnTo));
      return json(res, 200, await emailAuth.uniformReply(start, emailAuth.RECOVERY_MESSAGE));
    }
    if (validEmail(email)) {
      const target = db
        .prepare('SELECT id,name,email FROM users WHERE email=? COLLATE NOCASE')
        .get(email);
      if (target) {
        const reports = loadState('reports');
        reports.push({
          id: newId('reports'),
          reporterUserId: target.id,
          target_type: 'usuario',
          target_id: target.id,
          category: 'recuperacao_senha',
          reason: `Pedido de recuperação de acesso para ${target.email}.`,
          status: 'aberta',
          createdAt: now(),
        });
        saveState('reports', reports);
        db.prepare("SELECT id FROM users WHERE role='admin'")
          .all()
          .forEach((admin) =>
            addNotification(admin.id, `Pedido de recuperação de acesso: ${target.name}.`),
          );
      }
    }
    return json(res, 200, {
      ok: true,
      message:
        'Se o e-mail estiver cadastrado, o pedido de recuperação foi registrado para a equipe responsável.',
    });
  }

  if (method === 'POST' && pathname === '/api/auth/resend-verification') {
    if (rateLimit(req, res, 'resend-verification', 6, 30 * 60000)) return;
    const start = Date.now(),
      body = await readBody(req),
      email = normalizeEmail(body.email);
    if (!mail.enabled) return error(res, 503, 'O envio de e-mail ainda não está configurado.');
    if (validEmail(email)) emailAuth.resend(email, validateReturnDestination(body.returnTo));
    return json(res, 200, await emailAuth.uniformReply(start, emailAuth.VERIFY_MESSAGE));
  }
  if (method === 'POST' && pathname === '/api/auth/verify-email') {
    if (rateLimit(req, res, 'verify-email', 10, 15 * 60000)) return;
    const body = await readBody(req);
    if (!mail.enabled) return error(res, 503, 'O envio de e-mail ainda não está configurado.');
    return json(res, 200, emailAuth.confirm(body.token, body.password));
  }
  if (method === 'POST' && pathname === '/api/auth/reset-password') {
    if (rateLimit(req, res, 'reset-password', 10, 15 * 60000)) return;
    const body = await readBody(req);
    if (!mail.enabled) return error(res, 503, 'O envio de e-mail ainda não está configurado.');
    const result = emailAuth.reset(body.token, body.password, body.passwordConfirmation);
    clearSessionCookie(res);
    return json(res, 200, result);
  }

  if (method === 'GET' && pathname === '/api/auth/me') {
    const user = authUser(req);
    if (!user) return error(res, 401, 'Sessão inválida ou expirada.');
    if (accountType(user) === 'ong' && accountAccess.restricted(user) && !hasAccountHistory(user))
      return error(res, 403, 'O cadastro desta ONG ainda não está aprovado.');
    return json(res, 200, { user: publicUser(user, true) });
  }

  if (method === 'POST' && pathname === '/api/auth/logout') {
    const token = tokenFrom(req);
    if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
    clearSessionCookie(res);
    return json(res, 200, { ok: true });
  }

  // Nome público de quem publicou o animal.
  match = pathname.match(/^\/api\/animals\/(\d+)\/public-name$/);
  if (method === 'GET' && match) {
    const animal = getAnimal(match[1]);
    const user = authUser(req);
    if (!animal || (!isPublicAnimal(animal) && !animalPolicy.party(user, animal)))
      return error(res, 404, 'Animal não encontrado.');
    const owner = db.prepare('SELECT name FROM users WHERE id = ?').get(Number(animal.ownerId));
    return json(res, 200, { name: owner?.name || '' });
  }

  // Usuários e contas: lista para o admin, perfil, aprovação, suspensão e exclusão.
  if (method === 'GET' && pathname === '/api/users') {
    const requester = requireUser(req, res, ['admin']);
    if (!requester) return;
    const includePrivate = requester?.role === 'admin';
    const rows = db.prepare('SELECT * FROM users ORDER BY id').all();
    return json(
      res,
      200,
      rows.map((r) => publicUser(r, includePrivate)),
    );
  }

  if (method === 'PATCH' && pathname === '/api/users/me') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const name = inputText(body.name, 120);
    const city = inputText(body.city, 120);
    const state = validate.state(body.state);
    const phone = inputText(body.phone, 50);
    if (name.length < 2 || !city || phone.replace(/\D/g, '').length < 10)
      return error(res, 400, 'Preencha nome, cidade e telefone corretamente.');
    db.prepare('UPDATE users SET name=?,city=?,state=?,phone=? WHERE id=?').run(
      name,
      city,
      state,
      phone,
      user.id,
    );
    return json(res, 200, {
      user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(user.id), true),
    });
  }

  match = pathname.match(/^\/api\/users\/(\d+)\/(suspend-account|reactivate)$/);
  if (method === 'POST' && match) {
    const admin = requireUser(req, res, ['admin']);
    if (!admin) return;
    const body = await readBody(req),
      reason = validate.text(body.reason, 1000, 'a justificativa'),
      id = Number(match[1]),
      action = match[2],
      at = now();
    db.exec('BEGIN IMMEDIATE');
    try {
      const actor = assertCurrentWriter(req),
        target = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      if (!target) {
        db.exec('ROLLBACK');
        return error(res, 404, 'Usuário não encontrado.');
      }
      const administrator = target.role === 'admin' || accountType(target) === 'admin';
      if (id === actor.id) {
        db.exec('ROLLBACK');
        return error(
          res,
          409,
          'Você não pode suspender ou reativar a própria conta por esta operação.',
        );
      }
      if (administrator) {
        const active = db
          .prepare(
            "SELECT COUNT(*) AS n FROM users WHERE role='admin' AND account_suspended_at IS NULL",
          )
          .get().n;
        db.exec('ROLLBACK');
        return error(
          res,
          409,
          active <= 1
            ? 'O último administrador ativo está protegido.'
            : 'Contas administrativas são protegidas por esta operação.',
        );
      }
      const suspend = action === 'suspend-account';
      if (suspend === accountAccess.suspended(target)) {
        db.exec('ROLLBACK');
        return error(
          res,
          409,
          suspend
            ? 'Esta conta já está suspensa.'
            : 'Esta conta não possui uma suspensão administrativa para reativar.',
        );
      }
      const history = [
        ...accountAccess.history(target),
        {
          action: suspend ? 'suspend' : 'reactivate',
          actorId: actor.id,
          actorName: actor.name,
          at,
          reason,
        },
      ];
      db.prepare(
        'UPDATE users SET account_suspended_at=?,account_suspended_by=?,account_suspension_reason=?,account_moderation_history=? WHERE id=?',
      ).run(
        suspend ? at : null,
        suspend ? actor.id : null,
        suspend ? reason : '',
        JSON.stringify(history),
        id,
      );
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      addAdminLog(actor, `${suspend ? 'Suspendeu' : 'Reativou'} a conta #${id}. ${reason}`);
      addNotification(
        id,
        suspend
          ? 'Sua conta foi suspensa. Consulte o histórico autorizado e a justificativa nas configurações.'
          : 'A suspensão administrativa da sua conta foi retirada. A aprovação cadastral da ONG, quando aplicável, continua independente.',
      );
      eventMail(
        id,
        'moderation',
        'user:' + id + ':account:' + history.length,
        'configuracoes.html',
      );
      db.exec('COMMIT');
      return json(res, 200, {
        user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id), true),
      });
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  match = pathname.match(/^\/api\/users\/(\d+)\/(approve|reject|suspend)$/);
  if (method === 'POST' && match) {
    const admin = requireUser(req, res, ['admin']);
    if (!admin) return;
    const id = Number(match[1]);
    const action = match[2];
    const body = await readBody(req);
    const target = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if (!target) return error(res, 404, 'Usuário não encontrado.');
    if (accountType(target) !== 'ong')
      return error(res, 400, 'Somente cadastros de ONG passam por esta análise.');
    const status =
      action === 'approve' ? 'aprovado' : action === 'suspend' ? 'suspenso' : 'reprovado';
    const reason = action === 'approve' ? '' : inputText(body.reason, 1000);
    if (action === 'suspend' && !reason)
      return error(res, 400, 'Informe a justificativa da suspensão.');
    db.prepare(
      'UPDATE users SET approval_status=?,approved_by=?,approved_at=?,approval_reason=? WHERE id=?',
    ).run(status, admin.id, now(), reason, id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    addNotification(
      id,
      action === 'approve'
        ? 'Seu cadastro de ONG foi aprovado. Você já pode entrar e publicar animais.'
        : `Seu cadastro de ONG foi ${action === 'suspend' ? 'suspenso' : 'reprovado'}. Anúncios foram retirados das vitrines e novos pedidos estão bloqueados.${reason ? ` Motivo: ${reason}` : ''}`,
    );
    eventMail(
      id,
      'moderation',
      'organization:' + id + ':decision:' + crypto.randomUUID(),
      'configuracoes.html',
    );
    addAdminLog(
      admin,
      `${action === 'approve' ? 'Aprovou' : action === 'suspend' ? 'Suspendeu' : 'Reprovou'} o cadastro da ONG ${target.name}${reason ? `: ${reason}` : '.'}`,
    );
    return json(res, 200, {
      user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id), true),
    });
  }

  match = pathname.match(/^\/api\/users\/(\d+)$/);
  if (method === 'DELETE' && match) {
    const admin = requireUser(req, res, ['admin']);
    if (!admin) return;
    const id = Number(match[1]);
    const target = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if (!target) return error(res, 404, 'Usuário não encontrado.');
    if (target.role === 'admin')
      return error(res, 400, 'Contas administrativas não podem ser removidas por esta tela.');
    const ownsDemoData =
      loadState('animals').some((a) => a.seed && Number(a.ownerId) === id) ||
      loadState('missing').some((m) => m.seed && Number(m.ownerId) === id);
    if (ownsDemoData)
      return error(
        res,
        400,
        'O usuário responsável pelos dados de demonstração não pode ser removido.',
      );
    if (
      ['animals', 'missing', 'requests', 'contracts', 'followups', 'campaigns'].some((key) =>
        loadState(key).some((r) =>
          [r.ownerId, r.requesterId, r.adopterId, r.createdBy].some((v) => Number(v) === id),
        ),
      )
    )
      return error(
        res,
        409,
        'Esta conta possui registros vinculados. Preserve o histórico; para uma ONG, use suspensão.',
      );
    db.prepare('DELETE FROM users WHERE id=?').run(id);
    for (const key of ['favorites', 'adoptionProfiles', 'notifications']) {
      const list = loadState(key).filter((x) => Number(x.userId) !== id);
      saveState(key, list);
    }
    const animals = loadState('animals').map((a) =>
      Number(a.ownerId) === id && !a.seed ? { ...a, status: 'indisponivel' } : a,
    );
    saveState('animals', animals);
    addAdminLog(admin, `Removeu o usuário ${target.name}.`);
    return json(res, 200, { ok: true });
  }

  // Fotos (lib/profile-media.cjs) e limites da conta.
  if (await profileMedia.handle(req, res, url)) return;
  if (method === 'GET' && pathname === '/api/account/limits') {
    const user = requireUser(req, res, null, true);
    if (!user) return;
    return json(res, 200, accountLimits.summary(user));
  }
  if (method === 'GET' && pathname === '/api/notifications/summary') {
    const user = requireUser(req, res, null, true);
    if (!user) return;
    return json(res, 200, {
      unread: loadState('notifications').filter((n) => n.userId === user.id && !n.read).length,
    });
  }
  // Animais para adoção: listas, detalhe, criação, edição, moderação e status.
  if (method === 'GET' && pathname === '/api/animals/cards') {
    const user = authUser(req),
      view = url.searchParams.get('view') || 'available';
    if (!['available', 'manage', 'history', 'favorites'].includes(view))
      return error(res, 400, 'Consulta inválida.');
    if (view !== 'available' && !user)
      return error(res, 401, 'Entre na sua conta para consultar estes registros.');
    const favorites = new Set(
      user
        ? loadState('favorites')
            .filter((f) => f.userId === user.id)
            .map((f) => f.animalId)
        : [],
    );
    const animals = loadState('animals').filter((a) =>
      view === 'available'
        ? isAvailableAnimal(a)
        : view === 'manage'
          ? user.role === 'admin' || Number(a.ownerId) === user.id
          : view === 'history'
            ? animalPolicy.party(user, a)
            : favorites.has(a.id) && (isPublicAnimal(a) || animalPolicy.party(user, a)),
    );
    return json(
      res,
      200,
      animals.map((a) => profileMedia.card(a, user)),
    );
  }
  match = pathname.match(/^\/api\/animals\/(\d+)$/);
  if (method === 'GET' && match) {
    const user = authUser(req),
      animal = getAnimal(match[1]);
    if (!animal || (!isPublicAnimal(animal) && !animalPolicy.party(user, animal)))
      return error(res, 404, 'Animal não encontrado.');
    return json(res, 200, profileMedia.detail(animal, user));
  }
  if (method === 'GET' && pathname === '/api/animals') {
    const user = authUser(req);
    const animals = loadState('animals');
    return json(
      res,
      200,
      animals
        .filter((a) => isPublicAnimal(a) || animalPolicy.party(user, a))
        .map((a) => animalPolicy.view(a, user)),
    );
  }

  if (method === 'POST' && pathname === '/api/animals') {
    if (rateLimit(req, res, 'animals-create', 30, 10 * 60 * 1000)) return;
    let user = requireUser(req, res);
    if (!user) return;
    if (!canPublish(user))
      return error(res, 403, 'Sua conta ainda não tem permissão para publicar animais.');
    const body = await readBody(req);
    const photos = await validate.photos(body.photos, ROOT);
    user = requireUser(req, res);
    if (!user) return;
    if (!canPublish(user))
      return error(res, 403, 'Sua conta ainda não tem permissão para publicar animais.');
    const fields = validate.animal(body);
    const override = animalApproval.exception(body, user);
    let approvalCheck = null;
    if (user.role === 'admin')
      approvalCheck = await animalApproval.assess({ ...fields, photos }, ROOT);
    user = requireUser(req, res);
    if (!user) return;
    if (!canPublish(user))
      return error(res, 403, 'Sua conta não tem permissão para publicar animais.');
    if (override && user.role !== 'admin')
      return error(res, 403, 'Somente a administração pode registrar exceções.');
    if (user.role === 'admin') animalApproval.enforce(approvalCheck, override);
    const list = loadState('animals');
    accountLimits.ensureCount(user, 'animals');
    accountLimits.ensureStorage(
      user,
      photos.reduce((sum, p) => sum + accountLimits.bytes(p), 0),
    );
    const record = {
      ...fields,
      id: newId('animals'),
      photos,
      approvalStatus: user.role === 'admin' ? 'approved' : 'pending',
      status: 'disponivel',
      verified: false,
      featured: false,
      views: 0,
      ownerId: user.id,
      createdAt: now(),
      personality: fields.personality || null,
      coexistence: fields.coexistence || {
        kids: 'nao_informado',
        dogs: 'nao_informado',
        cats: 'nao_informado',
      },
    };
    db.exec('BEGIN IMMEDIATE');
    try {
      if (user.role === 'admin') {
        const entry = {
          status: 'approved',
          actorId: user.id,
          actorName: user.name,
          at: record.createdAt,
          reason: 'Publicação criada pela administração.',
          criteria: {
            ...approvalCheck,
            checkedAt: record.createdAt,
            exception: override
              ? { ...override, actorId: user.id, actorName: user.name, at: record.createdAt }
              : null,
          },
        };
        record.approvalCriteria = entry.criteria;
        record.moderationHistory = [entry];
        if (override)
          addAdminLog(user, `Exceção de aprovação no anúncio #${record.id}: ${override.reason}`);
      }
      list.push(record);
      saveState('animals', list);
      if (record.approvalStatus === 'pending') notifyAnimalSubmission(record);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return json(res, 201, animalPolicy.view(record, user));
  }

  match = pathname.match(/^\/api\/animals\/(\d+)\/view$/);
  if (method === 'POST' && match) {
    if (rateLimit(req, res, 'animals-view', 30, 10 * 60 * 1000)) return;
    const id = Number(match[1]);
    const list = loadState('animals');
    const idx = list.findIndex((a) => a.id === id);
    if (idx < 0 || (!isPublicAnimal(list[idx]) && !animalPolicy.party(authUser(req), list[idx])))
      return error(res, 404, 'Animal não encontrado.');
    if (!isPublicAnimal(list[idx]) && accountAccess.restricted(authUser(req)))
      return error(res, 403, accountAccess.message(authUser(req)));
    list[idx].views = (Number(list[idx].views) || 0) + 1;
    saveState('animals', list);
    return json(res, 200, { views: list[idx].views });
  }

  match = pathname.match(/^\/api\/animals\/(\d+)$/);
  if (method === 'PATCH' && match) {
    let user = requireUser(req, res);
    if (!user) return;
    const id = Number(match[1]);
    const body = await readBody(req);
    const validatedPhotos =
      body.photos === undefined ? undefined : await validate.photos(body.photos, ROOT);
    user = requireUser(req, res);
    if (!user) return;
    const fields = validate.animal(body, true),
      override = animalApproval.exception(body, user);
    if (override && body.approvalStatus !== 'approved')
      return error(res, 400, 'A exceção deve acompanhar uma decisão explícita de aprovação.');
    let approvalCheck = null,
      approvalFingerprint = null;
    if (user.role === 'admin' && body.approvalStatus === 'approved') {
      const current = getAnimal(id);
      if (!current) return error(res, 404, 'Animal não encontrado.');
      if (current.archivedAt) return error(res, 409, 'O anúncio está arquivado.');
      approvalFingerprint = animalApproval.fingerprint(current);
      approvalCheck = await animalApproval.assess(
        { ...current, ...fields, photos: validatedPhotos ?? current.photos },
        ROOT,
      );
    }
    user = requireUser(req, res);
    if (!user) return;
    if (approvalCheck && user.role !== 'admin')
      return error(res, 403, 'Sua permissão administrativa mudou durante a revisão.');
    const list = loadState('animals');
    const idx = list.findIndex((a) => a.id === id);
    if (idx < 0) return error(res, 404, 'Animal não encontrado.');
    if (!canManageAnimal(user, list[idx]))
      return error(res, 403, 'Você não pode alterar este animal.');
    if (list[idx].archivedAt)
      return error(res, 409, 'O anúncio está arquivado; seu histórico permanece disponível.');
    if (
      user.role === 'admin' &&
      body.status === 'aguardando_aprovacao' &&
      !Object.hasOwn(body, 'approvalStatus')
    ) {
      body.approvalStatus = 'pending';
      body.reason =
        body.reason ??
        'Anúncio recolocado em análise pelo comando administrativo de compatibilidade.';
    }
    if (validatedPhotos !== undefined)
      accountLimits.ensureStorage(
        db.prepare('SELECT * FROM users WHERE id=?').get(Number(list[idx].ownerId)) || user,
        validatedPhotos.reduce((n, p) => n + accountLimits.bytes(p), 0),
        (list[idx].photos || []).reduce((n, p) => n + accountLimits.bytes(p), 0),
      );
    if (approvalCheck) {
      if (animalApproval.fingerprint(list[idx]) !== approvalFingerprint)
        return error(
          res,
          409,
          'Fotos, descrição ou revisão mudaram durante a conferência. Abra a revisão novamente.',
        );
      animalApproval.enforce(approvalCheck, override);
    }
    const linkedRequests = loadState('requests').filter(
      (r) =>
        Number(r.animalId) === id &&
        (r.ownerId === undefined || Number(r.ownerId) === Number(list[idx].ownerId)),
    );
    if (
      user.role === 'admin' &&
      ['disponivel', 'em_processo', 'adotado', 'indisponivel'].includes(body.status)
    ) {
      if (linkedRequests.some((r) => r.status === 'concluida') && body.status !== 'adotado')
        return error(
          res,
          409,
          'Há adoção concluída vinculada. Preserve o estado adotado e use arquivamento para retirar a publicação.',
        );
      if (linkedRequests.some((r) => r.status === 'aprovada') && body.status !== 'em_processo')
        return error(
          res,
          409,
          'Há um interessado aprovado. Use o fluxo do pedido antes de alterar a disponibilidade.',
        );
    }
    if (
      user.role === 'admin' &&
      Object.prototype.hasOwnProperty.call(body, 'status') &&
      ['disponivel', 'em_processo', 'adotado', 'indisponivel'].includes(body.status)
    )
      list[idx].status = body.status;
    if (user.role === 'admin' && Object.prototype.hasOwnProperty.call(body, 'verified')) {
      list[idx].verified = fields.verified;
      list[idx].verifiedAt = list[idx].verified ? now() : null;
      list[idx].verifiedBy = list[idx].verified ? user.id : null;
    }
    if (user.role === 'admin' && Object.prototype.hasOwnProperty.call(body, 'featured'))
      list[idx].featured = fields.featured;
    for (const [key, value] of Object.entries(fields))
      if (!['verified', 'featured'].includes(key)) list[idx][key] = value;
    if (validatedPhotos !== undefined) list[idx].photos = validatedPhotos;
    if (user.role !== 'admin' && list[idx].status !== 'aguardando_aprovacao') {
      list[idx].approvalStatus = 'pending';
      list[idx].verified = false;
      list[idx].featured = false;
    }
    // Legacy moderation command remains supported; changing availability never grants publication approval.
    if (user.role === 'admin' && body.status === 'aguardando_aprovacao')
      list[idx].approvalStatus = 'pending';
    if (
      user.role === 'admin' &&
      ['approved', 'pending', 'rejected'].includes(body.approvalStatus)
    ) {
      const reason = validate.text(body.reason, 1000, 'a justificativa da decisão');
      db.exec('BEGIN IMMEDIATE');
      try {
        const reviewedAt = now();
        list[idx].approvalStatus = body.approvalStatus;
        list[idx].reviewedBy = user.id;
        list[idx].reviewedByName = user.name;
        list[idx].reviewedAt = reviewedAt;
        list[idx].moderationReason = reason;
        const criteria = approvalCheck
          ? {
              ...approvalCheck,
              checkedAt: reviewedAt,
              exception: override
                ? { ...override, actorId: user.id, actorName: user.name, at: reviewedAt }
                : null,
            }
          : null;
        if (criteria) list[idx].approvalCriteria = criteria;
        list[idx].moderationHistory = [
          ...(list[idx].moderationHistory || []),
          {
            status: body.approvalStatus,
            actorId: user.id,
            actorName: user.name,
            at: reviewedAt,
            reason,
            ...(criteria ? { criteria } : {}),
          },
        ];
        addAdminLog(
          user,
          `Revisou anúncio #${id} (${list[idx].name}): ${body.approvalStatus}. ${reason}`,
        );
        if (override)
          addAdminLog(user, `Exceção de aprovação no anúncio #${id}: ${override.reason}`);
        addNotification(
          list[idx].ownerId,
          `Seu anúncio ${list[idx].name} foi ${body.approvalStatus === 'approved' ? 'aprovado' : body.approvalStatus === 'rejected' ? 'reprovado' : 'colocado em análise'}. Veja a justificativa completa no perfil privado.`,
        );
        eventMail(
          list[idx].ownerId,
          'moderation',
          'animal:' + id + ':decision:' + list[idx].moderationHistory.length,
          'animal.html?id=' + id,
        );
        saveState('animals', list);
        db.exec('COMMIT');
        return json(res, 200, animalPolicy.view(list[idx], user));
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      saveState('animals', list);
      if (user.role !== 'admin' && list[idx].approvalStatus === 'pending')
        notifyAnimalSubmission(list[idx]);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return json(res, 200, animalPolicy.view(list[idx], user));
  }
  if (method === 'DELETE' && match) {
    const user = requireUser(req, res);
    if (!user) return;
    const id = Number(match[1]);
    const list = loadState('animals');
    const animal = list.find((a) => a.id === id);
    if (!animal) return error(res, 404, 'Animal não encontrado.');
    if (!canManageAnimal(user, animal))
      return error(res, 403, 'Você não pode excluir este animal.');
    if (animal.seed)
      return error(
        res,
        400,
        'Os animais de demonstração não podem ser excluídos; altere o status para indisponível se necessário.',
      );
    if (animal.archivedAt) return json(res, 200, { ok: true, archived: true });
    const result = animalPolicy.change(
      animal,
      user,
      'archive',
      'Anúncio arquivado pelo responsável ou pela administração.',
    );
    return json(res, 200, { ok: true, archived: true, ...result });
  }

  match = pathname.match(/^\/api\/animals\/(\d+)\/(withdraw|external-adoption)$/);
  if (method === 'POST' && match) {
    const user = requireUser(req, res);
    if (!user) return;
    const animal = getAnimal(match[1]),
      body = await readBody(req);
    if (!animal) return error(res, 404, 'Animal não encontrado.');
    if (!canManageAnimal(user, animal))
      return error(res, 403, 'Você não pode alterar este animal.');
    if (
      animal.archivedAt ||
      animal.status === 'adotado' ||
      loadState('requests').some(
        (r) => Number(r.animalId) === animal.id && r.status === 'concluida',
      )
    )
      return error(res, 409, 'Este anúncio já foi encerrado ou tem uma adoção concluída.');
    const reason = inputText(body.reason, 1000);
    if (body.confirmed !== true)
      return error(res, 400, 'Confirme a alteração e o encerramento dos interessados ativos.');
    return json(res, 200, animalPolicy.change(animal, user, match[2], reason));
  }

  // Pedidos de adoção (regras do fluxo em lib/adoption-workflow.cjs) e histórias de adoção.
  if (method === 'GET' && pathname === '/api/requests') {
    const user = requireUser(req, res, null, true);
    if (!user) return;
    const list = loadState('requests');
    const visible = list.filter((request) => canReadRequest(user, request));
    return json(
      res,
      200,
      visible.map((request) => {
        if (Number(request.requesterId) === user.id) {
          const owner = db
            .prepare('SELECT * FROM users WHERE id=?')
            .get(Number(request.ownerId ?? getAnimal(request.animalId)?.ownerId));
          return {
            ...request,
            owner: publicUser(owner, request.ownerContactConsent === true, false),
          };
        }
        const requester = db
          .prepare('SELECT * FROM users WHERE id=?')
          .get(Number(request.requesterId));
        return {
          ...request,
          requester: publicUser(
            requester,
            user.role === 'admin' || request.requesterContactConsent === true,
            user.role === 'admin',
          ),
        };
      }),
    );
  }

  if (method === 'GET' && pathname === '/api/stories') {
    const stories = loadState('requests')
      .filter((r) => r.status === 'concluida' && r.story && r.storyPublic === true)
      .map((r) => {
        const animal = getAnimal(r.animalId),
          publicAnimal = isPublicAnimal(animal);
        return {
          id: r.id,
          animalId: r.animalId,
          animalName: publicAnimal ? animal.name : 'Animal adotado',
          photo: publicAnimal
            ? url.searchParams.has('media') && animal.photos?.[0]
              ? profileMedia.url('animal', animal.id, 0, animal.photos[0])
              : animal.photos?.[0] || ''
            : '',
          full_name: r.storyDisplayName || 'Família adotante',
          story: r.story,
          acceptedAt: r.completedAt || r.acceptedAt || null,
        };
      });
    return json(res, 200, stories);
  }

  if (method === 'POST' && pathname === '/api/requests') {
    if (rateLimit(req, res, 'requests-create', 30, 10 * 60 * 1000)) return;
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const animal = getAnimal(validate.id(body.animalId));
    if (!requireUser(req, res)) return;
    const clientToken = validate.optionalText(body.clientToken, 80);
    const clientPayloadHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(body))
      .digest('hex');
    const previous =
      clientToken &&
      loadState('requests').find((r) => r.requesterId === user.id && r.clientToken === clientToken);
    if (previous) {
      if (previous.clientPayloadHash !== clientPayloadHash)
        return error(res, 409, 'Identificador já usado para outro formulário.');
      return json(res, 200, previous);
    }
    if (!animal) return error(res, 404, 'Animal não encontrado.');
    if (!isAvailableAnimal(animal))
      return error(res, 409, 'Este animal não está disponível para novas solicitações.');
    if (Number(animal.ownerId) === user.id)
      return error(
        res,
        400,
        'Você não pode solicitar a adoção de um animal publicado pela sua própria conta.',
      );
    const list = loadState('requests');
    if (
      list.some(
        (r) =>
          r.animalId === animal.id &&
          r.requesterId === user.id &&
          ['pendente', 'em_analise', 'aprovada'].includes(r.status),
      )
    ) {
      return error(res, 409, 'Você já possui uma solicitação ativa para este animal.');
    }
    validate.adoption(body);
    const record = {
      id: newId('requests'),
      clientToken,
      clientPayloadHash,
      requesterContactConsent: validate.boolean(body.contactConsent),
      requesterContactConsentAt: now(),
      ownerContactConsent: false,
      animalId: animal.id,
      animalName: animal.name,
      requesterId: user.id,
      ownerId: Number(animal.ownerId),
      full_name: inputText(body.full_name || user.name, 120),
      age: body.age === undefined ? '' : String(body.age),
      city: inputText(body.city, 120),
      housing: inputText(body.housing, 50),
      has_yard: Boolean(body.has_yard),
      has_pets: Boolean(body.has_pets),
      experience:
        body.experience === undefined
          ? body.questionnaire.had_pets_before === 'sim'
          : body.experience,
      reason: inputText(body.reason, 2000),
      responsibility_confirmed: Boolean(body.responsibility_confirmed),
      questionnaire:
        body.questionnaire && typeof body.questionnaire === 'object'
          ? {
              household_agrees: inputText(body.questionnaire.household_agrees, 10),
              financial_conditions: inputText(body.questionnaire.financial_conditions, 10),
              alone_time: inputText(body.questionnaire.alone_time, 30),
              had_pets_before: inputText(body.questionnaire.had_pets_before, 10),
              vet_commitment: inputText(body.questionnaire.vet_commitment, 10),
              adaptation_plan: inputText(body.questionnaire.adaptation_plan, 1000),
            }
          : {},
      status: 'pendente',
      stage: 'enviada',
      createdAt: now(),
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: '',
    };
    if (!record.responsibility_confirmed)
      return error(res, 400, 'Confirme o compromisso com a adoção responsável.');
    db.exec('BEGIN IMMEDIATE');
    try {
      list.push(record);
      saveState('requests', list);
      addNotification(
        user.id,
        `Sua solicitação para ${animal.name} foi recebida e está pendente de análise.`,
      );
      addNotification(
        animal.ownerId,
        `${user.name} enviou uma solicitação de adoção para ${animal.name}.`,
      );
      eventMail(
        animal.ownerId,
        'request',
        'request:' + record.id + ':created',
        'painel-doador.html?tab=solicitacoes',
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return json(res, 201, record);
  }

  match = pathname.match(
    /^\/api\/requests\/(\d+)\/(analyze|approve|accept|interview|handover|confirm-receipt|reject|complete|cancel|story|share-contact|message)$/,
  );
  if (method === 'POST' && match) {
    const user = requireUser(req, res);
    if (!user) return;
    if (match[2] === 'message' && rateLimit(req, res, 'request-messages', 40, 10 * 60 * 1000))
      return;
    const body = await readBody(req);
    const currentUser = requireUser(req, res);
    if (!currentUser) return;
    return json(res, 200, adoptionWorkflow(currentUser, Number(match[1]), match[2], body));
  }

  // Favoritos.
  if (method === 'GET' && pathname === '/api/favorites') {
    const user = requireUser(req, res);
    if (!user) return;
    return json(
      res,
      200,
      loadState('favorites').filter((f) => f.userId === user.id),
    );
  }
  if (method === 'POST' && pathname === '/api/favorites/toggle') {
    if (rateLimit(req, res, 'favorites-toggle', 30, 10 * 60 * 1000)) return;
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const animalId = Number(body.animalId);
    if (!getAnimal(animalId)) return error(res, 404, 'Animal não encontrado.');
    let list = loadState('favorites');
    const exists = list.some((f) => f.userId === user.id && f.animalId === animalId);
    if (exists) list = list.filter((f) => !(f.userId === user.id && f.animalId === animalId));
    else list.push({ userId: user.id, animalId });
    saveState('favorites', list);
    return json(res, 200, { favorite: !exists });
  }

  // Animais desaparecidos e avistamentos.
  if (method === 'GET' && pathname === '/api/missing') {
    const user = authUser(req);
    return json(
      res,
      200,
      loadState('missing')
        .filter((m) => !m.hiddenAt || user?.role === 'admin' || Number(m.ownerId) === user?.id)
        .map((m) => {
          if (url.searchParams.has('media') && m.photo)
            m = {
              ...m,
              photo: profileMedia.url(
                'missing',
                m.id,
                0,
                m.photo,
                url.searchParams.get('media') === 'thumb' ? 'thumb' : 'gallery',
              ),
            };
          if (user?.role === 'admin' || Number(m.ownerId) === user?.id) return m;
          const { moderationHistory, hiddenBy, hiddenReason, ...visible } = m;
          return visible;
        }),
    );
  }
  if (method === 'POST' && pathname === '/api/missing') {
    if (rateLimit(req, res, 'missing-create', 30, 10 * 60 * 1000)) return;
    let user = requireUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const photo =
      body.photo == null || body.photo === ''
        ? null
        : await validate.image(body.photo, ROOT, { compress: true });
    user = requireUser(req, res);
    if (!user) return;
    const list = loadState('missing');
    accountLimits.ensureCount(user, 'missing');
    accountLimits.ensureStorage(user, accountLimits.bytes(photo));
    const record = {
      ...validate.missing(body),
      id: newId('missing'),
      ownerId: user.id,
      found: false,
      photo,
      createdAt: now(),
    };
    list.push(record);
    saveState('missing', list);
    const nearbyUsers = db
      .prepare(
        'SELECT id FROM users WHERE id <> ? AND city = ? COLLATE NOCASE AND state = ? COLLATE NOCASE',
      )
      .all(user.id, record.city, record.state);
    for (const nearby of nearbyUsers)
      addNotification(
        nearby.id,
        `Alerta local: ${record.name || 'um animal'} desapareceu em ${record.city}/${record.state}.`,
      );
    return json(res, 201, record);
  }
  match = pathname.match(/^\/api\/missing\/(\d+)$/);
  if (method === 'PATCH' && match) {
    const initialUser = requireUser(req, res);
    if (!initialUser) return;
    const id = Number(match[1]);
    const body = await readBody(req);
    const initialRecord = getMissing(id);
    if (!initialRecord) return error(res, 404, 'Registro não encontrado.');
    if (initialUser.role !== 'admin' && Number(initialRecord.ownerId) !== initialUser.id)
      return error(res, 403, 'Você não pode alterar este registro.');
    const changes = validate.missing(body, true);
    if (Object.hasOwn(body, 'photo'))
      changes.photo =
        body.photo === null || body.photo === ''
          ? null
          : await validate.image(body.photo, ROOT, { compress: true });
    // No image decoding or await inside the final write. Read/authenticate again under a short lock.
    db.exec('BEGIN IMMEDIATE');
    let committed = false;
    try {
      const user = requireUser(req, res);
      if (!user) return;
      const list = loadState('missing'),
        idx = list.findIndex((m) => m.id === id);
      if (idx < 0) return error(res, 404, 'Registro não encontrado.');
      if (user.role !== 'admin' && Number(list[idx].ownerId) !== user.id)
        return error(res, 403, 'Você não pode alterar este registro.');
      const responsible =
        db.prepare('SELECT * FROM users WHERE id=?').get(Number(list[idx].ownerId)) || user;
      if (changes.found === false && list[idx].found)
        accountLimits.ensureCount(responsible, 'missing');
      if (changes.photo !== undefined)
        accountLimits.ensureStorage(
          responsible,
          accountLimits.bytes(changes.photo),
          accountLimits.bytes(list[idx].photo),
        );
      // changes comes from the allowlist; moderation and other unsent fields stay in the current record.
      list[idx] = { ...list[idx], ...changes, updatedAt: now(), updatedBy: user.id };
      if (Object.hasOwn(changes, 'found')) list[idx].foundAt = changes.found ? now() : null;
      saveState('missing', list);
      db.exec('COMMIT');
      committed = true;
      return json(res, 200, list[idx]);
    } finally {
      if (!committed) db.exec('ROLLBACK');
    }
  }

  match = pathname.match(/^\/api\/missing\/(\d+)\/(hide|restore)$/);
  if (method === 'POST' && match) {
    const admin = requireUser(req, res, ['admin']);
    if (!admin) return;
    const body = await readBody(req),
      reason = validate.text(body.reason, 1000, 'a justificativa'),
      list = loadState('missing'),
      idx = list.findIndex((m) => m.id === Number(match[1]));
    if (idx < 0) return error(res, 404, 'Registro não encontrado.');
    const at = now(),
      hidden = match[2] === 'hide';
    list[idx] = {
      ...list[idx],
      hiddenAt: hidden ? at : null,
      hiddenBy: admin.id,
      hiddenReason: reason,
      moderationHistory: [
        ...(list[idx].moderationHistory || []),
        { action: match[2], actorId: admin.id, actorName: admin.name, at, reason },
      ],
    };
    saveState('missing', list);
    addAdminLog(
      admin,
      `${hidden ? 'Ocultou' : 'Restaurou'} desaparecido #${list[idx].id}. ${reason}`,
    );
    addNotification(
      list[idx].ownerId,
      `O registro de ${list[idx].name || 'animal desaparecido'} foi ${hidden ? 'ocultado' : 'restaurado'} pela administração. Veja a justificativa no perfil privado.`,
    );
    eventMail(
      list[idx].ownerId,
      'moderation',
      'missing:' + list[idx].id + ':decision:' + list[idx].moderationHistory.length,
      'desaparecido.html?id=' + list[idx].id,
    );
    return json(res, 200, list[idx]);
  }

  if (method === 'POST' && pathname === '/api/sightings') {
    if (rateLimit(req, res, 'sightings', 20, 10 * 60 * 1000)) return;
    const body = await readBody(req);
    const missing = getMissing(validate.id(body.missingAnimalId));
    const clientToken = validate.optionalText(body.clientToken, 80),
      clientPayloadHash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const previous =
      clientToken &&
      loadState('sightings').find(
        (s) => s.missingAnimalId === body.missingAnimalId && s.clientToken === clientToken,
      );
    if (previous) {
      if (previous.clientPayloadHash !== clientPayloadHash)
        return error(res, 409, 'Identificador já usado para outro avistamento.');
      return json(res, 200, { id: previous.id, createdAt: previous.createdAt });
    }
    if (!missing || missing.hiddenAt)
      return error(res, 404, 'Registro de animal desaparecido não encontrado.');
    if (missing.found) return error(res, 409, 'Este animal já foi marcado como encontrado.');
    const list = loadState('sightings');
    const record = {
      id: newId('sightings'),
      clientToken,
      clientPayloadHash,
      missingAnimalId: missing.id,
      reporter_name: inputText(body.reporter_name, 120),
      reporter_contact: inputText(body.reporter_contact, 120),
      location: inputText(body.location, 300),
      message: inputText(body.message, 2000),
      createdAt: now(),
    };
    if (!record.location) return error(res, 400, 'Informe onde o animal foi visto.');
    db.exec('BEGIN IMMEDIATE');
    try {
      list.push(record);
      saveState('sightings', list);
      eventMail(
        missing.ownerId,
        'sighting',
        'sighting:' + record.id,
        'painel-doador.html?tab=desaparecidos',
      );
      if (missing.ownerId)
        addNotification(
          missing.ownerId,
          `Novo avistamento informado para ${missing.name || 'seu animal desaparecido'} em ${record.location}.`,
        );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return json(res, 201, { id: record.id, createdAt: record.createdAt });
  }
  if (method === 'GET' && pathname === '/api/sightings') {
    const user = requireUser(req, res, null, true);
    if (!user) return;
    const missing = loadState('missing');
    const allowed = new Set(
      missing
        .filter((m) => user.role === 'admin' || Number(m.ownerId) === user.id)
        .map((m) => m.id),
    );
    return json(
      res,
      200,
      loadState('sightings').filter((s) => allowed.has(s.missingAnimalId)),
    );
  }

  // Contato com a equipe e denúncias.
  if (method === 'POST' && pathname === '/api/contact') {
    if (rateLimit(req, res, 'reports', 12, 10 * 60 * 1000)) return;
    const body = await readBody(req),
      name = validate.text(body.name, 120, 'o nome'),
      email = normalizeEmail(body.email),
      message = validate.text(body.message, 5000, 'a mensagem');
    if (!validEmail(email)) return error(res, 400, 'Informe um e-mail válido para resposta.');
    const user = authUser(req),
      list = loadState('reports'),
      id = newId('reports');
    list.push({
      id,
      reporterUserId: user?.id || null,
      target_type: 'outro',
      target_id: null,
      category: 'atendimento',
      contactName: name,
      contactEmail: email,
      reason: message,
      status: 'aberta',
      createdAt: now(),
    });
    saveState('reports', list);
    db.prepare("SELECT id FROM users WHERE role='admin'")
      .all()
      .forEach((admin) =>
        addNotification(
          admin.id,
          `PotyPet recebeu uma nova mensagem de atendimento: protocolo APPET-${id}.`,
        ),
      );
    return json(res, 201, { ok: true, protocol: 'APPET-' + id });
  }

  if (method === 'POST' && pathname === '/api/reports') {
    if (rateLimit(req, res, 'reports', 12, 10 * 60 * 1000)) return;
    const body = await readBody(req);
    const user = authUser(req);
    const list = loadState('reports');
    const target_type = validate.option(
        body.target_type,
        ['animal', 'missing', 'usuario', 'outro'],
        'outro',
      ),
      category = validate.option(
        body.category,
        ['informacao_falsa', 'maus_tratos', 'ja_adotado', 'duplicado', 'spam', 'outro'],
        'outro',
      );
    if (target_type !== 'outro' && (!Number.isSafeInteger(body.target_id) || body.target_id < 1))
      return error(res, 400, 'Informe o registro da denúncia.');
    if (target_type === 'missing' && !getMissing(body.target_id))
      return error(res, 404, 'Registro não encontrado.');
    const record = {
      id: newId('reports'),
      reporterUserId: user?.id || null,
      target_type,
      target_id: target_type === 'outro' ? null : body.target_id,
      category,
      reason: inputText(body.reason, 3000),
      status: 'aberta',
      createdAt: now(),
    };
    if (!record.reason) return error(res, 400, 'Informe os detalhes da mensagem/denúncia.');
    list.push(record);
    saveState('reports', list);
    return json(res, 201, record);
  }
  if (method === 'GET' && pathname === '/api/reports') {
    const user = requireUser(req, res, ['admin']);
    if (!user) return;
    return json(res, 200, loadState('reports'));
  }
  match = pathname.match(/^\/api\/reports\/(\d+)\/resolve$/);
  if (method === 'POST' && match) {
    const admin = requireUser(req, res, ['admin']);
    if (!admin) return;
    const id = Number(match[1]);
    const list = loadState('reports');
    const idx = list.findIndex((r) => r.id === id);
    if (idx < 0) return error(res, 404, 'Denúncia não encontrada.');
    list[idx].status = 'resolvida';
    list[idx].resolvedAt = now();
    saveState('reports', list);
    return json(res, 200, list[idx]);
  }

  // Perfil de adoção: preferências de quem quer adotar.
  if (method === 'GET' && pathname === '/api/adoption-profile') {
    const user = requireUser(req, res, null, true);
    if (!user) return;
    const record = loadState('adoptionProfiles').find((p) => p.userId === user.id) || null;
    return json(res, 200, record);
  }
  if (method === 'POST' && pathname === '/api/adoption-profile') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    validate.profile(body);
    const list = loadState('adoptionProfiles').filter((p) => p.userId !== user.id);
    const record = {
      userId: user.id,
      housing: inputText(body.housing, 30),
      has_yard: inputText(body.has_yard, 20),
      has_kids: inputText(body.has_kids, 20),
      other_pets: inputText(body.other_pets, 30),
      alone_time: inputText(body.alone_time, 30),
      experience: inputText(body.experience, 30),
      species: inputText(body.species, 30),
      age: inputText(body.age, 30),
      size: inputText(body.size, 30),
      energy: inputText(body.energy, 30),
      availability: inputText(body.availability, 30),
      updatedAt: now(),
    };
    list.push(record);
    saveState('adoptionProfiles', list);
    return json(res, 200, record);
  }

  // Notificações e histórico administrativo.
  if (method === 'GET' && pathname === '/api/notifications') {
    const user = requireUser(req, res, null, true);
    if (!user) return;
    const list = loadState('notifications')
      .filter((n) => n.userId === user.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return json(res, 200, list);
  }
  if (method === 'POST' && pathname === '/api/notifications/read') {
    const user = requireUser(req, res, null, true);
    if (!user) return;
    const list = loadState('notifications').map((n) =>
      n.userId === user.id ? { ...n, read: true } : n,
    );
    saveState('notifications', list);
    return json(res, 200, { ok: true });
  }

  if (method === 'GET' && pathname === '/api/admin-log') {
    const user = requireUser(req, res, ['admin']);
    if (!user) return;
    return json(
      res,
      200,
      loadState('adminLog').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    );
  }
  if (method === 'POST' && pathname === '/api/admin-log') {
    const admin = requireUser(req, res, ['admin']);
    if (!admin) return;
    const body = await readBody(req);
    addAdminLog(admin, body.message || 'Ação administrativa.');
    return json(res, 201, { ok: true });
  }

  match = pathname.match(/^\/api\/contracts\/(\d+)(\/acknowledge)?$/);
  if (match) {
    const user = requireUser(req, res, null, method === 'GET');
    if (!user) return;
    const requestId = Number(match[1]);
    const contracts = loadState('contracts');
    const idx = contracts.findIndex((c) => c.requestId === requestId);
    if (idx < 0) return error(res, 404, 'Termo de adoção não encontrado.');
    const contract = contracts[idx];
    if (user.role !== 'admin' && user.id !== contract.adopterId && user.id !== contract.ownerId)
      return error(res, 403, 'Você não pode acessar este termo.');
    if (method === 'GET' && !match[2]) return json(res, 200, contract);
    if (method === 'POST' && match[2]) {
      if (user.id !== contract.adopterId && user.id !== contract.ownerId)
        return error(res, 403, 'Somente as partes podem confirmar o termo.');
      const body = await readBody(req);
      if (body.confirmed !== true)
        return error(res, 400, 'Confirme a leitura e concordância com o termo.');
      const fresh = loadState('contracts'),
        i = fresh.findIndex((c) => c.requestId === requestId),
        field = user.id === contract.adopterId ? 'adopterAcknowledgedAt' : 'ownerAcknowledgedAt';
      if (!fresh[i][field]) {
        fresh[i][field] = now();
        saveState('contracts', fresh);
        addNotification(
          user.id === contract.adopterId ? contract.ownerId : contract.adopterId,
          'A outra parte registrou a leitura e concordância com o termo de adoção.',
        );
      }
      return json(res, 200, fresh[i]);
    }
  }

  // Acompanhamento depois da adoção.
  if (method === 'GET' && pathname === '/api/followups') {
    const user = requireUser(req, res, null, true);
    if (!user) return;
    const requests = loadState('requests');
    const allowed = new Set(requests.filter((r) => canReadRequest(user, r)).map((r) => r.id));
    return json(
      res,
      200,
      loadState('followups')
        .filter((f) => allowed.has(f.requestId))
        .map((f) =>
          url.searchParams.has('media') && f.photo
            ? { ...f, photo: profileMedia.url('followup', f.id, 0, f.photo, 'gallery') }
            : f,
        ),
    );
  }
  if (method === 'POST' && pathname === '/api/followups') {
    let user = requireUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const requestId = validate.id(body.requestId);
    const clientToken = validate.optionalText(body.clientToken, 80),
      clientPayloadHash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const previous =
      clientToken &&
      loadState('followups').find((f) => f.adopterId === user.id && f.clientToken === clientToken);
    if (previous) {
      if (previous.clientPayloadHash !== clientPayloadHash)
        return error(res, 409, 'Identificador já usado para outro acompanhamento.');
      return json(res, 200, previous);
    }
    const day = body.day;
    if (![7, 30, 90].includes(day)) return error(res, 400, 'Etapa de acompanhamento inválida.');
    const currentRequest = () => {
      const request = getRequest(requestId);
      if (!request || request.status !== 'concluida') {
        error(res, 404, 'Adoção concluída não encontrada.');
        return null;
      }
      if (request.requesterId !== user.id) {
        error(res, 403, 'Somente o adotante pode enviar este acompanhamento.');
        return null;
      }
      const dueAt = new Date(
        new Date(request.completedAt || request.acceptedAt).getTime() + day * 86400000,
      );
      if (!Number.isFinite(dueAt.getTime())) {
        error(res, 409, 'A data de conclusão precisa de revisão administrativa.');
        return null;
      }
      if (Date.now() < dueAt.getTime()) {
        error(
          res,
          409,
          `Este acompanhamento ficará disponível em ${dueAt.toLocaleDateString('pt-BR')}.`,
        );
        return null;
      }
      return request;
    };
    if (!currentRequest()) return;
    validate.followup(body);
    const validatedPhoto =
      body.photo == null || body.photo === '' ? null : await validate.image(body.photo, ROOT);
    user = requireUser(req, res);
    if (!user) return;
    const request = currentRequest();
    if (!request) return;
    const concurrent =
      clientToken &&
      loadState('followups').find((f) => f.adopterId === user.id && f.clientToken === clientToken);
    if (concurrent) {
      if (concurrent.clientPayloadHash !== clientPayloadHash)
        return error(res, 409, 'Identificador já usado para outro acompanhamento.');
      return json(res, 200, concurrent);
    }
    accountLimits.ensureStorage(user, accountLimits.bytes(validatedPhoto));
    const list = loadState('followups');
    if (list.some((f) => f.requestId === request.id && f.day === day))
      return error(res, 409, 'Este acompanhamento já foi enviado.');
    const record = {
      id: newId('followups'),
      clientToken,
      clientPayloadHash,
      requestId: request.id,
      animalId: request.animalId,
      adopterId: user.id,
      day,
      adaptation: body.adaptation,
      health: inputText(body.health, 1200),
      behavior: inputText(body.behavior, 1200),
      needsHelp: validate.boolean(body.needsHelp),
      photo: validatedPhoto,
      createdAt: now(),
    };
    db.exec('BEGIN IMMEDIATE');
    try {
      list.push(record);
      saveState('followups', list);
      const animal = getAnimal(request.animalId);
      const ownerId = request.ownerId ?? animal?.ownerId;
      if (ownerId)
        addNotification(
          ownerId,
          'Novo acompanhamento de ' +
            day +
            ' dias.' +
            (record.needsHelp ? ' A família pediu ajuda; responda no painel.' : ''),
        );
      if (record.needsHelp)
        eventMail(
          ownerId,
          'help',
          'followup:' + record.id + ':help',
          'painel-doador.html?tab=acompanhamentos',
        );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return json(res, 201, record);
  }

  match = pathname.match(/^\/api\/followups\/(\d+)\/respond$/);
  if (method === 'POST' && match) {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readBody(req),
      text = validate.text(body.response, 1500, 'a orientação');
    const list = loadState('followups'),
      i = list.findIndex((f) => f.id === Number(match[1]));
    if (i < 0) return error(res, 404, 'Acompanhamento não encontrado.');
    const f = list[i],
      r = getRequest(f.requestId);
    if (
      !r ||
      !canReadRequest(user, r) ||
      user.id === r.requesterId ||
      (user.role !== 'admin' && Number(r.ownerId ?? getAnimal(r.animalId)?.ownerId) !== user.id)
    )
      return error(res, 403, 'Somente o responsável ou a administração pode responder.');
    if (!f.needsHelp) return error(res, 409, 'Este acompanhamento não solicita ajuda.');
    if (f.helpResponse)
      return error(
        res,
        409,
        'Uma orientação já foi registrada. Continue o contato na conversa privada.',
      );
    Object.assign(f, { helpResponse: text, helpRespondedAt: now(), helpRespondedBy: user.id });
    db.exec('BEGIN IMMEDIATE');
    try {
      saveState('followups', list);
      addNotification(
        r.requesterId,
        'O responsável respondeu ao pedido de ajuda no acompanhamento.',
      );
      eventMail(
        r.requesterId,
        'helpResponse',
        'followup:' + f.id + ':response',
        'minhas-solicitacoes.html',
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return json(res, 200, f);
  }
  // Pontos de apoio.
  if (method === 'GET' && pathname === '/api/support-points')
    return json(res, 200, loadState('supportPoints'));
  if (method === 'POST' && pathname === '/api/support-points') {
    const admin = requireUser(req, res, ['admin']);
    if (!admin) return;
    const body = await readBody(req);
    const list = loadState('supportPoints');
    const record = {
      id: newId('supportPoints'),
      name: inputText(body.name, 160),
      category: inputText(body.category, 50),
      city: inputText(body.city, 120),
      state: validate.state(body.state),
      address: inputText(body.address, 300),
      contact: inputText(body.contact, 160),
      services: inputText(body.services, 1000),
      sourceUrl: inputText(body.sourceUrl, 1000),
      verified: true,
      createdAt: now(),
    };
    validate.option(record.category, [
      'ong',
      'veterinario',
      'zoonoses',
      'castracao',
      'lar_temporario',
      'transporte',
      'doacao',
    ]);
    if (!record.name || !record.category || !record.city || !record.state)
      return error(res, 400, 'Preencha nome, categoria, cidade e estado.');
    if (!validExternalUrl(record.sourceUrl))
      return error(res, 400, 'Informe um link oficial válido começando com https://.');
    list.push(record);
    saveState('supportPoints', list);
    addAdminLog(admin, `Adicionou ${record.name} à rede de apoio.`);
    return json(res, 201, record);
  }
  match = pathname.match(/^\/api\/support-points\/(\d+)$/);
  if (method === 'DELETE' && match) {
    const admin = requireUser(req, res, ['admin']);
    if (!admin) return;
    const id = Number(match[1]);
    const list = loadState('supportPoints');
    const point = list.find((p) => p.id === id);
    if (!point) return error(res, 404, 'Ponto de apoio não encontrado.');
    saveState(
      'supportPoints',
      list.filter((p) => p.id !== id),
    );
    addAdminLog(admin, `Removeu ${point.name} da rede de apoio.`);
    return json(res, 200, { ok: true });
  }

  return error(res, 404, 'Rota da API não encontrada.');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};
function profileMetadata(url) {
  const animal = getAnimal(Number(url.searchParams.get('id'))),
    publicAnimal = isPublicAnimal(animal);
  const configured =
    process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://127.0.0.1:' + PORT;
  let origin;
  try {
    const base = new URL(configured);
    if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password)
      throw Error();
    origin = base.origin;
  } catch {
    return '';
  }
  const escape = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const title = publicAnimal ? animal.name + ' · PotyPet' : 'Perfil do animal · PotyPet',
    description = publicAnimal
      ? (
          animal.name +
          '. ' +
          animal.city +
          '/' +
          animal.state +
          '. ' +
          (animal.description || '')
        ).slice(0, 250)
      : 'Conheça os animais publicados no PotyPet.';
  const canonical = origin + '/animal.html' + (publicAnimal ? '?id=' + animal.id : ''),
    image =
      publicAnimal && animal.photos?.[0]
        ? origin + profileMedia.url('animal', animal.id, 0, animal.photos[0], 'preview')
        : null;
  return (
    '<title>' +
    escape(title) +
    '</title><meta name="description" content="' +
    escape(description) +
    '"><meta property="og:title" content="' +
    escape(title) +
    '"><meta property="og:description" content="' +
    escape(description) +
    '"><meta property="og:site_name" content="PotyPet"><meta property="og:type" content="article"><meta property="og:url" content="' +
    escape(canonical) +
    '"><meta name="twitter:card" content="' +
    (image ? 'summary_large_image' : 'summary') +
    '"><meta name="twitter:title" content="' +
    escape(title) +
    '"><meta name="twitter:description" content="' +
    escape(description) +
    '">' +
    (image
      ? '<meta property="og:image" content="' +
        escape(image) +
        '"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="Foto de ' +
        escape(animal.name) +
        '"><meta name="twitter:image" content="' +
        escape(image) +
        '">'
      : '') +
    '<meta name="robots" content="' +
    (publicAnimal ? 'index,follow' : 'noindex,nofollow') +
    '"><link rel="canonical" href="' +
    escape(canonical) +
    '">'
  );
}
// Arquivos do site. Só o HTML da raiz e as pastas css, js, img e fonts são públicos;
// o restante (data, lib, testes, documentos) responde 403.
function serveStatic(req, res, url) {
  securityHeaders(res);
  let rel = decodeURIComponent(url.pathname);
  if (rel.includes('\0')) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Requisição inválida.');
  }
  if (rel === '/') rel = '/index.html';
  const target = path.resolve(ROOT, '.' + rel);
  const relative = path.relative(ROOT, target);
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative === '..' ||
    relative.startsWith('..' + path.sep)
  ) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Acesso negado.');
  }
  const normalized = relative.split(path.sep).join('/').toLowerCase();
  const allowedExtensions = new Set(Object.keys(MIME));
  const segments = normalized.split('/');
  // Only front-end locations are public, even for allowed extensions.
  const publicLocation =
    (segments.length === 1 && path.extname(normalized) === '.html') ||
    ['js', 'css', 'img', 'fonts'].includes(segments[0]);
  if (
    segments.some((part) => part.startsWith('.')) ||
    normalized === 'data' ||
    normalized.startsWith('data/') ||
    !publicLocation ||
    !allowedExtensions.has(path.extname(normalized))
  ) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Acesso negado.');
  }
  if (normalized === 'animal.html') {
    fs.readFile(target, 'utf8', (err, body) => {
      if (err) {
        error(res, 404, 'Página indisponível.');
        return;
      }
      const metadata = profileMetadata(url);
      const html = body
        .replace(/<title>[\s\S]*?<\/title>/gi, '')
        .replace(
          /<meta\s+[^>]*(?:name|property)=["'](?:description|og:[^"']+|twitter:[^"']+|robots)["'][^>]*>/gi,
          '',
        )
        .replace('</head>', metadata + '</head>');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Content-Length': Buffer.byteLength(html),
      });
      res.end(req.method === 'HEAD' ? undefined : html);
    });
    return;
  }
  fs.stat(target, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Arquivo não encontrado.');
    }
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Cache-Control': ['.html', '.js', '.css'].includes(ext) ? 'no-cache' : 'public, max-age=3600',
    });
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(target);
    stream.on('error', () => {
      if (!res.headersSent) error(res, 404, 'Arquivo não encontrado.');
      else res.destroy();
    });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  });
}

// Servidor HTTP: as rotas /api vão para handleApi e o resto para serveStatic.
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (!['GET', 'HEAD'].includes(req.method)) return error(res, 405, 'Método não permitido.');
    return serveStatic(req, res, url);
  } catch (err) {
    const malformed = err.code === 'ERR_INVALID_URL' || err instanceof URIError;
    const busy =
      err.errcode === 5 ||
      err.errcode === 6 ||
      /SQLITE_BUSY|SQLITE_LOCKED|database is locked/i.test(err.message || '');
    const status = busy ? 503 : malformed ? 400 : err.status || 500;
    if (busy) res.setHeader('Retry-After', '2');
    if (status === 413) res.setHeader('Connection', 'close');
    if (status >= 500) console.error(err);
    if (!res.headersSent)
      error(
        res,
        status,
        busy
          ? 'O serviço está ocupado. Aguarde alguns segundos e tente novamente.'
          : malformed
            ? 'Requisição inválida.'
            : err.status
              ? err.message
              : 'Erro interno do servidor.',
      );
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  mail.start();
  backups.start();
  console.log(`PotyPet rodando em http://127.0.0.1:${PORT}`);
  try {
    const os = require('node:os');
    const addresses = Object.values(os.networkInterfaces())
      .flat()
      .filter((x) => x && x.family === 'IPv4' && !x.internal);
    for (const info of addresses) console.log(`Na mesma rede: http://${info.address}:${PORT}`);
  } catch {
    /* sem interfaces de rede: apenas não exibe o endereço da rede local */
  }
  console.log(`Banco SQLite: ${DB_PATH}`);
  if (bootstrapCredentials) {
    console.log('Contas iniciais criadas. Guarde estes dados agora:');
    console.log(
      `Administrador: ${bootstrapCredentials.adminEmail}${bootstrapCredentials.adminPassword ? ` / ${bootstrapCredentials.adminPassword}` : ' / senha definida por ADMIN_PASSWORD'}`,
    );
    console.log(
      `Doador: ${bootstrapCredentials.donorEmail}${bootstrapCredentials.donorPassword ? ` / ${bootstrapCredentials.donorPassword}` : ' / senha definida por DONOR_PASSWORD'}`,
    );
  }
});
