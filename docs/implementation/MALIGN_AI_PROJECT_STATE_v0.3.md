# MALIGN-AI — PROJECT STATE v0.4

**Fecha:** 2026-08-25
**Fase actual:** M1 IMPLEMENTED AND APPROVED / CLOSED — M2 PLANNING GATE APPROVED AND CLOSED — M2-0 DOCUMENTED / BLOCKED PENDING REVIEW — M2 NOT AUTHORIZED
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
| M2 planning gate | **APPROVED AND CLOSED mediante DEC-076** |
| M2G-R01…R05 | **CLOSED** |
| M2 oracle inventory | **224 IDs = 71 implementados + 153 owner M2** |
| Addendum M2 v0.1 | **32 IDs canónicos de test acceptance mediante DEC-075 — IMPLEMENTATION NOT AUTHORIZED** |
| Casos nuevos únicos M2 | **185 = 153 oracle + 32 addendum** |
| Ejecuciones dirigidas propuestas M2 | **185 casos nuevos únicos + 86 regresiones = 271** |
| Suite mínima futura propuesta | **400 = 215 baseline + 185 nuevos únicos** |
| Suite aprobada de entrada | **215/215 PASS en 27 archivos, 0 skips, 0 todo, 0 waivers — baseline histórica, no reejecutada por este gate documental** |
| PTD-M2-001…011 | **CLASSIFIED mediante DEC-075** |
| IQ-M2-001…007 | **RESOLVED mediante DEC-075** |
| IQ-M2-008/009 | **OPEN / PENDING RESOLUTION — sin cambios** |
| IQ-M2-010 | **PARTIALLY RESOLVED / BLOCKED BY REG-CAND-001…004** |
| IQ-M2-011…013 | **OPEN — UUIDv7 generation / RLS / partitioning** |
| Registry candidate histórico | **PRESERVED / CANDIDATE ONLY — blob `fbcb750e72ae50a2bd4444789b0cfd11e75d7ab0`** |
| Physical Database Spec v0.1 | **84 TABLES DOCUMENTED / PENDING REVIEW — blob candidato `30a8bc9657fb958e21a09af22591f6e959edb3fe`** |
| Registry Spec v0.1 | **100 definitions / 108 templates / 4 aliases / 59 effects — PENDING OWNER APPROVAL — blob candidato `6472b136a806f403747defe1d59ed44fb78f49fa`** |
| Registry Snapshot v0.1 | **candidate_pending_review / NOT SEEDABLE — JCS SHA-256 `37e1e27e142a2e08d8a19418089602bc72d775b9f5944059acc27ee4de93c83e`; blob `a8c3ee9f3b78113e1f94891a9b0c634083107ec3`** |
| M2-0 — Canonical Foundations Gate documental | **DOCUMENTATION AUTHORIZED / RESULT BLOCKED PENDING REVIEW — NOT APPROVED/CLOSED** |
| M2-1 — PostgreSQL Persistence and Durable Recovery | **NOT AUTHORIZED** |
| M2-2 — Productive Transport and Reconnect | **NOT AUTHORIZED** |
| M2-3 — Complete Scheduler and Remaining Core Rules | **NOT AUTHORIZED** |
| M2-4 — Action/Starter Cards and Regime Abilities | **NOT AUTHORIZED** |
| M2-5 — Reaction, Veto and Deterministic Narrative | **NOT AUTHORIZED** |
| M2-6 — Cleanup, Viralization and End Turn | **NOT AUTHORIZED** |
| M2-7 — Objectives, Victory and End Game | **NOT AUTHORIZED** |
| M2 | **NOT AUTHORIZED** |
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
| PostgreSQL productivo y migraciones | **NOT STARTED / NOT AUTHORIZED** |
| Transactional Outbox y durabilidad entre procesos/nodos | **NOT STARTED / NOT AUTHORIZED** |
| Realtime/WebSocket productivo | **NOT STARTED / NOT AUTHORIZED** |
| Autenticación productiva | **NOT STARTED / NOT AUTHORIZED** |
| UI final | **NOT STARTED / NOT AUTHORIZED** |
| IA / OpenAI / RAG | **NOT STARTED / NOT AUTHORIZED** |
| Reaction/Veto | **NOT STARTED / NOT AUTHORIZED** |
| Cleanup / End Turn | **NOT STARTED / NOT AUTHORIZED** |
| Objectives / Victory | **NOT STARTED / NOT AUTHORIZED** |
| M2 / M3 | **NOT STARTED / NOT AUTHORIZED** |

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

El oracle conserva **224 IDs = 71 implementados M0/M1 + 153 owner M2**. El addendum M2 contiene **32/32 IDs canónicos**, cada uno con owner único, pero no autoriza tests ejecutables. Los casos nuevos únicos son **185 = 153 + 32**; tras M2G-R01 las regresiones dirigidas son **86**, para **271 ejecuciones dirigidas**. M2-5 queda en **23 casos nuevos + 11 regresiones = 34 ejecuciones dirigidas**. La suite mínima acumulada futura sigue siendo **400 = 215 + 185**.

