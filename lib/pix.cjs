'use strict';

// Static BR Code: BCB Manual de Padrões para Iniciação do Pix, sections 2.5–2.6.
function invalid(message) {
  throw Object.assign(new Error(message), { status: 400 });
}
function field(id, value) {
  const length = Buffer.byteLength(value, 'utf8');
  if (!length || length > 99) invalid('Dados da campanha incompatíveis com o QR Code Pix.');
  return id + String(length).padStart(2, '0') + value;
}
function crc16(value) {
  let crc = 0xffff;
  for (const byte of Buffer.from(value, 'utf8')) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
function merchantText(value, max, fallback) {
  return (
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max)
      .trim() || fallback
  );
}
function createPixPayload({ pixKey, beneficiary, city, amountCents }) {
  if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > 100000000) {
    invalid('Informe um valor entre R$ 0,01 e R$ 1.000.000, com até duas casas decimais.');
  }
  // Never truncate or otherwise change the payment destination.
  if (typeof pixKey !== 'string' || !/^[\x21-\x7e]{1,77}$/.test(pixKey)) {
    invalid(
      'Esta chave não permite gerar QR Code Pix. Use a chave diretamente no banco ou fale com o responsável.',
    );
  }
  const amount = Math.floor(amountCents / 100) + '.' + String(amountCents % 100).padStart(2, '0');
  const payload =
    field('00', '01') +
    field('26', field('00', 'br.gov.bcb.pix') + field('01', pixKey)) +
    field('52', '0000') +
    field('53', '986') +
    field('54', amount) +
    field('58', 'BR') +
    field('59', merchantText(beneficiary, 25, 'BENEFICIARIO')) +
    field('60', merchantText(city, 15, 'BRASIL')) +
    field('62', field('05', '***')) +
    '6304';
  return payload + crc16(payload);
}

module.exports = { createPixPayload, crc16 };
