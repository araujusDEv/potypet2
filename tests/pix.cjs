'use strict';
const assert = require('node:assert/strict');
const { createPixPayload, crc16 } = require('../lib/pix.cjs');

function fields(payload) {
  const result = {};
  let offset = 0;
  while (offset < payload.length) {
    const id = payload.slice(offset, offset + 2);
    const length = Number(payload.slice(offset + 2, offset + 4));
    assert.ok(/^\d{2}$/.test(id) && length > 0);
    const value = payload.slice(offset + 4, offset + 4 + length);
    assert.equal(value.length, length);
    assert.equal(result[id], undefined);
    result[id] = value;
    offset += 4 + length;
  }
  assert.equal(offset, payload.length);
  return result;
}
// Published BCB fixture, including the independently known CRC 1D3D.
const bcbExample =
  '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D';
assert.equal(crc16(bcbExample.slice(0, -4)), '1D3D');
assert.equal(crc16('123456789'), '29B1');
const keys = [
  '00000000-0000-0000-0000-000000000000',
  '12345678900',
  '00038166000105',
  '+5561912345678',
  'fulano@example.test',
  'a'.repeat(64) + '@example.test',
];
for (const pixKey of keys) {
  for (const amountCents of [1, 10, 2500, 5079, 100000000]) {
    const payload = createPixPayload({
      pixKey,
      beneficiary: 'João & Organização de Proteção Animal',
      city: 'São Gonçalo do Amarante',
      amountCents,
    });
    const root = fields(payload),
      account = fields(root['26']);
    assert.equal(account['00'], 'br.gov.bcb.pix');
    assert.equal(account['01'], pixKey);
    assert.equal(root['54'], (amountCents / 100).toFixed(2));
    assert.equal(root['53'], '986');
    assert.equal(root['58'], 'BR');
    assert.equal(fields(root['62'])['05'], '***');
    assert.ok(root['59'].length <= 25 && root['60'].length <= 15);
    assert.match(payload, /^[\x20-\x7e]+$/);
    assert.equal(root['63'], crc16(payload.slice(0, -4)));
  }
}
for (const amountCents of [
  undefined,
  null,
  '2500',
  -1,
  0,
  1.1,
  NaN,
  Infinity,
  100000001,
  Number.MAX_SAFE_INTEGER,
]) {
  assert.throws(() => createPixPayload({ pixKey: keys[0], amountCents }), /valor entre/);
}
for (const pixKey of ['', 'a'.repeat(78), 'ação@example.test', 'test\n@example.test']) {
  assert.throws(() => createPixPayload({ pixKey, amountCents: 2500 }), /chave não permite/);
}

console.log(
  'OK — BR Code, CRC16, cinco tipos de chave e limites de valor. Integração exercitada em workflow.cjs.',
);
