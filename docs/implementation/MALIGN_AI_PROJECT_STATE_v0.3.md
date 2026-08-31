# MALIGN-AI — PROJECT STATE v0.4

**Fecha:** 2026-08-29
**Fase actual:** M0 IMPLEMENTED AND APPROVED — M1 IMPLEMENTED AND APPROVED / CLOSED — M2-0 APPROVED AND CLOSED — M2-A/M2-1 IMPLEMENTED AND APPROVED mediante DEC-080 — M2-2 IMPLEMENTED AND APPROVED / CLOSED mediante DEC-083 — M2-3…M2-7 IMPLEMENTED / PENDING REVIEW mediante DEC-084…087 — M2 global IMPLEMENTATION COMPLETE / PENDING REVIEW / NOT YET CLOSED — M3 NOT AUTHORIZED
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
| M1-2 | **IMPLEMENTED AND APPROVED mediante DEC-071** |
| Commit funcional inicial M1-2 | `0266f84f0aa6f2bb840073352815a4bfa2a485bb` |
| Commit funcional final de M1-2 | `c7714d3205d0e19916912cf51a745c3816e35f3a` |
| M12-R01…R07 | **CLOSED** |
| M1-2 owner gate | **26/26 PASS, 0 skips, 0 todo** |
| M1-2 oracle v0.1 | **17/17 PASS** |
| M1-2 addendum M1 v0.1 | **9/9 PASS** |
| M1-2 pruebas complementarias | **12/12 PASS** |
| Regresiones M12-R01…R07 | **24/24 PASS, 0 skips, 0 todo, 0 waivers** |
| Total M1-2 | **62/62 PASS** |
| M0 preservado durante M1-2 | **55/55 PASS** |
| M1-0 preservado durante M1-2 | **39/39 PASS** |
| M1-1 preservado durante M1-2 | **30/30 PASS** |
| Suite acumulada al cierre de M1-2 | **186/186 PASS, 0 skips, 0 todo, 0 waivers** |
| IMPLEMENTATION_QUESTION de M1-2 | **Ninguna pendiente** |
| M1-3 | **IMPLEMENTED AND APPROVED mediante DEC-073** |
| Commit funcional inicial M1-3 | `d04cedf81b5ca3d739f060213052440202b069ed` |
| Commit funcional final M1-3 | `46046eb9ab6d761b20f2b77edfa4780fc6b8cd22` |
| M13-R01…R06 | **CLOSED** |
| M1-3 addendum realtime/reconnect | **10/10 PASS** |
| M1-3 regresiones explícitas `[REGRESSION]` | **7/7 PASS** |
| Gate nominal M1-3 preservado | **17/17 PASS, 0 skips, 0 todo, 0 waivers** |
| Regresiones nuevas M13-R01…R06 | **12/12 PASS** |
| Total M1-3 | **29/29 PASS** |
| Total M1 | **160/160 PASS** |
| Baseline canónico M1 | **87 casos únicos / 94/94 ejecuciones asignadas PASS** |
| Suite completa al cierre de M1 | **215/215 PASS en 27 archivos** |
| Skips | **0** |
| Todo | **0** |
| Waivers | **0** |
| IMPLEMENTATION_QUESTION de M1-3 | **Ninguna pendiente** |
| IMPLEMENTATION_QUESTION de M1 | **Ninguna pendiente** |
| M1 global | **IMPLEMENTED AND APPROVED / CLOSED** |
| DEC-074 | **APPROVED — DOCUMENTATION-ONLY AUTHORIZATION** |
| DEC-075 | **APPROVED — DOCUMENTATION-ONLY AMENDMENT** |
| DEC-076 | **APPROVED — M2 PLANNING CLOSED / M2-0 DOCUMENTATION ONLY** |
| DEC-077 | **APPROVED — M2-0 CANONICAL FOUNDATIONS CLOSED / GOVERNANCE-METADATA-ONLY PROMOTION** |
| M2 planning gate | **APPROVED AND CLOSED mediante DEC-076** |
| M2G-R01…R05 | **CLOSED** |
| M2 oracle inventory | **224 IDs = 71 implementados + 153 owner M2** |
| Addendum M2 v0.1 | **32 IDs canónicos de test acceptance mediante DEC-075 — IMPLEMENTATION NOT AUTHORIZED** |
| Casos nuevos únicos M2 | **185 = 153 oracle + 32 addendum** |
| Ejecuciones dirigidas propuestas M2 | **185 casos nuevos únicos + 86 regresiones = 271** |
| Mínimo canónico histórico del planning gate M2 | **400 = 215 baseline M0/M1 + 185 casos canónicos nuevos; no es el mínimo operativo vigente** |
| Baseline histórica del planning gate original | **215/215 PASS en 27 archivos, 0 skips, 0 todo, 0 waivers** |
| Suite ejecutable vigente tras M2-A | **253/253 PASS en 28 archivos; evidencia previamente aprobada, no reejecutada por M22G-R01** |
| Casos owner canónicos M2-1 ya implementados | **22** |
| Casos canónicos restantes M2-2…M2-7 | **163 = 185 − 22** |
| Casos ejecutables adicionales permanentes de M2-A | **16; no pueden eliminarse ni omitirse de gates futuros** |
| Mínimo canónico histórico anterior a la suite real M2-2 | **416 = 253 + 163; preservado como dato histórico** |
| Mínimo operativo vigente para cierre futuro M2 | **457 = 302 baseline ejecutable M2-2 + 155 casos canónicos M2-3…M2-7** |
| PTD-M2-001…011 | **CLASSIFIED mediante DEC-075** |
| PTD-M2-012…016 | **APPROVED mediante DEC-081 — decision gate only** |
| IQ-M2-001…007 | **RESOLVED mediante DEC-075** |
| IQ-M2-008/009 | **RESOLVED mediante DEC-081 — Auth0 application-side; WSS/Node.js 24/`ws`/Render; LISTEN/NOTIFY wake-up only** |
| IQ-M2-010 | **RESOLVED mediante DEC-077; REG-CAND-001…004 APPROVED** |
| IQ-M2-011 | **RESOLVED mediante DEC-078 — PostgreSQL 18.6 `uuidv7()` sin extensión** |
| IQ-M2-012 | **RESOLVED mediante DEC-078 — sin RLS; roles separados y mínimo privilegio** |
| IQ-M2-013 | **RESOLVED FOR M2 mediante DEC-078 — no partition/archive/compaction/hard-delete** |
| IQ-M2-016 | **RESOLVED — M2-2 sólo admite Games/memberships preprovisionados; onboarding productivo diferido** |
| M20-R01 — AP balance/journal | **CLOSED mediante DEC-077** |
| M20-R02 — durable idempotency lifecycle | **CLOSED mediante DEC-077** |
| M20-R03 — outbox attempt history | **CLOSED mediante DEC-077** |
| M20-R04 — human registry review matrix | **CLOSED mediante DEC-077** |
| Primary source M20-R09 | **PREFLIGHT PASS / EXTERNAL / NOT IN GIT** — `Cartas frente.pdf`, 108 páginas, SHA-256 `3301fd9e92e5d8a8df7a3efc1407434afe0395263a5d6c0e16e0e486faa35113`; página N = serial N |
| M20-R05 — concurrent idempotency recheck | **CLOSED mediante DEC-077** |
| M20-R06 — deterministic journal ordering | **CLOSED mediante DEC-077** |
| M20-R07 — canonical REG-CAND meanings | **CLOSED mediante DEC-077** |
| M20-R08 — complete typed parameters | **CLOSED mediante DEC-077 — 103/103 complete_approved_dec_077, 0 unknown/N/A** |
| M20-R09 — exhaustive primary-source audit | **CLOSED mediante DEC-077 — 108/108 audited** |
| M20-R10 — E021 + bindings 26/28 | **CLOSED mediante DEC-077 — E021 exact; 102 MATCH, 6 DIFFERENCE, 0 AMBIGUOUS** |
| Registry candidate histórico | **PRESERVED / CANDIDATE ONLY — blob `fbcb750e72ae50a2bd4444789b0cfd11e75d7ab0`** |
| Physical Database Spec v0.1 | **APPROVED / 87 TABLES / M20-R01…R10 CLOSED — blob final `13cd601b30db2db22be64c4fda5df94144dcf8d5`** |
| Registry Spec v0.1 | **APPROVED / 100 definitions / 108 templates / 4 aliases / 59 effects / 103 operations — blob final `d7d1325da916f4f867c4a142f8e345d66eaa780e`** |
| Registry Snapshot v0.1 | **approved / SEEDABLE / 108 primary audit rows — JCS SHA-256 candidato aprobado `eb98696020d3694acd8a3374d27ec064ef6db16fd6ea083bb4eaeaac9b30ba74`; JCS SHA-256 final `735fd01b65416bdeb1baaa596bb36ea0d0eef31cb1d1d9b7f4b2322c9c585e4a`; blob final `8d5c150bed742391555bc6bafe022f45baee0163`** |
| Product Owner Review Matrix v0.1 | **APPROVED / 100/108/6/41/59/103 complete; primary audit 108/108 = 102 MATCH / 6 DIFFERENCE / 0 AMBIGUOUS — blob final `cefed690a7c2068f9fe868efaa3df4b2e504e508`** |
| M2-0 Canonical Foundations Gate v0.1 | **APPROVED AND CLOSED mediante DEC-077 — blob final `93f3632f166d2b430784b1204e45f087bba75274`** |
| M2 Implementation Spec v0.1 | **M2-A/M2-1 IMPLEMENTED AND APPROVED mediante DEC-080** |
| M2-A final gate | **22/22 owner + 38/38 gate acumulado + 14/14 regresiones asignadas preservadas; PostgreSQL 18.6; suite final 253/253 PASS** |
| M2A-R01…R30 | **CLOSED mediante DEC-080** |
| Suite acumulada al cierre M2-A | **253/253 PASS en 28 archivos, 0 skips, 0 todo, 0 waivers** |
| Commit funcional publicado de la corrección M2A-R20…R24 | `bc186765da642363fb3fb1a73f217f3cbd19b1bd` |
| Commit funcional de la corrección M2A-R25…R29 | `31d11bb6b6df04954f40b11f96b2107ae2f3f420` |
| Commit funcional de la corrección M2A-R30 | `85ec047726a68007fbcabf07c6b3fe1b911a3070` |
| Commit funcional final aprobado M2-A/M2-1 | `85ec047726a68007fbcabf07c6b3fe1b911a3070` |
| IMPLEMENTATION_QUESTIONS | **IQ-M2-008…012 y 014/015 RESOLVED; IQ-M2-013 RESOLVED FOR M2** |
| Decisions v0.3 | **DEC-087 APPROVED — M2-7 IMPLEMENTATION AUTHORIZATION ONLY** |
| M2-0 — Canonical Foundations Gate documental | **APPROVED AND CLOSED mediante DEC-077** |
| M2-A/M2-1 — PostgreSQL Persistence and Durable Recovery | **IMPLEMENTED AND APPROVED mediante DEC-080** |
| M2-2 — Productive Transport and Reconnect | **IMPLEMENTED AND APPROVED / CLOSED mediante DEC-083** |
| M2-2 gate ejecutado | **75/75 PASS: 8/8 owners + 17/17 regresiones asignadas + 50 complementarias/regresiones ejecutables** |
| Suite acumulada tras M2-2 | **302/302 PASS en 34 archivos, 0 skips, 0 todo, 0 waivers** |
| Dependencias M2-2 | **`ws@8.21.3`, `@types/ws@8.18.1`, `jose@6.2.10`, `@auth0/nextjs-auth0@4.28.0`** |
| M22-R01…R14 | **CLOSED mediante DEC-083** |
| Reconciliación operativa pos-DEC-083 | **302→341→386→409→427→457; el 416 anterior permanece histórico** |
| M2-3 — Complete Scheduler and Remaining Core Rules | **IMPLEMENTED / PENDING REVIEW mediante DEC-084 — 39/39 owners; gate 57/57** |
| M2-4 — Action/Starter Cards and Regime Abilities | **IMPLEMENTED / PENDING REVIEW mediante DEC-084 — 45/45 owners; gate 57/57** |
| Suite acumulada tras M2-B | **416/416 PASS en 38 archivos, 0 skips, 0 todo, 0 waivers** |
| M2-5 — Reaction, Veto and Deterministic Narrative | **IMPLEMENTED / PENDING REVIEW mediante DEC-085 — 23/23 owners; gate 34/34** |
| Suite acumulada tras M2-5 | **450/450 PASS en 40 archivos, 0 skips, 0 todo, 0 waivers** |
| M2-6 — Cleanup, Viralization and End Turn | **IMPLEMENTED / PENDING REVIEW mediante DEC-086 — 18/18 owners; gate 24/24** |
| Suite acumulada tras M2-6 | **474/474 PASS en 42 archivos, 0 skips, 0 todo, 0 waivers** |
| M2-7 — Objectives, Victory and End Game | **IMPLEMENTED / PENDING REVIEW mediante DEC-087 — 30/30 owners; gate 38/38** |
| Suite acumulada tras M2-7 | **512/512 PASS en 44 archivos, 0 skips, 0 todo, 0 waivers** |
| M2 | **IMPLEMENTATION COMPLETE / PENDING TECHNICAL REVIEW — NOT YET CLOSED** |
| M3 | **NOT AUTHORIZED** |

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
| PostgreSQL 18.6, migrations y durable recovery M2-A | **IMPLEMENTED AND APPROVED mediante DEC-080** |
| Transactional Outbox durable + publisher de transporte | **IMPLEMENTED AND APPROVED dentro de M2-A/M2-2** |
| Realtime/WebSocket productivo | **IMPLEMENTED AND APPROVED mediante DEC-083** |
| Autenticación productiva configurable | **IMPLEMENTED AND APPROVED dentro de M2-2; sin tenant ni secrets reales** |
| UI final | **NOT STARTED / NOT AUTHORIZED** |
| IA / OpenAI / RAG | **NOT STARTED / NOT AUTHORIZED** |
| Reaction/Veto | **IMPLEMENTED / PENDING REVIEW mediante DEC-085** |
| Cleanup / End Turn | **NOT STARTED / NOT AUTHORIZED** |
| Objectives / Victory | **NOT STARTED / NOT AUTHORIZED** |
| M2 global | **NOT YET CLOSED — M2-3…M2-7 NOT AUTHORIZED** |
| M3 | **NOT STARTED / NOT AUTHORIZED** |

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

