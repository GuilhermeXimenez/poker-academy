/*
 * Poker Academy — settlement.js  (Etapa 3, módulo 3)
 * Liquidação de uma mão encerrada: devolução, potes, showdown e distribuição das fichas.
 *
 * Integra os módulos congelados sem alterá-los:
 *   betting.checkInvariants / getPot   (estado final da Etapa 2)
 *   pots.computeUncalled / buildPots    (devolução e potes)
 *   showdown.evaluateHands / winnersAmong (avaliação e vencedores)
 *
 * API:
 *   settleHand(state, options?)                         -> SettlementResult
 *   distributePots({ pots, evaluated, playerOrder, buttonIndex, oddChipRule })
 *   checkSettlementInvariants(state, result)            -> true | SettlementError
 *
 * Regras (contrato aprovado):
 *   - BB ante: 'deadToMainPot' (padrão, convenção D) ou 'asContribution' (C).          [D1/A1]
 *   - Ficha ímpar: TDA 2026 Regra 21-A — primeiro ASSENTO à esquerda do botão.         [D2]
 *     Várias fichas ímpares: uma por vencedor nessa ordem — CONVENÇÃO DO SIMULADOR.     [D8]
 *     Unidade = 1 ficha.                                                                 [D3]
 *   - Ordem dos assentos = ordem do array state.players; botão = state.roles.button.    [D4/D9]
 *   - Cada side pot é dividido separadamente (TDA 23).
 *   - hands = avaliação de todos os vivos (somente com showdown).                        [D5]
 *   - eliminated = jogadores com finalStack = 0 (sem colocação).                         [D6]
 *   - Erros de pots/showdown encapsulados com o mesmo code e details.source.            [D7]
 *   - antePosted validado por tipo de ante e contra o log de postagens.                  [D10]
 *
 * O estado de entrada nunca é alterado. Fichas são inteiros; net é inteiro com sinal.
 */
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const deps = isNode
    ? { betting: require('./betting.js'), pots: require('./pots.js'), showdown: require('./showdown.js') }
    : { betting: root.PA.betting, pots: root.PA.pots, showdown: root.PA.showdown };
  const api = factory(deps);
  if (isNode) module.exports = api;
  else (root.PA = root.PA || {}).settlement = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';
  const B = deps.betting, P = deps.pots, S = deps.showdown;

  const OPTION_VALUES = Object.freeze({
    bbAnteHandling: ['deadToMainPot', 'asContribution'],
    oddChipRule: ['leftOfButton'],
  });
  const DEFAULT_OPTIONS = Object.freeze({ bbAnteHandling: 'deadToMainPot', oddChipRule: 'leftOfButton' });
  const ANTE_TYPES = ['none', 'individual', 'bbAnte'];

  class SettlementError extends Error {
    constructor(code, message, details) {
      super(code + ': ' + message);
      this.name = 'SettlementError';
      this.code = code;
      if (details !== undefined) this.details = details;
    }
  }

  const isNonNegInt = x => Number.isInteger(x) && x >= 0;
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  // Mapas indexados por id: ids são strings arbitrárias não vazias (contrato do betting.js), inclusive
  // 'constructor', 'toString' e '__proto__'. Mapas internos são Map; objetos de saída continuam objetos
  // comuns, escritos sempre como propriedade própria (defineProperty) e lidos ignorando herdadas.
  const setOwn = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
  const getOwn = (o, k) => (hasOwn(o, k) ? o[k] : undefined);
  const invalid = (cause, extra) => new SettlementError('INVALID_STATE', cause, Object.assign({ cause }, extra || {}));

  /** D7: executa uma função de pots/showdown e encapsula seus erros preservando o code. */
  function callModule(source, fn, extraDetails) {
    try {
      return fn();
    } catch (e) {
      if (e && (e.name === 'PotsError' || e.name === 'ShowdownError')) {
        throw new SettlementError(e.code, e.message, Object.assign({ source, cause: e.message }, extraDetails || {}));
      }
      throw e;
    }
  }

  // ------------------------------------------------------------------ opções

  function normalizeOptions(options) {
    if (options === undefined) return Object.assign({}, DEFAULT_OPTIONS);
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new SettlementError('INVALID_OPTIONS', 'options deve ser um objeto');
    }
    const out = Object.assign({}, DEFAULT_OPTIONS);
    for (const [k, v] of Object.entries(options)) {
      if (!hasOwn(OPTION_VALUES, k)) throw new SettlementError('INVALID_OPTIONS', 'opção desconhecida: ' + k);
      if (!OPTION_VALUES[k].includes(v)) throw new SettlementError('INVALID_OPTIONS', `valor inválido para ${k}: ${String(v)}`);
      out[k] = v;
    }
    return out;
  }

  // ------------------------------------------------------------------ validação do estado (seção 6.4)

  function validateState(state) {
    // E1
    if (!state || typeof state !== 'object' || !Array.isArray(state.players) || state.players.length === 0) {
      throw invalid('E1: estado ausente ou sem jogadores');
    }
    // E2
    if (state.phase !== 'handOver') {
      throw new SettlementError('SETTLEMENT_NOT_READY', `a mão não terminou (phase = ${String(state.phase)})`);
    }
    // E3
    try {
      B.checkInvariants(state);
    } catch (e) {
      throw invalid('E3: invariantes da Etapa 2 violados', { original: { name: e && e.name, code: e && e.code, message: e && e.message } });
    }
    const players = state.players;
    const n = players.length;
    // E12
    const anteType = state.config && state.config.anteType;
    if (!ANTE_TYPES.includes(anteType)) throw invalid('E12: anteType desconhecido: ' + String(anteType));
    // E14
    const b = state.roles && state.roles.button;
    if (!Number.isInteger(b) || b < 0 || b >= n) throw invalid('E14: roles.button fora de 0..n-1: ' + String(b));
    // E4
    const outcome = state.outcome;
    if (!outcome || typeof outcome !== 'object' || !['allFolded', 'showdownPending'].includes(outcome.reason)) {
      throw invalid('E4: outcome ausente ou com reason desconhecida');
    }
    const live = players.filter(p => p.status !== 'folded');
    if (outcome.reason === 'allFolded') {
      if (live.length !== 1) throw invalid(`E5: allFolded com ${live.length} jogadores vivos`);
      if (outcome.remainingId !== live[0].id) throw invalid('E6: remainingId ausente, inexistente ou diferente do único vivo');
    } else {
      if (live.length < 2) throw invalid(`E7: showdownPending com ${live.length} jogador(es) vivo(s)`);
      if (state.street !== 'river') throw invalid('E8: showdownPending fora do river (street = ' + String(state.street) + ')');
      if (!Array.isArray(state.board) || state.board.length !== 5) throw invalid('E9: showdownPending sem board de 5 cartas');
      if (Object.prototype.hasOwnProperty.call(outcome, 'remainingId')) throw invalid('E10: showdownPending com remainingId');
    }
    // E11
    for (const p of live) {
      if (!Array.isArray(p.holeCards) || p.holeCards.length !== 2) throw invalid(`E11: ${p.id} vivo sem exatamente 2 cartas`);
    }
    // E13 (D10)
    validateAntes(state, anteType);
  }

  function validateAntes(state, anteType) {
    const ante = state.config.ante;
    if (!Array.isArray(state.log)) throw invalid('E13: log de postagens ausente');
    const logged = new Map();
    for (const e of state.log) {
      if (e && e.type === 'post' && e.kind === 'ante') logged.set(e.player, (logged.get(e.player) || 0) + e.amount);
    }
    state.players.forEach((p, i) => {
      const a = p.antePosted;
      if (!isNonNegInt(a)) throw invalid(`E13: antePosted inválido para ${p.id}`);
      if (anteType === 'none' && a !== 0) throw invalid(`E13: ${p.id} com ante pago sem ante configurado`);
      if (anteType !== 'none' && a > ante) throw invalid(`E13: ${p.id} pagou ante acima do configurado`);
      if (anteType === 'bbAnte' && i !== state.roles.bb && a !== 0) throw invalid(`E13: BB ante pago por ${p.id}, que não é o BB`);
      if ((logged.get(p.id) || 0) !== a) throw invalid(`E13: antePosted de ${p.id} difere do log de postagens`);
    });
    for (const id of logged.keys()) {
      if (!state.players.some(p => p.id === id)) throw invalid('E13: log com ante de jogador inexistente: ' + id);
    }
  }

  // ------------------------------------------------------------------ mapeamento (seção 3.1, passo 2)

  function buildEntries(state, opts) {
    const deadIsAnte = state.config.anteType === 'bbAnte' && opts.bbAnteHandling === 'deadToMainPot';
    return state.players.map(p => {
      const committed = p.totalCommitted;
      const dead = deadIsAnte ? p.antePosted : 0;
      return { id: p.id, committed, dead, c: committed - dead, live: p.status !== 'folded' };
    });
  }

  // ------------------------------------------------------------------ fichas ímpares (seção 4)

  /** key(i) = (i − (b + 1) + n) mod n: 0 = primeiro assento à esquerda do botão; n − 1 = o botão. */
  function seatKeyFn(playerOrder, buttonIndex) {
    const n = playerOrder.length;
    const idx = new Map(playerOrder.map((id, i) => [id, i]));
    return id => ((idx.get(id) - (buttonIndex + 1)) % n + n) % n;
  }

  // ------------------------------------------------------------------ distributePots (seção 3.2)

  function distributePots(input) {
    if (!input || typeof input !== 'object') throw new SettlementError('INVALID_INPUT', 'entrada ausente');
    const { pots, evaluated, playerOrder, buttonIndex } = input;
    const oddChipRule = input.oddChipRule === undefined ? DEFAULT_OPTIONS.oddChipRule : input.oddChipRule;
    if (!OPTION_VALUES.oddChipRule.includes(oddChipRule)) throw new SettlementError('INVALID_OPTIONS', 'oddChipRule inválida: ' + String(oddChipRule));
    if (!Array.isArray(playerOrder) || playerOrder.length === 0) throw new SettlementError('INVALID_INPUT', 'playerOrder deve ser um array não vazio');
    if (new Set(playerOrder).size !== playerOrder.length || playerOrder.some(id => typeof id !== 'string' || !id)) {
      throw new SettlementError('INVALID_INPUT', 'playerOrder com ids inválidos ou duplicados');
    }
    if (!Number.isInteger(buttonIndex) || buttonIndex < 0 || buttonIndex >= playerOrder.length) {
      throw new SettlementError('INVALID_INPUT', 'buttonIndex fora do intervalo');
    }
    if (!Array.isArray(pots) || pots.length === 0) throw new SettlementError('INVALID_INPUT', 'pots deve ser um array não vazio');
    if (evaluated !== null && evaluated !== undefined && !Array.isArray(evaluated)) {
      throw new SettlementError('INVALID_INPUT', 'evaluated deve ser um array ou null');
    }
    const known = new Set(playerOrder);
    const key = seatKeyFn(playerOrder, buttonIndex);

    return pots.map(pot => {
      if (!pot || !isNonNegInt(pot.amount) || pot.amount === 0) throw new SettlementError('INVALID_INPUT', 'pote com quantia inválida');
      if (!Array.isArray(pot.eligible) || pot.eligible.length === 0) throw new SettlementError('INVALID_INPUT', 'pote sem elegíveis');
      for (const id of pot.eligible) if (!known.has(id)) throw new SettlementError('INVALID_INPUT', 'elegível fora de playerOrder: ' + String(id));

      let winners, resolvedBy, winningScore = null, winningDescription = null;
      if (pot.eligible.length === 1) {
        winners = [pot.eligible[0]];
        resolvedBy = 'uncontested';
      } else {
        if (!evaluated) throw new SettlementError('MISSING_EVALUATION', `pote ${pot.index} disputado sem avaliação de mãos`);
        winners = callModule('showdown', () => S.winnersAmong(evaluated, pot.eligible));
        resolvedBy = 'showdown';
        const w = evaluated.find(e => e.id === winners[0]);
        winningScore = w.score;
        winningDescription = w.description === undefined ? null : w.description;
      }
      const k = winners.length;
      const baseShare = Math.floor(pot.amount / k);
      const r = pot.amount - baseShare * k;
      const oddChipOrder = winners.slice().sort((a, b) => key(a) - key(b));
      const oddRecipients = oddChipOrder.slice(0, r);
      const shares = {};
      for (const id of winners) setOwn(shares, id, baseShare + (oddRecipients.includes(id) ? 1 : 0));
      return Object.assign(clonePot(pot), {
        resolvedBy, winners, winningScore, winningDescription,
        baseShare, oddChipOrder,
        oddChips: oddRecipients.map(id => ({ playerId: id, chips: 1 })),
        shares,
      });
    });
  }

  function clonePot(p) { return JSON.parse(JSON.stringify(p)); }

  // ------------------------------------------------------------------ settleHand (seção 3.1)

  function settleHand(state, options) {
    const opts = normalizeOptions(options);
    validateState(state);

    const entries = buildEntries(state, opts);
    const dead = entries.reduce((s, e) => s + e.dead, 0);

    const u = callModule('pots', () => P.computeUncalled(entries.map(e => ({ id: e.id, c: e.c, live: e.live }))));
    const cAfter = new Map(u.adjusted.map(a => [a.id, a.c]));          // adjusted não traz live: reassociar pelo id
    const uncalled = u.returns.map(r => ({ playerId: r.id, amount: r.amount }));

    const built = callModule('pots',
      () => P.buildPots({ entries: entries.map(e => ({ id: e.id, c: cAfter.get(e.id), live: e.live })), dead }),
      { entries: entries.map(e => Object.assign({}, e)), dead, bbAnteHandling: opts.bbAnteHandling, uncalled: uncalled.slice() });

    const reason = state.outcome.reason === 'allFolded' ? 'allFolded' : 'showdown';
    let hands = null;
    if (reason === 'showdown') {
      const live = state.players.filter(p => p.status !== 'folded');
      hands = callModule('showdown', () => S.evaluateHands({
        board: state.board.slice(),
        hands: live.map(p => ({ id: p.id, holeCards: p.holeCards.slice() })),
      }));
    }

    const playerOrder = state.players.map(p => p.id);
    const pots = distributePots({
      pots: built.pots, evaluated: hands, playerOrder, buttonIndex: state.roles.button, oddChipRule: opts.oddChipRule,
    });

    const uncalledOf = new Map();
    for (const x of uncalled) uncalledOf.set(x.playerId, (uncalledOf.get(x.playerId) || 0) + x.amount);
    const payouts = {}, finalStacks = {}, net = {};
    for (const id of playerOrder) setOwn(payouts, id, 0);
    for (const pot of pots) for (const [id, amt] of Object.entries(pot.shares)) setOwn(payouts, id, getOwn(payouts, id) + amt);
    for (const p of state.players) {
      setOwn(finalStacks, p.id, p.stack + (uncalledOf.get(p.id) || 0) + getOwn(payouts, p.id));
      setOwn(net, p.id, getOwn(finalStacks, p.id) - p.initialStack);
    }
    const eliminated = state.players.filter(p => getOwn(finalStacks, p.id) === 0).map(p => ({ playerId: p.id, initialStack: p.initialStack }));

    const result = {
      handId: state.id, version: 1, reason,
      rulesUsed: { bbAnteHandling: opts.bbAnteHandling, oddChipRule: opts.oddChipRule },
      inputs: { entries: entries.map(e => Object.assign({}, e, { cAfterUncalled: cAfter.get(e.id) })), dead },
      uncalled,
      pots,
      hands,
      payouts, finalStacks, net,
      eliminated,
      notes: [...u.notes, ...built.notes],
    };
    checkSettlementInvariants(state, result);
    return result;
  }

  // ------------------------------------------------------------------ checkSettlementInvariants (seção 6.1)

  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
  }

  const BUILD_FIELDS = ['index', 'kind', 'from', 'to', 'amount', 'contributions', 'deadMoney', 'eligible', 'descended'];

  function checkSettlementInvariants(state, result) {
    const fail = (msg, cause) => { throw new SettlementError('SETTLEMENT_INVARIANT_VIOLATION', msg, cause ? { cause } : undefined); };
    const sameIdSet = (obj, ids) => obj && typeof obj === 'object' && !Array.isArray(obj) &&
      Object.keys(obj).length === ids.length && ids.every(id => Object.prototype.hasOwnProperty.call(obj, id));
    try {
      validateState(state);
    } catch (e) {
      fail('estado de entrada inválido para verificação', e.message);
    }
    if (!result || typeof result !== 'object') fail('resultado ausente');
    let opts;
    try { opts = normalizeOptions(result.rulesUsed); } catch (e) { fail('rulesUsed inválido', e.message); }
    const ids = state.players.map(p => p.id);
    const byId = new Map(state.players.map(p => [p.id, p]));
    const liveIds = state.players.filter(p => p.status !== 'folded').map(p => p.id);

    // (a) preservação dos dados de origem — recalculados a partir do estado
    const entries = buildEntries(state, opts);
    const dead = entries.reduce((s, e) => s + e.dead, 0);
    let u, built, hands;
    try {
      u = P.computeUncalled(entries.map(e => ({ id: e.id, c: e.c, live: e.live })));
      const cAfter = new Map(u.adjusted.map(a => [a.id, a.c]));
      if (!result.inputs || !deepEqual(result.inputs.entries, entries.map(e => Object.assign({}, e, { cAfterUncalled: cAfter.get(e.id) }))) ||
          result.inputs.dead !== dead) fail('inputs difere do mapeamento recalculado');
      built = P.buildPots({ entries: entries.map(e => ({ id: e.id, c: cAfter.get(e.id), live: e.live })), dead });
      if (state.outcome.reason === 'showdownPending') {
        hands = S.evaluateHands({ board: state.board, hands: state.players.filter(p => p.status !== 'folded').map(p => ({ id: p.id, holeCards: p.holeCards })) });
      } else hands = null;
    } catch (e) {
      if (e instanceof SettlementError) throw e;
      fail('falha ao recalcular dados de origem', e.message);
    }
    if (!deepEqual(result.uncalled, u.returns.map(r => ({ playerId: r.id, amount: r.amount })))) fail('uncalled difere do recalculado');
    if (!deepEqual(result.notes, [...u.notes, ...built.notes])) fail('notes difere do recalculado');
    const expectedReason = state.outcome.reason === 'allFolded' ? 'allFolded' : 'showdown';
    if (result.reason !== expectedReason) fail('reason incoerente com outcome');
    if (!deepEqual(result.hands, hands)) fail('hands difere da avaliação recalculada');
    if (!Array.isArray(result.pots) || result.pots.length !== built.pots.length) fail('número de potes difere de buildPots');

    // (b) distribuição por pote
    const key = seatKeyFn(ids, state.roles.button);
    const sharesSum = new Map();
    for (const id of ids) sharesSum.set(id, 0);
    result.pots.forEach((pot, i) => {
      const orig = built.pots[i];
      for (const f of BUILD_FIELDS) if (!deepEqual(pot[f], orig[f])) fail(`pote ${i}: campo ${f} difere de buildPots`);
      if (pot.index !== i) fail(`pote ${i}: índice fora de sequência`);
      const w = pot.winners;
      if (!Array.isArray(w) || w.length === 0 || new Set(w).size !== w.length) fail(`pote ${i}: winners inválido`);
      if (!w.every(id => pot.eligible.includes(id))) fail(`pote ${i}: vencedor fora dos elegíveis`);
      if (pot.eligible.length === 1) {
        if (pot.resolvedBy !== 'uncontested' || w.length !== 1 || w[0] !== pot.eligible[0]) fail(`pote ${i}: uncontested incoerente`);
        if (pot.winningScore !== null || pot.winningDescription !== null) fail(`pote ${i}: uncontested com score`);
      } else {
        if (pot.resolvedBy !== 'showdown' || !hands) fail(`pote ${i}: pote disputado sem showdown`);
        if (!deepEqual(w, S.winnersAmong(hands, pot.eligible))) fail(`pote ${i}: vencedores diferem de winnersAmong`);
        const h = hands.find(x => x.id === w[0]);
        if (pot.winningScore !== h.score || pot.winningDescription !== h.description) fail(`pote ${i}: score vencedor incoerente`);
      }
      const k = w.length;
      const base = Math.floor(pot.amount / k);
      const r = pot.amount - base * k;
      if (pot.baseShare !== base) fail(`pote ${i}: baseShare incorreto`);
      const order = w.slice().sort((a, b) => key(a) - key(b));
      if (!deepEqual(pot.oddChipOrder, order)) fail(`pote ${i}: oddChipOrder incorreto`);
      if (!deepEqual(pot.oddChips, order.slice(0, r).map(id => ({ playerId: id, chips: 1 })))) fail(`pote ${i}: oddChips incorreto`);
      if (!sameIdSet(pot.shares, w)) fail(`pote ${i}: shares deve conter exatamente os vencedores`);
      const oddSet = new Set(order.slice(0, r));
      let sum = 0;
      for (const id of w) {
        const s = getOwn(pot.shares, id);
        if (!isNonNegInt(s)) fail(`pote ${i}: share de ${id} não é inteiro >= 0`);
        if (s !== base + (oddSet.has(id) ? 1 : 0)) fail(`pote ${i}: share de ${id} difere de baseShare/oddChips`);
        sum += s; sharesSum.set(id, sharesSum.get(id) + s);
      }
      if (sum !== pot.amount) fail(`pote ${i}: Σ shares ≠ quantia`);
      if (state.outcome.reason === 'allFolded' && !deepEqual(pot.eligible, [state.outcome.remainingId])) fail(`pote ${i}: allFolded com elegível diferente do remanescente`);
    });

    // (c) agregação, tipos e consistência por jogador
    for (const name of ['payouts', 'finalStacks', 'net']) if (!sameIdSet(result[name], ids)) fail(`${name} deve conter exatamente os ids do estado`);
    const uncalledOf = new Map();
    for (const x of result.uncalled) {
      if (!isNonNegInt(x.amount) || x.amount === 0) fail('devolução com quantia inválida');
      if (!liveIds.includes(x.playerId)) fail('devolução para jogador que desistiu');
      uncalledOf.set(x.playerId, (uncalledOf.get(x.playerId) || 0) + x.amount);
    }
    let sumFinal = 0, sumInitial = 0, sumPots = 0, sumUncalled = 0;
    for (const pot of result.pots) sumPots += pot.amount;
    for (const x of result.uncalled) sumUncalled += x.amount;
    for (const id of ids) {
      const p = byId.get(id);
      const pay = getOwn(result.payouts, id), fin = getOwn(result.finalStacks, id), nt = getOwn(result.net, id);
      if (!isNonNegInt(pay)) fail(`payout de ${id} não é inteiro >= 0`);
      if (!isNonNegInt(fin)) fail(`finalStack de ${id} não é inteiro >= 0`);
      if (!Number.isInteger(nt)) fail(`net de ${id} não é inteiro`);
      if (pay !== sharesSum.get(id)) fail(`payout de ${id} ≠ Σ shares`);
      const unc = uncalledOf.get(id) || 0;
      const entry = entries.find(e => e.id === id);
      if (unc > entry.c) fail(`devolução de ${id} excede sua contribuição`);
      if (fin !== p.stack + unc + pay) fail(`finalStack de ${id} ≠ stack + devolução + payout`);
      if (nt !== fin - p.initialStack) fail(`net de ${id} ≠ finalStack − initialStack`);
      if (p.status === 'folded' && (pay !== 0 || unc !== 0)) fail(`${id} desistiu e recebeu fichas`);
      const reachable = result.pots.filter(pt => pt.eligible.includes(id)).reduce((s, pt) => s + pt.amount, 0);
      if (pay > reachable) fail(`payout de ${id} excede os potes em que é elegível`);
      sumFinal += fin; sumInitial += p.initialStack;
    }
    for (const pot of result.pots) for (const id of pot.eligible) if (!liveIds.includes(id)) fail('desistente elegível a um pote');
    if (sumPots + sumUncalled !== B.getPot(state)) fail('Σ potes + Σ devoluções ≠ pote do estado');
    if (sumFinal !== sumInitial) fail('Σ finalStacks ≠ Σ initialStack');

    // (d) estrutura
    if (hands !== null && !deepEqual(hands.map(h => h.id).slice().sort(), liveIds.slice().sort())) fail('hands não cobre exatamente os vivos');
    const expectedElim = state.players.filter(p => getOwn(result.finalStacks, p.id) === 0).map(p => ({ playerId: p.id, initialStack: p.initialStack }));
    if (!deepEqual(result.eliminated, expectedElim)) fail('eliminated incoerente com finalStacks');
    if (result.handId !== state.id || result.version !== 1) fail('handId ou version incoerente');
    return true;
  }

  return Object.freeze({
    SettlementError, DEFAULT_OPTIONS,
    settleHand, distributePots, checkSettlementInvariants,
  });
});
