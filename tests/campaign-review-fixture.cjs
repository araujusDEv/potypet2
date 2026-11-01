'use strict';
// Only for isolated tests. These notes describe simulated checks, not real verification.
module.exports = (campaign, extra = {}) => ({
  revision: campaign.revision,
  scopes: ['identity', 'purpose', 'costs', 'receiver', 'evidence', 'accountability'],
  result: 'consistent',
  fileIds: campaign.files.filter((file) => !file.withdrawnAt).map((file) => file.id),
  note: 'Fixture fictícia: comparados organizador, finalidade, custos, recebedor, arquivos e apuração. Nenhuma confirmação externa real.',
  external: false,
  ...extra,
});
