/*
 * Poker Academy — app/storage.js
 * Histórico de mãos salvo no aparelho (IndexedDB). Só guarda e devolve dados; não decide nada do jogo.
 * Cada entrada guarda o registro canônico da mão (texto gerado pelo motor em record.js) e um resumo.
 * API (window.PA.history): add(entry), list(limit), count(), all(), clear(), stats()
 */
(function (root) {
  'use strict';
  const DB_NAME = 'poker-academy', DB_VERSION = 1, STORE = 'hands';
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!root.indexedDB) { reject(new Error('IndexedDB indisponível neste navegador')); return; }
      const req = root.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const st = db.createObjectStore(STORE, { keyPath: 'seq', autoIncrement: true });
          st.createIndex('handId', 'handId', { unique: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => { dbPromise = null; });
    return dbPromise;
  }

  function tx(mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const st = t.objectStore(STORE);
      let out;
      Promise.resolve(fn(st, v => { out = v; })).catch(reject);
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('transação abortada'));
    }));
  }

  /** entry: { handId, savedAt, summary, recordText, heroNetBB, heroPosition, heroCards, verified } */
  function add(entry) {
    if (!entry || typeof entry.handId !== 'string' || typeof entry.recordText !== 'string') return Promise.reject(new Error('entrada inválida'));
    return tx('readwrite', (st, set) => { const r = st.add(entry); r.onsuccess = () => set(r.result); });
  }

  /** Últimas `limit` mãos, da mais recente para a mais antiga. */
  function list(limit) {
    return tx('readonly', (st, set) => {
      const out = [];
      const req = st.openCursor(null, 'prev');
      req.onsuccess = () => {
        const c = req.result;
        if (c && out.length < (limit || 20)) { out.push(c.value); c.continue(); } else set(out);
      };
    });
  }

  function all() { return tx('readonly', (st, set) => { const r = st.getAll(); r.onsuccess = () => set(r.result); }); }
  function count() { return tx('readonly', (st, set) => { const r = st.count(); r.onsuccess = () => set(r.result); }); }
  function clear() { return tx('readwrite', st => { st.clear(); }); }

  function stats() {
    return all().then(rows => {
      const total = rows.reduce((a, r) => a + (Number(r.heroNetBB) || 0), 0);
      return { hands: rows.length, totalBB: Math.round(total * 10) / 10 };
    });
  }

  /** Pede ao navegador para não apagar os dados quando o espaço do aparelho apertar. */
  function persist() {
    try { if (root.navigator && navigator.storage && navigator.storage.persist) return navigator.storage.persist(); } catch (e) { /* ignora */ }
    return Promise.resolve(false);
  }

  (root.PA = root.PA || {}).history = Object.freeze({ add, list, all, count, clear, stats, persist });
})(typeof globalThis !== 'undefined' ? globalThis : this);
