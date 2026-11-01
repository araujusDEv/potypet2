let currentAnimalPhotos = [];
let currentAnimalName = '';

async function renderAnimalDetail(trackView = true) {
  const id = getParam('id');
  const animal = Store.getAnimal(id);
  const container = document.getElementById('animal-container');
  if (!animal) {
    container.innerHTML = '<div class="empty-state"><h3>Animal não encontrado</h3></div>';
    return;
  }

  if (trackView && !Auth.getCurrentUser()?.historicalAccess) {
    try {
      await Store.incrementAnimalView(animal.id);
    } catch {
      /* visualização não deve impedir a página de abrir */
    }
  }

  const owner = Store.getAnimalOwnerName(animal.id);
  const photos = Array.isArray(animal.photos)
    ? animal.photos.map(safeImageSrc).filter(Boolean)
    : [];
  setRecordMetadata(
    `${animal.name} · PotyPet`,
    `${animal.name} em ${animal.city}. ${animal.description || 'Conheça este animal no PotyPet.'}`,
    animal.previewImage || photos[0],
  );
  currentAnimalPhotos = photos;
  currentAnimalName = animal.name || 'Animal';
  const ageLabel =
    { filhote: 'Filhote', adulto: 'Adulto', idoso: 'Idoso' }[animal.age_group] ||
    animal.age_group ||
    'Não informado';
  const naoInformado = (v) =>
    v === undefined || v === null || v === '' ? '<i>Não informado</i>' : escapeHTML(v);

  const user = Auth.getCurrentUser();
  const isFav = user
    ? Store.getFavorites().some((f) => f.userId === user.id && f.animalId === animal.id)
    : false;
  const available = Store.isAnimalAvailable(animal);
  const isOwner = user && Number(animal.ownerId) === Number(user.id);

  const PERSONALITY_LABELS = {
    energy: 'Energia',
    sociability: 'Sociabilidade',
    affection: 'Carinho',
    independence: 'Independência',
    playful: 'Brincalhão',
    calm: 'Tranquilidade',
  };
  const personalityHTML = animal.personality
    ? `<div class="personality-grid">${Object.entries(PERSONALITY_LABELS)
        .map(([key, label]) => {
          const score = Math.max(0, Math.min(5, Number(animal.personality[key]) || 0));
          return `<div class="personality-row"><span>${label}</span><div class="personality-bar"><div class="personality-bar-fill" style="width:${score * 20}%"></div></div></div>`;
        })
        .join('')}</div>`
    : '<p><i>Não informado.</i></p>';

  const coexistenceHTML = animal.coexistence
    ? `<div class="info-list">
        <div class="info-item"><span>Crianças</span><b>${escapeHTML(COEXISTENCE_LABEL[animal.coexistence.kids] || 'Não informado')}</b></div>
        <div class="info-item"><span>Cães</span><b>${escapeHTML(COEXISTENCE_LABEL[animal.coexistence.dogs] || 'Não informado')}</b></div>
        <div class="info-item"><span>Gatos</span><b>${escapeHTML(COEXISTENCE_LABEL[animal.coexistence.cats] || 'Não informado')}</b></div>
      </div>`
    : '<p><i>Não informado.</i></p>';

  container.innerHTML = `
    <div class="animal-detail">
      <div>
        <div id="profile-gallery" class="gallery-main" style="position:relative;">
          ${photos[0] ? `<img src="${escapeAttr(photos[0])}" alt="${escapeAttr(animal.name)}" style="width:100%;height:100%;object-fit:cover;">` : '<div class="no-photo">Sem foto</div>'}
          ${favoriteButtonHTML(animal.id, isFav)}
        </div>
        ${photos.length > 1 ? '<div class="gallery-thumbs" id="gallery-controls" aria-label="Fotos do animal">' + photos.map((p, i) => '<button type="button" class="gallery-thumb ' + (i === 0 ? 'active' : '') + '" aria-label="Ver foto ' + (i + 1) + ' de ' + photos.length + '" aria-pressed="' + (i === 0) + '" data-action="setActivePhoto" data-arg-0="' + i + '"><img src="' + escapeAttr(safeImageSrc(animal.thumbnails?.[i]) || p) + '" alt="" loading="lazy" decoding="async"></button>').join('') + '</div>' : ''}<p id="gallery-announcement" class="sr-only" role="status"></p>
      </div>
      <div>
        <span class="eyebrow">${animal.species === 'cachorro' ? 'Cão' : 'Gato'} · ${escapeHTML(animal.city)}/${escapeHTML(animal.state)}${animal.neighborhood ? ' — ' + escapeHTML(animal.neighborhood) : ''}</span>
        <h1>${escapeHTML(animal.name)} ${animal.verified ? '<span class="tag" title="Revisão administrativa registrada; não certifica autenticidade ou saúde">' + svgIcon('shield-check') + ' Anúncio verificado</span>' : ''} ${available && animal.featured ? '<span class="tag">' + svgIcon('star') + ' Destaque</span>' : ''}</h1>
        ${animal.verified ? '<p class="request-policy">Verificado indica revisão administrativa registrada. Não é certificação de autenticidade, saúde ou comportamento. A correspondência da foto com o animal exige conferência humana; o sistema não comprova autenticidade nem detecta imagens de IA.</p>' : ''}
        <div class="tag-row">
          <span class="tag">${animal.sex === 'macho' ? 'Macho' : 'Fêmea'}</span>
          <span class="tag">${escapeHTML(ageLabel)}</span>
          <span class="tag">Porte ${escapeHTML(animal.size || 'não informado')}</span>
          <span class="tag" id="animal-public-status">${escapeHTML(Store.animalDisplayStatus(animal))}</span>
        </div>
        ${animalPriorityReasons(animal)
          .map((reason) => '<span class="tag tag-attention">' + escapeHTML(reason) + '</span>')
          .join('')}
        <p>${escapeHTML(animal.description || '')}</p>
        <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
          <a href="cartaz.html?id=${Number(animal.id)}" class="btn btn-outline btn-sm" target="_blank" rel="noopener">Gerar cartaz / QR Code</a>
          <button class="btn btn-outline btn-sm" id="btn-share-profile">Compartilhar</button>
        </div>

        ${available && !isOwner && !user?.historicalAccess ? '<button class="btn btn-primary" id="btn-interest-top">Tenho Interesse</button>' : ''}
        <h3 style="font-size:1.05rem;margin-top:22px;">Informações básicas</h3>
        <div class="info-list">
          <div class="info-item"><span>Raça</span><b>${naoInformado(animal.breed)}</b></div>
          <div class="info-item"><span>Responsável</span><b>${escapeHTML(owner ? owner.name : 'PotyPet')}</b></div>
        </div>

        <h3 style="font-size:1.05rem;margin-top:22px;">Saúde</h3>
        <div class="info-list">
          <div class="info-item"><span>Vacinado</span><b>${animal.vaccinated ? 'Sim' : 'Não'}</b></div>
          <div class="info-item"><span>Vermifugado</span><b>${animal.dewormed ? 'Sim' : 'Não'}</b></div>
          <div class="info-item"><span>Castrado</span><b>${animal.neutered ? 'Sim' : 'Não'}</b></div>
          <div class="info-item"><span>Necessidades especiais</span><b>${naoInformado(animal.special_needs)}</b></div>
        </div>
        ${animal.health_notes ? `<p style="font-size:.9rem;">${escapeHTML(animal.health_notes)}</p>` : ''}

        <h3 style="font-size:1.05rem;margin-top:22px;">Personalidade</h3>${personalityHTML}
        <h3 style="font-size:1.05rem;margin-top:22px;">Convivência</h3>${coexistenceHTML}
        ${animal.history ? `<h3 style="font-size:1.05rem;margin-top:22px;">História</h3><p>${escapeHTML(animal.history)}</p>` : ''}

        ${(isOwner || user?.role === 'admin') && animal.moderationHistory?.length ? `<details style="margin:16px 0;"><summary>Histórico de revisão do anúncio</summary>${animal.moderationHistory.map((item) => `<p style="white-space:pre-wrap;overflow-wrap:anywhere;"><b>${escapeHTML(item.actorName || 'Administração')}</b> · ${new Date(item.at).toLocaleString('pt-BR')} · ${escapeHTML({ approved: 'Aprovado', pending: 'Em análise', rejected: 'Reprovado' }[item.status] || item.status)}<br>${escapeHTML(item.reason)}${item.criteria?.exception ? `<br><b>Exceção à regra mínima:</b> ${escapeHTML(item.criteria.exception.reason)}<br>${escapeHTML(item.criteria.failed.join(' '))}` : ''}</p>`).join('')}</details>` : ''}
        <div id="interest-area" tabindex="-1">
          ${
            user?.historicalAccess
              ? '<div class="alert">Sua conta está em acesso restrito ao histórico. Novas solicitações estão bloqueadas.</div>'
              : isOwner
                ? '<div class="alert">Você é o responsável por este anúncio. Acompanhe os interessados no seu painel.</div>'
                : available
                  ? '<button class="btn btn-primary" id="btn-interesse">Tenho Interesse</button>'
                  : `<div class="alert alert-error">${escapeHTML(Store.animalDisplayStatus(animal))}. Novas solicitações de adoção estão indisponíveis.</div>`
          }
        </div>
        <div style="margin-top:18px;" id="report-area">
          <button class="btn btn-outline btn-sm" id="btn-open-report" style="color:var(--color-danger);border-color:var(--color-danger);">Denunciar este anúncio</button>
        </div>
      </div>
    </div>`;

  document.body.classList.toggle('has-profile-actions', true);
  container.insertAdjacentHTML(
    'beforeend',
    '<div class="profile-mobile-actions">' +
      (isOwner
        ? '<a class="btn btn-primary" href="painel-doador.html?tab=solicitacoes">Meus interessados</a>'
        : available && !user?.historicalAccess
          ? '<button type="button" class="btn btn-primary" id="btn-interest-mobile">Tenho Interesse</button>'
          : '<span>' + escapeHTML(Store.animalDisplayStatus(animal)) + '</span>') +
      '<a class="btn btn-outline" href="#profile-gallery">Fotos</a></div>',
  );
  for (const id of ['btn-interest-top', 'btn-interest-mobile'])
    document.getElementById(id)?.addEventListener('click', () => {
      showInterestForm(animal);
      document
        .getElementById('interest-area')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      document
        .getElementById('interest-form')
        ?.querySelector('input')
        ?.focus({ preventScroll: true });
    });
  document.getElementById('gallery-controls')?.addEventListener('keydown', (event) => {
    const current = Number(event.target.closest('button')?.getAttribute('data-arg-0'));
    let next = current;
    if (event.key === 'ArrowRight') next = (current + 1) % photos.length;
    else if (event.key === 'ArrowLeft') next = (current + photos.length - 1) % photos.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = photos.length - 1;
    else return;
    event.preventDefault();
    setActivePhoto(next);
    document.querySelectorAll('.gallery-thumb')[next]?.focus();
  });
  if (available)
    document
      .getElementById('btn-interesse')
      ?.addEventListener('click', async () => await showInterestForm(animal));

  document.getElementById('btn-open-report')?.addEventListener('click', () => {
    const area = document.getElementById('report-area');
    area.innerHTML = `
      <form class="form-card" style="padding:18px;margin:0;" id="report-form">
        <div class="form-field"><label for="rp-category">Motivo da denúncia</label><select id="rp-category">
          ${Object.entries(REPORT_CATEGORY_LABEL)
            .filter(([key]) => key !== 'atendimento')
            .map(([k, v]) => `<option value="${escapeAttr(k)}">${escapeHTML(v)}</option>`)
            .join('')}
        </select></div>
        <div class="form-field"><label for="rp-details">Detalhes</label><textarea rows="2" id="rp-details" required></textarea></div>
        <button class="btn btn-danger btn-sm" type="submit">Enviar denúncia</button>
      </form>`;
    document.getElementById('report-form').addEventListener(
      'submit',
      App.form(async (e) => {
        e.preventDefault();
        try {
          await Store.createReport({
            target_type: 'animal',
            target_id: animal.id,
            category: document.getElementById('rp-category').value,
            reason: `[${animal.name}] ${document.getElementById('rp-details').value}`,
          });
          area.innerHTML =
            '<div class="alert alert-success">Denúncia enviada. Nossa equipe vai analisar.</div>';
        } catch (err) {
          area.insertAdjacentHTML(
            'afterbegin',
            `<div class="alert alert-error">${escapeHTML(err.message)}</div>`,
          );
        }
      }),
    );
  });

  document.getElementById('btn-share-profile')?.addEventListener('click', async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Conheça ${animal.name}`,
          text: available
            ? `${animal.name} está disponível para adoção no PotyPet.`
            : `Conheça o perfil de ${animal.name} no PotyPet.`,
          url,
        });
      } catch {}
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      showToast('Link copiado para a área de transferência!');
    }
  });
}

function setActivePhoto(index) {
  const src = currentAnimalPhotos[Number(index)];
  if (!src) return;
  const gallery = document.getElementById('profile-gallery');
  let img = gallery?.querySelector('img');
  if (!img && gallery) {
    img = document.createElement('img');
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
    gallery.prepend(img);
  }
  if (img) {
    img.src = src;
    img.alt = currentAnimalName;
  }
  document.getElementById('gallery-announcement').textContent =
    'Foto ' +
    (Number(index) + 1) +
    ' de ' +
    currentAnimalPhotos.length +
    ' de ' +
    currentAnimalName;
  document
    .querySelectorAll('.gallery-thumb')
    .forEach(
      (thumb, i) => (
        thumb.classList.toggle('active', i === Number(index)),
        thumb.setAttribute('aria-pressed', String(i === Number(index)))
      ),
    );
}

async function showInterestForm(animal) {
  const user = Auth.getCurrentUser();
  const area = document.getElementById('interest-area');
  if (
    !Store.isAnimalAvailable(animal) ||
    user?.historicalAccess ||
    (user && Number(animal.ownerId) === Number(user.id))
  ) {
    await renderAnimalDetail(false);
    return;
  }
  if (!user) {
    window.location.href = Auth.loginUrl('animal.html?id=' + Number(animal.id));
    return;
  }
  let submissionToken = crypto.randomUUID(),
    previousPayload = '';
  area.innerHTML = `
    <form class="form-card" style="padding:24px;margin:20px 0 0;" id="interest-form">
      <h3 style="font-size:1.1rem;">Formulário de interesse</h3>
      <div id="interest-alert"></div>
      <div class="form-row">
        <div class="form-field"><label for="i-name">Nome completo</label><input required maxlength="120" id="i-name" value="${escapeAttr(user.name)}"></div>
        <div class="form-field"><label for="i-age">Idade</label><input type="number" min="18" max="120" id="i-age"></div>
      </div>
      <div class="form-field"><label for="i-city">Cidade onde mora</label><input maxlength="120" id="i-city" value="${escapeAttr(user.city || '')}" required></div>
      <div class="form-field"><label for="i-housing">Tipo de moradia</label><select id="i-housing" required><option value="">Selecione</option>
        <option value="casa">Casa</option><option value="apartamento">Apartamento</option><option value="sitio">Sítio / Chácara</option>
      </select></div>
      <div class="form-field"><label for="i-yard">Possui quintal?</label><select id="i-yard" required><option value="">Selecione</option><option value="sim">Sim</option><option value="nao">Não</option></select></div>
      <div class="form-field"><label for="i-pets">Possui outros animais?</label><select id="i-pets" required><option value="">Selecione</option><option value="sim">Sim</option><option value="nao">Não</option></select></div>
      <div class="form-field"><label for="i-reason">Motivo da adoção</label><textarea rows="3" maxlength="2000" id="i-reason" required></textarea></div>

      <h3 style="font-size:1.05rem;margin-top:22px;">Questionário de adoção responsável</h3>
      <div class="form-field"><label for="q-agree">Todos os moradores concordam com a adoção?</label><select id="q-agree" required><option value="">Selecione</option><option value="sim">Sim</option><option value="nao">Não</option></select></div>
      <div class="form-field"><label for="q-financial">Possui condições financeiras para alimentação e cuidados veterinários?</label><select id="q-financial" required><option value="">Selecione</option><option value="sim">Sim</option><option value="nao">Não</option></select></div>
      <div class="form-field"><label for="q-alone">O animal ficará sozinho por quanto tempo, em média?</label><select id="q-alone" required><option value="">Selecione</option>
        <option value="menos_2h">Menos de 2 horas</option><option value="2_4h">2 a 4 horas</option><option value="4_8h">4 a 8 horas</option><option value="mais_8h">Mais de 8 horas</option>
      </select></div>
      <div class="form-field"><label for="q-had-pets">Já teve animais anteriormente?</label><select id="q-had-pets" required><option value="">Selecione</option><option value="sim">Sim</option><option value="nao">Não</option></select></div>
      <div class="form-field"><label for="q-vet">Está disposto(a) a manter vacinação e acompanhamento veterinário?</label><select id="q-vet" required><option value="">Selecione</option><option value="sim">Sim</option><option value="nao">Não</option></select></div>
      <div class="form-field"><label for="q-adaptation">O que fará caso tenha dificuldades de adaptação?</label><textarea rows="2" maxlength="1000" id="q-adaptation" required></textarea></div>
      <div class="checkbox-row" style="align-items:flex-start;margin:14px 0;"><input type="checkbox" id="q-declaration" required style="margin-top:4px;"><label for="q-declaration">Declaro estar ciente de que a adoção é um compromisso de longo prazo e que o animal não deve ser abandonado.</label></div>
      <label class="checkbox-row"><input type="checkbox" id="i-contact-consent"> Autorizo compartilhar meu e-mail e telefone com o responsável deste pedido. Opcional: também posso conversar pela área privada.</label>
      <p class="request-policy">Após enviar, o responsável analisa seu interesse. A aprovação, a entrega, a conclusão e a confirmação do termo são etapas distintas. Seu formulário fica na área autenticada.</p>
      <button class="btn btn-primary" type="submit">Enviar solicitação</button>
    </form>`;

  document.getElementById('interest-form').addEventListener(
    'submit',
    App.form(async (e) => {
      e.preventDefault();
      const alert = document.getElementById('interest-alert');
      if (!document.getElementById('q-declaration').checked) {
        alert.innerHTML =
          '<div class="alert alert-error">Confirme a declaração de compromisso.</div>';
        return;
      }
      const button = e.target.querySelector('button[type="submit"]');
      if (button.disabled) return;
      button.disabled = true;
      try {
        const payload = {
          animalId: animal.id,
          full_name: document.getElementById('i-name').value,
          age: document.getElementById('i-age').value,
          city: document.getElementById('i-city').value,
          housing: document.getElementById('i-housing').value,
          has_yard: document.getElementById('i-yard').value === 'sim',
          has_pets: document.getElementById('i-pets').value === 'sim',
          experience: document.getElementById('q-had-pets').value === 'sim',
          reason: document.getElementById('i-reason').value,
          responsibility_confirmed: true,
          contactConsent: document.getElementById('i-contact-consent').checked,
          questionnaire: {
            household_agrees: document.getElementById('q-agree').value,
            financial_conditions: document.getElementById('q-financial').value,
            alone_time: document.getElementById('q-alone').value,
            had_pets_before: document.getElementById('q-had-pets').value,
            vet_commitment: document.getElementById('q-vet').value,
            adaptation_plan: document.getElementById('q-adaptation').value,
          },
        };
        const serialized = JSON.stringify(payload);
        if (previousPayload && serialized !== previousPayload)
          submissionToken = crypto.randomUUID();
        previousPayload = serialized;
        await Store.createRequest({ ...payload, clientToken: submissionToken });
        area.innerHTML =
          '<div class="alert alert-success">Solicitação enviada! Acompanhe em <a href="minhas-solicitacoes.html">Minhas Solicitações</a>.</div>';
      } catch (err) {
        alert.innerHTML = `<div class="alert alert-error">${escapeHTML(err.message)}</div>`;
        button.disabled = false;
      }
    }),
  );
}

App.ready(async () => await renderAnimalDetail(true));
