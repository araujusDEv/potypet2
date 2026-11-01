// Entrega das fotos de animais, desaparecidos e acompanhamentos em tamanhos derivados
// (miniatura, galeria), gerados a partir da foto original.
'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  sharp = require('sharp');
module.exports = function ({
  db,
  root,
  dataDir,
  loadState,
  getAnimal,
  getMissing,
  isPublicAnimal,
  animalPolicy,
  canReadRequest,
  authUser,
  securityHeaders,
  error,
}) {
  const cacheDir = path.join(dataDir, 'derived-media'),
    maxCache = 150 * 1024 * 1024,
    pending = new Map();
  let active = 0,
    pruning = false,
    lastPrune = 0;
  const waiters = [];
  const digest = (src) => crypto.createHash('sha256').update(src).digest('hex');
  const sourceBytes = (src) => {
    const m = String(src).match(
      /^data:image\/(?:png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=\r\n]+)$/i,
    );
    if (m) return Buffer.from(m[1], 'base64');
    if (/^img\/[a-zA-Z0-9_.-]+\.(?:png|jpe?g|webp|gif)$/i.test(src)) {
      try {
        return fs.readFileSync(path.join(root, src));
      } catch {
        /* origem ausente: tenta a próxima */
      }
    }
    return null;
  };
  const url = (kind, id, index, src, variant = 'thumb') =>
    src
      ? `/api/profile-media/${kind}/${Number(id)}/${index}/${variant}?v=${digest(src).slice(0, 20)}`
      : '';
  function photoInfo(kind, id, index, user) {
    if (kind === 'animal') {
      const a = getAnimal(id);
      return a && (isPublicAnimal(a) || animalPolicy.party(user, a))
        ? { src: a.photos?.[index], public: isPublicAnimal(a) }
        : null;
    }
    if (kind === 'missing') {
      const m = getMissing(id);
      return m && (!m.hiddenAt || user?.role === 'admin' || Number(m.ownerId) === user?.id)
        ? { src: index === 0 ? m.photo : null, public: !m.hiddenAt }
        : null;
    }
    const f = loadState('followups').find((f) => f.id === id),
      r = f && loadState('requests').find((r) => r.id === f.requestId);
    return f && r && canReadRequest(user, r)
      ? { src: index === 0 ? f.photo : null, public: false }
      : null;
  }
  async function derived(src, variant) {
    const key = digest(src) + '-' + variant,
      ext = variant === 'preview' ? 'jpg' : 'webp',
      file = path.join(cacheDir, key + '.' + ext);
    try {
      return await fs.promises.readFile(file);
    } catch {
      /* arquivo ausente: segue para o próximo caminho */
    }
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= 64)
      throw Object.assign(Error('As fotos estão carregando. Tente novamente em alguns segundos.'), {
        status: 503,
      });
    const task = (async () => {
      if (active >= 4) await new Promise((resolve) => waiters.push(resolve));
      active++;
      try {
        const bytes = sourceBytes(src);
        if (!bytes) throw Object.assign(Error('Foto indisponível.'), { status: 404 });
        const image = sharp(bytes, { limitInputPixels: 20_000_000 }).rotate();
        const result =
          variant === 'preview'
            ? await image
                .resize(1200, 630, { fit: 'contain', background: '#ffffff' })
                .jpeg({ quality: 82, mozjpeg: true })
                .toBuffer()
            : await image
                .resize(variant === 'thumb' ? 480 : 1280, variant === 'thumb' ? 480 : 1280, {
                  fit: 'inside',
                  withoutEnlargement: true,
                })
                .webp({ quality: variant === 'thumb' ? 76 : 82 })
                .toBuffer();
        await fs.promises.mkdir(cacheDir, { recursive: true });
        const temporary = file + '.' + crypto.randomUUID() + '.tmp';
        await fs.promises.writeFile(temporary, result);
        await fs.promises.rename(temporary, file);
        if (!pruning && Date.now() - lastPrune > 30000) {
          pruning = true;
          try {
            const names = (await fs.promises.readdir(cacheDir)).filter((name) =>
                /\.(webp|jpg)$/.test(name),
              ),
              entries = await Promise.all(
                names.map(async (name) => {
                  const target = path.join(cacheDir, name);
                  const st = await fs.promises.stat(target);
                  return { target, size: st.size, time: st.mtimeMs };
                }),
              );
            let total = entries.reduce((n, e) => n + e.size, 0);
            if (total > maxCache)
              for (const e of entries.sort((a, b) => a.time - b.time)) {
                if (total <= maxCache) break;
                await fs.promises.unlink(e.target).catch(() => {});
                total -= e.size;
              }
            lastPrune = Date.now();
          } finally {
            pruning = false;
          }
        }
        return result;
      } finally {
        active--;
        waiters.shift()?.();
      }
    })();
    pending.set(key, task);
    try {
      return await task;
    } finally {
      pending.delete(key);
    }
  }
  function card(a) {
    const result = {};
    for (const k of [
      'id',
      'name',
      'species',
      'breed',
      'sex',
      'size',
      'age_group',
      'city',
      'state',
      'status',
      'approvalStatus',
      'featured',
      'verified',
      'ownerId',
      'createdAt',
      'views',
      'archivedAt',
      'withdrawnAt',
      'adoptionOrigin',
      'neutered',
      'vaccinated',
      'dewormed',
      'energy_level',
      'personality',
      'coexistence',
    ])
      if (a[k] !== undefined) result[k] = a[k];
    result.publicEligible = isPublicAnimal(a);
    result.description = String(a.description || '').slice(0, 120);
    result.special_needs = Boolean(a.special_needs);
    result.photoCount = (a.photos || []).length;
    result.photos = a.photos?.[0] ? [url('animal', a.id, 0, a.photos[0])] : [];
    result.coverLarge = a.photos?.[0] ? url('animal', a.id, 0, a.photos[0], 'gallery') : '';
    return result;
  }
  const detail = (a, user) => ({
    ...animalPolicy.view(a, user),
    owner: {
      id: Number(a.ownerId),
      name:
        db.prepare('SELECT name FROM users WHERE id=?').get(Number(a.ownerId))?.name ||
        'Responsável',
    },
    photos: (a.photos || []).map((src, index) => url('animal', a.id, index, src, 'gallery')),
    thumbnails: (a.photos || []).map((src, index) => url('animal', a.id, index, src)),
    previewImage:
      isPublicAnimal(a) && a.photos?.[0] ? url('animal', a.id, 0, a.photos[0], 'preview') : null,
  });
  async function handle(req, res, u) {
    const m = u.pathname.match(
      /^\/api\/profile-media\/(animal|missing|followup)\/(\d+)\/(\d+)\/(thumb|gallery|preview)$/,
    );
    if (!m) return false;
    if (!['GET', 'HEAD'].includes(req.method)) {
      error(res, 405, 'Método não permitido.');
      return true;
    }
    const info = photoInfo(m[1], Number(m[2]), Number(m[3]), authUser(req));
    if (
      !info?.src ||
      (m[4] === 'preview' && !info.public) ||
      u.searchParams.get('v') !== digest(info.src).slice(0, 20)
    ) {
      error(res, 404, 'Foto indisponível.');
      return true;
    }
    const buffer = await derived(info.src, m[4]),
      etag = '"' + digest(info.src) + '-' + m[4] + '"';
    const current = photoInfo(m[1], Number(m[2]), Number(m[3]), authUser(req));
    if (!current || current.src !== info.src || (m[4] === 'preview' && !current.public)) {
      error(res, 404, 'Foto indisponível.');
      return true;
    }
    securityHeaders(res);
    res.setHeader('Cache-Control', current.public ? 'public, max-age=300' : 'private, no-store');
    res.setHeader('Vary', 'Cookie');
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304);
      res.end();
      return true;
    }
    res.writeHead(200, {
      'Content-Type': m[4] === 'preview' ? 'image/jpeg' : 'image/webp',
      'Content-Length': buffer.length,
    });
    res.end(req.method === 'HEAD' ? undefined : buffer);
    return true;
  }
  return { url, card, detail, handle };
};
