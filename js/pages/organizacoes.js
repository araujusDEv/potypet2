'use strict';
function organizationKind(type) {
  return type === 'ong'
    ? 'ONG'
    : type === 'grupo'
      ? 'Grupo independente'
      : 'Organização · tipo não informado';
}
App.ready(async () => {
  const params = new URLSearchParams(location.search),
    user = Auth.getCurrentUser(),
    content = document.getElementById('organization-content');
  if (user?.accountType === 'ong') document.getElementById('edit-organization').hidden = false;
  try {
    if (params.get('editar') === '1') {
      if (!Auth.requireAuth()) return;
      const profile = await fundApi('GET', '/api/organizations/me');
      content.innerHTML =
        '<p>' +
        fundEscape(user.name) +
        ' · ' +
        fundEscape(organizationKind(user.organizationKind)) +
        '</p><div class="workspace-actions"><a href="solicitar-campanha.html?tipo=continuo" class="btn btn-outline">Solicitar apoio contínuo</a><a href="organizacoes.html?id=' +
        user.id +
        '" class="btn btn-ghost">Ver página pública</a></div>';
      document.getElementById('organization-form').hidden = false;
      for (const key of ['city', 'state', 'description', 'area', 'contact'])
        document.getElementById('o-' + key).value = profile[key] || '';
      document.getElementById('o-consent').checked = !!profile.contactConsent;
      document.getElementById('organization-form').addEventListener(
        'submit',
        App.form(async (e) => {
          e.preventDefault();
          const btn = document.getElementById('save-organization');
          btn.disabled = true;
          try {
            const data = Object.fromEntries(
              ['city', 'state', 'description', 'area', 'contact'].map((k) => [
                k,
                document.getElementById('o-' + k).value,
              ]),
            );
            data.contactConsent = document.getElementById('o-consent').checked;
            data.photo = profile.photo || '';
            const file = document.getElementById('o-photo').files[0];
            if (file) data.photo = 'data:image/png;base64,' + (await campaignFile(file)).base64;
            const saved = await fundApi('PUT', '/api/organizations/me', data);
            profile.photo = saved.photo;
            document.getElementById('organization-status').textContent = 'Perfil público salvo.';
          } catch (err) {
            fundError(err);
          } finally {
            btn.disabled = false;
          }
        }),
      );
      return;
    }
    if (params.get('id')) {
      const o = await fundApi('GET', '/api/organizations/' + Number(params.get('id')));
      document.getElementById('organization-title').textContent = o.name;
      const campaignCard = (c) =>
        '<article class="workspace-card"><span class="eyebrow">' +
        fundEscape(c.kind === 'ongoing' ? 'Apoio contínuo' : FUND_PURPOSES[c.category]) +
        '</span><h3>' +
        fundEscape(c.title) +
        '</h3><p>' +
        fundEscape(c.description) +
        '</p><p>' +
        (c.kind === 'ongoing'
          ? 'Apoio às atividades, sem meta fixa.'
          : fundMoney(c.raisedCents) + ' informados de ' + fundMoney(c.goalCents)) +
        '</p><a class="btn btn-primary" href="doacoes.html?campanha=' +
        c.id +
        '">Conhecer e apoiar</a></article>';
      content.innerHTML =
        '<section class="workspace-card">' +
        (safeImageSrc(o.photo)
          ? '<img class="organization-logo" src="' +
            escapeAttr(safeImageSrc(o.photo)) +
            '" alt="Imagem de ' +
            escapeAttr(o.name) +
            '">'
          : '') +
        '<p class="workspace-meta">' +
        fundEscape(organizationKind(o.type)) +
        ' · ' +
        fundEscape(o.city) +
        '/' +
        fundEscape(o.state) +
        '</p><p class="preserve-lines">' +
        fundEscape(o.description) +
        '</p><p><strong>Atuação:</strong> ' +
        fundEscape(o.area) +
        '</p>' +
        (o.contact ? '<p><strong>Contato:</strong> ' + fundEscape(o.contact) + '</p>' : '') +
        '</section><h2>Apoio contínuo</h2>' +
        (o.campaigns
          .filter((c) => c.kind === 'ongoing')
          .map(campaignCard)
          .join('') || '<p>Ainda não há apoio contínuo aprovado.</p>') +
        '<h2>Campanhas com objetivo</h2><div class="organization-cards">' +
        (o.campaigns
          .filter((c) => c.kind !== 'ongoing')
          .map(campaignCard)
          .join('') || '<p>Nenhuma campanha publicada.</p>') +
        '</div><h2>Animais para adoção</h2><div class="organization-pets">' +
        (o.animals
          .map(
            (a) =>
              '<a href="animal.html?id=' +
              a.id +
              '">' +
              (safeImageSrc(a.photo)
                ? '<img src="' + escapeAttr(safeImageSrc(a.photo)) + '" alt="">'
                : '') +
              fundEscape(a.name) +
              '</a>',
          )
          .join('') || '<p>Nenhum anúncio de adoção disponível.</p>') +
        '</div><h2>Atualizações e prestação de contas</h2><ul class="history-list">' +
        (o.campaigns
          .flatMap((c) =>
            (c.updates || []).map(
              (up) =>
                '<li><strong>' +
                fundEscape(c.title) +
                '</strong><time>' +
                fundDate(up.createdAt) +
                '</time><p class="preserve-lines">' +
                fundEscape(up.note) +
                '</p><p>' +
                fundMoney(up.raisedCents) +
                ' informados manualmente.</p></li>',
            ),
          )
          .join('') || '<li>As atualizações aparecerão após análise administrativa.</li>') +
        '</ul>';
    } else {
      const list = await fundApi('GET', '/api/organizations');
      content.innerHTML =
        '<div class="organization-cards">' +
        (list
          .map(
            (o) =>
              '<article class="workspace-card">' +
              (safeImageSrc(o.photo)
                ? '<img class="organization-logo" src="' +
                  escapeAttr(safeImageSrc(o.photo)) +
                  '" alt="">'
                : '') +
              '<span class="eyebrow">' +
              fundEscape(organizationKind(o.type)) +
              '</span><h2>' +
              fundEscape(o.name) +
              '</h2><p>' +
              fundEscape(o.city) +
              '/' +
              fundEscape(o.state) +
              '</p><p>' +
              fundEscape(o.description.slice(0, 180)) +
              '</p><a class="btn btn-outline" href="organizacoes.html?id=' +
              o.id +
              '">Conhecer o trabalho</a></article>',
          )
          .join('') ||
          '<div class="campaign-empty"><h2>Uma rede em construção</h2><p>As organizações aprovadas aparecerão aqui quando preencherem seus perfis públicos.</p></div>') +
        '</div>';
    }
  } catch (e) {
    content.innerHTML = '';
    fundError(e);
  }
});
