function readProfileFromForm() {
  return {
    housing: document.getElementById('q-housing').value,
    has_yard: document.getElementById('q-yard').value,
    has_kids: document.getElementById('q-kids').value,
    other_pets: document.getElementById('q-other-pets').value,
    alone_time: document.getElementById('q-alone').value,
    experience: document.getElementById('q-experience').value,
    species: document.getElementById('q-species').value,
    age: document.getElementById('q-age').value,
    size: document.getElementById('q-size').value,
    energy: document.getElementById('q-energy').value,
    availability: document.getElementById('q-availability').value,
  };
}

function fillFormFromProfile(profile) {
  const map = {
    housing: 'q-housing',
    has_yard: 'q-yard',
    has_kids: 'q-kids',
    other_pets: 'q-other-pets',
    alone_time: 'q-alone',
    experience: 'q-experience',
    species: 'q-species',
    age: 'q-age',
    size: 'q-size',
    energy: 'q-energy',
    availability: 'q-availability',
  };
  Object.entries(map).forEach(([key, id]) => {
    if (profile[key] !== undefined) document.getElementById(id).value = profile[key];
  });
}

function renderMatches(profile) {
  const ranked = Store.getAnimals()
    .filter((a) => Store.isAnimalAvailable(a))
    .map((animal) => ({ animal, ...computeCompatibility(profile, animal) }))
    .sort(
      (a, b) =>
        Number(b.eligible) - Number(a.eligible) ||
        Number(a.needsReview) - Number(b.needsReview) ||
        (b.score || 0) - (a.score || 0),
    );
  const el = document.getElementById('match-results');
  el.innerHTML = ranked.length
    ? ranked
        .map((match) => {
          const { animal, score, reasons, warnings, conflicts, uncertainties } = match,
            cover = safeImageSrc(animal.photos?.[0]);
          const safety = [...conflicts, ...uncertainties];
          const guidance = conflicts.length
            ? 'A convivência informada é incompatível com seu perfil. Confira as informações e converse com o responsável.'
            : 'Confirme a convivência com o responsável antes de avaliar a afinidade.';
          return (
            '<article class="card animal-card"><div class="animal-photo">' +
            (cover
              ? '<img src="' +
                escapeAttr(cover) +
                '" alt="' +
                escapeAttr(animal.name) +
                '" loading="lazy" decoding="async" width="480" height="360">'
              : '<div class="no-photo">Sem foto</div>') +
            '</div><div class="animal-body">' +
            (safety.length
              ? '<div class="alert ' +
                (conflicts.length ? 'alert-error' : 'alert-warning') +
                '"><b>' +
                (conflicts.length ? 'Conflito de convivência' : 'Precisa de confirmação') +
                '</b>' +
                safety.map((message) => '<p>' + escapeHTML(message) + '</p>').join('') +
                '</div>'
              : '') +
            '<h3>' +
            escapeHTML(animal.name) +
            '</h3>' +
            (!conflicts.length && !uncertainties.length
              ? '<p class="match-score">' +
                Number(score) +
                '% de afinidade com suas preferências</p>'
              : '<p>' + escapeHTML(guidance) + '</p>') +
            '<div class="animal-meta">' +
            escapeHTML(animal.city) +
            '</div><div class="match-reasons">' +
            (!conflicts.length
              ? reasons
                  .slice(0, 3)
                  .map((reason) => '<div>' + svgIcon('check') + ' ' + escapeHTML(reason) + '</div>')
                  .join('')
              : '') +
            warnings
              .filter((w) => !w.includes('crianças') && !w.includes('outros animais'))
              .slice(0, 2)
              .map(
                (w) =>
                  '<div class="match-warning">' +
                  svgIcon('warning') +
                  ' ' +
                  escapeHTML(w) +
                  '</div>',
              )
              .join('') +
            '</div><a href="animal.html?id=' +
            animal.id +
            '" class="btn btn-primary btn-sm" style="margin-top:auto">Ver perfil completo</a></div></article>'
          );
        })
        .join('')
    : '<div class="empty-state"><h3>Nenhum animal disponível no momento.</h3></div>';
}

App.ready(() => {
  const user = Auth.getCurrentUser();
  const existing = user ? Store.getAdoptionProfile(user.id) : null;
  if (existing) {
    fillFormFromProfile(existing);
    document.getElementById('quiz-area').style.display = 'none';
    document.getElementById('results-area').style.display = 'block';
    renderMatches(existing);
  }
  document.getElementById('quiz-form').addEventListener(
    'submit',
    App.form(async (e) => {
      e.preventDefault();
      const profile = readProfileFromForm();
      try {
        if (user) await Store.saveAdoptionProfile(user.id, profile);
      } catch (err) {
        showToast(err.message);
        return;
      }
      document.getElementById('quiz-area').style.display = 'none';
      document.getElementById('results-area').style.display = 'block';
      renderMatches(profile);
    }),
  );
  document.getElementById('btn-redo-quiz').addEventListener('click', () => {
    document.getElementById('results-area').style.display = 'none';
    document.getElementById('quiz-area').style.display = 'block';
  });
});
