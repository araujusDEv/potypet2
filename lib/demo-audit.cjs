// Procura contas de demonstração com senha conhecida e dados de exemplo.
// Em produção o servidor não inicia enquanto houver credenciais conhecidas.
'use strict';
const fs = require('node:fs');
module.exports = function audit({ db, loadState, seedPath, verifyPassword }) {
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  function report() {
    const records = [],
      preconfigured = [],
      placeholders = [];
    for (const collection of ['animals', 'missing', 'supportPoints'])
      for (const r of loadState(collection)) {
        if (collection === 'supportPoints') {
          if (r.seed || r.seedKey)
            preconfigured.push({ collection, id: r.id, name: r.name, requiresSourceReview: true });
          continue;
        }
        const photos = collection === 'animals' ? r.photos || [] : [r.photo],
          usesExample = photos.some((p) => /^img\/(?:animal|missing)\d+\.png$/.test(p || ''));
        const original = (seed[collection] || []).find(
          (s) =>
            s.name === r.name &&
            s.createdAt === r.createdAt &&
            s.city === r.city &&
            (s.description || s.features || '') === (r.description || r.features || ''),
        );
        if (r.seed === true || original)
          records.push({
            collection,
            id: r.id,
            name: r.name,
            classification: r.seed === true ? 'sample_origin' : 'sample_match_requires_review',
            reason:
              r.seed === true
                ? 'Origem marcada como amostra; confirme se foi convertido em registro real.'
                : 'Semelhança com o seed; precisa de confirmação humana.',
          });
        if (usesExample)
          placeholders.push({
            collection,
            id: r.id,
            name: r.name,
            reason:
              'Usa foto de exemplo do pacote; não classifica sozinho o registro como fictício.',
          });
      }
    const weakAccounts = [];
    for (const user of db
      .prepare('SELECT id,name,email,role,password_salt,password_hash FROM users')
      .all()) {
      if (
        user.role === 'admin' ||
        ['admin@adotapet.com', 'ong@adotapet.com'].includes(user.email.toLowerCase())
      ) {
        if (
          ['admin123', 'doador123'].some((password) =>
            verifyPassword(password, user.password_salt, user.password_hash),
          )
        )
          weakAccounts.push({
            id: user.id,
            name: user.name,
            reason: 'Credencial conhecida de demonstração ainda ativa.',
          });
      }
    }
    return { records, preconfigured, placeholders, weakAccounts, automaticDeletion: false };
  }
  return { report };
};
