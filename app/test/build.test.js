'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-dist-'));
process.env.PA_DIST = tmp;
const { build, REGISTERED, ORDER } = require('../build.js');
const sha = t => crypto.createHash('sha256').update(t).digest('hex');

test('build gera o app e a tabela de hashes é a mesma do simulador e do engineVersion', () => {
  const r = build({ quiet: true });
  const sim = fs.readFileSync(path.join(ROOT, 'simulador-v01', 'build.js'), 'utf8');
  const simTable = Object.fromEntries([...sim.matchAll(/'([a-zA-Z]+\.js)': '([0-9a-f]{64})'/g)].map(m => [m[1], m[2]]));
  assert.deepStrictEqual(simTable, REGISTERED);
  const EV = require(path.join(ROOT, 'engine', 'src', 'engineVersion.js'));
  for (const [k, v] of Object.entries(EV.ENGINE_MODULES)) assert.strictEqual(REGISTERED[k], v, k);
  for (const f of ORDER) {
    const onDisk = fs.readFileSync(path.join(ROOT, 'engine', 'src', f), 'utf8');
    assert.strictEqual(sha(onDisk), REGISTERED[f], 'arquivo do motor alterado: ' + f);
  }
  assert.match(r.version, /^[0-9a-f]{10}$/);
});

test('cada módulo do motor está no index.html com os bytes idênticos', () => {
  const html = fs.readFileSync(path.join(tmp, 'index.html'), 'utf8');
  for (const f of ORDER) {
    const m = html.match(new RegExp(`<script data-module="${f.replace('.', '\\.')}">([\\s\\S]*?)</script>`));
    assert.ok(m, 'módulo ausente: ' + f);
    assert.strictEqual(sha(m[1]), REGISTERED[f], f);
  }
  for (const mark of ['<!--ENGINE-->', '<!--CONTROLLER-->', '<!--STORAGE-->', '/*APP_VERSION*/', '/*EXPECTED_HASHES*/{}']) {
    assert.ok(!html.includes(mark), 'marcador não substituído: ' + mark);
  }
  assert.ok(!/fonts\.googleapis|https?:\/\/(?!www\.w3\.org)/.test(html), 'o app não pode depender de recursos externos (offline)');
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /name="viewport"[^>]*width=device-width/);
});

test('manifesto atende aos requisitos de instalação do Chrome', () => {
  const m = JSON.parse(fs.readFileSync(path.join(tmp, 'manifest.webmanifest'), 'utf8'));
  assert.ok(m.name && m.short_name);
  assert.strictEqual(m.start_url, './');
  assert.ok(['fullscreen', 'standalone', 'minimal-ui'].includes(m.display));
  const sizes = m.icons.filter(i => i.type === 'image/png').map(i => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  assert.ok(m.icons.some(i => i.purpose === 'maskable'));
  for (const i of m.icons) {
    const buf = fs.readFileSync(path.join(tmp, i.src));
    if (i.type === 'image/png') {
      const [w, h] = [buf.readUInt32BE(16), buf.readUInt32BE(20)];
      assert.strictEqual(`${w}x${h}`, i.sizes, i.src);
    }
  }
});

test('service worker guarda todos os arquivos do app, e a versão muda só quando o conteúdo muda', () => {
  const sw = fs.readFileSync(path.join(tmp, 'sw.js'), 'utf8');
  const files = JSON.parse(sw.match(/const FILES = (\[.*\]);/)[1]);
  for (const f of files) if (f !== './') assert.ok(fs.existsSync(path.join(tmp, f)), 'arquivo ausente: ' + f);
  const v1 = sw.match(/const VERSION = '([0-9a-f]+)'/)[1];
  const v2 = build({ quiet: true }).version;
  assert.strictEqual(v1, v2, 'build determinístico');
  assert.ok(fs.readFileSync(path.join(tmp, 'index.html'), 'utf8').includes(`APP_VERSION = '${v1}'`));
});
