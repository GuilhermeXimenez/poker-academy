/*
 * Poker Academy — rng.js
 * Geradores de aleatoriedade e baralho.
 *
 * - createSeededRng(seed): xoshiro128** inicializado por splitmix32.
 *   Reprodutível: mesma semente => mesma sequência. Usado em testes e replays.
 * - createCryptoRng(): usa crypto.getRandomValues (mãos livres).
 * Ambos expõem nextUint32() e randomInt(n) sem viés (rejection sampling).
 *
 * Limitação conhecida: uma semente de 32 bits gera no máximo 2^32 baralhos
 * distintos, muito menos que 52!. Irrelevante para treino; mãos livres usam crypto.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.PA = root.PA || {}).rng = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function splitmix32(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
  }

  function rotl(x, k) { return ((x << k) | (x >>> (32 - k))) >>> 0; }

  function withRandomInt(nextUint32, meta) {
    function randomInt(n) {
      if (!Number.isInteger(n) || n <= 0 || n > 0x100000000) throw new RangeError('randomInt: n inválido ' + n);
      // Rejeita valores do topo que causariam viés de módulo.
      const limit = 0x100000000 - (0x100000000 % n);
      let x;
      do { x = nextUint32(); } while (x >= limit);
      return x % n;
    }
    return Object.freeze(Object.assign({ nextUint32, randomInt }, meta));
  }

  function createSeededRng(seed) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Semente deve ser inteiro 0..2^32-1');
    const sm = splitmix32(seed);
    let s0 = sm(), s1 = sm(), s2 = sm(), s3 = sm();
    if ((s0 | s1 | s2 | s3) === 0) s0 = 1; // estado nulo é proibido no xoshiro
    function nextUint32() {
      const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
      const t = (s1 << 9) >>> 0;
      s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3;
      s2 ^= t;
      s3 = rotl(s3, 11);
      s0 >>>= 0; s1 >>>= 0; s2 >>>= 0;
      return result;
    }
    return withRandomInt(nextUint32, { kind: 'seeded', seed });
  }

  function createCryptoRng() {
    const c = (typeof globalThis !== 'undefined') ? globalThis.crypto : undefined;
    if (!c || typeof c.getRandomValues !== 'function') throw new Error('crypto.getRandomValues indisponível');
    const buf = new Uint32Array(256);
    let idx = buf.length;
    function nextUint32() {
      if (idx >= buf.length) { c.getRandomValues(buf); idx = 0; }
      return buf[idx++];
    }
    return withRandomInt(nextUint32, { kind: 'crypto' });
  }

  function newDeck() {
    const d = new Array(52);
    for (let i = 0; i < 52; i++) d[i] = i;
    return d;
  }

  /** Fisher-Yates (Durstenfeld). Retorna um NOVO array; não altera a entrada. */
  function shuffle(cards, rng) {
    if (!rng || typeof rng.randomInt !== 'function') throw new TypeError('shuffle exige um rng');
    const a = cards.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = rng.randomInt(i + 1);
      const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function shuffledDeck(rng) { return shuffle(newDeck(), rng); }

  return Object.freeze({ createSeededRng, createCryptoRng, newDeck, shuffle, shuffledDeck });
});
