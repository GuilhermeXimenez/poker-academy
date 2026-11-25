/*
 * Poker Academy — cards.js
 * Representação inequívoca das cartas.
 *
 * Índice interno: 0..51 = rank * 4 + suit
 *   rank: 0..12  -> 2,3,4,5,6,7,8,9,T,J,Q,K,A
 *   suit: 0..3   -> c (paus), d (ouros), h (copas), s (espadas)
 * Texto: "As", "Td", "9c", "2h".
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.PA = root.PA || {}).cards = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const RANK_CHARS = '23456789TJQKA';
  const SUIT_CHARS = 'cdhs';
  const RANK_NAMES_PT = ['Dois', 'Três', 'Quatro', 'Cinco', 'Seis', 'Sete', 'Oito', 'Nove', 'Dez', 'Valete', 'Dama', 'Rei', 'Ás'];
  const SUIT_NAMES_PT = ['paus', 'ouros', 'copas', 'espadas'];
  const SUIT_SYMBOLS = ['♣', '♦', '♥', '♠'];

  function isValidCard(c) {
    return Number.isInteger(c) && c >= 0 && c < 52;
  }

  function assertCard(c) {
    if (!isValidCard(c)) throw new RangeError('Carta inválida: ' + String(c));
  }

  function makeCard(rank, suit) {
    if (!Number.isInteger(rank) || rank < 0 || rank > 12) throw new RangeError('Rank inválido: ' + rank);
    if (!Number.isInteger(suit) || suit < 0 || suit > 3) throw new RangeError('Naipe inválido: ' + suit);
    return rank * 4 + suit;
  }

  function rankOf(c) { assertCard(c); return c >> 2; }
  function suitOf(c) { assertCard(c); return c & 3; }

  function parseCard(str) {
    if (typeof str !== 'string' || str.length !== 2) throw new SyntaxError('Texto de carta inválido: ' + String(str));
    const r = RANK_CHARS.indexOf(str[0].toUpperCase());
    const s = SUIT_CHARS.indexOf(str[1].toLowerCase());
    if (r < 0 || s < 0) throw new SyntaxError('Texto de carta inválido: ' + str);
    return r * 4 + s;
  }

  /** "AsKd 7c" ou ["As","Kd"] -> [índices]; rejeita duplicatas. */
  function parseCards(input) {
    let parts;
    if (Array.isArray(input)) parts = input;
    else if (typeof input === 'string') {
      const compact = input.replace(/[\s,]+/g, '');
      if (compact.length % 2 !== 0) throw new SyntaxError('Texto de cartas inválido: ' + input);
      parts = [];
      for (let i = 0; i < compact.length; i += 2) parts.push(compact.slice(i, i + 2));
    } else throw new TypeError('Entrada de cartas inválida');
    const cards = parts.map(p => (typeof p === 'number' ? (assertCard(p), p) : parseCard(p)));
    assertDistinct(cards);
    return cards;
  }

  function formatCard(c) {
    assertCard(c);
    return RANK_CHARS[c >> 2] + SUIT_CHARS[c & 3];
  }

  function formatCards(cards) { return cards.map(formatCard).join(' '); }

  function cardNamePT(c) {
    assertCard(c);
    return RANK_NAMES_PT[c >> 2] + ' de ' + SUIT_NAMES_PT[c & 3];
  }

  function assertDistinct(cards) {
    const seen = new Set();
    for (const c of cards) {
      assertCard(c);
      if (seen.has(c)) throw new Error('Carta duplicada: ' + formatCard(c));
      seen.add(c);
    }
  }

  return Object.freeze({
    RANK_CHARS, SUIT_CHARS, RANK_NAMES_PT, SUIT_NAMES_PT, SUIT_SYMBOLS,
    isValidCard, assertCard, makeCard, rankOf, suitOf,
    parseCard, parseCards, formatCard, formatCards, cardNamePT, assertDistinct,
  });
});
