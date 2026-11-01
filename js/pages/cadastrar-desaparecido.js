function fileToBase64(file) {
  return PhotoUpload.file(file, 'm-photo-status');
}

App.ready(() => {
  const user = Auth.requireAuth();
  if (!user) return;

  const editId = Number(getParam('id')) || null;
  let editing = null;
  document.getElementById('m-date').max = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo',
  }).format(new Date());
  const map = {
    'm-name': 'name',
    'm-species': 'species',
    'm-breed': 'breed',
    'm-color': 'color',
    'm-age': 'approx_age',
    'm-date': 'missing_date',
    'm-features': 'features',
    'm-location': 'last_seen_location',
    'm-city': 'city',
    'm-state': 'state',
    'm-contact': 'contact',
    'm-reward': 'reward',
  };
  if (editId) {
    editing = Store.getMissingById(editId);
    if (!editing || (user.role !== 'admin' && Number(editing.ownerId) !== user.id)) {
      document.getElementById('missing-form').innerHTML =
        '<div class="alert alert-error">Você não pode corrigir este registro.</div>';
      return;
    }
    document.querySelector('main h1').textContent = 'Corrigir informações do desaparecido';
    for (const [id, key] of Object.entries(map))
      document.getElementById(id).value = editing[key] || '';
    document.querySelector('#missing-form button[type=submit]').textContent = 'Salvar correções';
    document.querySelector('label[for="m-photo"]').textContent =
      'Nova foto (opcional — deixe vazio para manter a atual)';
  }

  document.getElementById('missing-form').addEventListener(
    'submit',
    App.form(async (e) => {
      e.preventDefault();
      let alert = document.getElementById('missing-form-alert');
      if (!alert) {
        alert = document.createElement('div');
        alert.id = 'missing-form-alert';
        e.currentTarget.prepend(alert);
      }
      alert.innerHTML = '';
      try {
        const photo = await fileToBase64(document.getElementById('m-photo').files[0]);
        const data = {
          name: document.getElementById('m-name').value,
          species: document.getElementById('m-species').value,
          breed: document.getElementById('m-breed').value,
          color: document.getElementById('m-color').value,
          approx_age: document.getElementById('m-age').value,
          missing_date: document.getElementById('m-date').value,
          features: document.getElementById('m-features').value,
          last_seen_location: document.getElementById('m-location').value,
          city: document.getElementById('m-city').value,
          state: document.getElementById('m-state').value,
          contact: document.getElementById('m-contact').value,
          reward: document.getElementById('m-reward').value,
          photo,
        };
        if (editing && !photo) delete data.photo;
        const record = editing
          ? await Store.updateMissing(editing.id, data)
          : await Store.createMissing(data);
        window.location.href = `desaparecido.html?id=${record.id}`;
      } catch (err) {
        alert.innerHTML = `<div class="alert alert-error">${escapeHTML(err.message)}</div>`;
      }
    }),
  );
});