## Cierre formal de M1-2

M1-2 implementa un scheduler interno determinístico con autoridad `SYSTEM`, orden por iniciativa y `sequenceIndex`, suspensión ante interacción pendiente y un solo reveal por slot. La adjudicación de campaña normal recorre construcción, narrativa con procedencia persistida de jugador autenticado o fixture `SYSTEM`, tramo PRE_ROLL de cero elegibles, coste atómico basado en `base_cv`, `effective_cv`, d10 transaccional, ERT versionada, 2:1, influencia, legitimidad y VP, reutilizando el Rule Kernel. Una narrativa ausente suspende mediante estado serializable y nunca se inventa por defecto.

`PendingResolution`, `ChoiceRequest`, `NarrativeRequest` y sus continuaciones son datos serializables con actor, opciones opacas, versión, cursor, correlación, causación y versiones normativas fijadas. La corrección M12-R01…R07 separa el hash determinístico de gameplay del digest íntegro del snapshot, autentica los artifacts de replay y reconstruye el estado normalizado completo sin consumir RNG. También unifica Resources en un ledger canónico con `SCENARIO_SETUP`, `TURN_INCOME` y `CAMPAIGN_ACTIVATION_COST`; obliga a atravesar el boundary de sesión para choice/narrativa/query; redacta hashes y artifacts privados en proyecciones de jugador; y rechaza `MANUAL_DIE_INPUT` antes de mutación o RNG.

