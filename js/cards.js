// Cartão de animal e botão de favoritar, usados nas listas de adoção.
function favoriteButtonHTML(animalId, isFavorite) {
  if (typeof Auth !== 'undefined' && Auth.getCurrentUser()?.historicalAccess) return '';
  return `<button type="button" class="fav-btn ${isFavorite ? 'is-favorite' : ''}" data-action="handleToggleFavorite" data-arg-0="${Number(animalId)}" aria-label="${isFavorite ? 'Remover dos favoritos' : 'Favoritar'}" aria-pressed="${Boolean(isFavorite)}">${svgIcon('heart')}</button>`;
}

function animalCardHTML(animal, isFavorite) {
  const cover = safeImageSrc(animal.photos && animal.photos[0]);
  const ageLabel =
    { filhote: 'Filhote', adulto: 'Adulto', idoso: 'Idoso' }[animal.age_group] ||
    animal.age_group ||
    '';
  const sizeLabel =
    { pequeno: 'Pequeno', medio: 'Médio', grande: 'Grande' }[animal.size] || animal.size || '';
  const priorities = animalPriorityReasons(animal);
  return `
    <div class="card animal-card">
      <div class="animal-photo">
        ${cover ? `<img src="${escapeAttr(cover)}" alt="${escapeAttr(animal.name)}" loading="lazy" decoding="async" width="480" height="360">` : '<div class="no-photo">Sem foto</div>'}
        <span class="badge">${animal.species === 'cachorro' ? 'Cão' : 'Gato'}</span>
        ${animal.featured ? '<span class="badge badge-featured">' + svgIcon('star') + ' Destaque</span>' : ''}
        ${favoriteButtonHTML(animal.id, isFavorite)}
      </div>
      <div class="animal-body">
        <h3>${escapeHTML(animal.name)}</h3>${animal.verified ? '<span class="verified-seal" title="Revisão administrativa registrada; não certifica autenticidade ou saúde">' + svgIcon('shield-check') + ' Anúncio verificado</span><small>Revisão administrativa; autenticidade e saúde precisam de conferência humana.</small>' : ''}
        <div class="animal-meta"><span>${escapeHTML(ageLabel)}</span><span>·</span><span>${escapeHTML(sizeLabel)}</span><span>·</span><span>${escapeHTML(animal.city)}</span></div>
        ${priorities.map((reason) => '<span class="tag tag-attention">' + escapeHTML(reason) + '</span>').join('')}
        <p class="animal-desc">${escapeHTML((animal.description || '').slice(0, 90))}</p>
        <a href="animal.html?id=${Number(animal.id)}" class="btn btn-primary btn-sm" style="margin-top:auto;align-self:flex-start;">Ver detalhes</a>
      </div>
    </div>`;
}

async function handleToggleFavorite(animalId) {
  const user = Auth.getCurrentUser();
  if (!user) {
    showToast('Entre na sua conta para favoritar animais.');
    return;
  }
  try {
    await Store.toggleFavorite(user.id, animalId);
    const favorite = Store.getFavorites().some((f) => f.animalId === Number(animalId));
    document
      .querySelectorAll(
        '[data-action="handleToggleFavorite"][data-arg-0="' + Number(animalId) + '"]',
      )
      .forEach((button) => {
        button.classList.toggle('is-favorite', favorite);
        button.setAttribute('aria-pressed', String(favorite));
        button.setAttribute('aria-label', favorite ? 'Remover dos favoritos' : 'Favoritar');
      });
    if (typeof renderFavoritos === 'function') renderFavoritos();
  } catch (err) {
    showToast(err.message);
  }
}
