/*
 * Poker Academy — service worker (gerado por app/build.js; não editar dist/sw.js à mão).
 * Guarda todos os arquivos do app no aparelho para funcionar sem internet.
 * Cada build gera uma versão nova; a versão antiga é apagada quando a nova assume.
 */
'use strict';
const VERSION = '__VERSION__';
const CACHE = 'pa-' + VERSION;
const FILES = __FILES__;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('pa-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // Primeiro o aparelho (rápido e offline); a página principal cai no index.html guardado.
  e.respondWith(caches.open(CACHE).then(c => c.match(req, { ignoreSearch: true })
    .then(hit => hit || (req.mode === 'navigate' ? c.match('./') : null))
    .then(hit => hit || fetch(req))));
});
