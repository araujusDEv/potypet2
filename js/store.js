/* ==========================================================================
   store.js — Cliente da API do PotyPet.
   Os dados agora ficam em um banco SQLite no servidor (server.js).
   A sessão é mantida por cookie HttpOnly; o JavaScript não acessa senhas nem tokens.
   ========================================================================== */

const ANIMAL_STATUS = {
  aguardando_aprovacao: 'Aguardando aprovação',
  disponivel: 'Disponível',
  em_processo: 'Em processo de adoção',
  adotado: 'Adotado',
  indisponivel: 'Indisponível',
};

const REQUEST_STATUS = {
  pendente: 'Pendente',
  em_analise: 'Em análise',
  aprovada: 'Aprovada',
  reprovada: 'Reprovada',
  cancelada: 'Cancelada',
  concluida: 'Adoção concluída',
};

const COEXISTENCE_LABEL = { sim: 'Sim', nao: 'Não', nao_informado: 'Não informado' };
const ENERGY_LABEL = { baixo: 'Baixa', medio: 'Média', alto: 'Alta' };
const REPORT_CATEGORY_LABEL = {
  informacao_falsa: 'Informação falsa',
  maus_tratos: 'Suspeita de maus-tratos',
  ja_adotado: 'Animal já foi adotado',
  duplicado: 'Anúncio duplicado',
  spam: 'Spam / conteúdo indevido',
  outro: 'Outro',
  atendimento: 'Atendimento',
};

function escapeHTML(value) {
  return String(value ?? '').replace(
    /[&<>'"]/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      })[c],
  );
}
function escapeAttr(value) {
  return escapeHTML(value);
}
function safeImageSrc(value) {
  const src = String(value || '');
  if (/^img\/[A-Za-z0-9._/-]+$/.test(src)) return src;
  if (
    /^\/api\/profile-media\/(animal|missing|followup)\/\d+\/\d+\/(thumb|gallery|preview)\?v=[a-f0-9]{20}$/.test(
      src,
    )
  )
    return src;
  if (/^\/api\/campaign-media\/[a-f0-9-]{36}$/.test(src)) return src;
  if (/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/i.test(src)) return src;
  return '';
}

function animalPriorityReasons(animal) {
  if (!Store.isAnimalAvailable(animal)) return [];
  const reasons = [];
  if (animal.special_needs) reasons.push('Necessidades especiais');
  if (animal.age_group === 'idoso') reasons.push('Animal idoso');
  const days = Math.floor((Date.now() - Date.parse(animal.createdAt)) / 86400000);
  if (days > 60) reasons.push('Há ' + days + ' dias aguardando adoção');
  return reasons;
}
function animalNeedsAttention(animal) {
  if (!Store.isAnimalAvailable(animal)) return false;
  const created = new Date(animal.createdAt).getTime();
  const daysWaiting = Number.isFinite(created) ? (Date.now() - created) / 86400000 : 0;
  return Boolean(animal.special_needs) || animal.age_group === 'idoso' || daysWaiting > 60;
}

function apiRequest(...args) {
  return apiRequestAsync(...args);
}

async function apiRequestAsync(method, url, body, options = {}) {
  if (window.location.protocol === 'file:')
    throw new Error('Abra o PotyPet pelo endereço do site para continuar.');
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal: options.signal || AbortSignal.timeout(method === 'GET' ? 60000 : 120000),
    });
  } catch {
    throw new Error('Não foi possível carregar os dados. Verifique sua conexão e tente novamente.');
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (response.ok) return payload;
  if (
    (options.allow401 && response.status === 401) ||
    (options.allow404 && response.status === 404)
  )
    return null;
  const err = new Error(payload?.error || `Erro ${response.status} ao acessar o servidor.`);
  err.status = response.status;
  throw err;
}

