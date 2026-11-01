function missingCardHTML(a) {
  const photo = safeImageSrc(a.photo);
  const date = a.missing_date
    ? new Date(a.missing_date + 'T12:00:00').toLocaleDateString('pt-BR')
    : '-';
  return `<a href="desaparecido.html?id=${Number(a.id)}" class="card animal-card">
    <div class="animal-photo">${photo ? `<img src="${escapeAttr(photo)}" alt="${escapeAttr(a.name || 'Animal desaparecido')}">` : '<div class="no-photo">Sem foto</div>'}
      <span class="badge missing-tag">DESAPARECIDO</span></div>
    <div class="animal-body"><h3>${escapeHTML(a.name || 'Sem nome')}</h3>
      <div class="animal-meta"><span>${escapeHTML(a.city)}/${escapeHTML(a.state)}</span><span>·</span><span>Desde ${date}</span></div>
      <p class="animal-desc">${escapeHTML(`${a.color || ''} ${a.breed || a.species || ''}`.trim())}</p>
    </div></a>`;
}

function applyMissingFilters() {
  const city = document.getElementById('f-city').value.toLowerCase();
  const species = document.getElementById('f-species').value;
  let list = Store.getMissing().filter((m) => Store.isMissingPublic(m) && !m.found);
  if (city) list = list.filter((m) => (m.city || '').toLowerCase().includes(city));
  if (species) list = list.filter((m) => m.species === species);
  document.getElementById('results').innerHTML = list.length
    ? list.map(missingCardHTML).join('')
    : '<div class="empty-state"><h3>Nenhum animal desaparecido cadastrado nessa busca</h3></div>';
}

App.ready(() => {
  document.getElementById('f-city').addEventListener('input', applyMissingFilters);
  document.getElementById('f-species').addEventListener('change', applyMissingFilters);
  applyMissingFilters();
});
