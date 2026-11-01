'use strict';
// Loaded only by tests with Node --require and a private IPC channel. No HTTP test endpoint.
if (!process.send) throw Error('A barreira de teste exige IPC privado.');
const path = require('node:path'),
  root = path.resolve(process.env.POTYPET_CONCURRENCY_PROJECT);
const validate = require(path.join(root, 'lib/input-validation.cjs'));
let armed = null,
  held = null;
async function barrier(kind, value) {
  if (!armed || armed.kind !== kind) return value;
  const current = armed;
  armed = null;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      held = null;
      reject(Error('A barreira de teste não foi liberada.'));
    }, 20000);
    held = {
      id: current.id,
      release() {
        clearTimeout(timer);
        held = null;
        resolve();
      },
    };
    process.send({ type: 'held', id: current.id, kind });
  });
  return value;
}
for (const kind of ['image', 'photos']) {
  const original = validate[kind];
  validate[kind] = async (...args) => barrier(kind, await original(...args));
}
const { PDFDocument } = require('pdf-lib'),
  load = PDFDocument.load;
PDFDocument.load = async (...args) => barrier('pdf', await load.apply(PDFDocument, args));
process.on('message', (message) => {
  if (message.type === 'arm') {
    if (armed || held) throw Error('Barreira já ativa.');
    armed = { id: message.id, kind: message.kind };
    process.send({ type: 'armed', id: message.id });
  } else if (message.type === 'release') {
    if (held?.id === message.id) held.release();
    if (armed?.id === message.id) armed = null;
  }
});
