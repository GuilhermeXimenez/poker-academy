'use strict';
// Teste de ponta a ponta no Chromium com tela de celular (Samsung S23 FE: 384×832 CSS px).
// Rodar: npm run test:e2e   (precisa do Playwright; não roda no CI)
const test = require('node:test');
const assert = require('node:assert');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { chromium } = require('playwright');

const DIST = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-e2e-'));
process.env.PA_DIST = DIST;
require('../build.js').build({ quiet: true });
const SHOTS = process.env.PA_SHOTS || null;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml' };
function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/app\//, '/');
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(DIST, path.normalize(p));
      if (!f.startsWith(DIST) || !fs.existsSync(f)) { rsp.writeHead(404); rsp.end(); return; }
      rsp.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
      rsp.end(fs.readFileSync(f));
    }).listen(0, '127.0.0.1', () => res(srv));
  });
}

const PHONE = {
  viewport: { width: 384, height: 832 }, deviceScaleFactor: 2.8125, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S711B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
};

let browser, srv, base;
test.before(async () => { srv = await serve(); base = `http://127.0.0.1:${srv.address().port}/app/`; browser = await chromium.launch(); });
test.after(async () => { await browser.close(); srv.close(); });

async function playUntilHandsSaved(page, n) {
  for (let guard = 0; guard < 400; guard++) {
    const saved = await page.evaluate(() => window.PA_UI.historySaved().then(() => window.PA.history.count()));
    if (saved >= n) return saved;
    const btn = await page.$('#btn-next, #btn-check, #btn-call, #btn-fold');
    if (btn) await btn.tap(); else await page.waitForTimeout(30);
  }
  throw new Error('as mãos não terminaram');
}

test('instala, joga, salva o histórico, funciona offline e exporta', async () => {
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => { try { localStorage.setItem('pa-v01-setup', JSON.stringify({ speed: 0 })); } catch (e) {} });

  await page.goto(base);
  await page.waitForFunction(() => document.querySelector('#integrity').classList.contains('ok'));
  assert.match(await page.textContent('#integrity'), /11\/11 módulos conferidos/);

  // PWA: service worker ativo e controlando a página; manifesto válido.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'service worker não controla a página');
  const man = await page.evaluate(() => fetch(document.querySelector('link[rel=manifest]').href).then(r => r.json()));
  assert.strictEqual(man.display, 'fullscreen');

  // Sem rolagem horizontal na largura do S23 FE.
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'rolagem horizontal');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'mesa-celular.png') });

  // Joga mãos tocando os botões; cada mão vai para o IndexedDB já verificada pelo replay.
  const saved = await playUntilHandsSaved(page, 3);
  const rows = await page.evaluate(() => window.PA.history.all());
  assert.ok(rows.length >= 3);
  for (const r of rows) {
    assert.strictEqual(r.verified, true, 'mão não verificada pelo replay');
    assert.ok(JSON.parse(r.recordText).format);
    assert.match(r.summary, /Resultado: /);
  }
  await page.waitForFunction(n => /\d+ mãos salvas/.test(document.querySelector('#hist-stats').textContent), saved);

  // Offline: recarrega sem rede e o histórico continua lá.
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#integrity').classList.contains('ok'));
  const offCount = await page.evaluate(() => window.PA.history.count());
  assert.ok(offCount >= saved, 'histórico perdido após recarregar offline');
  await playUntilHandsSaved(page, offCount + 1);
  if (SHOTS) {
    await page.click('#hist-list details summary');
    await page.locator('#history-box').screenshot({ path: path.join(SHOTS, 'historico.png') });
  }

  // Exportação gera um JSON com todas as mãos.
  await page.evaluate(() => { navigator.canShare = () => false; });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.tap('#btn-hist-export')]);
  const file = path.join(DIST, 'export.json');
  await dl.saveAs(file);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(data.format, 'poker-academy-history');
  assert.strictEqual(data.hands.length, await page.evaluate(() => window.PA.history.count()));
  assert.ok(data.engineModules['betting.js']);

  assert.deepStrictEqual(errors, []);
  await ctx.close();
});

test('bots jogam na hora e o painel mostra só a ação relevante (sem folds)', async () => {
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base);
  assert.ok(await page.isVisible('#install-help'), 'ajuda de instalação deveria aparecer no navegador');
  let checked = 0;
  for (let h = 0; h < 25; h++) {
    const t0 = Date.now();
    await page.waitForSelector('#btn-fold, #btn-check, #btn-next', { timeout: 1500 });
    assert.ok(Date.now() - t0 < 1500, 'esperou os bots');
    if (await page.$('#facing')) {
      const txt = await page.textContent('#facing');
      assert.ok(!/fold/i.test(txt), 'o resumo não deve listar folds: ' + txt);
      assert.match(txt, /Pré-flop: /);
      const st = await page.evaluate(() => window.PA_UI.state);
      const log = st.log.filter(e => e.type === 'action' && e.action !== 'fold' && st.street === 'preflop');
      if (st.street === 'preflop') assert.strictEqual((txt.match(/→/g) || []).length, Math.max(0, log.length - 1));
      checked++;
    }
    if (h === 3 && SHOTS) await page.screenshot({ path: path.join(SHOTS, 'decisao.png') });
    const b = await page.$('#btn-next') || await page.$('#btn-fold') || await page.$('#btn-check');
    await b.tap();
  }
  assert.ok(checked >= 10);
  await page.tap('#install-help-close');
  await page.reload();
  assert.ok(!(await page.isVisible('#install-help')));
  assert.deepStrictEqual(errors, []);
  await ctx.close();
});
