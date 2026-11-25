# Poker Academy

App de treino de pôquer para torneios MTT, feito para rodar no celular (web app instalável).

- `app/` — o app instalável (PWA): `node app/build.js` gera `dist/`; publicado no GitHub Pages pela Action `.github/workflows/pages.yml`.
- `engine/` — motor do jogo (regras, potes, showdown, liquidação, registro e replay de mãos).
- `simulador-v01/` — mesa jogável v0.1.3, base visual do app.
- `CLAUDE.md` — contexto e regras do projeto para o Claude Code.

## Comandos
- `npm test` — testes do build e de partidas completas (conservação de fichas + replay do motor).
- `npm run test:e2e` — teste no navegador com tela de celular (instalação, offline, histórico, exportação). Precisa do Playwright.
- `node app/build.js` — gera o app em `dist/`.
