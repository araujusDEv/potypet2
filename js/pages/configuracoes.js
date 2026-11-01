App.ready(() => {
  const user = Auth.requireAuth();
  if (!user) return;
  document.getElementById('settings-name').value = user.name || '';
  document.getElementById('settings-email').value = user.email || '';
  document.getElementById('settings-city').value = user.city || '';
  document.getElementById('settings-state').value = user.state || '';
  document.getElementById('settings-phone').value = user.phone || '';
  document.getElementById('account-type-copy').textContent =
    {
      usuario: 'Usuário — pode adotar e publicar animais próprios.',
      ong: 'ONG / protetor — pode publicar e analisar interessados nos próprios animais.',
      admin: 'Administrador — gerencia toda a plataforma.',
    }[user.accountType] || 'Conta ativa.';
  document.getElementById('account-approval-copy').textContent =
    user.accountType === 'ong'
      ? `Situação: ${{ aprovado: 'aprovada', pendente: 'aguardando análise', reprovado: 'reprovada', suspenso: 'suspensa' }[user.approvalStatus] || user.approvalStatus}`
      : '';
  if (user.accountModerationHistory?.length) {
    const history = document.createElement('details');
    history.id = 'account-decision-history';
    history.innerHTML =
      '<summary>Decisões administrativas da conta</summary>' +
      user.accountModerationHistory
        .map(
          (h) =>
            '<p><b>' +
            escapeHTML(h.action === 'suspend' ? 'Suspensão' : 'Reativação') +
            '</b> · ' +
            escapeHTML(h.actorName) +
            ' · ' +
            escapeHTML(new Date(h.at).toLocaleString('pt-BR')) +
            '<br>' +
            escapeHTML(h.reason) +
            '</p>',
        )
        .join('');
    document.getElementById('account-approval-copy').after(history);
  }
  document.getElementById('settings-theme').addEventListener('click', toggleTheme);
  document.getElementById('settings-form').addEventListener(
    'submit',
    App.form(async (event) => {
      event.preventDefault();
      const alert = document.getElementById('settings-alert');
      try {
        const result = await Store.updateMyProfile({
          name: document.getElementById('settings-name').value,
          city: document.getElementById('settings-city').value,
          state: document.getElementById('settings-state').value.toUpperCase(),
          phone: document.getElementById('settings-phone').value,
        });
        Auth._currentUser = result.user;
        alert.innerHTML = '<div class="alert alert-success">Dados atualizados com sucesso.</div>';
        renderNav();
      } catch (err) {
        alert.innerHTML = `<div class="alert alert-error">${escapeHTML(err.message)}</div>`;
      }
    }),
  );
});
