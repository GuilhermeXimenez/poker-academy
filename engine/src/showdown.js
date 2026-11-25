/*
 * Poker Academy — showdown.js  (Etapa 3, módulo 2)
 * Avaliação e classificação das mãos no showdown.
 *
 * Responsabilidade única: obter o score de cada mão pelo avaliador APROVADO da Etapa 1
 * (evaluator.evaluate / describe) e COMPARAR esses scores. Este módulo não contém nenhuma
 * regra de categoria, kicker ou sequência, e não conhece potes nem pagamentos (settlement.js).
 *
 * Funções:
 *   evaluateHands({ board, hands: [{ id, holeCards }] })
 *     -> [{ id, holeCards, score, category, categoryEN, categoryPT, description }]  (ordem da entrada)
 *   rankHands(evaluated)
 *     -> [{ rank, score, ids }]  rank 1 = mais forte; empates no mesmo grupo; ids na ordem de `evaluated`
 *   winnersAmong(evaluated, ids)
 *     -> ids com o maior score dentro de `ids`, na ordem de `evaluated` (não na ordem de `ids`)
 *
 * Cartas: índices 0..51 (representação do motor). Board: exatamente 5 cartas. Mão: exatamente 2.
 * Determinístico: sem aleatoriedade; nunca altera as entradas.
 *
 * Erros (ShowdownError.code): INVALID_INPUT, INVALID_BOARD, INVALID_HOLE_CARDS, INVALID_CARD,
 *   DUPLICATE_CARD, INVALID_SCORE, EMPTY_SELECTION, DUPLICATE_ID, UNKNOWN_PLAYER.
 */
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const deps = isNode ? { evaluator: require('./evaluator.js') } : { evaluator: root.PA.evaluator };
  const api = factory(deps);
  if (isNode) module.exports = api;
  else (root.PA = root.PA || {}).showdown = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';
  const E = deps.evaluator;
  const MAX_SCORE = 9 * E.CAT_BASE - 1; // maior score possível do avaliador (categoria 8)

  class ShowdownError extends Error {
    constructor(code, message) {
      super(code + ': ' + message);
      this.name = 'ShowdownError';
      this.code = code;
    }
  }

  const isCard = c => Number.isInteger(c) && c >= 0 && c < 52;

  // ------------------------------------------------------------------ evaluateHands

  function evaluateHands(input) {
    if (!input || typeof input !== 'object') throw new ShowdownError('INVALID_INPUT', 'entrada ausente');
    const { board, hands } = input;
    if (!Array.isArray(board) || board.length !== 5) throw new ShowdownError('INVALID_BOARD', 'o board deve ter exatamente 5 cartas');
    if (!Array.isArray(hands) || hands.length === 0) throw new ShowdownError('INVALID_INPUT', 'hands deve ser um array não vazio');
    const seenCards = new Set();
    const useCard = (c, where) => {
      if (!isCard(c)) throw new ShowdownError('INVALID_CARD', `carta inválida em ${where}: ${String(c)}`);
      if (seenCards.has(c)) throw new ShowdownError('DUPLICATE_CARD', `carta ${c} repetida (${where})`);
      seenCards.add(c);
    };
    board.forEach(c => useCard(c, 'board'));
    const ids = new Set();
    for (const h of hands) {
      if (!h || typeof h.id !== 'string' || !h.id) throw new ShowdownError('INVALID_INPUT', 'mão sem id');
      if (ids.has(h.id)) throw new ShowdownError('INVALID_INPUT', 'id duplicado: ' + h.id);
      ids.add(h.id);
      if (!Array.isArray(h.holeCards) || h.holeCards.length !== 2) {
        throw new ShowdownError('INVALID_HOLE_CARDS', `${h.id} deve ter exatamente 2 cartas`);
      }
      h.holeCards.forEach(c => useCard(c, h.id));
    }
    return hands.map(h => {
      const score = E.evaluate([...h.holeCards, ...board]);
      const d = E.describe(score);
      return {
        id: h.id, holeCards: h.holeCards.slice(), score,
        category: d.category, categoryEN: d.categoryEN, categoryPT: d.categoryPT, description: d.text,
      };
    });
  }

  // ------------------------------------------------------------------ validação de `evaluated`

  function validateEvaluated(evaluated) {
    if (!Array.isArray(evaluated) || evaluated.length === 0) throw new ShowdownError('INVALID_INPUT', 'evaluated deve ser um array não vazio');
    const ids = new Set();
    for (const e of evaluated) {
      if (!e || typeof e !== 'object') throw new ShowdownError('INVALID_INPUT', 'item de evaluated inválido');
      if (typeof e.id !== 'string' || !e.id) throw new ShowdownError('INVALID_INPUT', 'item sem id');
      if (ids.has(e.id)) throw new ShowdownError('INVALID_INPUT', 'id duplicado: ' + e.id);
      if (!Number.isInteger(e.score) || e.score < 0 || e.score > MAX_SCORE) {
        throw new ShowdownError('INVALID_SCORE', `score inválido para ${e.id}: ${String(e.score)}`);
      }
      ids.add(e.id);
    }
  }

  // ------------------------------------------------------------------ rankHands

  function rankHands(evaluated) {
    validateEvaluated(evaluated);
    // Scores distintos em ordem decrescente; comparação exclusivamente numérica.
    const distinct = [...new Set(evaluated.map(e => e.score))].sort((a, b) => b - a);
    return distinct.map((score, i) => ({
      rank: i + 1,
      score,
      ids: evaluated.filter(e => e.score === score).map(e => e.id), // ordem de `evaluated`
    }));
  }

  // ------------------------------------------------------------------ winnersAmong

  function winnersAmong(evaluated, ids) {
    validateEvaluated(evaluated);
    if (!Array.isArray(ids) || ids.length === 0) throw new ShowdownError('EMPTY_SELECTION', 'seleção de jogadores vazia');
    const known = new Set(evaluated.map(e => e.id));
    const selected = new Set();
    for (const id of ids) {
      if (selected.has(id)) throw new ShowdownError('DUPLICATE_ID', 'id repetido na seleção: ' + String(id));
      if (!known.has(id)) throw new ShowdownError('UNKNOWN_PLAYER', 'id não avaliado: ' + String(id));
      selected.add(id);
    }
    const pool = evaluated.filter(e => selected.has(e.id));
    const best = pool.reduce((m, e) => (e.score > m ? e.score : m), -1);
    return pool.filter(e => e.score === best).map(e => e.id); // ordem de `evaluated`
  }

  return Object.freeze({ ShowdownError, MAX_SCORE, evaluateHands, rankHands, winnersAmong });
});
