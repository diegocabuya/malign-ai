# MALIGN-AI — PROJECT STATE v0.4

**Fecha:** 2026-08-23  
**Fase actual:** M1-0 IMPLEMENTED / PENDING REVIEW  
**Gate arquitectónico:** APPROVED  
**Transición:** Este contenido sustituye el estado v0.3. El nombre físico se conserva para mantener estables las referencias documentales existentes.

## Estado de entregas

| Entrega | Estado |
|---|---|
| PR-0 — Repository Bootstrap | **APPROVED** |
| IQ-PR0-001 | **RESOLVED mediante DEC-060** |
| PR-1 — Rule Kernel | **IMPLEMENTED AND APPROVED** |
| M0A Rule Kernel | **15/15 PASS, 0 skips** |
| Suite reportada al cierre de PR-1 | **21/21 PASS** |
| PR-2 — Command Safety + Campaign Slice | **IMPLEMENTED AND APPROVED** |
| M0B/M0C | **20/20 PASS, 0 skips** |
| M0 acumulado | **35/35 IDs seleccionados PASS, 0 skips** |
| Regresiones PR2-R01…R06 | **14/14 PASS, 0 skips** |
| Suite reportada tras corrección PR-2 | **55/55 PASS** |
| M0 — Repository + Rule Kernel + Command Safety/Campaign Slice | **IMPLEMENTED AND APPROVED** |
| M1 planning gate | **AMENDED AND APPROVED mediante DEC-064/065/066** |
| M1 test baseline | **49 oracle v0.1 + 38 addendum = 87 casos únicos / 94 ejecuciones de gate** |
| IQ-M1-001…003 | **RESOLVED mediante DEC-065** |
| PTD-M1-001…005 | **APPROVED mediante DEC-065** |
| M1-0 — GameSession/Participants/Seats/Setup/In-Memory State | **IMPLEMENTED / PENDING REVIEW** |
| M1-0 owner gate | **25/25 PASS, 0 skips, 0 todo** |
| M1-0 pruebas complementarias | **3/3 PASS** |
| Regresión M0 durante M1-0 | **55/55 PASS** |
| Suite completa reportada M1-0 | **83/83 PASS, 0 skips, 0 todo** |
| M1-1 | **NOT AUTHORIZED** |
| M1-2 | **NOT AUTHORIZED** |
| M1-3 | **NOT AUTHORIZED** |

PR-1 fue aprobado técnicamente contra el commit `69ded64d912fc0231b82046fecad024baf8ec67e`. No requiere correcciones de código.

## Baseline vigente

- aplicación web multijugador para 5 jugadores + 1 facilitador;
- backend autoritativo;
- modular monolith TypeScript en monorepo;
- `apps/web` y `apps/server` separados;
- Game Engine puro e independiente de frameworks;
- Ports & Adapters;
- proyecciones y filtrado de secretos server-side;
- Rule Kernel determinístico y test-first;
- IA fuera del Game Engine.

El Product Owner mantiene aprobadas `ARC-01` a `ARC-12`. Las decisiones canónicas están en `MALIGN_AI_DECISIONS_v0.3.md`.

## Estado de componentes diferidos

| Componente | Estado |
|---|---|
| PostgreSQL productivo | **NOT STARTED / NOT AUTHORIZED** |
| Transactional Outbox productivo | **NOT STARTED / NOT AUTHORIZED** |
| Realtime productivo | **NOT STARTED / NOT AUTHORIZED** |
| Autenticación productiva | **NOT STARTED / NOT AUTHORIZED** |
| UI final | **NOT STARTED / NOT AUTHORIZED** |
| OpenAI/RAG | **NOT STARTED / NOT AUTHORIZED** |
| Reaction/Veto | **NOT STARTED / NOT AUTHORIZED** |

## Implementación M1-0 pendiente de revisión

M1-0 implementa el aggregate autoritativo `Game` con `GameParticipant`, `PlayerSeat`, `GameCountry`, setup BASE_2025 versionado y Strategy inicial in-memory. `GameSession` agrupa membership/conexión en la capa de aplicación y construye `ActorContext` desde bindings de sesión verificados; no constituye una segunda autoridad de reglas.

El lifecycle implementado se detiene exactamente en `INITIATIVE_STAGE` después de cinco locks Strategy válidos. La suite reporta 25/25 casos owner, 3/3 pruebas complementarias, regresión M0 55/55 y total 83/83, con 0 skips y 0 todo. Este resultado queda **PENDING REVIEW**; no equivale a aprobación técnica de M1-0.

No se iniciaron iniciativa/rerolls, maintenance, planificación oculta, scheduler, adjudicación M1, ledgers/trace/replay, realtime/reconnect, persistencia productiva, UI final, auth productiva, IA ni Reaction/Veto.

## Cierre de implementación PR-2

PR-2 implementa exclusivamente command safety in-memory, action-plan lock y el vertical slice mínimo de construcción, modificación y elegibilidad de campañas aprobado mediante `DEC-062`. No se incorporaron PostgreSQL, transporte productivo, UI, AI ni reglas fuera de los 20 casos M0B/M0C.

La corrección posterior al gate `CHANGES REQUIRED` endurece phase enforcement, autoridad de activación extra, invariantes del action-plan payload, compatibilidad de slots, identidades de campañas/cartas y el boundary de juego/actor. Los hallazgos PR2-R01…R06 quedaron cerrados en el commit `0f4195e4f8f72d73eb277983e01fdb2472f5602d`; PR-2 y M0 están aprobados.

## Próximo gate

Los documentos `MALIGN_AI_M1_VERTICAL_SLICE_IMPLEMENTATION_SPEC_v0.1.md` y `MALIGN_AI_M1_TEST_GATE_v0.1.md` fueron enmendados conforme a `DEC-065`, y el planning gate quedó aprobado mediante `DEC-066`. `MALIGN_AI_GAME_ENGINE_TEST_ACCEPTANCE_M1_ADDENDUM_v0.1.md` fija 38 IDs canónicos sin modificar el oracle v0.1.

El próximo paso es la revisión externa de M1-0. M1-1, M1-2 y M1-3 permanecen **NOT AUTHORIZED** y no pueden comenzar sin autorización expresa posterior.

## Continuidad documental

Las especificaciones, decisiones y estados versionados bajo `docs/` son la fuente de verdad del desarrollo. M1-0 preserva intactos el oracle v0.1 y el addendum M1 v0.1, y no altera las reglas aprobadas ni los package boundaries.
