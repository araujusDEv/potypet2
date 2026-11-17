/* ==========================================================================
   adotar.js — Lógica da página "Quero Adotar": lê os filtros da tela,
   filtra a lista de animais aprovados e desenha os cards (função
   animalCardHTML, que vive em js/cards.js — por isso esse arquivo precisa
   ser carregado ANTES de adotar.js no HTML).
   ========================================================================== */

// Guarda qual valor está ativo em cada "chip" de filtro (espécie, castrado,
// vacinado), já que eles não são <select> e precisam de controle manual.
const activeChips = {};

// Lê todos os campos de filtro da tela, aplica um a um sobre a lista de
// animais aprovados e redesenha o grid de resultados.
function applyFilters() {
  const q = document.getElementById('f-q').value.toLowerCase();
  const city = document.getElementById('f-city').value.toLowerCase();
  const age = document.getElementById('f-age').value;
  const size = document.getElementById('f-size').value;
  const sex = document.getElementById('f-sex').value;
  const kids = document.getElementById('f-kids').value;
  const energy = document.getElementById('f-energy').value;

  // A vitrine exige aprovação para publicação e disponibilidade para adoção.
  let animals = Store.getAnimals().filter((a) => Store.isAnimalAvailable(a));

  // Cada filtro só é aplicado se o usuário de fato escolheu um valor
  // (campo vazio = "não filtrar por isso").
  if (q)
    animals = animals.filter(
      (a) => a.name.toLowerCase().includes(q) || (a.breed || '').toLowerCase().includes(q),
    );
  if (city) animals = animals.filter((a) => a.city.toLowerCase().includes(city));
  if (age) animals = animals.filter((a) => a.age_group === age);
  if (size) animals = animals.filter((a) => a.size === size);
  if (sex) animals = animals.filter((a) => a.sex === sex);
  if (kids) animals = animals.filter((a) => a.coexistence && a.coexistence.kids === 'sim');
  if (energy) animals = animals.filter((a) => a.energy_level === energy);
  if (activeChips.species) animals = animals.filter((a) => a.species === activeChips.species);
  if (activeChips.neutered) animals = animals.filter((a) => a.neutered);
  if (activeChips.vaccinated) animals = animals.filter((a) => a.vaccinated);
  if (activeChips.dewormed) animals = animals.filter((a) => a.dewormed);
  if (activeChips.special_needs) animals = animals.filter((a) => a.special_needs);
  if (activeChips.urgent) animals = animals.filter(animalNeedsAttention);

  // Marca quais desses animais já são favoritos do usuário logado, pra
  // desenhar o coração preenchido no card certo.
  const user = Auth.getCurrentUser();
  const favs = user
    ? Store.getFavorites()
        .filter((f) => f.userId === user.id)
        .map((f) => f.animalId)
    : [];

  document.getElementById('results-count').textContent =
    `${animals.length} ${animals.length === 1 ? 'animal encontrado' : 'animais encontrados'}.`;

  const el = document.getElementById('results');
  el.innerHTML = animals.length
    ? animals.map((a) => animalCardHTML(a, favs.includes(a.id))).join('')
    : '<div class="empty-state"><h3>Nenhum animal encontrado</h3><p>Tente ajustar os filtros de busca.</p></div>';
}

function clearFilters() {
  ['f-q', 'f-city', 'f-age', 'f-size', 'f-sex', 'f-kids', 'f-energy'].forEach((id) => {
    document.getElementById(id).value = '';
  });
  Object.keys(activeChips).forEach((k) => delete activeChips[k]);
  document.querySelectorAll('.chip.active').forEach((c) => c.classList.remove('active'));
  applyFilters();
}

App.ready(() => {
  // Qualquer alteração em qualquer campo de filtro já refiltra a lista.
  ['f-q', 'f-city', 'f-age', 'f-size', 'f-sex', 'f-kids', 'f-energy'].forEach((id) => {
    document.getElementById(id).addEventListener('input', applyFilters);
    document.getElementById(id).addEventListener('change', applyFilters);
  });

  document.getElementById('btn-clear-filters').addEventListener('click', clearFilters);

  // Chips funcionam como botões de alternar (toggle): clicar de novo no
  // mesmo chip remove o filtro; clicar em outro do mesmo grupo troca.
  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const filter = chip.dataset.filter;
      const value = chip.dataset.value;
      if (activeChips[filter] === value) {
        delete activeChips[filter];
        chip.classList.remove('active');
      } else {
        document
          .querySelectorAll(`.chip[data-filter="${filter}"]`)
          .forEach((c) => c.classList.remove('active'));
        activeChips[filter] = value;
        chip.classList.add('active');
      }
      applyFilters();
    });
  });

  // Renderiza a lista já na primeira vez que a página carrega.
  applyFilters();
});
