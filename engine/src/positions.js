/*
 * Poker Academy — positions.js
 * Papéis (botão, SB, BB), ordem de ação e rótulos de posição para 2 a 9 jogadores.
 *
 * Convenção: os jogadores são informados em ordem de assento no sentido horário.
 * Todas as funções trabalham com ÍNDICES desse array.
 *
 * Rótulos (cosméticos; o motor usa apenas os papéis):
 *   2: BTN (é também o SB), BB
 *   3+: BTN, SB, BB, depois UTG; as demais posições são nomeadas a partir do
 *       botão para trás: CO, HJ, LJ, MP, UTG+1.
 *   9 jogadores: SB, BB, UTG, UTG+1, MP, LJ, HJ, CO, BTN.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.PA = root.PA || {}).positions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const BACKWARD_LABELS = ['CO', 'HJ', 'LJ', 'MP', 'UTG+1'];

  /** Índice i deslocado k assentos no sentido horário numa mesa de n jogadores. */
  function offset(i, k, n) { return ((i + k) % n + n) % n; }

  /**
   * R1/R2: papéis da mão.
   * Heads-up (TDA 36-C): o botão é o small blind; o outro jogador é o big blind.
   */
  function roles(n, buttonIndex) {
    if (!Number.isInteger(n) || n < 2 || n > 9) throw new RangeError('Número de jogadores deve ser 2..9');
    if (!Number.isInteger(buttonIndex) || buttonIndex < 0 || buttonIndex >= n) throw new RangeError('Índice do botão inválido');
    if (n === 2) {
      return {
        button: buttonIndex, sb: buttonIndex, bb: offset(buttonIndex, 1, n),
        preflopFirst: buttonIndex,               // HU: botão age primeiro no pré-flop
        postflopFirst: offset(buttonIndex, 1, n), // HU: BB age primeiro no pós-flop
        dealFirst: offset(buttonIndex, 1, n),     // botão recebe a última carta
      };
    }
    const sb = offset(buttonIndex, 1, n), bb = offset(buttonIndex, 2, n);
    return {
      button: buttonIndex, sb, bb,
      preflopFirst: offset(bb, 1, n),       // à esquerda do BB (com 3 jogadores, o BTN)
      postflopFirst: offset(buttonIndex, 1, n),
      dealFirst: offset(buttonIndex, 1, n),
    };
  }

  function labels(n, buttonIndex) {
    const r = roles(n, buttonIndex);
    const out = new Array(n);
    if (n === 2) { out[r.button] = 'BTN'; out[r.bb] = 'BB'; return out; }
    out[r.button] = 'BTN'; out[r.sb] = 'SB'; out[r.bb] = 'BB';
    const k = n - 3;                     // assentos entre o BB e o botão
    if (k >= 1) out[offset(r.bb, 1, n)] = 'UTG';
    for (let j = 1; j <= k - 1; j++) out[offset(r.button, -j, n)] = BACKWARD_LABELS[j - 1];
    return out;
  }

  return Object.freeze({ offset, roles, labels });
});
