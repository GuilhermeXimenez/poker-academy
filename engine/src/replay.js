/*
 * Poker Academy — replay.js  (Etapa 4, subetapa 4.2)
 * Replay, verificação, stepper e localização de divergências de registros de mão.
 * Especificação: Etapa 4.0 v1.3 (seções 5, 6.3, 7 e 17 — esclarecimentos Q1–Q8).
 *
 * API:
 *   ReplayError
 *   replayRecord(record, { upTo })  -> { states, finalState, settlement, normalizations }
 *   verifyRecord(record)            -> { ok, engineMatch, engineDiffs, normalizations, divergence, steps }
 *   createStepper(record)           -> { length, stateAt(k), checkpointAt(k) }
 *   findDivergence(a, b)            -> null | { path, a, b }
 *   checkpointOf(state)             -> reexportado de record.js (mesma função)
 *
 * Regras:
 *   - Registro estruturalmente inválido: RecordError de validateRecord (Q1).
 *   - ReplayError: INVALID_ARGUMENT, DECK_PROVENANCE_MISMATCH, ILLEGAL_RECORDED_ACTION (Q1).
 *   - Origem: 'seed' -> createHand pela semente e conferência da ordem; 'order' -> pela ordem;
 *     'crypto' -> pela ordem + N1 (config.deckSource 'order' -> 'crypto'), relatada (5.1, 5.2, Q2).
 *   - Comparações pela forma canônica (N0); nenhum outro campo é ignorado ou ajustado.
 *   - Estados devolvidos são cópias em forma normal; o registro nunca é alterado.
 *
 * Nenhum módulo congelado nem arquivo da 4.1 é alterado. Sem APIs exclusivas do Node.
 */
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const deps = isNode
    ? { betting: require('./betting.js'), settlement: require('./settlement.js'), record: require('./record.js'), engineVersion: require('./engineVersion.js') }
    : { betting: root.PA.betting, settlement: root.PA.settlement, record: root.PA.record, engineVersion: root.PA.engineVersion };
  const api = factory(deps);
  if (isNode) module.exports = api;
  else (root.PA = root.PA || {}).replay = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';
  const B = deps.betting, ST = deps.settlement, RC = deps.record, EV = deps.engineVersion;

  class ReplayError extends Error {
    constructor(code, message, details) {
      super(code + ': ' + message);
      this.name = 'ReplayError';
      this.code = code;
      if (details !== undefined) this.details = details;
    }
  }

  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isSafeInt = x => Number.isSafeInteger(x) && !Object.is(x, -0);
  const isPlainObject = v => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
  };
  const normalForm = v => JSON.parse(RC.canonicalize(v));
  const join = (path, k) => (path ? path + '.' + k : String(k));
  const at = (path, i) => path + '[' + i + ']';

  /*
   * Teste independente de legalidade (Q8): CÓPIA LITERAL da função `listed` de record.js, que não é
   * exportada e não pode ser alterada. O teste [Q8] de test/replay.test.js exige que os dois textos
   * sejam idênticos e confere a equivalência por comportamento.
   */
  function listed(la, a) {
    const A = la.actions;
    switch (a.type) {
      case 'fold': return A.fold === true;
      case 'check': return A.check === true;
      case 'call': return A.call !== null;
      case 'allin': return A.allin !== null;
      case 'bet': case 'raise': {
        const o = A[a.type];
        return !!o && isSafeInt(a.to) && a.to >= o.min && a.to <= o.max;
      }
      default: return false;
    }
  }

  // ------------------------------------------------------------------ divergências (forma canônica)

  function walk(a, b, path) {
    const kind = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
    if (kind(a) !== kind(b)) return { path, a, b };
    if (kind(a) === 'array') {
      const n = Math.max(a.length, b.length);
      for (let i = 0; i < n; i++) {
        if (i >= a.length || i >= b.length) return { path: at(path, i), a: a[i], b: b[i] };
        const d = walk(a[i], b[i], at(path, i));
        if (d) return d;
      }
      return null;
    }
    if (kind(a) === 'object') {
      const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort();
      for (const k of keys) {
        if (!hasOwn(a, k) || !hasOwn(b, k)) return { path: join(path, k), a: hasOwn(a, k) ? a[k] : undefined, b: hasOwn(b, k) ? b[k] : undefined };
        const d = walk(a[k], b[k], join(path, k));
        if (d) return d;
      }
      return null;
    }
    return a === b ? null : { path, a, b };
  }

  /** Primeira diferença pela forma canônica (N0: undefined = ausente). Valor ausente aparece como undefined. */
  function findDivergence(a, b) {
    return walk(normalForm(a), normalForm(b), '');
  }

  // ------------------------------------------------------------------ execução

  const n1Entry = () => ({ id: 'N1', path: 'config.deckSource', from: 'order', to: 'crypto',
    reason: 'mão de origem crypto reproduzida pela ordem completa das cartas (especificação 5.2)' });

  /** Cópia em forma normal; N1 (só origem crypto) troca exatamente o valor 'order' por 'crypto'. */
  function outputState(state, provenance) {
    const copy = normalForm(state);
    if (provenance.source === 'crypto' && copy.config.deckSource === 'order') copy.config.deckSource = 'crypto';
    return copy;
  }

  function engineConfigOf(record) {
    const s = record.setup, prov = record.deck.provenance;
    return {
      players: s.players.map(p => ({ id: p.id, seat: p.seat, stack: p.stack })),
      buttonSeat: s.buttonSeat, smallBlind: s.smallBlind, bigBlind: s.bigBlind,
      ante: s.ante, anteType: s.anteType, rules: Object.assign({}, s.rules),
      handId: record.handId,
      deck: prov.source === 'seed' ? { seed: prov.seed } : { order: record.deck.order.slice() },
    };
  }

  /**
   * Núcleo comum. Devolve { initial, run(k) } sem lançar para divergências de origem/ação;
   * retorna um "evento" que o chamador transforma em erro (replayRecord) ou relatório (verifyRecord).
   */
  function start(record) {
    const state = B.createHand(engineConfigOf(record));
    if (record.deck.provenance.source === 'seed') {
      const got = state.config.deckOrder, exp = record.deck.order;
      for (let i = 0; i < 52; i++) {
        if (got[i] !== exp[i]) {
          return { state: null, event: { code: 'DECK_PROVENANCE_MISMATCH', step: null, part: 'deck', path: at('order', i), expected: exp[i], actual: got[i] } };
        }
      }
    }
    return { state, event: null };
  }

  function step(state, record, k) {
    const a = record.actions[k];
    const la = B.legalActions(state);
    const bad = actual => ({ state: null, event: { code: 'ILLEGAL_RECORDED_ACTION', step: k, part: 'action', path: at('actions', k), expected: Object.assign({}, a), actual } });
    if (la === null) return bad({ phase: state.phase, toAct: null, reason: 'mão encerrada' });
    if (a.playerId !== state.toAct) return bad({ phase: state.phase, toAct: state.toAct, reason: 'fora da vez' });
    if (!listed(la, a)) return bad({ phase: state.phase, toAct: state.toAct, reason: 'ação não consta de legalActions' });
    let next;
    try {
      next = B.applyAction(state, hasOwn(a, 'to') && a.to !== undefined ? { playerId: a.playerId, type: a.type, to: a.to } : { playerId: a.playerId, type: a.type });
    } catch (e) {
      return bad({ phase: state.phase, toAct: state.toAct, reason: 'recusada pelo motor', engineCode: e && e.code });
    }
    return { state: next, event: null };
  }

  function toReplayError(ev) {
    return new ReplayError(ev.code, ev.code === 'DECK_PROVENANCE_MISMATCH'
      ? 'a semente não gera deck.order (primeira diferença em ' + ev.path + ')'
      : 'ação ' + ev.step + ' ilegal: ' + ev.actual.reason, ev);
  }

  function parseOptions(record, options) {
    if (options === undefined) return record.actions.length;
    if (!isPlainObject(options)) throw new ReplayError('INVALID_ARGUMENT', 'opções devem ser um objeto { upTo }', { path: 'options' });
    for (const k of Object.keys(options)) {
      if (options[k] !== undefined && k !== 'upTo') throw new ReplayError('INVALID_ARGUMENT', 'opção desconhecida: ' + k, { path: join('options', k) });
    }
    if (options.upTo === undefined) return record.actions.length;
    const u = options.upTo;
    if (!isSafeInt(u) || u < 0 || u > record.actions.length) {
      throw new ReplayError('INVALID_ARGUMENT', 'upTo deve ser inteiro de 0 a ' + record.actions.length, { path: 'options.upTo' });
    }
    return u;
  }

  function replayRecord(record, options) {
    RC.validateRecord(record);                                 // Q1: RecordError
    const upTo = parseOptions(record, options);
    const prov = record.deck.provenance;
    const s0 = start(record);
    if (s0.event) throw toReplayError(s0.event);
    const raw = [s0.state];
    let state = s0.state;
    for (let k = 0; k < upTo; k++) {
      const r = step(state, record, k);
      if (r.event) throw toReplayError(r.event);
      state = r.state;
      raw.push(state);
    }
    let settlement = null;
    if (upTo === record.actions.length && state.phase === 'handOver' && record.settlementOptions !== null) {
      settlement = normalForm(ST.settleHand(state, record.settlementOptions));
    }
    const states = raw.map(s => outputState(s, prov));
    return {
      states,
      finalState: states[states.length - 1],
      settlement,
      normalizations: prov.source === 'crypto' ? [n1Entry()] : [],
    };
  }

  function verifyRecord(record) {
    RC.validateRecord(record);                                 // Q1: RecordError
    const names = Object.keys(EV.ENGINE_MODULES);
    const engineDiffs = names.filter(n => record.engine.modules[n] !== EV.ENGINE_MODULES[n]);
    const prov = record.deck.provenance;
    const report = { ok: true, engineMatch: engineDiffs.length === 0, engineDiffs, normalizations: [], divergence: null, steps: 0 };
    const fail = d => { report.ok = false; report.divergence = d; return report; };

    const s0 = start(record);
    if (s0.event) return fail(s0.event);
    let state = s0.state;
    const cps = record.expected.checkpoints;
    const cpDiff = k => {
      const d = findDivergence(cps[k], RC.checkpointOf(state));
      return d && { code: 'REPLAY_DIVERGENCE', step: k, part: 'checkpoint', path: d.path, expected: d.a, actual: d.b };
    };
    let d = cpDiff(0);
    if (d) return fail(d);
    for (let k = 0; k < record.actions.length; k++) {
      const r = step(state, record, k);
      if (r.event) return fail(r.event);
      state = r.state;
      report.steps = k + 1;
      d = cpDiff(k + 1);
      if (d) return fail(d);
    }
    if (prov.source === 'crypto') report.normalizations.push(n1Entry());
    const n = record.actions.length;
    const fd = findDivergence(record.expected.finalState, outputState(state, prov));
    if (fd) return fail({ code: 'REPLAY_DIVERGENCE', step: n, part: 'finalState', path: fd.path, expected: fd.a, actual: fd.b });
    if (record.expected.complete) {
      const sd = findDivergence(record.expected.settlement, ST.settleHand(state, record.settlementOptions));
      if (sd) return fail({ code: 'SETTLEMENT_DIVERGENCE', step: n, part: 'settlement', path: sd.path, expected: sd.a, actual: sd.b });
    }
    return report;
  }

  function createStepper(record) {
    const { states } = replayRecord(record);
    const length = record.actions.length;
    const index = k => {
      if (!isSafeInt(k) || k < 0 || k > length) throw new ReplayError('INVALID_ARGUMENT', 'k deve ser inteiro de 0 a ' + length, { path: 'k' });
      return k;
    };
    const texts = states.map(s => RC.canonicalize(s));        // cada chamada devolve cópia nova
    return Object.freeze({
      length,
      stateAt: k => JSON.parse(texts[index(k)]),
      checkpointAt: k => RC.checkpointOf(JSON.parse(texts[index(k)])),
    });
  }

  return Object.freeze({
    ReplayError, replayRecord, verifyRecord, createStepper, findDivergence,
    checkpointOf: RC.checkpointOf,
  });
});
