'use strict';
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  crypto = require('node:crypto'),
  sharp = require('sharp');
const { spawn } = require('node:child_process'),
  { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..'),
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'potypet-photo-test-')),
  base = 'http://127.0.0.1:3193',
  key = crypto.randomBytes(32).toString('base64'),
  cases = [];
let server;
const sql = (fn) => {
  const db = new DatabaseSync(path.join(dir, 'adotapet.db'));
  try {
    return fn(db);
  } finally {
    db.close();
  }
};
const state = (key) =>
  sql((db) => JSON.parse(db.prepare('SELECT value FROM app_state WHERE key=?').get(key).value));
function alter(key, fn) {
  sql((db) => {
    const rows = JSON.parse(db.prepare('SELECT value FROM app_state WHERE key=?').get(key).value);
    fn(rows);
    db.prepare('UPDATE app_state SET value=? WHERE key=?').run(JSON.stringify(rows), key);
  });
}
async function stop() {
  if (server?.exitCode === null && server.signalCode === null) {
    const done = new Promise((r) => server.once('exit', r));
    server.kill();
    await done;
  }
  server = null;
}
async function start(min = '1', description = '1') {
  let log = '';
  server = spawn(process.execPath, ['server.js'], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ANIMAL_APPROVAL_MIN_PHOTOS: min,
      ANIMAL_APPROVAL_MIN_DESCRIPTION_CHARS: description,
      ANIMAL_APPROVAL_REQUIRE_DESCRIPTION: '1',
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: '3193',
      DATA_DIR: dir,
      EMAIL_TRANSPORT: 'file',
      MAIL_FROM: 'qa@example.test',
      MAIL_QUEUE_KEY: key,
      PUBLIC_BASE_URL: base,
      BACKUP_AUTO: '0',
      COOKIE_SECURE: '0',
      SEED_DEMO_ACCOUNTS: '1',
      SEED_SAMPLE_DATA: '0',
      ADMIN_EMAIL: 'admin@adotapet.com',
      ADMIN_PASSWORD: '',
      DONOR_EMAIL: 'ong@adotapet.com',
      DONOR_PASSWORD: '',
      ADMIN_RECOVERY_ID: '',
    },
  });
  for (const s of [server.stdout, server.stderr]) s.on('data', (d) => (log += d));
  for (let n = 0; !log.includes('PotyPet rodando'); n++) {
    if (n > 300 || server.exitCode !== null) throw Error(log);
    await new Promise((r) => setTimeout(r, 50));
  }
}
async function test(name, fn) {
  await fn();
  cases.push({ name, status: 'pass' });
  console.log('OK fotos/aprovação — ' + name);
}
const data = (format, b) => 'data:image/' + format + ';base64,' + b.toString('base64');
(async () => {
  try {
    await start();
    const f = await require('./etapa1-fixtures.cjs')({ base, dataDir: dir, email: true }),
      { admin, owner, other, guest } = f.clients,
      images = await require('./photo-fixtures.cjs')();
    const body = {
        name: 'Foto sintética de QA',
        city: 'Apodi',
        state: 'RN',
        description: 'Fixture de validação técnica, sem afirmação de autenticidade.',
      },
      reason = 'Revisão humana fictícia para exercitar a API.';
    for (const [format, image] of [
      ['jpeg', images.jpeg],
      ['png', images.png],
      ['webp', images.webp],
    ])
      await test(format + ' decodificado e normalizado no servidor', async () => {
        const a = await owner.call(
            'POST',
            '/api/animals',
            { ...body, photos: [data(format, image)] },
            201,
          ),
          m = await sharp(Buffer.from(a.photos[0].split(',')[1], 'base64')).metadata();
        assert.equal(m.format, 'jpeg');
        assert.equal(m.width, 60);
        assert.equal(m.height, 100);
        assert.equal(m.exif, undefined);
        assert.equal(m.xmp, undefined);
      });
    await test('Oito orientações EXIF aplicadas antes de remover metadados/GPS', async () => {
      for (let orientation = 1; orientation <= 8; orientation++) {
        const source = images.exif(images.jpeg, orientation),
          result = await require('../lib/input-validation.cjs').image(data('jpeg', source), root, {
            compress: true,
          }),
          bytes = Buffer.from(result.split(',')[1], 'base64'),
          m = await sharp(bytes).metadata();
        assert.ok((await sharp(source).metadata()).exif.includes(Buffer.from([0x25, 0x88])));
        assert.equal(m.width, orientation >= 5 ? 100 : 60);
        assert.equal(m.height, orientation >= 5 ? 60 : 100);
        assert.equal(m.exif, undefined);
        assert.equal(m.orientation, undefined);
        assert.equal(m.xmp, undefined);
        const expected = await sharp(source)
          .rotate()
          .flatten({ background: '#ffffff' })
          .jpeg({ quality: 85, mozjpeg: true })
          .toBuffer();
        assert.deepEqual(bytes, expected);
      }
    });
    await test('Arquivo de mais de 2 MB aceito e comprimido; limites reais alinhados', async () => {
      assert.ok(images.medium.length > 2 * 1024 * 1024 && images.medium.length < 3 * 1024 * 1024);
      const a = await owner.call(
        'POST',
        '/api/animals',
        { ...body, photos: [data('png', images.medium)] },
        201,
      );
      assert.ok(Buffer.from(a.photos[0].split(',')[1], 'base64').length < images.medium.length);
      const policy = await guest.call('GET', '/api/photo-policy');
      assert.equal(policy.limits.maxProcessedBytes, 3 * 1024 * 1024);
      assert.equal(policy.approval.minPhotos, 1);
    });
    await test('Mais de 3 MB no envio, formato falso, corrupção, SVG e excesso de fotos rejeitados', async () => {
      for (const photos of [
        [data('png', images.large)],
        [data('jpeg', images.png)],
        [data('png', images.png.subarray(0, images.png.length - 15))],
        ['data:image/svg+xml;base64,PHN2Zy8+'],
        Array(4).fill(data('png', images.png)),
        ['data:image/png;base64,YQ=='],
      ])
        await owner.call('POST', '/api/animals', { ...body, photos }, 400);
    });
    await test('Limite de pixels do servidor continua obrigatório', async () => {
      const huge = await sharp({
        create: { width: 6000, height: 4000, channels: 3, background: '#ffffff' },
      })
        .png()
        .toBuffer();
      await owner.call('POST', '/api/animals', { ...body, photos: [data('png', huge)] }, 400);
    });
    await test('Edição sem fotos conserva os bytes existentes', async () => {
      const id = f.animals.pending.id,
        before = state('animals').find((a) => a.id === id).photos;
      await owner.call('PATCH', '/api/animals/' + id, { description: 'Edição textual fictícia.' });
      assert.deepEqual(state('animals').find((a) => a.id === id).photos, before);
    });
    let missing;
    await test('Desaparecido recebe foto sanitizada e mantém foto/ocultação sem nova seleção', async () => {
      missing = await owner.call(
        'POST',
        '/api/missing',
        {
          name: 'Desaparecido sintético QA',
          city: 'Apodi',
          state: 'RN',
          missing_date: '2026-10-01',
          photo: data('jpeg', images.oriented),
        },
        201,
      );
      const m = await sharp(Buffer.from(missing.photo.split(',')[1], 'base64')).metadata();
      assert.equal(m.width, 100);
      assert.equal(m.height, 60);
      assert.equal(m.exif, undefined);
      await admin.call('POST', '/api/missing/' + missing.id + '/hide', {
        reason: 'Ocultação fictícia preservada.',
      });
      const before = state('missing').find((m) => m.id === missing.id);
      await owner.call('PATCH', '/api/missing/' + missing.id, { features: 'Correção textual.' });
      const after = state('missing').find((m) => m.id === missing.id);
      for (const k of ['photo', 'hiddenAt', 'hiddenReason', 'moderationHistory'])
        assert.deepEqual(after[k], before[k]);
      await owner.call(
        'PATCH',
        '/api/missing/' + missing.id,
        { photo: data('png', images.png.subarray(0, 20)) },
        400,
      );
      assert.equal(state('missing').find((m) => m.id === missing.id).photo, before.photo);
    });
    const noPhoto = await owner.call('POST', '/api/animals', { ...body, photos: [] }, 201),
      noDescription = await owner.call(
        'POST',
        '/api/animals',
        { ...body, description: ' ', photos: [data('png', images.png)] },
        201,
      );
    await test('Nova aprovação sem foto ou sem descrição falha sem alterar estado', async () => {
      for (const a of [noPhoto, noDescription]) {
        const before = state('animals').find((x) => x.id === a.id);
        await admin.call(
          'PATCH',
          '/api/animals/' + a.id,
          { approvalStatus: 'approved', reason },
          400,
        );
        assert.deepEqual(
          state('animals').find((x) => x.id === a.id),
          before,
        );
      }
    });
    await test('Foto legada inválida não satisfaz a nova aprovação; nenhum descarte automático', async () => {
      alter(
        'animals',
        (rows) => (rows.find((a) => a.id === noPhoto.id).photos = ['data:image/png;base64,YQ==']),
      );
      await admin.call(
        'PATCH',
        '/api/animals/' + noPhoto.id,
        { approvalStatus: 'approved', reason },
        400,
      );
      assert.deepEqual(state('animals').find((a) => a.id === noPhoto.id).photos, [
        'data:image/png;base64,YQ==',
      ]);
    });
    await test('Aprovação válida registra critérios; visitante não recebe decisão privada', async () => {
      const a = await admin.call('PATCH', '/api/animals/' + f.animals.pending.id, {
        approvalStatus: 'approved',
        reason,
      });
      assert.equal(a.approvalCriteria.validPhotoCount, 1);
      assert.equal(a.approvalCriteria.descriptionPresent, true);
      assert.equal(a.approvalCriteria.exception, null);
      assert.ok(a.approvalCriteria.checkedAt);
      const pub = await guest.call('GET', '/api/animals/' + a.id);
      assert.equal(pub.approvalCriteria, undefined);
      assert.equal(pub.moderationHistory, undefined);
    });
    await test('Exceção exige admin e justificativa específica; reprovação não exige mínimo', async () => {
      await owner.call(
        'PATCH',
        '/api/animals/' + noPhoto.id,
        {
          approvalStatus: 'approved',
          reason,
          approvalException: { reason: 'Tentativa indevida.' },
        },
        403,
      );
      await admin.call(
        'PATCH',
        '/api/animals/' + noPhoto.id,
        { approvalStatus: 'approved', reason, approvalException: { reason: ' ' } },
        400,
      );
      await admin.call(
        'PATCH',
        '/api/animals/' + noPhoto.id,
        { approvalStatus: 'rejected', reason, approvalException: { reason: 'Incoerente.' } },
        400,
      );
      assert.equal(
        (
          await admin.call('PATCH', '/api/animals/' + noDescription.id, {
            approvalStatus: 'rejected',
            reason,
          })
        ).approvalStatus,
        'rejected',
      );
    });
    await test('Exceção explícita registra critérios não atendidos, admin, data e motivo', async () => {
      const a = await admin.call('PATCH', '/api/animals/' + noPhoto.id, {
        approvalStatus: 'approved',
        reason,
        approvalException: { reason: 'Exceção fictícia necessária, documentada manualmente.' },
      });
      const e = a.moderationHistory.at(-1).criteria;
      assert.ok(e.failed.length);
      assert.equal(e.exception.actorId, 1);
      assert.ok(e.exception.at);
      assert.ok(e.exception.reason);
      assert.ok(state('adminLog').some((l) => JSON.stringify(l).includes('Exceção de aprovação')));
    });
    await test('Criação administrativa segue o mínimo e registra eventual exceção', async () => {
      await admin.call('POST', '/api/animals', { ...body, photos: [] }, 400);
      const a = await admin.call(
        'POST',
        '/api/animals',
        {
          ...body,
          photos: [],
          approvalException: { reason: 'Exceção fictícia de criação administrativa.' },
        },
        201,
      );
      assert.equal(a.approvalStatus, 'approved');
      assert.equal(a.approvalCriteria.exception.actorId, 1);
    });
    await test('Reinício não reprocessa fotos antigas nem reaplica a regra aos aprovados', async () => {
      const before = state('animals'),
        users = sql((db) => db.prepare('SELECT * FROM users ORDER BY id').all());
      await stop();
      await start();
      assert.deepEqual(state('animals'), before);
      assert.deepEqual(
        sql((db) => db.prepare('SELECT * FROM users ORDER BY id').all()),
        users,
      );
    });
    await test('Configuração de duas fotos rejeita uma e aceita duas, preservando anúncios anteriores', async () => {
      const before = state('animals');
      await stop();
      await start('2');
      assert.deepEqual(state('animals'), before);
      assert.equal((await guest.call('GET', '/api/photo-policy')).approval.minPhotos, 2);
      await admin.call(
        'PATCH',
        '/api/animals/' + f.animals.pending.id,
        { approvalStatus: 'approved', reason },
        400,
      );
      const a = await admin.call('PATCH', '/api/animals/' + f.animals.pending.id, {
        photos: ['img/animal1.png', 'img/animal2.png'],
        approvalStatus: 'approved',
        reason,
      });
      assert.equal(a.approvalCriteria.validPhotoCount, 2);
    });
    await test('Mínimo configurável de descrição mantém rejeição e exige exceção para dispensa', async () => {
      await stop();
      await start('1', '30');
      await admin.call(
        'PATCH',
        '/api/animals/' + noDescription.id,
        { approvalStatus: 'approved', reason },
        400,
      );
      const a = await admin.call('PATCH', '/api/animals/' + noDescription.id, {
        description: 'Descrição fictícia com mais de trinta caracteres.',
        approvalStatus: 'approved',
        reason,
      });
      assert.equal(a.approvalCriteria.minDescriptionChars, 30);
      assert.equal(a.approvalCriteria.requireDescription, true);
      assert.equal(a.approvalCriteria.descriptionPresent, true);
    });
    const config = require('node:child_process').spawnSync(
      process.execPath,
      ['-e', "require('./lib/photo-policy.cjs')"],
      {
        cwd: root,
        windowsHide: true,
        env: { ...process.env, ANIMAL_APPROVAL_MIN_PHOTOS: '0' },
        encoding: 'utf8',
      },
    );
    await test('Configuração inválida e dispensa global de descrição falham explicitamente', async () => {
      assert.notEqual(config.status, 0);
      for (const env of [
        { ANIMAL_APPROVAL_MIN_PHOTOS: '1', ANIMAL_APPROVAL_MIN_DESCRIPTION_CHARS: '0' },
        { ANIMAL_APPROVAL_MIN_PHOTOS: '1', ANIMAL_APPROVAL_REQUIRE_DESCRIPTION: '0' },
      ]) {
        const r = require('node:child_process').spawnSync(
          process.execPath,
          ['-e', "require('./lib/photo-policy.cjs')"],
          { cwd: root, windowsHide: true, env: { ...process.env, ...env }, encoding: 'utf8' },
        );
        assert.notEqual(r.status, 0);
      }
    });
  } finally {
    if (process.env.PHOTO_RESULTS)
      fs.writeFileSync(
        process.env.PHOTO_RESULTS,
        JSON.stringify(
          {
            cases,
            limitations: [
              'Fixtures sintéticas, confirmação local por e-mail file; sem envio real.',
              'A validação técnica não prova autenticidade ou correspondência com animal.',
            ],
          },
          null,
          2,
        ),
      );
    await stop();
    assert.ok(dir.startsWith(os.tmpdir() + path.sep + 'potypet-photo-test-'));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
