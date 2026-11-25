/*
 * Poker Academy — betting.js
 * Motor de apostas No-Limit Texas Hold'em (Etapa 2).
 *
 * Contrato (Contexto 09):
 *   createHand(config)            -> estado inicial (antes e blinds postados, cartas distribuídas)
 *   legalActions(state)           -> opções do jogador da vez (ou null se a mão acabou)
 *   applyAction(state, action)    -> NOVO estado; nunca altera o estado recebido; lança EngineError se ilegal
 *   checkInvariants(state)        -> lança EngineError('INVARIANT_VIOLATION') se o estado for inconsistente
 *
 * Fora do escopo desta etapa: side pots, showdown, distribuição de fichas, devolução de aposta não paga.
 * A mão termina com phase = 'handOver' e outcome = { reason: 'allFolded' | 'showdownPending' }.
 *
 * Grandezas de aposta (proposta v3, seção 1):
 *   C  = betting.currentBet     nível a igualar na street
 *   L  = betting.lastFullRaise  incremento do último bet/raise COMPLETO (inicial = BB)
 *   A(p) = C - actedAtBet(p)    aumento acumulado desde a última ação voluntária de p
 *   minRaiseTo = base + L       base = C (ou BB na variante R23 'treatAsFullBlind')
 *
 * Todas as quantias são inteiros (fichas). Valores de bet/raise são sempre "PARA" (total na street).
 *
 * Regras com IDs R1..R24 — ver RULES abaixo e o documento da Etapa 2.
 */
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const deps = isNode
    ? { cards: require('./cards.js'), rng: require('./rng.js'), positions: require('./positions.js') }
    : { cards: root.PA.cards, rng: root.PA.rng, positions: root.PA.positions };
  const api = factory(deps);
  if (isNode) module.exports = api;
  else (root.PA = root.PA || {}).betting = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';
  const { cards, rng, positions } = deps;

  const STREETS = ['preflop', 'flop', 'turn', 'river'];

  /** Parâmetros configuráveis e seus padrões (Contexto 09, seção 3.4). */
  const DEFAULT_RULES = Object.freeze({
    // R4 — BB ante com stack curto. TDA Summit 2024: blind primeiro.
    bbAntePriority: 'blindFirst',          // 'blindFirst' | 'anteFirst'
    // R5 — ante individual de quem posta blind com stack curto. ADOTADA, NÃO VERIFICADA.
    individualAntePriority: 'anteFirst',   // 'anteFirst' | 'blindFirst'
    // R7 — BB curto: os demais completam o BB integral. ADOTADA, NÃO VERIFICADA (TDA não aborda).
    shortBlindCallAmount: 'fullBlind',     // 'fullBlind' | 'posted'
    // R20 — fold quando o check é possível. Permitido no simulador; NÃO PADRÃO segundo a TDA (Regra 60).
    allowFoldWhenCheckAvailable: true,
    // R22 — queima de cartas antes de flop, turn e river (afeta apenas a ordem do baralho/replay).
    burnCards: true,
    // R23 — opening bet all-in abaixo do BB. REGRA PROVISÓRIA, NÃO VERIFICADA (TDA 2026 não define).
    //   'incomplete'       : aposta incompleta; não altera L; próximo raise mínimo para C + L.
    //   'treatAsFullBlind' : idem, mas o próximo raise mínimo é calculado a partir do BB (BB + L).
    incompleteOpeningBet: 'incomplete',
  });

  const RULE_VALUES = {
    bbAntePriority: ['blindFirst', 'anteFirst'],
    individualAntePriority: ['anteFirst', 'blindFirst'],
    shortBlindCallAmount: ['fullBlind', 'posted'],
    allowFoldWhenCheckAvailable: [true, false],
    burnCards: [true, false],
    incompleteOpeningBet: ['incomplete', 'treatAsFullBlind'],
  };

  class EngineError extends Error {
    constructor(code, message, details) {
      super(code + ': ' + message);
      this.name = 'EngineError';
      this.code = code;
      if (details !== undefined) this.details = details;
    }
  }

  const isInt = x => Number.isInteger(x);
  const clone = s => (typeof structuredClone === 'function' ? structuredClone(s) : JSON.parse(JSON.stringify(s)));

  // ------------------------------------------------------------------ config

  function normalizeConfig(config) {
    if (!config || typeof config !== 'object') throw new EngineError('INVALID_CONFIG', 'configuração ausente');
    const ps = config.players;
    if (!Array.isArray(ps) || ps.length < 2 || ps.length > 9) throw new EngineError('INVALID_CONFIG', 'são necessários 2 a 9 jogadores');
    const ids = new Set(), seats = new Set();
    for (const p of ps) {
      if (!p || typeof p.id !== 'string' || !p.id) throw new EngineError('INVALID_CONFIG', 'jogador sem id');
      if (ids.has(p.id)) throw new EngineError('INVALID_CONFIG', 'id duplicado: ' + p.id);
      if (!isInt(p.seat) || seats.has(p.seat)) throw new EngineError('INVALID_CONFIG', 'assento inválido ou duplicado: ' + p.seat);
      if (!isInt(p.stack) || p.stack <= 0) throw new EngineError('INVALID_CONFIG', 'stack deve ser inteiro positivo: ' + p.id);
      ids.add(p.id); seats.add(p.seat);
    }
    const { smallBlind: sb, bigBlind: bb } = config;
    if (!isInt(sb) || !isInt(bb) || sb <= 0 || bb <= 0 || sb > bb) throw new EngineError('INVALID_CONFIG', 'blinds inválidos (inteiros, 0 < SB <= BB)');
    const ante = config.ante === undefined ? 0 : config.ante;
    const anteType = config.anteType === undefined ? (ante > 0 ? 'bbAnte' : 'none') : config.anteType;
    if (!isInt(ante) || ante < 0) throw new EngineError('INVALID_CONFIG', 'ante inválido');
    if (!['none', 'individual', 'bbAnte'].includes(anteType)) throw new EngineError('INVALID_CONFIG', 'anteType inválido');
    if (anteType === 'none' && ante !== 0) throw new EngineError('INVALID_CONFIG', 'ante > 0 exige anteType');
    if (anteType !== 'none' && ante === 0) throw new EngineError('INVALID_CONFIG', 'anteType exige ante > 0');
    const buttonIndex = ps.findIndex(p => p.seat === config.buttonSeat);
    if (buttonIndex < 0) throw new EngineError('INVALID_CONFIG', 'buttonSeat não corresponde a nenhum jogador');
    const rules = Object.assign({}, DEFAULT_RULES, config.rules || {});
    for (const k of Object.keys(rules)) {
      if (!(k in RULE_VALUES)) throw new EngineError('INVALID_CONFIG', 'regra desconhecida: ' + k);
      if (!RULE_VALUES[k].includes(rules[k])) throw new EngineError('INVALID_CONFIG', `valor inválido para ${k}: ${rules[k]}`);
    }
    const deck = config.deck || {};
    let order;
    if (Array.isArray(deck.order)) {
      if (deck.order.length !== 52) throw new EngineError('INVALID_CONFIG', 'deck.order deve ter 52 cartas');
      try { cards.assertDistinct(deck.order); } catch (e) { throw new EngineError('INVALID_CONFIG', 'deck.order inválido: ' + e.message); }
      order = deck.order.slice();
    } else if (deck.seed !== undefined) {
      order = rng.shuffledDeck(rng.createSeededRng(deck.seed));
    } else {
      order = rng.shuffledDeck(rng.createCryptoRng());
    }
    return {
      handId: config.handId || (deck.seed !== undefined ? 'H-seed-' + deck.seed : 'H-' + Date.now()),
      players: ps.map(p => ({ id: p.id, seat: p.seat, stack: p.stack })),
      buttonSeat: config.buttonSeat, buttonIndex,
      smallBlind: sb, bigBlind: bb, ante, anteType, rules,
      deckSource: Array.isArray(deck.order) ? 'order' : (deck.seed !== undefined ? 'seed' : 'crypto'),
      seed: deck.seed,
      deckOrder: order,
    };
  }

  // ------------------------------------------------------------------ helpers sobre o estado

  const contesting = p => p.status !== 'folded';
  const canAct = p => p.status === 'active' && p.stack > 0;

  function othersCanAct(state, i) {
    return state.players.some((q, j) => j !== i && canAct(q));
  }

  /** v3 §3: needsToAct(p) = canAct e (owesCall ou (não agiu e há outro com fichas)). */
  function needsToActIdx(state, i) {
    const p = state.players[i];
    if (!canAct(p)) return false;
    const owesCall = p.streetCommitted < state.betting.currentBet;
    return owesCall || (p.actedAtBet === null && othersCanAct(state, i));
  }

  /** R13: direito de aumentar = ainda não agiu na street, ou A(p) >= L. */
  function mayRaiseIdx(state, i) {
    const p = state.players[i];
    if (p.actedAtBet === null) return true;
    return state.betting.currentBet - p.actedAtBet >= state.betting.lastFullRaise;
  }

  /** Base para o raise mínimo (R11; R23 variante). */
  function raiseBase(state) {
    const b = state.betting;
    if (state.config.rules.incompleteOpeningBet === 'treatAsFullBlind' &&
        !b.fullBetThisStreet && b.currentBet > 0 && b.currentBet < state.config.bigBlind) {
      return state.config.bigBlind;
    }
    return b.currentBet;
  }

  function idxOf(state, id) {
    const i = state.players.findIndex(p => p.id === id);
    if (i < 0) throw new EngineError('UNKNOWN_PLAYER', 'jogador inexistente: ' + id);
    return i;
  }

  function moveChips(p, amount, street) {
    if (!isInt(amount) || amount < 0 || amount > p.stack) throw new EngineError('INTERNAL_ERROR', 'movimento de fichas inválido');
    p.stack -= amount;
    p.streetCommitted += amount;
    p.totalCommitted += amount;
    p.committedByStreet[street] += amount;
    if (p.stack === 0 && p.status === 'active') p.status = 'allin';
  }

  function drawCard(state) {
    if (state.deck.length === 0) throw new EngineError('INTERNAL_ERROR', 'baralho esgotado');
    return state.deck.shift();
  }

  // ------------------------------------------------------------------ createHand

  function createHand(config) {
    const cfg = normalizeConfig(config);
    const n = cfg.players.length;
    const r = positions.roles(n, cfg.buttonIndex);
    const lbl = positions.labels(n, cfg.buttonIndex);

    const state = {
      version: 1,
      id: cfg.handId,
      config: {
        players: cfg.players, buttonSeat: cfg.buttonSeat, smallBlind: cfg.smallBlind, bigBlind: cfg.bigBlind,
        ante: cfg.ante, anteType: cfg.anteType, rules: cfg.rules, deckSource: cfg.deckSource, seed: cfg.seed,
        deckOrder: cfg.deckOrder,
      },
      roles: { button: r.button, sb: r.sb, bb: r.bb, preflopFirst: r.preflopFirst, postflopFirst: r.postflopFirst },
      street: 'preflop',
      board: [],
      burned: [],
      deck: cfg.deckOrder.slice(),
      players: cfg.players.map((p, i) => ({
        id: p.id, seat: p.seat, position: lbl[i], holeCards: [],
        initialStack: p.stack, stack: p.stack,
        streetCommitted: 0, totalCommitted: 0,
        committedByStreet: { preflop: 0, flop: 0, turn: 0, river: 0 },
        antePosted: 0, blindPosted: 0,
        status: 'active', actedAtBet: null,
      })),
      betting: { currentBet: 0, lastFullRaise: cfg.bigBlind, lastAggressorId: null, fullBetThisStreet: false },
      toAct: null,
      phase: 'betting',
      outcome: null,
      log: [],
    };

    // R22 — distribuição: uma carta por vez, começando à esquerda do botão (HU: o botão recebe a última).
    for (let round = 0; round < 2; round++) {
      for (let k = 0; k < n; k++) state.players[positions.offset(r.dealFirst, k, n)].holeCards.push(drawCard(state));
    }
    state.log.push({ type: 'deal', street: 'preflop', holeCards: state.players.map(p => ({ id: p.id, cards: p.holeCards.slice() })) });

    // R3/R4/R5/R6 — antes e blinds.
    const post = (i, kind, amount) => {
      const p = state.players[i];
      const amt = Math.min(amount, p.stack);
      if (amt <= 0) return;
      p.stack -= amt;
      p.totalCommitted += amt;
      if (kind === 'ante') {
        p.antePosted += amt;        // R3: ante é dinheiro morto, não entra em streetCommitted
      } else {
        p.blindPosted += amt;       // blind é aposta viva da street
        p.streetCommitted += amt;
        p.committedByStreet.preflop += amt;
      }
      if (p.stack === 0) p.status = 'allin'; // R6
      state.log.push({ type: 'post', kind, player: p.id, amount: amt, requested: amount, allIn: p.stack === 0 });
    };

    const blindOf = i => (i === r.bb ? cfg.bigBlind : (i === r.sb ? cfg.smallBlind : 0));
    // Ordem de postagem: começa pelo SB (à esquerda do botão; HU, o próprio botão).
    const postOrder = [];
    for (let k = 0; k < n; k++) postOrder.push(positions.offset(r.sb, k, n));
    for (const i of postOrder) {
      const blind = blindOf(i);
      const ante = cfg.anteType === 'individual' ? cfg.ante : (cfg.anteType === 'bbAnte' && i === r.bb ? cfg.ante : 0);
      let anteFirst;
      if (cfg.anteType === 'bbAnte') anteFirst = cfg.rules.bbAntePriority === 'anteFirst';
      else anteFirst = cfg.rules.individualAntePriority === 'anteFirst';
      const items = [];
      if (ante > 0) items.push(['ante', ante]);
      if (blind > 0) { if (anteFirst) items.push(['blind', blind]); else items.unshift(['blind', blind]); }
      for (const [kind, amt] of items) post(i, kind === 'blind' ? (i === r.bb ? 'bigBlind' : 'smallBlind') : 'ante', amt);
    }

    // R7 — aposta a igualar no pré-flop.
    const maxPosted = Math.max(...state.players.map(p => p.streetCommitted));
    state.betting.currentBet = cfg.rules.shortBlindCallAmount === 'fullBlind' ? cfg.bigBlind : maxPosted;
    state.betting.lastFullRaise = cfg.bigBlind;           // TDA 53-B: BB é a aposta de abertura
    state.betting.fullBetThisStreet = true;
    state.betting.lastAggressorId = state.players[r.bb].id;

    findNextOrClose(state, r.preflopFirst, true);
    checkInvariants(state);
    return state;
  }

  // ------------------------------------------------------------------ fluxo da rodada

  /**
   * Procura, a partir de startIdx (inclusive se inclusive=true), o próximo jogador com needsToAct.
   * Se não houver, encerra a rodada (R17) e avança street ou termina a mão.
   */
  function findNextOrClose(state, startIdx, inclusive) {
    const n = state.players.length;
    // R18 — resta um único jogador que não desistiu.
    const alive = state.players.filter(contesting);
    if (alive.length === 1) {
      state.toAct = null;
      state.phase = 'handOver';
      state.outcome = { reason: 'allFolded', remainingId: alive[0].id };
      state.log.push({ type: 'handOver', reason: 'allFolded', remainingId: alive[0].id });
      return;
    }
    for (let k = inclusive ? 0 : 1; k <= n; k++) {
      const i = positions.offset(startIdx, k, n);
      if (needsToActIdx(state, i)) { state.toAct = state.players[i].id; return; }
    }
    closeRound(state);
  }

  function closeRound(state) {
    state.log.push({ type: 'roundClosed', street: state.street });
    const si = STREETS.indexOf(state.street);
    if (si === STREETS.length - 1) {
      state.toAct = null;
      state.phase = 'handOver';
      state.outcome = { reason: 'showdownPending' };
      state.log.push({ type: 'handOver', reason: 'showdownPending' });
      return;
    }
    // R21 — nova street.
    const next = STREETS[si + 1];
    state.street = next;
    for (const p of state.players) { p.streetCommitted = 0; p.actedAtBet = null; }
    state.betting = { currentBet: 0, lastFullRaise: state.config.bigBlind, lastAggressorId: null, fullBetThisStreet: false };
    if (state.config.rules.burnCards) state.burned.push(drawCard(state));
    const count = next === 'flop' ? 3 : 1;
    const dealt = [];
    for (let k = 0; k < count; k++) { const c = drawCard(state); state.board.push(c); dealt.push(c); }
    state.log.push({ type: 'street', street: next, cards: dealt, board: state.board.slice() });
    // R19 — se ninguém precisa agir, a rodada fecha imediatamente (runout).
    findNextOrClose(state, state.roles.postflopFirst, true);
  }

  // ------------------------------------------------------------------ opções (fonte única de verdade)

  /**
   * Calcula TODAS as opções do jogador i. Usado por legalActions E por applyAction (v3 §2).
   */
  function computeOptions(state, i) {
    const p = state.players[i];
    const b = state.betting;
    const C = b.currentBet, L = b.lastFullRaise;
    const owed = Math.max(0, C - p.streetCommitted);
    const toCall = Math.min(owed, p.stack);
    const canCheck = owed === 0;
    const canFold = !canCheck || state.config.rules.allowFoldWhenCheckAvailable;
    const call = owed > 0 ? { amount: toCall, to: p.streetCommitted + toCall, isAllIn: toCall === p.stack } : null;
    const maxTo = p.streetCommitted + p.stack;
    const mayRaise = mayRaiseIdx(state, i);
    const cumulativeIncrease = p.actedAtBet === null ? null : C - p.actedAtBet;
    const base = raiseBase(state);
    const minRaiseTo = base + L;

    let aggressive = null, restriction = null;
    if (maxTo <= C) restriction = 'INSUFFICIENT_CHIPS_TO_RAISE';
    else if (!othersCanAct(state, i)) restriction = 'NO_OPPONENT_CAN_ACT'; // R24
    else if (!mayRaise) restriction = 'NOT_REOPENED';                      // R13
    else {
      const type = C === 0 ? 'bet' : 'raise';                               // R9
      if (maxTo < minRaiseTo) aggressive = { type, min: maxTo, max: maxTo, allInOnly: true, incomplete: true };
      else aggressive = { type, min: minRaiseTo, max: maxTo, allInOnly: false, incomplete: false };
    }

    // 'allin' é apenas um atalho, resolvido para uma ação concreta e sujeito às mesmas restrições.
    let allin = null;
    if (owed > 0 && p.stack <= owed) allin = { resolvesTo: 'call', to: maxTo };
    else if (aggressive) allin = { resolvesTo: aggressive.type, to: maxTo };

    return {
      playerId: p.id, street: state.street,
      currentBet: C, lastFullRaise: L, minRaiseTo, maxTo, toCall, cumulativeIncrease, mayRaise,
      restriction,
      actions: {
        fold: canFold, check: canCheck, call,
        bet: aggressive && aggressive.type === 'bet' ? aggressive : null,
        raise: aggressive && aggressive.type === 'raise' ? aggressive : null,
        allin,
      },
    };
  }

  function legalActions(state) {
    if (state.phase === 'handOver' || state.toAct === null) return null;
    return computeOptions(state, idxOf(state, state.toAct));
  }

  // ------------------------------------------------------------------ applyAction

  function applyAction(state, action) {
    if (!state || state.phase === 'handOver') throw new EngineError('HAND_OVER', 'a mão já terminou');
    if (!action || typeof action.type !== 'string') throw new EngineError('INVALID_ACTION', 'ação sem tipo');
    if (action.playerId !== undefined && action.playerId !== state.toAct) {
      throw new EngineError('NOT_YOUR_TURN', `vez de ${state.toAct}, não de ${action.playerId}`);
    }
    const i0 = idxOf(state, state.toAct);
    const opts = computeOptions(state, i0);
    const A = opts.actions;

    // Resolve 'allin' para o tipo concreto e valida pelo mesmo caminho das demais ações.
    let type = action.type, to = action.to;
    if (type === 'allin') {
      if (!A.allin) {
        throw new EngineError(opts.restriction || 'ILLEGAL_ACTION', 'all-in indisponível para ' + opts.playerId, { restriction: opts.restriction });
      }
      type = A.allin.resolvesTo;
      to = type === 'call' ? undefined : A.allin.to;
    }

    switch (type) {
      case 'fold':
        if (!A.fold) throw new EngineError('FOLD_NOT_ALLOWED', 'fold com check disponível está desativado (R20)');
        break;
      case 'check':
        if (!A.check) throw new EngineError('CHECK_FACING_BET', 'há aposta a pagar');
        break;
      case 'call':
        if (!A.call) throw new EngineError('NOTHING_TO_CALL', 'não há aposta a pagar');
        break;
      case 'bet':
      case 'raise': {
        if (type === 'bet' && opts.currentBet > 0) throw new EngineError('BET_WHEN_FACING', 'já existe aposta; use raise');
        if (type === 'raise' && opts.currentBet === 0) throw new EngineError('RAISE_WITHOUT_BET', 'não há aposta; use bet');
        const opt = A[type];
        if (!opt) throw new EngineError(opts.restriction || 'ILLEGAL_ACTION', type + ' indisponível', { restriction: opts.restriction });
        if (!isInt(to)) throw new EngineError('NOT_INTEGER', 'valor deve ser inteiro (total "para")');
        if (to > opt.max) throw new EngineError('ABOVE_STACK', `máximo ${opt.max}`);
        if (to < opt.min) throw new EngineError('BELOW_MINIMUM', `mínimo ${opt.min}`);
        break;
      }
      default:
        throw new EngineError('INVALID_ACTION', 'tipo desconhecido: ' + action.type);
    }

    // ---- execução sobre uma cópia
    const s = clone(state);
    const p = s.players[i0];
    const b = s.betting;
    const C = b.currentBet;
    const ev = { type: 'action', street: s.street, player: p.id, action: type, requested: action.type };

    if (type === 'fold') {
      p.status = 'folded';
      p.actedAtBet = C;
    } else if (type === 'check') {
      p.actedAtBet = C;
    } else if (type === 'call') {
      const amt = opts.toCall;
      moveChips(p, amt, s.street);
      p.actedAtBet = C;
      ev.amount = amt; ev.to = p.streetCommitted;
    } else {
      // bet / raise para `to`
      const amt = to - p.streetCommitted;
      const base = raiseBase(s);
      const increment = to - base;
      moveChips(p, amt, s.street);
      const full = increment >= b.lastFullRaise;     // R10/R11 (opening: base 0, L = BB)
      if (full) {
        b.lastFullRaise = increment;                 // opening completo define L (v3 §1)
        b.fullBetThisStreet = true;
      } else if (p.status !== 'allin') {
        throw new EngineError('INTERNAL_ERROR', 'aumento incompleto sem all-in');
      }                                              // R12/R23: incompleto não altera L
      b.currentBet = to;
      b.lastAggressorId = p.id;
      p.actedAtBet = to;
      ev.amount = amt; ev.to = to; ev.full = full;
    }
    ev.allIn = p.status === 'allin';
    ev.currentBet = b.currentBet; ev.lastFullRaise = b.lastFullRaise;
    s.log.push(ev);

    findNextOrClose(s, i0, false);
    checkInvariants(s);
    return s;
  }

  // ------------------------------------------------------------------ invariantes

  function getPot(state) {
    return state.players.reduce((sum, p) => sum + p.totalCommitted, 0);
  }

  function fail(msg) { throw new EngineError('INVARIANT_VIOLATION', msg); }

  function checkInvariants(state) {
    const b = state.betting;
    let sumStacks = 0, sumInitial = 0;
    for (const p of state.players) {
      for (const k of ['stack', 'streetCommitted', 'totalCommitted', 'antePosted', 'blindPosted', 'initialStack']) {
        if (!isInt(p[k]) || p[k] < 0) fail(`${p.id}.${k} não é inteiro >= 0`);
      }
      // (1) conservação por jogador
      if (p.stack + p.totalCommitted !== p.initialStack) fail(`conservação violada para ${p.id}`);
      // (3) coerência: total = ante + soma das streets; street atual = streetCommitted
      const byStreet = STREETS.reduce((s, st) => s + p.committedByStreet[st], 0);
      if (p.totalCommitted !== p.antePosted + byStreet) fail(`totalCommitted incoerente para ${p.id}`);
      if (p.committedByStreet[state.street] !== p.streetCommitted) fail(`streetCommitted incoerente para ${p.id}`);
      if (p.streetCommitted > b.currentBet) fail(`${p.id} apostou acima da aposta atual`);
      if (p.status === 'allin' && p.stack !== 0) fail(`${p.id} all-in com fichas`);
      if (p.status === 'active' && p.stack === 0) fail(`${p.id} ativo sem fichas`);
      if (!['active', 'folded', 'allin'].includes(p.status)) fail(`status inválido de ${p.id}`);
      sumStacks += p.stack; sumInitial += p.initialStack;
    }
    // (2) conservação da mesa
    if (sumStacks + getPot(state) !== sumInitial) fail('conservação da mesa violada');
    if (!isInt(b.currentBet) || b.currentBet < 0) fail('currentBet inválido');
    if (!isInt(b.lastFullRaise) || b.lastFullRaise < state.config.bigBlind) fail('lastFullRaise menor que o BB');
    // cartas: todas distintas e exatamente 52
    const all = [].concat(...state.players.map(p => p.holeCards), state.board, state.burned, state.deck);
    if (all.length !== 52 || new Set(all).size !== 52) fail('cartas duplicadas ou faltando');
    const expectedBoard = { preflop: 0, flop: 3, turn: 4, river: 5 }[state.street];
    if (state.board.length !== expectedBoard) fail('board incompatível com a street');
    // vez de agir
    if (state.phase === 'handOver') {
      if (state.toAct !== null) fail('mão encerrada com jogador na vez');
    } else {
      if (state.toAct === null) fail('mão em andamento sem jogador na vez');
      if (!needsToActIdx(state, idxOf(state, state.toAct))) fail('jogador na vez não tem ação pendente');
    }
    return true;
  }

  // ------------------------------------------------------------------ API pública

  function needsToAct(state, id) { return needsToActIdx(state, idxOf(state, id)); }
  function mayRaise(state, id) { return mayRaiseIdx(state, idxOf(state, id)); }
  function optionsFor(state, id) { return computeOptions(state, idxOf(state, id)); }

  return Object.freeze({
    STREETS, DEFAULT_RULES, EngineError,
    createHand, legalActions, applyAction, checkInvariants,
    getPot, needsToAct, mayRaise, optionsFor,
  });
});
