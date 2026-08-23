# CODEX HANDOFF PROMPT — MALIGN-AI v0.1

Estamos implementando **MALIGN-AI**, una aplicación web multijugador para el serious game Malign.

## Tu misión inmediata

Implementa **solamente PR-0 — Repository Bootstrap** según:

- `MALIGN_AI_REPOSITORY_BOOTSTRAP_SPEC_v0.1.md`
- `MALIGN_AI_CODEX_IMPLEMENTATION_PLAN_v0.1.md`

Antes de modificar archivos, lee en orden el manifiesto y los documentos listados en el Implementation Plan.

## Reglas no negociables

1. Los Gamebooks/reglas formalizadas y `MALIGN_AI_DECISIONS_v0.3.md` son la autoridad.
2. **No inventes ni reconcilies reglas.**
3. **No modifiques el test oracle para acomodar código.**
4. La IA NO forma parte del Game Engine determinístico.
5. La aplicación será web multijugador: 5 jugadores + 1 facilitador en la misma sesión.
6. El backend es autoritativo.
7. La información privada/secreta se filtra server-side.
8. Arquitectura: modular monolith TypeScript en monorepo.
9. `apps/web` y `apps/server` separados.
10. Domain/Game Engine no pueden depender de React, Next.js, PostgreSQL/Supabase SDK, WebSocket concreto u OpenAI.
11. No crees microservicios.
12. No implementes todavía PostgreSQL productivo, WebSocket productivo, UI final ni AI/RAG.

## PR-0 exacto

Crea:

- monorepo/workspaces;
- `apps/web`;
- `apps/server`;
- packages definidos en Bootstrap Spec;
- TypeScript strict;
- lint/format;
- test runner;
- CI;
- docs versionadas;
- interfaces/ports mínimos para `RandomProvider`, `Clock` y repositories;
- adapters in-memory skeleton;
- README y `.env.example`.

No implementes todavía las reglas de PR-1.

## Antes de finalizar

Ejecuta:

- install;
- typecheck;
- lint;
- tests;
- build donde aplique.

Reporta:

1. resumen de cambios;
2. árbol de repositorio;
3. comandos ejecutados y resultados;
4. cualquier desviación;
5. cualquier `IMPLEMENTATION_QUESTION`.

**Detente al terminar PR-0 y espera revisión.**