const Store = {
  getAnimalOwnerName(id) {
    return this.getAnimal(id)?.owner || null;
  },
  async fetchAnimal(id) {
    const animal = await apiRequestAsync('GET', '/api/animals/' + Number(id));
    App.data.animals = (App.data.animals || []).filter((a) => a.id !== animal.id).concat(animal);
    return animal;
  },
  getUsers() {
    return App.data.users || [];
  },
  deleteUser(id) {
    return apiRequest('DELETE', `/api/users/${Number(id)}`);
  },
  approveUser(id) {
    return apiRequest('POST', `/api/users/${Number(id)}/approve`, {});
  },
  rejectUser(id, reason = '') {
    return apiRequest('POST', `/api/users/${Number(id)}/reject`, { reason });
  },
  suspendUser(id, reason) {
    return apiRequest('POST', `/api/users/${Number(id)}/suspend`, { reason });
  },
  suspendAccount(id, reason) {
    return apiRequest('POST', `/api/users/${Number(id)}/suspend-account`, { reason });
  },
  reactivateAccount(id, reason) {
    return apiRequest('POST', `/api/users/${Number(id)}/reactivate`, { reason });
  },
  updateMyProfile(changes) {
    return apiRequest('PATCH', '/api/users/me', changes || {});
  },

  getAnimals() {
    return App.data.animals || [];
  },
  getAnimal(id) {
    return this.getAnimals().find((a) => a.id === Number(id)) || null;
  },
  createAnimal(animal) {
    return apiRequest('POST', '/api/animals', animal);
  },
  async updateAnimal(id, changes) {
    if (
      changes &&
      Object.keys(changes).length === 1 &&
      Object.prototype.hasOwnProperty.call(changes, 'views')
    ) {
      await apiRequest('POST', `/api/animals/${Number(id)}/view`, {});
      return this.getAnimal(id);
    }
    return apiRequest('PATCH', `/api/animals/${Number(id)}`, changes || {});
  },
  incrementAnimalView(id) {
    return apiRequest('POST', `/api/animals/${Number(id)}/view`, {});
  },
  deleteAnimal(id) {
    return apiRequest('DELETE', `/api/animals/${Number(id)}`);
  },
  changeAnimalAvailability(id, action, reason) {
    return apiRequest('POST', `/api/animals/${Number(id)}/${action}`, { reason, confirmed: true });
  },
  isAnimalAvailable(animal) {
    return Boolean(
      animal &&
      !animal.archivedAt &&
      animal.publicEligible !== false &&
      animal.approvalStatus === 'approved' &&
      animal.status === 'disponivel',
    );
  },
  animalPublicationLabel(animal) {
    return animal?.approvalStatus === 'approved'
      ? 'Anúncio aprovado'
      : animal?.approvalStatus === 'rejected'
        ? 'Anúncio reprovado'
        : 'Anúncio em análise';
  },
  animalDisplayStatus(animal) {
    if (animal?.archivedAt) return 'Anúncio arquivado';
    if (animal?.adoptionOrigin === 'external' && animal.status === 'adotado')
      return 'Adotado fora da plataforma';
    if (animal?.withdrawnAt && animal.status === 'indisponivel') return 'Retirado de adoção';
    if (
      animal?.publicEligible === false &&
      animal.approvalStatus === 'approved' &&
      animal.status !== 'indisponivel'
    )
      return 'Indisponível para novas solicitações';
    return animal?.approvalStatus === 'approved'
      ? ANIMAL_STATUS[animal.status] || 'Indisponível'
      : this.animalPublicationLabel(animal);
  },

  getRequests() {
    return App.data.requests || [];
  },
  requestAnimal(request) {
    const animal = this.getAnimal(request.animalId);
    if (
      !animal ||
      (request.ownerId !== undefined && Number(request.ownerId) !== Number(animal.ownerId)) ||
      (Number.isFinite(Date.parse(request.createdAt)) &&
        Number.isFinite(Date.parse(animal.createdAt)) &&
        Date.parse(request.createdAt) < Date.parse(animal.createdAt))
    )
      return null;
    return animal;
  },
  getPublicStories() {
    return App.data.stories || [];
  },
  createRequest(reqData) {
    return apiRequest('POST', '/api/requests', reqData);
  },
  analyzeRequest(id) {
    return apiRequest('POST', `/api/requests/${Number(id)}/analyze`, {});
  },
  approveRequest(id) {
    return apiRequest('POST', `/api/requests/${Number(id)}/approve`, {});
  },
  acceptRequest(id) {
    return this.approveRequest(id);
  },
  rejectRequest(id, reason = '') {
    return apiRequest('POST', `/api/requests/${Number(id)}/reject`, { reason });
  },
  handoverRequest(id) {
    return apiRequest('POST', '/api/requests/' + Number(id) + '/handover', { confirmed: true });
  },
  confirmReceipt(id) {
    return apiRequest('POST', '/api/requests/' + Number(id) + '/confirm-receipt', {
      confirmed: true,
    });
  },
  shareRequestContact(id, share) {
    return apiRequest('POST', '/api/requests/' + Number(id) + '/share-contact', { share });
  },
  sendRequestMessage(id, text, clientToken) {
    return apiRequest('POST', '/api/requests/' + Number(id) + '/message', { text, clientToken });
  },
  respondFollowup(id, response) {
    return apiRequest('POST', '/api/followups/' + Number(id) + '/respond', { response });
  },
  completeRequest(id) {
    return apiRequest('POST', `/api/requests/${Number(id)}/complete`, {});
  },
  cancelRequest(id, reason = '') {
    return apiRequest('POST', `/api/requests/${Number(id)}/cancel`, { reason });
  },
  advanceRequestStage(id, stage) {
    if (stage !== 'entrevista') throw new Error('Etapa inválida.');
    return apiRequest('POST', `/api/requests/${Number(id)}/interview`, {});
  },
  addAdoptionStory(id, story, publish = false, displayName = '') {
    return apiRequest('POST', `/api/requests/${Number(id)}/story`, { story, publish, displayName });
  },

  getFavorites() {
    return App.data.favorites || [];
  },
  async toggleFavorite(userId, animalId) {
    const result = await apiRequest('POST', '/api/favorites/toggle', {
      animalId: Number(animalId),
    });
    return Boolean(result?.favorite);
  },

  getMissing() {
    return App.data.missing || [];
  },
  getMissingById(id) {
    return this.getMissing().find((m) => m.id === Number(id)) || null;
  },
  createMissing(data) {
    return apiRequest('POST', '/api/missing', data);
  },
  updateMissing(id, changes) {
    return apiRequest('PATCH', `/api/missing/${Number(id)}`, changes || {});
  },
  moderateMissing(id, action, reason) {
    return apiRequest('POST', `/api/missing/${Number(id)}/${action}`, { reason });
  },
  isMissingPublic(record) {
    return Boolean(record && !record.hiddenAt);
  },

  getSightings() {
    return App.data.sightings || [];
  },
  createSighting(data) {
    return apiRequest('POST', '/api/sightings', data);
  },

  getReports() {
    return App.data.reports || [];
  },
  createReport(data) {
    return apiRequest('POST', '/api/reports', data);
  },
  sendContact(data) {
    return apiRequest('POST', '/api/contact', data);
  },
  resolveReport(id) {
    return apiRequest('POST', `/api/reports/${Number(id)}/resolve`, {});
  },

  getAdoptionProfile() {
    return App.data.profile || null;
  },
  saveAdoptionProfile(userId, answers) {
    return apiRequest('POST', '/api/adoption-profile', answers || {});
  },

  getNotifications() {
    return App.data.notifications || [];
  },
  markNotificationsRead(userId) {
    return apiRequest('POST', '/api/notifications/read', {});
  },

  getAdminLog() {
    return App.data.logs || [];
  },
  logAction(adminId, message) {
    return apiRequest('POST', '/api/admin-log', { message });
  },

  getPublicStats() {
    return App.data.stats || {};
  },
  getContract() {
    return App.data.contract || null;
  },
  acknowledgeContract(requestId) {
    return apiRequest('POST', `/api/contracts/${Number(requestId)}/acknowledge`, {
      confirmed: true,
    });
  },
  getFollowups() {
    return App.data.followups || [];
  },
  createFollowup(data) {
    return apiRequest('POST', '/api/followups', data);
  },
  getCampaigns() {
    return apiRequestAsync('GET', '/api/campaigns');
  },
  generateCampaignPix(id, amountCents, revision) {
    return apiRequestAsync('POST', '/api/campaigns/' + Number(id) + '/pix', {
      amountCents,
      revision,
    });
  },
  createCampaign(data) {
    return apiRequestAsync('POST', '/api/campaigns', data);
  },
  updateCampaign(id, data) {
    return apiRequestAsync('PATCH', '/api/campaigns/' + Number(id), data);
  },
  getSupportPoints() {
    return App.data.support || [];
  },
  createSupportPoint(data) {
    return apiRequest('POST', '/api/support-points', data);
  },
  deleteSupportPoint(id) {
    return apiRequest('DELETE', `/api/support-points/${Number(id)}`);
  },
};

