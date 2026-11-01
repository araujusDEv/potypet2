document.getElementById('contact-form').addEventListener(
  'submit',
  App.form(async (e) => {
    e.preventDefault();
    const wrapper = document.getElementById('contact-wrapper');
    try {
      const message = document.getElementById('c-message').value;
      if (message.length > 5000)
        throw new Error(
          'A mensagem deve ter até 5000 caracteres. Seu texto foi preservado; revise antes de enviar.',
        );
      const result = await Store.sendContact({
        name: document.getElementById('c-name').value,
        email: document.getElementById('c-email').value,
        message,
      });
      wrapper.innerHTML = `<div class="alert alert-success">Mensagem completa registrada na fila administrativa.<br><b>Protocolo: ${escapeHTML(result.protocol)}</b><p style="color:inherit;">Guarde o protocolo. Registro não comprova leitura, resposta humana ou envio de e-mail. [A DEFINIR: responsável, canal oficial e prazos aplicáveis]. O site não envia confirmação ou resposta automática por este formulário.</p></div>`;
    } catch (err) {
      let alert = document.getElementById('contact-alert');
      if (!alert) {
        alert = document.createElement('div');
        alert.id = 'contact-alert';
        e.currentTarget.prepend(alert);
      }
      alert.innerHTML = `<div class="alert alert-error">${escapeHTML(err.message)}</div>`;
    }
  }),
);
