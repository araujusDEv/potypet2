'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process'), { DatabaseSync } = require('node:sqlite');
const sharp = require('sharp'), { run } = require('../scripts/cadastro-inicial.cjs');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'potypet-http-cadastro-'));
const directory = path.join(temp, 'fotos-cadastro'), dataDir = path.join(temp, 'db'), base = 'http://127.0.0.1:3211';
fs.mkdirSync(directory);
const donorPassword = 'Ong9' + crypto.randomBytes(12).toString('hex'), userPassword = 'Maria9' + crypto.randomBytes(12).toString('hex');
const env = { ...process.env, CADASTRO_INICIAL: '1', CADASTRO_URL: base, DONOR_PASSWORD: donorPassword, USUARIO_SENHA: userPassword };
let child;
const db = (fn) => { const d = new DatabaseSync(path.join(dataDir, 'adotapet.db')); try { return fn(d); } finally { d.close(); } };
const state = (d, key) => JSON.parse(d.prepare('SELECT value FROM app_state WHERE key=?').get(key).value);
const snapshot = () => db((d) => ({ users: d.prepare('SELECT COUNT(*) AS n FROM users').get().n,
  files: d.prepare('SELECT COUNT(*) AS n FROM campaign_files').get().n, sessions: d.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,
  animals: state(d, 'animals'), missing: state(d, 'missing'), campaigns: state(d, 'campaigns'), organizations: state(d, 'organizations'), log: state(d, 'adminLog') }));