El commit funcional final `c7714d3205d0e19916912cf51a745c3816e35f3a` reporta **17/17 IDs oracle v0.1 + 9/9 IDs addendum M1 v0.1 = 26/26 owner PASS**, **12/12 pruebas complementarias existentes** y **24/24 regresiones M12-R01…R07**, para un total M1-2 de **62/62 PASS**. M0 permanece **55/55 PASS**, M1-0 **39/39 PASS** y M1-1 **30/30 PASS**. La suite acumulada queda en **186/186 PASS, 0 skips, 0 todo y 0 waivers**. No existe `IMPLEMENTATION_QUESTION` pendiente para M1-2.

La revisión técnica aprobó M1-2 y aceptó M12-R01…R07. Mediante `DEC-071`, DEC-070 queda cumplida, M12-R01…R07 quedan **CLOSED** y M1-2 queda **IMPLEMENTED AND APPROVED** sin nuevas correcciones de código. DEC-071 cerró exclusivamente M1-2 y no autorizó M1-3; DEC-072 autorizó posteriormente sólo la implementación M1-3 descrita a continuación. Reaction/Veto, PostgreSQL/outbox productivo, realtime/WebSocket productivo, UI final, autenticación productiva e IA/OpenAI/RAG permanecen **NOT STARTED / NOT AUTHORIZED**.

