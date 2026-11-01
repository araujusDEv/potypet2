function renderNotifications() {
  const user = Auth.requireAuth();
  if (!user) return;
  const list = Store.getNotifications(user.id);
  const content = document.getElementById('notifications-content');
  content.innerHTML = list.length
    ? list
        .map(
          (item) =>
            `<article class="notification-card ${item.read ? '' : 'unread'}"><span class="notification-icon">${svgIcon('bell')}</span><div><p>${escapeHTML(item.message)}</p><time datetime="${escapeAttr(item.createdAt)}">${new Date(item.createdAt).toLocaleString('pt-BR')}</time></div></article>`,
        )
        .join('')
    : '<div class="empty-state"><h3>Você não tem notificações.</h3><p>Os avisos importantes sobre sua conta e suas adoções aparecerão aqui.</p></div>';
}
App.ready(() => {
  if (!Auth.requireAuth()) return;
  document.getElementById('mark-all-read').addEventListener(
    'click',
    App.click(async () => {
      try {
        await Store.markNotificationsRead();
        renderNotifications();
        renderNav();
        showToast('Notificações marcadas como lidas.');
      } catch (err) {
        showToast(err.message);
      }
    }),
  );
  if (Auth.getCurrentUser()?.historicalAccess)
    document.getElementById('mark-all-read').disabled = true;
  renderNotifications();
});
