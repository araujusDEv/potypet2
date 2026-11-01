/* ==========================================================================
   favoritos.js — Lista os animais favoritados pelo usuário logado.
   Usa a mesma função de card (animalCardHTML) das páginas Início/Adotar.
   ========================================================================== */

function renderFavoritos() {
  const user = Auth.requireAuth();
  if (!user) return;

  const favIds = Store.getFavorites()
    .filter((f) => f.userId === user.id)
    .map((f) => f.animalId);
  const animals = Store.getAnimals().filter((a) => favIds.includes(a.id));
  const el = document.getElementById('results');

  el.innerHTML = animals.length
    ? animals.map((a) => animalCardHTML(a, true)).join('')
    : '<div class="empty-state"><h3>Você ainda não adicionou nenhum animal aos favoritos.</h3><a href="adotar.html" class="btn btn-primary" style="margin-top:12px;">Ver animais disponíveis</a></div>';
}

// cards.js chama applyFilters() genericamente depois de favoritar/desfavoritar
// (mesmo padrão usado em Início e Quero Adotar) — aqui isso equivale a
// simplesmente redesenhar a lista de favoritos.
function applyFilters() {
  renderFavoritos();
}

App.ready(renderFavoritos);
