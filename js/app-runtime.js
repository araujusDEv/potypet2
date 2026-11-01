/* One asynchronous load per page; filters and rendering read only the in-memory snapshot. */
const App = {
  data: {},
  resources: {},
  inflight: new Map(),
  boot: null,
  async load(key, url, options = {}) {
    if (this.inflight.has(key)) return this.inflight.get(key);
    this.resources[key] = url;
    const task = apiRequestAsync('GET', url, undefined, options).then((value) => {
      this.data[key] = value;
      return value;
    });
    this.inflight.set(key, task);
    try {
      return await task;
    } finally {
      this.inflight.delete(key);
    }
  },
  async hydrate() {
    const page = location.pathname.split('/').pop() || 'index.html',
      id = new URLSearchParams(location.search).get('id');
    const plan = {};
    if (['cadastrar-animal.html', 'cadastrar-desaparecido.html', 'admin.html'].includes(page))
      plan.photoPolicy = '/api/photo-policy';
    if (['index.html', 'adotar.html', 'compatibilidade.html'].includes(page))
      plan.animals = '/api/animals/cards';
    if (['index.html', 'transparencia.html'].includes(page)) plan.stats = '/api/stats';
    if (['animal.html', 'cartaz.html', 'cadastrar-animal.html'].includes(page) && id)
      plan.animal = '/api/animals/' + Number(id);
    if (['desaparecidos.html', 'desaparecido.html', 'cadastrar-desaparecido.html'].includes(page))
      plan.missing = '/api/missing?media=' + (page === 'desaparecidos.html' ? 'thumb' : 'gallery');
    if (page === 'historias.html') plan.stories = '/api/stories?media=1';
    if (page === 'apoio.html') plan.support = '/api/support-points';
    const tasks = [
      this.load('session', '/api/auth/me', { allow401: true }),
      ...Object.entries(plan).map(([key, url]) =>
        this.load(key, url, { allow404: key === 'animal' }),
      ),
    ];
    const publicResults = await Promise.allSettled(tasks),
      failed = publicResults.find((r) => r.status === 'rejected');
    if (failed) throw failed.reason;
    Auth._currentUser = this.data.session?.user || null;
    if (this.data.animal) this.data.animals = [this.data.animal];
    const user = Auth.getCurrentUser();
    if (!user) return;
    const privatePlan = { unread: '/api/notifications/summary' };
    if (
      [
        'index.html',
        'adotar.html',
        'animal.html',
        'compatibilidade.html',
        'favoritos.html',
      ].includes(page)
    )
      privatePlan.favorites = '/api/favorites';
    if (['index.html', 'compatibilidade.html'].includes(page))
      privatePlan.profile = '/api/adoption-profile';
    if (page === 'favoritos.html') privatePlan.animals = '/api/animals/cards?view=favorites';
    if (['painel-doador.html', 'minhas-solicitacoes.html'].includes(page)) {
      privatePlan.requests = '/api/requests';
      privatePlan.followups = '/api/followups?media=gallery';
      privatePlan.animals =
        '/api/animals/cards?view=' + (page === 'painel-doador.html' ? 'manage' : 'history');
    }
    if (page === 'painel-doador.html') {
      privatePlan.missing = '/api/missing?media=gallery';
      privatePlan.sightings = '/api/sightings';
    }
    if (['cadastrar-animal.html', 'cadastrar-desaparecido.html'].includes(page))
      privatePlan.limits = '/api/account/limits';
    if (page === 'solicitar-campanha.html') privatePlan.animals = '/api/animals/cards?view=manage';
    if (page === 'notificacoes.html') privatePlan.notifications = '/api/notifications';
    if (page === 'contrato.html')
      privatePlan.contract =
        '/api/contracts/' + Number(new URLSearchParams(location.search).get('request'));
    if (page === 'admin.html' && user.role === 'admin')
      Object.assign(privatePlan, {
        users: '/api/users',
        animals: '/api/animals/cards?view=manage',
        requests: '/api/requests',
        missing: '/api/missing?media=gallery',
        reports: '/api/reports',
        logs: '/api/admin-log',
        followups: '/api/followups?media=gallery',
      });
    if (user.historicalAccess && ['painel-doador.html', 'minhas-solicitacoes.html'].includes(page))
      privatePlan.animals = '/api/animals/cards?view=history';
    const entries = Object.entries(privatePlan),
      auxiliary = new Set(['unread', 'favorites', 'profile', 'limits']);
    const privateResults = await Promise.allSettled(
      entries.map(([key, url]) => this.load(key, url)),
    );
    for (let i = 0; i < privateResults.length; i++)
      if (privateResults[i].status === 'rejected') {
        const [key] = entries[i],
          err = privateResults[i].reason;
        if (user.historicalAccess && auxiliary.has(key) && err.status === 403) {
          delete this.data[key];
          continue;
        }
        throw err;
      }
  },
  async start() {
    if (this.boot) return this.boot;
    const main = document.querySelector('main'),
      status = document.createElement('div');
    status.id = 'app-loading';
    status.className = 'app-loading';
    status.setAttribute('role', 'status');
    status.textContent = 'Carregando…';
    main?.prepend(status);
    main?.setAttribute('aria-busy', 'true');
    document.querySelectorAll('[id^=stat-]').forEach((el) => (el.textContent = '—'));
    const controls = [
      ...document.querySelectorAll('main input,main select,main textarea,main button'),
    ].filter((el) => !el.disabled);
    controls.forEach((el) => (el.disabled = true));
    this.boot = this.hydrate()
      .then(() => {
        status.remove();
        main?.setAttribute('aria-busy', 'false');
        controls.forEach((el) => (el.disabled = false));
        if (Auth.getCurrentUser()?.historicalAccess) {
          const notice = document.createElement('div');
          notice.className = 'alert';
          notice.id = 'account-restricted-notice';
          notice.setAttribute('role', 'status');
          notice.innerHTML =
            '<b>Conta em acesso restrito.</b> Consulte somente seus registros autorizados. Novas ações estão bloqueadas. <a href="painel-doador.html?tab=animais">Consultar histórico</a>';
          main?.prepend(notice);
          if (
            [
              'cadastrar-animal.html',
              'cadastrar-desaparecido.html',
              'solicitar-campanha.html',
              'configuracoes.html',
            ].includes(location.pathname.split('/').pop())
          )
            document
              .querySelectorAll(
                'main form input,main form select,main form textarea,main form button',
              )
              .forEach((el) => (el.disabled = true));
        }
        document.dispatchEvent(new Event('app:ready'));
      })
      .catch((err) => {
        main?.setAttribute('aria-busy', 'false');
        if (typeof renderNav === 'function') renderNav();
        status.className = 'alert alert-error';
        status.setAttribute('role', 'alert');
        status.innerHTML = `<p>${escapeHTML(err.message)}</p><button type="button" class="btn btn-outline btn-sm">Tentar novamente</button>`;
        status.querySelector('button').onclick = () => location.reload();
        throw err;
      });
    return this.boot;
  },
  ready(callback) {
    const run = async () => {
      try {
        await this.start();
        await callback();
      } catch (err) {
        if (!document.getElementById('app-loading'))
          showToast(err.message || 'Não foi possível carregar esta página.');
      }
    };
    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', run, { once: true });
    else void run();
  },
  async refresh(keys) {
    const results = await Promise.allSettled(
      [...new Set(keys)]
        .filter((key) => this.resources[key])
        .map((key) => this.load(key, this.resources[key])),
    );
    if (results.some((r) => r.status === 'rejected'))
      showToast(
        'A ação foi registrada, mas a atualização da tela falhou. Recarregue para consultar o estado atual.',
      );
  },
  async action(button, callback) {
    if (button?.dataset.busy === 'true') return;
    const disabled = button?.disabled,
      label = button?.innerHTML;
    if (button) button.dataset.busy = 'true';
    try {
      const task = callback();
      if (button) {
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        if (!button.querySelector('img,svg')) button.textContent = 'Aguarde…';
      }
      await task;
    } catch (err) {
      showToast(err.message || 'Não foi possível concluir a ação.');
    } finally {
      if (button) {
        delete button.dataset.busy;
        button.disabled = disabled;
        button.setAttribute('aria-busy', 'false');
        if (button.isConnected) button.innerHTML = label;
      }
    }
  },
  click(callback) {
    return function (event) {
      return App.action(event.currentTarget, () => callback.call(this, event));
    };
  },
  form(callback) {
    return async function (event) {
      event.preventDefault();
      const form = event.currentTarget;
      if (form.dataset.busy === 'true') return;
      form.dataset.busy = 'true';
      try {
        await App.action(form.querySelector('[type=submit]'), () => callback.call(this, event));
      } finally {
        delete form.dataset.busy;
      }
    };
  },
};
App.ready(() => {
  const quota = App.data.limits,
    form = document.getElementById('animal-form') || document.getElementById('missing-form');
  if (quota && form) {
    const note = document.createElement('p');
    note.className = 'request-policy';
    const key = form.id === 'animal-form' ? 'animals' : 'missing';
    note.textContent =
      'Anúncios: ' +
      quota.usage[key] +
      ' de ' +
      quota.limits[key] +
      '. Fotos e anexos: ' +
      (quota.usage.storageBytes / 1024 / 1024).toFixed(1) +
      ' de ' +
      Math.floor(quota.limits.storageBytes / 1024 / 1024) +
      ' MB. Os registros anteriores são preservados.';
    form.prepend(note);
  }
});