## Cierre formal de M1-3 y M1

DEC-072 autoriza exclusivamente M1-3. El commit funcional `d04cedf81b5ca3d739f060213052440202b069ed` implementa un realtime port y un adapter in-memory/test-only desacoplados del Game Engine. El store CAS notifica únicamente commits aceptados; la capa de aplicación vuelve a resolver sesión, membership y viewer antes de construir `ProjectedEvent`, proyección y cursor segmentados para owner, rival y F1. El adapter no calcula reglas, no conserva autoridad del juego y no contiene red, sockets ni infraestructura productiva.

El cursor autorizado fija `gameVersion + lastSequenceNumber`, conserva `sequenceNumber` como ordering canónico y queda ligado a juego, participante, rol y projection ID. Initial sync registra la suscripción antes de consultar el catch-up feed; un commit ocurrido entre la proyección inicial y subscribe queda cubierto por el feed, y cualquier duplicado live/feed converge mediante deduplicación por `eventId + sequenceNumber`. Los gaps se detectan y se recuperan exclusivamente desde el event log autorizado junto con la latest projection; no se reconstruye estado desde mensajes incompletos.

Reconnect ejecuta `authenticate → verify game membership → fetch latest authorized projection → obtain cursor → subscribe from cursor`. La recuperación usa `M1StateSnapshot` serializado y un nuevo instance in-memory dentro del mismo proceso de test. Con `PendingResolution`, sólo el actor designado y F1 reciben la interacción completa; el rival conserva las redacciones. Reconnect no realiza auto-pass, timeout, respuesta, resume, RNG ni mutación de state, ledgers, trace, events o version.

La revisión técnica del commit inicial produjo `CHANGES REQUIRED — M1-3 NOT APPROVED`; ese commit queda supersedido técnicamente. Bajo la misma autorización DEC-072, el commit funcional final `46046eb9ab6d761b20f2b77edfa4780fc6b8cd22` implementa M13-R01…R06: publicación sólo después de estabilizar CAS, resultado idempotente y transacción RNG; handshake inactivo con catch-up y live buffered hasta que el consumidor inicializa; aislamiento de observers y handlers; handles opacos y lifecycle autenticado de suscripción; rangos `fromCursor → cursor` que separan omisiones autorizadas de pérdidas reales; y una política canónica fail-closed compartida por query, initial sync, feed, realtime y reconnect.

El gate nominal se preserva en **10/10 IDs addendum + 7/7 regresiones explícitas = 17/17 PASS**. Las regresiones nuevas M13-R01…R06 reportan **12/12 PASS**, para **29/29 pruebas M1-3**. M0 permanece **55/55**, M1-0 **39/39**, M1-1 **30/30** y M1-2 **62/62**; las pruebas de M1 suman **160/160 PASS**. El baseline canónico M1 queda satisfecho con **49 IDs del oracle + 38 IDs del addendum = 87 casos únicos y 94/94 ejecuciones asignadas PASS**, incluidas las siete regresiones M1-3. La suite completa queda en **215/215 PASS en 27 archivos, 0 skips, 0 todo y 0 waivers**. No existe `IMPLEMENTATION_QUESTION` pendiente para M1.

