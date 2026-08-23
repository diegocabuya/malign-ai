# MALIGN-AI — PROJECT STATE v0.3

**Fecha:** 2026-08-22  
**Fase actual:** TRANSICIÓN FASE 2 DISEÑO -> IMPLEMENTACIÓN CONTROLADA  
**Código:** NO iniciado todavía  
**Gate arquitectónico:** APROBADO  
**Codex handoff:** READY

## Gate aprobado

El Product Owner aprobó expresamente `ARC-01` a `ARC-12`.

Baseline:

- aplicación web multijugador;
- 5 jugadores + facilitador;
- misma GameSession;
- backend autoritativo;
- realtime;
- modular monolith TypeScript;
- monorepo;
- `apps/web` + `apps/server`;
- Game Engine framework-agnostic;
- Next.js/React/TypeScript;
- PostgreSQL futuro;
- HTTP commands/queries;
- WebSocket realtime;
- game version/concurrency;
- transaction-per-command + outbox;
- Ports & Adapters;
- server-side projections;
- audit history;
- Rule Kernel/test-first;
- AI fuera del Game Engine.

Ver `MALIGN_AI_DECISIONS_v0.3.md`.

## Entregables de handoff creados

- `MALIGN_AI_REPOSITORY_BOOTSTRAP_SPEC_v0.1.md`
- `MALIGN_AI_CODEX_IMPLEMENTATION_PLAN_v0.1.md`
- `CODEX_HANDOFF_PROMPT_v0.1.md`
- `MALIGN_AI_CODEX_HANDOFF_MANIFEST_v0.1.md`
- paquete `.zip` de handoff.

## Primer milestone autorizado para Codex

**PR-0 — Repository Bootstrap exclusivamente.**

Al terminar PR-0, Codex debe detenerse para revisión antes de PR-1.

## Subset M0 seleccionado

35 tests P0:

- M0A Rule Kernel: 15
- M0B Command Safety: 10
- M0C Campaign Slice: 10

Los IDs exactos están en Bootstrap Spec / Implementation Plan.

## Siguiente acción del Product Owner

1. Crear un repositorio GitHub vacío llamado preferentemente `malign-ai`.
2. Abrir Codex sobre ese repositorio/workspace.
3. Proporcionarle el paquete de handoff o los documentos del paquete.
4. Pegar `CODEX_HANDOFF_PROMPT_v0.1.md`.
5. Autorizar **sólo PR-0 Bootstrap**.
6. Regresar con el resultado/diff/repo para revisión antes de PR-1.

## Aún NO autorizado

- PR-1 Rule Kernel, hasta que PR-0 sea revisado.
- PR-2.
- PostgreSQL productivo.
- multiplayer realtime productivo.
- UI final.
- OpenAI/RAG.
- hosting productivo.

## Continuidad

La conversación deja de ser la única fuente de verdad. El repositorio deberá incorporar las specs y decisiones aprobadas bajo `docs/`.
