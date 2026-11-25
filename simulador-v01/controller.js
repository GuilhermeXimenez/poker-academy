/*
 * Poker Academy — Artifact v0.1 — controller.js
 * Camada de partida sobre o motor oficial (que é usado SEM alterações):
 *   - monta a configuração de cada mão (createHand);
 *   - decide as ações dos bots SIMPLES (não estratégicos);
 *   - liquida a mão (settleHand) e gera o registro exportável (recordFromState + serializeRecord).
 * Nenhuma regra do jogo é decidida aqui: legalidade, potes, stacks, avaliação e liquidação vêm do motor.
 * Os bots só escolhem entre as opções que o motor devolve em legalActions.
 */
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const SRC = isNode ? (process.env.PA_SRC || require('path').join(__dirname, '..', 'engine', 'src')) + '/' : '';
  const deps = isNode
    ? { B: require(SRC + 'betting.js'), ST: require(SRC + 'settlement.js'), RC: require(SRC + 'record.js'),
        EV: require(SRC + 'evaluator.js') }
    : { B: root.PA.betting, ST: root.PA.settlement, RC: root.PA.record, EV: root.PA.evaluator };
  const api = factory(deps);
  if (isNode) module.exports = api;
  else (root.PA = root.PA || {}).game = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';
  const { B, ST, RC, EV } = deps;

  const HERO = 'HERO';
  const DEFAULT_SETUP = Object.freeze({
    players: 9, heroStackBB: 40, botStackBB: 40, smallBlind: 50, bigBlind: 100, bbAnte: 100, seed: null,
  });

  function botId(k) { return 'BOT' + k; }
  function displayName(id) { return id === HERO ? 'Você' : 'Bot ' + id.slice(3); }

  /** Valida e normaliza a configuração da mesa (valores da tela). */
  function normalizeSetup(s) {
    const o = Object.assign({}, DEFAULT_SETUP, s || {});
    const int = (v, name, min, max) => {
      const x = Number(v);
      if (!Number.isInteger(x) || x < min || x > max) throw new Error(`${name}: use um inteiro entre ${min} e ${max}`);
      return x;
    };
    o.players = int(o.players, 'Jogadores', 2, 9);
    o.bigBlind = int(o.bigBlind, 'Big blind', 2, 1e6);
    o.smallBlind = int(o.smallBlind, 'Small blind', 1, o.bigBlind);
    o.bbAnte = int(o.bbAnte, 'BB ante', 0, 1e6);
    o.heroStackBB = Number(o.heroStackBB); o.botStackBB = Number(o.botStackBB);
    for (const [k, n] of [['heroStackBB', 'Seu stack'], ['botStackBB', 'Stack dos bots']]) {
      if (!Number.isFinite(o[k]) || o[k] < 1 || o[k] > 1000) throw new Error(`${n}: use um valor entre 1 e 1000 BB`);
    }
    if (o.seed === '' || o.seed === undefined) o.seed = null;
    if (o.seed !== null) o.seed = int(o.seed, 'Semente', 0, 4294967295);
    return o;
  }

  /**
   * Configuração do motor para a mão número handNo (0, 1, 2…). O herói fica no assento 1;
   * o botão anda um assento por mão. Cada mão é independente: os stacks voltam aos valores configurados.
   */
  function handConfig(setup, handNo, opts) {
    const s = normalizeSetup(setup);
    const n = s.players;
    const chips = bbs => Math.max(1, Math.round(bbs * s.bigBlind));
    const players = [];
    for (let i = 0; i < n; i++) {
      const id = i === 0 ? HERO : botId(i);
      players.push({ id, seat: i + 1, stack: i === 0 ? chips(s.heroStackBB) : chips(s.botStackBB) });
    }
    if (opts && opts.stacks) opts.stacks.forEach((st, i) => { players[i].stack = st; });
    const cfg = {
      players,
      buttonSeat: ((handNo % n) + n) % n + 1,
      smallBlind: s.smallBlind, bigBlind: s.bigBlind,
      handId: 'PA-v01-' + (opts && opts.stamp ? opts.stamp : Date.now()) + '-' + (handNo + 1),
    };
    if (s.bbAnte > 0) { cfg.ante = s.bbAnte; cfg.anteType = 'bbAnte'; }
    if (opts && opts.order) cfg.deck = { order: opts.order };
    else if (s.seed !== null) cfg.deck = { seed: (s.seed + handNo) >>> 0 };
    return cfg;
  }

  function newHand(setup, handNo, opts) { return B.createHand(handConfig(setup, handNo, opts)); }

  // ------------------------------------------------------------------ bots simples (NÃO estratégicos)
  // Heurísticas fixas e grosseiras, só para a mão andar. Não representam estratégia correta.

  const rankOf = c => c >> 2, suitOf = c => c & 3;

  /** Força pré-flop aproximada em 0..1 (escala própria, sem base teórica). */
  function preflopScore(hole) {
    const [a, b] = [rankOf(hole[0]), rankOf(hole[1])].sort((x, y) => y - x);
    if (a === b) return 0.5 + a / 24;
    let s = (a + b) / 24 * 0.6;
    if (suitOf(hole[0]) === suitOf(hole[1])) s += 0.05;
    if (a - b <= 2) s += 0.04;
    if (a === 12) s += 0.1;
    return s;
  }

  /** Classe pós-flop: 3 forte, 2 média-forte, 1 média, 0 fraca (ignora draws). */
  function postflopClass(hole, board) {
    const cat = EV.categoryOf(EV.evaluate(hole.concat(board)));
    const boardRanks = board.map(rankOf);
    const counts = {}; boardRanks.forEach(r => { counts[r] = (counts[r] || 0) + 1; });
    const boardMax = Math.max(...Object.values(counts));
    const boardCat = boardMax >= 3 ? 3 : boardMax === 2 ? (Object.values(counts).filter(v => v === 2).length >= 2 ? 2 : 1) : 0;
    if (cat >= 2 && cat > boardCat) return 3;
    if (cat === 1 && boardCat === 0) {
      const hr = hole.map(rankOf);
      const pairRank = hr[0] === hr[1] ? hr[0] : hr.find(r => boardRanks.includes(r));
      if (pairRank === undefined) return 0;
      return pairRank >= Math.max(...boardRanks) ? 2 : 1;
    }
    return 0;
  }

  /** Converte uma intenção numa ação que o motor aceita, usando só as opções de legalActions. */
  function legalize(o, want, to) {
    const A = o.actions, id = o.playerId;
    if (want === 'aggr') {
      const g = A.bet || A.raise;
      if (g) {
        let t = g.allInOnly ? g.max : Math.max(g.min, Math.min(g.max, Math.round(to)));
        return { playerId: id, type: g.type, to: t };
      }
      want = 'call';
    }
    if (want === 'call') return A.call ? { playerId: id, type: 'call' } : { playerId: id, type: 'check' };
    if (want === 'fold') return A.check ? { playerId: id, type: 'check' } : { playerId: id, type: 'fold' };
    return A.check ? { playerId: id, type: 'check' } : { playerId: id, type: 'fold' };
  }

  function botAction(state, rand) {
    const r = rand || Math.random;
    const o = B.legalActions(state);
    if (!o) throw new Error('nenhuma ação pendente');
    const p = state.players.find(q => q.id === o.playerId);
    const bb = state.config.bigBlind;
    const pot = B.getPot(state);
    const C = o.currentBet;
    const stackTotal = p.stack + p.streetCommitted;

    if (state.street === 'preflop') {
      const sc = preflopScore(p.holeCards);
      const short = stackTotal <= 12 * bb;
      const unopened = C <= bb;
      if (short) {
        if (sc >= 0.55 || (unopened && sc >= 0.45 && r() < 0.5)) return legalize(o, 'aggr', o.maxTo);
        if (o.actions.check) return legalize(o, 'check');
        return legalize(o, sc >= 0.5 && o.toCall <= 2 * bb ? 'call' : 'fold');
      }
      if (unopened) {
        if (sc >= 0.5 || (sc >= 0.4 && r() < 0.35)) return legalize(o, 'aggr', 2.5 * bb);
        if (o.actions.check) return legalize(o, 'check');
        return legalize(o, sc >= 0.38 && r() < 0.3 ? 'call' : 'fold');
      }
      if (sc >= 0.75) return legalize(o, 'aggr', stackTotal <= 25 * bb ? o.maxTo : 3 * C);
      if (sc >= 0.6) return legalize(o, o.toCall <= 0.35 * stackTotal ? 'call' : 'fold');
      if (sc >= 0.5) return legalize(o, o.toCall <= Math.min(4 * bb, 0.15 * stackTotal) ? 'call' : 'fold');
      return legalize(o, 'fold');
    }

    const cls = postflopClass(p.holeCards, state.board);
    const facing = o.toCall > 0;
    if (!facing) {
      if (cls === 3) return legalize(o, 'aggr', Math.max(bb, Math.round(pot * 0.66)));
      if (cls === 2 && r() < 0.6) return legalize(o, 'aggr', Math.max(bb, Math.round(pot * 0.5)));
      if (cls <= 1 && r() < 0.12) return legalize(o, 'aggr', Math.max(bb, Math.round(pot * 0.5)));
      return legalize(o, 'check');
    }
    if (cls === 3) return r() < 0.4 ? legalize(o, 'aggr', 3 * C) : legalize(o, 'call');
    if (cls === 2) return legalize(o, o.toCall <= 0.75 * pot ? 'call' : 'fold');
    if (cls === 1) return legalize(o, o.toCall <= 0.35 * pot ? 'call' : 'fold');
    return legalize(o, 'fold');
  }

  // ------------------------------------------------------------------ fim da mão

  /** Liquida a mão (motor) e gera o registro canônico exportável. */
  function finish(state) {
    if (state.phase !== 'handOver') throw new Error('a mão ainda não terminou');
    const settlement = ST.settleHand(state);
    const record = RC.recordFromState(state);
    const text = RC.serializeRecord(record);
    return { settlement, record, text };
  }

  // ------------------------------------------------------------------ resumo compacto da mão (para a sessão)
  // Gerado só a partir do log do motor e da liquidação; valores em BB com 1 casa decimal.
  const RK = '23456789TJQKA', ST4 = 'cdhs';
  const cardStr = c => RK[c >> 2] + ST4[c & 3];
  const STREET_NAME = { preflop: 'Pré-flop', flop: 'Flop', turn: 'Turn', river: 'River' };

  function handSummary(state, settlement, handNo) {
    const bb = state.config.bigBlind;
    const f = x => { const v = Math.round(x / bb * 10) / 10; return String(v).replace('.', ','); };
    const pos = {}; state.players.forEach(p => { pos[p.id] = p.position + (p.id === HERO ? '*' : ''); });
    const hero = state.players.find(p => p.id === HERO);
    const L = [];
    const stacks = state.players.map(p => p.initialStack);
    const uniform = stacks.every(x => x === stacks[0]);
    L.push(`#${handNo + 1} [${state.id}] ${state.players.length} jog. · blinds ${state.config.smallBlind}/${bb}` +
      (state.config.ante ? ` · BB ante ${state.config.ante}` : '') + ` · Você (*) ${hero.position} ${f(hero.initialStack)} BB: ${hero.holeCards.map(cardStr).join(' ')}`);
    L.push('Stacks: ' + (uniform ? `todos ${f(stacks[0])} BB` :
      state.players.map(p => `${pos[p.id]} ${f(p.initialStack)}`).join(' · ')));
    let pot = 0, cur = null, acts = [];
    const flush = () => { if (cur) L.push(cur + ': ' + (acts.length ? acts.join(', ') : '(sem ações)')); acts = []; };
    for (const e of state.log) {
      if (e.type === 'post') { pot += e.amount; if (e.allIn) acts.push(`${pos[e.player]} posta ${f(e.amount)} all-in`); }
      else if (e.type === 'action') {
        if (cur === null) cur = STREET_NAME.preflop;
        pot += e.amount || 0;
        const a = e.action === 'fold' ? 'fold' : e.action === 'check' ? 'check' : e.action === 'call' ? `call ${f(e.amount)}` :
          `${e.action} ${f(e.to)}`;
        acts.push(`${pos[e.player]} ${a}${e.allIn ? ' (all-in)' : ''}`);
      } else if (e.type === 'street') {
        if (cur === null) cur = STREET_NAME.preflop;
        flush();
        cur = `${STREET_NAME[e.street]} (pote ${f(pot)}) ${e.board.map(cardStr).join(' ')}`;
      }
    }
    if (cur === null) cur = STREET_NAME.preflop;
    flush();
    const r = settlement;
    const res = [];
    if (r.reason === 'showdown' && r.hands) res.push('Mostram: ' + r.hands.map(h => `${pos[h.id]} ${h.holeCards.map(cardStr).join(' ')} (${h.description})`).join('; '));
    r.pots.forEach((p, k) => res.push(`${k === 0 ? 'Pote principal' : 'Lateral ' + k} ${f(p.amount)} → ${p.winners.map(w => pos[w]).join(' e ')}`));
    r.uncalled.forEach(u => res.push(`devolvido a ${pos[u.playerId]} ${f(u.amount)}`));
    L.push('Resultado: ' + res.join(' · ') + ` · Você ${r.net[HERO] > 0 ? '+' : ''}${f(r.net[HERO])} BB`);
    return L.join('\n');
  }

  function sessionText(summaries, meta) {
    const head = `SESSÃO Poker Academy v0.1.3 · ${meta && meta.date ? meta.date : ''} · ${summaries.length} mãos` +
      ' · bots NÃO estratégicos · valores em BB · * = você\n' +
      'Posições pelo motor; raise/bet = valor total "para" na rua; call = valor adicionado.';
    return head + '\n\n' + summaries.join('\n\n') + '\n';
  }

  return Object.freeze({
    HERO, DEFAULT_SETUP, displayName, normalizeSetup, handConfig, newHand,
    preflopScore, postflopClass, legalize, botAction, finish, handSummary, sessionText,
  });
});