Mediante DEC-073, DEC-072 queda cumplida, M13-R01…R06 quedan **CLOSED**, M1-3 queda **IMPLEMENTED AND APPROVED** y los cuatro bloques M1 quedan cerrados: M1-0 mediante DEC-067, M1-1 mediante DEC-069, M1-2 mediante DEC-071 y M1-3 mediante DEC-073. M1 global queda **IMPLEMENTED AND APPROVED / CLOSED**. El checkpoint termina después de una campaña normal resuelta en `RESOLUTION_STAGE`, antes de Cleanup.

PTD-M1-001…005 permanecen aprobadas y materializadas dentro del alcance in-memory/test-only de M1; IQ-M1-001…003 permanecen resueltas. DEC-073 cierra exclusivamente M1 y no autoriza M2 ni M3. PostgreSQL/migraciones, outbox, durabilidad entre procesos/nodos, realtime/WebSocket productivo, UI, autenticación productiva, IA/OpenAI/RAG, Reaction/Veto, Cleanup, End Turn, objectives y victory permanecen **NOT STARTED / NOT AUTHORIZED**.

## Cierre de implementación PR-2

PR-2 implementa exclusivamente command safety in-memory, action-plan lock y el vertical slice mínimo de construcción, modificación y elegibilidad de campañas aprobado mediante `DEC-062`. No se incorporaron PostgreSQL, transporte productivo, UI, AI ni reglas fuera de los 20 casos M0B/M0C.

La corrección posterior al gate `CHANGES REQUIRED` endurece phase enforcement, autoridad de activación extra, invariantes del action-plan payload, compatibilidad de slots, identidades de campañas/cartas y el boundary de juego/actor. Los hallazgos PR2-R01…R06 quedaron cerrados en el commit `0f4195e4f8f72d73eb277983e01fdb2472f5602d`; PR-2 y M0 están aprobados.

## Gate documental de planificación M2

DEC-074 autorizó exclusivamente preparar el planning gate y DEC-075 aprobó su enmienda. DEC-076 aprueba y cierra el planning gate corregido contra `2bfc49d17722538ee2f2688d5dd3735b1468fe5c`, cierra M2G-R01…R05, fija la estructura M2-0…M2-7 y autoriza exclusivamente el trabajo documental M2-0. El planning gate queda **APPROVED AND CLOSED**; esta aprobación no autoriza implementación M2.

El oracle conserva **224 IDs = 71 implementados M0/M1 + 153 owner M2**. El addendum M2 contiene **32/32 IDs canónicos** y las asignaciones no cambian. Los casos nuevos únicos planificados son **185 = 153 + 32** y las regresiones dirigidas **86**, para **271 ejecuciones dirigidas**. `400 = 215 + 185` y `416 = 253 + 163` se preservan como mínimos históricos. La suite real cerrada de M2-2 es **302**; quedan **155 casos canónicos** de M2-3…M2-7, por lo que el mínimo operativo vigente de cierre es **457 = 302 + 155**.

El Card Registry canónico aprobado registra **108 serial templates por country set**, **100 definitions**, **cinco Starter por set**, **cinco países**, **cuatro aliases** y **59 effect definitions**. La materialización futura permanece exactamente en **540 `CardInstance`**, incluidas **25 Starter**. La Product Owner Review Matrix aprobada cubre exhaustivamente **100/100 definitions, 108/108 serial templates, 6/6 grupos repetidos, 41/41 definitions sin effect y 59/59 effects** con source trace. DEC-077 aprueba REG-CAND-001…004, el snapshot queda `approved` y `seedable=true`, y sus **103/103 operaciones** quedan `complete_approved_dec_077`, con **0 parámetros unknown**. El candidate histórico permanece intacto con blob `fbcb750e72ae50a2bd4444789b0cfd11e75d7ab0`.

M2G-R01…R05 quedan **CLOSED** mediante DEC-076: `GE-M2-EFX-001` conserva owner único M2-3 con aceptación incremental y regresiones M2-4/M2-5; el loser de `GE-M2-TX-003` queda sin mutación ni artifacts/consumos; `GE-M2-RX-001` usa idempotencia + CAS sin afirmar exactly-once delivery; `GE-M2-DB-005` fija cardinalidades explícitas; y `GE-M2-TX-008` traza replay a PTD-M2-004/008.

`IQ-M2-001…007` quedan **RESOLVED mediante DEC-075**. `IQ-M2-008 — Production AuthN provider` e `IQ-M2-009 — WebSocket runtime and operating envelope` quedan **RESOLVED mediante DEC-081** para el decision gate M2-2. `IQ-M2-010` queda **RESOLVED mediante DEC-077** con REG-CAND-001…004 aprobadas; `IQ-M2-011`, `IQ-M2-012` e `IQ-M2-013` quedan resueltas mediante DEC-078, e `IQ-M2-014/IQ-M2-015` mediante DEC-079. No queda ninguna `IMPLEMENTATION_QUESTION` pendiente para M2-A o para el decision gate M2-2.

