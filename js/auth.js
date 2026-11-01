/* ==========================================================================
   auth.js — Autenticação via cookie HttpOnly criado pelo servidor.
   Senhas e tokens de sessão não ficam acessíveis ao JavaScript do navegador.
   ========================================================================== */

function validateReturnDestination(value) {
  if (
    typeof value !== 'string' ||
    value.length > 1024 ||
    !/^\/?[a-z0-9-]+\.html(?:\?[^#\\\s]*)?$/.test(value)
  )
    return null;
  const id = (v) => /^[1-9]\d*$/.test(v) && Number.isSafeInteger(Number(v));
  const destinations = {
    'index.html': {},
    'adotar.html': {},
    'compatibilidade.html': {},
    'historias.html': {},
    'desaparecidos.html': {},
    'apoio.html': {},
    'transparencia.html': {},
    'sobre.html': {},
    'contato.html': {},
    'favoritos.html': {},
    'configuracoes.html': {},
    'notificacoes.html': {},
    'minhas-solicitacoes.html': {},
    'campanhas.html': { admin: (v) => v === '1' },
    'admin.html': {},
    'cadastrar-desaparecido.html': { id },
    'termos.html': {},
    'privacidade.html': {},
    'cadastrar-animal.html': { id },
    'animal.html': { id },
    'desaparecido.html': { id },
    'cartaz.html': { id },
    'contrato.html': { request: id },
    'doacoes.html': { campanha: id },
    'solicitar-campanha.html': { id, tipo: (v) => v === 'continuo' },
    'organizacoes.html': { id, editar: (v) => v === '1' },
    'painel-doador.html': {
      tab: (v) => ['animais', 'solicitacoes', 'desaparecidos', 'acompanhamentos'].includes(v),
    },
  };
  try {
    const url = new URL(value, 'https://appet.invalid/'),
      page = url.pathname.slice(1);
    if (!Object.hasOwn(destinations, page)) return null;
    const seen = new Set();
    for (const [key, v] of url.searchParams) {
      if (seen.has(key) || !Object.hasOwn(destinations[page], key) || !destinations[page][key](v))
        return null;
      seen.add(key);
    }
    if (['animal.html', 'desaparecido.html', 'cartaz.html'].includes(page) && !seen.has('id'))
      return null;
    if (page === 'contrato.html' && !seen.has('request')) return null;
    if (page === 'organizacoes.html' && seen.has('id') && seen.has('editar')) return null;
    return url.pathname + url.search;
  } catch {
    return null;
  }
}

const Auth = {
  _currentUser: undefined,

  getCurrentUser() {
    if (this._currentUser !== undefined) return this._currentUser;
    this._currentUser = App.data.session?.user || null;
    return this._currentUser;
  },

  async login(email, password, remember = false) {
    const result = await apiRequestAsync('POST', '/api/auth/login', { email, password, remember });
    this._currentUser = result.user;
    return result.user;
  },

  async register({
    name,
    email,
    password,
    passwordConfirmation,
    accountType,
    organizationKind,
    city,
    state,
    phone,
    termsAccepted,
    remember,
  }) {
    const result = await apiRequestAsync('POST', '/api/auth/register', {
      name,
      email,
      password,
      passwordConfirmation,
      accountType,
      organizationKind,
      city,
      state,
      phone,
      termsAccepted,
      remember,
      returnTo: this.pendingDestination(),
    });
    this._currentUser =
      result.pendingApproval || result.pendingEmailVerification ? null : result.user;
    return result;
  },

  forgotPassword(email) {
    return apiRequestAsync('POST', '/api/auth/forgot-password', {
      email,
      returnTo: this.pendingDestination(),
    });
  },
  resendVerification(email) {
    return apiRequestAsync('POST', '/api/auth/resend-verification', {
      email,
      returnTo: this.pendingDestination(),
    });
  },

  async logout() {
    await apiRequestAsync('POST', '/api/auth/logout', {});
    App.data = {};
    this._currentUser = null;
  },

  nextPage(fallback = 'index.html') {
    const next = this.pendingDestination();
    try {
      sessionStorage.removeItem('appet-auth-return');
    } catch {}
    return next || validateReturnDestination(fallback) || '/index.html';
  },
  rememberDestination(value) {
    const next = validateReturnDestination(value);
    try {
      if (next)
        sessionStorage.setItem('appet-auth-return', JSON.stringify({ path: next, at: Date.now() }));
      else sessionStorage.removeItem('appet-auth-return');
    } catch {}
    return next;
  },
  captureDestination() {
    const params = new URLSearchParams(location.search);
    return params.has('next')
      ? this.rememberDestination(params.get('next'))
      : this.pendingDestination();
  },
  pendingDestination() {
    const params = new URLSearchParams(location.search);
    if (params.has('next')) return validateReturnDestination(params.get('next'));
    try {
      const saved = JSON.parse(sessionStorage.getItem('appet-auth-return'));
      if (
        saved &&
        Number.isFinite(saved.at) &&
        saved.at <= Date.now() &&
        Date.now() - saved.at < 86400000
      )
        return validateReturnDestination(saved.path);
    } catch {}
    return null;
  },
  loginUrl(value) {
    const next = validateReturnDestination(value);
    return 'login.html' + (next ? '?next=' + encodeURIComponent(next) : '');
  },
  requireAuth(roles) {
    const user = this.getCurrentUser();
    if (!user) {
      window.location.href = this.loginUrl(location.pathname + location.search);
      return null;
    }
    if (roles && !roles.includes(user.role)) {
      window.location.href = 'index.html';
      return null;
    }
    return user;
  },
};
if (typeof module !== 'undefined' && module.exports) module.exports = { validateReturnDestination };
