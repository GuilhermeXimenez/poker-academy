'use strict';
/*
 * Gera o app instalável (PWA) em dist/:
 *   dist/index.html  — mesa com o motor oficial incorporado SEM alterações (bytes idênticos, SHA-256 conferido)
 *   dist/sw.js       — service worker (funciona offline)
 *   dist/manifest.webmanifest, dist/icons/*
 * Uso: node app/build.js   (sem dependências)
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'engine', 'src');
const OUT = process.env.PA_DIST || path.join(ROOT, 'dist');
const ORDER = ['cards.js', 'rng.js', 'positions.js', 'evaluator.js', 'showdown.js', 'pots.js', 'betting.js', 'settlement.js',
  'engineVersion.js', 'record.js', 'replay.js'];
// Mesma tabela de simulador-v01/build.js (o teste app/test/build.test.js confere que as duas são iguais).
const REGISTERED = {
  'betting.js': 'f872caf5f19f44b77be6712932476c4b58c72b440a5c45760b6efbbb265db063',
  'cards.js': '1e91ba908f9c8ff073f11af20fdff3cc13746e1bf6c0218076786e348a78fd31',
  'evaluator.js': '1c1c834a9147c893d27cac9a00a7578ae860376c77abfb77efda5cb40aaa6ff1',
  'positions.js': '4323148778a67ea35d233cb1c4e60fe87763a32f23f9f8135befb2013e25938e',
  'pots.js': 'b614fe74d2886d982378874a8691d3cde1ec6b6b93a7810ccf1c928ea9118644',
  'rng.js': 'eb533dc4cc42c7b39cf09e444982f151a076a6eb570675ddfd91c4e3e3de6c60',
  'settlement.js': '2d9c62d39a7225ba2d4cbf80f3396e22132563b841500727f850d4ee99c380be',
  'showdown.js': 'cb9ae7f2d126f8d29d52982150840fe6c0da5dff37eadae84fbad28b735feed1',
  'engineVersion.js': 'c5955bcfc598a7b09965a3a7bf2ab984651ce1fc5222ec1c0f8d497af9df3985',
  'record.js': '9bf141f277d5e3c40f19a9dd3e1f4ac2a6b51ffee08e2881c6fb7e23dd086915',
  'replay.js': '981a46a4fe769eb420a76a76d1dcd54ca1589982c6dd854a027cc1b8f4b2e6e3',
};
const ICONS = ['icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

function inlineScript(attr, text, label) {
  if (/<\/script/i.test(text) || /<!--/.test(text)) throw new Error('sequência incompatível com <script> inline em ' + label);
  return `<script ${attr}>${text}</script>`;
}

function build({ quiet } = {}) {
  const log = quiet ? () => {} : console.log;
  const EV = require(path.join(SRC, 'engineVersion.js'));
  for (const [k, v] of Object.entries(EV.ENGINE_MODULES)) if (REGISTERED[k] !== v) throw new Error('tabela divergente de engineVersion.js: ' + k);

  let engine = '';
  for (const f of ORDER) {
    const text = fs.readFileSync(path.join(SRC, f), 'utf8');
    const h = sha(Buffer.from(text, 'utf8'));
    if (h !== REGISTERED[f]) throw new Error(`SHA-256 divergente: ${f} ${h}`);
    engine += inlineScript(`data-module="${f}"`, text, f) + '\n';
    log('  ✔', f, h);
  }
  const controller = fs.readFileSync(path.join(ROOT, 'simulador-v01', 'controller.js'), 'utf8');
  const storage = fs.readFileSync(path.join(__dirname, 'storage.js'), 'utf8');
  const manifest = fs.readFileSync(path.join(__dirname, 'manifest.webmanifest'), 'utf8');
  JSON.parse(manifest);
  const icons = ICONS.map(f => [f, fs.readFileSync(path.join(__dirname, 'icons', f))]);

  let html = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
  for (const mark of ['<!--ENGINE-->', '<!--CONTROLLER-->', '<!--STORAGE-->', '/*EXPECTED_HASHES*/{}', '/*APP_VERSION*/']) {
    if (!html.includes(mark)) throw new Error('marcador ausente no template: ' + mark);
  }
  html = html.replace('<!--ENGINE-->', () => engine)
    .replace('<!--CONTROLLER-->', () => inlineScript('data-layer="controller.js"', controller, 'controller.js'))
    .replace('<!--STORAGE-->', () => inlineScript('data-layer="storage.js"', storage, 'storage.js'))
    .replace('/*EXPECTED_HASHES*/{}', () => JSON.stringify(REGISTERED));
  // Versão = impressão digital de tudo o que vai para o aparelho (mesmo conteúdo → mesma versão).
  const version = sha(Buffer.concat([Buffer.from(html + manifest + fs.readFileSync(path.join(__dirname, 'sw.template.js'), 'utf8')),
    ...icons.map(([, b]) => b)])).slice(0, 10);
  html = html.replace('/*APP_VERSION*/', version);

  const files = ['./', 'index.html', 'manifest.webmanifest', ...ICONS.map(f => 'icons/' + f)];
  const sw = fs.readFileSync(path.join(__dirname, 'sw.template.js'), 'utf8')
    .replace('__VERSION__', version).replace('__FILES__', JSON.stringify(files));

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'icons'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'index.html'), html);
  fs.writeFileSync(path.join(OUT, 'sw.js'), sw);
  fs.writeFileSync(path.join(OUT, 'manifest.webmanifest'), manifest);
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
  for (const [f, b] of icons) fs.writeFileSync(path.join(OUT, 'icons', f), b);
  log(`dist/ pronto · versão ${version} · index.html ${html.length} bytes`);
  return { version, out: OUT, files };
}

module.exports = { build, REGISTERED, ORDER };
if (require.main === module) build();
