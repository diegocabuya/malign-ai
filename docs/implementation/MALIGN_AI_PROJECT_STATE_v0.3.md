# MALIGN-AI — PROJECT STATE v0.4

**Fecha:** 2026-08-24  
**Fase actual:** M1-1 IMPLEMENTED AND APPROVED  
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
| M1-0 — GameSession/Participants/Seats/Setup/In-Memory State | **IMPLEMENTED AND APPROVED mediante DEC-067** |
| Commit final M1-0 | `bb0771513263660bb59f281029771753cb7e8c35` |
| M10-R01…R06 | **CLOSED** |
| M1-0 owner gate | **25/25 PASS, 0 skips, 0 todo** |
| Regresiones M10-R01…R06 | **11/11 PASS, 0 skips, 0 todo** |
| M1-0 pruebas complementarias | **3/3 PASS** |
| Regresión M0 durante M1-0 | **55/55 PASS** |
| Suite acumulada al cierre de M1-0 | **94/94 PASS, 0 skips, 0 todo** |
| IMPLEMENTATION_QUESTION de M1-0 | **Ninguna pendiente** |
| M1-1 | **IMPLEMENTED AND APPROVED mediante DEC-069** |
| Commit final M1-1 | `a1c6f2646ad8a8c7d0ca109b623c846eb5f10b04` |
| M11-R01…R04 | **CLOSED** |
| M1-1 owner gate | **26/26 PASS, 0 skips, 0 todo** |
| M1-1 oracle v0.1 | **17/17 PASS** |
| M1-1 addendum v0.1 | **9/9 PASS** |
| Regresiones M11-R01…R04 | **4/4 PASS, 0 skips, 0 todo** |
| M1-0 preservado durante cierre M1-1 | **39/39 PASS** |
| M0 preservado durante cierre M1-1 | **55/55 PASS** |
| Suite previa preservada | **120/120 PASS** |
| Suite acumulada al cierre de M1-1 | **124/124 PASS, 0 skips, 0 todo** |
| IMPLEMENTATION_QUESTION de M1-1 | **Ninguna pendiente** |
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
| IA / OpenAI / RAG | **NOT STARTED / NOT AUTHORIZED** |
| Reaction/Veto | **NOT STARTED / NOT AUTHORIZED** |

## Cierre formal de M1-0

M1-0 implementa el aggregate autoritativo `Game` con `GameParticipant`, `PlayerSeat`, `GameCountry`, setup BASE_2025 versionado y Strategy inicial in-memory. `GameSession` agrupa membership/conexión en la capa de aplicación y construye `ActorContext` desde bindings de sesión verificados; no constituye una segunda autoridad de reglas.

La corrección acotada M10-R01…R06 implementó el double-submit canónico de Strategy para `GE-CORE-010`, phase freeze completo bajo `PAUSED`, el envelope mínimo de eventos M1-0, fingerprints JSON deterministas, cierre de los leaks de raw-state/game-enumeration y validación runtime estricta de payloads. Los seis hallazgos quedan **CLOSED** en el commit final `bb0771513263660bb59f281029771753cb7e8c35`.

El lifecycle implementado se detiene exactamente en `INITIATIVE_STAGE` después de cinco locks Strategy válidos. El cierre reporta 25/25 casos owner, 11/11 regresiones M10-R01…R06, 3/3 pruebas complementarias, M0 preservado 55/55 y total 94/94, con 0 skips y 0 todo. No queda ninguna `IMPLEMENTATION_QUESTION` pendiente para M1-0.

Mediante `DEC-067`, DEC-066 queda cumplida y M1-0 queda **IMPLEMENTED AND APPROVED**. No se requieren nuevas correcciones de código. `DEC-067` cierra exclusivamente M1-0 y no autoriza M1-1, M1-2 ni M1-3.

En el momento de su cierre, M1-0 no había iniciado iniciativa/rerolls, maintenance, planificación oculta, scheduler, adjudicación M1, ledgers/trace/replay, realtime/reconnect, persistencia productiva, UI final, auth productiva, IA ni Reaction/Veto. DEC-068 autorizó posteriormente sólo el slice M1-1 descrito a continuación.

## Cierre formal de M1-1

