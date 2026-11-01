'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  { DatabaseSync } = require('node:sqlite');
module.exports = async function fixtures({ base, dataDir, email = false, requestLog = [] }) {
  const client = (name) => {
    const c = {
      name,
      cookie: '',
      async call(method, route, body, expected = 200) {
        const response = await fetch(base + route, {
          method,
          headers: { 'Content-Type': 'application/json', Cookie: c.cookie },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const data = await response.json();
        if (response.status !== expected)
          throw Error(
            name + ' ' + method + ' ' + route + ': ' + response.status + ' ' + JSON.stringify(data),
          );
        if (response.headers.get('set-cookie'))
          c.cookie = response.headers.get('set-cookie').split(';')[0];
        requestLog.push({
          profile: name,
          method,
          route,
          status: response.status,
          body: body
            ? Object.fromEntries(
                Object.entries(body).map(([k, v]) => [
                  k,
                  /password|token/i.test(k) ? '[TEST SECRET]' : v,
                ]),
              )
            : undefined,
        });
        return data;
      },
    };
    return c;
  };
  const C = {
    admin: client('admin'),
    owner: client('owner'),
    other: client('other'),
    guest: client('guest'),
  };
  await C.admin.call('POST', '/api/auth/login', {
    email: 'admin@adotapet.com',
    password: 'admin123',
  });
  async function confirm(address, password) {
    const directory = path.join(dataDir, 'email-preview');
    for (let i = 0; i < 800; i++) {
      if (fs.existsSync(directory))
        for (const file of fs.readdirSync(directory)) {
          const message = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
          if (
            message.to.some((a) => a.address === address) &&
            message.subject.includes('confirme')
          ) {
            const match = message.text.match(/#token=([A-Za-z0-9_-]{43})/);
            if (!match) throw Error('Token de teste ausente.');
            await C.guest.call('POST', '/api/auth/verify-email', { token: match[1], password });
            fs.unlinkSync(path.join(directory, file));
            return;
          }
        }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw Error('E-mail fictício de fixture não encontrado.');
  }
  async function register(c, name, type = 'usuario') {
    const address = 'etapa1-' + name + '@example.test',
      password = 'TesteSeguro9';
    await c.call(
      'POST',
      '/api/auth/register',
      {
        name: 'Etapa 1 ' + name,
        email: address,
        password,
        passwordConfirmation: password,
        accountType: type,
        organizationKind: 'grupo',
        city: 'Apodi',
        state: 'RN',
        phone: '84999999999',
        termsAccepted: true,
      },
      email ? 202 : 201,
    );
    if (email) await confirm(address, password);
    const user = (await C.admin.call('GET', '/api/users')).find((u) => u.email === address);
    if (type === 'usuario') await c.call('POST', '/api/auth/login', { email: address, password });
    return user;
  }
  const owner = await register(C.owner, 'owner'),
    other = await register(C.other, 'other');
  const records = {};
  for (const [name, status, approval, urgent] of [
    ['pending', 'disponivel', 'pending', true],
    ['approved', 'disponivel', 'approved', true],
    ['ordinary', 'disponivel', 'approved', false],
    ['rejected', 'disponivel', 'rejected', true],
    ['process', 'em_processo', 'approved', true],
    ['adopted', 'adotado', 'approved', true],
    ['unavailable', 'indisponivel', 'approved', true],
  ]) {
    const animal = await C.owner.call(
      'POST',
      '/api/animals',
      {
        name: 'Etapa1 ' + name,
        city: 'Apodi',
        state: 'RN',
        age_group: urgent ? 'idoso' : 'adulto',
        description: 'Animal fictício de QA para revisão e adoção.',
        photos: ['img/animal1.png'],
      },
      201,
    );
    records[name] = await C.admin.call('PATCH', '/api/animals/' + animal.id, {
      approvalStatus: approval,
      status,
      featured: true,
      reason: 'Revisão administrativa de fixture de teste.',
    });
  }
  const orgs = {};
  for (const name of ['approved', 'pending', 'rejected', 'without-profile']) {
    const c = client('org ' + name),
      user = await register(c, 'org-' + name, 'ong');
    orgs[name] = user;
    if (name === 'approved' || name === 'without-profile')
      await C.admin.call('POST', '/api/users/' + user.id + '/approve', {});
    if (name === 'rejected')
      await C.admin.call('POST', '/api/users/' + user.id + '/reject', {
        reason: 'Fixture local rejeitada.',
      });
    if (name === 'approved') {
      await c.call('POST', '/api/auth/login', { email: user.email, password: 'TesteSeguro9' });
      await c.call('PUT', '/api/organizations/me', {
        city: 'Apodi',
        state: 'RN',
        description: 'Grupo fictício de QA.',
        area: 'Acolhimento',
        contact: '',
        contactConsent: false,
      });
    }
  }
  const db = new DatabaseSync(path.join(dataDir, 'adotapet.db'));
  try {
    const row = db.prepare("SELECT value FROM app_state WHERE key='organizations'").get();
    let profiles = JSON.parse(row.value).filter((p) => p.id !== orgs['without-profile'].id);
    for (const name of ['pending', 'rejected'])
      profiles.push({
        id: orgs[name].id,
        city: 'Apodi',
        state: 'RN',
        description: 'Perfil de fixture privada.',
        area: 'QA',
        contact: '',
        contactConsent: false,
      });
    db.prepare("UPDATE app_state SET value=? WHERE key='organizations'").run(
      JSON.stringify(profiles),
    );
  } finally {
    db.close();
  }
  return {
    clients: C,
    animals: records,
    users: { owner, other, organizations: orgs },
    client,
    base,
    dataDir,
    requestLog,
  };
};
