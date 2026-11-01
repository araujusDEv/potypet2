/* Private request tools shared by the applicant and the responsible person's panel. */
function adoptionNextStep(r) {
  if (r.status === 'pendente' || r.status === 'em_analise')
    return 'Quem age: responsável. Próximo passo: analisar o formulário e aprovar ou recusar o interesse. O interessado pode responder pela conversa privada.';
  if (r.status === 'aprovada' && !r.handoverAt)
    return 'Quem age: as duas partes. Próximo passo: combinar contato e entrega. Depois da entrega, o responsável deve registrá-la; aprovação do interesse ainda não é adoção concluída.';
  if (r.status === 'aprovada' && !r.receiptConfirmedAt)
    return 'Quem age: interessado. Próximo passo: confirmar que recebeu o animal. O responsável já registrou a entrega.';
  if (r.status === 'aprovada')
    return 'Quem age: responsável. Próximo passo: revisar a entrega e o recebimento confirmados e concluir a adoção.';
  if (r.status === 'concluida')
    return 'Quem age: cada parte. Próximo passo: abrir o termo e registrar sua leitura e concordância. O adotante envia os acompanhamentos de 7, 30 e 90 dias; o responsável responde aos pedidos de ajuda.';
  return 'Pedido encerrado. Não há nova ação de adoção neste pedido. Consulte o motivo e o histórico; o interessado pode conhecer outros animais disponíveis.';
}
function requestContactHTML(r, user) {
  const applicant = Number(r.requesterId) === user.id,
    other = applicant ? r.owner : r.requester;
  const share = applicant ? r.requesterContactConsent : r.ownerContactConsent;
  const active = ['pendente', 'em_analise', 'aprovada', 'concluida'].includes(r.status);
  return `<details class="private-request-contact" data-request-id="${Number(r.id)}"><summary>Conversa e contatos privados</summary><p>Somente as partes e a administração acessam esta conversa. Não inclua senhas, documentos ou dados desnecessários.</p>
    ${other?.email || other?.phone ? `<p><b>Contato autorizado da outra parte:</b> ${other.email ? `<a href="mailto:${escapeAttr(encodeURIComponent(other.email))}">${escapeHTML(other.email)}</a>` : ''} ${escapeHTML(other.phone || '')}</p>` : '<p>A outra parte ainda não autorizou compartilhar e-mail e telefone. Use a conversa abaixo.</p>'}
    ${!user.historicalAccess && (applicant || Number(r.ownerId) === user.id) ? `<label class="checkbox-row"><input type="checkbox" class="share-request-contact" data-request="${Number(r.id)}" ${share ? 'checked' : ''}> Compartilhar meu e-mail e telefone com a outra parte deste pedido (posso revogar).</label>` : ''}
    <div class="request-messages">${(r.messages || []).map((m) => `<p><b>${escapeHTML(m.senderName || 'Participante')}</b> · ${new Date(m.createdAt).toLocaleString('pt-BR')}<br><span style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHTML(m.text)}</span></p>`).join('') || '<p>Nenhuma mensagem ainda.</p>'}</div>
    <div class="request-contact-alert" role="status"></div>
    ${active && !user.historicalAccess ? `<form class="private-message-form" data-request="${Number(r.id)}"><label>Mensagem privada<textarea required maxlength="1500" rows="3"></textarea></label><button class="btn btn-outline btn-sm" type="submit">Enviar mensagem</button></form>` : ''}</details>`;
}
function refreshAdoptionArea(sentId) {
  const opened = [...document.querySelectorAll('.private-request-contact[open]')].map(
    (el) => el.dataset.requestId,
  );
  const drafts = [...document.querySelectorAll('.private-message-form')]
    .filter((form) => Number(form.dataset.request) !== Number(sentId))
    .map((form) => ({ id: form.dataset.request, text: form.querySelector('textarea').value }));
  if (typeof renderMinhasSolicitacoes === 'function') renderMinhasSolicitacoes();
  else if (typeof renderSolicitacoesTab === 'function') renderSolicitacoesTab();
  for (const id of opened) {
    const details = document.querySelector(
      '.private-request-contact[data-request-id="' + id + '"]',
    );
    if (details) details.open = true;
  }
  for (const draft of drafts) {
    const textarea = document.querySelector(
      '.private-message-form[data-request="' + draft.id + '"] textarea',
    );
    if (textarea) textarea.value = draft.text;
  }
}
document.addEventListener('submit', async (event) => {
  const form = event.target.closest('.private-message-form');
  if (!form) return;
  event.preventDefault();
  const button = form.querySelector('button');
  if (button.disabled) return;
  button.disabled = true;
  const alert = form.closest('details').querySelector('.request-contact-alert'),
    text = form.querySelector('textarea').value;
  if (form.dataset.text !== text) {
    form.dataset.token = crypto.randomUUID();
    form.dataset.text = text;
  }
  try {
    await Store.sendRequestMessage(Number(form.dataset.request), text, form.dataset.token);
    refreshAdoptionArea(Number(form.dataset.request));
    showToast('Mensagem enviada.');
  } catch (err) {
    alert.innerHTML = `<div class="alert alert-error">${escapeHTML(err.message)}</div>`;
    button.disabled = false;
  }
});
document.addEventListener('change', async (event) => {
  if (!event.target.matches('.share-request-contact')) return;
  const input = event.target;
  try {
    await Store.shareRequestContact(Number(input.dataset.request), input.checked);
    showToast(
      input.checked ? 'Contatos compartilhados para este pedido.' : 'Compartilhamento revogado.',
    );
  } catch (err) {
    input.checked = !input.checked;
    input.closest('details').querySelector('.request-contact-alert').textContent = err.message;
  }
});
