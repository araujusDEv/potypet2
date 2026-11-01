'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  crypto = require('node:crypto'),
  assert = require('node:assert/strict');
const { spawn } = require('node:child_process'),
  { DatabaseSync } = require('node:sqlite');
const suiteRoot = path.resolve(__dirname, '..'),
  project = path.resolve(process.env.POTYPET_CONCURRENCY_PROJECT || suiteRoot),
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'potypet-concurrency-')),
  base = 'http://127.0.0.1:3191',
  results = [];
let child,
  sequence = 0,
  active = null,
  resetClients = async () => {};
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(),
  ),
  photo =
    'data:image/png;base64,' +
    fs.readFileSync(path.join(project, 'img/animal1.png')).toString('base64');
async function raw(client, method, route, body) {
  const r = await fetch(base + route, {
    method,
    headers: { Cookie: client.cookie, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}
function sql(fn) {
  const db = new DatabaseSync(path.join(dataDir, 'adotapet.db'));
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
function alter(collection, fn) {
  return sql((db) => {
    const value = JSON.parse(
      db.prepare('SELECT value FROM app_state WHERE key=?').get(collection).value,
    );
    fn(value);
    db.prepare('UPDATE app_state SET value=? WHERE key=?').run(JSON.stringify(value), collection);
  });
}
function stored(collection, id) {
  return sql((db) =>
    JSON.parse(db.prepare('SELECT value FROM app_state WHERE key=?').get(collection).value).find(
      (r) => r.id === id,
    ),
  );
}
function signal(type, id) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off('message', listener);
      reject(Error('Timeout IPC ' + type));
    }, 15000);
    function listener(message) {
      if (message.type === type && message.id === id) {
        clearTimeout(timer);
        child.off('message', listener);
        resolve();
      }
    }
    child.on('message', listener);
  });
}
async function pause(kind, work) {
  const id = 'gate-' + ++sequence,
    armed = signal('armed', id);
  child.send({ type: 'arm', id, kind });
  await armed;
  const held = signal('held', id),
    pending = work();
  active = { id, pending };
  await held;
  return async () => {
    child.send({ type: 'release', id });
    active = null;
    return pending;
  };
}
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, status: 'pass' });
    console.log('OK concorrência — ' + name);
  } catch (e) {
    results.push({ name, status: 'fail', error: String(e.stack || e).slice(0, 1800) });
    console.error('FALHOU concorrência — ' + name + ' — ' + e.message);
  } finally {
    if (active) {
      child.send({ type: 'release', id: active.id });
      await active.pending.catch(() => {});
      active = null;
    }
    await resetClients();
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
(async () => {
  try {
    let log = '';
    child = spawn(
      process.execPath,
      ['--require', path.join(__dirname, 'helpers/photo-barrier.cjs'), 'server.js'],
      {
        cwd: project,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: {
          ...process.env,
          NODE_PATH: path.join(suiteRoot, 'node_modules'),
          POTYPET_CONCURRENCY_PROJECT: project,
          NODE_ENV: 'test',
          HOST: '127.0.0.1',
          PORT: '3191',
          DATA_DIR: dataDir,
          EMAIL_TRANSPORT: 'disabled',
          BACKUP_AUTO: '0',
          COOKIE_SECURE: '0',
          SEED_DEMO_ACCOUNTS: '1',
          SEED_SAMPLE_DATA: '0',
          TRUST_PROXY: '0',
          TRUSTED_PROXY_IPS: '',
          PERSISTENT_DISK_PATH: '',
          USER_MISSING_LIMIT: '100',
          USER_ANIMAL_LIMIT: '100',
          ADMIN_EMAIL: 'admin@adotapet.com',
          ADMIN_PASSWORD: '',
          DONOR_EMAIL: 'ong@adotapet.com',
          DONOR_PASSWORD: '',
          ADMIN_RECOVERY_ID: '',
        },
      },
    );
    for (const s of [child.stdout, child.stderr]) s.on('data', (d) => (log += d));
    for (let n = 0; !log.includes('PotyPet rodando'); n++) {
      if (n > 240 || child.exitCode !== null) throw Error(log);
      await new Promise((r) => setTimeout(r, 50));
    }
    const f = await require(path.join(project, 'tests/etapa1-fixtures.cjs'))({ base, dataDir }),
      { owner, other, admin, guest } = f.clients;
    const newMissing = (name) =>
      owner.call(
        'POST',
        '/api/missing',
        {
          name,
          city: 'Apodi',
          state: 'RN',
          missing_date: today,
          features: 'Estado inicial da fixture.',
        },
        201,
      );
    const ownerLogin = () =>
        owner.call('POST', '/api/auth/login', {
          email: f.users.owner.email,
          password: 'TesteSeguro9',
        }),
      otherLogin = () =>
        other.call('POST', '/api/auth/login', {
          email: f.users.other.email,
          password: 'TesteSeguro9',
        });
    resetClients = async () => {
      if ((await raw(owner, 'GET', '/api/auth/me')).status === 401) await ownerLogin();
      if ((await raw(other, 'GET', '/api/auth/me')).status === 401) await otherLogin();
    };
    await test('PATCH missing conserva novo cadastro durante a foto e não mantém transação aberta', async () => {
      const m = await newMissing('Editar com cadastro paralelo'),
        resume = await pause('image', () =>
          raw(owner, 'PATCH', '/api/missing/' + m.id, { features: 'Edição com foto.', photo }),
        );
      sql((db) => {
        db.exec('PRAGMA busy_timeout=50; BEGIN IMMEDIATE; ROLLBACK;');
      });
      const created = await newMissing('Cadastro concorrente preservado');
      assert.equal((await resume()).status, 200);
      assert.ok(stored('missing', created.id), 'O cadastro concorrente desapareceu após a edição.');
      assert.equal(stored('missing', created.id).name, created.name);
      assert.equal(stored('missing', m.id).features, 'Edição com foto.');
    });
    await test('PATCH missing conserva ocultação, motivo e histórico e ignora campos administrativos do cliente', async () => {
      const m = await newMissing('Ocultação concorrente'),
        resume = await pause('image', () =>
          raw(owner, 'PATCH', '/api/missing/' + m.id, {
            photo,
            features: 'Informação corrigida.',
            hiddenAt: null,
            hiddenReason: 'Injetado',
            moderationHistory: [],
            ownerId: f.users.other.id,
            id: 99999,
          }),
        );
      const hidden = await admin.call('POST', '/api/missing/' + m.id + '/hide', {
        reason: 'Ocultação administrativa enquanto a foto está em processamento.',
      });
      assert.equal((await resume()).status, 200);
      const final = stored('missing', m.id);
      for (const key of [
        'hiddenAt',
        'hiddenBy',
        'hiddenReason',
        'moderationHistory',
        'ownerId',
        'id',
      ])
        assert.deepEqual(final[key], hidden[key], key);
      assert.ok(!(await guest.call('GET', '/api/missing')).some((r) => r.id === m.id));
    });
    await test('PATCH missing aplica somente os campos enviados à versão atual de outra edição', async () => {
      const m = await newMissing('Duas edições'),
        resume = await pause('image', () =>
          raw(owner, 'PATCH', '/api/missing/' + m.id, {
            photo,
            features: 'Texto da primeira edição.',
          }),
        );
      const second = await owner.call('PATCH', '/api/missing/' + m.id, {
        name: 'Nome atualizado em paralelo',
        city: 'Mossoró',
        found: true,
      });
      assert.equal((await resume()).status, 200);
      const final = stored('missing', m.id);
      for (const key of ['name', 'city', 'found', 'foundAt'])
        assert.deepEqual(final[key], second[key], key);
      assert.equal(final.features, 'Texto da primeira edição.');
    });
    await test('PATCH missing rejeita sessão revogada antes da gravação final', async () => {
      const m = await newMissing('Sessão revogada'),
        resume = await pause('image', () =>
          raw(owner, 'PATCH', '/api/missing/' + m.id, { photo, features: 'Não deve gravar.' }),
        );
      await owner.call('POST', '/api/auth/logout', {});
      assert.equal((await resume()).status, 401);
      assert.deepEqual(stored('missing', m.id), m);
      await ownerLogin();
    });
    await test('PATCH missing revalida o responsável atual', async () => {
      const m = await newMissing('Responsável alterado'),
        resume = await pause('image', () =>
          raw(owner, 'PATCH', '/api/missing/' + m.id, { photo, features: 'Não deve gravar.' }),
        );
      alter('missing', (rows) => (rows.find((r) => r.id === m.id).ownerId = f.users.other.id));
      assert.equal((await resume()).status, 403);
      assert.equal(stored('missing', m.id).ownerId, f.users.other.id);
      assert.equal(stored('missing', m.id).features, m.features);
    });
    await test('PATCH missing não ressuscita registro retirado do estado durante a foto', async () => {
      const m = await newMissing('Registro removido na fixture'),
        resume = await pause('image', () => raw(owner, 'PATCH', '/api/missing/' + m.id, { photo }));
      alter('missing', (rows) =>
        rows.splice(
          rows.findIndex((r) => r.id === m.id),
          1,
        ),
      );
      assert.equal((await resume()).status, 404);
      assert.equal(stored('missing', m.id), undefined);
    });
    await test('PATCH missing revalida a situação atual da conta sem depender apenas do token', async () => {
      const m = await newMissing('Situação da conta'),
        resume = await pause('image', () => raw(owner, 'PATCH', '/api/missing/' + m.id, { photo }));
      sql((db) =>
        db
          .prepare('UPDATE users SET account_type=?,approval_status=? WHERE id=?')
          .run('ong', 'suspenso', f.users.owner.id),
      );
      try {
        assert.equal((await resume()).status, 403);
        assert.deepEqual(stored('missing', m.id), m);
      } finally {
        sql((db) =>
          db
            .prepare('UPDATE users SET account_type=?,approval_status=? WHERE id=?')
            .run('usuario', 'aprovado', f.users.owner.id),
        );
      }
    });
    await test('POST missing não cadastra após logout durante a foto', async () => {
      const before = sql(
          (db) => db.prepare("SELECT value FROM app_state WHERE key='missing'").get().value,
        ),
        resume = await pause('image', () =>
          raw(owner, 'POST', '/api/missing', {
            name: 'Não publicar sem sessão',
            city: 'Apodi',
            state: 'RN',
            missing_date: today,
            photo,
          }),
        );
      await owner.call('POST', '/api/auth/logout', {});
      assert.equal((await resume()).status, 401);
      assert.equal(
        sql((db) => db.prepare("SELECT value FROM app_state WHERE key='missing'").get().value),
        before,
      );
      await ownerLogin();
    });
    const demote = () =>
        sql((db) =>
          db
            .prepare('UPDATE users SET role=?,account_type=? WHERE id=1')
            .run('adotante', 'usuario'),
        ),
      restoreAdmin = () =>
        sql((db) =>
          db.prepare('UPDATE users SET role=?,account_type=? WHERE id=1').run('admin', 'admin'),
        );
    await test('POST animals usa papel atual, sem aprovação automática de ex-administrador', async () => {
      const resume = await pause('photos', () =>
        raw(admin, 'POST', '/api/animals', {
          name: 'Publicação com papel atualizado',
          city: 'Apodi',
          state: 'RN',
          photos: [photo],
        }),
      );
      demote();
      try {
        const r = await resume();
        assert.equal(r.status, 201);
        assert.equal(r.body.approvalStatus, 'pending');
      } finally {
        restoreAdmin();
      }
    });
    await test('PATCH animals revalida autorização de administrador após fotos', async () => {
      const a = await owner.call(
          'POST',
          '/api/animals',
          { name: 'Animal de terceiro', city: 'Apodi', state: 'RN', photos: [] },
          201,
        ),
        resume = await pause('photos', () =>
          raw(admin, 'PATCH', '/api/animals/' + a.id, {
            photos: [photo],
            approvalStatus: 'approved',
            reason: 'Não aprovar após perder autorização.',
          }),
        );
      demote();
      try {
        assert.equal((await resume()).status, 403);
        assert.equal(stored('animals', a.id).approvalStatus, 'pending');
        assert.deepEqual(stored('animals', a.id).photos, []);
      } finally {
        restoreAdmin();
      }
    });
    await test('POST animals continua rejeitando sessão revogada na validação final', async () => {
      const resume = await pause('photos', () =>
        raw(owner, 'POST', '/api/animals', {
          name: 'Sem sessão',
          city: 'Apodi',
          state: 'RN',
          photos: [photo],
        }),
      );
      await owner.call('POST', '/api/auth/logout', {});
      assert.equal((await resume()).status, 401);
      await ownerLogin();
    });
    async function concluded() {
      const a = await owner.call(
        'POST',
        '/api/animals',
        {
          name: 'Adoção para concorrência ' + sequence,
          city: 'Apodi',
          state: 'RN',
          description: 'Fixture válida para a revisão.',
          photos: ['img/animal1.png'],
        },
        201,
      );
      await admin.call('PATCH', '/api/animals/' + a.id, {
        approvalStatus: 'approved',
        reason: 'Fixture de acompanhamento.',
      });
      const r = await other.call(
        'POST',
        '/api/requests',
        require(path.join(project, 'tests/adoption-fixture.cjs'))({
          animalId: a.id,
          responsibility_confirmed: true,
        }),
        201,
      );
      await owner.call('POST', '/api/requests/' + r.id + '/approve', {});
      await owner.call('POST', '/api/requests/' + r.id + '/handover', { confirmed: true });
      await other.call('POST', '/api/requests/' + r.id + '/confirm-receipt', { confirmed: true });
      await owner.call('POST', '/api/requests/' + r.id + '/complete', {});
      alter(
        'requests',
        (rows) =>
          (rows.find((x) => x.id === r.id).completedAt = new Date(
            Date.now() - 100 * 86400000,
          ).toISOString()),
      );
      return r;
    }
    const followup = (r, day = 7) => ({
      requestId: r.id,
      day,
      adaptation: 'boa',
      health: 'Saúde fictícia para testar concorrência.',
      behavior: 'Comportamento fictício para testar concorrência.',
      needsHelp: false,
      photo,
      clientToken: crypto.randomUUID(),
    });
    await test('POST followups rejeita sessão revogada durante foto', async () => {
      const r = await concluded(),
        resume = await pause('image', () => raw(other, 'POST', '/api/followups', followup(r)));
      await other.call('POST', '/api/auth/logout', {});
      assert.equal((await resume()).status, 401);
      assert.ok(
        !sql((db) =>
          JSON.parse(db.prepare("SELECT value FROM app_state WHERE key='followups'").get().value),
        ).some((f) => f.requestId === r.id),
      );
      await otherLogin();
    });
    await test('POST followups revalida prazo e adoção atual antes de registrar', async () => {
      const r = await concluded(),
        resume = await pause('image', () => raw(other, 'POST', '/api/followups', followup(r)));
      alter(
        'requests',
        (rows) => (rows.find((x) => x.id === r.id).completedAt = new Date().toISOString()),
      );
      assert.equal((await resume()).status, 409);
    });
    await test('POST followups conserva envio paralelo de outra etapa', async () => {
      const r = await concluded(),
        resume = await pause('image', () => raw(other, 'POST', '/api/followups', followup(r))),
        second = await other.call('POST', '/api/followups', followup(r, 30), 201);
      assert.equal((await resume()).status, 201);
      assert.ok(stored('followups', second.id));
    });
    await test('POST followups concorrente com mesmo token é idempotente e não duplica', async () => {
      const r = await concluded(),
        body = followup(r),
        resume = await pause('image', () => raw(other, 'POST', '/api/followups', body)),
        second = await other.call('POST', '/api/followups', body, 201),
        first = await resume();
      assert.equal(first.status, 200);
      assert.equal(first.body.id, second.id);
      assert.equal(
        sql((db) =>
          JSON.parse(db.prepare("SELECT value FROM app_state WHERE key='followups'").get().value),
        ).filter((f) => f.requestId === r.id && f.day === 7).length,
        1,
      );
    });
    const { PDFDocument } = require(path.join(suiteRoot, 'node_modules/pdf-lib')),
      pdf = await PDFDocument.create();
    pdf.addPage([100, 100]);
    const pdfUpload = {
      name: 'arquivo-ficticio.pdf',
      mime: 'application/pdf',
      base64: Buffer.from(await pdf.save()).toString('base64'),
    };
    const campaign = () =>
      owner.call(
        'POST',
        '/api/campaigns',
        {
          clientToken: crypto.randomUUID(),
          kind: 'campaign',
          target: 'animal',
          title: 'Campanha fictícia de concorrência',
          beneficiaryName: 'Beneficiário fictício',
          description:
            'Dados fictícios para validar a revisão de estado durante processamento de arquivos.',
          category: 'tratamento',
          city: 'Apodi',
          state: 'RN',
          costs: 'Consulta fictícia e medicação fictícia.',
          organizer: 'Organizador fictício',
          contact: 'Contato fictício',
          goalCents: 10000,
          raisedCents: 0,
          beneficiary: 'Recebedor fictício',
          pixKeyType: 'aleatoria',
          pixKey: '00000000-0000-0000-0000-000000000000',
          receiverRelation: 'responsavel',
        },
        201,
      );
    await test('Upload de campanha já protege revisão concorrente e conserva alteração', async () => {
      const c = await campaign(),
        resume = await pause('pdf', () =>
          raw(owner, 'POST', '/api/campaigns/' + c.id + '/files', {
            ...pdfUpload,
            revision: c.revision,
          }),
        );
      await owner.call('PATCH', '/api/campaigns/' + c.id, {
        revision: c.revision,
        title: 'Título atualizado durante PDF',
      });
      assert.equal((await resume()).status, 409);
      assert.equal(
        (await owner.call('GET', '/api/campaigns/' + c.id)).draft.title,
        'Título atualizado durante PDF',
      );
    });
    await test('Upload de campanha já rejeita logout durante PDF', async () => {
      const c = await campaign(),
        resume = await pause('pdf', () =>
          raw(owner, 'POST', '/api/campaigns/' + c.id + '/files', {
            ...pdfUpload,
            revision: c.revision,
          }),
        );
      await owner.call('POST', '/api/auth/logout', {});
      assert.equal((await resume()).status, 401);
      assert.equal(
        sql(
          (db) =>
            db.prepare('SELECT COUNT(*) AS n FROM campaign_files WHERE campaign_id=?').get(c.id).n,
        ),
        0,
      );
      await ownerLogin();
    });
    await test('Upload de campanha registra o nome atual do autor após PDF', async () => {
      const c = await campaign(),
        resume = await pause('pdf', () =>
          raw(owner, 'POST', '/api/campaigns/' + c.id + '/files', {
            ...pdfUpload,
            revision: c.revision,
          }),
        );
      await owner.call('PATCH', '/api/users/me', {
        name: 'Autor atual da fixture',
        city: 'Apodi',
        state: 'RN',
        phone: '84999999999',
      });
      assert.equal((await resume()).status, 201);
      assert.equal(
        (await owner.call('GET', '/api/campaigns/' + c.id)).history.at(-1).actorName,
        'Autor atual da fixture',
      );
    });
    resetClients = async () => {};
    await stop();
    await test('Perfil ONG: controle no await PNG conserva outra organização', async () => {
      const db = new DatabaseSync(':memory:');
      try {
        db.exec(
          'CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,account_type TEXT,approval_status TEXT,role TEXT)',
        );
        db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(
          10,
          'ONG da fixture',
          'ong',
          'aprovado',
          'doador',
        );
        db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(
          20,
          'Outra ONG da fixture',
          'ong',
          'aprovado',
          'doador',
        );
        const state = {
          campaigns: [],
          organizations: [
            {
              id: 10,
              city: 'Apodi',
              state: 'RN',
              description: 'Apresentação anterior da ONG fictícia.',
              area: 'Proteção',
              contact: '',
              contactConsent: false,
              photo: '',
            },
          ],
        };
        let inserted = false,
          response;
        const body = {
          city: 'Apodi',
          state: 'RN',
          description: 'Apresentação válida da organização fictícia.',
          area: 'Proteção',
          contact: '',
          contactConsent: false,
          get photo() {
            if (!inserted) {
              inserted = true;
              queueMicrotask(() =>
                state.organizations.push({
                  id: 20,
                  city: 'Mossoró',
                  state: 'RN',
                  description: 'Outra organização registrada no intervalo.',
                  area: 'Proteção',
                  contact: '',
                  contactConsent: false,
                  photo: '',
                }),
              );
            }
            return photo;
          },
        };
        const route = require(path.join(project, 'lib/campaigns.cjs'))({
          db,
          loadState: (k) => JSON.parse(JSON.stringify(state[k] || [])),
          saveState: (k, v) => (state[k] = JSON.parse(JSON.stringify(v))),
          newId: () => 1,
          getAnimal: () => null,
          authUser: () => null,
          requireUser: () => db.prepare('SELECT * FROM users WHERE id=10').get(),
          readBody: async () => body,
          json: (res, status, value) => (response = { status, value }),
          error() {},
          securityHeaders() {},
          rateLimit: () => false,
          now: () => new Date().toISOString(),
          addNotification() {},
          addAdminLog() {},
          isPublicAnimal: () => false,
        });
        await route({ method: 'PUT' }, {}, new URL(base + '/api/organizations/me'));
        assert.equal(response.status, 200);
        assert.ok(state.organizations.some((o) => o.id === 20));
      } finally {
        db.close();
      }
    });
  } finally {
    await stop();
    if (process.env.POTYPET_CONCURRENCY_REPORT)
      fs.writeFileSync(
        process.env.POTYPET_CONCURRENCY_REPORT,
        JSON.stringify(
          {
            node: process.versions.node,
            projectVersion: JSON.parse(fs.readFileSync(path.join(project, 'package.json'))).version,
            cases: results,
            control:
              'HTTP real com barreira IPC após decodificação real; alterações de responsável/prazo/remoção são fixtures SQLite; perfil ONG usa microtask controlada no readBody injetável.',
            limitations: [
              'Dados fictícios; nenhuma alteração em banco real ou publicação.',
              'Perfil ONG usa PNG síncrono no decoder: controle de microtask é sintético, não uma afirmação de corrida HTTP observada nessa rota.',
            ],
          },
          null,
          2,
        ),
      );
    assert.ok(dataDir.startsWith(os.tmpdir() + path.sep + 'potypet-concurrency-'));
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    if (results.length !== 19 || results.some((r) => r.status !== 'pass')) process.exitCode = 1;
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