M2-0 fue ejecutado sólo como gate documental. M20-R01…R04 separa AP balance+journal, fija el lifecycle durable de idempotencia, separa outbox message/state/attempt y crea la matriz humana exhaustiva. La fuente exacta `Cartas frente.pdf` pasó el preflight con SHA-256 `3301fd9e92e5d8a8df7a3efc1407434afe0395263a5d6c0e16e0e486faa35113`; se auditó externamente 108/108 y no se incorporó a Git. M20-R05 añade fast lookup + recheck obligatorio bajo Game lock; M20-R06 fija orden causal `(game_event_sequence, artifact_ordinal)` y rollback/CAS sin gaps; M20-R07 restaura los significados canónicos REG-CAND-001…004; M20-R08 completa 103/103 parámetros machine-readable; M20-R09 registra 59 literales y 41 ausencias por definition. M20-R10 corrige E021 conservando dos operaciones y 103 totales: cada otro jugador activo puede comprometer voluntariamente una única contribución de exactamente 1 recurso; el source-card player queda excluido; commit, rechazo sin mutación, deduplicación por participante, máximo, bonus +1 a `EFFECTIVE_CV`, atomicidad e idempotencia quedan explícitos. También aprueba `DP` → `PD` en serial 26 y `cubos de resistencia`/`DP` → blue `RESILIENCY`/`PD` en serial 28, sin alterar literales. La auditoría queda en 102 MATCH, 6 DIFFERENCE y 0 AMBIGUOUS. La Physical DB Spec permanece en **87 tablas**.

DEC-077 aprueba el contenido candidato exacto del baseline `d7cd1b087bf1aa99a4d336c3d8b1d9345414c970` y ejecuta únicamente su promoción mecánica de metadatos de gobernanza. M20-R01…R10 quedan **CLOSED**; REG-CAND-001…004 quedan **APPROVED**; `IQ-M2-010` queda **RESOLVED**; y M2-0 queda **APPROVED AND CLOSED**. El snapshot final conserva sin cambio semántico **264610 bytes** de proyección y SHA-256 `8a46133ca70883df2d173fddd9c725cd0611b2be8311a5fe42057464415d6a13`; el JCS candidato aprobado es `eb98696020d3694acd8a3374d27ec064ef6db16fd6ea083bb4eaeaac9b30ba74` y el JCS final, tras la promoción de gobernanza, es `735fd01b65416bdeb1baaa596bb36ea0d0eef31cb1d1d9b7f4b2322c9c585e4a`.

En el cierre histórico de DEC-077, M2-A aún no estaba autorizado ni iniciado. DEC-078 lo autorizó posteriormente y DEC-079 resolvió IQ-M2-014/IQ-M2-015 para continuar la corrección. La cadena funcional culmina en `85ec047726a68007fbcabf07c6b3fe1b911a3070`. DEC-080 aprueba ese commit final, declara M2A-R01…R30 **CLOSED** y cierra exclusivamente M2-A/M2-1. M2-2…M2-7 continúan **NOT AUTHORIZED**, M2 global queda **NOT YET CLOSED** y M3 continúa **NOT AUTHORIZED**.

La baseline M0/M1 **215/215 PASS**, el owner nominal M2-A **22/22 PASS** y las **14/14 regresiones asignadas previas** fueron preservados. El gate acumulado M2-A queda en **38/38 PASS** y la suite final en **253/253 PASS en 28 archivos, 0 skips, 0 todo y 0 waivers**. Las migrations `001…006` y el esquema físico **87/87** fueron aplicados y verificados contra PostgreSQL 18.6 real. No queda ninguna corrección de código ni `IMPLEMENTATION_QUESTION` pendiente para M2-A.

## Próximo gate

Los documentos `MALIGN_AI_M1_VERTICAL_SLICE_IMPLEMENTATION_SPEC_v0.1.md` y `MALIGN_AI_M1_TEST_GATE_v0.1.md` fueron enmendados conforme a `DEC-065`, y el planning gate quedó aprobado mediante `DEC-066`. `MALIGN_AI_GAME_ENGINE_TEST_ACCEPTANCE_M1_ADDENDUM_v0.1.md` fija 38 IDs canónicos sin modificar el oracle v0.1.

M1-0 está formalmente cerrado mediante DEC-067, M1-1 mediante DEC-069, M1-2 mediante DEC-071 y M1-3 mediante DEC-073. M1 global está **IMPLEMENTED AND APPROVED / CLOSED**. El planning gate M2 queda **APPROVED AND CLOSED mediante DEC-076**, M2-0 mediante DEC-077, M2-A/M2-1 mediante DEC-080 y M2-2 **IMPLEMENTED AND APPROVED / CLOSED mediante DEC-083**. M2-3…M2-7 permanecen **NOT AUTHORIZED**, M2 global **NOT YET CLOSED** y M3 **NOT AUTHORIZED**.

## Implementación M2-2 mediante DEC-082

