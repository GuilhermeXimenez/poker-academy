# Poker Academy — instruções para o Claude Code

App de treino de pôquer (torneios MTT) do Guilherme. Leia isto antes de qualquer tarefa.

## Quem é o usuário
- Guilherme, nível intermediário iniciante, foco em torneios MTT 9-max (PokerStars e GGPoker), buy-ins até US$ 10.
- Fala português. Explique em português e introduza aos poucos os termos técnicos em inglês.
- Vai jogar a dinheiro: a estratégia ensinada precisa ser confiável.
- Não programa. Não quer excesso de auditorias e planejamento: prefira entregas usáveis, verificadas por testes automáticos, com resumo curto.

## Regras inegociáveis
1. Precisão técnica acima de tudo. Nunca invente resultados de solver, frequências ou probabilidades.
2. Todo dado estratégico mostrado no app indica a origem: **Solver** (com premissas: posições, stacks, ranges, tamanhos), **Cálculo exato** (ex.: equilíbrio push/fold) ou **Aproximação** (selo visível).
3. Regras do jogo (cartas, legalidade, potes, side pots, avaliação, liquidação) só pelo motor em `engine/src`, nunca por texto gerado.
4. No treino, a solução só aparece depois da resposta. Avaliar a decisão, não o resultado da mão.
5. Custo zero: só ferramentas e serviços gratuitos.

## Plataforma (decidido em 24/11/2026)
- Web app instalável (PWA) para o Chrome do Android (Samsung S23 FE): ícone na tela inicial, tela cheia, funciona offline. Sem Play Store.
- Hospedagem gratuita no GitHub Pages deste repositório.
- Fontes de estratégia (todas gratuitas):
  - Push/fold com stack curto (até ~15–20 BB): equilíbrio calculado pelo próprio app (chip EV, depois ICM).
  - Pós-flop heads-up: biblioteca pré-calculada com o TexasSolver no Mac do usuário (`~/Documents/PokerSolver/solver/console_solver -i <spot.txt> -r ./resources`). O celular só lê os resultados.
  - Pré-flop com stack fundo e potes multiway: sem fonte gratuita verificada → selo "Aproximação".
  - GTO Wizard gratuito apenas como conferência manual pelo usuário (sem API, sem extração de dados).

## Estrutura do repositório
- `engine/src/` — motor do jogo em JavaScript (UMD: funciona no Node e no navegador).
  - Congelados (não alterar; hashes em `engineVersion.js`): `cards`, `rng`, `positions`, `evaluator`, `betting`, `pots`, `showdown`, `settlement`.
  - Etapa 4: `engineVersion`, `record` (registro canônico de mãos), `replay` (replay e verificação).
  - Conferir integridade: `cd engine/src && sha256sum *.js` e comparar com `engineVersion.js` e `simulador-v01/build.js`.
- `app/` — PWA (passo 1): `template.html` (mesa adaptada ao celular + histórico), `storage.js` (IndexedDB), `manifest.webmanifest`, `sw.template.js` (offline), `icons/`, `build.js` → `dist/` (não versionado). Reusa `simulador-v01/controller.js` sem alterar. Testes: `npm test` (CI) e `npm run test:e2e` (Playwright, local). Deploy: `.github/workflows/pages.yml` a cada push na `main`.
- `engine/docs/PENDENCIAS.md` — defeitos conhecidos P1–P3 (só afetam configurações inválidas; não corrigir sem autorização).
- `simulador-v01/` — mesa v0.1.3 (HTML + controller com bots simples, NÃO estratégicos). `node build.js` gera `mesa-v0.1.html`. Serve de base visual para o app.
- Os testes originais do motor (unitários, propriedades, oráculos, mutação, fuzz, exaustivo de 7 cartas) ainda estão no projeto "POKER" do claude.ai e não foram trazidos. Ao mexer no motor, escreva testes novos com `node --test`.

## Progresso do aluno
- Aula 1 (RFI, open raise por posição) concluída em 10/11/2026: 19/20 na avaliação, 8/8 no re-teste.
- Fortes: disciplina de fold, open de 2 BB, matemática do open, mãos claras de CO/BTN.
- Vigiar: opens largos em posição inicial com mãos dominadas (KJo, QJo, ases offsuit fracos, Q8s, 87s). Regra: no UTG, ás offsuit só a partir de AJ/AQ. Faixa de BTN pouco testada.
- Próxima aula a escolher: enfrentar um open (fold/call/3-bet) ou pós-flop com mãos médias.

## Ordem de construção
1. PWA: levar o motor e a mesa para o app no celular, com histórico salvo no aparelho (IndexedDB) e exportação. — Feito em 25/11/2026 (`app/`); falta publicar (repositório privado: Pages gratuito exige repositório público).
2. Trainer de push/fold com equilíbrio calculado (chip EV primeiro, depois ICM), testado contra valores conhecidos.
3. Biblioteca pós-flop: script que roda o TexasSolver no Mac e exporta os resultados para o app (exige o Mac).
4. Trilha de aulas, revisão de erros e acompanhamento da evolução.
