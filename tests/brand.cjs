'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const check = require('./start-check.cjs');
check('PotyPet em todas as paginas e arquivos publicos', async () => {
  const root = path.resolve(__dirname, '..');
  assert.equal(
    require('node:crypto')
      .createHash('sha256')
      .update(fs.readFileSync(path.join(root, 'img/brand-symbol.png')))
      .digest('hex'),
    '7089b2f9ace1cde05ab3d68bc57c939d33a8ca51fa0160e7ad274a39c510593b',
    'símbolo original preservado',
  );
  for (const name of ['termos.html', 'privacidade.html'])
    assert.equal(
      (await fetch('http://127.0.0.1:3170/docs/historico/Appet-4.6.0/' + name)).status,
      403,
      'arquivo histórico não é servido como página pública',
    );
  const pages = fs.readdirSync(root).filter((name) => name.endsWith('.html'));
  for (const page of pages) {
    const response = await fetch('http://127.0.0.1:3170/' + page);
    assert.equal(response.status, 200, page);
    const html = await response.text();
    const visibleText = html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ');
    assert.doesNotMatch(visibleText, /adota\s*pet/i, page + ': marca antiga fragmentada');
    assert.doesNotMatch(html, /adotapet/i, page + ': referencia antiga');
    assert.doesNotMatch(html, /\bAppet\b/i, page + ': marca anterior nas telas atuais');
    assert.doesNotMatch(visibleText, /app\s*et/i, page + ': marca anterior fragmentada');
    assert.match(html, /<title>[^<]*PotyPet/, page + ': titulo');
    for (const name of [
      'description',
      'og:site_name',
      'og:title',
      'og:description',
      'twitter:title',
      'twitter:description',
    ]) {
      assert.match(
        html,
        new RegExp('<meta (?:name|property)="' + name + '" content="[^"]*PotyPet'),
        page + ': metadado ' + name,
      );
    }
    const wordmarks = [...html.matchAll(/<span class="brand-word">([\s\S]*?)<\/span><\/a>/g)];
    if (!html.includes('class="auth-page"') && !wordmarks.length) {
      assert.match(
        html,
        /<header class="navbar"><\/header>/,
        page + ': cabeçalho dinâmico ausente',
      );
      assert.match(
        html,
        /<script src="js\/nav\.js\?[^" ]+"><\/script>/,
        page + ': gerador do logotipo dinâmico ausente',
      );
    }
    for (const [, mark] of wordmarks)
      assert.match(
        mark,
        /<span class="brand-adota">Poty<\/span><span class="brand-pet">Pet<\/span>/,
        page + ': logotipo',
      );
    for (const [anchor] of html.matchAll(/<a\b[^>]*class="logo"[^>]*>/g))
      assert.match(anchor, /aria-label="PotyPet — início"/, page + ': nome acessível do logotipo');
    for (const match of html.matchAll(/(?:src|href)="((?:js|css)\/[^"?]+)(?:\?[^" ]*)?"/g)) {
      assert.ok(fs.existsSync(path.join(root, match[1])), page + ': arquivo ausente ' + match[1]);
    }
  }
  for (const name of ['logo-full.png', 'logo-icon.png', 'social-preview.png']) {
    assert.equal((await fetch('http://127.0.0.1:3170/img/' + name)).status, 404, name);
  }
  for (const name of ['login.html', 'registro.html']) {
    const html = fs.readFileSync(path.join(root, name), 'utf8');
    assert.match(html, /Poty<em>Pet<\/em>/, name);
  }
  const nav = fs.readFileSync(path.join(root, 'js/nav.js'), 'utf8');
  assert.match(nav, /<b><span>Poty<\/span>Pet<\/b>/, 'marca mobile');
  assert.match(nav, /aria-label="PotyPet — início"/, 'nome acessível do menu');
  assert.doesNotMatch(nav, /\bAppet\b|>App<|>et</, 'marca no menu');
  console.log(
    'OK — ' + pages.length + ' paginas: titulos, marca fragmentada, referencias e imagens antigas.',
  );
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
