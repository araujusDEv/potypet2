function renderContract() {
  const user = Auth.requireAuth();
  if (!user) return;
  const requestId = Number(getParam('request'));
  const el = document.getElementById('contract-content');
  try {
    const contract = Store.getContract(requestId);
    // Terms recorded before this rename have no brand snapshot: retain their Appet identity.
    const documentBrand = contract.brandName || 'Appet';
    const wordmark =
      documentBrand === 'PotyPet'
        ? '<span class="brand-adota">Poty</span><span class="brand-pet">Pet</span>'
        : documentBrand === 'Appet'
          ? '<span class="brand-adota">App</span><span class="brand-pet">et</span>'
          : escapeHTML(documentBrand);
    const legalNote =
      contract.legalNote ||
      `Estas são declarações registradas pelas contas autenticadas no ${documentBrand}. Não constituem assinatura certificada nem comprovação independente da entrega. A confirmação do termo é separada da conclusão e não altera o indicador de adoções. Para necessidades jurídicas específicas, procure orientação profissional.`;
    document.title = `Termo ${contract.code} · ${documentBrand}`;
    const confirmed = Boolean(contract.adopterAcknowledgedAt && contract.ownerAcknowledgedAt);
    const ownField =
      user.id === contract.adopterId
        ? 'adopterAcknowledgedAt'
        : user.id === contract.ownerId
          ? 'ownerAcknowledgedAt'
          : null;
    const recorded = (value) =>
      value
        ? `Registrada em ${new Date(value).toLocaleString('pt-BR')}`
        : 'Pendente: esta parte precisa ler e confirmar';
    el.innerHTML = `<article class="contract-document">
      <div class="contract-header"><div class="logo${documentBrand === 'PotyPet' ? ' document-current-brand' : ''}" role="img" aria-label="${escapeAttr(documentBrand)}"><span class="logo-mark"><img src="img/brand-symbol.png" alt=""></span><span class="brand-word" aria-hidden="true">${wordmark}</span></div><div><span>Termo de adoção responsável</span><b>${escapeHTML(contract.code)}</b></div></div>
      <h1>Compromisso de guarda responsável</h1>
      <p>Este termo reúne os compromissos de <b>${escapeHTML(contract.ownerName)}</b> e <b>${escapeHTML(contract.adopterName)}</b> sobre <b>${escapeHTML(contract.animalName)}</b> (${escapeHTML(contract.species)}${contract.breed ? `, ${escapeHTML(contract.breed)}` : ''}).</p>
      <div class="contract-parties"><div><span>Responsável anterior</span><b>${escapeHTML(contract.ownerName)}</b><small>${escapeHTML(contract.ownerCity || '')}</small></div><div><span>Adotante</span><b>${escapeHTML(contract.adopterName)}</b><small>${escapeHTML(contract.adopterCity || '')}</small></div><div><span>Data da adoção</span><b>${new Date(contract.acceptedAt).toLocaleDateString('pt-BR')}</b></div></div>
      <h2>Compromissos</h2><ol>${contract.clauses.map((c) => `<li>${escapeHTML(c)}</li>`).join('')}</ol>
      <p>Entrega informada pelo responsável: ${contract.handoverAt ? new Date(contract.handoverAt).toLocaleString('pt-BR') : 'sem registro separado nesta adoção anterior'}. Recebimento informado pelo adotante: ${contract.receiptConfirmedAt ? new Date(contract.receiptConfirmedAt).toLocaleString('pt-BR') : 'sem registro separado nesta adoção anterior'}.</p>
      <div class="contract-signatures"><div><span>Leitura e concordância do responsável</span><b>${recorded(contract.ownerAcknowledgedAt)}</b>${contract.workflowVersion !== 3 ? '<small>Registro anterior: a confirmação do responsável era gerada junto com a conclusão.</small>' : ''}</div><div><span>Leitura e concordância do adotante</span><b>${recorded(contract.adopterAcknowledgedAt)}</b></div></div>
      <p class="legal-note">${escapeHTML(legalNote)}</p>
      <div id="contract-alert" role="status"></div>
      <div class="contract-actions no-print">${ownField && !contract[ownField] && !user.historicalAccess ? '<label class="checkbox-row"><input type="checkbox" id="contract-consent"> Li o termo e concordo com os compromissos.</label><button class="btn btn-primary" id="confirm-contract">Registrar minha concordância</button>' : ''}${confirmed ? '<span class="alert alert-success">Concordância registrada pelas duas contas.</span>' : '<span class="alert alert-warning">Quem age: cada parte ainda pendente deve ler e confirmar seu termo.</span>'}<button class="btn btn-outline" data-action="print">Imprimir ou salvar em PDF</button></div>
    </article>`;
    document.getElementById('confirm-contract')?.addEventListener('click', async (event) => {
      const alert = document.getElementById('contract-alert');
      if (!document.getElementById('contract-consent').checked) {
        alert.textContent = 'Confirme a leitura e concordância antes de registrar.';
        return;
      }
      event.target.disabled = true;
      try {
        await Store.acknowledgeContract(requestId);
        renderContract();
      } catch (err) {
        alert.textContent = err.message;
        event.target.disabled = false;
      }
    });
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><h3>Termo indisponível</h3><p>${escapeHTML(err.message)}</p></div>`;
  }
}
App.ready(renderContract);