const mutationResources = {
  deleteUser: ['users', 'animals'],
  approveUser: ['users', 'animals'],
  rejectUser: ['users', 'animals'],
  suspendUser: ['users', 'animals'],
  updateMyProfile: [],
  createAnimal: ['animals', 'limits'],
  updateAnimal: ['animals', 'animal', 'limits'],
  deleteAnimal: ['animals', 'requests', 'limits'],
  changeAnimalAvailability: ['animals', 'requests'],
  createRequest: ['requests'],
  analyzeRequest: ['requests'],
  approveRequest: ['requests', 'animals'],
  rejectRequest: ['requests', 'animals'],
  handoverRequest: ['requests'],
  confirmReceipt: ['requests'],
  shareRequestContact: ['requests'],
  sendRequestMessage: ['requests'],
  respondFollowup: ['followups'],
  completeRequest: ['requests', 'animals'],
  cancelRequest: ['requests', 'animals'],
  advanceRequestStage: ['requests'],
  addAdoptionStory: ['requests'],
  toggleFavorite: ['favorites'],
  createMissing: ['missing', 'limits'],
  updateMissing: ['missing', 'limits'],
  moderateMissing: ['missing'],
  createSighting: ['sightings'],
  createReport: ['reports'],
  sendContact: [],
  resolveReport: ['reports'],
  saveAdoptionProfile: ['profile'],
  markNotificationsRead: ['notifications'],
  logAction: ['logs'],
  acknowledgeContract: ['contract'],
  createFollowup: ['followups', 'limits'],
  createSupportPoint: ['support'],
  deleteSupportPoint: ['support'],
};
for (const [key, resources] of Object.entries(mutationResources)) {
  const original = Store[key];
  Store[key] = async function (...args) {
    const result = await original.apply(this, args);
    await App.refresh([...resources, 'unread']);
    return result;
  };
}

