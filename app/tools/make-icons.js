'use strict';
// Gera os PNGs do ícone a partir dos SVGs (usa o Chromium do Playwright). Rodar só quando o ícone mudar:
//   node app/tools/make-icons.js
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..', 'icons');
const JOBS = [['icon.svg', 'icon-192.png', 192], ['icon.svg', 'icon-512.png', 512], ['icon-maskable.svg', 'icon-maskable-512.png', 512]];
(async () => {
  const browser = await chromium.launch();
  for (const [src, out, size] of JOBS) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const svg = fs.readFileSync(path.join(DIR, src), 'utf8');
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`);
    await page.screenshot({ path: path.join(DIR, out), omitBackground: true });
    console.log('  ✔', out);
  }
  await browser.close();
})();
