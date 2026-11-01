'use strict';
if (!process.send) throw Error('Observador de teste exige IPC privado.');
const http = require('node:http'),
  original = http.createServer;
let watched;
process.on('message', (m) => {
  if (m.type === 'arm-body') {
    watched = { id: m.id, path: m.path };
    process.send({ type: 'body-armed', id: m.id });
  }
});
http.createServer = function (listener, ...args) {
  return original.call(
    this,
    function (req, res) {
      const on = req.on;
      req.on = function (event, callback) {
        const result = on.call(this, event, callback);
        if (event === 'end' && watched?.path === req.url) {
          process.send({ type: 'body-reading', id: watched.id });
          watched = null;
        }
        return result;
      };
      return listener(req, res);
    },
    ...args,
  );
};