function computeCompatibility(profile, animal) {
  let earned = 0;
  let total = 0;
  const reasons = [];
  const warnings = [];

  total += 3;
  if (!profile.species || profile.species === 'qualquer') earned += 3;
  else if (profile.species === animal.species) {
    earned += 3;
    reasons.push('Espécie combina com sua preferência');
  } else
    warnings.push(
      `Você prefere ${profile.species === 'cachorro' ? 'cães' : 'gatos'}, e este animal é ${animal.species === 'cachorro' ? 'um cão' : 'um gato'}.`,
    );

  total += 2;
  if (!profile.size || profile.size === 'qualquer' || profile.size === animal.size) {
    earned += 2;
    if (profile.size && profile.size !== 'qualquer') reasons.push('Porte compatível');
  } else warnings.push('Porte diferente do que você prefere.');

  total += 2;
  if (!profile.age || profile.age === 'qualquer' || profile.age === animal.age_group) {
    earned += 2;
    if (profile.age && profile.age !== 'qualquer') reasons.push('Faixa etária compatível');
  } else warnings.push('Faixa etária diferente do que você prefere.');

  total += 3;
  const energyOrder = { baixo: 0, medio: 1, alto: 2 };
  if (
    profile.energy &&
    animal.energy_level &&
    profile.energy in energyOrder &&
    animal.energy_level in energyOrder
  ) {
    const diff = Math.abs(energyOrder[profile.energy] - energyOrder[animal.energy_level]);
    if (diff === 0) {
      earned += 3;
      reasons.push('Nível de energia compatível');
    } else if (diff === 1) earned += 1.5;
    else
      warnings.push(
        `${animal.name} possui nível de energia ${(ENERGY_LABEL[animal.energy_level] || animal.energy_level).toLowerCase()} e pode não combinar com o ritmo que você procura.`,
      );
  } else earned += 1.5;

  total += 2;
  if (profile.has_kids === 'sim' && animal.coexistence) {
    if (animal.coexistence.kids === 'sim') {
      earned += 2;
      reasons.push('Convive bem com crianças');
    } else if (animal.coexistence.kids === 'nao')
      warnings.push(`${animal.name} pode não se adaptar bem à convivência com crianças.`);
    else earned += 1;
  } else earned += 2;

  total += 2;
  if (profile.other_pets && profile.other_pets !== 'nao' && animal.coexistence) {
    const key =
      profile.other_pets === 'cachorro' ? 'dogs' : profile.other_pets === 'gato' ? 'cats' : null;
    if (key && animal.coexistence[key] === 'sim') {
      earned += 2;
      reasons.push('Pode viver com os outros animais que você já tem');
    } else if (key && animal.coexistence[key] === 'nao')
      warnings.push(`${animal.name} pode não se adaptar bem com outros animais em casa.`);
    else earned += 1;
  } else earned += 2;

  total += 2;
  if (
    profile.alone_time === 'mais_8h' &&
    (animal.energy_level === 'alto' || (animal.personality && animal.personality.sociability >= 4))
  ) {
    warnings.push(
      `${animal.name} é bastante sociável/ativo e pode sofrer ficando muito tempo sozinho.`,
    );
  } else {
    earned += 2;
    reasons.push('Pode viver em ambiente semelhante ao informado');
  }

  total += 2;
  if (
    profile.housing === 'apartamento' &&
    (animal.size === 'grande' || animal.energy_level === 'alto')
  ) {
    if (animal.size === 'grande')
      warnings.push(
        `${animal.name} é de porte grande — avalie se seu apartamento comporta o espaço necessário.`,
      );
    else earned += 1;
  } else {
    earned += 2;
    reasons.push('Ambiente de moradia adequado ao perfil do animal');
  }

  const score = Math.round((earned / total) * 100);
  const conflicts = [],
    uncertainties = [];
  if (profile.has_kids === 'sim') {
    if (animal.coexistence?.kids === 'nao')
      conflicts.push('Conflito importante: este animal não é indicado para uma casa com crianças.');
    else if (animal.coexistence?.kids !== 'sim')
      uncertainties.push(
        'A convivência com crianças não foi informada. Confirme com o responsável antes de decidir.',
      );
  }
  if (profile.other_pets && profile.other_pets !== 'nao') {
    const key = { cachorro: 'dogs', gato: 'cats' }[profile.other_pets];
    if (key && animal.coexistence?.[key] === 'nao')
      conflicts.push(
        'Conflito importante: a convivência com os animais que você já tem foi indicada como incompatível.',
      );
    else if (!key || animal.coexistence?.[key] !== 'sim')
      uncertainties.push(
        'A convivência com os seus outros animais precisa ser confirmada pelo responsável.',
      );
  }
  return {
    score: conflicts.length || uncertainties.length ? null : Math.max(0, Math.min(100, score)),
    reasons,
    warnings,
    conflicts,
    uncertainties,
    eligible: conflicts.length === 0,
    needsReview: uncertainties.length > 0,
  };
}

