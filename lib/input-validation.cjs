// Validação e limpeza do que chega pela API: textos, opções permitidas, IDs e fotos.
// O server.js usa estas funções antes de gravar qualquer coisa.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { PNG } = require('pngjs');
const { limits: photoLimits } = require('./photo-policy.cjs');
const STATES = new Set(
  'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '),
);
function invalid(message) {
  throw Object.assign(new Error(message), { status: 400 });
}
function text(value, max, label, required = true) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    value.includes('\0') ||
    (required && !value.trim())
  )
    invalid(`Confira ${label}.`);
  return value.trim();
}
function state(value) {
  const result = text(value, 2, 'o estado').toUpperCase();
  if (!STATES.has(result)) invalid('Informe uma UF brasileira válida.');
  return result;
}
function optionalText(value, max, label = 'o campo') {
  return value === undefined ? '' : text(value, max, label, false);
}
function boolean(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') invalid('Envie confirmações como verdadeiro ou falso.');
  return value;
}
function id(value) {
  if (!Number.isSafeInteger(value) || value < 1)
    invalid('Informe um identificador inteiro positivo.');
  return value;
}
function option(value, allowed, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!allowed.includes(value)) invalid('Selecione uma opção permitida.');
  return value;
}
function date(value) {
  const v = text(value, 10, 'a data');
  const parsed = new Date(v + 'T00:00:00.000Z');
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(),
  );
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== v ||
    v < '1900-01-01' ||
    v > today
  )
    invalid('Informe uma data existente, sem data futura.');
  return v;
}
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`Confira ${label}.`);
  return value;
}
const animalText = {
  name: 120,
  breed: 120,
  city: 120,
  neighborhood: 120,
  description: 2000,
  history: 3000,
  contact: 120,
  special_needs: 1200,
  health_notes: 1600,
};
const animalOptions = {
  species: ['cachorro', 'gato'],
  sex: ['macho', 'femea'],
  size: ['pequeno', 'medio', 'grande'],
  age_group: ['filhote', 'adulto', 'idoso'],
  energy_level: ['baixo', 'medio', 'alto'],
};
function animal(body, partial = false) {
  const result = {},
    defaults = {
      species: 'cachorro',
      sex: 'macho',
      size: 'medio',
      age_group: 'adulto',
      energy_level: 'medio',
    };
  for (const [key, max] of Object.entries(animalText))
    if (!partial || Object.hasOwn(body, key))
      result[key] = ['name', 'city'].includes(key)
        ? text(body[key], max, key)
        : optionalText(body[key], max, key);
  if (!partial || Object.hasOwn(body, 'state')) result.state = state(body.state);
  for (const [key, allowed] of Object.entries(animalOptions))
    if (!partial || Object.hasOwn(body, key))
      result[key] = option(body[key], allowed, defaults[key]);
  for (const key of ['neutered', 'vaccinated', 'dewormed', 'verified', 'featured'])
    if (!partial || Object.hasOwn(body, key)) result[key] = boolean(body[key]);
  if (Object.hasOwn(body, 'status'))
    option(body.status, [
      'disponivel',
      'em_processo',
      'adotado',
      'indisponivel',
      'aguardando_aprovacao',
    ]);
  if (Object.hasOwn(body, 'approvalStatus'))
    option(body.approvalStatus, ['approved', 'pending', 'rejected']);
  if (Object.hasOwn(body, 'personality')) {
    result.personality =
      body.personality === null ? null : { ...object(body.personality, 'a personalidade') };
    for (const [key, v] of Object.entries(result.personality || {}))
      if (
        !['energy', 'sociability', 'affection', 'independence', 'playful', 'calm'].includes(key) ||
        !Number.isInteger(v) ||
        v < 1 ||
        v > 5
      )
        invalid('A personalidade deve usar as opções previstas, com valores de 1 a 5.');
  }
  if (Object.hasOwn(body, 'coexistence')) {
    const values = object(body.coexistence, 'a convivência');
    result.coexistence = { kids: 'nao_informado', dogs: 'nao_informado', cats: 'nao_informado' };
    for (const [key, v] of Object.entries(values)) {
      if (!Object.hasOwn(result.coexistence, key)) invalid('Opção de convivência inválida.');
      result.coexistence[key] = option(v, ['sim', 'nao', 'nao_informado']);
    }
  }
  return result;
}
const missingText = {
  name: 120,
  breed: 120,
  color: 120,
  approx_age: 80,
  last_seen_location: 300,
  city: 120,
  contact: 120,
  features: 1600,
  reward: 120,
};
function missing(body, partial = false) {
  const result = {};
  for (const [key, max] of Object.entries(missingText))
    if (!partial || Object.hasOwn(body, key))
      result[key] = key === 'city' ? text(body[key], max, key) : optionalText(body[key], max, key);
  if (!partial || Object.hasOwn(body, 'state')) result.state = state(body.state);
  if (!partial || Object.hasOwn(body, 'missing_date'))
    result.missing_date = date(body.missing_date);
  if (!partial || Object.hasOwn(body, 'species'))
    result.species = option(body.species, ['cachorro', 'gato'], 'cachorro');
  if (Object.hasOwn(body, 'found')) result.found = boolean(body.found);
  return result;
}
function profile(body) {
  const choices = {
    housing: ['casa', 'apartamento', 'sitio', 'outro'],
    has_yard: ['sim', 'nao'],
    has_kids: ['sim', 'nao'],
    other_pets: ['nao', 'cachorro', 'gato', 'outros'],
    alone_time: ['menos_2h', '2_4h', '4_8h', 'mais_8h'],
    experience: ['nenhuma', 'pouca', 'moderada', 'muita'],
    species: ['qualquer', 'cachorro', 'gato'],
    age: ['qualquer', 'filhote', 'adulto', 'idoso'],
    size: ['qualquer', 'pequeno', 'medio', 'grande'],
    energy: ['baixo', 'medio', 'alto'],
    availability: ['baixa', 'media', 'alta'],
  };
  for (const [key, allowed] of Object.entries(choices))
    if (Object.hasOwn(body, key)) option(body[key], allowed);
}
function adoption(body) {
  text(body.city, 120, 'a cidade');
  text(body.reason, 2000, 'o motivo da adoção');
  if (body.full_name !== undefined) text(body.full_name, 120, 'o nome completo');
  if (body.age !== undefined && body.age !== '') {
    if (
      !['string', 'number'].includes(typeof body.age) ||
      !/^\d+$/.test(String(body.age)) ||
      Number(body.age) < 18 ||
      Number(body.age) > 120
    )
      invalid('Informe uma idade entre 18 e 120 anos, ou deixe o campo vazio.');
  }
  if (!['casa', 'apartamento', 'sitio'].includes(body.housing))
    invalid('Informe o tipo de moradia.');
  const q = body.questionnaire;
  if (!q || typeof q !== 'object' || Array.isArray(q))
    invalid('Responda ao questionário de adoção.');
  for (const key of ['household_agrees', 'financial_conditions', 'vet_commitment'])
    if (!['sim', 'nao'].includes(q[key]))
      invalid('Responda às perguntas obrigatórias do questionário.');
  if (q.had_pets_before !== undefined && !['sim', 'nao'].includes(q.had_pets_before))
    invalid('Confira a experiência anterior com animais.');
  if (
    q.had_pets_before !== undefined &&
    body.experience !== undefined &&
    body.experience !== (q.had_pets_before === 'sim')
  )
    invalid('As informações de experiência anterior devem ser coerentes.');
  boolean(body.contactConsent);
  if (!['menos_2h', '2_4h', '4_8h', 'mais_8h'].includes(q.alone_time))
    invalid('Informe por quanto tempo o animal ficará sozinho.');
  text(q.adaptation_plan, 1000, 'o plano de adaptação');
  if (body.responsibility_confirmed !== true)
    invalid('Confirme o compromisso com a adoção responsável.');
  for (const key of ['has_yard', 'has_pets', 'experience']) boolean(body[key]);
}
function followup(body) {
  if (!['otima', 'boa', 'dificil'].includes(body.adaptation))
    invalid('Selecione como está a adaptação.');
  text(body.health, 1200, 'o relato de saúde');
  text(body.behavior, 1200, 'o relato de comportamento');
  boolean(body.needsHelp);
}
async function image(value, root, options = {}) {
  if (typeof value !== 'string') invalid('Envie uma imagem PNG, JPEG ou WebP válida.');
  let bytes, mime, local;
  if (/^img\/[a-zA-Z0-9_-]+\.(png|jpe?g|webp)$/i.test(value)) {
    local = value;
    try {
      bytes = fs.readFileSync(path.join(root, value));
    } catch {
      invalid('A imagem selecionada não existe.');
    }
  } else {
    const match = value.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) invalid('Formato não suportado ou arquivo inválido. Use JPG, PNG ou WebP.');
    if (match[2].length % 4 !== 0) invalid('A foto contém base64 inválido.');
    if (match[2].length > Math.ceil(photoLimits.maxProcessedBytes / 3) * 4)
      invalid('A foto enviada ainda excede 3 MB. Reduza a imagem antes do envio.');
    mime = match[1] === 'jpg' ? 'jpeg' : match[1];
    bytes = Buffer.from(match[2], 'base64');
    if (bytes.length > 3 * 1024 * 1024 || bytes.toString('base64') !== match[2])
      invalid('A imagem excede 3 MB ou contém base64 inválido.');
  }
  const detected = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? 'png'
    : bytes[0] === 255 && bytes[1] === 216
      ? 'jpeg'
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
        ? 'webp'
        : '';
  if (!detected || (mime && mime !== detected))
    invalid('O conteúdo da foto não corresponde ao formato informado.');
  try {
    const decoder = sharp(bytes, { failOn: 'warning', limitInputPixels: photoLimits.maxPixels });
    const meta = await decoder.metadata();
    if (
      !['png', 'jpeg', 'webp'].includes(meta.format) ||
      (mime && mime !== meta.format) ||
      (meta.pages || 1) > 1
    )
      invalid('O conteúdo da foto não corresponde a uma imagem permitida.');
    if (meta.format === 'png') PNG.sync.read(bytes, { checkCRC: true });
    // Decode all pixels; metadata alone does not detect truncated image content.
    const pipeline = decoder.rotate().resize({
      width: photoLimits.maxDimension,
      height: photoLimits.maxDimension,
      fit: 'inside',
      withoutEnlargement: true,
    });
    // Re-encode pixels without keepMetadata/withMetadata: EXIF/GPS/XMP are discarded.
    const output = options.compress
      ? await pipeline
          .flatten({ background: '#ffffff' })
          .jpeg({ quality: 85, mozjpeg: true })
          .toBuffer()
      : await pipeline.png().toBuffer();
    if (!options.checkOnly && output.length > photoLimits.maxProcessedBytes)
      invalid('A imagem processada ainda excede 3 MB. Escolha uma foto menor.');
    if (options.checkOnly) return value; // Approval checks never rewrite old photos.
    // Existing bundled assets retain their references; new uploaded bytes are always sanitized.
    return (
      local ||
      'data:image/' + (options.compress ? 'jpeg' : 'png') + ';base64,' + output.toString('base64')
    );
  } catch (err) {
    if (err.status === 400) throw err;
    invalid(
      'Imagem corrompida, incompleta ou acima de 20 milhões de pixels. Use uma foto JPG, PNG ou WebP válida.',
    );
  }
}
async function photos(value, root) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 3) invalid('Envie no máximo três fotos.');
  const result = [];
  for (const photo of value) result.push(await image(photo, root, { compress: true }));
  return result;
}
module.exports = {
  text,
  optionalText,
  boolean,
  id,
  option,
  date,
  animal,
  missing,
  profile,
  state,
  adoption,
  followup,
  image,
  photos,
};
