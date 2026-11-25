'use strict';
// Partidas inteiras só com bots (o herói também joga com a heurística do bot) pelo mesmo caminho do app:
// motor → finish (liquidação + registro) → replay.verifyRecord. Confere conservação de fichas e o replay.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const SRC = path.join(__dirname, '..', '..', 'engine', 'src');
const G = require(path.join(__dirname, '..', '..', 'simulador-v01', 'controller.js'));
const B = require(path.join(SRC, 'betting.js'));
const RP = require(path.join(SRC, 'replay.js'));
const RC = require(path.join(SRC, 'record.js'));
const { rngFrom } = (() => {
  // PRNG simples e determinístico só para as escolhas aleatórias dos bots no teste.
  let s = 12345;
  return { rngFrom: () => () => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; } };
})();

function playHand(setup, handNo, rand) {
  let st = G.newHand(setup, handNo, { stamp: 'teste' });
  let k = 0;
  while (st.phase !== 'handOver') {
    assert.ok(k++ < 500, 'mão sem fim');
    st = B.applyAction(st, G.botAction(st, rand));
  }
  return { st, done: G.finish(st) };
}

const SETUPS = [
  { players: 9, heroStackBB: 40, botStackBB: 40, smallBlind: 50, bigBlind: 100, bbAnte: 100, seed: 1 },
  { players: 6, heroStackBB: 10, botStackBB: 25, smallBlind: 50, bigBlind: 100, bbAnte: 100, seed: 777 },
  { players: 2, heroStackBB: 8, botStackBB: 100, smallBlind: 25, bigBlind: 50, bbAnte: 0, seed: 4242 },
  { players: 9, heroStackBB: 3, botStackBB: 5, smallBlind: 100, bigBlind: 200, bbAnte: 200, seed: 9 },
];

for (const setup of SETUPS) {
  test(`${setup.players} jogadores, stacks ${setup.heroStackBB}/${setup.botStackBB} BB: 60 mãos conservam fichas e passam no replay`, () => {
    const rand = rngFrom();
    let showdowns = 0;
    for (let h = 0; h < 60; h++) {
      const { st, done } = playHand(setup, h, rand);
      const before = st.players.reduce((a, p) => a + p.initialStack, 0);
      const after = Object.values(done.settlement.finalStacks).reduce((a, x) => a + x, 0);
      assert.strictEqual(after, before, 'fichas criadas ou perdidas');
      assert.strictEqual(Object.values(done.settlement.net).reduce((a, x) => a + x, 0), 0);
      const v = RP.verifyRecord(RC.parseRecord(done.text));
      assert.strictEqual(v.ok, true, 'replay não confirmou a mão ' + st.id);
      const summary = G.handSummary(st, done.settlement, h);
      assert.match(summary, /Resultado: /);
      if (done.settlement.reason === 'showdown') showdowns++;
    }
    assert.ok(showdowns > 0, 'nenhum showdown nas 60 mãos (teste fraco)');
  });
}
