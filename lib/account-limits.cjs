// Limites de uso por tipo de conta (anúncios, desaparecidos e espaço de fotos).
// Os valores padrão podem ser trocados por variáveis de ambiente, como USER_ANIMAL_LIMIT e ORG_STORAGE_MB.
'use strict';
const fail = (message) => {
  throw Object.assign(new Error(message), { status: 409 });
};
module.exports = function ({ db, loadState, env = process.env }) {
  const configured = (key, fallback) => {
    const value = Number(env[key] || fallback);
    if (!Number.isSafeInteger(value) || value < 1) throw Error(key + ' deve ser inteiro positivo.');
    return value;
  };
  const policy = {
    usuario: {
      animals: configured('USER_ANIMAL_LIMIT', 50),
      missing: configured('USER_MISSING_LIMIT', 10),
      storageBytes: configured('USER_STORAGE_MB', 100) * 1024 * 1024,
    },
    ong: {
      animals: configured('ORG_ANIMAL_LIMIT', 300),
      missing: configured('ORG_MISSING_LIMIT', 100),
      storageBytes: configured('ORG_STORAGE_MB', 500) * 1024 * 1024,
    },
    admin: {
      animals: configured('ADMIN_ANIMAL_LIMIT', 2000),
      missing: configured('ADMIN_MISSING_LIMIT', 500),
      storageBytes: configured('ADMIN_STORAGE_MB', 1024) * 1024 * 1024,
    },
  };
  const limits = (user) => policy[user.account_type || 'usuario'] || policy.usuario;
  const bytes = (value) =>
    typeof value === 'string' && /^data:image\/[a-z]+;base64,/i.test(value)
      ? Buffer.byteLength(value.slice(value.indexOf(',') + 1), 'base64')
      : 0;
  function usage(user) {
    let storageBytes = 0;
    const owned = (key, field = 'ownerId') =>
      loadState(key).filter((r) => Number(r[field]) === user.id);
    for (const r of owned('animals'))
      storageBytes += (r.photos || []).reduce((n, p) => n + bytes(p), 0);
    for (const r of owned('missing')) storageBytes += bytes(r.photo);
    for (const r of owned('followups', 'adopterId')) storageBytes += bytes(r.photo);
    if (
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='campaign_files'").get()
    )
      storageBytes += Number(
        db
          .prepare(
            'SELECT COALESCE(SUM(length(data)),0) AS bytes FROM campaign_files WHERE owner_id=?',
          )
          .get(user.id).bytes,
      );
    return {
      animals: owned('animals').filter((a) => !a.archivedAt).length,
      missing: owned('missing').filter((m) => !m.found).length,
      storageBytes,
    };
  }
  function ensureCount(user, key) {
    if (usage(user)[key] >= limits(user)[key])
      fail(
        `Limite de ${limits(user)[key]} anúncios ${key === 'animals' ? 'de adoção' : 'de desaparecidos ativos'} para esta conta atingido. Consulte seus registros ou peça apoio pelo contato.`,
      );
  }
  function ensureStorage(user, added, removed = 0) {
    const current = usage(user).storageBytes,
      limit = limits(user).storageBytes,
      next = current - removed + added;
    if (next > limit && next > current)
      fail(
        'O armazenamento desta conta atingiu o limite de ' +
          Math.floor(limit / 1024 / 1024) +
          ' MB. Reduza o tamanho das fotos ou solicite revisão pelo contato. Seus registros anteriores foram preservados.',
      );
  }
  return {
    limits,
    usage,
    bytes,
    ensureCount,
    ensureStorage,
    summary: (user) => ({ limits: limits(user), usage: usage(user) }),
  };
};
