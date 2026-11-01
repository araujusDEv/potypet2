const SUPPORT_CATEGORY_LABEL = {
  ong: 'ONG ou protetor',
  veterinario: 'Hospital ou atendimento veterinário',
  zoonoses: 'Vigilância de zoonoses',
  castracao: 'Castração',
  lar_temporario: 'Lar temporário',
  transporte: 'Transporte solidário',
  doacao: 'Doações',
};

function safeOfficialUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function renderSupportPoints() {
  const q = (document.getElementById('support-search')?.value || '').trim().toLowerCase();
  const category = document.getElementById('support-category')?.value || '';
  const points = Store.getSupportPoints().filter((point) => {
    const haystack = `${point.name} ${point.city} ${point.state} ${point.services}`.toLowerCase();
    return (!q || haystack.includes(q)) && (!category || point.category === category);
  });
  const el = document.getElementById('support-results');
  el.innerHTML = points.length
    ? points
        .map((point) => {
          const officialUrl = safeOfficialUrl(point.sourceUrl);
          return `
    <article class="card support-card">
      <div class="support-card-head"><span class="tag">${escapeHTML(SUPPORT_CATEGORY_LABEL[point.category] || point.category)}</span>${point.verified ? '<span class="verified-seal">' + svgIcon('shield-check') + ' Verificado</span>' : ''}</div>
      <h2>${escapeHTML(point.name)}</h2>
      <p><b>${escapeHTML(point.city)}/${escapeHTML(point.state)}</b>${point.address ? `<br>${escapeHTML(point.address)}` : ''}</p>
      ${point.services ? `<p>${escapeHTML(point.services)}</p>` : ''}
      ${point.contact ? `<p class="support-contact">Contato: ${escapeHTML(point.contact)}</p>` : ''}
      ${officialUrl ? `<a class="support-source" href="${escapeHTML(officialUrl)}" target="_blank" rel="noopener noreferrer">${svgIcon('arrow-up-right')} Confirmar dados na fonte oficial</a>` : ''}
    </article>`;
        })
        .join('')
    : '<div class="empty-state"><h3>Nenhum ponto encontrado</h3><p>A rede é publicada somente depois da conferência dos dados pela administração.</p></div>';
}

App.ready(() => {
  document.getElementById('support-search')?.addEventListener('input', renderSupportPoints);
  document.getElementById('support-category')?.addEventListener('change', renderSupportPoints);
  renderSupportPoints();
});
