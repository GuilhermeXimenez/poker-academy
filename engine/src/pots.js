/*
 * Poker Academy — pots.js  (Etapa 3, módulo 1)
 * Devolução de aposta não paga e construção de potes. Aritmética pura: não conhece cartas,
 * não lê o estado do motor. Quem chama converte o estado em `entries` (ver settlement.js, futuro).
 *
 * Entradas:
 *   entries: [{ id, c, live }]
 *     c    = contribuição de CAMADA (inteiro >= 0). Exclui o dinheiro morto.
 *     live = jogador que NÃO desistiu (inclui jogadores all-in).
 *   dead : dinheiro morto (inteiro >= 0), ex.: BB ante na convenção 'deadToMainPot'.
 *
 * Regras (planejamento v5):
 *   S2  computeUncalled: o maior c, se ÚNICO e VIVO, recebe c(1º) − c(2º), com o 2º calculado
 *       entre TODOS os demais (inclusive quem desistiu). Empate no topo: nada. Topo desistiu: nada
 *       (nota TOP_CONTRIBUTOR_FOLDED). ALCANÇÁVEL em jogo legal: com BB ante morto (convenção D),
 *       um BB com c = 0 (anteFirst, stack <= ante) faz com que o maior c seja de quem desistiu
 *       (ex.: SB/BTN desiste diante do BB curto). Quem desiste perde o que apostou; nada volta.
 *   S3  Fatias em TODOS os valores distintos de c (de todos os jogadores). Para (v[k-1], v[k]]:
 *         quantia = Σ_todos min(c, v[k]) − min(c, v[k-1]);  elegíveis = vivos com c >= v[k].
 *   S5  Fatia-base (nível 0): recebe o dinheiro morto; elegíveis = TODOS os vivos.
 *   A4  Fatia sem elegíveis desce para a fatia inferior mais próxima com elegíveis, preservando
 *       a rastreabilidade em `descended` (faixa original, quantia e contribuições por jogador).
 *       Como os conjuntos de elegíveis são aninhados (diminuem com o nível), as fatias vazias
 *       são sempre as de cima, e a fatia-base sempre tem elegíveis (há ao menos um vivo).
 *       Nota SLICE_WITHOUT_ELIGIBLE_DESCENDED. ALCANÇÁVEL em jogo legal no mesmo cenário de S2
 *       (BB ante morto, BB vivo com c = 0): as fichas de quem desistiu descem para a fatia-base.
 *   —   Entrada sem nenhuma ficha (dead + Σ c = 0) é rejeitada com NOTHING_TO_DISTRIBUTE, antes da
 *       construção. Não ocorre em mão legal (SB e BB postam >= 1 ficha, ou há dinheiro morto);
 *       se ocorrer, indica defeito a montante. POTS_INVARIANT_VIOLATION fica reservado a falhas
 *       internas do algoritmo.
 *   —   Fatias vizinhas com o mesmo conjunto de elegíveis são fundidas. Fatia-base com quantia
 *       zero que não recebeu nada é descartada. Índice 0 = 'main'; demais = 'side'.
 *
 * Pós-condições (checkPots, executado sempre):
 *   Σ amount = dead + Σ c;  nenhum pote vazio (amount > 0) nem sem elegíveis;  eligible ⊆ vivos;
 *   índices consecutivos 0..n-1;  contribuições por jogador somam o c de cada um;
 *   Σ deadMoney = dead;  elegíveis estritamente aninhados (cada side ⊂ anterior).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.PA = root.PA || {}).pots = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  class PotsError extends Error {
    constructor(code, message) {
      super(code + ': ' + message);
      this.name = 'PotsError';
      this.code = code;
    }
  }

  const isNonNegInt = x => Number.isInteger(x) && x >= 0;

  // Mapas indexados por id: ids são strings arbitrárias não vazias (contrato do betting.js), inclusive
  // 'constructor', 'toString' e '__proto__'. Escrita sempre como propriedade própria; leitura ignora herdadas.
  const setOwn = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
  const getOwn = (o, k) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
  const copyOwn = o => { const out = {}; for (const [k, v] of Object.entries(o)) setOwn(out, k, v); return out; };

  function validateEntries(entries) {
    if (!Array.isArray(entries) || entries.length === 0) throw new PotsError('INVALID_INPUT', 'entries deve ser um array não vazio');
    const ids = new Set();
    for (const e of entries) {
      if (!e || typeof e.id !== 'string' || !e.id) throw new PotsError('INVALID_INPUT', 'entrada sem id');
      if (ids.has(e.id)) throw new PotsError('INVALID_INPUT', 'id duplicado: ' + e.id);
      if (!isNonNegInt(e.c)) throw new PotsError('INVALID_INPUT', `c inválido para ${e.id}: ${e.c}`);
      if (typeof e.live !== 'boolean') throw new PotsError('INVALID_INPUT', `live deve ser booleano para ${e.id}`);
      ids.add(e.id);
    }
  }

  // ------------------------------------------------------------------ S2: devolução

  function computeUncalled(entries) {
    validateEntries(entries);
    const notes = [];
    const adjusted = entries.map(e => ({ id: e.id, c: e.c }));
    const returns = [];
    let top = -1;
    for (const e of entries) if (e.c > top) top = e.c;
    const atTop = entries.filter(e => e.c === top);
    if (atTop.length === 1 && top > 0) {
      const T = atTop[0];
      const second = entries.reduce((m, e) => (e.id !== T.id && e.c > m ? e.c : m), 0);
      const excess = top - second;
      if (excess > 0) {
        if (T.live) {
          returns.push({ id: T.id, amount: excess });
          adjusted.find(a => a.id === T.id).c = second;
        } else {
          notes.push('TOP_CONTRIBUTOR_FOLDED');
        }
      }
    }
    return { returns, adjusted, notes };
  }

  // ------------------------------------------------------------------ S3/S5/A4: potes

  const sameSet = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  function addContrib(target, src) {
    for (const [id, amt] of Object.entries(src)) setOwn(target, id, (getOwn(target, id) || 0) + amt);
  }

  function buildPots(input) {
    if (!input || typeof input !== 'object') throw new PotsError('INVALID_INPUT', 'entrada ausente');
    const { entries } = input;
    const dead = input.dead === undefined ? 0 : input.dead;
    validateEntries(entries);
    if (!isNonNegInt(dead)) throw new PotsError('INVALID_INPUT', 'dead deve ser inteiro >= 0');
    const liveIds = entries.filter(e => e.live).map(e => e.id);
    if (liveIds.length === 0) throw new PotsError('NO_LIVE_PLAYER', 'nenhum jogador vivo para receber os potes');
    if (dead + entries.reduce((s, e) => s + e.c, 0) === 0) {
      throw new PotsError('NOTHING_TO_DISTRIBUTE', 'dinheiro morto + Σ c = 0: não há fichas a distribuir');
    }

    const notes = [];
    // Fatia-base (nível 0): dinheiro morto; elegíveis = todos os vivos (na ordem de entrada).
    const slices = [{
      from: 0, to: 0, amount: dead, contributions: {}, deadMoney: dead,
      eligible: liveIds.slice(), descended: [], isBase: true,
    }];
    const levels = [...new Set(entries.map(e => e.c).filter(c => c > 0))].sort((a, b) => a - b);
    let prev = 0;
    for (const v of levels) {
      const contributions = {};
      let amount = 0;
      for (const e of entries) {
        const part = Math.min(e.c, v) - Math.min(e.c, prev);
        if (part > 0) { setOwn(contributions, e.id, part); amount += part; }
      }
      const eligible = entries.filter(e => e.live && e.c >= v).map(e => e.id);
      slices.push({ from: prev, to: v, amount, contributions, deadMoney: 0, eligible, descended: [], isBase: false });
      prev = v;
    }

    // A4: fatias sem elegíveis descem para a inferior mais próxima com elegíveis.
    for (let k = slices.length - 1; k >= 1; k--) {
      const s = slices[k];
      if (s.eligible.length > 0) continue;
      let j = k - 1;
      while (j >= 0 && slices[j].eligible.length === 0) j--;
      if (j < 0) throw new PotsError('POTS_INVARIANT_VIOLATION', 'fatia sem destino'); // impossível: base tem elegíveis
      const target = slices[j];
      target.amount += s.amount;
      addContrib(target.contributions, s.contributions);
      target.descended.push({ from: s.from, to: s.to, amount: s.amount, contributions: copyOwn(s.contributions) });
      for (const d of s.descended) target.descended.push(d);
      slices.splice(k, 1);
      if (!notes.includes('SLICE_WITHOUT_ELIGIBLE_DESCENDED')) notes.push('SLICE_WITHOUT_ELIGIBLE_DESCENDED');
    }

    // Descarta a fatia-base vazia (sem morto e sem fichas descidas).
    const kept = slices.filter(s => s.amount > 0);

    // Fusão de vizinhas com o mesmo conjunto de elegíveis.
    const merged = [];
    for (const s of kept) {
      const last = merged[merged.length - 1];
      if (last && sameSet(last.eligible, s.eligible)) {
        last.to = s.to;
        last.amount += s.amount;
        addContrib(last.contributions, s.contributions);
        last.deadMoney += s.deadMoney;
        for (const d of s.descended) last.descended.push(d);
      } else {
        merged.push({
          from: s.from, to: s.to, amount: s.amount, contributions: copyOwn(s.contributions),
          deadMoney: s.deadMoney, eligible: s.eligible.slice(), descended: s.descended.slice(),
        });
      }
    }

    const pots = merged.map((p, i) => ({
      index: i, kind: i === 0 ? 'main' : 'side',
      from: p.from, to: p.to, amount: p.amount,
      contributions: p.contributions, deadMoney: p.deadMoney,
      eligible: p.eligible, descended: p.descended,
    }));
    const result = { pots, notes };
    checkPots(input, result);
    return result;
  }

  // ------------------------------------------------------------------ pós-condições

  function fail(msg) { throw new PotsError('POTS_INVARIANT_VIOLATION', msg); }

  function checkPots(input, result) {
    const { entries } = input;
    const dead = input.dead === undefined ? 0 : input.dead;
    const pots = result.pots;
    const live = new Set(entries.filter(e => e.live).map(e => e.id));
    const totalC = entries.reduce((s, e) => s + e.c, 0);
    if (!Array.isArray(pots) || pots.length === 0) fail('nenhum pote');
    let sumAmount = 0, sumDead = 0;
    const perPlayer = new Map();
    pots.forEach((p, i) => {
      if (p.index !== i) fail(`índice ${p.index} fora de sequência (esperado ${i})`);
      if (p.kind !== (i === 0 ? 'main' : 'side')) fail(`tipo incorreto no pote ${i}`);
      if (!isNonNegInt(p.amount) || p.amount === 0) fail(`pote ${i} vazio ou inválido`);
      if (!Array.isArray(p.eligible) || p.eligible.length === 0) fail(`pote ${i} sem elegíveis`);
      for (const id of p.eligible) if (!live.has(id)) fail(`pote ${i}: ${id} não é vivo`);
      if (new Set(p.eligible).size !== p.eligible.length) fail(`pote ${i}: elegível duplicado`);
      const contribSum = Object.values(p.contributions).reduce((s, x) => s + x, 0);
      if (contribSum + p.deadMoney !== p.amount) fail(`pote ${i}: contribuições + morto ≠ quantia`);
      for (const [id, amt] of Object.entries(p.contributions)) {
        if (!isNonNegInt(amt) || amt === 0) fail(`pote ${i}: contribuição inválida de ${id}`);
        perPlayer.set(id, (perPlayer.get(id) || 0) + amt);
      }
      const descSum = p.descended.reduce((s, d) => s + d.amount, 0);
      if (descSum > p.amount) fail(`pote ${i}: descidas excedem a quantia`);
      for (const d of p.descended) {
        const ds = Object.values(d.contributions).reduce((s, x) => s + x, 0);
        if (ds !== d.amount) fail(`pote ${i}: descida com contribuições incoerentes`);
      }
      if (i > 0) {
        const prevSet = new Set(pots[i - 1].eligible);
        if (!p.eligible.every(id => prevSet.has(id)) || p.eligible.length >= prevSet.size) {
          fail(`pote ${i}: elegíveis não estão estritamente contidos no pote anterior`);
        }
      }
      sumAmount += p.amount; sumDead += p.deadMoney;
    });
    if (sumAmount !== dead + totalC) fail(`conservação: Σ potes ${sumAmount} ≠ morto ${dead} + Σ c ${totalC}`);
    if (sumDead !== dead) fail('dinheiro morto não conservado');
    for (const e of entries) {
      if ((perPlayer.get(e.id) || 0) !== e.c) fail(`contribuições de ${e.id} somam ${perPlayer.get(e.id) || 0}, esperado ${e.c}`);
    }
    return true;
  }

  return Object.freeze({ PotsError, computeUncalled, buildPots, checkPots });
});
