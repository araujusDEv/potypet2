/* Navegação compartilhada: sidebar no desktop e painel deslizante no mobile. */
const mobileNavigation = window.matchMedia('(max-width: 900px)');
function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}
function setRecordMetadata(title, description, image) {
  document.title = title;
  const values = {
    description,
    'og:title': title,
    'og:description': description,
    'og:type': 'article',
    'twitter:title': title,
    'twitter:description': description,
  };
  let imageUrl = null;
  try {
    const candidate = new URL(image || '', location.href);
    if (image && /^https?:$/.test(candidate.protocol)) imageUrl = candidate.href;
  } catch {}
  values['og:image'] = imageUrl;
  values['twitter:image'] = imageUrl;
  values['twitter:card'] = imageUrl ? 'summary_large_image' : 'summary';
  for (const [key, value] of Object.entries(values)) {
    const attr = key.startsWith('og:') ? 'property' : 'name';
    let meta = document.head.querySelector(`meta[${attr}="${key}"]`);
    if (!value) {
      meta?.remove();
      continue;
    }
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute(attr, key);
      document.head.appendChild(meta);
    }
    meta.content = String(value).slice(0, key.includes('image') ? 2000 : 250);
  }
}
function getSavedTheme() {
  try {
    return localStorage.getItem('petadopt_theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}
function applySavedTheme() {
  document.documentElement.setAttribute('data-theme', getSavedTheme());
}
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem('petadopt_theme', next);
  } catch {}
  renderNav();
}
function navItem(href, label, icon, extra = '') {
  return `<a class="sidebar-link ${extra}" href="${href}" data-tooltip="${escapeAttr(label)}">${svgIcon(icon)}<span>${escapeHTML(label)}</span></a>`;
}
function roleLabel(user) {
  const type =
    user?.accountType ||
    (user?.role === 'admin' ? 'admin' : user?.role === 'doador' ? 'ong' : 'usuario');
  if (type === 'ong')
    return user.organizationKind === 'ong'
      ? 'ONG'
      : user.organizationKind === 'grupo'
        ? 'Grupo independente'
        : 'Organização';
  return { usuario: 'Pessoa física', admin: 'Administrador' }[type] || 'Visitante';
}
function renderNav() {
  applySavedTheme();
  const header = document.querySelector('.navbar');
  if (!header) return;
  if (document.body.classList.contains('auth-page')) {
    header.hidden = true;
    return;
  }
  let user = null;
  let unread = 0;
  try {
    user = Auth.getCurrentUser();
  } catch {
    user = null;
  }
  try {
    unread = user ? Number(App.data.unread?.unread) || 0 : 0;
  } catch {}
  const accountType =
    user?.accountType ||
    (user?.role === 'admin' ? 'admin' : user?.role === 'doador' ? 'ong' : 'usuario');
  const publishAllowed =
    user && !user.historicalAccess && (accountType !== 'ong' || user.approvalStatus === 'aprovado');
  const publicLinks = [
    ['index.html', 'Início', 'house'],
    ['adotar.html', 'Quero adotar', 'search'],
    ['compatibilidade.html', 'Compatibilidade', 'sparkles'],
    ['historias.html', 'Histórias', 'heart'],
    ['desaparecidos.html', 'Desaparecidos', 'pin'],
    ['doacoes.html', 'Doe por um pet', 'heart'],
    ['organizacoes.html', 'ONGs e grupos', 'users'],
    ['apoio.html', 'Rede de apoio', 'pin'],
  ]
    .map((link) => navItem(...link))
    .join('');
  let workspace = '';
  if (user) {
    workspace = `
      <div class="sidebar-section-label">Minha área</div>
      ${navItem('campanhas.html', 'Minhas campanhas', 'heart')}
      ${navItem('solicitar-campanha.html', 'Solicitar campanha', 'plus')}
      ${accountType === 'ong' ? navItem('organizacoes.html?editar=1', 'Minha organização', 'users') : ''}
      ${publishAllowed ? navItem('cadastrar-animal.html', 'Publicar animal', 'plus') : ''}
      ${publishAllowed ? navItem('painel-doador.html?tab=animais', 'Meus animais', 'paw') : ''}
      ${publishAllowed ? navItem('painel-doador.html?tab=solicitacoes', 'Interessados', 'users') : ''}
      ${navItem('minhas-solicitacoes.html', 'Minhas solicitações', 'clipboard')}
      ${navItem('favoritos.html', 'Favoritos', 'heart')}
      ${navItem('notificacoes.html', `Notificações${unread ? ` (${unread})` : ''}`, 'bell', unread ? 'has-alert' : '')}
      ${accountType === 'admin' ? '<div class="sidebar-section-label">Administração</div>' + navItem('admin.html', 'Painel geral', 'shield-check') + navItem('campanhas.html?admin=1', 'Analisar campanhas', 'clipboard') : ''}
      ${navItem('configuracoes.html', 'Configurações', 'settings')}`;
    if (user.historicalAccess)
      workspace =
        '<div class="sidebar-section-label">Consulta restrita</div>' +
        navItem('painel-doador.html?tab=animais', 'Consultar histórico', 'clipboard') +
        navItem('minhas-solicitacoes.html', 'Histórico de adoções', 'paw') +
        navItem('campanhas.html', 'Histórico de campanhas', 'heart') +
        navItem('notificacoes.html', 'Notificações', 'bell') +
        navItem('configuracoes.html', 'Situação da conta', 'settings');
  } else {
    workspace = `<div class="sidebar-section-label">Sua conta</div>${navItem('login.html', 'Entrar', 'user')}${navItem('registro.html', 'Criar conta', 'plus')}`;
  }
  header.className = 'navbar app-sidebar';
  header.hidden = false;
  header.innerHTML = `
    <div class="sidebar-head">
      <a href="index.html" class="logo" aria-label="PotyPet — início"><span class="logo-mark"><img src="img/brand-symbol.png" alt="" width="52" height="52"></span><span class="brand-word"><span class="brand-adota">Poty</span><span class="brand-pet">Pet</span></span></a>
      <button class="sidebar-mobile-close" type="button" aria-label="Fechar menu">${svgIcon('close')}</button>
    </div>
    <nav class="sidebar-scroll" id="nav-links" aria-label="Navegação principal">
      <div class="sidebar-section-label">Explorar</div>${publicLinks}${workspace}<div class="sidebar-institutional"><a href="sobre.html">Sobre</a><a href="contato.html">Contato</a><a href="conscientizacao.html">Conscientização</a></div>
    </nav>
    <div class="sidebar-footer">
      ${user ? `<a href="configuracoes.html" class="sidebar-profile" data-tooltip="Perfil e configurações"><span class="sidebar-avatar">${escapeHTML(user.name.charAt(0).toUpperCase())}</span><span class="sidebar-profile-copy"><strong>${escapeHTML(user.name)}</strong><small>${roleLabel(user)}</small></span></a><button type="button" class="sidebar-logout" aria-label="Sair da conta" data-tooltip="Sair da conta">${svgIcon('logout')}<span>Sair</span></button>` : `<p class="sidebar-guest-note">Entre para salvar favoritos, publicar animais e acompanhar solicitações.</p>`}
      <div class="sidebar-utility"><button type="button" class="theme-sidebar" aria-label="Alternar tema" data-tooltip="Alternar tema">${svgIcon(getSavedTheme() === 'dark' ? 'sun' : 'moon')}<span>Tema</span></button><button type="button" class="sidebar-collapse" aria-label="Recolher menu" aria-expanded="true" data-tooltip="Recolher menu">${svgIcon('panel-left')}<span>Recolher</span></button></div>
    </div>`;
  if (!document.querySelector('.mobile-topbar')) {
    header.insertAdjacentHTML(
      'afterend',
      `<div class="mobile-topbar"><a href="index.html" class="mobile-brand"><img src="img/brand-symbol.png" alt="" width="44" height="44"><b><span>Poty</span>Pet</b></a><div class="mobile-top-actions">${user ? `<a href="notificacoes.html" aria-label="Notificações">${svgIcon('bell')}${unread ? `<span class="mobile-alert">${unread}</span>` : ''}</a>` : ''}<button type="button" class="sidebar-mobile-open" aria-label="Abrir menu" aria-expanded="false">${svgIcon('menu')}</button></div></div><button type="button" class="sidebar-overlay" aria-label="Fechar menu" tabindex="-1"></button>`,
    );
  }
  const current = location.pathname.split('/').pop() || 'index.html';
  header.querySelectorAll('a[href]').forEach((link) => {
    const linkUrl = new URL(link.href);
    const target = linkUrl.pathname.split('/').pop();
    const targetTab = linkUrl.searchParams.get('tab');
    const active =
      target === current && (!targetTab || targetTab === (getParam('tab') || 'animais'));
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  let collapsed = false;
  try {
    collapsed =
      !mobileNavigation.matches && localStorage.getItem('adotapet_sidebar_collapsed') === '1';
  } catch {}
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  const collapseButton = document.querySelector('.sidebar-collapse');
  if (collapseButton) {
    collapseButton.setAttribute('aria-expanded', String(!collapsed));
    collapseButton.setAttribute('aria-label', collapsed ? 'Expandir menu' : 'Recolher menu');
    collapseButton.dataset.tooltip = collapsed ? 'Expandir menu' : 'Recolher menu';
  }
  bindNavigationEvents();
  setMobileMenu(false);
}
function bindNavigationEvents() {
  document
    .querySelector('button.sidebar-mobile-open')
    ?.addEventListener('click', () => setMobileMenu(true));
  document
    .querySelector('.sidebar-mobile-close')
    ?.addEventListener('click', () => setMobileMenu(false, true));
  document
    .querySelector('.sidebar-overlay')
    ?.addEventListener('click', () => setMobileMenu(false, true));
  document.querySelector('.sidebar-collapse')?.addEventListener('click', () => {
    const collapsed = !document.body.classList.contains('sidebar-collapsed');
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    const button = document.querySelector('.sidebar-collapse');
    button?.setAttribute('aria-expanded', String(!collapsed));
    button?.setAttribute('aria-label', collapsed ? 'Expandir menu' : 'Recolher menu');
    if (button) button.dataset.tooltip = collapsed ? 'Expandir menu' : 'Recolher menu';
    try {
      localStorage.setItem('adotapet_sidebar_collapsed', collapsed ? '1' : '0');
    } catch {}
  });
  document.querySelector('.theme-sidebar')?.addEventListener('click', toggleTheme);
  document.querySelector('.sidebar-logout')?.addEventListener('click', handleLogout);
  document
    .querySelectorAll('.app-sidebar a')
    .forEach((link) => link.addEventListener('click', () => setMobileMenu(false)));
}
function setMobileMenu(open, restoreFocus = false) {
  const expanded = Boolean(open && mobileNavigation.matches);
  document.body.classList.toggle('sidebar-mobile-open', expanded);
  document.documentElement.classList.toggle('nav-menu-open', expanded);
  document
    .querySelector('button.sidebar-mobile-open')
    ?.setAttribute('aria-expanded', String(expanded));
  if (expanded)
    setTimeout(() => document.querySelector('.app-sidebar a, .app-sidebar button')?.focus(), 20);
  else if (restoreFocus) document.querySelector('button.sidebar-mobile-open')?.focus();
}
function syncNavigationLayout() {
  if (!mobileNavigation.matches) setMobileMenu(false);
}
async function handleLogout() {
  await Auth.logout();
  window.location.href = 'index.html';
}
function showToast(message) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('visible');
  clearTimeout(el._timeout);
  el._timeout = setTimeout(() => el.classList.remove('visible'), 3200);
}
App.ready(() => {
  seedDatabase();
  renderNav();
  window.addEventListener('resize', syncNavigationLayout);
  document.addEventListener('keydown', (event) => {
    const open = document.body.classList.contains('sidebar-mobile-open');
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setMobileMenu(false, true);
      return;
    }
    if (event.key === 'Tab' && open) {
      const focusable = [
        ...document.querySelectorAll('.app-sidebar a[href], .app-sidebar button:not([disabled])'),
      ].filter((el) => el.getClientRects().length);
      const first = focusable[0],
        last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  });
});
