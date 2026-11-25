'use strict';
/*
 * Gera mesa-v0.1.html: incorpora os módulos do motor oficial SEM alterações (bytes idênticos),
 * depois de conferir cada SHA-256 contra a tabela registrada (Contexto 09 e engineVersion.js).
 * Só lê a árvore oficial; escreve apenas nesta pasta.
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const SRC = path.join(__dirname, '..', 'engine', 'src');
const ORDER = ['cards.js', 'rng.js', 'positions.js', 'evaluator.js', 'showdown.js', 'pots.js', 'betting.js', 'settlement.js',
  'engineVersion.js', 'record.js', 'replay.js'];
// Hashes registrados: 8 módulos congelados (engineVersion.ENGINE_MODULES / Contexto 09 seção 8.1) + 3 da Etapa 4 (Contexto 09 seção 8.4).
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
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const EV = require(path.join(SRC, 'engineVersion.js'));
for (const [k, v] of Object.entries(EV.ENGINE_MODULES)) if (REGISTERED[k] !== v) throw new Error('tabela divergente de engineVersion.js: ' + k);

let engine = '';
for (const f of ORDER) {
  const text = fs.readFileSync(path.join(SRC, f), 'utf8');
  const h = sha(Buffer.from(text, 'utf8'));
  if (h !== REGISTERED[f]) throw new Error(`SHA-256 divergente: ${f} ${h}`);
  if (/<\/script/i.test(text) || /<!--/.test(text)) throw new Error('sequência incompatível com <script> inline em ' + f);
  engine += `<script data-module="${f}">${text}</script>\n`;
  console.log('  ✔', f, h);
}
const controller = fs.readFileSync(path.join(__dirname, 'controller.js'), 'utf8');
let html = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
html = html.replace('<!--ENGINE-->', () => engine)
  .replace('<!--CONTROLLER-->', () => `<script data-layer="controller.js">${controller}</script>`)
  .replace('/*EXPECTED_HASHES*/{}', () => JSON.stringify(REGISTERED));
fs.writeFileSync(path.join(__dirname, 'mesa-v0.1.html'), html);
console.log('mesa-v0.1.html', html.length, 'bytes; sha256', sha(Buffer.from(html, 'utf8')));
