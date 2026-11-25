/*
 * Poker Academy — engineVersion.js  (Etapa 4, subetapa 4.1)
 * Identificação do motor que gerou um registro de mão (especificação 4.0, D-E4-4 e seção 6.1).
 *
 * ENGINE_MODULES: SHA-256 dos 8 módulos congelados, idênticos à seção 8.1 do Contexto 09 v1.5.
 * A tabela é mantida à mão; o teste test/engineVersion.test.js recalcula os hashes dos arquivos
 * (somente no Node) e falha se a tabela ficar desatualizada.
 * Sem dependências; sem APIs exclusivas do Node.
 */
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const api = factory();
  if (isNode) module.exports = api;
  else (root.PA = root.PA || {}).engineVersion = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ENGINE_MODULES = Object.freeze({
    'betting.js': 'f872caf5f19f44b77be6712932476c4b58c72b440a5c45760b6efbbb265db063',
    'cards.js': '1e91ba908f9c8ff073f11af20fdff3cc13746e1bf6c0218076786e348a78fd31',
    'evaluator.js': '1c1c834a9147c893d27cac9a00a7578ae860376c77abfb77efda5cb40aaa6ff1',
    'positions.js': '4323148778a67ea35d233cb1c4e60fe87763a32f23f9f8135befb2013e25938e',
    'pots.js': 'b614fe74d2886d982378874a8691d3cde1ec6b6b93a7810ccf1c928ea9118644',
    'rng.js': 'eb533dc4cc42c7b39cf09e444982f151a076a6eb570675ddfd91c4e3e3de6c60',
    'settlement.js': '2d9c62d39a7225ba2d4cbf80f3396e22132563b841500727f850d4ee99c380be',
    'showdown.js': 'cb9ae7f2d126f8d29d52982150840fe6c0da5dff37eadae84fbad28b735feed1',
  });

  return Object.freeze({ ENGINE_MODULES });
});
