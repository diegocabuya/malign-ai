# MALIGN-AI — PROJECT STATE v0.4

**Fecha:** 2026-08-24  
**Fase actual:** M1-2 CORRECTION IMPLEMENTED / PENDING REVIEW
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
| M1-2 | **CORRECTION IMPLEMENTED / PENDING REVIEW mediante DEC-070** |
| Commit funcional inicial M1-2 | `0266f84f0aa6f2bb840073352815a4bfa2a485bb` |
| Commit funcional de corrección M1-2 | `c7714d3205d0e19916912cf51a745c3816e35f3a` |
| M12-R01…R07 | **CORRECTION IMPLEMENTED / PENDING REVIEW** |
| M1-2 owner gate | **26/26 PASS, 0 skips, 0 todo** |
| M1-2 oracle v0.1 | **17/17 PASS** |
| M1-2 addendum M1 v0.1 | **9/9 PASS** |
| M1-2 pruebas complementarias | **12/12 PASS** |
| Regresiones M12-R01…R06 | **24/24 PASS, 0 skips, 0 todo, 0 waivers** |
| Fidelidad de gate M12-R07 | **Owner tests reforzados y 26/26 PASS** |
| Suite previa preservada durante la corrección | **162/162 PASS** |
| Suite acumulada tras corrección M1-2 | **186/186 PASS, 0 skips, 0 todo, 0 waivers** |
| IMPLEMENTATION_QUESTION de M1-2 | **Ninguna pendiente** |
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

DEC-069 cerró exclusivamente M1-1. DEC-070 autorizó posteriormente sólo el slice M1-2 descrito a continuación; M1-3 permanece **NOT AUTHORIZED**.

## Corrección M1-2 pendiente de revisión

M1-2 implementa un scheduler interno determinístico con autoridad `SYSTEM`, orden por iniciativa y `sequenceIndex`, suspensión ante interacción pendiente y un solo reveal por slot. La adjudicación de campaña normal recorre construcción, narrativa con procedencia persistida de jugador autenticado o fixture `SYSTEM`, tramo PRE_ROLL de cero elegibles, coste atómico basado en `base_cv`, `effective_cv`, d10 transaccional, ERT versionada, 2:1, influencia, legitimidad y VP, reutilizando el Rule Kernel. Una narrativa ausente suspende mediante estado serializable y nunca se inventa por defecto.

`PendingResolution`, `ChoiceRequest`, `NarrativeRequest` y sus continuaciones son datos serializables con actor, opciones opacas, versión, cursor, correlación, causación y versiones normativas fijadas. La corrección M12-R01…R07 separa el hash determinístico de gameplay del digest íntegro del snapshot, autentica los artifacts de replay y reconstruye el estado normalizado completo sin consumir RNG. También unifica Resources en un ledger canónico con `SCENARIO_SETUP`, `TURN_INCOME` y `CAMPAIGN_ACTIVATION_COST`; obliga a atravesar el boundary de sesión para choice/narrativa/query; redacta hashes y artifacts privados en proyecciones de jugador; y rechaza `MANUAL_DIE_INPUT` antes de mutación o RNG.

El commit funcional de corrección `c7714d3205d0e19916912cf51a745c3816e35f3a` reporta **17/17 IDs oracle v0.1 + 9/9 IDs addendum M1 v0.1 = 26/26 owner PASS**, **12/12 pruebas complementarias existentes** y **24/24 regresiones M12-R01…R06**; M12-R07 reforzó los owner tests sin cambiar sus IDs ni resultados. La suite previa de **162/162** permanece preservada y la suite acumulada queda en **186/186 PASS, 0 skips, 0 todo y 0 waivers**. No existe `IMPLEMENTATION_QUESTION` pendiente para M1-2.

M1-2 permanece **CORRECTION IMPLEMENTED / PENDING REVIEW**. M12-R01…R07 no se declaran cerrados hasta revisión técnica. DEC-070 continúa siendo la única autorización y no constituye aprobación anticipada. M1-3, Reaction/Veto, PostgreSQL/outbox productivo, realtime/WebSocket productivo, UI final, autenticación productiva e IA/OpenAI/RAG permanecen **NOT STARTED / NOT AUTHORIZED**.

## Cierre de implementación PR-2

PR-2 implementa exclusivamente command safety in-memory, action-plan lock y el vertical slice mínimo de construcción, modificación y elegibilidad de campañas aprobado mediante `DEC-062`. No se incorporaron PostgreSQL, transporte productivo, UI, AI ni reglas fuera de los 20 casos M0B/M0C.

La corrección posterior al gate `CHANGES REQUIRED` endurece phase enforcement, autoridad de activación extra, invariantes del action-plan payload, compatibilidad de slots, identidades de campañas/cartas y el boundary de juego/actor. Los hallazgos PR2-R01…R06 quedaron cerrados en el commit `0f4195e4f8f72d73eb277983e01fdb2472f5602d`; PR-2 y M0 están aprobados.

## Próximo gate

Los documentos `MALIGN_AI_M1_VERTICAL_SLICE_IMPLEMENTATION_SPEC_v0.1.md` y `MALIGN_AI_M1_TEST_GATE_v0.1.md` fueron enmendados conforme a `DEC-065`, y el planning gate quedó aprobado mediante `DEC-066`. `MALIGN_AI_GAME_ENGINE_TEST_ACCEPTANCE_M1_ADDENDUM_v0.1.md` fija 38 IDs canónicos sin modificar el oracle v0.1.

M1-0 está formalmente cerrado mediante DEC-067 y M1-1 mediante DEC-069. La corrección M1-2 fue implementada exclusivamente bajo DEC-070 y permanece **PENDING REVIEW**; M12-R01…R07 y M1-2 no están aprobados ni cerrados. M1-3 permanece **NOT AUTHORIZED** y no puede comenzar sin autorización expresa posterior.

## Continuidad documental

Las especificaciones, decisiones y estados versionados bajo `docs/` son la fuente de verdad del desarrollo. M1-2 preserva intactos el oracle v0.1 con blob SHA `8291b56e20b9fdf55b8c01c156b66cd641b52d92` y el addendum M1 v0.1 con blob SHA `a5e140eb55b442230110e8ae77d5763401db3117`, y no altera las reglas aprobadas ni los package boundaries.
