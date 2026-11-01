'use strict';
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { spawnSync } = require('node:child_process'),
  { DatabaseSync } = require('node:sqlite');
const check = require('./start-check.cjs'),
  adoption = require('./adoption-fixture.cjs'),
  sharp = require('sharp');
const root = path.resolve(__dirname, '..');
function client() {
  let cookie = '';
  return async (method, route, body, expected = 200, headers = {}) => {
    const r = await fetch('http://127.0.0.1:3170' + route, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    const data = await r.json();
    assert.equal(r.status, expected, route + ': ' + JSON.stringify(data));
    return { data, headers: r.headers };
  };
}
(async () => {
  const beforeProxy = process.env.TRUST_PROXY,
    beforeList = process.env.TRUSTED_PROXY_IPS;
  process.env.TRUST_PROXY = '1';
  process.env.TRUSTED_PROXY_IPS = '';
  try {
    await check('QA: validações, fotos, relatos, lock e proxy seguro', async ({ dataDir }) => {
      const A = client(),
        U = client(),
        V = client(),
        G = client();
      await A('POST', '/api/auth/login', { email: 'admin@adotapet.com', password: 'admin123' });
      const registration = {
        name: 'Pessoa QA',
        email: 'qa-regression@example.test',
        password: 'TesteSeguro9',
        passwordConfirmation: 'TesteSeguro9',
        city: 'Apodi',
        state: 'RN',
        phone: '84000000000',
        termsAccepted: true,
      };
      for (const state of ['', 'XX', 'RNN'])
        await G('POST', '/api/auth/register', { ...registration, state }, 400);
      await U('POST', '/api/auth/register', registration, 201);
      await V(
        'POST',
        '/api/auth/register',
        { ...registration, email: 'qa-adopter@example.test' },
        201,
      );
      const refused = await G('POST', '/api/auth/register', registration, 400);
      assert.ok(!refused.data.error.includes('Já existe'));
      await U(
        'PATCH',
        '/api/users/me',
        { name: 'Pessoa QA', city: 'Apodi', state: 'XX', phone: '84000000000' },
        400,
      );
      await U(
        'POST',
        '/api/missing',
        {
          name: 'Desaparecido QA',
          city: 'Apodi',
          state: 'RN',
          missing_date: '2026-10-10',
          photo: 'data:image/png;base64,YQ==',
        },
        400,
      );
      const png = await sharp({
        create: { width: 12, height: 12, channels: 3, background: '#006d6a' },
      })
        .png()
        .toBuffer();
      const petBody = {
        name: 'Animal de regressão',
        city: 'Apodi',
        state: 'RN',
        description: 'Animal fictício com descrição para a revisão.',
      };
      for (const photo of [
        'data:image/png;base64,' + Buffer.from('<html>inválido</html>').toString('base64'),
        'data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64'),
        'img/../server.js',
        'data:image/jpeg;base64,' + png.toString('base64'),
        'data:image/png;base64,' + png.subarray(0, png.length - 15).toString('base64'),
      ])
        await U('POST', '/api/animals', { ...petBody, photos: [photo] }, 400);
      await U(
        'POST',
        '/api/animals',
        { ...petBody, photos: Array(4).fill('img/animal1.png') },
        400,
      );
      for (const format of ['png', 'jpeg', 'webp']) {
        const bytes = await sharp(png).toFormat(format).toBuffer();
        const r = await U(
          'POST',
          '/api/animals',
          {
            ...petBody,
            name: 'Formato ' + format,
            photos: ['data:image/' + format + ';base64,' + bytes.toString('base64')],
          },
          201,
        );
        assert.ok(r.data.photos[0].startsWith('data:image/jpeg;base64,'));
        const normalized = await sharp(
          Buffer.from(r.data.photos[0].split(',')[1], 'base64'),
        ).metadata();
        assert.equal(normalized.width, 12);
        assert.equal(normalized.height, 12);
        assert.equal(normalized.exif, undefined);
      }
      const pet = (
        await U('POST', '/api/animals', { ...petBody, photos: ['img/animal1.png'] }, 201)
      ).data;
      await A('PATCH', '/api/animals/' + pet.id, {
        approvalStatus: 'approved',
        reason: 'Revisão administrativa de fixture de teste.',
      });
      await U('PATCH', '/api/animals/' + pet.id, { photos: ['data:image/png;base64,YQ=='] }, 400);
      assert.equal(
        (await U('GET', '/api/animals')).data.find((a) => a.id === pet.id).photos[0],
        'img/animal1.png',
      );
      const valid = adoption({ animalId: pet.id, responsibility_confirmed: true });
      for (const bad of [
        { animalId: pet.id, responsibility_confirmed: true },
        { ...valid, city: '' },
        { ...valid, reason: ' ' },
        { ...valid, age: '17' },
        { ...valid, age: '18.5' },
        { ...valid, age: {} },
        { ...valid, responsibility_confirmed: 'true' },
        { ...valid, questionnaire: { ...valid.questionnaire, adaptation_plan: '' } },
        { ...valid, reason: 'x'.repeat(2001) },
      ])
        await V('POST', '/api/requests', bad, 400);
      const request = (await V('POST', '/api/requests', valid, 201)).data;
      await U('POST', '/api/requests/' + request.id + '/approve', {});
      await U('POST', '/api/requests/' + request.id + '/handover', { confirmed: true });
      await V('POST', '/api/requests/' + request.id + '/confirm-receipt', { confirmed: true });
      await U('POST', '/api/requests/' + request.id + '/complete', {});
      const contract = (await U('GET', '/api/contracts/' + request.id)).data;
      assert.equal(contract.adopterAcknowledgedAt, null);
      const dbPath = path.join(dataDir, 'adotapet.db');
      const db = new DatabaseSync(dbPath);
      try {
        const requests = JSON.parse(
          db.prepare("SELECT value FROM app_state WHERE key='requests'").get().value,
        );
        const item = requests.find((r) => r.id === request.id);
        item.completedAt = new Date(Date.now() - 100 * 86400000).toISOString();
        db.prepare("UPDATE app_state SET value=? WHERE key='requests'").run(
          JSON.stringify(requests),
        );
        const follow = {
          requestId: request.id,
          day: 7,
          adaptation: 'boa',
          health: 'Saúde estável.',
          behavior: 'Adaptação tranquila.',
        };
        await V('POST', '/api/followups', { requestId: request.id, day: 7 }, 400);
        await V('POST', '/api/followups', { ...follow, health: '' }, 400);
        await V('POST', '/api/followups', { ...follow, adaptation: '' }, 400);
        await V('POST', '/api/followups', { ...follow, photo: 'data:image/png;base64,YQ==' }, 400);
        await V(
          'POST',
          '/api/followups',
          { ...follow, photo: 'data:image/png;base64,' + png.toString('base64') },
          201,
        );
        await V('POST', '/api/followups', follow, 409);
        await U('POST', '/api/followups', { ...follow, day: 30 }, 403);
        db.exec('BEGIN IMMEDIATE');
        try {
          const busy = await G('POST', '/api/reports', { reason: 'lock de QA' }, 503);
          assert.equal(busy.headers.get('retry-after'), '2');
          assert.ok(!busy.data.error.includes('stack'));
        } finally {
          db.exec('ROLLBACK');
        }
        await G('POST', '/api/reports', { reason: 'recuperação de QA' }, 201);
        const backup = path.join(os.tmpdir(), 'appet-backup-qa-' + Date.now() + '.db');
        const result = spawnSync(process.execPath, ['scripts/backup.cjs', backup], {
          cwd: root,
          env: { ...process.env, DATA_DIR: path.dirname(dbPath) },
          encoding: 'utf8',
          windowsHide: true,
        });
        assert.equal(result.status, 0, result.stderr);
        const copied = new DatabaseSync(backup, { readOnly: true });
        try {
          assert.equal(copied.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
          assert.ok(copied.prepare('SELECT id FROM users WHERE email=?').get(registration.email));
        } finally {
          copied.close();
          fs.unlinkSync(backup);
        }
      } finally {
        db.close();
      }
      const codes = [];
      for (let i = 0; i < 12; i++) {
        const r = await fetch('http://127.0.0.1:3170/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.' + i },
          body: JSON.stringify({ email: 'unknown@example.test', password: 'wrong' }),
        });
        codes.push(r.status);
      }
      assert.equal(codes.at(-1), 429);
      console.log(
        '✅ PASSOU — rejeição de dados incompletos/arquivos falsos; PNG/JPEG/WebP; relato válido; 503 recuperável; backup; header não confiável.',
      );
    });
  } finally {
    if (beforeProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = beforeProxy;
    if (beforeList === undefined) delete process.env.TRUSTED_PROXY_IPS;
    else process.env.TRUSTED_PROXY_IPS = beforeList;
  }
  const chain = spawnSync(
    process.execPath,
    [
      '-e',
      "const ip=require('./lib/client-ip.cjs');console.log(ip({socket:{remoteAddress:'127.0.0.1'},headers:{'x-forwarded-for':'198.51.100.7, 203.0.113.8'}}));",
    ],
    {
      cwd: root,
      env: { ...process.env, TRUST_PROXY: '1', TRUSTED_PROXY_IPS: '127.0.0.1' },
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  assert.equal(chain.status, 0, chain.stderr);
  assert.equal(chain.stdout.trim(), '203.0.113.8');
  console.log('✅ PASSOU — cadeia de proxy termina no primeiro IP não confiável.');
  for (const [overrides, message] of [
    [{ DATA_DIR: '' }, 'Defina DATA_DIR'],
    [{ SEED_DEMO_ACCOUNTS: '1' }, 'Contas demo'],
    [{ COOKIE_SECURE: '0' }, 'Produção exige COOKIE_SECURE'],
  ]) {
    const rejected = spawnSync(process.execPath, ['server.js'], {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        DATA_DIR: path.join(os.tmpdir(), 'appet-production-guard-qa'),
        SEED_DEMO_ACCOUNTS: '0',
        COOKIE_SECURE: '1',
        ...overrides,
      },
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.notEqual(rejected.status, 0);
    assert.ok(rejected.stderr.includes(message), rejected.stderr);
  }
  console.log(
    '✅ PASSOU — produção recusa dados temporários sem DATA_DIR, contas demo e cookies inseguros.',
  );
})().catch((e) => {
  console.error('❌ FALHOU — QA regressões', e);
  process.exitCode = 1;
});
