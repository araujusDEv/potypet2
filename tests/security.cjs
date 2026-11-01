const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  { spawn } = require('node:child_process'),
  vm = require('node:vm');
const check = require('./start-check.cjs');
const root = path.resolve(__dirname, '..');
async function request(route, options = {}) {
  const r = await fetch('http://127.0.0.1:3170' + route, options);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.ok(r.headers.get('content-security-policy').includes("script-src 'self'"));
  assert.equal(r.headers.get('referrer-policy'), 'same-origin');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(r.headers.get('cache-control'));
  return r;
}
(async () => {
  await check('HTTP security and regression', async () => {
    for (const route of [
      '/server.js',
      '/package.json',
      '/.env',
      '/.secret.json',
      '/js/.secret.js',
      '/data/seed.json',
      '/README.md',
      '/iniciar.sh',
      '/tests/smoke-api.js',
      '/img/test.exe',
    ])
      assert.equal((await request(route)).status, 403, route);
    for (const route of ['/', '/js/store.js', '/css/style.css', '/js/vendor/qrcode.min.js'])
      assert.equal((await request(route)).status, 200, route);
    assert.equal((await request('/absent.html')).status, 404);
    assert.equal((await request('/api/users')).status, 401);
    assert.equal((await request('/api/no-route')).status, 404);
    assert.equal((await request('/', { method: 'POST' })).status, 405);
    assert.equal((await request('/api/health')).headers.get('strict-transport-security'), null);
    const animals = await (await request('/api/animals')).json();
    const owner = await (await request(`/api/animals/${animals[0].id}/public-name`)).json();
    assert.deepEqual(Object.keys(owner), ['name']);
    assert.ok(owner.name);
    assert.equal((await request('/api/animals/999999/public-name')).status, 404);
    const stats = await (await request('/api/stats')).json();
    assert.equal(typeof stats.users, 'number');
    assert.equal(typeof stats.organizations, 'number');
    await new Promise((resolve, reject) => {
      const p = spawn(process.execPath, ['tests/smoke-api.js'], {
        cwd: root,
        windowsHide: true,
        stdio: 'inherit',
      });
      p.on('exit', (code) => (code ? reject(Error('smoke failed')) : resolve()));
    });
    const login = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@adotapet.com', password: 'admin123' }),
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const headers = { 'Content-Type': 'application/json', Cookie: cookie };
    const photo = 'data:image/png;base64,' + 'A'.repeat(3 * 1024 * 1024 + 100);
    const created = await request('/api/animals', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Photo test', city: 'Apodi', state: 'RN', photos: [photo] }),
    });
    assert.equal(created.status, 400);
    const valid = await request('/api/animals', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Photo test',
        city: 'Apodi',
        state: 'RN',
        description: 'Animal fictício para revisão.',
        photos: ['img/animal1.png'],
      }),
    });
    assert.equal(valid.status, 201);
    const animal = await valid.json();
    const updated = await request(`/api/animals/${animal.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ photos: [photo] }),
    });
    assert.equal(updated.status, 400);
    const preserved = await (await request('/api/animals')).json();
    assert.equal(preserved.find((a) => a.id === animal.id).photos[0], 'img/animal1.png');
    const users = await request('/api/users', { headers: { Cookie: cookie } });
    assert.equal(users.status, 200);
    assert.ok(Array.isArray(await users.json()));
    for (const route of [
      '/api/animals',
      '/api/requests',
      '/api/missing',
      '/api/favorites/toggle',
      `/api/animals/${animal.id}/view`,
    ]) {
      let last;
      for (let i = 0; i < 31; i++)
        last = await request(route, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
      assert.equal(last.status, 429, route);
      assert.ok(Number(last.headers.get('retry-after')) > 0);
    }
  });
  process.env.COOKIE_SECURE = '1';
  await check('conditional HSTS', async () => {
    for (const route of ['/', '/api/health', '/.env', '/absent.html'])
      assert.equal(
        (await request(route)).headers.get('strict-transport-security'),
        'max-age=31536000; includeSubDomains',
      );
  });
  const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  let callback;
  const sandbox = {};
  vm.runInNewContext(
    source.slice(source.indexOf('const RATE_LIMITS'), source.indexOf('let bootstrapCredentials')) +
      '\nRATE_LIMITS.set("expired", {resetAt: 0});RATE_LIMITS.set("active", {resetAt: Date.now()+60000});globalThis.limits=RATE_LIMITS;',
    Object.assign(sandbox, {
      setInterval: (fn, ms) => {
        assert.equal(ms, 900000);
        callback = fn;
        return { unref() {} };
      },
    }),
  );
  callback();
  assert.equal(sandbox.limits.size, 1);
  assert.ok(sandbox.limits.has('active'));
  console.log(
    'OK — headers, static protection, user privacy, photos, five rate limits, cleanup and adoption regression.',
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
