// Critérios para aprovar o anúncio de um animal (fotos válidas e descrição) e o cálculo
// de uma impressão digital (hash) do anúncio. Os mínimos exigidos vêm de photo-policy.cjs.
'use strict';
const crypto = require('node:crypto'),
  validate = require('./input-validation.cjs'),
  { approval } = require('./photo-policy.cjs');
const fingerprint = (animal) =>
  crypto
    .createHash('sha256')
    .update(
      JSON.stringify([
        animal.description,
        animal.photos,
        animal.approvalStatus,
        animal.moderationHistory,
      ]),
    )
    .digest('hex');
async function assess(animal, root) {
  let validPhotoCount = 0;
  for (const photo of (animal.photos || []).slice(0, 3)) {
    try {
      await validate.image(photo, root, { checkOnly: true });
      validPhotoCount++;
    } catch (err) {
      if (err.status !== 400) throw err;
    }
  }
  const descriptionPresent =
    typeof animal.description === 'string' && Boolean(animal.description.trim());
  const descriptionLength =
    typeof animal.description === 'string' ? animal.description.trim().length : 0;
  const failed = [];
  if (validPhotoCount < approval.minPhotos)
    failed.push(`Inclua pelo menos ${approval.minPhotos} foto(s) tecnicamente válida(s).`);
  if (descriptionLength < approval.minDescriptionChars)
    failed.push(
      approval.minDescriptionChars === 1
        ? 'Preencha a descrição do animal.'
        : `A descrição deve ter pelo menos ${approval.minDescriptionChars} caracteres.`,
    );
  return { ...approval, validPhotoCount, descriptionPresent, descriptionLength, failed };
}
function exception(body, user) {
  if (body.approvalException === undefined) return null;
  if (user.role !== 'admin')
    throw Object.assign(Error('Somente a administração pode registrar exceções.'), { status: 403 });
  const value = body.approvalException;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => k !== 'reason')
  )
    validate.text(null, 1000, 'a justificativa da exceção');
  return { reason: validate.text(value.reason, 1000, 'a justificativa da exceção') };
}
function enforce(check, override) {
  if (check.failed.length && !override)
    throw Object.assign(
      Error(
        'Aprovação requer: ' +
          check.failed.join(' ') +
          ' A administração pode registrar uma exceção justificada.',
      ),
      { status: 400 },
    );
}
module.exports = { assess, fingerprint, exception, enforce };
