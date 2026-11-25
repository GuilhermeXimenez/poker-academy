/*
 * Poker Academy — record.js  (Etapa 4, subetapa 4.1)
 * Registro de mãos: forma canônica, criação, validação, serialização e leitura.
 * Especificação: Etapa 4.0 v1.2 (seções 3, 4, 5.2, 6.2, 7 e 8).
 *
 * API:
 *   FORMAT, FORMAT_VERSION, LIMITS, RecordError
 *   canonicalize(value)                                   -> texto JSON canônico
 *   createRecord({ config, actions, settlementOptions })  -> registro (forma normal)
 *   recordFromState(state, settlementOptions)             -> registro (forma normal)
 *   validateRecord(record)                                -> true | RecordError
 *   serializeRecord(record)                               -> texto canônico
 *   parseRecord(text)                                     -> registro validado
 *   checkpointOf(state)                                   -> checkpoint (forma normal)
 *
 * Regras centrais:
 *   - Presença (N0): propriedade presente = própria, enumerável, chave de texto e valor !== undefined.
 *     null, 0, '' e false são valores presentes.
 *   - Forma canônica: chaves ordenadas; só inteiros seguros e diferentes de -0; undefined em array,
 *     NaN, Infinity, frações, funções, Map, Date, symbol etc. -> NON_CANONICAL_VALUE; mais de 32 níveis
 *     -> DEPTH_EXCEEDED. Nenhuma conversão silenciosa de valores.
 *   - Forma normal: todo registro produzido é JSON.parse(canonicalize(rascunho)).
 *   - N1 (só em recordFromState de mão 'crypto'): o estado reconstruído pela ordem grava
 *     config.deckSource = 'order'; troca-se exatamente esse valor por 'crypto'.
 *
 * Nenhum módulo congelado é alterado. Puro: não altera argumentos; sem relógio, aleatoriedade,
 * rede, arquivos ou APIs exclusivas do Node.
 */
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const deps = isNode
    ? { betting: require('./betting.js'), settlement: require('./settlement.js'), engineVersion: require('./engineVersion.js') }
    : { betting: root.PA.betting, settlement: root.PA.settlement, engineVersion: root.PA.engineVersion };
  const api = factory(deps);
  if (isNode) module.exports = api;
  else (root.PA = root.PA || {}).record = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';
  const B = deps.betting, ST = deps.settlement, EV = deps.engineVersion;

  const FORMAT = 'poker-academy/hand-record';
  const FORMAT_VERSION = 1;

  /** Limites da seção 8 (o teto de ações é calculado por maxActions). */
  const LIMITS = Object.freeze({
    minPlayers: 2,
    maxPlayers: 9,
    maxPlayerIdLength: 64,
    maxHandIdLength: 128,
    maxSeed: 4294967295,
    maxTotalChips: Number.MAX_SAFE_INTEGER,
    maxDepth: 32,
    maxTextLength: 4194304,
  });

  const TOP_KEYS = ['format', 'formatVersion', 'engine', 'handId', 'setup', 'deck', 'actions', 'settlementOptions', 'expected'];
  const SETUP_KEYS = ['players', 'buttonSeat', 'smallBlind', 'bigBlind', 'ante', 'anteType', 'rules'];
  const ANTE_TYPES = ['none', 'individual', 'bbAnte'];
  // Valores aceitos pelo betting.js (Contexto 09, seção 3.4); um teste confere as chaves com DEFAULT_RULES.
  const RULE_VALUES = Object.freeze({
    bbAntePriority: ['blindFirst', 'anteFirst'],
    individualAntePriority: ['anteFirst', 'blindFirst'],
    shortBlindCallAmount: ['fullBlind', 'posted'],
    allowFoldWhenCheckAvailable: [true, false],
    burnCards: [true, false],
    incompleteOpeningBet: ['incomplete', 'treatAsFullBlind'],
  });
  const RULE_KEYS = Object.keys(RULE_VALUES);
  // Opções do settlement.js (D1/D2 da Etapa 3).
  const SETTLEMENT_OPTION_VALUES = Object.freeze({
    bbAnteHandling: ['deadToMainPot', 'asContribution'],
    oddChipRule: ['leftOfButton'],
  });
  const ACTION_TYPES = ['fold', 'check', 'call', 'bet', 'raise', 'allin'];
  const SOURCES = ['seed', 'crypto', 'order'];
  const STREETS = ['preflop', 'flop', 'turn', 'river'];
  const PHASES = ['betting', 'handOver'];
  const STATUSES = ['active', 'folded', 'allin'];
  const CHECKPOINT_KEYS = ['step', 'street', 'phase', 'toAct', 'currentBet', 'lastFullRaise', 'pot', 'board', 'players'];
  const CHECKPOINT_PLAYER_KEYS = ['id', 'stack', 'streetCommitted', 'totalCommitted', 'status'];
  const EXPECTED_KEYS = ['complete', 'checkpoints', 'finalState', 'settlement'];

  class RecordError extends Error {
    constructor(code, message, details) {
      super(code + ': ' + message);
      this.name = 'RecordError';
      this.code = code;
      if (details !== undefined) this.details = details;
    }
  }

  // ------------------------------------------------------------------ utilidades

  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  /** Presença (N0): própria e com valor diferente de undefined. */
  const present = (o, k) => hasOwn(o, k) && o[k] !== undefined;
  const isSafeInt = x => Number.isSafeInteger(x) && !Object.is(x, -0);
  const isNonNegInt = x => isSafeInt(x) && x >= 0;
  const isPlainObject = v => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
  };
  const join = (path, k) => (path ? path + '.' + k : String(k));
  const at = (path, i) => path + '[' + i + ']';

  const invalid = (path, msg) => new RecordError('INVALID_RECORD', msg + ' (em ' + (path || 'raiz') + ')', { path });
  const limit = (path, name, msg) => new RecordError('LIMIT_EXCEEDED', msg + ' (em ' + (path || 'raiz') + ')', { path, limit: name });

  // ------------------------------------------------------------------ forma canônica (seção 4)

  function nonCanonical(path, msg) { return new RecordError('NON_CANONICAL_VALUE', msg + ' (em ' + (path || 'raiz') + ')', { path }); }

  function canon(v, level, path) {
    if (v === null) return 'null';
    switch (typeof v) {
      case 'boolean': return v ? 'true' : 'false';
      case 'string': return JSON.stringify(v);
      case 'number':
        if (Object.is(v, -0)) throw nonCanonical(path, 'número -0 não tem forma canônica');
        if (!Number.isSafeInteger(v)) throw nonCanonical(path, 'número não é inteiro seguro: ' + String(v));
        return String(v);
      case 'object': break;
      default: throw nonCanonical(path, 'tipo sem forma canônica: ' + typeof v);
    }
    const next = level + 1;
    if (next > LIMITS.maxDepth) {
      throw new RecordError('DEPTH_EXCEEDED', 'aninhamento acima de ' + LIMITS.maxDepth + ' níveis (em ' + (path || 'raiz') + ')', { path, limit: 'maxDepth' });
    }
    if (Object.getOwnPropertySymbols(v).length > 0) throw nonCanonical(path, 'chave symbol');
    if (Array.isArray(v)) {
      const keys = Object.keys(v);
      if (keys.length !== v.length || keys.some((k, i) => k !== String(i))) throw nonCanonical(path, 'array com lacunas ou propriedades extras');
      const parts = [];
      for (let i = 0; i < v.length; i++) {
        if (v[i] === undefined) throw nonCanonical(at(path, i), 'elemento undefined em array');
        parts.push(canon(v[i], next, at(path, i)));
      }
      return '[' + parts.join(',') + ']';
    }
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) throw nonCanonical(path, 'objeto não simples');
    const parts = [];
    for (const k of Object.keys(v).sort()) {
      const x = v[k];
      if (x === undefined) continue;                     // N0: undefined = ausente
      parts.push(JSON.stringify(k) + ':' + canon(x, next, join(path, k)));
    }
    return '{' + parts.join(',') + '}';
  }

  function canonicalize(value) { return canon(value, 0, ''); }

  const normalForm = value => JSON.parse(canonicalize(value));

  /** Primeira diferença entre dois valores em forma normal (para diagnóstico de RECORD_STATE_MISMATCH). */
  function firstDifference(a, b, path) {
    const kind = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
    if (kind(a) !== kind(b)) return path || 'raiz';
    if (kind(a) === 'array') {
      const n = Math.max(a.length, b.length);
      for (let i = 0; i < n; i++) {
        if (i >= a.length || i >= b.length) return at(path, i);
        const d = firstDifference(a[i], b[i], at(path, i));
        if (d !== null) return d;
      }
      return null;
    }
    if (kind(a) === 'object') {
      const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort();
      for (const k of keys) {
        if (!hasOwn(a, k) || !hasOwn(b, k)) return join(path, k);
        const d = firstDifference(a[k], b[k], join(path, k));
        if (d !== null) return d;
      }
      return null;
    }
    return a === b ? null : (path || 'raiz');
  }

  // ------------------------------------------------------------------ validação (seções 3, 4 e 8)

  function exactKeys(o, path, required, optional) {
    if (!isPlainObject(o)) throw invalid(path, 'objeto esperado');
    for (const k of required) if (!present(o, k)) throw invalid(join(path, k), 'campo obrigatório ausente');
    for (const k of Object.keys(o)) {
      if (o[k] === undefined) continue;
      if (!required.includes(k) && !(optional && optional.includes(k))) throw invalid(join(path, k), 'campo não previsto');
    }
  }

  function oneOf(value, allowed, path, what) {
    if (!allowed.includes(value)) throw invalid(path, what + ' inválido: ' + JSON.stringify(value));
  }

  /** Teto demonstrável de ações (seção 8): n × (4 × ⌊S / BB⌋ + n + 4). */
  function maxActions(n, maxStack, bigBlind) {
    return n * (4 * Math.floor(maxStack / bigBlind) + n + 4);
  }

  function validateEngine(engine) {
    exactKeys(engine, 'engine', ['modules']);
    const names = Object.keys(EV.ENGINE_MODULES);
    exactKeys(engine.modules, 'engine.modules', names);
    for (const name of names) {
      const h = engine.modules[name];
      if (typeof h !== 'string' || !/^[0-9a-f]{64}$/.test(h)) throw invalid(join('engine.modules', name), 'SHA-256 em hexadecimal minúsculo esperado');
    }
  }

  function validateHandId(handId) {
    if (typeof handId !== 'string' || handId.length === 0) throw invalid('handId', 'texto não vazio esperado');
    if (handId.length > LIMITS.maxHandIdLength) throw limit('handId', 'maxHandIdLength', 'handId com mais de ' + LIMITS.maxHandIdLength + ' caracteres');
  }

  function validateSetup(setup) {
    exactKeys(setup, 'setup', SETUP_KEYS);
    const ps = setup.players;
    if (!Array.isArray(ps)) throw invalid('setup.players', 'array esperado');
    if (ps.length < LIMITS.minPlayers || ps.length > LIMITS.maxPlayers) {
      throw limit('setup.players', 'players', 'número de jogadores fora de ' + LIMITS.minPlayers + '..' + LIMITS.maxPlayers + ': ' + ps.length);
    }
    const ids = [], seats = new Set();
    let total = 0, maxStack = 0;
    ps.forEach((p, i) => {
      const path = at('setup.players', i);
      exactKeys(p, path, ['id', 'seat', 'stack']);
      if (typeof p.id !== 'string' || p.id.length === 0) throw invalid(join(path, 'id'), 'texto não vazio esperado');
      if (p.id.length > LIMITS.maxPlayerIdLength) throw limit(join(path, 'id'), 'maxPlayerIdLength', 'id com mais de ' + LIMITS.maxPlayerIdLength + ' caracteres');
      if (ids.includes(p.id)) throw invalid(join(path, 'id'), 'id repetido');
      if (!isSafeInt(p.seat)) throw invalid(join(path, 'seat'), 'inteiro esperado');
      if (seats.has(p.seat)) throw invalid(join(path, 'seat'), 'assento repetido');
      if (!isSafeInt(p.stack) || p.stack <= 0) throw invalid(join(path, 'stack'), 'inteiro positivo esperado');
      ids.push(p.id); seats.add(p.seat);
      total += p.stack; maxStack = Math.max(maxStack, p.stack);
    });
    if (total > LIMITS.maxTotalChips) throw limit('setup.players', 'maxTotalChips', 'soma dos stacks acima de 2^53 - 1');
    if (!isSafeInt(setup.buttonSeat) || !seats.has(setup.buttonSeat)) throw invalid('setup.buttonSeat', 'assento existente esperado');
    const { smallBlind: sb, bigBlind: bb } = setup;
    if (!isSafeInt(sb) || !isSafeInt(bb) || sb <= 0 || bb <= 0 || sb > bb) throw invalid('setup.smallBlind', 'blinds inválidos (inteiros, 0 < SB <= BB)');
    if (!isNonNegInt(setup.ante)) throw invalid('setup.ante', 'inteiro >= 0 esperado');
    oneOf(setup.anteType, ANTE_TYPES, 'setup.anteType', 'anteType');
    if ((setup.anteType === 'none') !== (setup.ante === 0)) throw invalid('setup.ante', 'ante incoerente com anteType');
    exactKeys(setup.rules, 'setup.rules', RULE_KEYS);
    for (const k of RULE_KEYS) oneOf(setup.rules[k], RULE_VALUES[k], join('setup.rules', k), 'valor');
    return { ids, n: ps.length, maxStack, bb };
  }

  function validateProvenance(prov, path) {
    if (!isPlainObject(prov)) throw invalid(path, 'objeto esperado');
    if (!present(prov, 'source')) throw invalid(join(path, 'source'), 'campo obrigatório ausente');
    oneOf(prov.source, SOURCES, join(path, 'source'), 'origem');
    if (prov.source === 'seed') {
      exactKeys(prov, path, ['source', 'seed']);
      if (!isSafeInt(prov.seed)) throw invalid(join(path, 'seed'), 'inteiro esperado');
      if (prov.seed < 0 || prov.seed > LIMITS.maxSeed) throw limit(join(path, 'seed'), 'maxSeed', 'semente fora de 0..' + LIMITS.maxSeed);
    } else {
      exactKeys(prov, path, ['source']);
    }
  }

  function validateDeck(deck) {
    exactKeys(deck, 'deck', ['order', 'provenance']);
    const o = deck.order;
    if (!Array.isArray(o) || o.length !== 52) throw invalid('deck.order', 'array de 52 cartas esperado');
    const seen = new Set();
    o.forEach((c, i) => {
      if (!isSafeInt(c) || c < 0 || c > 51) throw invalid(at('deck.order', i), 'carta fora de 0..51');
      if (seen.has(c)) throw invalid(at('deck.order', i), 'carta repetida');
      seen.add(c);
    });
    validateProvenance(deck.provenance, 'deck.provenance');
  }

  function validateActionShape(a, path) {
    if (!isPlainObject(a)) throw invalid(path, 'objeto esperado');
    if (!present(a, 'type')) throw invalid(join(path, 'type'), 'campo obrigatório ausente');
    oneOf(a.type, ACTION_TYPES, join(path, 'type'), 'tipo de ação');
    if (a.type === 'bet' || a.type === 'raise') {
      exactKeys(a, path, ['playerId', 'type', 'to']);
      if (!isSafeInt(a.to) || a.to <= 0) throw invalid(join(path, 'to'), 'inteiro positivo esperado');
    } else {
      exactKeys(a, path, ['playerId', 'type']);
    }
    if (typeof a.playerId !== 'string' || a.playerId.length === 0) throw invalid(join(path, 'playerId'), 'texto não vazio esperado');
  }

  function validateActions(actions, ctx) {
    if (!Array.isArray(actions)) throw invalid('actions', 'array esperado');
    const max = maxActions(ctx.n, ctx.maxStack, ctx.bb);
    if (actions.length > max) throw limit('actions', 'maxActions', 'mais ações (' + actions.length + ') que o teto demonstrável (' + max + ')');
    actions.forEach((a, k) => {
      validateActionShape(a, at('actions', k));
      if (!ctx.ids.includes(a.playerId)) throw invalid(join(at('actions', k), 'playerId'), 'jogador inexistente');
    });
  }

  function validateSettlementOptions(opts) {
    if (opts === null) return;
    exactKeys(opts, 'settlementOptions', ['bbAnteHandling', 'oddChipRule']);
    for (const k of Object.keys(SETTLEMENT_OPTION_VALUES)) oneOf(opts[k], SETTLEMENT_OPTION_VALUES[k], join('settlementOptions', k), 'valor');
  }

  function validateCheckpoint(cp, k, ctx) {
    const path = at('expected.checkpoints', k);
    exactKeys(cp, path, CHECKPOINT_KEYS);
    if (cp.step !== k) throw invalid(join(path, 'step'), 'step deve ser ' + k);
    oneOf(cp.street, STREETS, join(path, 'street'), 'street');
    oneOf(cp.phase, PHASES, join(path, 'phase'), 'fase');
    if (cp.toAct !== null && !ctx.ids.includes(cp.toAct)) throw invalid(join(path, 'toAct'), 'jogador inexistente');
    for (const f of ['currentBet', 'lastFullRaise', 'pot']) if (!isNonNegInt(cp[f])) throw invalid(join(path, f), 'inteiro >= 0 esperado');
    if (!Array.isArray(cp.board) || cp.board.length > 5 || cp.board.some(c => !isSafeInt(c) || c < 0 || c > 51)) throw invalid(join(path, 'board'), 'até 5 cartas esperadas');
    if (!Array.isArray(cp.players) || cp.players.length !== ctx.n) throw invalid(join(path, 'players'), ctx.n + ' jogadores esperados');
    cp.players.forEach((p, i) => {
      const pp = at(join(path, 'players'), i);
      exactKeys(p, pp, CHECKPOINT_PLAYER_KEYS);
      if (p.id !== ctx.ids[i]) throw invalid(join(pp, 'id'), 'ordem dos jogadores difere de setup.players');
      for (const f of ['stack', 'streetCommitted', 'totalCommitted']) if (!isNonNegInt(p[f])) throw invalid(join(pp, f), 'inteiro >= 0 esperado');
      oneOf(p.status, STATUSES, join(pp, 'status'), 'status');
    });
  }

  function validateExpected(record, ctx) {
    const ex = record.expected;
    exactKeys(ex, 'expected', EXPECTED_KEYS);
    if (typeof ex.complete !== 'boolean') throw invalid('expected.complete', 'booleano esperado');
    const fs = ex.finalState;
    if (!isPlainObject(fs)) throw invalid('expected.finalState', 'objeto esperado');
    if (ex.complete !== (fs.phase === 'handOver')) throw invalid('expected.complete', 'incoerente com a fase final (' + JSON.stringify(fs.phase) + ')');
    if (ex.complete) {
      if (record.settlementOptions === null) throw invalid('settlementOptions', 'mão completa exige opções de liquidação explícitas');
      if (!isPlainObject(ex.settlement)) throw invalid('expected.settlement', 'liquidação esperada para mão completa');
    } else {
      if (record.settlementOptions !== null) throw invalid('settlementOptions', 'mão incompleta exige null');
      if (ex.settlement !== null) throw invalid('expected.settlement', 'mão incompleta exige null');
    }
    // coerência estado final × handId e deck (3.4, 3.5)
    if (fs.id !== record.handId) throw invalid('expected.finalState.id', 'difere de handId');
    const c = fs.config;
    if (!isPlainObject(c)) throw invalid('expected.finalState.config', 'objeto esperado');
    const prov = record.deck.provenance;
    if (c.deckSource !== prov.source) throw invalid('expected.finalState.config.deckSource', 'difere de deck.provenance.source');
    if (prov.source === 'seed') {
      if (c.seed !== prov.seed) throw invalid('expected.finalState.config.seed', 'difere de deck.provenance.seed');
    } else if (present(c, 'seed')) {
      throw invalid('expected.finalState.config.seed', 'deve estar ausente para a origem ' + prov.source);
    }
    const order = c.deckOrder;
    if (!Array.isArray(order) || order.length !== 52 || order.some((x, i) => x !== record.deck.order[i])) {
      throw invalid('expected.finalState.config.deckOrder', 'difere de deck.order');
    }
    if (!Array.isArray(ex.checkpoints) || ex.checkpoints.length !== record.actions.length + 1) {
      throw invalid('expected.checkpoints', (record.actions.length + 1) + ' checkpoints esperados');
    }
    ex.checkpoints.forEach((cp, k) => validateCheckpoint(cp, k, ctx));
  }

  function validateRecord(record) {
    canonicalize(record);                                     // (l): forma canônica antes da estrutura
    if (!isPlainObject(record)) throw invalid('', 'registro deve ser objeto');
    if (present(record, 'format') && record.format !== FORMAT) {
      throw new RecordError('UNSUPPORTED_VERSION', 'formato não suportado: ' + JSON.stringify(record.format), { path: 'format' });
    }
    if (present(record, 'formatVersion') && record.formatVersion !== FORMAT_VERSION) {
      throw new RecordError('UNSUPPORTED_VERSION', 'versão de formato não suportada: ' + JSON.stringify(record.formatVersion), { path: 'formatVersion' });
    }
    exactKeys(record, '', TOP_KEYS);
    validateEngine(record.engine);
    validateHandId(record.handId);
    const ctx = validateSetup(record.setup);
    validateDeck(record.deck);
    validateActions(record.actions, ctx);
    validateSettlementOptions(record.settlementOptions);
    validateExpected(record, ctx);
    return true;
  }

  // ------------------------------------------------------------------ checkpoints

  function checkpointOf(state) {
    return normalForm({
      step: state.log.filter(e => e && e.type === 'action').length,
      street: state.street,
      phase: state.phase,
      toAct: state.toAct,
      currentBet: state.betting.currentBet,
      lastFullRaise: state.betting.lastFullRaise,
      pot: B.getPot(state),
      board: state.board.slice(),
      players: state.players.map(p => ({ id: p.id, stack: p.stack, streetCommitted: p.streetCommitted, totalCommitted: p.totalCommitted, status: p.status })),
    });
  }

  // ------------------------------------------------------------------ criação

  /** Teste independente de legalidade: a ação consta de legalActions? */
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

  function engineError(source, e) {
    if (e && e.name === 'RecordError') return e;
    const code = e && (e.code || e.name);
    return new RecordError('ENGINE_ERROR', source + ': ' + (e && e.message), { source, code });
  }

  function provenanceOfConfig(config) {
    if (!isPlainObject(config)) throw invalid('config', 'objeto esperado');
    if (!present(config, 'deck')) return { source: 'crypto' };
    const deck = config.deck;
    exactKeys(deck, 'config.deck', [], ['order', 'seed']);
    const hasOrder = present(deck, 'order'), hasSeed = present(deck, 'seed');
    if (hasOrder && hasSeed) throw invalid('config.deck', 'order e seed não podem ser usados juntos');
    if (hasOrder) {
      if (!Array.isArray(deck.order)) throw invalid('config.deck.order', 'array esperado');
      return { source: 'order' };
    }
    if (hasSeed) return { source: 'seed', seed: deck.seed };
    return { source: 'crypto' };
  }

  /**
   * Núcleo comum de createRecord e recordFromState.
   * engineConfig vai ao createHand; provenance vai ao registro; applyN1 só em recordFromState de mão 'crypto'.
   */
  function build(engineConfig, actions, settlementOptions, provenance, applyN1) {
    validateProvenance(provenance, 'deck.provenance');   // semente validada antes do motor (P3)
    if (!Array.isArray(actions)) throw invalid('actions', 'array esperado');
    actions.forEach((a, k) => validateActionShape(a, at('actions', k)));

    let state;
    try { state = B.createHand(engineConfig); } catch (e) { throw engineError('betting', e); }
    const checkpoints = [checkpointOf(state)];
    actions.forEach((a, k) => {
      const la = B.legalActions(state);
      if (la === null) throw new RecordError('ILLEGAL_ACTION', 'ação ' + k + ' depois do fim da mão', { step: k });
      if (a.playerId !== state.toAct) throw new RecordError('ILLEGAL_ACTION', 'ação ' + k + ': vez de ' + state.toAct + ', não de ' + a.playerId, { step: k, toAct: state.toAct });
      if (!listed(la, a)) throw new RecordError('ILLEGAL_ACTION', 'ação ' + k + ' não consta de legalActions: ' + JSON.stringify(a), { step: k });
      try {
        state = B.applyAction(state, present(a, 'to') ? { playerId: a.playerId, type: a.type, to: a.to } : { playerId: a.playerId, type: a.type });
      } catch (e) {
        throw new RecordError('ILLEGAL_ACTION', 'ação ' + k + ' recusada pelo motor: ' + e.message, { step: k, source: 'betting', engineCode: e.code });
      }
      checkpoints.push(checkpointOf(state));
    });

    const complete = state.phase === 'handOver';
    let options = null, settlement = null;
    if (complete) {
      if (settlementOptions === null) throw invalid('settlementOptions', 'mão completa exige opções de liquidação (omita para usar o padrão)');
      try { settlement = ST.settleHand(state, settlementOptions); } catch (e) { throw engineError('settlement', e); }
      const given = settlementOptions || {};
      options = {
        bbAnteHandling: present(given, 'bbAnteHandling') ? given.bbAnteHandling : ST.DEFAULT_OPTIONS.bbAnteHandling,
        oddChipRule: present(given, 'oddChipRule') ? given.oddChipRule : ST.DEFAULT_OPTIONS.oddChipRule,
      };
    } else if (settlementOptions !== undefined && settlementOptions !== null) {
      throw invalid('settlementOptions', 'mão incompleta não tem liquidação (use null ou omita)');
    }

    let finalState = normalForm(state);
    if (applyN1) {
      if (finalState.config.deckSource !== 'order') throw new RecordError('ENGINE_ERROR', 'reconstrução crypto sem deckSource "order"', { source: 'record' });
      finalState.config.deckSource = 'crypto';                // N1, exatamente este valor
    }
    const c = state.config;
    const draft = {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      engine: { modules: Object.assign({}, EV.ENGINE_MODULES) },
      handId: state.id,
      setup: {
        players: c.players.map(p => ({ id: p.id, seat: p.seat, stack: p.stack })),
        buttonSeat: c.buttonSeat, smallBlind: c.smallBlind, bigBlind: c.bigBlind,
        ante: c.ante, anteType: c.anteType, rules: Object.assign({}, c.rules),
      },
      deck: { order: c.deckOrder.slice(), provenance: provenance.source === 'seed' ? { source: 'seed', seed: provenance.seed } : { source: provenance.source } },
      actions: actions.map(a => (present(a, 'to') ? { playerId: a.playerId, type: a.type, to: a.to } : { playerId: a.playerId, type: a.type })),
      settlementOptions: options,
      expected: { complete, checkpoints, finalState, settlement },
    };
    const text = canonicalize(draft);
    if (text.length > LIMITS.maxTextLength) throw limit('', 'maxTextLength', 'registro com ' + text.length + ' caracteres (máximo ' + LIMITS.maxTextLength + ')');
    const record = JSON.parse(text);                          // forma normal
    validateRecord(record);
    return record;
  }

  function createRecord(input) {
    if (!isPlainObject(input)) throw invalid('', 'entrada { config, actions, settlementOptions } esperada');
    exactKeys(input, '', ['config', 'actions'], ['settlementOptions']);
    const provenance = provenanceOfConfig(input.config);
    return build(input.config, input.actions, input.settlementOptions, provenance, false);
  }

  function recordFromState(state, settlementOptions) {
    if (!isPlainObject(state) || !isPlainObject(state.config) || !Array.isArray(state.log)) throw invalid('state', 'estado do motor esperado');
    const c = state.config;
    let deck, provenance, applyN1 = false;
    if (c.deckSource === 'seed') { deck = { seed: c.seed }; provenance = { source: 'seed', seed: c.seed }; }
    else if (c.deckSource === 'order') { deck = { order: c.deckOrder }; provenance = { source: 'order' }; }
    else if (c.deckSource === 'crypto') { deck = { order: c.deckOrder }; provenance = { source: 'crypto' }; applyN1 = true; }
    else throw invalid('state.config.deckSource', 'origem desconhecida: ' + JSON.stringify(c.deckSource));
    const engineConfig = {
      players: c.players, buttonSeat: c.buttonSeat, smallBlind: c.smallBlind, bigBlind: c.bigBlind,
      ante: c.ante, anteType: c.anteType, rules: c.rules, handId: state.id, deck,
    };
    const actions = state.log
      .filter(e => e && e.type === 'action')
      .map(e => (e.requested === 'bet' || e.requested === 'raise'
        ? { playerId: e.player, type: e.requested, to: e.to }
        : { playerId: e.player, type: e.requested }));
    let record;
    try {
      record = build(engineConfig, actions, settlementOptions, provenance, applyN1);
    } catch (e) {
      const reproduction = e && e.name === 'RecordError' &&
        (e.code === 'ILLEGAL_ACTION' || (e.code === 'ENGINE_ERROR' && e.details && e.details.source === 'betting'));
      if (reproduction) throw new RecordError('RECORD_STATE_MISMATCH', 'o estado não é reproduzível a partir do próprio log: ' + e.message, { cause: e.code, causeDetails: e.details });
      throw e;
    }
    const received = canonicalize(state);
    if (canonicalize(record.expected.finalState) !== received) {
      throw new RecordError('RECORD_STATE_MISMATCH', 'estado reconstruído difere do recebido',
        { path: firstDifference(record.expected.finalState, JSON.parse(received), '') });
    }
    return record;
  }

  // ------------------------------------------------------------------ serialização

  function serializeRecord(record) {
    validateRecord(record);
    const text = canonicalize(record);
    if (text.length > LIMITS.maxTextLength) throw limit('', 'maxTextLength', 'registro com ' + text.length + ' caracteres (máximo ' + LIMITS.maxTextLength + ')');
    return text;
  }

  function parseRecord(text) {
    if (typeof text !== 'string') throw invalid('', 'texto esperado');
    if (text.length > LIMITS.maxTextLength) throw limit('', 'maxTextLength', 'texto com ' + text.length + ' caracteres (máximo ' + LIMITS.maxTextLength + ')');
    let value;
    try { value = JSON.parse(text); } catch (e) { throw invalid('', 'JSON inválido: ' + e.message); }
    validateRecord(value);
    return value;
  }

  return Object.freeze({
    FORMAT, FORMAT_VERSION, LIMITS, RecordError,
    canonicalize, createRecord, recordFromState, validateRecord, serializeRecord, parseRecord, checkpointOf,
  });
});
