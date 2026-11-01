(() => {
  try {
    document.documentElement.setAttribute(
      'data-theme',
      localStorage.getItem('petadopt_theme') === 'dark' ? 'dark' : 'light',
    );
  } catch {
    document.documentElement.setAttribute('data-theme', 'light');
  }
  const token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  history.replaceState(null, '', location.pathname + location.search);
  const form = document.getElementById('email-action-form'),
    button = document.getElementById('email-action-submit'),
    label = button.textContent;
  const message = (text, success = false) => {
    document.getElementById('email-action-alert').innerHTML =
      `<div class="alert alert-${success ? 'success' : 'error'}">${escapeHTML(text)}</div>`;
  };
  function preserveDestination(value) {
    const destination = Auth.rememberDestination(value);
    document.querySelectorAll('a[href^="login.html"], a[href^="/login.html"]').forEach((anchor) => {
      const url = new URL(anchor.getAttribute('href'), location.href);
      if (destination) url.searchParams.set('next', destination);
      else url.searchParams.delete('next');
      anchor.href = url.pathname + url.search;
    });
  }
  preserveDestination(Auth.captureDestination());
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    form.hidden = true;
    message('Abra o link recebido por e-mail. Se ele expirou, solicite outro pelos links abaixo.');
    return;
  }
  form.addEventListener(
    'submit',
    App.form(async (event) => {
      event.preventDefault();
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = 'Aguarde';
      const password = document.getElementById('account-password').value;
      try {
        const reset = form.dataset.action === 'reset';
        const result = await apiRequestAsync(
          'POST',
          reset ? '/api/auth/reset-password' : '/api/auth/verify-email',
          {
            token,
            password,
            ...(reset
              ? { passwordConfirmation: document.getElementById('account-confirmation').value }
              : {}),
          },
        );
        form.reset();
        form.hidden = true;
        message(result.message, true);
        if (result.returnTo) preserveDestination(result.returnTo);
      } catch (err) {
        message(err.message);
      } finally {
        button.disabled = false;
        button.setAttribute('aria-busy', 'false');
        button.textContent = label;
      }
    }),
  );
})();