async function start(transport = 'disabled') {
  let output = '';
  child = spawn(process.execPath, ['server.js'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...env, CADASTRO_INICIAL: '0', NODE_ENV: 'test', DATA_DIR: dataDir, HOST: '127.0.0.1', PORT: '3211',
    SEED_SAMPLE_DATA: '0', SEED_DEMO_ACCOUNTS: '0', ADMIN_RECOVERY_ID: '', TRUST_PROXY: '0', TRUSTED_PROXY_IPS: '',
    COOKIE_SECURE: '1', BACKUP_AUTO: '0', EMAIL_TRANSPORT: transport, MAIL_QUEUE_KEY: crypto.randomBytes(32).toString('base64'),
    MAIL_FROM: 'avisos@potypet.org', PUBLIC_BASE_URL: base, RENDER_EXTERNAL_URL: '',
    ADMIN_EMAIL: 'gestao@potypet.org', ADMIN_PASSWORD: 'Gestao9' + crypto.randomBytes(12).toString('hex'),
    DONOR_EMAIL: 'hypestoreoofc@gmai.com', DONOR_NAME: 'Perfil responsável inicial' } });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (d) => { output += d; });
  for (let n = 0; !output.includes('PotyPet rodando'); n++) {
    if (n > 400 || child.exitCode !== null) throw Error('Servidor isolado não iniciou.');
    await new Promise((r) => setTimeout(r, 25));
  }
}
async function stop() { if (child?.exitCode === null && child.signalCode === null) { const done = new Promise((r) => child.once('exit', r)); child.kill(); await done; } child = null; }
function configuration() {
  const animal = (name, owner, species, photo) => ({ name, owner, species, photo, breed: 'SRD', sex: 'femea', size: 'pequeno', age_group: 'adulto', city: 'Apodi', state: 'RN', neighborhood: 'Centro', description: name + ' gosta de companhia e de uma rotina tranquila.', history: 'Foi acolhida e recebeu os cuidados necessários antes de procurar uma família.', contact: '(84) 90000-0101', vaccinated: true, dewormed: true, neutered: true });
  const campaign = (owner, name, category) => ({ owner, title: 'Cuidados para ' + name, beneficiaryName: name, category, photo: 'campanha-' + owner + '.png', kind: 'campaign', target: 'animal', description: name + ' precisa de apoio para manter a alimentação e os cuidados durante o acolhimento.', costs: 'Ração por três meses e cuidados com a acomodação.', goalCents: 100000, raisedCents: 0, organizer: 'Rede de cuidado', city: 'Apodi', state: 'RN', contact: '(84) 90000-0101', beneficiary: 'Maria Helena Souza', receiverRelation: 'responsavel', pixKeyType: 'aleatoria', pixKey: crypto.randomUUID(), photoConsent: true });
  return { ong: { name: 'Associação Poty Amigos dos Bichos', email: 'hypestoreoofc@gmai.com' },
    usuario: { name: 'Maria Helena Souza', email: 'potypett+maria@gmail.com', phone: '(84) 90000-0202', city: 'Mossoró', state: 'RN', accountType: 'usuario', termsAccepted: true },
    organization: { city: 'Apodi', state: 'RN', description: 'Acolhemos cães e gatos e acompanhamos a chegada de cada animal à nova família.', area: 'Apodi e região', contact: '(84) 90000-0101', contactConsent: true },
    animals: [animal('Pipoca', 'ong', 'cachorro', 'pipoca.jpg'), animal('Fred', 'ong', 'gato', 'fred.jpg'), animal('Luna', 'ong', 'cachorro', 'luna.jpg'), animal('Mel', 'ong', 'gato', 'mel.jpg'), animal('Biscoito', 'usuario', 'cachorro', 'biscoito.webp')],
    missing: ['Bolinha', 'Tigre'].map((name, i) => ({ name, owner: 'ong', species: i ? 'gato' : 'cachorro', color: 'Caramelo', approx_age: '3 anos', missing_date: '2026-01-01', city: 'Apodi', state: 'RN', last_seen_location: 'Praça central de Apodi', features: 'Usa coleira azul e atende pelo nome.', contact: '(84) 90000-0101', photo: 'busca-' + i + '.png' })),
    campaigns: [campaign('ong', 'Pretinha', 'acolhimento'), campaign('usuario', 'Mingau', 'alimentacao')] };
}
(async () => {
  try {
    const config = configuration(), filename = path.join(directory, 'dados.json');
    const save = () => fs.writeFileSync(filename, JSON.stringify(config)); save();
    const jpeg = await sharp({ create: { width: 48, height: 48, channels: 3, background: '#cf9f52' } }).jpeg().toBuffer();
    const png = await sharp(jpeg).png().toBuffer(), webp = await sharp(jpeg).webp().toBuffer();
    const all = [...config.animals, ...config.missing, ...config.campaigns];
    for (const item of all) fs.writeFileSync(path.join(directory, item.photo), item.photo.endsWith('.png') ? png : item.photo.endsWith('.webp') ? webp : jpeg);
    let requests = [], output = [];
    const execute = (extra = {}) => run({ directory, env, log: (s) => output.push(s), fetchImpl: async (url, options) => {
      const route = new URL(url).pathname; requests.push({ method: options.method, route });
      assert.doesNotMatch(route, /\/review$|\/checks$|\/approve$|\/api\/users|\/admin/);
      if (options.body) { const body = JSON.parse(options.body); assert.equal('approvalStatus' in body, false); assert.notEqual(body.email, 'gestao@potypet.org'); }
      return fetch(url, options);
    }, ...extra });
    await execute({ env: { ...env, CADASTRO_INICIAL: '0' } }); assert.equal(requests.length, 0);
    const disabled = spawnSync(process.execPath, ['scripts/cadastro-inicial.cjs'], { cwd: root, env: { ...env, CADASTRO_INICIAL: 'true' }, encoding: 'utf8', windowsHide: true });
    assert.equal(disabled.status, 0); assert.match(disabled.stdout, /desativado/);
    fs.renameSync(path.join(directory, 'pipoca.jpg'), path.join(directory, 'pipoca.saved'));
    fs.renameSync(path.join(directory, 'fred.jpg'), path.join(directory, 'fred.saved'));
    await assert.rejects(execute({ env: { ...env, USUARIO_SENHA: 'curta' } }), (e) => /pipoca.jpg/.test(e.message) && /fred.jpg/.test(e.message) && /USUARIO_SENHA/.test(e.message));
    assert.equal(requests.length, 0);
    for (const name of ['pipoca', 'fred']) fs.renameSync(path.join(directory, name + '.saved'), path.join(directory, name + '.jpg'));
    fs.writeFileSync(path.join(directory, 'campanha-ong.png'), jpeg);
    await assert.rejects(execute(), /conteúdo diferente/); assert.equal(requests.length, 0);
    fs.writeFileSync(path.join(directory, 'campanha-ong.png'), png);
    config.animals[0].description = 'Texto de demonstração para o animal.'; save();
    await assert.rejects(execute(), /linguagem/); assert.equal(requests.length, 0);
    config.animals[0].description = configuration().animals[0].description; save();
    await execute({ validateOnly: true }); assert.equal(requests.length, 0);
    await start();
    const first = await execute(); const snapshot1 = snapshot();
    assert.equal(first.pending.length, 7); assert.equal(first.warnings.length, 1);
    assert.equal(snapshot1.users, 3); assert.equal(snapshot1.files, 2); assert.equal(snapshot1.sessions, 0);
    assert.equal(snapshot1.animals.length, 5); assert.equal(snapshot1.missing.length, 2);
    assert.ok(snapshot1.animals.every((a) => a.approvalStatus === 'pending' && a.status === 'disponivel'));
    assert.ok(snapshot1.campaigns.every((c) => c.status === 'review' && c.approved === null && c.draft.animalId === null && c.draft.photoConsent && c.draft.photoFileId));
    assert.equal(snapshot1.organizations.length, 1);
    assert.equal(db((d) => d.prepare('SELECT name FROM users WHERE id=2').get().name), 'Perfil responsável inicial');
    assert.equal(requests.filter((r) => r.route === '/api/auth/register').length, 1);
    assert.equal((await (await fetch(base + '/api/campaigns')).json()).length, 0);
    assert.equal((await (await fetch(base + '/api/animals')).json()).length, 0);
    requests = []; const second = await execute();
    assert.equal(second.created.length, 0); assert.equal(second.pending.length, 7); assert.deepEqual(snapshot(), snapshot1);
    assert.equal(requests.filter((r) => r.method !== 'GET' && !['/api/auth/login', '/api/auth/logout'].includes(r.route)).length, 0);
    assert.ok(!output.join('\n').includes(donorPassword) && !output.join('\n').includes(userPassword));
    console.log('OK cadastro HTTP — opt-in, preflight agregado, nove imagens, cookies, perfil, sete pendências e segunda execução sem duplicação');
    // Resume a draft interrupted after file upload: neither campaign nor evidence is duplicated.
    db((d) => { const list = state(d, 'campaigns'); list[0].status = 'draft'; delete list[0].draft.photoFileId; d.prepare("UPDATE app_state SET value=? WHERE key='campaigns'").run(JSON.stringify(list)); });
    await execute(); assert.equal(snapshot().files, 2); assert.equal(snapshot().campaigns.length, 2);
    // A 429 stops creation; there is no write retry loop.
    let attempts = 0;
    await assert.rejects(execute({ fetchImpl: async () => { attempts++; return new Response(JSON.stringify({ error: 'Limite atingido' }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '600' } }); } }), /600 segundos/);
    assert.equal(attempts, 1);
    await stop(); fs.rmSync(dataDir, { recursive: true, force: true });
    await start(); await execute(); assert.equal(snapshot().animals.length, 5); assert.equal(snapshot().campaigns.length, 2);
    console.log('OK cadastro HTTP — retomada de rascunho, limite de requisições e recriação do banco sem marcador externo');
    await stop(); fs.rmSync(dataDir, { recursive: true, force: true });
    await start('file'); requests = [];
    const pending = await execute(); assert.equal(pending.status, 'pending_email');
    assert.equal(snapshot().animals.length, 0); assert.equal(snapshot().campaigns.length, 0); assert.equal(snapshot().organizations.length, 0);
    console.log('OK cadastro HTTP — confirmação de e-mail preservada, sem acesso administrativo ou aprovação automática');
  } finally { await stop(); fs.rmSync(temp, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
