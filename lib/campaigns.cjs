// Campanhas de arrecadação com Pix e os arquivos de campanha (PNG e PDF).
// Tem rotas próprias, chamadas pelo server.js.
'use strict';
const crypto = require('node:crypto');
const { PNG } = require('pngjs');
const { PDFDocument, PDFName } = require('pdf-lib');
const { createPixPayload } = require('./pix.cjs');
const validate = require('./input-validation.cjs');
const accountAccess = require('./account-access.cjs');

module.exports = function campaignService(ctx) {
  const {
    db,
    loadState,
    saveState,
    newId,
    getAnimal,
    requireUser,
    readBody,
    json,
    securityHeaders,
    rateLimit,
    now,
    addNotification,
    addAdminLog,
    isPublicAnimal,
    accountLimits,
  } = ctx;
  db.exec(`CREATE TABLE IF NOT EXISTS campaign_files (
    id TEXT PRIMARY KEY, campaign_id INTEGER NOT NULL, owner_id INTEGER NOT NULL,
    name TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS idx_campaign_files ON campaign_files(campaign_id);`);
  const columns = new Set(
    db
      .prepare('PRAGMA table_info(campaign_files)')
      .all()
      .map((column) => column.name),
  );
  for (const [column, type] of Object.entries({
    sha256: 'TEXT',
    withdrawn_at: 'TEXT',
    withdrawn_by: 'INTEGER',
    withdrawal_reason: 'TEXT',
  })) {
    if (!columns.has(column))
      db.exec('ALTER TABLE campaign_files ADD COLUMN ' + column + ' ' + type);
  }
  const fail = (message, status = 400) => {
    throw Object.assign(new Error(message), { status });
  };
  const text = (value, max = 1000) => {
    if (typeof value !== 'string' || value.length > max || value.includes('\0'))
      fail('Confira o tamanho e o formato dos campos.');
    return value.trim();
  };
  const getUser = (id) => db.prepare('SELECT * FROM users WHERE id=?').get(Number(id));
  const orgAllowed = (id) => {
    const u = getUser(id);
    return u?.account_type === 'ong' && !accountAccess.restricted(u);
  };
  const owns = (u, c) => u.role === 'admin' || c.ownerId === u.id;
  const records = () => loadState('campaigns');
  const files = (id) =>
    db
      .prepare(
        'SELECT id,name,mime,length(data) AS size,created_at AS createdAt,sha256,withdrawn_at AS withdrawnAt FROM campaign_files WHERE campaign_id=?',
      )
      .all(id);
  const activeFiles = (id) => files(id).filter((file) => !file.withdrawnAt);
  const find = (id) => records().find((c) => c.id === Number(id));
  function save(c) {
    const list = records(),
      index = list.findIndex((x) => x.id === c.id);
    if (index < 0) list.push(c);
    else list[index] = c;
    saveState('campaigns', list);
  }
  function history(c, user, action, reason = '') {
    c.history.push({ action, reason, actorId: user.id, actorName: user.name, at: now() });
    c.updatedAt = now();
    c.revision++;
  }
  function notifyAdmins(message) {
    for (const admin of db.prepare("SELECT id FROM users WHERE role='admin'").all())
      addNotification(admin.id, message);
  }
  // Idempotent, additive migration. Legacy records remain available for audit.
  const originalRecords = records();
  const migrated = originalRecords
    .map((c) => {
      if (c.schema === 2) return c;
      const a = getAnimal(c.animalId);
      const draft = {
        ...c,
        kind: 'campaign',
        target: 'animal',
        beneficiaryName: c.animalName || a?.name || '',
        organizationId: null,
        costs: '',
        receiverRelation: 'responsavel',
        receiverReason: '',
        receiverAuthorization: false,
        photoFileId: '',
        photoConsent: false,
        progressNote: '',
        updateText: '',
        expenseDescription: '',
      };
      const published = ['active', 'closed'].includes(c.status);
      return {
        schema: 2,
        id: c.id,
        ownerId:
          c.createdBy ||
          db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").get()?.id,
        revision: c.revision || 1,
        publicRevision: c.revision || 1,
        status: c.status || 'draft',
        liveState: c.status === 'closed' ? 'closed' : 'active',
        draft,
        approved: published ? structuredClone(draft) : null,
        legacy: c,
        checks: [],
        history: [],
        reviewSummary: '',
        reviewedAt: null,
        createdAt: c.createdAt || now(),
        updatedAt: c.updatedAt || now(),
      };
    })
    .map((c) => ({
      ...c,
      checks: c.checks || [],
      history: c.history || [],
      decisions: c.decisions || [],
      retainedEvidenceIds:
        c.retainedEvidenceIds ||
        (c.approved || c.history?.some((h) => ['approve', 'reject', 'changes'].includes(h.action))
          ? files(c.id).map((f) => f.id)
          : []),
      firstPublishedAt: c.firstPublishedAt || (c.approved ? c.publishedAt || c.createdAt : null),
    }));
  if (JSON.stringify(migrated) !== JSON.stringify(originalRecords))
    saveState('campaigns', migrated);
  const scopes = ['identity', 'purpose', 'costs', 'receiver', 'evidence', 'accountability'];
  const publicScopes = {
    identity: 'Organizador',
    purpose: 'Finalidade',
    costs: 'Custos',
    receiver: 'Recebedor',
    evidence: 'Evidências',
    accountability: 'Prestação de contas',
  };
  const days = { draft: 90, notice: 30, pause: 60 };
  const age = (date) => {
    const time = Date.parse(date);
    return Number.isFinite(time) ? (Date.parse(now()) - time) / 86400000 : 0;
  };
  const activityReference = (c) =>
    c.lastAccountabilityDate
      ? c.lastAccountabilityDate + 'T00:00:00-03:00'
      : c.firstPublishedAt || c.createdAt;
  function maintenance() {
    for (const c of records()) {
      if (
        !c.approved &&
        ['draft', 'changes', 'rejected'].includes(c.status) &&
        age(c.updatedAt) >= days.draft
      ) {
        c.status = 'archived';
        history(
          c,
          { id: null, name: 'Sistema' },
          'archive',
          'Rascunho sem atividade há 90 dias; arquivos e histórico preservados.',
        );
        save(c);
        addNotification(
          c.ownerId,
          'Campanha #' +
            c.id +
            ': rascunho arquivado por inatividade. Você pode restaurá-lo na sua área.',
        );
      } else if (isPublic(c) && c.liveState !== 'closed') {
        const reference = activityReference(c);
        if (age(reference) >= days.notice && c.accountabilityRequestedFor !== reference) {
          c.accountabilityRequestedFor = reference;
          save(c);
          addNotification(
            c.ownerId,
            'Campanha #' +
              c.id +
              ': envie uma prestação de contas com data, despesas e apuração dos valores.',
          );
          notifyAdmins('Campanha #' + c.id + ': 30 dias sem prestação de contas atualizada.');
        }
        if (age(reference) >= days.pause && c.liveState === 'active') {
          c.liveState = 'paused';
          if (c.status === 'active') c.status = 'paused';
          c.publicRevision++;
          c.publicPauseNote =
            'Recebimento pausado após 60 dias sem prestação de contas atualizada.';
          history(c, { id: null, name: 'Sistema' }, 'stale_pause', c.publicPauseNote);
          save(c);
          addNotification(
            c.ownerId,
            'Campanha #' +
              c.id +
              ': Pix pausado por falta de prestação de contas. Envie uma atualização para análise.',
          );
        }
      }
    }
  }
  function evidenceSnapshot(c, ids) {
    return ids.map((id) => {
      const file = db
        .prepare(
          'SELECT id,name,mime,data,sha256,withdrawn_at FROM campaign_files WHERE campaign_id=? AND id=?',
        )
        .get(c.id, id);
      if (!file || file.withdrawn_at) fail('Selecione evidências ativas desta campanha.');
      const sha256 = file.sha256 || crypto.createHash('sha256').update(file.data).digest('hex');
      if (!file.sha256) db.prepare('UPDATE campaign_files SET sha256=? WHERE id=?').run(sha256, id);
      return { id, name: file.name, mime: file.mime, sha256 };
    });
  }
  function safePublicText(value, max = 600) {
    const result = text(value, max),
      digits = result.replace(/\D/g, '');
    if (
      /@|\/api\/campaign-(?:files|media)\/|(?:https?:\/\/|data:)|\b[\w.-]+\.(?:pdf|png|jpe?g|webp)\b|\b(?:\d[.\s/-]*){11,14}\b/i.test(
        result,
      ) ||
      (digits.length >= 11 && /(?:cpf|cnpj|telefone|celular)/i.test(result))
    )
      fail('Retire contatos, documentos, links privados e dados pessoais do texto público.');
    return result;
  }
  function hasAccountability(d, c) {
    return Boolean(
      d.accountabilityDate ||
      d.expenseDescription ||
      d.raisedCents !== (c.approved?.raisedCents || 0) ||
      d.closeRequested,
    );
  }
  function isPublic(c) {
    const owner = getUser(c.ownerId);
    return Boolean(
      c.approved &&
      ['active', 'paused', 'closed'].includes(c.liveState) &&
      owner &&
      !accountAccess.restricted(owner) &&
      (!c.approved.organizationId || orgAllowed(c.approved.organizationId)),
    );
  }
  function publicView(c) {
    const d = c.approved;
    const a = d.animalId ? getAnimal(d.animalId) : null;
    const visibleAnimal = isPublicAnimal(a);
    const canDonate = isPublic(c) && c.liveState === 'active';
    return {
      id: c.id,
      revision: c.publicRevision,
      status: c.liveState,
      canDonate,
      kind: d.kind,
      target: d.target,
      title: d.title,
      description: d.description,
      category: d.category,
      beneficiaryName: d.beneficiaryName,
      animalName: d.beneficiaryName,
      animalId: d.animalId || null,
      animalUrl: visibleAnimal ? 'animal.html?id=' + a.id : null,
      organizationId: d.organizationId || null,
      city: d.city,
      state: d.state,
      organizer: d.organizer,
      contact: d.contact,
      beneficiary: d.beneficiary,
      receiverRelation: d.receiverRelation,
      pixKeyType: d.pixKeyType,
      pixKey: canDonate ? d.pixKey : '',
      goalCents: d.kind === 'ongoing' ? null : d.goalCents,
      raisedCents: d.raisedCents || 0,
      costs: d.costs,
      photo: d.photoFileId ? '/api/campaign-media/' + d.photoFileId : d.photo || '',
      updates: d.updates || [],
      reviewSummary: c.reviewSummary || '',
      reviewedAt: c.reviewedAt,
      totalUpdatedAt: d.totalUpdatedAt || c.createdAt,
      createdAt: c.createdAt,
      updatedAt: c.publishedAt || c.createdAt,
      lastAccountabilityDate: c.lastAccountabilityDate || null,
      lastAccountabilityPublishedAt: c.lastAccountabilityPublishedAt || null,
      needsAccountability: c.liveState !== 'closed' && age(activityReference(c)) >= days.notice,
      accountabilityDueDays: days.notice,
      pauseAfterDays: days.pause,
      pauseNote:
        c.liveState === 'paused'
          ? c.publicPauseNote || 'Recebimento pausado pela administração.'
          : '',
      closedAt: c.closedAt || null,
      closureSummary: c.closureSummary || '',
      reviewedSubjects: c.approvedReviewScopes || [],
      totalsSource: 'manual',
      bankConfirmed: false,
    };
  }
  function privateView(c, u) {
    const { legacy, clientToken, checks, ...result } = c;
    const organizer = getUser(c.ownerId);
    return {
      ...result,
      files: files(c.id).map((file) => ({
        ...file,
        retained: c.retainedEvidenceIds.includes(file.id),
        technicalValidation: 'format_checked',
        authenticity: 'not_automatically_verified',
      })),
      organizerAccount:
        u.role === 'admin' && organizer
          ? {
              id: organizer.id,
              name: organizer.name,
              email: organizer.email,
              phone: organizer.phone,
              accountType: organizer.account_type,
              approvalStatus: organizer.approval_status,
              emailVerified: Boolean(organizer.email_verified_at),
            }
          : undefined,
      checks: u.role === 'admin' ? checks : undefined,
      decisions: u.role === 'admin' ? c.decisions : undefined,
      publicVersion: isPublic(c) ? publicView(c) : null,
    };
  }
  const enums = {
    kind: ['campaign', 'ongoing'],
    target: ['animal', 'group', 'organization'],
    category: ['cirurgia', 'tratamento', 'alimentacao', 'acolhimento'],
    pixKeyType: ['aleatoria', 'email', 'telefone', 'cpf', 'cnpj'],
    receiverRelation: ['tutor', 'organizacao', 'clinica', 'responsavel', 'outro'],
  };
  const lengths = {
    title: 120,
    description: 4000,
    beneficiaryName: 150,
    city: 120,
    state: 2,
    costs: 2000,
    organizer: 120,
    contact: 160,
    beneficiary: 120,
    pixKey: 254,
    receiverReason: 1500,
    photoFileId: 36,
    progressNote: 1500,
    updateText: 2000,
    expenseDescription: 2000,
    accountabilityDate: 10,
  };
  function data(body, previous, user, c) {
    const d = {
      kind: 'campaign',
      target: 'animal',
      category: 'tratamento',
      pixKeyType: 'aleatoria',
      receiverRelation: 'tutor',
      goalCents: 0,
      raisedCents: 0,
      animalId: null,
      organizationId: null,
      photoConsent: false,
      receiverAuthorization: false,
      ...previous,
    };
    for (const [key, max] of Object.entries(lengths))
      if (Object.hasOwn(body, key)) d[key] = text(body[key], max);
    if (Object.hasOwn(body, 'state') && d.state) d.state = validate.state(d.state);
    if (Object.hasOwn(body, 'accountabilityDate') && d.accountabilityDate)
      d.accountabilityDate = validate.date(d.accountabilityDate);
    for (const [key, allowed] of Object.entries(enums))
      if (Object.hasOwn(body, key)) {
        if (!allowed.includes(body[key])) fail('Opção inválida: ' + key);
        d[key] = body[key];
      }
    for (const key of ['photoConsent', 'receiverAuthorization', 'closeRequested'])
      if (Object.hasOwn(body, key)) {
        if (typeof body[key] !== 'boolean') fail('Confirmação inválida.');
        d[key] = body[key];
      }
    for (const key of ['goalCents', 'raisedCents'])
      if (Object.hasOwn(body, key)) {
        if (!Number.isSafeInteger(body[key]) || body[key] < 0 || body[key] > 100000000)
          fail('Valor inválido. Use até R$ 1.000.000.');
        d[key] = body[key];
      }
    for (const key of ['animalId', 'organizationId'])
      if (Object.hasOwn(body, key)) {
        if (body[key] !== null && (!Number.isSafeInteger(body[key]) || body[key] < 1))
          fail('Vínculo inválido.');
        d[key] = body[key];
      }
    if (d.animalId && d.animalId !== previous?.animalId) {
      const a = getAnimal(d.animalId);
      if (!a || (a.ownerId !== user.id && user.role !== 'admin'))
        fail('Selecione um animal próprio.', 403);
    }
    if (d.organizationId) {
      if (
        (d.organizationId !== c.ownerId && user.role !== 'admin') ||
        !orgAllowed(d.organizationId)
      )
        fail('A organização deve ser sua e estar aprovada.', 403);
    }
    if (d.kind === 'ongoing' && (d.target !== 'organization' || !d.organizationId))
      fail('Apoio contínuo é destinado a uma organização aprovada.');
    if (d.kind === 'ongoing') d.goalCents = 0;
    if (d.photoFileId) {
      const f = db
        .prepare('SELECT mime,withdrawn_at FROM campaign_files WHERE id=? AND campaign_id=?')
        .get(d.photoFileId, c.id);
      if (!f || f.withdrawn_at || f.mime !== 'image/png')
        fail('Selecione uma foto ativa enviada para esta campanha.');
    }
    return d;
  }
  function validateSubmission(d, c) {
    for (const [key, min] of Object.entries({
      title: 5,
      description: 30,
      beneficiaryName: 2,
      city: 2,
      state: 2,
      costs: 10,
      organizer: 2,
      contact: 5,
      beneficiary: 2,
      pixKey: 3,
    })) {
      if (typeof d[key] !== 'string' || d[key].length < min)
        fail('Preencha os dados obrigatórios: ' + key);
    }
    d.state = validate.state(d.state);
    if (d.kind === 'campaign' && d.goalCents < 100) fail('A meta mínima é R$ 1.');
    if (d.target === 'organization' && !d.organizationId)
      fail('Selecione sua organização aprovada.');
    if (d.target !== 'animal' && d.animalId)
      fail('Um vínculo individual só pode ser usado para um animal.');
    if (['cpf', 'cnpj'].includes(d.pixKeyType))
      d.pixKey = d.pixKey.replace(/[.\-/\s]/g, '').toUpperCase();
    if (d.pixKeyType === 'email') d.pixKey = d.pixKey.toLowerCase();
    const patterns = {
      cpf: /^\d{11}$/,
      cnpj: /^[A-Z0-9]{12}\d{2}$/,
      telefone: /^\+[1-9]\d{9,14}$/,
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      aleatoria: /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
    };
    if (!patterns[d.pixKeyType].test(d.pixKey)) fail('Confira o tipo e a chave Pix.');
    if (
      ['clinica', 'outro'].includes(d.receiverRelation) &&
      (!d.receiverAuthorization || (d.receiverReason || '').length < 10)
    )
      fail('Explique o recebedor terceiro e confirme a autorização para usar os dados.');
    if (d.photoFileId && !d.photoConsent) fail('Autorize a publicação da foto de capa.');
    const evidence = activeFiles(c.id);
    if (!evidence.length) fail('Envie pelo menos uma evidência privada.');
    if (d.target === 'animal' && !evidence.some((f) => f.mime === 'image/png'))
      fail('Envie uma foto do animal.');
    if (
      ['cirurgia', 'tratamento'].includes(d.category) &&
      !evidence.some((f) => f.mime === 'application/pdf')
    )
      fail('Envie o orçamento ou relatório veterinário em PDF.');
    if (d.raisedCents !== (c.approved?.raisedCents || 0) && (d.progressNote || '').length < 10)
      fail('Explique a apuração do total recebido.');
    if (hasAccountability(d, c)) {
      if (
        !d.accountabilityDate ||
        (d.expenseDescription || '').length < 10 ||
        (d.progressNote || '').length < 10
      )
        fail(
          'Informe data da apuração, despesas (ou ausência delas) e explicação do total na prestação de contas.',
        );
      validate.date(d.accountabilityDate);
    }
    for (const [key, max] of Object.entries({
      expenseDescription: 2000,
      progressNote: 1500,
      updateText: 2000,
    }))
      if (d[key]) safePublicText(d[key], max);
  }
  async function decodeUpload(body) {
    if (
      typeof body.base64 !== 'string' ||
      body.base64.length > 6 * 1024 * 1024 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(body.base64)
    )
      fail('Arquivo inválido ou maior que 4 MB.');
    let bytes = Buffer.from(body.base64, 'base64');
    if (bytes.toString('base64') !== body.base64 || bytes.length > 4 * 1024 * 1024)
      fail('Arquivo inválido ou maior que 4 MB.');
    if (body.mime === 'image/png') {
      if (bytes.length < 33 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
        fail('O arquivo não é uma imagem PNG.');
      const w = bytes.readUInt32BE(16),
        h = bytes.readUInt32BE(20);
      if (!w || !h || w > 4096 || h > 4096 || w * h > 12000000)
        fail('Use imagem de até 4096 px e 12 megapixels.');
      try {
        bytes = PNG.sync.write(PNG.sync.read(bytes, { checkCRC: true }));
      } catch {
        fail('A imagem está corrompida.');
      }
      if (bytes.length > 4 * 1024 * 1024) fail('Reduza o tamanho da imagem.');
    } else if (body.mime === 'application/pdf') {
      if (
        bytes.subarray(0, 5).toString() !== '%PDF-' ||
        !bytes.subarray(-1024).toString().includes('%%EOF')
      )
        fail('O arquivo não é um PDF válido.');
      try {
        const pdf = await PDFDocument.load(bytes, {
          ignoreEncryption: false,
          throwOnInvalidObject: true,
        });
        if (!pdf.getPageCount() || pdf.getPageCount() > 50) fail('Use um PDF com até 50 páginas.');
        // Download only; additionally reject active content and embedded files.
        for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
          if (
            typeof obj.keys === 'function' &&
            obj
              .keys()
              .some((k) =>
                [
                  'JS',
                  'JavaScript',
                  'Launch',
                  'EmbeddedFiles',
                  'OpenAction',
                  'AA',
                  'RichMedia',
                ].includes(k.decodeText()),
              )
          )
            fail('Use um PDF sem scripts, anexos ou ações automáticas.');
        }
        if (pdf.catalog.has(PDFName.of('OpenAction'))) fail('Use um PDF sem ações automáticas.');
      } catch {
        fail('PDF inválido, protegido ou com conteúdo ativo. Exporte uma versão simples.');
      }
    } else fail('Use foto PNG ou documento PDF.');
    return bytes;
  }
  function organizationPublic(id) {
    if (!orgAllowed(id)) return null;
    const u = getUser(id),
      p = loadState('organizations').find((o) => o.id === Number(id));
    if (!p) return null;
    return {
      id: u.id,
      name: u.name,
      type: u.organization_kind || 'nao_informado',
      city: p.city,
      state: p.state,
      description: p.description,
      area: p.area,
      contact: p.contactConsent ? p.contact : '',
      photo: p.photo || '',
      animals: loadState('animals')
        .filter(
          (a) =>
            Number(a.ownerId) === u.id &&
            isPublicAnimal(a) &&
            ['disponivel', 'em_processo'].includes(a.status),
        )
        .map((a) => ({ id: a.id, name: a.name, city: a.city, photo: a.photos?.[0] || '' })),
      campaigns: records()
        .filter((c) => isPublic(c) && c.approved.organizationId === u.id)
        .map(publicView),
    };
  }
  function publicOrganizations() {
    const ids = [...new Set(loadState('organizations').map((o) => Number(o.id)))];
    return ids.map(organizationPublic).filter(Boolean);
  }
  const handle = async function (req, res, url) {
    const route = url.pathname,
      method = req.method;
    if (!/^\/api\/(campaigns|campaign-files|campaign-media|organizations)(\/|$)/.test(route))
      return false;
    maintenance();
    const done = (status, value) => {
      json(res, status, value);
      return true;
    };
    let m;
    if (method === 'GET' && route === '/api/campaigns')
      return done(200, records().filter(isPublic).map(publicView));
    if (method === 'GET' && route === '/api/organizations') return done(200, publicOrganizations());
    if ((m = route.match(/^\/api\/organizations\/(\d+)$/)) && method === 'GET') {
      const o = organizationPublic(m[1]);
      return o ? done(200, o) : done(404, { error: 'Organização não encontrada.' });
    }
    if ((m = route.match(/^\/api\/campaign-media\/([a-f0-9-]{36})$/)) && method === 'GET') {
      if (!records().some((c) => isPublic(c) && c.approved.photoFileId === m[1]))
        return done(404, { error: 'Imagem indisponível.' });
      const file = db
        .prepare('SELECT data FROM campaign_files WHERE id=? AND mime=?')
        .get(m[1], 'image/png');
      if (!file) return done(404, { error: 'Imagem indisponível.' });
      securityHeaders(res);
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      res.end(file.data);
      return true;
    }
    if ((m = route.match(/^\/api\/campaigns\/(\d+)\/pix$/)) && method === 'POST') {
      if (rateLimit(req, res, 'campaigns-pix', 30, 10 * 60 * 1000)) return true;
      const body = await readBody(req),
        c = find(m[1]);
      if (!c || !isPublic(c)) return done(404, { error: 'Campanha não encontrada.' });
      if (c.liveState !== 'active')
        return done(409, { error: 'Esta campanha não está recebendo doações.' });
      if (body.revision !== c.publicRevision)
        return done(409, { error: 'A campanha mudou. Feche e abra os detalhes novamente.' });
      return done(200, {
        payload: createPixPayload({ ...c.approved, amountCents: body.amountCents }),
        amountCents: body.amountCents,
        beneficiary: c.approved.beneficiary,
      });
    }
    let u = requireUser(req, res, null, method === 'GET');
    if (!u) return true;
    if (method !== 'GET' && rateLimit(req, res, 'campaign-workflow', 90, 10 * 60 * 1000))
      return true;
    if (route === '/api/organizations/me') {
      if (u.account_type !== 'ong')
        return done(403, { error: 'Esta área é destinada a ONGs e grupos aprovados.' });
      if (method === 'GET')
        return done(
          200,
          loadState('organizations').find((o) => o.id === u.id) || {
            id: u.id,
            city: u.city,
            state: u.state,
          },
        );
      if (method === 'PUT') {
        const b = await readBody(req);
        const p = {
          id: u.id,
          city: text(b.city, 120),
          state: validate.state(b.state),
          description: text(b.description, 3000),
          area: text(b.area, 300),
          contact: text(b.contact, 160),
          contactConsent: validate.boolean(b.contactConsent),
          photo: '',
        };
        if (!p.city || p.description.length < 20) fail('Informe cidade e apresentação.');
        if (b.photo)
          p.photo =
            'data:image/png;base64,' +
            (
              await decodeUpload({
                mime: 'image/png',
                base64: b.photo.replace(/^data:image\/png;base64,/, ''),
              })
            ).toString('base64');
        u = requireUser(req, res);
        if (!u) return true;
        if (u.account_type !== 'ong')
          return done(403, { error: 'Esta área é destinada a ONGs e grupos aprovados.' });
        p.id = u.id;
        const list = loadState('organizations');
        const i = list.findIndex((o) => o.id === u.id);
        if (i < 0) list.push(p);
        else list[i] = p;
        saveState('organizations', list);
        return done(200, p);
      }
    }
    if (method === 'GET' && route === '/api/campaigns/mine')
      return done(
        200,
        records()
          .filter((c) => c.ownerId === u.id)
          .map((c) => privateView(c, u)),
      );
    if (method === 'GET' && route === '/api/campaigns/manage') {
      if (u.role !== 'admin') return done(403, { error: 'Acesso administrativo necessário.' });
      return done(
        200,
        records().map((c) => privateView(c, u)),
      );
    }
    if (method === 'POST' && route === '/api/campaigns') {
      const b = await readBody(req);
      if (typeof b.clientToken !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(b.clientToken))
        fail('Identificador de envio inválido.');
      const duplicate = records().find(
        (c) => c.ownerId === u.id && c.clientToken === b.clientToken,
      );
      if (duplicate) return done(200, privateView(duplicate, u));
      if (
        records().filter((c) => c.ownerId === u.id && c.status !== 'archived').length >= 100 ||
        records().filter((c) => c.ownerId === u.id).length >= 1000
      )
        fail('Limite de campanhas atingido. Fale com a administração.', 429);
      const c = {
        schema: 2,
        id: newId('campaigns'),
        ownerId: u.id,
        clientToken: b.clientToken,
        revision: 1,
        publicRevision: 0,
        status: 'draft',
        liveState: 'paused',
        draft: {},
        approved: null,
        checks: [],
        history: [],
        decisions: [],
        retainedEvidenceIds: [],
        firstPublishedAt: null,
        createdAt: now(),
        updatedAt: now(),
      };
      c.draft = data(b, {}, u, c);
      save(c);
      return done(201, privateView(c, u));
    }
    if (
      (m = route.match(/^\/api\/campaign-files\/([a-f0-9-]{36})$/)) &&
      ['GET', 'DELETE'].includes(method)
    ) {
      let f = db.prepare('SELECT * FROM campaign_files WHERE id=?').get(m[1]);
      const c = f && find(f.campaign_id);
      if (!c || !owns(u, c)) return done(404, { error: 'Arquivo não encontrado.' });
      if (method === 'DELETE') {
        const b = await readBody(req),
          fresh = find(c.id);
        u = requireUser(req, res);
        if (!u) return true;
        if (!fresh || !owns(u, fresh)) return done(404, { error: 'Arquivo não encontrado.' });
        f = db.prepare('SELECT * FROM campaign_files WHERE id=?').get(m[1]);
        if (!f) return done(404, { error: 'Arquivo não encontrado.' });
        if (b.revision !== fresh.revision || fresh.status === 'review')
          fail('Reabra a campanha. Evidências em análise não podem ser retiradas.', 409);
        const reason = text(b.reason || '', 600);
        if (reason.length < 10) fail('Explique por que esta evidência precisa ser retirada.');
        if (fresh.approved?.photoFileId === f.id)
          fail(
            'Esta é a capa pública aprovada. Proponha outra capa ou retire a capa em uma nova versão antes de retirar a evidência.',
            409,
          );
        if (f.withdrawn_at) fail('Esta evidência já foi retirada de futuras análises.', 409);
        const retained = fresh.retainedEvidenceIds.includes(f.id);
        if (retained)
          db.prepare(
            'UPDATE campaign_files SET withdrawn_at=?,withdrawn_by=?,withdrawal_reason=? WHERE id=?',
          ).run(now(), u.id, reason, f.id);
        else db.prepare('DELETE FROM campaign_files WHERE id=?').run(f.id);
        if (fresh.draft.photoFileId === f.id) {
          fresh.draft.photoFileId = '';
          fresh.draft.photoConsent = false;
        }
        history(
          fresh,
          u,
          'evidence_remove',
          reason +
            ' ' +
            (retained
              ? 'Preservada no histórico das decisões.'
              : 'Arquivo sem uso em decisão removido.') +
            ' Evidência: ' +
            f.id,
        );
        save(fresh);
        return done(200, privateView(fresh, u));
      }
      securityHeaders(res);
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
      res.writeHead(200, {
        'Content-Type': f.mime,
        'Cache-Control': 'no-store',
        'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(f.name),
        'Content-Length': f.data.length,
      });
      res.end(f.data);
      return true;
    }
    m = route.match(/^\/api\/campaigns\/(\d+)(?:\/(submit|review|files|checks|archive|restore))?$/);
    if (!m) return done(404, { error: 'Rota não encontrada.' });
    let c = find(m[1]);
    const action = m[2];
    if (!c || !owns(u, c)) return done(404, { error: 'Campanha não encontrada.' });
    if (method === 'GET' && !action) return done(200, privateView(c, u));
    const b = await readBody(req);
    u = requireUser(req, res);
    if (!u) return true;
    c = find(m[1]);
    if (!c || !owns(u, c)) return done(404, { error: 'Campanha não encontrada.' });
    if (method === 'POST' && action === 'files') {
      if (['review', 'archived'].includes(c.status))
        fail('Restaure o rascunho ou aguarde a análise antes de alterar os documentos.', 409);
      if (b.revision !== undefined && b.revision !== c.revision)
        fail('Reabra a campanha antes de alterar as evidências.', 409);
      if (activeFiles(c.id).length >= 12) fail('Limite de 12 evidências ativas por campanha.');
      const previousRevision = c.revision;
      const bytes = await decodeUpload(b);
      // Re-check after asynchronous PDF parsing to avoid concurrent quota bypasses.
      u = requireUser(req, res);
      if (!u) return true;
      c = find(c.id);
      if (
        !c ||
        !owns(u, c) ||
        ['review', 'archived'].includes(c.status) ||
        activeFiles(c.id).length >= 12 ||
        (b.revision !== undefined && c.revision !== previousRevision)
      )
        fail('Campanha alterada. Reabra os detalhes.', 409);
      const used = db
        .prepare(
          'SELECT COALESCE(SUM(length(data)),0) AS size FROM campaign_files WHERE owner_id=?',
        )
        .get(c.ownerId).size;
      if (used + bytes.length > 50 * 1024 * 1024)
        fail('Limite de 50 MB de evidências por responsável atingido.');
      accountLimits?.ensureStorage(getUser(c.ownerId), bytes.length);
      const id = crypto.randomUUID(),
        name = text(b.name, 160).replace(/[^a-zA-Z0-9._ -]/g, '_') || 'evidencia';
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      db.prepare(
        'INSERT INTO campaign_files(id,campaign_id,owner_id,name,mime,data,created_at,sha256) VALUES(?,?,?,?,?,?,?,?)',
      ).run(id, c.id, c.ownerId, name, b.mime, bytes, now(), sha256);
      history(
        c,
        u,
        'evidence_add',
        'Evidência privada enviada: ' +
          id +
          '. Formato legível; autenticidade não verificada automaticamente.',
      );
      save(c);
      return done(201, {
        id,
        name,
        mime: b.mime,
        size: bytes.length,
        sha256,
        revision: c.revision,
        technicalValidation: 'format_checked',
        authenticity: 'not_automatically_verified',
      });
    }
    if (b.revision !== c.revision)
      fail('Há uma versão mais recente. Reabra a campanha antes de continuar.', 409);
    if (method === 'POST' && ['archive', 'restore'].includes(action)) {
      if (
        c.approved ||
        c.status === 'review' ||
        (action === 'restore' && c.status !== 'archived') ||
        (action === 'archive' && c.status === 'archived')
      )
        fail('Esta campanha não pode realizar essa operação.', 409);
      if (
        action === 'restore' &&
        records().filter((r) => r.ownerId === c.ownerId && r.status !== 'archived').length >= 100
      )
        fail('Limite de campanhas ativas na sua área atingido.', 409);
      c.status = action === 'archive' ? 'archived' : 'draft';
      history(
        c,
        u,
        action,
        action === 'archive' ? 'Rascunho arquivado; dados preservados.' : 'Rascunho restaurado.',
      );
      save(c);
      return done(200, privateView(c, u));
    }
    if (method === 'PATCH' && !action) {
      if (['review', 'archived'].includes(c.status))
        fail('Esta campanha não pode ser editada agora.', 409);
      const proposed = data(b, c.draft, u, c);
      if (c.approved && c.liveState === 'closed') {
        const financial = new Set([
          'raisedCents',
          'expenseDescription',
          'progressNote',
          'accountabilityDate',
          'updateText',
          'closeRequested',
        ]);
        if (
          Object.keys(proposed).some(
            (key) =>
              !financial.has(key) && JSON.stringify(proposed[key]) !== JSON.stringify(c.draft[key]),
          )
        )
          fail(
            'Campanhas encerradas aceitam apenas prestação de contas, sem reabrir ou alterar o Pix.',
            409,
          );
      }
      c.draft = proposed;
      if (c.status !== 'changes') c.status = 'draft';
      history(
        c,
        u,
        'draft',
        c.approved
          ? 'Rascunho atualizado. A versão pública aprovada permanece inalterada.'
          : 'Rascunho atualizado.',
      );
      save(c);
      return done(200, privateView(c, u));
    }
    if (method === 'POST' && action === 'submit') {
      if (!['draft', 'changes', 'rejected', 'paused'].includes(c.status))
        fail('Transição inválida.', 409);
      validateSubmission(c.draft, c);
      c.status = 'review';
      c.reviewCycle = (c.reviewCycle || 0) + 1;
      history(
        c,
        u,
        'submit',
        c.approved ? 'Alteração enviada para análise.' : 'Campanha enviada para análise.',
      );
      save(c);
      notifyAdmins('Campanha #' + c.id + ' aguardando análise: ' + c.draft.title);
      return done(200, privateView(c, u));
    }
    if (u.role !== 'admin')
      return done(403, { error: 'Somente a administração pode realizar a análise.' });
    if (method === 'POST' && action === 'checks') {
      if (c.status !== 'review')
        fail('Registre verificações somente durante a análise da versão proposta.', 409);
      const note = text(b.note, 2000),
        source = text(b.source || '', 500);
      const external = validate.boolean(b.external);
      if (note.length < 10) fail('Descreva a verificação realizada.');
      if (external && source.length < 5) fail('Registre a fonte independente do contato.');
      if (
        !Array.isArray(b.scopes) ||
        !b.scopes.length ||
        b.scopes.length > scopes.length ||
        new Set(b.scopes).size !== b.scopes.length ||
        b.scopes.some((s) => !scopes.includes(s))
      )
        fail('Selecione os assuntos efetivamente conferidos.');
      if (!['consistent', 'uncertain', 'inconsistent'].includes(b.result))
        fail('Informe o resultado da conferência.');
      const ids = b.fileIds || [];
      if (
        !Array.isArray(ids) ||
        ids.length > 12 ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => typeof id !== 'string')
      )
        fail('Seleção de evidências inválida.');
      if (b.scopes.includes('evidence') && !ids.length)
        fail('Selecione as evidências utilizadas na conferência.');
      const organizer = getUser(c.ownerId);
      c.checks.push({
        id: crypto.randomUUID(),
        note,
        source: external ? source : '',
        external,
        scopes: b.scopes,
        result: b.result,
        evidence: evidenceSnapshot(c, ids),
        cycle: c.reviewCycle,
        actorId: u.id,
        actorName: u.name,
        at: now(),
        organizerIdentity: {
          id: organizer.id,
          name: organizer.name,
          email: organizer.email,
          emailVerified: Boolean(organizer.email_verified_at),
          accountType: organizer.account_type,
        },
      });
      history(c, u, 'check', 'Verificação administrativa registrada.');
      save(c);
      return done(200, privateView(c, u));
    }
    if (method === 'POST' && action === 'review') {
      const decision = b.decision,
        reason = text(b.reason || '', 1500);
      const decisionVersion = structuredClone(c.draft);
      if (!['approve', 'changes', 'reject', 'pause', 'close', 'resume'].includes(decision))
        fail('Decisão inválida.');
      if (['approve', 'changes', 'reject'].includes(decision) && c.status !== 'review')
        fail('Esta solicitação não está em análise.', 409);
      if (['changes', 'reject', 'pause', 'close'].includes(decision) && reason.length < 10)
        fail('Informe uma justificativa com pelo menos 10 caracteres.');
      if (decision === 'approve') {
        validateSubmission(c.draft, c);
        const summary = safePublicText(b.summary || '');
        const required = scopes.filter(
          (scope) => scope !== 'accountability' || hasAccountability(c.draft, c),
        );
        const cycleChecks = c.checks.filter(
          (check) => check.cycle === c.reviewCycle && Array.isArray(check.scopes),
        );
        if (
          summary.length < 30 ||
          required.some(
            (scope) =>
              [...cycleChecks].reverse().find((check) => check.scopes.includes(scope))?.result !==
              'consistent',
          )
        )
          fail(
            'Confira organizador, finalidade, custos, recebedor e evidências desta versão. Se houver prestação de contas, confira-a também. Registre um resumo público específico.',
          );
        if (b.publicSummaryConfirmed !== true)
          fail('Confirme que o resumo público não contém documentos ou dados pessoais.');
        const approved = structuredClone(c.draft),
          last = c.approved;
        approved.updates = structuredClone(last?.updates || []);
        if (
          approved.updateText ||
          approved.expenseDescription ||
          approved.raisedCents !== (last?.raisedCents || 0)
        ) {
          approved.updates.push({
            note: approved.updateText || '',
            expenses: approved.expenseDescription || '',
            accountabilityDate: approved.accountabilityDate || null,
            apportionment: approved.progressNote || '',
            raisedCents: approved.raisedCents,
            createdAt: now(),
            source: 'manual',
          });
        }
        approved.totalUpdatedAt =
          approved.raisedCents !== last?.raisedCents ? now() : last.totalUpdatedAt;
        if (approved.accountabilityDate) {
          c.lastAccountabilityDate = approved.accountabilityDate;
          c.lastAccountabilityPublishedAt = now();
        }
        c.approved = approved;
        c.draft = {
          ...approved,
          updateText: '',
          expenseDescription: '',
          progressNote: '',
          accountabilityDate: '',
          closeRequested: false,
        };
        c.liveState =
          c.liveState === 'closed' || approved.closeRequested
            ? 'closed'
            : last && c.liveState === 'paused'
              ? 'paused'
              : 'active';
        c.status = c.liveState;
        c.publicRevision = c.revision + 1;
        c.publishedAt = now();
        c.firstPublishedAt ||= now();
        if (c.liveState === 'closed') {
          c.closedAt ||= now();
          c.closureSummary = approved.closeRequested
            ? 'Encerramento solicitado pelo organizador e aprovado com prestação de contas.'
            : c.closureSummary || 'Recebimento encerrado pela administração.';
        }
        c.approvedReviewScopes = required.map((scope) => publicScopes[scope]);
        c.reviewSummary = summary;
        c.reviewedAt = now();
      } else if (decision === 'changes') c.status = 'changes';
      else if (decision === 'reject') c.status = 'rejected';
      else {
        if (!c.approved) fail('A campanha ainda não foi aprovada.', 409);
        if (decision === 'resume' && c.liveState !== 'paused')
          fail('Somente campanhas pausadas podem ser reabertas.', 409);
        if (decision === 'pause' && c.liveState === 'paused')
          fail('O recebimento desta campanha já está pausado.', 409);
        if (decision === 'resume' && age(activityReference(c)) >= days.pause)
          fail(
            'Aprovação de uma prestação de contas recente é necessária antes de reativar o Pix.',
            409,
          );
        if (c.liveState === 'closed') fail('A campanha já foi encerrada.', 409);
        c.liveState = decision === 'pause' ? 'paused' : decision === 'close' ? 'closed' : 'active';
        const publicNote = b.publicNote ? safePublicText(b.publicNote) : '';
        if (decision === 'pause')
          c.publicPauseNote = publicNote || 'Recebimento pausado pela administração.';
        if (decision === 'close') {
          c.closedAt = now();
          c.closureSummary =
            publicNote ||
            'Recebimento encerrado pela administração, sem nova prestação de contas nesta decisão.';
        }
        if (decision === 'resume') c.publicPauseNote = '';
        if (!['draft', 'review', 'changes', 'rejected'].includes(c.status) || decision === 'close')
          c.status = c.liveState;
        c.publicRevision++;
      }
      const checksUsed = c.checks.filter((check) => check.cycle === c.reviewCycle),
        used = [
          ...new Set(checksUsed.flatMap((check) => (check.evidence || []).map((file) => file.id))),
        ];
      {
        c.retainedEvidenceIds = [...new Set([...c.retainedEvidenceIds, ...used])];
        c.decisions.push({
          decision,
          reason,
          summary: decision === 'approve' ? c.reviewSummary : '',
          reviewCycle: c.reviewCycle,
          actorId: u.id,
          actorName: u.name,
          at: now(),
          proposedVersion: decisionVersion,
          checkIds: checksUsed.map((check) => check.id).filter(Boolean),
          evidenceIds: used,
        });
      }
      if (decision === 'close')
        c.draft = {
          ...structuredClone(c.approved),
          updateText: '',
          expenseDescription: '',
          progressNote: '',
          accountabilityDate: '',
          closeRequested: false,
        };
      history(c, u, decision, reason);
      save(c);
      addNotification(
        c.ownerId,
        'Campanha #' +
          c.id +
          ': ' +
          {
            approve:
              c.liveState === 'closed' ? 'atualização aprovada e campanha encerrada' : 'aprovada',
            changes: 'ajustes solicitados',
            reject: 'reprovada',
            pause: 'pausada',
            close: 'encerrada',
            resume: 'reativada',
          }[decision] +
          (reason ? '. ' + reason : '.'),
      );
      addAdminLog(u, 'Decisão ' + decision + ' na campanha #' + c.id + '. ' + reason);
      return done(200, privateView(c, u));
    }
    return done(405, { error: 'Operação não permitida.' });
  };
  handle.publicOrganizations = publicOrganizations;
  return handle;
};