M2-2 reutiliza `GameSessionApplicationPort`, AuthorizedProjection/feed M1, recovery PostgreSQL y outbox M2-A. `ProductiveAuthnPort` verifica identidad externa por RS256/JWKS; `PostgresMembershipAuthorityAdapter` deriva participant, seat, role, game y permisos desde PostgreSQL. El boundary HTTP/HTTPS conserva los commands autoritativos y el servidor WSS `malign.realtime.v1` se limita a AuthN, subscriptions, SYNC, EVENT_BATCH, ACK, GAP/RESYNC, unsubscribe y draining. `LISTEN/NOTIFY` es sólo wake-up opaco; cada nodo relee feed/proyección durable. No se creó migration, tabla, Engine alterno, política de proyección paralela ni fuente de estado adicional.

El gate dirigido reporta **75/75 PASS**: **8/8 owners**, **17/17 regresiones asignadas** y **50 pruebas complementarias/regresiones ejecutables**. La evidencia cubre JWT criptográfico/JWKS rotation, HTTP y WSS reales, dos procesos Node stateless, sesión/expiry, cross-game/hijacking, payload/framing/Origin/subprotocolo, backpressure, graceful shutdown, outbox y LISTEN/NOTIFY perdido/duplicado/desordenado/reconectado. La suite acumulada reporta **302/302 PASS en 34 archivos, 0 skips, 0 todo y 0 waivers** sobre PostgreSQL real **18.6**, migrations `001…006` y esquema **87/87**.

La autoauditoría corrigió M22-R01…R08: callback exitoso `ws` con `null` mal interpretado como overload; lifecycle de cierre prematuro; ACK intermedio no emitido; cursores incorrectos en batches; overflow de timer de expiración; configuración de scopes vacía; catch-up periódico de todas las subscriptions; y señal explícita `GAP_DETECTED` antes del feed de recuperación. No queda `IMPLEMENTATION_QUESTION` pendiente. No existe tenant Auth0, cuenta Render, contratación, proveedor cloud, infraestructura persistente, secret productivo ni deployment.

## Corrección M22-R09…R14

M22-R09…R14 quedan **CLOSED mediante DEC-083**. La evidencia usa PostgreSQL 18.6, dos procesos Node, pools/application boundaries independientes, puertos TCP/WebSocket reales y JWKS efímero. IQ-M2-016 queda formalmente **RESOLVED** con alcance conservador: Games y memberships deben estar preprovisionados; CREATE/JOIN productivos y onboarding permanecen fuera. TLS separa `direct`, `trusted_proxy` y `disabled` de test; logout distribuye invalidación efímera digest-only; preflight valida tres accesos PostgreSQL de mínimo privilegio; ACK/batching/resync se serializan por subscription con checkpoints monotónicos.

No se creó migration 007, no cambió el esquema 87/87, no se añadieron dependencias y M2-3…M2-7 continúan **NOT AUTHORIZED**. DEC-083 cierra exclusivamente M2-2.

## Continuidad documental

Las especificaciones, decisiones y estados versionados bajo `docs/` son la fuente de verdad del desarrollo. M2-A preserva intactos el oracle v0.1 con blob SHA `8291b56e20b9fdf55b8c01c156b66cd641b52d92`, el addendum M1 v0.1 con blob SHA `a5e140eb55b442230110e8ae77d5763401db3117`, el addendum M2 con blob SHA `6ae87a904a14a82e4fb174ff4d76eefd47052832`, Registry Spec `d7d1325da916f4f867c4a142f8e345d66eaa780e`, Registry Snapshot `8d5c150bed742391555bc6bafe022f45baee0163`, Physical Database Spec `13cd601b30db2db22be64c4fda5df94144dcf8d5` y Review Matrix `cefed690a7c2068f9fe868efaa3df4b2e504e508`.

## Implementación y cierre M2-A/M2-1 mediante DEC-078/DEC-079/DEC-080

M2-A implementa PostgreSQL **18.6** con driver `pg` **8.23.0**, seis migrations SQL forward-only, ledger técnico separado y manifest contractual independiente y explícito de **87 tablas, 865 columnas, 1261 constraints, 211 índices, 25 triggers y 5 functions**, contrastado contra la Physical Database Spec blob `13cd601b30db2db22be64c4fda5df94144dcf8d5`, con catalog SHA-256 `447d8e06e3030a2744135c56edca135a142b2fcc252e69dd377259fc81d8a465`. Las migrations `001…005` permanecen intactas; `005_contractual_integrity_and_privileges.sql` conserva SHA-256 `6d60164092fd8c72e8e2d3d3b2df988481a8017b7473ba05c3948642b95c1580`; el hash previo de `006_durable_parity_and_least_privilege.sql`, `1c46e60136fa2967714d52186e89af3564fca342b11269cf3c572e54914aa317`, queda supersedido antes del cierre de M2-A por SHA-256 `ca318dd0f56d4a9afe101b7a6ada76fcb61337f0327ff5dd05e73d854e71f06e`. El registry aprobado valida JCS SHA-256 `735fd01b65416bdeb1baaa596bb36ea0d0eef31cb1d1d9b7f4b2322c9c585e4a`, siembra 100 definitions, 108 templates, 4 aliases, 59 effects y 103 operaciones, y materializa por Game 540 CardInstance —108 por país— incluidas 25 Starter.

