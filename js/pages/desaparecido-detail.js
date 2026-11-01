function renderMissingDetail() {
  const id = getParam('id');
  const animal = Store.getMissingById(id);
  const container = document.getElementById('detail-container');
  if (!animal) {
    container.innerHTML = '<div class="empty-state"><h3>Registro não encontrado</h3></div>';
    return;
  }

  const user = Auth.getCurrentUser();
  const canManage = Boolean(user && (user.role === 'admin' || Number(animal.ownerId) === user.id));
  const photo = safeImageSrc(animal.photo);
  setRecordMetadata(
    `${animal.name || 'Animal desaparecido'} · PotyPet`,
    `${animal.name || 'Animal'} ${animal.found ? 'encontrado' : 'desaparecido'} em ${animal.city || 'nossa região'}. Veja as informações no PotyPet.`,
    photo,
  );
  let sightings = [];
  if (canManage) {
    try {
      sightings = Store.getSightings().filter((s) => s.missingAnimalId === animal.id);
    } catch {
      sightings = [];
    }
  }

  const statusBanner = animal.hiddenAt
    ? `<div class="alert alert-error"><b>Registro oculto pela administração.</b><p style="white-space:pre-wrap;color:inherit;">${escapeHTML(animal.hiddenReason || '')}</p><p style="color:inherit;">Correções do responsável não republicam automaticamente o anúncio; solicite nova revisão pelo contato.</p></div>`
    : animal.found
      ? '<div class="alert alert-success" style="margin-bottom:24px;"><b>Este animal foi marcado como encontrado.</b></div>'
      : '<div class="missing-banner" style="border-radius:12px;margin-bottom:24px;">ESTE ANIMAL ESTÁ DESAPARECIDO</div>';

  const ownerTools =
    canManage && !user.historicalAccess
      ? `
    <div class="form-card" style="padding:18px;margin:18px 0;">
      <h3 style="font-size:1rem;margin-top:0;">Gerenciar registro</h3>
      <a class="btn btn-outline btn-sm" href="cadastrar-desaparecido.html?id=${Number(animal.id)}">Corrigir informações</a>
      ${user.role === 'admin' ? `<button class="btn btn-danger-soft btn-sm" id="btn-moderate-missing">${animal.hiddenAt ? 'Restaurar publicação' : 'Ocultar publicação'}</button>` : ''}
      <button class="btn ${animal.found ? 'btn-outline' : 'btn-primary'} btn-sm" id="btn-toggle-found">
        ${animal.found ? 'Marcar como desaparecido novamente' : 'Marcar como encontrado'}
      </button>
    </div>
    <div class="form-card" style="padding:18px;margin:18px 0;">
      <h3 style="font-size:1rem;margin-top:0;">Avistamentos recebidos (${sightings.length})</h3>
      ${
        sightings.length
          ? sightings
              .map(
                (s) => `
        <div style="padding:10px 0;border-bottom:1px solid var(--color-border);font-size:.9rem;">
          <b>${escapeHTML(s.location)}</b> · ${new Date(s.createdAt).toLocaleString('pt-BR')}<br>
          ${s.reporter_name ? `Informado por ${escapeHTML(s.reporter_name)}${s.reporter_contact ? ` — contato: ${escapeHTML(s.reporter_contact)}` : ''}<br>` : ''}
          ${s.message ? escapeHTML(s.message) : '<i>Sem detalhes adicionais.</i>'}
        </div>`,
              )
              .join('')
          : '<p>Nenhum avistamento informado até agora.</p>'
      }
    </div>`
      : '';

  container.innerHTML = `
    ${statusBanner}
    <div class="animal-detail">
      <div class="gallery-main">
        ${photo ? `<img src="${escapeAttr(photo)}" alt="${escapeAttr(animal.name || 'Animal desaparecido')}" style="width:100%;height:100%;object-fit:cover;">` : '<div class="no-photo">Sem foto</div>'}
      </div>
      <div>
        <h1>${escapeHTML(animal.name || 'Animal sem nome identificado')}</h1>
        <div class="info-list">
          <div class="info-item"><span>Espécie</span><b>${escapeHTML(animal.species || '-')}</b></div>
          <div class="info-item"><span>Raça</span><b>${escapeHTML(animal.breed || 'Não informado')}</b></div>
          <div class="info-item"><span>Cor</span><b>${escapeHTML(animal.color || '-')}</b></div>
          <div class="info-item"><span>Idade aproximada</span><b>${escapeHTML(animal.approx_age || '-')}</b></div>
          <div class="info-item"><span>Desapareceu em</span><b>${animal.missing_date ? new Date(animal.missing_date + 'T12:00:00').toLocaleDateString('pt-BR') : '-'}</b></div>
          <div class="info-item"><span>Última vez visto</span><b>${escapeHTML(animal.last_seen_location || '-')}</b></div>
          <div class="info-item"><span>Cidade</span><b>${escapeHTML(animal.city)}/${escapeHTML(animal.state)}</b></div>
          <div class="info-item"><span>Contato</span><b>${escapeHTML(animal.contact || '-')}</b></div>
        </div>
        ${animal.features ? `<p><b>Características:</b> ${escapeHTML(animal.features)}</p>` : ''}
        ${animal.reward ? `<p><b>Recompensa oferecida:</b> ${escapeHTML(animal.reward)}</p>` : ''}
        <div style="display:flex;gap:12px;margin:16px 0;flex-wrap:wrap;"><button class="btn btn-outline" data-action="shareMissing">Compartilhar</button><button class="btn btn-outline" id="btn-report-missing">Denunciar registro</button></div><div id="missing-report-area"></div>
        ${ownerTools}
        <div id="sighting-area">
          ${
            animal.found || animal.hiddenAt
              ? '<div class="alert">Novos avistamentos estão desativados para este registro.</div>'
              : `
          <form class="form-card" style="padding:24px;margin:0;" id="sighting-form">
            <h3 style="font-size:1.05rem;">Informar um avistamento</h3>
            <div id="sighting-alert"></div>
            <div class="form-field"><label for="s-name">Seu nome (opcional)</label><input id="s-name"></div>
            <div class="form-field"><label for="s-contact">Seu contato (opcional)</label><input id="s-contact"></div>
            <div class="form-field"><label for="s-location">Local onde viu o animal</label><input id="s-location" required></div>
            <div class="form-field"><label for="s-message">Detalhes</label><textarea rows="3" id="s-message"></textarea></div>
            <button class="btn btn-primary" type="submit">Enviar avistamento</button>
          </form>`
          }
        </div>
      </div>
    </div>`;

  document.getElementById('btn-toggle-found')?.addEventListener('click', async () => {
    try {
      await Store.updateMissing(animal.id, { found: !animal.found });
      renderMissingDetail();
    } catch (err) {
      showToast(err.message);
    }
  });
  document.getElementById('btn-moderate-missing')?.addEventListener('click', async () => {
    const reason = prompt('Justificativa da decisão (obrigatória, até 1000 caracteres):');
    if (reason === null) return;
    try {
      await Store.moderateMissing(animal.id, animal.hiddenAt ? 'restore' : 'hide', reason);
      renderMissingDetail();
      showToast('Decisão registrada; responsável avisado.');
    } catch (err) {
      showToast(err.message);
    }
  });
  document.getElementById('btn-report-missing')?.addEventListener('click', () => {
    const area = document.getElementById('missing-report-area');
    area.innerHTML = `<form class="form-card" id="missing-report-form" style="margin:0;padding:18px;"><h3>Denunciar desaparecido</h3><div id="missing-report-alert"></div><div class="form-field"><label for="missing-report-category">Motivo</label><select id="missing-report-category">${Object.entries(
      REPORT_CATEGORY_LABEL,
    )
      .filter(([key]) => key !== 'atendimento')
      .map(([key, label]) => `<option value="${key}">${escapeHTML(label)}</option>`)
      .join(
        '',
      )}</select></div><div class="form-field"><label for="missing-report-reason">Detalhes (até 3000 caracteres)</label><textarea required maxlength="3000" id="missing-report-reason" rows="3"></textarea></div><button type="submit" class="btn btn-primary btn-sm">Enviar denúncia</button></form>`;
    document.getElementById('missing-report-form').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await Store.createReport({
          target_type: 'missing',
          target_id: animal.id,
          category: document.getElementById('missing-report-category').value,
          reason: document.getElementById('missing-report-reason').value,
        });
        area.innerHTML =
          '<div class="alert alert-success">Denúncia registrada para análise administrativa.</div>';
      } catch (err) {
        document.getElementById('missing-report-alert').innerHTML =
          `<div class="alert alert-error">${escapeHTML(err.message)}</div>`;
      }
    };
  });

  let sightingToken = crypto.randomUUID(),
    previousSighting = '';
  document.getElementById('sighting-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const alert = document.getElementById('sighting-alert'),
      button = e.target.querySelector('button[type=submit]');
    if (button.disabled) return;
    button.disabled = true;
    try {
      const payload = {
        missingAnimalId: animal.id,
        reporter_name: document.getElementById('s-name').value,
        reporter_contact: document.getElementById('s-contact').value,
        location: document.getElementById('s-location').value,
        message: document.getElementById('s-message').value,
      };
      const serialized = JSON.stringify(payload);
      if (previousSighting && previousSighting !== serialized) sightingToken = crypto.randomUUID();
      previousSighting = serialized;
      await Store.createSighting({ ...payload, clientToken: sightingToken });
      document.getElementById('sighting-area').innerHTML =
        '<div class="alert alert-success">Obrigado! O avistamento foi registrado e o responsável poderá visualizá-lo.</div>';
    } catch (err) {
      alert.innerHTML = `<div class="alert alert-error">${escapeHTML(err.message)}</div>`;
      button.disabled = false;
    }
  });
}

function shareMissing() {
  const url = window.location.href;
  if (navigator.share) navigator.share({ title: 'Animal desaparecido', url }).catch(() => {});
  else if (navigator.clipboard)
    navigator.clipboard.writeText(url).then(() => showToast('Link copiado para compartilhar!'));
}

App.ready(renderMissingDetail);
