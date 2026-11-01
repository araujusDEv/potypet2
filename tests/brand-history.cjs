'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  crypto = require('node:crypto'),
  vm = require('node:vm'),
  assert = require('node:assert/strict');
const { spawn } = require('node:child_process'),
  { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..'),
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'potypet-brand-history-')),
  base = 'http://127.0.0.1:3188',
  key = crypto.randomBytes(32);
let child;
async function start() {
  let log = '';
  child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: '3188',
      DATA_DIR: dataDir,
      EMAIL_TRANSPORT: 'disabled',
      BACKUP_AUTO: '0',
      SEED_SAMPLE_DATA: '0',
      SEED_DEMO_ACCOUNTS: '1',
      COOKIE_SECURE: '0',
      TRUST_PROXY: '0',
      TRUSTED_PROXY_IPS: '',
      PERSISTENT_DISK_PATH: '',
      ADMIN_EMAIL: 'admin@adotapet.com',
      ADMIN_PASSWORD: '',
      DONOR_EMAIL: 'ong@adotapet.com',
      DONOR_PASSWORD: '',
      ADMIN_RECOVERY_ID: '',
    },
  });
  for (const s of [child.stdout, child.stderr]) s.on('data', (d) => (log += d));
  for (let n = 0; !log.includes('PotyPet rodando'); n++) {
    if (n > 240 || child.exitCode !== null) throw Error(log);
    await new Promise((r) => setTimeout(r, 50));
  }
}
async function stop() {
  if (child?.exitCode === null && child.signalCode === null) {
    const done = new Promise((r) => child.once('exit', r));
    child.kill();
    await done;
  }
  child = null;
}
function sql(fn) {
  const db = new DatabaseSync(path.join(dataDir, 'adotapet.db'));
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
function render(contract, userId) {
  const el = { innerHTML: '' },
    esc = (s) =>
      String(s).replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
      );
  const sandbox = {
    Auth: { requireAuth: () => ({ id: userId }) },
    getParam: () => String(contract.requestId),
    Store: { getContract: () => structuredClone(contract) },
    document: { title: '', getElementById: (id) => (id === 'contract-content' ? el : null) },
    escapeHTML: esc,
    escapeAttr: esc,
    App: { ready() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/pages/contrato.js'), 'utf8'), sandbox);
  vm.runInContext('renderContract()', sandbox);
  return { html: el.innerHTML, title: sandbox.document.title };
}
const pass = (name) => console.log('OK marca/histórico — ' + name);
(async () => {
  try {
    await start();
    const f = await require('./etapa1-fixtures.cjs')({ base, dataDir }),
      { owner, other, admin, guest } = f.clients;
    const request = await other.call(
      'POST',
      '/api/requests',
      require('./adoption-fixture.cjs')({
        animalId: f.animals.approved.id,
        responsibility_confirmed: true,
      }),
      201,
    );
    await owner.call('POST', '/api/requests/' + request.id + '/approve', {});
    await owner.call('POST', '/api/requests/' + request.id + '/handover', { confirmed: true });
    await other.call('POST', '/api/requests/' + request.id + '/confirm-receipt', {
      confirmed: true,
    });
    await owner.call('POST', '/api/requests/' + request.id + '/complete', {});
    const term = await other.call('GET', '/api/contracts/' + request.id);
    assert.equal(term.brandName, 'PotyPet');
    assert.ok(term.legalNote.includes('no PotyPet.'));
    const current = render(term, f.users.other.id);
    assert.match(current.html, /aria-label="PotyPet"/);
    assert.match(current.html, />Poty<\/span><span class="brand-pet">Pet</);
    assert.ok(current.title.endsWith(' · PotyPet'));
    assert.doesNotMatch(current.html, /\bAppet\b/);
    await guest.call('GET', '/api/contracts/' + request.id, undefined, 401);
    pass(
      'conclusão cria novo termo PotyPet com marca e aviso registrados; documento renderiza a marca e conserva autorização',
    );
    const legacy = {
      ...term,
      id: 900,
      requestId: 900,
      code: 'ADT-LEGADO-APPET',
      animalName: 'Nome antigo citado no Appet',
      clauses: ['Cláusula histórica registrada no Appet.'],
      ownerAcknowledgedAt: '2026-10-10T12:00:00Z',
      adopterAcknowledgedAt: '2026-10-10T13:00:00Z',
    };
    delete legacy.brandName;
    delete legacy.legalNote;
    const notice = {
        id: 901,
        userId: f.users.other.id,
        message: 'Mensagem antiga enviada pelo Appet.',
        read: true,
        createdAt: new Date().toISOString(),
      },
      audit = {
        id: 902,
        adminId: 1,
        action: 'Appet — revisão anterior preservada.',
        createdAt: new Date().toISOString(),
      };
    sql((db) => {
      for (const [collection, record] of [
        ['contracts', legacy],
        ['notifications', notice],
        ['adminLog', audit],
      ]) {
        const records = JSON.parse(
          db.prepare('SELECT value FROM app_state WHERE key=?').get(collection).value,
        );
        records.push(record);
        db.prepare('UPDATE app_state SET value=? WHERE key=?').run(
          JSON.stringify(records),
          collection,
        );
      }
      const requests = JSON.parse(
        db.prepare("SELECT value FROM app_state WHERE key='requests'").get().value,
      );
      requests.find((r) => r.id === request.id).messages = [
        {
          id: 'mensagem-antiga',
          senderId: f.users.owner.id,
          text: 'Conversa anterior no Appet.',
          createdAt: new Date().toISOString(),
        },
      ];
      db.prepare("UPDATE app_state SET value=? WHERE key='requests'").run(JSON.stringify(requests));
      db.prepare('UPDATE users SET terms_version=? WHERE id=?').run(
        '2026-10-12-etapa5',
        f.users.owner.id,
      );
    });
    const oldView = render(legacy, f.users.other.id);
    assert.match(oldView.html, /aria-label="Appet"/);
    assert.match(oldView.html, /no Appet\./);
    assert.ok(oldView.title.endsWith(' · Appet'));
    assert.ok(!oldView.html.includes('PotyPet'));
    assert.deepEqual(await other.call('GET', '/api/contracts/900'), legacy);
    const before = sql((db) => ({
      users: db.prepare('SELECT * FROM users ORDER BY id').all(),
      state: db.prepare('SELECT * FROM app_state ORDER BY key').all(),
      sessions: db.prepare('SELECT * FROM sessions ORDER BY token').all(),
    }));
    await stop();
    await start();
    const after = sql((db) => ({
      users: db.prepare('SELECT * FROM users ORDER BY id').all(),
      state: db.prepare('SELECT * FROM app_state ORDER BY key').all(),
      sessions: db.prepare('SELECT * FROM sessions ORDER BY token').all(),
    }));
    assert.deepEqual(after, before);
    assert.equal((await owner.call('GET', '/api/auth/me')).user.termsVersion, '2026-10-12-etapa5');
    assert.deepEqual(await other.call('GET', '/api/contracts/900'), legacy);
    pass(
      'reinício preserva contas, senhas, sessões, aceites, termos antigos, conversas, notificações e auditoria sem reescrever Appet',
    );
    const share = await fetch(base + '/animal.html?id=' + f.animals.ordinary.id).then((r) =>
      r.text(),
    );
    assert.match(share, /<meta property="og:title" content="Etapa1 ordinary · PotyPet"/);
    assert.match(share, /<meta property="og:site_name" content="PotyPet"/);
    assert.match(share, /animal\.html\?id=/);
    assert.match(share, /\/api\/profile-media\/animal\//);
    assert.doesNotMatch(share, /\bAppet\b/);
    const malicious = render(
      {
        ...term,
        brandName: '<script>alert(1)</script>',
        legalNote: '<img src=x onerror=alert(1)>',
      },
      f.users.other.id,
    );
    assert.ok(malicious.html.includes('&lt;script&gt;'));
    assert.ok(!malicious.html.includes('<script>'));
    assert.ok(!malicious.html.includes('<img src=x'));
    pass(
      'compartilhamento público usa PotyPet mantendo URL/ID; apresentação dos documentos escapa os textos',
    );
    await stop();
    sql((db) => {
      const env = {
          EMAIL_TRANSPORT: 'file',
          MAIL_FROM: 'appet@example.test',
          MAIL_QUEUE_KEY: key.toString('base64'),
          PUBLIC_BASE_URL: base,
        },
        mail = require('../lib/mail-service.cjs')({ db, dataDir, env });
      const legacyMessage = {
          from: { name: 'Appet', address: 'appet@example.test' },
          to: 'legacy@example.test',
          subject: 'Appet — mensagem anterior',
          text: 'Conteúdo anterior ao PotyPet, sem substituição.',
        },
        iv = crypto.randomBytes(12),
        cipher = crypto.createCipheriv('aes-256-gcm', key, iv),
        body = Buffer.concat([cipher.update(JSON.stringify(legacyMessage)), cipher.final()]),
        payload = Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
      db.prepare('INSERT INTO mail_outbox(id,payload,created_at,next_attempt) VALUES(?,?,?,?)').run(
        'legacy-mail',
        payload,
        Date.now(),
        Date.now() + 86400000,
      );
      for (const kind of ['verify', 'reset', 'notice'])
        mail.queue(kind + '@example.test', kind, 'a'.repeat(43), null, 'cadastrar-animal.html');
      for (const kind of [
        'request',
        'decision',
        'sighting',
        'help',
        'message',
        'helpResponse',
        'listing',
        'moderation',
      ])
        mail.queueEvent(kind + '@example.test', kind, 'brand:' + kind, 'minhas-solicitacoes.html');
      const rows = db.prepare('SELECT id,payload FROM mail_outbox ORDER BY id').all();
      for (const row of rows) {
        const bytes = Buffer.from(row.payload, 'base64'),
          decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
        decipher.setAuthTag(bytes.subarray(12, 28));
        const msg = JSON.parse(
          Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]),
        );
        if (row.id === 'legacy-mail') assert.deepEqual(msg, legacyMessage);
        else {
          assert.equal(msg.from.name, 'PotyPet');
          assert.ok(msg.subject.startsWith('PotyPet — '));
          assert.doesNotMatch(msg.subject + ' ' + msg.text + ' ' + msg.html, /\bAppet\b/);
        }
      }
      assert.equal(rows.length, 12);
      assert.equal(
        db.prepare('SELECT payload FROM mail_outbox WHERE id=?').get('legacy-mail').payload,
        payload,
      );
      mail.stop();
    });
    pass(
      'onze modelos de novos e-mails usam PotyPet; mensagem antiga criptografada permanece byte a byte, sem envio SMTP real',
    );
  } finally {
    await stop();
    assert.ok(dataDir.startsWith(os.tmpdir() + path.sep + 'potypet-brand-history-'));
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