DEC-079 conserva `country_definitions.mascot` `NOT NULL` y persiste los literales oficiales `ARDEN=Tree`, `FLUMA=Tree and River`, `URSARIA=Bear`, `PRESQUE=Horse` y `DINESIA=Shark`, referenciados a `Malign-Influence-Rulebook_ENGLISH.pdf`, sección 13 “Countries and Characteristics”, páginas 19–20. El bootstrap administrativo cluster-level crea roles `NOLOGIN` separados y limita `SET ROLE malign_migration_owner` al migrator; migrations 001/002/004/005 se ejecutan como migration owner y 003 conserva su checksum bajo la excepción administrativa. UoW/recovery usan `malign_app_runtime`; claim/delivery/ack/recovery del publisher usan `malign_outbox_publisher`.

El adapter PostgreSQL satisface el port M1 completo para lifecycle, setup, initiative, maintenance, action planning, interacción de adjudicación, proyecciones y initial sync/feed de aplicación, sin transporte productivo. M2A-R30 establece un coordinador application-wide común para comandos setup/lifecycle, interacciones/continuations y scheduler: lookup durable de idempotencia → recovery → checkpoint RNG/Clock → Engine en modo `APPLICATION` → transición durable → transacción/CAS PostgreSQL → `COMMIT` PostgreSQL → commit RNG/Clock → publicación. Cada Game posee un provider transaccional independiente y una cola single-writer in-memory que se elimina al drenar; Game row lock + CAS conserva la autoridad durable. El port interno del scheduler no acepta sesión, `ActorContext` ni autoridad del caller y deriva SYSTEM exclusivamente dentro del servidor. El Engine produce una transición durable DB-free, tipada y versionada con before/after, eventos, traces, mutaciones por familia, ledgers, continuation, actoría y causalidad; el completeness guard rechaza antes de todo write cualquier transición incompleta o adulterada. El Unit of Work usa `READ COMMITTED`, fast lookup de idempotencia, `SELECT ... FOR UPDATE`, recheck bajo lock, CAS de `game_version`, un único `pg` client, persistencia normalizada/journals/event/trace/continuation/idempotencia/outbox en una transacción y publicación diferida hasta la confirmación application-owned de RNG/Clock.

Recovery y reconciliation contrastan snapshot+tail y `authoritative_state_json` contra valores semánticos completos de phase/initiative/scheduler, AP/Resources/VP/legitimacy y sus ledgers, cartas/zonas/mazo, plans, campaigns/activations, action resolutions, PD/influence/resolutions, dados e identidad RNG, narrative, choices/continuations, traces/causalidad y heads/pins normalizados. Una divergencia fija `recovery_blocked` y añade como máximo un trace diagnóstico serializable por digest, F1-only, con actoría `SYSTEM` y `participant_id=NULL`, sin gameplay event, cambio de estado ni incremento de versión. Todos los artifacts con trace usan FK compuesta `(game_id, trace_id)`. Los roles de producto continúan `NOLOGIN`; los pools de prueba usan principals `LOGIN` efímeros, no administrativos, con exactamente una membership correspondiente, y UoW/recovery/materialización/override/scheduler/publisher fallan cerrado ante una identidad incompatible. La PK física Game se asigna con PostgreSQL 18.6 `uuidv7()` y no puede ser elegida por el caller. OutboxMessage es inmutable, DeliveryState mutable y DeliveryAttempt append-only; no se afirma exactly-once delivery.

El owner nominal M2-A conserva **22/22 PASS**, las **14/14 regresiones asignadas previas** permanecen verdes y el gate acumulado M2-A suma **38/38 PASS**; baseline M0/M1 **215/215 preservada**; suite final **253/253 PASS en 28 archivos, 0 skips, 0 todo y 0 waivers**. El commit funcional final queda fijado en `85ec047726a68007fbcabf07c6b3fe1b911a3070`. DEC-080 declara M2A-R01…R30 **CLOSED** y M2-A/M2-1 **IMPLEMENTED AND APPROVED**. DEC-081 resuelve posteriormente IQ-M2-008/009 y aprueba sólo el decision gate M2-2; no autoriza M2-2…M2-7, M2 global ni M3.

## Gate documental M2-2 mediante DEC-081

La especificación `MALIGN_AI_M2_2_PRODUCTIVE_TRANSPORT_AND_RECONNECT_SPEC_v0.1.md` registra fuentes oficiales consultadas el 2026-08-29, PTD-M2-012…016, Auth0 application-side, autenticación por primer frame, protocolo `malign.realtime.v1` sobre WSS con Node.js 24 + `ws`, fan-out multinodo con `LISTEN/NOTIFY` sólo como wake-up, Render como target de referencia y envelope operacional configurable. Históricamente, DEC-081 fijó **8 owners + 17 regresiones = 25 ejecuciones dirigidas**, baseline **253/253** y mínimo planificado **261**, dejando el bloque listo pero no autorizado. DEC-082 lo autorizó y DEC-083 lo cerró posteriormente con suite real **302/302**.

La cadena **253→261→300→345→368→386→416** se conserva como planificación histórica anterior a la suite real. DEC-083 fija el baseline ejecutable cerrado de M2-2 en **302** y la cadena operativa vigente queda **302→341→386→409→427→457**. Cada futura subetapa debe preservar toda la suite aprobada hasta el bloque anterior.
