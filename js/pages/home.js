let featuredAnimalIds = new Set();
function renderFeatured() {
  const el = document.getElementById('featured-animals');
  if (!el) return;
  const available = Store.getAnimals().filter(Store.isAnimalAvailable),
    selected = available
      .filter((a) => a.featured)
      .concat(available.filter((a) => !a.featured))
      .slice(0, 3);
  featuredAnimalIds = new Set(selected.map((a) => a.id));
  const favs = Store.getFavorites().map((f) => f.animalId);
  el.innerHTML = selected.length
    ? selected.map((a) => animalCardHTML(a, favs.includes(a.id))).join('')
    : '<p>Nenhum animal disponível no momento.</p>';
  el.classList.add('home-animal-grid');
}
function renderStats() {
  const stats = Store.getPublicStats();
  for (const [id, key] of [
    ['stat-animais', 'available'],
    ['stat-adocoes', 'completedAdoptions'],
    ['stat-usuarios', 'users'],
    ['stat-ongs', 'organizations'],
  ])
    if (document.getElementById(id))
      document.getElementById(id).textContent = Number(stats[key]) || 0;
}
function renderRecommended() {
  const section = document.getElementById('recommended-section'),
    profile = Store.getAdoptionProfile();
  if (!section) return;
  const ranked = profile
    ? Store.getAnimals()
        .filter((a) => Store.isAnimalAvailable(a) && !featuredAnimalIds.has(a.id))
        .map((animal) => ({ animal, ...computeCompatibility(profile, animal) }))
        .filter((m) => m.eligible && !m.needsReview)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
    : [];
  section.style.display = ranked.length ? 'block' : 'none';
  if (!ranked.length) return;
  const el = document.getElementById('recommended-animals'),
    favs = Store.getFavorites().map((f) => f.animalId);
  el.classList.add('home-animal-grid');
  el.innerHTML = ranked
    .map((m) =>
      animalCardHTML(m.animal, favs.includes(m.animal.id)).replace(
        '<div class="animal-body">',
        '<div class="animal-body"><p class="match-score">' + m.score + '% de afinidade</p>',
      ),
    )
    .join('');
}
App.ready(() => {
  renderFeatured();
  renderStats();
  renderRecommended();
});
