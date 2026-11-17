#!/usr/bin/env node
'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const normalized = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const hash = (v) => crypto.createHash('sha256').update(v).digest('hex');
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const animalFields = ['name', 'species', 'breed', 'sex', 'size', 'age_group', 'city', 'state', 'neighborhood', 'description', 'history', 'contact', 'vaccinated', 'dewormed', 'neutered'];
const missingFields = ['name', 'species', 'color', 'approx_age', 'missing_date', 'city', 'state', 'last_seen_location', 'features', 'contact'];
const campaignFields = ['kind', 'target', 'beneficiaryName', 'title', 'category', 'description', 'costs', 'goalCents', 'raisedCents', 'organizer', 'city', 'state', 'contact', 'beneficiary', 'receiverRelation', 'receiverReason', 'receiverAuthorization', 'pixKeyType', 'pixKey'];
function siteUrl(value) {
  const u = new URL(value || 'http://127.0.0.1:3000');
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/' || !['http:', 'https:'].includes(u.protocol))
    throw Error('CADASTRO_URL deve ser a origem do site.');
  if (u.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname))
    throw Error('Use HTTPS para um site remoto. HTTP é aceito somente na máquina local.');
  return u.origin;
}
function safe(message, env) {
  let result = String(message);
  for (const v of [env.DONOR_PASSWORD, env.USUARIO_SENHA]) if (v) result = result.split(v).join('[sigilo]');
  return result;
}
async function preflight({ directory = path.join(root, 'fotos-cadastro'), env = process.env } = {}) {
  const issues = [];
  let base, data;
  try { base = siteUrl(env.CADASTRO_URL); } catch (e) { issues.push(e.message); }
  for (const key of ['DONOR_PASSWORD', 'USUARIO_SENHA']) {
    const v = env[key];
    if (typeof v !== 'string' || v.length < 12 || v.length > 128 || !/[A-Za-zÀ-ÿ]/.test(v) || !/\d/.test(v))
      issues.push(key + ': defina uma senha de 12 a 128 caracteres, com letra e número.');
  }
  try { data = JSON.parse(fs.readFileSync(path.join(directory, 'dados.json'), 'utf8')); }
  catch { issues.push('fotos-cadastro/dados.json: arquivo ausente ou JSON inválido.'); }
  const reject = () => { throw Error('Corrija antes de cadastrar:\n- ' + issues.join('\n- ')); };
  if (!data || typeof data !== 'object' || Array.isArray(data)) { issues.push('dados.json: informe um objeto.'); reject(); }
  function text(o, key, label, min = 1, max = 5000) {
    if (typeof o?.[key] !== 'string' || o[key].trim().length < min || o[key].length > max || o[key].includes('\0'))
      issues.push(label + '.' + key + ': campo obrigatório ou tamanho inválido.');
  }
  const option = (o, k, choices, label) => { if (!choices.includes(o?.[k])) issues.push(label + '.' + k + ': opção inválida.'); };
  function language(v, label) {
    if (typeof v === 'string') {
      if (/\b(?:teste\w*|exempl\w*|demonstr\w*|fictic\w*|lorem|substitua\w*|placeholder\w*)\b/.test(normalized(v)) || /\[[^\]]+\]/.test(v))
        issues.push(label + ': revise a linguagem antes da publicação.');
    } else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
      if (/password|senha/i.test(k)) issues.push(label + ': senhas só podem vir do ambiente.');
      language(x, label + '.' + k);
    }
  }
  language(data, 'dados');
  for (const [label, a] of [['ong', data.ong], ['usuario', data.usuario]]) {
    text(a, 'name', label, 2, 120); text(a, 'email', label, 3, 254);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a?.email || '')) issues.push(label + '.email: confira o endereço.');
  }
  for (const k of ['city', 'phone']) text(data.usuario, k, 'usuario', 1, k === 'phone' ? 50 : 120);
  if ((data.usuario?.phone || '').replace(/\D/g, '').length < 10) issues.push('usuario.phone: informe DDD e número.');
  if (data.usuario?.termsAccepted !== true || data.usuario?.accountType !== 'usuario' || data.usuario?.state !== 'RN')
    issues.push('usuario: confira aceite dos termos, tipo de conta e UF.');
  if (normalized(data.ong?.email) === normalized(data.usuario?.email)) issues.push('Use e-mails distintos para as duas contas.');
  for (const [k, min, max] of [['city', 1, 120], ['description', 20, 3000], ['area', 1, 300], ['contact', 1, 160]]) text(data.organization, k, 'organization', min, max);
  if (data.organization?.contactConsent !== true || data.organization?.state !== 'RN') issues.push('organization: confira a UF e a autorização do contato.');
  const lists = {};
  for (const [k, count] of [['animals', 5], ['missing', 2], ['campaigns', 2]]) {
    lists[k] = Array.isArray(data[k]) ? data[k] : [];
    if (lists[k].length !== count) issues.push(k + ': informe exatamente ' + count + ' itens.');
  }
  const seen = new Set();
  function identity(item, group, label, name) {
    option(item, 'owner', ['ong', 'usuario'], label);
    const key = group + ':' + item?.owner + ':' + normalized(name);
    if (seen.has(key)) issues.push(label + ': nome ou título repetido para o mesmo responsável.');
    seen.add(key);
    if (item?.state !== 'RN') issues.push(label + '.state: use RN.');
  }
  for (const [i, a] of lists.animals.entries()) {
    const label = 'animals[' + i + ']'; identity(a, 'animals', label, a?.name);
    for (const k of ['name', 'breed', 'city', 'neighborhood', 'contact']) text(a, k, label, 1, 120);
    text(a, 'description', label, 1, 2000); text(a, 'history', label, 1, 3000);
    for (const [k, choices] of [['species', ['cachorro', 'gato']], ['sex', ['macho', 'femea']], ['size', ['pequeno', 'medio', 'grande']], ['age_group', ['filhote', 'adulto', 'idoso']]]) option(a, k, choices, label);
    for (const k of ['vaccinated', 'dewormed', 'neutered']) if (typeof a?.[k] !== 'boolean') issues.push(label + '.' + k + ': informe verdadeiro ou falso.');
  }
  if (lists.animals.filter((a) => a?.owner === 'ong').length !== 4 || lists.animals.filter((a) => a?.owner === 'usuario').length !== 1)
    issues.push('animals: quatro animais devem pertencer à ONG e um à usuária.');
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  for (const [i, m] of lists.missing.entries()) {
    const label = 'missing[' + i + ']'; identity(m, 'missing', label, m?.name);
    for (const [k, max] of [['name', 120], ['color', 120], ['approx_age', 80], ['city', 120], ['last_seen_location', 300], ['features', 1600], ['contact', 120]]) text(m, k, label, 1, max);
    option(m, 'species', ['cachorro', 'gato'], label);
    const d = m?.missing_date, parsed = new Date(d + 'T00:00:00.000Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '') || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== d || d < '1900-01-01' || d > today)
      issues.push(label + '.missing_date: data inválida ou futura.');
    if (m?.owner !== 'ong') issues.push(label + '.owner: use ong.');
  }
  const patterns = { cpf: /^\d{11}$/, cnpj: /^[A-Z0-9]{12}\d{2}$/, email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, telefone: /^\+[1-9]\d{9,14}$/, aleatoria: /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i };
  for (const [i, c] of lists.campaigns.entries()) {
    const label = 'campaigns[' + i + ']'; identity(c, 'campaigns', label, c?.title);
    for (const [k, min, max] of [['title', 5, 120], ['description', 30, 4000], ['costs', 10, 2000], ['beneficiaryName', 2, 150], ['organizer', 2, 120], ['contact', 5, 160], ['beneficiary', 2, 120], ['city', 2, 120]]) text(c, k, label, min, max);
    // This import handles the two supplied categories; medical campaigns require the normal PDF workflow.
    option(c, 'category', ['acolhimento', 'alimentacao'], label);
    option(c, 'receiverRelation', ['tutor', 'organizacao', 'clinica', 'responsavel', 'outro'], label);
    if (['clinica', 'outro'].includes(c?.receiverRelation) && (c.receiverAuthorization !== true || typeof c.receiverReason !== 'string' || c.receiverReason.trim().length < 10)) issues.push(label + ': justifique e autorize o recebedor terceiro.');
    if (c?.kind !== 'campaign' || c?.target !== 'animal' || c?.animalId != null || c?.organizationId != null) issues.push(label + ': use campanha para animal sem vínculo no arquivo.');
    if (c?.photoConsent !== true) issues.push(label + ': autorize a foto de capa.');
    if (!Number.isSafeInteger(c?.goalCents) || c.goalCents < 100 || c.goalCents > 100000000 || c.raisedCents !== 0) issues.push(label + ': confira meta em centavos e total inicial zero.');
    if (!patterns[c?.pixKeyType]?.test(c?.pixKey || '')) issues.push(label + ': confira o tipo e a chave Pix.');
    if (lists.animals.some((a) => normalized(a?.name) === normalized(c?.beneficiaryName))) issues.push(label + ': o beneficiário deve ser outro animal.');
  }
  if (lists.campaigns.filter((c) => c?.owner === 'ong').length !== 1 || lists.campaigns.filter((c) => c?.owner === 'usuario').length !== 1) issues.push('campaigns: informe uma campanha de cada responsável.');
  const photos = new Map(), sharp = require('sharp'), { PNG } = require('pngjs');
  for (const [group, items] of Object.entries(lists)) for (const [i, item] of items.entries()) {
    const campaign = group === 'campaigns';
    try {
      if (typeof item?.photo !== 'string' || path.basename(item.photo) !== item.photo) throw Error('informe o nome do arquivo na pasta fotos-cadastro');
      const full = path.join(directory, item.photo), ext = path.extname(item.photo).toLowerCase();
      const mime = { '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.webp': 'webp' }[ext];
      if (!mime || (campaign && mime !== 'png')) throw Error(campaign ? 'a campanha exige PNG real' : 'use JPG, PNG ou WebP');
      const stat = fs.statSync(full);
      if (!stat.isFile() || stat.size > (campaign ? 4 : 3) * 1024 * 1024) throw Error('arquivo ausente ou acima do limite em MB');
      const bytes = fs.readFileSync(full), decoder = sharp(bytes, { failOn: 'warning', limitInputPixels: campaign ? 12000000 : 20000000 });
      const meta = await decoder.metadata();
      if (meta.format !== mime || (meta.pages || 1) > 1) throw Error('conteúdo diferente da extensão ou imagem animada');
      if (campaign && (meta.width > 4096 || meta.height > 4096)) throw Error('a campanha permite até 4096 px');
      if (mime === 'png') PNG.sync.read(bytes, { checkCRC: true });
      await decoder.raw().toBuffer();
      photos.set(item.photo, { dataUrl: 'data:image/' + mime + ';base64,' + bytes.toString('base64'), name: item.photo, mime: 'image/' + mime, base64: bytes.toString('base64'), sha256: hash(campaign ? PNG.sync.write(PNG.sync.read(bytes, { checkCRC: true })) : bytes) });
    } catch (e) { issues.push(group + '[' + i + '].photo (' + (item?.photo || 'sem arquivo') + '): ' + (e.code === 'ENOENT' ? 'arquivo ausente' : e.message)); }
  }
  if (issues.length) reject();
  return { base, data, photos, directory };
}
class Client {
  constructor(base, fetchImpl) { this.base = base; this.fetch = fetchImpl; this.cookies = new Map(); }
  async request(method, route, body, allowed = []) {
    let r;
    try { r = await this.fetch(this.base + route, { method, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { 'Content-Type': 'application/json', Origin: this.base, Cookie: [...this.cookies].map(([k, v]) => k + '=' + v).join('; ') }, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch { throw Error('Não foi possível acessar ' + route + '. Confira CADASTRO_URL e o servidor.'); }
    for (const entry of r.headers.getSetCookie()) { const pair = entry.split(';')[0], i = pair.indexOf('='); if (i > 0) this.cookies.set(pair.slice(0, i), pair.slice(i + 1)); }
    let data;
    try { data = await r.json(); } catch { throw Error(route + ': resposta sem JSON.'); }
    if (r.status === 429) { const wait = r.headers.get('retry-after'); throw Error('Limite de requisições em ' + route + '. Tente novamente' + (/^\d+$/.test(wait || '') ? ' após ' + wait + ' segundos.' : ' mais tarde.')); }
    if (!r.ok && !allowed.includes(r.status)) {
      if (data.code === 'EMAIL_NOT_VERIFIED') throw Error('Confirme o e-mail da conta no link recebido e execute novamente.');
      throw Error(route + ' (HTTP ' + r.status + '): ' + (data.error || 'solicitação recusada'));
    }
    return { status: r.status, data };
  }
  async call(method, route, body) { return (await this.request(method, route, body)).data; }
}
function unique(list, predicate, label) { const found = list.filter(predicate); if (found.length > 1) throw Error('Há mais de um registro de ' + label + '. Confira pela interface.'); return found[0]; }
function token(base, ownerId, title) {
  const b = crypto.createHash('sha256').update(base + ':' + ownerId + ':' + normalized(title)).digest().subarray(0, 16);
  b[6] = (b[6] & 15) | 80; b[8] = (b[8] & 63) | 128;
  const h = b.toString('hex'); return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
}
function lock(directory) {
  const file = path.join(directory, '.cadastro.lock');
  if (fs.existsSync(file)) {
    const pid = Number(fs.readFileSync(file, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid < 1) throw Error('Confira fotos-cadastro/.cadastro.lock antes de continuar.');
    try { process.kill(pid, 0); throw Error('Já existe um cadastro em execução nesta pasta.'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
    fs.unlinkSync(file);
  }
  const fd = fs.openSync(file, 'wx', 0o600); fs.writeFileSync(fd, String(process.pid)); fs.closeSync(fd);
  return () => fs.unlinkSync(file);
}
function undo(log) {
  log('Como desfazer: arquive os anúncios no painel de cada responsável; peça ao administrador a ocultação dos desaparecidos e a recusa/pausa das campanhas. Rascunhos podem ser arquivados em Minhas campanhas.');
  log('Restaure o perfil anterior em Organizações > Meu perfil público, se necessário. Preserve a ONG existente e os históricos. Não execute o cadastro novamente após retirar itens.');
}
async function run({ env = process.env, directory, fetchImpl = globalThis.fetch, log = console.log, validateOnly = false } = {}) {
  if (env.CADASTRO_INICIAL !== '1') { log('Cadastro desativado. Defina CADASTRO_INICIAL=1 para executar.'); return { status: 'disabled' }; }
  const plan = await preflight({ directory, env });
  if (validateOnly) { log('Dados, senhas no ambiente e nove fotos validados. Nenhuma chamada HTTP realizada.'); return { status: 'validated' }; }
  const release = lock(plan.directory), sessions = [], report = { status: 'complete', created: [], kept: [], pending: [], warnings: [] };
  const message = (s) => log(safe(s, env));
  try {
    const { data, photos, base } = plan;
    const ong = new Client(base, fetchImpl), maria = new Client(base, fetchImpl); sessions.push(ong, maria);
    const ongLogin = await ong.call('POST', '/api/auth/login', { email: data.ong.email, password: env.DONOR_PASSWORD });
    if (ongLogin.user?.accountType !== 'ong' || ongLogin.user.role === 'admin' || ongLogin.user.approvalStatus !== 'aprovado' || ongLogin.user.accountSuspended) throw Error('A ONG precisa estar ativa e aprovada. O script não altera sua aprovação.');
    if (ongLogin.user.name !== data.ong.name) { const warning = 'Nome atual da ONG: "' + ongLogin.user.name + '". Nome desejado: "' + data.ong.name + '". Ajuste pela interface; o script preservou o nome da conta.'; report.warnings.push(warning); message(warning); }
    let login = await maria.request('POST', '/api/auth/login', { email: data.usuario.email, password: env.USUARIO_SENHA }, [401]);
    if (login.status === 401) {
      const registration = await maria.request('POST', '/api/auth/register', { ...pick(data.usuario, ['name', 'email', 'phone', 'city', 'state', 'accountType', 'termsAccepted']), password: env.USUARIO_SENHA, passwordConfirmation: env.USUARIO_SENHA }, [400]);
      if (registration.status === 400) throw Error('Não foi possível cadastrar ou entrar como Maria. Se a conta já existe, confira USUARIO_SENHA ou use a recuperação de acesso pela interface.');
      if (registration.status === 202 || registration.data.pendingEmailVerification) {
        report.status = 'pending_email'; report.pending.push('Confirmação do e-mail de Maria Helena Souza.');
        message('Cadastro de Maria enviado. Confirme o e-mail pelo link recebido e execute novamente. Nenhum anúncio ou campanha foi criado nesta execução.'); undo(message); return report;
      }
      report.created.push('Conta de Maria Helena Souza');
      login = registration;
    }
    if (login.data.user?.accountType !== 'usuario' || login.data.user.role === 'admin' || login.data.user.accountSuspended) throw Error('Confira o tipo e a situação da conta de Maria.');
    const owners = { ong: { api: ong, user: ongLogin.user }, usuario: { api: maria, user: login.data.user } };
    for (const owner of Object.values(owners)) {
      owner.animals = (await owner.api.call('GET', '/api/animals?view=manage')).filter((a) => Number(a.ownerId) === owner.user.id);
      owner.missing = (await owner.api.call('GET', '/api/missing')).filter((m) => Number(m.ownerId) === owner.user.id);
      owner.campaigns = await owner.api.call('GET', '/api/campaigns/mine');
    }
    const animals = data.animals.map((a) => unique(owners[a.owner].animals, (r) => normalized(r.name) === normalized(a.name), a.name));
    const missing = data.missing.map((m) => unique(owners[m.owner].missing, (r) => normalized(r.name) === normalized(m.name), m.name));
    const campaigns = data.campaigns.map((c) => unique(owners[c.owner].campaigns, (r) => [r.draft?.title, r.publicVersion?.title].some((t) => normalized(t) === normalized(c.title)), c.title));
    const profile = await ong.call('GET', '/api/organizations/me');
    if (Object.entries(data.organization).some(([k, v]) => profile[k] !== v)) {
      await ong.call('PUT', '/api/organizations/me', { ...data.organization, photo: profile.photo || '' });
      report.created.push('Perfil público da ONG atualizado'); message('Perfil público da ONG atualizado.');
    }
    for (const [i, a] of data.animals.entries()) {
      let record = animals[i];
      if (!record) { record = await owners[a.owner].api.call('POST', '/api/animals', { ...pick(a, animalFields), photos: [photos.get(a.photo).dataUrl] }); report.created.push('Adoção ' + a.name + ' #' + record.id); message('Criado: adoção ' + a.name + ' (#' + record.id + ').'); }
      else { report.kept.push('Adoção ' + a.name + ' #' + record.id); message('Mantido: adoção ' + a.name + ' (#' + record.id + ').'); }
      if (record.approvalStatus === 'pending') report.pending.push('Adoção ' + a.name + ' #' + record.id);
    }
    for (const [i, m] of data.missing.entries()) {
      if (missing[i]) { report.kept.push('Desaparecido ' + m.name + ' #' + missing[i].id); message('Mantido: desaparecido ' + m.name + ' (#' + missing[i].id + ').'); continue; }
      const record = await owners[m.owner].api.call('POST', '/api/missing', { ...pick(m, missingFields), photo: photos.get(m.photo).dataUrl });
      report.created.push('Desaparecido ' + m.name + ' #' + record.id); message('Criado: desaparecido ' + m.name + ' (#' + record.id + ').');
    }
    for (const [i, c] of data.campaigns.entries()) {
      const owner = owners[c.owner]; let record = campaigns[i]; const existed = Boolean(record);
      if (!record) record = await owner.api.call('POST', '/api/campaigns', { ...pick(c, campaignFields), clientToken: token(base, owner.user.id, c.title), ...(c.owner === 'ong' ? { organizationId: owner.user.id } : {}) });
      if (record.status === 'draft' && !record.publicVersion) {
        if (campaignFields.some((k) => c[k] !== undefined && record.draft[k] !== c[k])) { const warning = 'Rascunho preservado com alterações: ' + c.title; report.warnings.push(warning); message(warning); continue; }
        const file = photos.get(c.photo);
        let uploaded = record.files.find((f) => !f.withdrawnAt && f.name === file.name && f.sha256 === file.sha256);
        if (!uploaded) {
          if (record.files.some((f) => f.name === file.name)) throw Error('A evidência foi alterada ou retirada. Confira pela interface: ' + c.title);
          uploaded = await owner.api.call('POST', '/api/campaigns/' + record.id + '/files', { mime: file.mime, base64: file.base64, name: file.name, revision: record.revision });
          record = await owner.api.call('GET', '/api/campaigns/' + record.id);
        }
        if (record.draft.photoFileId !== uploaded.id || record.draft.photoConsent !== true) record = await owner.api.call('PATCH', '/api/campaigns/' + record.id, { photoFileId: uploaded.id, photoConsent: true, revision: record.revision });
        record = await owner.api.call('POST', '/api/campaigns/' + record.id + '/submit', { revision: record.revision });
      }
      const label = 'Campanha ' + c.title + ' #' + record.id;
      report[existed ? 'kept' : 'created'].push(label); message((existed ? 'Mantida: ' : 'Criada: ') + c.title + ' (#' + record.id + ', ' + record.status + ').');
      if (record.status === 'review') report.pending.push(label);
    }
    message('Aguardando análise administrativa: ' + report.pending.length + ' itens.');
    for (const item of report.pending) message('- ' + item);
    message('Animais e campanhas pendentes ficam nas áreas dos responsáveis e no painel administrativo. O catálogo público depende da sua aprovação. Desaparecidos seguem a publicação normal do site.');
    undo(message); return report;
  } catch (e) {
    message('Interrompido: ' + e.message); message('Criados/atualizados nesta execução: ' + report.created.length + '. Execute novamente após resolver a pendência; registros existentes são preservados.'); undo(message); throw Error(safe(e.message, env));
  } finally {
    for (const session of sessions) { if (session.cookies.size) try { await session.call('POST', '/api/auth/logout', {}); } catch { /* Keep original result. */ } session.cookies.clear(); }
    release();
  }
}
module.exports = { run, preflight, siteUrl };
if (require.main === module) run({ validateOnly: process.argv.includes('--validar') }).catch((e) => { console.error(safe(e.message, process.env)); process.exitCode = 1; });
