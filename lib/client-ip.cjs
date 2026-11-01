// Descobre o IP de quem fez a requisição, usado nos limites de tentativas.
// Só confia no cabeçalho X-Forwarded-For quando TRUST_PROXY=1 e o proxy está em TRUSTED_PROXY_IPS.
'use strict';
const { BlockList, isIP } = require('node:net');
const trusted = new BlockList();
const normalize = (ip) => String(ip || '').replace(/^::ffff:/i, '');
if (process.env.TRUST_PROXY !== undefined && !['0', '1'].includes(process.env.TRUST_PROXY))
  throw Error('TRUST_PROXY deve ser 0 ou 1.');
const entries = (process.env.TRUSTED_PROXY_IPS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
for (const entry of entries) {
  const parts = entry.split('/'),
    [address, bits] = parts;
  const family = isIP(address);
  if (
    parts.length > 2 ||
    !family ||
    (bits !== undefined &&
      (!/^\d+$/.test(bits) || Number(bits) < 1 || Number(bits) > (family === 4 ? 32 : 128)))
  )
    throw Error(
      'TRUSTED_PROXY_IPS contém endereço/rede inválida ou confiança irrestrita. Não use /0.',
    );
  if (bits === undefined) trusted.addAddress(address, family === 4 ? 'ipv4' : 'ipv6');
  else trusted.addSubnet(address, Number(bits), family === 4 ? 'ipv4' : 'ipv6');
}
function isTrusted(ip) {
  const family = isIP(ip);
  return family && trusted.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}
module.exports = (req) => {
  const remote = normalize(req.socket.remoteAddress) || 'local';
  if (process.env.TRUST_PROXY !== '1' || !isTrusted(remote)) return remote;
  const header = String(req.headers['x-forwarded-for'] || '');
  const chain = header.split(',').map((s) => normalize(s.trim()));
  if (header.length > 512 || chain.some((ip) => !isIP(ip))) return remote;
  let current = remote;
  for (let i = chain.length - 1; i >= 0 && isTrusted(current); i--) current = chain[i];
  return current;
};
module.exports.configuration = {
  enabled: process.env.TRUST_PROXY === '1',
  trustedEntries: entries.length,
  mode: process.env.TRUST_PROXY === '1' && entries.length ? 'trusted_hops' : 'socket_only',
  providerVerified: false,
};