El artifact registry nuevo registra **108 serial templates por country set**, **100 definitions candidatas**, **cinco Starter por set**, **cinco países**, **cuatro aliases** y **59 effect definitions candidatas**. La materialización futura sería exactamente **540 `CardInstance`**, incluidas **25 Starter**. IDs/mapping, contenido impreso, effect bindings/parameters y hashes siguen pendientes bajo `REG-CAND-001…004`; el snapshot conserva status `candidate_pending_review` y `seedable=false`. El candidate histórico permanece intacto con blob `fbcb750e72ae50a2bd4444789b0cfd11e75d7ab0`.

M2G-R01…R05 quedan **CLOSED** mediante DEC-076: `GE-M2-EFX-001` conserva owner único M2-3 con aceptación incremental y regresiones M2-4/M2-5; el loser de `GE-M2-TX-003` queda sin mutación ni artifacts/consumos; `GE-M2-RX-001` usa idempotencia + CAS sin afirmar exactly-once delivery; `GE-M2-DB-005` fija cardinalidades explícitas; y `GE-M2-TX-008` traza replay a PTD-M2-004/008.

`IQ-M2-001…007` quedan **RESOLVED mediante DEC-075**. `IQ-M2-008 — Production AuthN provider` e `IQ-M2-009 — WebSocket runtime and operating envelope` permanecen **OPEN / PENDING RESOLUTION** sin cambios. `IQ-M2-010` queda **PARTIALLY RESOLVED / BLOCKED BY REG-CAND-001…004**. Se abren `IQ-M2-011` (UUIDv7 generation boundary), `IQ-M2-012` (RLS defense-in-depth) e `IQ-M2-013` (partitioning/archival thresholds). No apareció contradicción normativa real; `OPEN_QUESTIONS.md` permanece intacto.

M2-0 fue ejecutado sólo como gate documental: Physical DB Spec de **84 tablas**, Registry Spec, Snapshot JSON y Gate M2-0 quedaron preparados. El resultado binario es **BLOCKED / PENDING RESOLUTION**, no APPROVED/CLOSED. M2-1…M2-7 son bloques futuros y permanecen **NOT AUTHORIZED**; M2 global y M3 también. PostgreSQL/migrations/outbox, durabilidad entre procesos/nodos, realtime/WebSocket productivo, registry seed, scheduler/reglas M2, Action/Reaction/Veto, Regime Abilities, Cleanup/End Turn, objectives/victory, AuthN productiva, UI e IA permanecen **NOT STARTED / NOT AUTHORIZED**.

La suite **215/215 PASS en 27 archivos, 0 skips, 0 todo y 0 waivers** se conserva sólo como baseline aprobada; no fue reejecutada. Ningún código M2 ha iniciado.

## Próximo gate

Los documentos `MALIGN_AI_M1_VERTICAL_SLICE_IMPLEMENTATION_SPEC_v0.1.md` y `MALIGN_AI_M1_TEST_GATE_v0.1.md` fueron enmendados conforme a `DEC-065`, y el planning gate quedó aprobado mediante `DEC-066`. `MALIGN_AI_GAME_ENGINE_TEST_ACCEPTANCE_M1_ADDENDUM_v0.1.md` fija 38 IDs canónicos sin modificar el oracle v0.1.

M1-0 está formalmente cerrado mediante DEC-067, M1-1 mediante DEC-069, M1-2 mediante DEC-071 y M1-3 mediante DEC-073. M1 global está **IMPLEMENTED AND APPROVED / CLOSED**. El planning gate M2 queda **APPROVED AND CLOSED mediante DEC-076**. El próximo paso permitido es revisión humana de los artifacts M2-0 y resolución expresa de `REG-CAND-001…004`/IQ-M2-010; M2-0 sigue pendiente y no cerrado. M2-1…M2-7, M2 global y M3 permanecen **NOT AUTHORIZED**.

## Continuidad documental

Las especificaciones, decisiones y estados versionados bajo `docs/` son la fuente de verdad del desarrollo. M2-0 preserva intactos el oracle v0.1 con blob SHA `8291b56e20b9fdf55b8c01c156b66cd641b52d92`, el addendum M1 v0.1 con blob SHA `a5e140eb55b442230110e8ae77d5763401db3117`, el addendum M2 con blob SHA `6ae87a904a14a82e4fb174ff4d76eefd47052832` y el candidate registry histórico con blob SHA `fbcb750e72ae50a2bd4444789b0cfd11e75d7ab0`. Los hashes de Physical DB/Registry/Snapshot son candidatos de revisión y no implican aprobación silenciosa. No se alteran código, tests, fixtures, dependencias, arquitectura ni package boundaries.
