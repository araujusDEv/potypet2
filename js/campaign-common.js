// Peças comuns das páginas de campanha: estados, selos, prévia e envio de arquivos.
'use strict';
const CAMPAIGN_STATES = {
  draft: 'Rascunho',
  review: 'Em análise',
  changes: 'Ajustes solicitados',
  active: 'Ativa',
  rejected: 'Reprovada',
  paused: 'Pausada',
  closed: 'Encerrada',
  archived: 'Rascunho arquivado',
};
const CAMPAIGN_STEPS = {
  draft: 'Complete os dados e envie para análise.',
  review: 'Aguarde a decisão da equipe. Você será notificado aqui.',
  changes: 'Confira a justificativa, ajuste os dados e reenvie.',
  active: 'Publique atualizações ou solicite alterações para revisão.',
  rejected: 'Confira o motivo. Você pode corrigir e reenviar.',
  paused: 'Envie a prestação de contas e fale com a equipe para retomar.',
  closed: 'Recebimento encerrado. Você pode enviar uma prestação de contas sem reabrir o Pix.',
  archived: 'Rascunho preservado. Restaure-o para continuar ou consulte seu histórico.',
};
const CAMPAIGN_CHECK_SCOPES = {
  identity: 'Identidade do organizador',
  purpose: 'Finalidade e necessidade',
  costs: 'Composição dos custos',
  receiver: 'Recebedor e chave Pix',
  evidence: 'Evidências do caso',
  accountability: 'Prestação de contas',
};
const CAMPAIGN_CHECK_RESULTS = {
  consistent: 'Coerente com a conferência realizada',
  uncertain: 'Não confirmado',
  inconsistent: 'Divergência encontrada',
};
const FUND_PURPOSES = {
  cirurgia: 'Cirurgia',
  tratamento: 'Tratamento',
  alimentacao: 'Alimentação',
  acolhimento: 'Acolhimento',
};
const fundMoney = (cents) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((cents || 0) / 100);
const fundDate = (value) => (value ? new Date(value).toLocaleString('pt-BR') : 'Não informado');
const fundApi = (method, route, body) => apiRequestAsync(method, route, body);
const fundEscape = escapeHTML;
function fundBadge(state) {
  return (
    '<span class="campaign-badge state-' +
    escapeAttr(state) +
    '">' +
    fundEscape(CAMPAIGN_STATES[state] || state) +
    '</span>'
  );
}
function fundError(error, id = 'workspace-error') {
  const el = document.getElementById(id);
  el.textContent = error.message || error;
  el.hidden = false;
  el.focus();
}
function campaignPreview(d) {
  return (
    '<div class="review-preview"><span class="eyebrow">' +
    fundEscape(d.kind === 'ongoing' ? 'Apoio contínuo' : FUND_PURPOSES[d.category]) +
    '</span><h2>' +
    fundEscape(d.title || 'Título da campanha') +
    '</h2><p>' +
    fundEscape(d.beneficiaryName) +
    ' · ' +
    fundEscape(d.city) +
    '/' +
    fundEscape(d.state) +
    '</p><p class="preserve-lines">' +
    fundEscape(d.description) +
    '</p><p><strong>' +
    (d.kind === 'ongoing' ? 'Sem meta fixa' : fundMoney(d.goalCents) + ' de meta') +
    '</strong></p><h3>Composição dos custos</h3><p class="preserve-lines">' +
    fundEscape(d.costs) +
    '</p><p><strong>Responsável:</strong> ' +
    fundEscape(d.organizer) +
    ' · ' +
    fundEscape(d.contact) +
    '</p><p><strong>Recebedor do Pix:</strong> ' +
    fundEscape(d.beneficiary) +
    '</p><p>Nome informado pelo responsável; não confirmado pelo banco.</p></div>'
  );
}
async function campaignFile(file) {
  if (file.type === 'application/pdf') {
    if (file.size > 4 * 1024 * 1024) throw Error('O PDF deve ter até 4 MB.');
    return { name: file.name, mime: 'application/pdf', base64: await base64File(file) };
  }
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024)
    throw Error('Use PDF de até 4 MB ou foto JPG, PNG ou WebP de até 8 MB.');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const base64 = canvas.toDataURL('image/png').split(',')[1];
  if (base64.length > 5.5 * 1024 * 1024)
    throw Error('A foto ficou grande demais. Use uma imagem menor.');
  return { name: file.name.replace(/\.[^.]+$/, '') + '.png', mime: 'image/png', base64 };
}
function base64File(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(Error('Não foi possível ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}
