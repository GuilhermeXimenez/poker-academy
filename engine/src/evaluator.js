/*
 * Poker Academy — evaluator.js
 * Avaliador de mãos de Texas Hold'em (5 a 7 cartas).
 *
 * Retorna um score inteiro: maior = melhor; iguais = empate.
 *   score = categoria * 13^5 + desempates (ranks em base 13, do mais ao menos importante)
 * Categorias: 0 High card, 1 One pair, 2 Two pair, 3 Three of a kind, 4 Straight,
 *             5 Flush, 6 Full house, 7 Four of a kind, 8 Straight flush.
 * O naipe nunca desempata. Royal flush = straight flush com Ás alto.
 *
 * Duas implementações independentes:
 *  - evaluate(): direta, por contagem de ranks e máscaras de naipe (usada pelo motor).
 *  - evaluateBruteForce(): melhor entre todas as combinações de 5 cartas, usando
 *    evaluate5Reference() (ordenação e agrupamento). Existe apenas para validação cruzada.
 */
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const cards = isNode ? require('./cards.js') : root.PA.cards;
  const api = factory(cards);
  if (isNode) module.exports = api;
  else (root.PA = root.PA || {}).evaluator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (cardsLib) {
  'use strict';

  const B = 13;
  const CAT_BASE = B ** 5; // 371293

  const CATEGORY_EN = ['High card', 'One pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];
  const CATEGORY_PT = ['Carta alta', 'Um par', 'Dois pares', 'Trinca', 'Sequência', 'Flush', 'Full house', 'Quadra', 'Straight flush'];

  function encode(cat, ranks) {
    let v = 0;
    for (let i = 0; i < 5; i++) v = v * B + (i < ranks.length ? ranks[i] : 0);
    return cat * CAT_BASE + v;
  }

  // Maior carta de uma sequência numa máscara de 13 bits (bit r = rank r), ou -1.
  function straightHigh(mask) {
    for (let hi = 12; hi >= 4; hi--) {
      const w = 0x1f << (hi - 4);
      if ((mask & w) === w) return hi;
    }
    if ((mask & 0x100f) === 0x100f) return 3; // A-2-3-4-5 (wheel): carta alta é o 5
    return -1;
  }

  function topRanks(mask, n, exclude) {
    const out = [];
    for (let r = 12; r >= 0 && out.length < n; r--) {
      if ((mask >> r) & 1 && exclude.indexOf(r) < 0) out.push(r);
    }
    return out;
  }

  /** Núcleo: counts[13], suitMasks[4], rankMask (OR das máscaras). */
  function evalCore(counts, suitMasks, rankMask) {
    // Flush / straight flush
    for (let s = 0; s < 4; s++) {
      const m = suitMasks[s];
      if (popcount(m) >= 5) {
        const sh = straightHigh(m);
        if (sh >= 0) return encode(8, [sh]);
        // Flush: com 7 cartas não pode coexistir quadra ou full house (provado pelos testes).
        return encode(5, topRanks(m, 5, []));
      }
    }
    let quad = -1;
    const trips = [], pairs = [];
    for (let r = 12; r >= 0; r--) {
      const c = counts[r];
      if (c === 4) quad = r;
      else if (c === 3) trips.push(r);
      else if (c === 2) pairs.push(r);
    }
    if (quad >= 0) return encode(7, [quad, topRanks(rankMask, 1, [quad])[0]]);
    if (trips.length >= 1 && (trips.length >= 2 || pairs.length >= 1)) {
      const t = trips[0];
      const p = Math.max(trips.length >= 2 ? trips[1] : -1, pairs.length >= 1 ? pairs[0] : -1);
      return encode(6, [t, p]);
    }
    const sh = straightHigh(rankMask);
    if (sh >= 0) return encode(4, [sh]);
    if (trips.length === 1) return encode(3, [trips[0]].concat(topRanks(rankMask, 2, [trips[0]])));
    if (pairs.length >= 2) {
      const p1 = pairs[0], p2 = pairs[1];
      return encode(2, [p1, p2].concat(topRanks(rankMask, 1, [p1, p2])));
    }
    if (pairs.length === 1) return encode(1, [pairs[0]].concat(topRanks(rankMask, 3, [pairs[0]])));
    return encode(0, topRanks(rankMask, 5, []));
  }

  function popcount(x) {
    x = x - ((x >> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
    return (((x + (x >> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }

  function validateHand(hand) {
    if (!Array.isArray(hand) || hand.length < 5 || hand.length > 7) throw new RangeError('A avaliação exige de 5 a 7 cartas');
    cardsLib.assertDistinct(hand);
  }

  function evaluate(hand) {
    validateHand(hand);
    const counts = new Array(13).fill(0);
    const suitMasks = [0, 0, 0, 0];
    for (const c of hand) {
      const r = c >> 2;
      counts[r]++;
      suitMasks[c & 3] |= 1 << r;
    }
    return evalCore(counts, suitMasks, suitMasks[0] | suitMasks[1] | suitMasks[2] | suitMasks[3]);
  }

  // ---------- Implementação de referência (independente) ----------
  function evaluate5Reference(five) {
    const ranks = five.map(c => c >> 2).sort((a, b) => b - a);
    const isFlush = five.every(c => (c & 3) === (five[0] & 3));
    const uniq = [...new Set(ranks)];
    let straightTop = -1;
    if (uniq.length === 5) {
      if (ranks[0] - ranks[4] === 4) straightTop = ranks[0];
      else if (ranks[0] === 12 && ranks[1] === 3 && ranks[4] === 0) straightTop = 3;
    }
    const groups = uniq.map(r => [ranks.filter(x => x === r).length, r])
      .sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    const shape = groups.map(g => g[0]).join('');
    const ordered = groups.map(g => g[1]);
    if (isFlush && straightTop >= 0) return encode(8, [straightTop]);
    if (shape === '41') return encode(7, ordered);
    if (shape === '32') return encode(6, ordered);
    if (isFlush) return encode(5, ranks);
    if (straightTop >= 0) return encode(4, [straightTop]);
    if (shape === '311') return encode(3, ordered);
    if (shape === '221') return encode(2, ordered);
    if (shape === '2111') return encode(1, ordered);
    return encode(0, ranks);
  }

  function evaluateBruteForce(hand) {
    validateHand(hand);
    const n = hand.length;
    let best = -1;
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++)
      for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++) {
        const v = evaluate5Reference([hand[a], hand[b], hand[c], hand[d], hand[e]]);
        if (v > best) best = v;
      }
    return best;
  }

  // ---------- Utilidades ----------
  function categoryOf(score) { return Math.floor(score / CAT_BASE); }

  function decode(score) {
    const cat = categoryOf(score);
    let v = score % CAT_BASE;
    const ranks = [];
    for (let i = 0; i < 5; i++) { ranks.unshift(v % B); v = Math.floor(v / B); }
    return { category: cat, ranks };
  }

  function describe(score) {
    const { category, ranks } = decode(score);
    const R = cardsLib.RANK_NAMES_PT;
    const RC = cardsLib.RANK_CHARS;
    const pt = CATEGORY_PT[category], en = CATEGORY_EN[category];
    let detail;
    switch (category) {
      case 8: detail = ranks[0] === 12 ? 'Royal flush' : R[ranks[0]] + ' alto'; break;
      case 7: detail = 'de ' + R[ranks[0]] + ', kicker ' + RC[ranks[1]]; break;
      case 6: detail = R[ranks[0]] + ' com ' + R[ranks[1]]; break;
      case 5: detail = ranks.map(r => RC[r]).join(''); break;
      case 4: detail = R[ranks[0]] + ' alto'; break;
      case 3: detail = 'de ' + R[ranks[0]] + ', kickers ' + RC[ranks[1]] + RC[ranks[2]]; break;
      case 2: detail = R[ranks[0]] + ' e ' + R[ranks[1]] + ', kicker ' + RC[ranks[2]]; break;
      case 1: detail = 'de ' + R[ranks[0]] + ', kickers ' + RC[ranks[1]] + RC[ranks[2]] + RC[ranks[3]]; break;
      default: detail = ranks.map(r => RC[r]).join('');
    }
    return { category, categoryPT: pt, categoryEN: en, text: pt + ' (' + en + ') — ' + detail };
  }

  /** > 0 se a vence b, < 0 se b vence a, 0 empate. */
  function compareHands(a, b) { return evaluate(a) - evaluate(b); }

  return Object.freeze({
    CAT_BASE, CATEGORY_EN, CATEGORY_PT,
    evaluate, evaluateBruteForce, evaluate5Reference, evalCore,
    straightHigh, categoryOf, decode, describe, compareHands,
  });
});
