App.ready(() => {
  const stories = Store.getPublicStories();
  const el = document.getElementById('stories-list');
  if (!stories.length) {
    el.innerHTML =
      '<div class="empty-state"><h3>Ainda não há histórias publicadas.</h3><p>Assim que uma adoção for concluída, o adotante pode compartilhar sua história aqui.</p></div>';
    return;
  }
  el.innerHTML = `<div class="grid-animals">${stories
    .map((r) => {
      const name = r.animalName || 'Animal adotado';
      const cover = safeImageSrc(r.photo);
      return `<div class="card animal-card">
      <div class="animal-photo">${cover ? `<img src="${escapeAttr(cover)}" alt="${escapeAttr(name)}">` : '<div class="no-photo">Sem foto</div>'}</div>
      <div class="animal-body"><h3>${escapeHTML(name)}</h3>
      <div class="animal-meta"><span>Adotado(a) por ${escapeHTML(r.full_name || 'adotante')}</span></div>
      <p class="animal-desc" style="-webkit-line-clamp:5;">${escapeHTML(r.story)}</p></div>
    </div>`;
    })
    .join('')}</div>`;
});
