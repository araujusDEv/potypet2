'use strict';
const sharp = require('sharp'),
  crypto = require('node:crypto');
function exif(jpeg, orientation = 6) {
  // Synthetic TIFF: orientation and GPS IFD with latitude/longitude. Test data only.
  const t = Buffer.alloc(152);
  t.write('II', 0);
  t.writeUInt16LE(42, 2);
  t.writeUInt32LE(8, 4);
  t.writeUInt16LE(2, 8);
  function entry(offset, tag, type, count, value) {
    t.writeUInt16LE(tag, offset);
    t.writeUInt16LE(type, offset + 2);
    t.writeUInt32LE(count, offset + 4);
    t.writeUInt32LE(value, offset + 8);
  }
  entry(10, 274, 3, 1, orientation);
  entry(22, 34853, 4, 1, 38);
  t.writeUInt16LE(5, 38);
  entry(40, 0, 1, 4, 0x00000302);
  entry(52, 1, 2, 2, 78);
  entry(64, 2, 5, 3, 104);
  entry(76, 3, 2, 2, 87);
  entry(88, 4, 5, 3, 128);
  for (const [offset, value] of [
    [104, 5],
    [112, 30],
    [120, 0],
    [128, 37],
    [136, 45],
    [144, 0],
  ]) {
    t.writeUInt32LE(value, offset);
    t.writeUInt32LE(1, offset + 4);
  }
  const payload = Buffer.concat([Buffer.from('Exif\0\0'), t]),
    head = Buffer.alloc(4);
  head[0] = 255;
  head[1] = 225;
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), head, payload, jpeg.subarray(2)]);
}
module.exports = async () => {
  const raw = Buffer.alloc(60 * 100 * 3);
  for (let y = 0; y < 100; y++)
    for (let x = 0; x < 60; x++) {
      const i = (y * 60 + x) * 3;
      raw[i] = x < 30 ? 240 : 20;
      raw[i + 1] = y < 50 ? 200 : 30;
      raw[i + 2] = x >= 30 ? 240 : 20;
    }
  const input = sharp(raw, { raw: { width: 60, height: 100, channels: 3 } }),
    jpeg = await input.clone().jpeg({ quality: 95 }).toBuffer(),
    png = await input.clone().png().toBuffer(),
    webp = await input.clone().webp({ quality: 95 }).toBuffer();
  const noise = crypto.randomBytes(1400 * 1400 * 3),
    large = await sharp(noise, { raw: { width: 1400, height: 1400, channels: 3 } })
      .png()
      .toBuffer();
  const medium = await sharp(noise.subarray(0, 900 * 900 * 3), {
    raw: { width: 900, height: 900, channels: 3 },
  })
    .png()
    .toBuffer();
  return { jpeg, png, webp, large, medium, oriented: exif(jpeg), exif };
};
