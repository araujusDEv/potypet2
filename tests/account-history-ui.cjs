'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'),
  results = [];
async function run({ page = 'animal.html', restricted = true, aux = 403, critical = 200 }) {
  const user = { id: 10, role: 'adotante', accountType: 'usuario', historicalAccess: restricted },
    calls = [],
    c = {
      console,
      URLSearchParams,
      AbortSignal,
      location: { pathname: '/' + page, search: page === 'contrato.html' ? '?request=7' : '?id=9' },
      window: { location: { protocol: 'http:' } },
      document: { readyState: 'loading', addEventListener() {} },
      Auth: {
        _currentUser: null,
        getCurrentUser() {
          return this._currentUser;
        },
      },
      showToast() {},
      fetch: async (url) => {
        calls.push(url);
        let status = 200,
          body = [];
        if (url === '/api/auth/me') body = { user };
        else if (url === '/api/animals/9') body = { id: 9, name: 'Animal histórico fictício' };
        else if (url.includes('/api/contracts/')) {
          status = critical;
          body = { requestId: 7 };
        } else if (
          url === '/api/favorites' ||
          url === '/api/notifications/summary' ||
          url === '/api/adoption-profile' ||
          url === '/api/account/limits'
        ) {
          status = aux;
          body = { error: 'Recurso auxiliar sem autorização.' };
        } else if (url === '/api/requests') {
          status = critical;
          body = [{ id: 7 }];
        }
        if (status !== 200) body = { error: 'Falha controlada.' };
        return { ok: status === 200, status, json: async () => body };
      },
    };
  vm.createContext(c);
  for (const file of ['js/store.js', 'js/app-runtime.js'])
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), c);
  vm.runInContext('this.runtime=App;', c);
  await c.runtime.hydrate();
  return { data: c.runtime.data, calls };
}
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, status: 'pass' });
    console.log('OK histórico UI — ' + name);
  } catch (e) {
    results.push({ name, status: 'fail', error: String(e.stack) });
    console.error(e);
  }
}
(async () => {
  for (const page of [
    'animal.html',
    'contrato.html',
    'painel-doador.html',
    'minhas-solicitacoes.html',
  ])
    await test(page + ': auxiliar 403 não interrompe consulta histórica autorizada', async () => {
      const r = await run({ page });
      assert.equal(r.data.session.user.historicalAccess, true);
      if (page === 'animal.html') assert.equal(r.data.animal.id, 9);
      if (page === 'contrato.html') assert.equal(r.data.contract.requestId, 7);
      if (page === 'painel-doador.html' || page === 'minhas-solicitacoes.html')
        assert.ok(r.calls.includes('/api/animals/cards?view=history'));
    });
  for (const status of [401, 403, 503])
    await test('Dados privados obrigatórios ' + status + ' não são ignorados', () =>
      assert.rejects(run({ page: 'contrato.html', critical: status }), (e) => e.status === status),
    );
  await test('Falha auxiliar 503 continua erro recuperável, sem apresentar dados como carregados', () =>
    assert.rejects(run({ aux: 503 }), (e) => e.status === 503));
  await test('Conta ativa não recebe exceção de autorização do modo histórico', () =>
    assert.rejects(run({ restricted: false }), (e) => e.status === 403));
  if (process.env.POTYPET_HISTORY_UI_REPORT)
    fs.writeFileSync(
      process.env.POTYPET_HISTORY_UI_REPORT,
      JSON.stringify(
        {
          version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version,
          cases: results,
          scope:
            'Hydrate real em VM com respostas controladas. Navegador e autorizações reais separados.',
        },
        null,
        2,
      ),
    );
  if (results.some((r) => r.status !== 'pass') || results.length !== 9) process.exitCode = 1;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
