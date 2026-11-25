# Pendências registradas (aguardando autorização)

Atualizado em 08/11/2026, na formalização da Etapa 3 (Contexto 09 v1.5, seção 8.3). Nenhuma pendência abaixo foi corrigida.

## P1 — betting.js: nomes de regra iguais a propriedades de Object.prototype

- **Status:** registrada em 08/11/2026 (revisão 3 do settlement). Mantida após a aprovação da revisão 3. NÃO corrigida: betting.js está congelado (Etapa 2; SHA-256 inalterado `f872caf5f19f44b77be6712932476c4b58c72b440a5c45760b6efbbb265db063`).
- **Defeito:** `normalizeConfig` valida o nome de cada regra com `k in RULE_VALUES` (linha 103). Esse operador
  também encontra propriedades herdadas; para `k = 'toString'` (ou `'constructor'`, `'valueOf'` etc.) a
  verificação passa e a linha 104 executa `RULE_VALUES[k].includes(...)` sobre uma função herdada.
- **Regra violada:** uma configuração inválida deve ser rejeitada com `EngineError('INVALID_CONFIG')`
  (contrato da Etapa 2); hoje produz um `TypeError` não tratado.
- **Cenário reproduzível:**
  ```js
  B.createHand({ players: [{ id: 'A', seat: 1, stack: 1000 }, { id: 'B', seat: 2, stack: 1000 }],
    buttonSeat: 1, smallBlind: 50, bigBlind: 100, deck: { seed: 1 }, rules: { toString: 1 } });
  // TypeError: RULE_VALUES[k].includes is not a function
  ```
- **Impacto:** só afeta configurações inválidas (nenhuma regra legítima tem esses nomes); a mão nunca é criada,
  portanto não há estado incorreto. O erro é apenas de tipo diferente do contratado.
- **Correção proposta (não aplicada):** `if (!Object.prototype.hasOwnProperty.call(RULE_VALUES, k))`, mais um
  teste com os 12 nomes de Object.prototype. Mesmo padrão já aplicado às opções de settlement.js.
- **Observação:** ids de jogador NÃO são afetados no betting.js (usa apenas `Set` para ids).

## P2 — settlement.js: validação individual dos eventos de ante (decisão pendente)

- **Status:** registrada em 08/11/2026. **Não é defeito do contrato aprovado:** a D10 (especificação aprovada, seção 6.2) exige apenas que `antePosted(p)` seja igual à **soma** dos eventos `{ type: 'post', kind: 'ante' }` do log; não exige que cada evento seja um inteiro positivo.
- **Comportamento atual:** um log adulterado com eventos 7 e −2 (soma 5) ou 2,5 e 2,5 (soma 5) é aceito, desde que a soma coincida com `antePosted`. O `betting.js` nunca gera esses eventos (descarta valores ≤ 0 e só posta inteiros), portanto o caso só ocorre com estado montado ou alterado fora do motor.
- **Decisão pendente:** se o usuário quiser fechar essa brecha, é uma regra nova (validar cada evento como inteiro positivo em E13), a ser especificada e autorizada antes de qualquer alteração em settlement.js (congelado em 08/11/2026).

## P3 — betting.js: semente inválida produz `RangeError` em vez de `INVALID_CONFIG`

- **Status:** registrada em 08/11/2026 por decisão do usuário (E4.0-7, especificação 4.0 da Etapa 4, seção 13). NÃO corrigida: betting.js está congelado (Etapa 2; SHA-256 inalterado `f872caf5f19f44b77be6712932476c4b58c72b440a5c45760b6efbbb265db063`).
- **Defeito:** `normalizeConfig` não valida `deck.seed`; repassa ao `rng.createSeededRng`, que lança `RangeError('Semente deve ser inteiro 0..2^32-1')`.
- **Regra violada:** configurações inválidas são rejeitadas com `EngineError('INVALID_CONFIG')` no restante de `normalizeConfig` (mesma classe da P1).
- **Cenário reproduzível:**
  ```js
  B.createHand({ players: [{ id: 'A', seat: 1, stack: 1000 }, { id: 'B', seat: 2, stack: 1000 }],
    buttonSeat: 1, smallBlind: 50, bigBlind: 100, deck: { seed: -1 } });
  // RangeError: Semente deve ser inteiro 0..2^32-1   (o mesmo com 4294967296, 1.5 e '7')
  ```
- **Impacto:** só configurações inválidas; nenhuma mão é criada e nenhum estado fica incorreto. Não afeta a Etapa 4: `record.js` valida a semente antes de chamar o motor.
