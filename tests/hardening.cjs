'use strict';
// Regressões das proteções de escrita (CSRF), do limite de login e de erros de entrada.
const assert = require('node:assert/strict');
const http = require('node:http');
const check = require('./start-check.cjs');

const PORT = 3170;

function send(method, route, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port: PORT, method, path: route, headers },
      (response) => {
        let text = '';
        response.on('data', (chunk) => (text += chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode, headers: response.headers, text }),
        );
      },
    );
    request.on('error', reject);
    request.end(body);
  });
}

function json(method, route, payload, headers = {}) {
  return send(method, route, {
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
}

const login = (email, password, headers) =>
  json('POST', '/api/auth/login', { email, password }, headers);

(async () => {
  await check('proteções de escrita, limite de login e erros de entrada', async () => {
    // Permissions-Policy presente
    const health = await send('GET', '/api/health');
    assert.match(health.headers['permissions-policy'], /geolocation=\(\)/);

    // Escrita vinda de outra origem é recusada; do mesmo site passa
    const evil = await json('POST', '/api/auth/logout', {}, { Origin: 'https://evil.example' });
    assert.equal(evil.status, 403);
    const sameSite = await json('POST', '/api/auth/logout', {}, { 'Sec-Fetch-Site': 'same-site' });
    assert.equal(sameSite.status, 403);
    const sameOrigin = await json(
      'POST',
      '/api/auth/logout',
      {},
      { Origin: `http://127.0.0.1:${PORT}` },
    );
    assert.notEqual(sameOrigin.status, 403);

    // Corpo que não é JSON (formulário ou texto puro) é recusado
    for (const type of [
      'text/plain',
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=x',
    ]) {
      const response = await send('POST', '/api/auth/logout', {
        headers: { 'Content-Type': type },
        body: 'x=1',
      });
      assert.equal(response.status, 415, type);
    }

    // Byte nulo no caminho dá 400, não 500
    const nul = await send('GET', '/css/%00.css');
    assert.equal(nul.status, 400);

    // Corpo grande demais recebe 413 de verdade
    const big = await send('POST', '/api/auth/login', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.test', password: 'x'.repeat(14 * 1024 * 1024) }),
    });
    assert.equal(big.status, 413);

    // Login certo não consome o limite do IP
    for (let i = 0; i < 12; i += 1) {
      const ok = await login('admin@adotapet.com', 'admin123');
      assert.equal(ok.status, 200, `login correto #${i + 1}`);
    }

    // Falhas contra uma conta bloqueiam essa conta, mas não outras contas no mesmo IP
    const codes = [];
    for (let i = 0; i < 9; i += 1)
      codes.push((await login('ong@adotapet.com', `errada-${i}`)).status);
    assert.deepEqual(codes.slice(0, 8), Array(8).fill(401));
    assert.equal(codes[8], 429);
    const blocked = await login('ong@adotapet.com', 'doador123');
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers['retry-after']) > 0);
    const otherAccount = await login('admin@adotapet.com', 'admin123');
    assert.equal(otherAccount.status, 200);
  });
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
