'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  assert = require('node:assert/strict');
const root = path.resolve(process.env.POTYPET_ADMIN_PROJECT || path.join(__dirname, '..')),
  results = [],
  unhandled = [];
const rejected = (error) => unhandled.push(String(error));
process.on('unhandledRejection', rejected);
const tick = () => new Promise((resolve) => setImmediate(resolve)),
  defer = () => {
    let resolve;
    const promise = new Promise((r) => (resolve = r));
    return { promise, resolve };
  };
const definitions = [
  {
    fn: 'approveOrganization',
    tab: 'tab-usuarios',
    route: '/api/users/2/approve',
    field: 'users',
    change: (s) => {
      s.users[0].approvalStatus = 'aprovado';
      return { user: s.users[0] };
    },
    expected: 'Aprovada',
  },
  {
    fn: 'rejectOrganization',
    tab: 'tab-usuarios',
    route: '/api/users/2/reject',
    field: 'users',
    change: (s) => {
      s.users[0].approvalStatus = 'reprovado';
      return { user: s.users[0] };
    },
    expected: 'Reprovada',
  },
  {
    fn: 'suspendOrganization',
    tab: 'tab-usuarios',
    route: '/api/users/2/suspend',
    field: 'users',
    change: (s) => {
      s.users[0].approvalStatus = 'suspenso';
      return { user: s.users[0] };
    },
    expected: 'Suspensa',
  },
  {
    fn: 'toggleFeatured',
    tab: 'tab-animais',
    route: '/api/animals/2',
    field: 'animals',
    change: (s) => {
      s.animals[0].featured = true;
      return s.animals[0];
    },
    expected: 'Remover destaque',
  },
  {
    fn: 'toggleVerified',
    tab: 'tab-animais',
    route: '/api/animals/2',
    field: 'animals',
    change: (s) => {
      s.animals[0].verified = true;
      return s.animals[0];
    },
    expected: 'Remover verificação',
  },
  {
    fn: 'handleResolveReport',
    tab: 'tab-denuncias',
    route: '/api/reports/2/resolve',
    field: 'reports',
    change: (s) => {
      s.reports[0].status = 'resolvida';
      return s.reports[0];
    },
    expected: 'Resolvida',
  },
  {
    fn: 'removeUser',
    tab: 'tab-usuarios',
    route: '/api/users/2',
    field: 'users',
    change: (s) => {
      s.users = [];
      return { ok: true };
    },
    absent: 'ONG fictícia',
  },
  {
    fn: 'removeSupportPoint',
    tab: 'tab-apoio',
    route: '/api/support-points/2',
    field: 'support',
    change: (s) => {
      s.support = [];
      return { ok: true };
    },
    absent: 'Ponto fictício',
  },
  {
    fn: 'suspendAccount',
    tab: 'tab-usuarios',
    route: '/api/users/2/suspend-account',
    field: 'users',
    change: (s) => {
      s.users[0].accountSuspended = true;
      return { user: s.users[0] };
    },
    expected: 'Conta suspensa',
  },
  {
    fn: 'reactivateAccount',
    tab: 'tab-usuarios',
    route: '/api/users/2/reactivate',
    field: 'users',
    change: (s) => {
      s.users[0].accountSuspended = false;
      return { user: s.users[0] };
    },
    expected: 'Suspender conta',
  },
];
function harness(def, status, { readStatus = 200, logStatus = 200 } = {}) {
  const mutation = defer(),
    refresh = defer(),
    toasts = [],
    requests = [],
    elements = new Map(),
    server = {
      users: [
        {
          id: 2,
          name: 'ONG fictícia',
          accountType: 'ong',
          approvalStatus: def.fn === 'suspendOrganization' ? 'aprovado' : 'suspenso',
          role: 'doador',
          accountSuspended: def.fn === 'reactivateAccount',
        },
      ],
      animals: [
        {
          id: 2,
          name: 'Animal fictício',
          approvalStatus: 'approved',
          status: 'disponivel',
          verified: false,
          featured: false,
        },
      ],
      reports: [
        {
          id: 2,
          category: 'outro',
          reason: 'Denúncia fictícia',
          status: 'aberta',
          createdAt: '2026-10-13T12:00:00Z',
        },
      ],
      support: [{ id: 2, name: 'Ponto fictício', city: 'Apodi', state: 'RN', category: 'ong' }],
      requests: [],
      missing: [],
      logs: [],
      unread: { unread: 0 },
    };
  const node = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        innerHTML: '',
        classList: { contains: () => id === def.tab },
        addEventListener() {},
      });
    return elements.get(id);
  };
  const urls = {
    '/api/users': 'users',
    '/api/animals/cards': 'animals',
    '/api/reports': 'reports',
    '/api/support-points': 'support',
    '/api/admin-log': 'logs',
    '/api/notifications/summary': 'unread',
  };
  const context = {
    console,
    URLSearchParams,
    AbortSignal,
    location: { pathname: '/admin.html', search: '' },
    window: { location: { protocol: 'http:' } },
    document: {
      readyState: 'loading',
      addEventListener() {},
      getElementById: node,
      querySelectorAll: () => [],
    },
    confirm: () => true,
    prompt: () => 'Justificativa fictícia de teste.',
    showToast: (s) => toasts.push(s),
    svgIcon: () => '<svg></svg>',
    fetch: async (url, options) => {
      const method = options.method;
      requests.push({ method, url });
      let code = 200,
        body;
      if (method === 'GET') {
        await refresh.promise;
        const key = urls[url.split('?')[0]];
        code = key === def.field ? readStatus : 200;
        body =
          code === 200 ? structuredClone(server[key]) : { error: 'Leitura controlada ' + code };
      } else if (url === def.route) {
        await mutation.promise;
        code = status;
        body =
          code === 200
            ? structuredClone(def.change(server))
            : { error: 'Falha controlada ' + code };
      } else {
        code = logStatus;
        body = code === 200 ? { ok: true } : { error: 'Histórico controlado ' + code };
      }
      return { ok: code >= 200 && code < 300, status: code, json: async () => body };
    },
  };
  vm.createContext(context);
  for (const file of ['js/store.js', 'js/app-runtime.js', 'js/pages/admin.js'])
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  vm.runInContext(
    `adminUser={id:1,role:'admin'};this.runtime=App;this.call=${def.fn};this.draw=TABS['${def.tab}'];`,
    context,
  );
  context.runtime.data = structuredClone(server);
  context.runtime.resources = Object.fromEntries(
    Object.entries(urls).map(([url, key]) => [key, url]),
  );
  context.draw();
  const button = {
    dataset: {},
    disabled: false,
    innerHTML: 'Ação',
    textContent: 'Ação',
    isConnected: true,
    setAttribute(key, value) {
      this[key] = value;
    },
    querySelector() {
      return null;
    },
  };
  return {
    context,
    mutation,
    refresh,
    toasts,
    requests,
    server,
    button,
    html: () => node('tab-content').innerHTML,
  };
}
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, status: 'pass' });
    console.log('OK admin — ' + name);
  } catch (error) {
    results.push({ name, status: 'fail', error: String(error.stack).slice(0, 1300) });
    console.error('FALHOU admin — ' + name + ' — ' + error.message);
  }
}
(async () => {
  try {
    for (const def of definitions)
      for (const status of [200, 403, 409, 503])
        await test(def.fn + ' HTTP ' + status, async () => {
          const h = harness(def, status),
            initial = h.html(),
            errorsBefore = unhandled.length;
          let operation;
          try {
            operation = h.context.runtime.action(h.button, () => h.context.call(2));
            await tick();
            assert.equal(h.button.disabled, true, 'Botão liberado antes da resposta.');
            assert.equal(h.button['aria-busy'], 'true');
            assert.ok(
              !h.toasts.some((t) => /ONG aprovada|ONG suspensa|cadastro de ONG reprovado/i.test(t)),
              'Sucesso anterior à resposta.',
            );
            await h.context.runtime.action(h.button, () => h.context.call(2));
            assert.equal(
              h.requests.filter((r) => r.url === def.route && r.method !== 'GET').length,
              1,
              'Clique repetido executou outra operação.',
            );
            h.mutation.resolve();
            await tick();
            await tick();
            if (status === 200) {
              assert.equal(
                h.button.disabled,
                true,
                'Botão liberado antes da atualização dos dados.',
              );
              assert.deepEqual(h.toasts, [], 'Sucesso anterior à atualização.');
            }
            h.refresh.resolve();
            await operation;
            await tick();
            assert.equal(h.button.disabled, false);
            assert.equal(h.button['aria-busy'], 'false');
            if (status === 200) {
              if (def.expected)
                assert.ok(
                  h.html().includes(def.expected),
                  'Tabela não mostra o estado confirmado.',
                );
              if (def.absent)
                assert.ok(!h.html().includes(def.absent), 'Remoção não saiu da tabela.');
            } else {
              assert.equal(h.html(), initial);
              assert.ok(h.toasts.some((t) => t.includes(String(status))));
              assert.ok(
                !h.toasts.some((t) =>
                  /ONG aprovada|ONG suspensa|cadastro de ONG reprovado/i.test(t),
                ),
              );
              assert.ok(
                !h.requests.some((r) => r.method === 'GET'),
                'Falha tentou atualizar como sucesso.',
              );
            }
            assert.equal(unhandled.length, errorsBefore, 'Rejeição JavaScript sem tratamento.');
          } finally {
            h.mutation.resolve();
            h.refresh.resolve();
            if (operation) await operation;
            await tick();
          }
        });
    for (const options of [{ readStatus: 503 }, { logStatus: 503 }])
      await test(
        options.readStatus
          ? '200 seguido de GET 503 conserva confirmação e avisa falha'
          : '200 seguido de histórico 503 atualiza estado e avisa falha',
        async () => {
          const def = options.readStatus ? definitions[0] : definitions[4],
            h = harness(def, 200, options);
          h.mutation.resolve();
          h.refresh.resolve();
          await h.context.runtime.action(h.button, () => h.context.call(2));
          assert.ok(h.html().includes(def.expected));
          assert.ok(h.toasts.some((t) => /falhou.*503/.test(t)));
          assert.ok(!h.toasts.includes('ONG aprovada.'));
        },
      );
    await test('Chamador devolve Promise até a atualização completar', async () => {
      const h = harness(definitions[0], 200);
      const pending = h.context.call(2);
      try {
        assert.equal(typeof pending?.then, 'function');
        h.mutation.resolve();
        await tick();
        let complete = false;
        Promise.resolve(pending).then(() => (complete = true));
        await tick();
        assert.equal(complete, false);
        h.refresh.resolve();
        await pending;
        assert.equal(complete, true);
      } finally {
        h.mutation.resolve();
        h.refresh.resolve();
        await Promise.resolve(pending);
        await tick();
      }
    });
    await test('Atualização não reaproveita leitura iniciada antes da gravação', async () => {
      const h = harness(definitions[0], 200),
        old = defer();
      h.context.runtime.inflight.set('users', old.promise);
      h.mutation.resolve();
      h.refresh.resolve();
      const pending = h.context.call(2);
      try {
        await tick();
        assert.equal(
          h.requests.filter((r) => r.method === 'GET' && r.url === '/api/users').length,
          0,
        );
        h.context.runtime.inflight.delete('users');
        old.resolve();
        await pending;
        assert.equal(
          h.requests.filter((r) => r.method === 'GET' && r.url === '/api/users').length,
          1,
        );
        assert.ok(h.html().includes('Aprovada'));
      } finally {
        old.resolve();
        await Promise.resolve(pending);
      }
    });
    await test('Auditoria: aprovação 503 nunca informa ONG aprovada', async () => {
      const h = harness(definitions[0], 503);
      h.mutation.resolve();
      h.refresh.resolve();
      await Promise.resolve(h.context.call(2));
      await tick();
      await tick();
      assert.ok(!h.toasts.includes('ONG aprovada.'), 'Resposta 503 produziu ONG aprovada.');
      assert.ok(h.toasts.some((message) => message.includes('503')));
    });
    await test('Auditoria: após aprovação 200 a tabela sai de Suspensa para Aprovada', async () => {
      const h = harness(definitions[0], 200);
      h.mutation.resolve();
      h.refresh.resolve();
      await Promise.resolve(h.context.call(2));
      await tick();
      await tick();
      assert.equal(h.server.users[0].approvalStatus, 'aprovado');
      assert.ok(
        h.html().includes('Aprovada'),
        'Servidor aprovou, mas a tabela permaneceu Suspensa.',
      );
      assert.ok(!h.html().includes('Suspensa'));
    });
    await test('Outra ação não pode substituir a tabela durante a primeira operação', async () => {
      const h = harness(definitions[0], 200),
        first = h.context.call(2);
      try {
        vm.runInContext('this.second=toggleVerified;', h.context);
        await Promise.resolve(h.context.second(2));
        assert.ok(
          !h.requests.some((r) => r.method === 'PATCH'),
          'Outra ação enviou alteração enquanto a primeira estava pendente.',
        );
        h.mutation.resolve();
        h.refresh.resolve();
        await Promise.resolve(first);
      } finally {
        h.mutation.resolve();
        h.refresh.resolve();
        await Promise.resolve(first);
        await tick();
      }
    });
  } finally {
    await tick();
    process.off('unhandledRejection', rejected);
    const report = {
      projectVersion: JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version,
      node: process.versions.node,
      cases: results,
      unhandledRejections: unhandled,
      scope:
        'Scripts reais store/runtime/admin em VM; respostas e pausas HTTP simuladas. Navegador real separado no relatório.',
    };
    if (process.env.POTYPET_ADMIN_REPORT)
      fs.writeFileSync(process.env.POTYPET_ADMIN_REPORT, JSON.stringify(report, null, 2));
    if (results.length !== 47 || results.some((r) => r.status !== 'pass') || unhandled.length)
      process.exitCode = 1;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
