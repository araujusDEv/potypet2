// Criptografia e descriptografia dos arquivos de backup, com verificação de integridade.
'use strict';
const fs = require('node:fs'),
  crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const HEADER = Buffer.from('APPET-BACKUP-1\n');
function key(value) {
  const decoded = Buffer.from(value || '', 'base64');
  if (decoded.length !== 32 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value || ''))
    throw Error('BACKUP_ENCRYPTION_KEY deve conter 32 bytes aleatórios em base64.');
  return decoded;
}
async function encrypt(source, destination, secret) {
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv('aes-256-gcm', key(secret), iv);
  fs.writeFileSync(destination, Buffer.concat([HEADER, iv]), { flag: 'wx', mode: 0o600 });
  try {
    await pipeline(
      fs.createReadStream(source),
      cipher,
      fs.createWriteStream(destination, { flags: 'a' }),
    );
    fs.appendFileSync(destination, cipher.getAuthTag());
  } catch (err) {
    fs.unlinkSync(destination);
    throw err;
  }
}
async function decrypt(source, destination, secret) {
  const size = fs.statSync(source).size,
    header = Buffer.alloc(HEADER.length + 12),
    tag = Buffer.alloc(16),
    file = fs.openSync(source, 'r');
  try {
    if (size < header.length + 17) throw Error('Backup criptografado inválido.');
    fs.readSync(file, header, 0, header.length, 0);
    fs.readSync(file, tag, 0, 16, size - 16);
  } finally {
    fs.closeSync(file);
  }
  if (!header.subarray(0, HEADER.length).equals(HEADER))
    throw Error('Formato de backup desconhecido.');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key(secret),
    header.subarray(HEADER.length),
  );
  decipher.setAuthTag(tag);
  // Reserve output atomically; never overwrite a file if the destination already exists.
  const descriptor = fs.openSync(destination, 'wx', 0o600);
  fs.closeSync(descriptor);
  try {
    await pipeline(
      fs.createReadStream(source, { start: header.length, end: size - 17 }),
      decipher,
      fs.createWriteStream(destination, { flags: 'w' }),
    );
  } catch {
    fs.unlinkSync(destination);
    throw Error(
      'Não foi possível autenticar o backup. Confira a chave e a integridade do arquivo.',
    );
  }
}
module.exports = { key, encrypt, decrypt };
