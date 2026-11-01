// Limites das fotos (formatos, tamanho, quantidade) e mínimo de fotos exigido para aprovar um anúncio.
'use strict';
const limits = Object.freeze({
  formats: ['image/jpeg', 'image/png', 'image/webp'],
  maxPhotos: 3,
  maxOriginalBytes: 20 * 1024 * 1024,
  maxProcessedBytes: 3 * 1024 * 1024,
  maxPixels: 20_000_000,
  maxDimension: 1280,
});
const raw = process.env.ANIMAL_APPROVAL_MIN_PHOTOS ?? '1';
if (!/^[1-3]$/.test(raw)) throw Error('ANIMAL_APPROVAL_MIN_PHOTOS deve ser 1, 2 ou 3.');
const description = process.env.ANIMAL_APPROVAL_MIN_DESCRIPTION_CHARS ?? '1';
if (!/^\d+$/.test(description) || Number(description) < 1 || Number(description) > 2000)
  throw Error('ANIMAL_APPROVAL_MIN_DESCRIPTION_CHARS deve ser inteiro entre 1 e 2000.');
if (process.env.ANIMAL_APPROVAL_REQUIRE_DESCRIPTION === '0')
  throw Error(
    'Descrição não pode ser dispensada globalmente. Registre uma exceção administrativa na decisão.',
  );
const approval = Object.freeze({
  version: '2026-10-13-photo-minimum',
  minPhotos: Number(raw),
  requireDescription: true,
  minDescriptionChars: Number(description),
});
module.exports = { limits, approval };