M1-1 extiende el mismo aggregate autoritativo de M1-0 con iniciativa digital determinística y rerolls exclusivos de empatados en el máximo, maintenance mínimo con descarte/fill-to-10/reshuffle e ingreso por país, planificación oculta server-side en el adapter in-memory, lock con compromiso y ledger mínimo de AP, y `AuthorizedProjection` diferenciada para owner, rival y facilitator. El boundary interno mínimo de reveal revela únicamente el slot actual sin ejecutar campañas ni convertirse en scheduler.

La corrección acotada M11-R01…R04 elimina la inferencia rival sobre drafts no bloqueados, registra de forma veraz la actoría `SYSTEM` del reveal interno, sustituye el helper tautológico de `NOT_EXECUTED` por un seam puro propiedad del Game Engine y hace transaccional el cursor RNG in-memory frente a exhaustion, valores fuera de rango, rechazos del reducer y fallos CAS. Las cuatro regresiones nuevas reportan **4/4 PASS**; `GE-PLAN-004` y `GE-M1-IPL-008` continúan dentro del owner gate y ejercitan código real del Engine.

El gate owner M1-1 reporta **17/17 IDs oracle v0.1 + 9/9 IDs addendum v0.1 = 26/26 PASS**. M0 permanece **55/55 PASS**; todo M1-0 permanece **39/39 PASS** (25 owner, 11 regresiones M10-R01…R06 y 3 complementarias); la suite previa permanece **120/120 PASS** y la suite acumulada con las cuatro regresiones queda en **124/124 PASS, 0 skips y 0 todo**. No existe `IMPLEMENTATION_QUESTION` pendiente para M1-1.

La revisión técnica aprobó el estado final de M1-1 contra el commit `a1c6f2646ad8a8c7d0ca109b623c846eb5f10b04`. Mediante `DEC-069`, DEC-068 queda cumplida, M11-R01…R04 quedan **CLOSED** y M1-1 queda **IMPLEMENTED AND APPROVED** sin nuevas correcciones de código.

DEC-069 cierra exclusivamente M1-1 y no autoriza trabajo posterior. M1-2 y M1-3 permanecen **NOT AUTHORIZED**. Scheduler completo, adjudicación de campañas, Reaction/Veto, PostgreSQL/outbox, realtime/WebSocket productivo, UI, autenticación productiva e IA/OpenAI/RAG permanecen **NOT STARTED / NOT AUTHORIZED**.

## Cierre de implementación PR-2

PR-2 implementa exclusivamente command safety in-memory, action-plan lock y el vertical slice mínimo de construcción, modificación y elegibilidad de campañas aprobado mediante `DEC-062`. No se incorporaron PostgreSQL, transporte productivo, UI, AI ni reglas fuera de los 20 casos M0B/M0C.

La corrección posterior al gate `CHANGES REQUIRED` endurece phase enforcement, autoridad de activación extra, invariantes del action-plan payload, compatibilidad de slots, identidades de campañas/cartas y el boundary de juego/actor. Los hallazgos PR2-R01…R06 quedaron cerrados en el commit `0f4195e4f8f72d73eb277983e01fdb2472f5602d`; PR-2 y M0 están aprobados.

## Próximo gate

Los documentos `MALIGN_AI_M1_VERTICAL_SLICE_IMPLEMENTATION_SPEC_v0.1.md` y `MALIGN_AI_M1_TEST_GATE_v0.1.md` fueron enmendados conforme a `DEC-065`, y el planning gate quedó aprobado mediante `DEC-066`. `MALIGN_AI_GAME_ENGINE_TEST_ACCEPTANCE_M1_ADDENDUM_v0.1.md` fija 38 IDs canónicos sin modificar el oracle v0.1.

M1-0 está formalmente cerrado mediante DEC-067 y M1-1 está formalmente cerrado mediante DEC-069. M1-2 y M1-3 permanecen **NOT AUTHORIZED** y no pueden comenzar sin autorización expresa posterior.

## Continuidad documental

Las especificaciones, decisiones y estados versionados bajo `docs/` son la fuente de verdad del desarrollo. El cierre formal de M1-1 preserva intactos el oracle v0.1 con blob SHA `8291b56e20b9fdf55b8c01c156b66cd641b52d92` y el addendum M1 v0.1 con blob SHA `a5e140eb55b442230110e8ae77d5763401db3117`, y no altera las reglas aprobadas ni los package boundaries.
