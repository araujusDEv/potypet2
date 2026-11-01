'use strict';
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  vm = require('node:vm');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..'),
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'appet-etapa1-')),
  base = 'http://127.0.0.1:3182';
let child;
const pass = (name) => console.log('OK etapa1 — ' + name);
(async () => {
  try {
    let output = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        EMAIL_TRANSPORT: 'disabled',
        BACKUP_AUTO: '0',
        SEED_SAMPLE_DATA: '0',
        SEED_DEMO_ACCOUNTS: '1',
        COOKIE_SECURE: '0',
        TRUST_PROXY: '0',
        HOST: '127.0.0.1',
        PORT: '3182',
        DATA_DIR: dataDir,
        ADMIN_EMAIL: 'admin@adotapet.com',
        ADMIN_PASSWORD: '',
        DONOR_EMAIL: 'ong@adotapet.com',
        DONOR_PASSWORD: '',
        ADMIN_RECOVERY_ID: '',
      },
    });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (d) => (output += d));
    for (let i = 0; !output.includes('PotyPet rodando'); i++) {
      if (i > 200 || child.exitCode !== null) throw Error(output);
      await new Promise((r) => setTimeout(r, 50));
    }
    const f = await require('./etapa1-fixtures.cjs')({ base, dataDir }),
      { admin, owner, other, guest } = f.clients,
      a = f.animals;
    const publicList = await guest.call('GET', '/api/animals'),
      publicIds = publicList.map((p) => p.id);
    assert.ok(!publicIds.includes(a.pending.id));
    assert.ok(!publicIds.includes(a.rejected.id));
    assert.ok(!publicIds.includes(a.unavailable.id));
    assert.ok(publicIds.includes(a.approved.id));
    assert.ok(publicIds.includes(a.process.id));
    assert.ok(publicIds.includes(a.adopted.id));
    const privateList = await owner.call('GET', '/api/animals');
    assert.ok(privateList.some((p) => p.id === a.pending.id && p.approvalStatus === 'pending'));
    assert.ok(privateList.some((p) => p.id === a.rejected.id && p.approvalStatus === 'rejected'));
    await guest.call('GET', '/api/animals/' + a.pending.id + '/public-name', undefined, 404);
    await owner.call('GET', '/api/animals/' + a.pending.id + '/public-name');
    await admin.call('GET', '/api/animals/' + a.rejected.id + '/public-name');
    await other.call('GET', '/api/animals/' + a.rejected.id + '/public-name', undefined, 404);
    pass('visibilidade pública e acesso privado do dono/admin para pendentes e reprovados');
    assert.equal(
      (await admin.call('PATCH', '/api/animals/' + a.pending.id, { status: 'disponivel' }))
        .approvalStatus,
      'pending',
    );
    assert.equal(
      (await admin.call('PATCH', '/api/animals/' + a.rejected.id, { status: 'disponivel' }))
        .approvalStatus,
      'rejected',
    );
    assert.equal(
      (
        await owner.call('PATCH', '/api/animals/' + a.pending.id, {
          approvalStatus: 'approved',
          reason: 'Revisão administrativa de fixture de teste.',
        })
      ).approvalStatus,
      'pending',
    );
    await other.call(
      'PATCH',
      '/api/animals/' + a.pending.id,
      { approvalStatus: 'approved', reason: 'Revisão administrativa de fixture de teste.' },
      403,
    );
    pass('disponibilidade não aprova o anúncio e autoria/autorização permanecem exigidas');
    const adoption = (body) =>
      require('./adoption-fixture.cjs')({ ...body, responsibility_confirmed: true });
    const own = await owner.call(
      'POST',
      '/api/requests',
      adoption({ animalId: a.approved.id }),
      400,
    );
    assert.match(own.error, /própria conta/);
    for (const key of ['pending', 'rejected', 'process', 'adopted', 'unavailable'])
      await other.call('POST', '/api/requests', adoption({ animalId: a[key].id }), 409);
    pass('servidor bloqueia adoção própria e novas solicitações em todos os estados inelegíveis');
    const stats = await guest.call('GET', '/api/stats'),
      catalog = await guest.call('GET', '/api/organizations');
    assert.equal(
      stats.available,
      publicList.filter((p) => p.approvalStatus === 'approved' && p.status === 'disponivel').length,
    );
    assert.equal(stats.available, 2);
    assert.equal(stats.urgent, 1);
    assert.equal(stats.completedAdoptions, 0);
    assert.equal(stats.adopted, 1);
    assert.equal(stats.organizations, catalog.length);
    assert.ok(catalog.some((o) => o.id === f.users.organizations.approved.id));
    for (const key of ['pending', 'rejected', 'without-profile'])
      assert.ok(!catalog.some((o) => o.id === f.users.organizations[key].id));
    assert.deepEqual(await owner.call('GET', '/api/stats'), stats);
    assert.deepEqual(await admin.call('GET', '/api/stats'), stats);
    pass(
      'indicadores públicos iguais para todos os perfis: disponíveis, urgência, catálogo de organizações e zero conclusões',
    );
    const sandbox = {
      console,
      URL,
      URLSearchParams,
      Date,
      HTMLImageElement: class {},
      document: { addEventListener() {} },
      window: {},
    };
    vm.createContext(sandbox);
    vm.runInContext(
      fs.readFileSync(path.join(root, 'js/store.js'), 'utf8') +
        '\nthis.testStore=Store; this.testUrgent=animalNeedsAttention;',
      sandbox,
    );
    for (const animal of Object.values(a))
      assert.equal(
        sandbox.testStore.isAnimalAvailable(animal),
        animal.approvalStatus === 'approved' && animal.status === 'disponivel',
      );
    assert.equal(sandbox.testStore.animalDisplayStatus(a.pending), 'Anúncio em análise');
    assert.equal(sandbox.testStore.animalDisplayStatus(a.rejected), 'Anúncio reprovado');
    assert.equal(sandbox.testUrgent(a.pending), false);
    assert.equal(sandbox.testUrgent(a.process), false);
    pass(
      'Store e servidor concordam na elegibilidade; estados privados e urgência respeitam aprovação',
    );
    const request = await other.call(
      'POST',
      '/api/requests',
      adoption({ animalId: a.approved.id }),
      201,
    );
    await owner.call('POST', '/api/requests/' + request.id + '/approve', {});
    await owner.call('POST', '/api/requests/' + request.id + '/handover', { confirmed: true });
    await other.call('POST', '/api/requests/' + request.id + '/confirm-receipt', {
      confirmed: true,
    });
    await owner.call('POST', '/api/requests/' + request.id + '/complete', {});
    const completed = await guest.call('GET', '/api/stats');
    assert.equal(completed.completedAdoptions, 1);
    assert.equal(completed.available, 1);
    assert.equal(completed.urgent, 0);
    pass(
      'conclusão real atualiza o mesmo indicador público sem depender de fallback por status de animal',
    );
    const { validateReturnDestination: valid } = require('../js/auth.js');
    for (const [input, expected] of [
      ['cadastrar-animal.html', '/cadastrar-animal.html'],
      ['animal.html?id=3', '/animal.html?id=3'],
      ['cadastrar-desaparecido.html', '/cadastrar-desaparecido.html'],
      ['painel-doador.html?tab=acompanhamentos', '/painel-doador.html?tab=acompanhamentos'],
      ['configuracoes.html', '/configuracoes.html'],
      ['campanhas.html?admin=1', '/campanhas.html?admin=1'],
      ['contrato.html?request=1', '/contrato.html?request=1'],
      ['solicitar-campanha.html?tipo=continuo', '/solicitar-campanha.html?tipo=continuo'],
    ])
      assert.equal(valid(input), expected);
    for (const input of [
      'https://evil.example/animal.html?id=3',
      '//evil.example/animal.html?id=3',
      'javascript:alert(1)',
      '/\\evil.example',
      '../animal.html?id=3',
      'animal.html',
      'animal.html?id=0',
      'animal.html?id=-1',
      'animal.html?id=1&id=2',
      'animal.html?id=9999999999999999999999',
      'animal.html?id=1&next=https://evil.example',
      'login.html',
      'registro.html',
      'server.js',
      'campanhas.html?admin=0',
      '%2Fanimal.html?id=1',
      'painel-doador.html?tab=invalid',
      'configuracoes.html#x',
      '/x/animal.html?id=1',
    ])
      assert.equal(valid(input), null, input);
    pass(
      'destinos internos e parâmetros validados; externos, caminhos inválidos, loops e IDs malformados rejeitados',
    );
  } finally {
    if (child?.exitCode === null) {
      const done = new Promise((r) => child.once('exit', r));
      child.kill();
      await done;
    }
    assert.ok(dataDir.startsWith(os.tmpdir() + path.sep));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
