function setRegisterLoading(loading) {
  const button = document.getElementById('register-submit');
  button.disabled = loading;
  button.setAttribute('aria-busy', String(loading));
  button.textContent = loading ? 'Criando conta' : 'Criar conta';
}
function showRegisterMessage(message, type = 'error') {
  document.getElementById('alert-area').innerHTML =
    `<div class="alert alert-${type}">${escapeHTML(message)}</div>`;
}
document.querySelectorAll('[data-password-target]').forEach((button) =>
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.passwordTarget);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.innerHTML = svgIcon(show ? 'eye-off' : 'eye');
    button.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
    input.focus();
  }),
);
document.getElementById('r-type').addEventListener('change', (event) => {
  document.getElementById('ong-notice').hidden = event.target.value !== 'ong';
  document.getElementById('organization-kind-field').hidden = event.target.value !== 'ong';
});
document.getElementById('r-password').addEventListener('input', (event) => {
  const value = event.target.value;
  let score = 0;
  if (value.length >= 8) score++;
  if (/[A-Za-zÀ-ÿ]/.test(value) && /\d/.test(value)) score++;
  if (/[^A-Za-zÀ-ÿ0-9]/.test(value) && value.length >= 10) score++;
  const meter = document.getElementById('password-strength');
  meter.className = `password-strength ${score >= 3 ? 'strength-strong' : score >= 2 ? 'strength-good' : ''}`;
});
document.getElementById('registro-form').addEventListener(
  'submit',
  App.form(async (event) => {
    event.preventDefault();
    document.getElementById('alert-area').innerHTML = '';
    const password = document.getElementById('r-password').value;
    const confirmation = document.getElementById('r-confirm').value;
    if (password !== confirmation) {
      showRegisterMessage('As senhas informadas não são iguais.');
      document.getElementById('r-confirm').focus();
      return;
    }
    setRegisterLoading(true);
    try {
      const result = await Auth.register({
        name: document.getElementById('r-name').value,
        email: document.getElementById('r-email').value,
        phone: document.getElementById('r-phone').value,
        city: document.getElementById('r-city').value,
        state: document.getElementById('r-state').value.toUpperCase(),
        accountType: document.getElementById('r-type').value,
        organizationKind: document.getElementById('r-organization-kind').value,
        password,
        passwordConfirmation: confirmation,
        termsAccepted: document.getElementById('r-terms').checked,
      });
      if (result.pendingApproval || result.pendingEmailVerification) {
        showRegisterMessage(result.message, 'success');
        document.getElementById('registro-form').reset();
        document.getElementById('ong-notice').hidden = true;
        setRegisterLoading(false);
      } else window.location.href = Auth.nextPage();
    } catch (err) {
      showRegisterMessage(err.message);
      setRegisterLoading(false);
    }
  }),
);

const registerNext = Auth.captureDestination();
if (registerNext)
  document
    .querySelectorAll('a[href="login.html"]')
    .forEach((a) => (a.href = 'login.html?next=' + encodeURIComponent(registerNext)));
