'use strict';
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  vm = require('node:vm'),
  crypto = require('node:crypto'),
  sharp = require('sharp');
const { spawn } = require('node:child_process'),
  { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..'),
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'appet-etapa4-')),
  base = 'http://127.0.0.1:3185';
let child;
const groups = [];
const pass = (name) => {
  groups.push(name);
  console.log('OK etapa4 — ' + name);
};
async function start() {
  let output = '';
  child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      EMAIL_TRANSPORT: 'disabled',
      BACKUP_AUTO: '0',
      SEED_SAMPLE_DATA: '0',
      SEED_DEMO_ACCOUNTS: '1',
      HOST: '127.0.0.1',
      PORT: '3185',
      DATA_DIR: dataDir,
      ADMIN_EMAIL: 'admin@adotapet.com',
      ADMIN_PASSWORD: '',
      DONOR_EMAIL: 'ong@adotapet.com',
      DONOR_PASSWORD: '',
      ADMIN_RECOVERY_ID: '',
      USER_ANIMAL_LIMIT: '8',
      USER_MISSING_LIMIT: '1',
      USER_STORAGE_MB: '1',
    },
  });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (d) => (output += d));
  for (let i = 0; !output.includes('PotyPet rodando'); i++) {
    if (i > 200 || child.exitCode !== null) throw Error(output);
    await new Promise((r) => setTimeout(r, 50));
  }
}
async function stop() {
  if (child?.exitCode === null) {
    const done = new Promise((r) => child.once('exit', r));
    child.kill();
    await done;
  }
}
(async () => {
  try {
    await start();
    const f = await require('./etapa1-fixtures.cjs')({ base, dataDir }),
      { owner, other, admin, guest } = f.clients;
    const cards = await guest.call('GET', '/api/animals/cards');
    assert.equal(cards.length, 2);
    assert.ok(cards.every((a) => a.approvalStatus === 'approved' && a.status === 'disponivel'));
    assert.ok(!JSON.stringify(cards).includes('data:image'));
    for (const a of cards) {
      assert.equal(a.health_notes, undefined);
      assert.equal(a.history, undefined);
      assert.equal(a.contact, undefined);
    }
    const manage = await owner.call('GET', '/api/animals/cards?view=manage');
    assert.equal(manage.length, 7);
    assert.ok(manage.some((a) => a.approvalStatus === 'pending'));
    await guest.call('GET', '/api/animals/cards?view=manage', undefined, 401);
    assert.equal((await other.call('GET', '/api/animals/cards?view=manage')).length, 0);
    const individual = await guest.call('GET', '/api/animals/' + f.animals.approved.id);
    assert.equal(individual.id, f.animals.approved.id);
    assert.equal(individual.owner.name, f.users.owner.name);
    assert.ok(individual.photos[0].includes('/gallery?'));
    await guest.call('GET', '/api/animals/' + f.animals.pending.id, undefined, 404);
    assert.equal(
      (await owner.call('GET', '/api/animals/' + f.animals.pending.id)).approvalStatus,
      'pending',
    );
    pass(
      'cards compactos e consulta individual respeitam publicação, disponibilidade e autorização',
    );
    const photo = await fetch(base + cards[0].photos[0]);
    assert.equal(photo.status, 200);
    assert.equal(photo.headers.get('content-type'), 'image/webp');
    const buffer = Buffer.from(await photo.arrayBuffer()),
      meta = await sharp(buffer).metadata();
    assert.ok(meta.width <= 480 && meta.height <= 480);
    assert.ok(buffer.length < fs.statSync(path.join(root, 'img/animal1.png')).size);
    const cached = await fetch(base + cards[0].photos[0], {
      headers: { 'If-None-Match': photo.headers.get('etag') },
    });
    assert.equal(cached.status, 304);
    const pending = await owner.call('GET', '/api/animals/' + f.animals.pending.id);
    assert.equal((await fetch(base + pending.photos[0])).status, 404);
    const privatePhoto = await fetch(base + pending.photos[0], {
      headers: { Cookie: owner.cookie },
    });
    assert.equal(privatePhoto.status, 200);
    assert.match(privatePhoto.headers.get('cache-control'), /no-store/);
    const original = (await owner.call('GET', '/api/animals')).find((a) => a.id === pending.id);
    assert.equal(original.photos[0], 'img/animal1.png');
    pass('miniaturas WebP, dimensões, ETag e fotos privadas; originais preservados');
    const html = await (await fetch(base + '/animal.html?id=' + f.animals.approved.id)).text();
    assert.ok(html.includes('property="og:title" content="Etapa1 approved'));
    const preview = html.match(/property="og:image" content="([^"]+)"/)[1].replaceAll('&amp;', '&');
    const response = await fetch(preview);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    const previewMeta = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    assert.equal(previewMeta.width, 1200);
    assert.equal(previewMeta.height, 630);
    const privateHTML = await (await fetch(base + '/animal.html?id=' + pending.id)).text();
    assert.ok(!privateHTML.includes('Etapa1 pending'));
    assert.ok(privateHTML.includes('noindex,nofollow'));
    assert.ok(!privateHTML.includes('property="og:image"'));
    await admin.call('PATCH', '/api/animals/' + f.animals.approved.id, {
      approvalStatus: 'rejected',
      reason: 'Teste de retirada da imagem de preview.',
    });
    assert.equal((await fetch(preview)).status, 404);
    assert.ok(
      !(await (await fetch(base + '/animal.html?id=' + f.animals.approved.id)).text()).includes(
        'Etapa1 approved',
      ),
    );
    pass(
      'metadados no HTML sem JavaScript, preview JPEG público e retirada imediata após reprovação',
    );
    const quota = await owner.call('GET', '/api/account/limits');
    assert.equal(quota.usage.animals, 7);
    assert.equal(quota.limits.animals, 8);
    assert.equal(quota.limits.storageBytes, 1024 * 1024);
    const extra = await owner.call(
      'POST',
      '/api/animals',
      { name: 'Limite fictício', city: 'Apodi', state: 'RN' },
      201,
    );
    await owner.call(
      'POST',
      '/api/animals',
      { name: 'Excesso fictício', city: 'Apodi', state: 'RN' },
      409,
    );
    await owner.call('DELETE', '/api/animals/' + extra.id);
    assert.equal(
      (await owner.call('GET', '/api/animals')).find((a) => a.id === extra.id).archivedAt !==
        undefined,
      true,
    );
    const noise = await sharp(crypto.randomBytes(1280 * 1280 * 3), {
      raw: { width: 1280, height: 1280, channels: 3 },
    })
      .jpeg({ quality: 100 })
      .toBuffer();
    assert.ok(noise.length > 1024 * 1024 && noise.length < 3 * 1024 * 1024);
    assert.ok(
      (await sharp(noise).jpeg({ quality: 85, mozjpeg: true }).toBuffer()).length * 2 > 1024 * 1024,
    );
    await owner.call(
      'POST',
      '/api/animals',
      {
        name: 'Armazenamento fictício',
        city: 'Apodi',
        state: 'RN',
        photos: Array(2).fill('data:image/jpeg;base64,' + noise.toString('base64')),
      },
      409,
    );
    const missing = await owner.call(
      'POST',
      '/api/missing',
      { name: 'Teste de limite', city: 'Apodi', state: 'RN', missing_date: '2026-10-01' },
      201,
    );
    await owner.call(
      'POST',
      '/api/missing',
      { name: 'Excesso', city: 'Apodi', state: 'RN', missing_date: '2026-10-01' },
      409,
    );
    await owner.call('PATCH', '/api/missing/' + missing.id, { found: true });
    const missing2 = await owner.call(
      'POST',
      '/api/missing',
      { name: 'Novo ativo', city: 'Apodi', state: 'RN', missing_date: '2026-10-01' },
      201,
    );
    await owner.call('PATCH', '/api/missing/' + missing.id, { found: false }, 409);
    const db = new DatabaseSync(path.join(dataDir, 'adotapet.db'));
    try {
      const rows = JSON.parse(
        db.prepare("SELECT value FROM app_state WHERE key='animals'").get().value,
      );
      rows.find((a) => a.id === pending.id).photos = [
        'data:image/jpeg;base64,' + noise.toString('base64'),
      ];
      db.prepare("UPDATE app_state SET value=? WHERE key='animals'").run(JSON.stringify(rows));
    } finally {
      db.close();
    }
    await owner.call('PATCH', '/api/animals/' + pending.id, {
      description: 'Editar texto em conta acima do limite mantém o histórico.',
    });
    assert.equal(
      (await owner.call('GET', '/api/animals')).find((a) => a.id === pending.id).photos.length,
      1,
    );
    pass(
      'limites por conta, armazenamento, reativação e preservação de registros acima dos novos limites',
    );
    const sandbox = { window: {}, document: { addEventListener() {} }, console };
    vm.createContext(sandbox);
    vm.runInContext(
      fs.readFileSync(path.join(root, 'js/store.js'), 'utf8') +
        '\nthis.compat=computeCompatibility;',
      sandbox,
    );
    const profile = {
        has_kids: 'sim',
        other_pets: 'gato',
        species: 'cachorro',
        size: 'medio',
        age: 'adulto',
        energy: 'medio',
        housing: 'casa',
        alone_time: '2_4h',
      },
      pet = {
        name: 'Fixture',
        species: 'cachorro',
        size: 'medio',
        age_group: 'adulto',
        energy_level: 'medio',
        coexistence: { kids: 'nao', cats: 'nao' },
      };
    let compatibility = sandbox.compat(profile, pet);
    assert.equal(compatibility.score, null);
    assert.equal(compatibility.eligible, false);
    assert.equal(compatibility.conflicts.length, 2);
    compatibility = sandbox.compat(profile, {
      ...pet,
      coexistence: { kids: 'nao_informado', cats: 'nao_informado' },
    });
    assert.equal(compatibility.needsReview, true);
    assert.equal(compatibility.uncertainties.length, 2);
    assert.ok(
      sandbox.compat(profile, { ...pet, coexistence: { kids: 'sim', cats: 'sim' } }).score > 80,
    );
    pass('conflitos importantes suprimem percentual e convivência desconhecida exige confirmação');
    const sources = [
      ...fs
        .readdirSync(path.join(root, 'js'))
        .filter((f) => f.endsWith('.js'))
        .map((f) => path.join(root, 'js', f)),
      ...fs.readdirSync(path.join(root, 'js/pages')).map((f) => path.join(root, 'js/pages', f)),
    ]
      .map((p) => fs.readFileSync(p, 'utf8'))
      .join('\n');
    assert.ok(!/xhr\.open\([^\n]*false/.test(sources));
    assert.ok(!sources.includes('new XMLHttpRequest'));
    assert.ok(!(await (await fetch(base + '/sobre.html')).text()).includes('SQLite'));
    assert.ok(!(await (await fetch(base + '/cadastrar-animal.html')).text()).includes('SQLite'));
    pass('cliente sem requisições síncronas e telas públicas sem instruções de terminal/SQLite');
    await stop();
    await start();
    assert.equal(
      (await owner.call('GET', '/api/animals')).find((a) => a.id === pending.id).photos.length,
      1,
    );
    assert.ok((await owner.call('GET', '/api/animals')).find((a) => a.id === extra.id).archivedAt);
    pass('reinício preserva imagens originais e arquivamento');
    if (process.env.ETAPA4_RESULTS)
      fs.writeFileSync(
        process.env.ETAPA4_RESULTS,
        JSON.stringify(
          {
            status: 'pass',
            groups,
            limitations: [
              'Dados fictícios isolados.',
              'Limites reduzidos por configuração somente para exercitar o bloqueio.',
              'Preview validado por HTTP anônimo local; redes sociais externas não testadas.',
            ],
          },
          null,
          2,
        ),
      );
  } finally {
    await stop();
    assert.ok(dataDir.startsWith(os.tmpdir() + path.sep));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