// Mantido por compatibilidade com as páginas antigas. O seed agora é feito pelo servidor.
function seedDatabase() {}

// Delegated handlers also support buttons rendered dynamically, without inline scripts.
const clickActions = {
  'handleToggleFavorite': async (...args) => await handleToggleFavorite(...args),
  'approveAnimal': (...args) => approveAnimal(...args),
  'rejectAnimal': (...args) => rejectAnimal(...args),
  'toggleVerified': (...args) => toggleVerified(...args),
  'toggleFeatured': (...args) => toggleFeatured(...args),
  'approveOrganization': (...args) => approveOrganization(...args),
  'rejectOrganization': (...args) => rejectOrganization(...args),
  'suspendOrganization': (...args) => suspendOrganization(...args),
  'suspendAccount': (...args) => suspendAccount(...args),
  'reactivateAccount': (...args) => reactivateAccount(...args),
  'reviewAnimal': (...args) => reviewAnimal(...args),
  'withdrawAnimal': async (...args) => await withdrawAnimal(...args),
  'externalAdoption': async (...args) => await externalAdoption(...args),
  'removeUser': (...args) => removeUser(...args),
  'handleResolveReport': (...args) => handleResolveReport(...args),
  'removeSupportPoint': (...args) => removeSupportPoint(...args),
  'setActivePhoto': (...args) => setActivePhoto(...args),
  'shareMissing': (...args) => shareMissing(...args),
  'editStory': (...args) => editStory(...args),
  'showStoryForm': (...args) => showStoryForm(...args),
  'showFollowupForm': (...args) => showFollowupForm(...args),
  'cancelMyRequest': async (...args) => await cancelMyRequest(...args),
  'submitFollowup': async (...args) => await submitFollowup(...args),
  'submitStory': async (...args) => await submitStory(...args),
  'removeAnimal': async (...args) => await removeAnimal(...args),
  'openProfile': (...args) => openProfile(...args),
  'analyzeRequest': async (...args) => await analyzeRequest(...args),
  'approveRequest': async (...args) => await approveRequest(...args),
  'openReject': (...args) => openReject(...args),
  'markInterview': async (...args) => await markInterview(...args),
  'completeRequest': async (...args) => await completeRequest(...args),
  'handoverRequest': async (...args) => await handoverRequest(...args),
  'confirmReceipt': async (...args) => await confirmReceipt(...args),
  'print': () => window.print(),
  'close-profile-dialog': () => document.getElementById('profile-dialog').close(),
};
document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target || !Object.prototype.hasOwnProperty.call(clickActions, target.dataset.action)) return;
  const args = [];
  for (let i = 0; target.hasAttribute('data-arg-' + i); i++) {
    const value = Number(target.getAttribute('data-arg-' + i));
    if (!Number.isFinite(value)) return;
    args.push(value);
  }
  await App.action(target, () => clickActions[target.dataset.action](...args));
});

// Existing records can contain obsolete/broken photo references.
document.addEventListener(
  'error',
  (event) => {
    const img = event.target;
    if (
      img instanceof HTMLImageElement &&
      !img.closest('#qr-code, #donation-qr') &&
      !img.dataset.photoFallback
    ) {
      img.dataset.photoFallback = '1';
      const placeholder = document.createElement('span');
      placeholder.className = 'no-photo';
      placeholder.textContent = 'Foto indisponível';
      img.replaceWith(placeholder);
    }
  },
  true,
);
