# MALIGN-AI — M1 VERTICAL SLICE IMPLEMENTATION SPECIFICATION v0.1

**Fecha:** 2026-08-23  
**Estado:** M1 PLANNING GATE AMENDED / PENDING FINAL REVIEW  
**Autoridad:** `DEC-064` autoriza el gate documental; `DEC-065` aprueba esta enmienda.  
**Test baseline M1:** `MALIGN_AI_GAME_ENGINE_TEST_ACCEPTANCE_M1_ADDENDUM_v0.1.md`  
**Implementación M1:** **NOT AUTHORIZED**

> Este documento es un plan test-first. `DEC-065` aprueba las decisiones técnicas PTD-M1-001…005 y resuelve IQ-M1-001…003 únicamente para completar el planeamiento. No aprueba una implementación, una infraestructura productiva, un proveedor de autenticación ni reglas nuevas.

## 1. Objetivo de M1

Entregar, cuando exista autorización posterior, un vertical slice determinístico y revisable que demuestre el siguiente recorrido completo:

```text
facilitador crea GameSession
→ se incorporan cinco jugadores
→ se asignan cinco seats y cinco países
→ se valida/inicia BASE_2025
→ Strategy inicial
→ iniciativa determinística
→ planificación privada y lock de los cinco jugadores
→ scheduler por iniciativa y sequence_index
→ construcción y activación de una campaña normal
→ coste/CV/ERT/dado/2:1/VP/legitimidad
→ eventos, ledgers, trace y proyecciones autorizadas
→ broadcast por adapter
→ reconnect/recovery desde estado autoritativo
```

El slice termina en un checkpoint estable posterior a la resolución de esa campaña. No pretende completar un turno entero ni una partida.

## 2. No-objetivos

Quedan expresamente fuera de M1:

- PostgreSQL, migraciones, RLS, Transactional Outbox productivo y cualquier DB productiva;
- autenticación productiva o selección de proveedor de AuthN;
- UI final, lobby visual, Player View y Facilitator Console productivos;
- infraestructura WebSocket productiva, hosting, presence distribuido y escalado;
- Reaction Cards, Veto, Narrative AI, Action Cards especiales, Regime Abilities, viralización, Cleanup completo, Victory Objectives y cierre de partida;
- scheduler completo de M2, timers, auto-pass y reglas de desconexión no definidas;
- OpenAI, RAG, prompts o cualquier autoridad de IA dentro del Game Engine;
- cambios al oracle, reglas oficiales, decisiones aprobadas, arquitectura o package boundaries.

## 3. Baseline M0 reutilizable y gaps reales

### 3.1 Reutilizable

M0 está `IMPLEMENTED AND APPROVED`, con 35/35 IDs seleccionados y suite 55/55 PASS. M1 debe reutilizar:

- monorepo TypeScript strict y boundaries `contracts`, `domain`, `rules`, `game-engine`, `projections`, `persistence`, `authz`, `test-support` y `shared`;
- `CommandEnvelope`, `ActorContext`, errores tipados, compare-and-swap e idempotencia in-memory;
- `RandomProvider`, `Clock` y adapters determinísticos de test;
- Rule Kernel puro para base/effective CV, tier/coste, ERT, clamp del roll y 2:1;
- command safety, action-plan validation/lock y campaign slice in-memory de PR-2;
- invariantes de fase, autoridad de actor, `gameId`, identidad de campaña/carta, compatibilidad de slots y single-zone.

### 3.2 Gaps observados en el repositorio

| Área | Baseline actual | Gap M1 |
|---|---|---|
| Session/setup | `GameState` comienza ya construido y sólo modela tres fases | `GameSession`, lifecycle, participantes, seats, cinco países, Strategy y setup base |
| Contracts | Envelope y resultado mínimo | comandos lifecycle/strategy/initiative, queries, pending interactions y catálogo de errores necesario |
| Engine | Dispatcher para plan/campaign mínimo | máquina de estados completa del slice, scheduler y continuations |
| RNG | port y secuencia determinística | consumo auditado para shuffle, iniciativa, rerolls y d10 de campaña |
| Cards/scenario | definiciones parciales en fixtures de PR-2 | snapshot BASE_2025, 14 PD, 5×108 instancias, starters, decks y manos iniciales |
| Campaign resolution | elegibilidad y débito de coste base | dado, ERT, 2:1, legitimidad, VP, ledgers, trace y hashes |
| Events/audit | cinco eventos mínimos sin envelope secuenciado | envelope versionado, ordering, correlation/causation, ledgers y replay |
| Projections/authz | tipos placeholder | `AuthorizedProjection` real para owner, rival y facilitador |
| Realtime/reconnect | no iniciado | port/adapter de test, cursor de eventos, recuperación y rehidratación |

Estos gaps describen trabajo futuro; no autorizan su implementación.

## 4. Participantes, GameSession, seats y authority boundaries

`GameSession` es el concepto de aplicación que agrupa una partida compartida, membership y conexión. No crea una nueva autoridad de dominio: el estado canónico sigue siendo el aggregate `Game` con `GameParticipant`, `PlayerSeat` y `GameCountry` definidos por el Data Model.

### 4.1 Topología exacta del slice

Fixtures canónicos:

| Participante | Rol | País | `seat_index` / `clockwise_index` |
|---|---|---|---:|
| F1 | FACILITATOR | — | — |
| P1 | PLAYER | ARDEN | 0 |
| P2 | PLAYER | FLUMA | 1 |
| P3 | PLAYER | URSARIA | 2 |
| P4 | PLAYER | PRESQUE | 3 |
| P5 | PLAYER | DINESIA | 4 |

El slice no admite observadores, dos jugadores por país, seats vacíos al iniciar ni cambio de país después de `START_GAME`.

### 4.2 Lifecycle mínimo

`CREATE_GAME`, ejecutado por F1, crea la instancia en `SETUP` y fija `ruleset_version`, `scenario_version`, `card_registry_version`, `engine_contract_version`, `dice_mode` y un `turn_limit` explícito. El valor de `turn_limit` procede del command del facilitador; no existe default inventado.

`ASSIGN_PLAYER_SEAT` vincula un `GameParticipant` existente con un único país y una posición circular única. `join` es responsabilidad de application/session: autentica al usuario, establece membership y construye un `ActorContext` verificado antes de invocar el Engine. El cliente nunca acredita autoridad enviando `actor_id`, `participant_id`, `country_id`, `permissions` o `game_id` dentro de un payload libre.

`START_GAME` exige exactamente F1, P1…P5 y los cinco países canónicos. Fija el snapshot inicial y las versiones; no acepta reglas libres.

### 4.3 Límites de autoridad

- La capa server/application autentica y resuelve `authenticated_session → GameParticipant → PlayerSeat → country/permissions`.
- El Engine valida que el contexto verificado pertenece al `game_id` y que la familia de command admite ese rol.
- Sólo F1 crea/configura/inicia/pausa/reanuda la partida.
- Cada jugador sólo prepara y bloquea su propio Strategy, maintenance y action plan.
- `SYSTEM` sólo ejecuta transiciones/scheduler internos; ningún cliente puede invocar `RESOLVE_NEXT_ACTION_SLOT`, mutar cubos, VP, recursos o fase directamente.
- `authz` y `projections` filtran antes de UI, realtime o futuro AI context.

## 5. Estado inicial y precondiciones BASE_2025

El fixture `scenario-base-m1.json` deberá ser datos versionados, sin lógica oculta, y contener:

- `scenario_id=BASE_2025` y cinco países `ARDEN, FLUMA, URSARIA, PRESQUE, DINESIA`;
- 14 IDs PD semánticos y sus DT aprobados;
- pilas iniciales de influencia con tipo, cantidad y atribución exactos de Scenario Data v0.1;
- resources iniciales: Arden 2, Fluma 2, Ursaria 3, Presque 3, Dinesia 4;
- turn income: Arden 2, Fluma 1, Ursaria 2, Presque 2, Dinesia 3;
- `base_ap_per_turn=3`, `strategy_deck_size=30`, cinco Starter por país y `hand_limit=10`;
- 108 `CardInstance` por país, separando cinco Starter y pool de 103 non-Starter;
- `turn_limit` como input obligatorio, nunca como valor por defecto del producto;
- `dice_mode=DIGITAL` para el golden M1; el modo manual queda fuera de este slice salvo contratos ya normativos;
- todas las versiones y fingerprints de definitions fijados al iniciar.

El Strategy inicial exige selección privada de 30 instancias únicas elegibles por jugador, shuffle mediante `RandomProvider`, cinco Starter en HAND y cinco draws secuenciales. La composición y el orden futuro del Operations Deck nunca se proyectan a rivales; el orden futuro tampoco se expone normalmente a owner, facilitador o IA.

## 6. Máquina de estados incluida

```text
SETUP
  └─ START_GAME → STRATEGY_STAGE
       └─ cinco LOCK_STRATEGY → INITIATIVE_STAGE
            └─ iniciativa + maintenance → ACTION_STAGE_PLAN
                 └─ cinco LOCK_ACTION_PLAN → ACTION_STAGE_LOCKED
                      └─ SYSTEM transition → RESOLUTION_STAGE
                           └─ scheduler resuelve hasta checkpoint M1
```

`PAUSED` es un overlay que conserva la fase. Ningún command de gameplay avanza mientras está pausado; F1 puede reanudar. Transiciones hacia Cleanup, End Turn y End Game quedan fuera del checkpoint M1.

Cada transición aceptada:

1. valida actor, fase, versión e idempotencia;
2. muta atómicamente;
3. incrementa `game_version` exactamente una vez;
4. emite eventos ordenados;
5. produce proyecciones posteriores al commit.

## 7. Iniciativa determinística

- El Game Engine recibe un `RandomProvider`; no usa `Math.random`, reloj global, red ni LLM.
- Cada P1…P5 consume un d10 en orden estable de seat.
- Si el mayor valor empata, sólo los empatados en el máximo vuelven a tirar; se repite hasta un ganador único.
- El ganador ocupa posición 1 y el resto continúa en orden clockwise desde su seat.
- Cada roll/reroll conserva `rng_request_id`, attempt, participante, valor raw y source `INITIATIVE`.
- El golden usa secuencias explícitas; agotamiento o valor fuera de 1…10 falla el test, no se reemplaza con entropía real.

## 8. Planificación oculta, lock y reveal

Cada jugador guarda 0…3 slots privados, con `sequence_index` único y contiguo 1…N. Las acciones baseline cuestan exactamente 1 AP. Antes del lock el owner puede reemplazar su plan; al lock se consumen AP y el plan deja de ser editable.

Conforme a **PTD-M1-004**, el draft se guarda server-side en el adapter in-memory; el browser no es su autoridad y reconnect puede recuperarlo antes del lock.

Visibilidad:

| Momento/viewer | Owner | Rival | Facilitador |
|---|---|---|---|
| Draft | payload completo propio | nada, ni inferencias | payload completo |
| Locked, pre-reveal | payload completo propio + status | status/count permitido, sin card IDs, action type, target o DT | payload completo |
| Slot revelado | campos públicos del slot en timing | mismos campos públicos | datos completos + auditoría |
| Slots futuros | privados | privados | visibles |

`ACTION_REVEALED` ocurre al comenzar el slot correspondiente, no al lock global. Nunca se transmite el raw `CommandResult` de un jugador a otros viewers.

## 9. Scheduler mínimo y orden intrajugador

El scheduler es interno:

```text
for participant in initiative_order:
  for action in participant.plan ordered by sequence_index:
    reveal action
    resolve until stable or pending interaction
```

El cliente no decide el próximo slot. El scheduler persiste un `PendingResolution` cuando necesita `ChoiceRequest`, input de dado manual, narrativa o intervención autorizada. M1 cubre los puntos requeridos por el golden de campaña y la elección de atribución 2:1. Conforme a `DEC-065`, el golden ejecuta y audita `PRE_ROLL_REACTION` como `open → evaluate → close` inmediato con cero elegibles; no acepta `PLAY_REACTION`, no inspecciona ni revela manos para inferir elegibilidad y no implementa Reaction/Veto.

Mientras exista una interacción pendiente:

- no avanza otro slot ni participante;
- sólo el actor designado puede responder con una opción emitida por el Engine;
- `choice_version` obsoleta, opción externa o doble submit se rechaza sin mutación;
- la continuación se reanuda desde datos serializables, nunca desde una closure viva.

## 10. Campaña normal end-to-end

### 10.1 Golden principal

El golden `full-campaign-m1.json` utiliza exclusivamente componentes ordinarios, sin bonus de pareja, Coalition, Action/Reaction Cards, Regime Ability, Boost ni core roll modifier:

- actor P1/Arden, con resources iniciales 2 + income 2 = 4;
- plan P1: slot 1 `CONSTRUCT_CAMPAIGN`, slot 2 `ACTIVATE_CAMPAIGN`; demás jugadores pasan;
- campaña MALIGN HIGH: `Temas Divisivos` serial 102 como Intent IV3, `Deepfake` serial 45 como Method IV6 y `Asesores Militares` serial 3 como Amplifier IV3;
- `base_cv=12`, cost tier HIGH y coste 3 Resources;
- `target_dt=BLACK`, `target_pd=PRESQUE_PD_1`, compatible con el escenario;
- estado previo del target: 1 RESILIENCY atribuida a Presque y sin marker de legitimidad;
- d10 DIGITAL raw 7, sin modificadores; `modified_roll_raw=7`, `ert_roll=7`;
- ERT HIGH MALIGN 7 produce +3 MALIGN atribuidos a Arden;
- 2:1 consume 2 incoming, remueve 1 RESILIENCY de Presque y coloca 1 MALIGN de Arden;
- VP: +1 por cubo colocado y +1 por establecer legitimidad; marker final Arden; delta total +2;
- resources finales de Arden tras el coste: 1.

Los números anteriores son valores de fixture derivados de Scenario Data, Card Component y ERT aprobados; no establecen un default nuevo. El fixture debe referenciar definiciones/seriales versionados, no resolver nombres por texto libre.

### 10.2 Pipeline incluido

1. validar ownership, estructura, alignment, DT y target;
2. construir/revelar campaña y target conforme timing;
3. aceptar narrativa determinística de fixture sin IA ni sanción;
4. ejecutar y auditar `PRE_ROLL_REACTION` como open/evaluate/close inmediato con cero elegibles, sin `PLAY_REACTION`, inspección/revelación de manos ni Reaction/Veto;
5. calcular `base_cv`, base tier y coste desde Rule Kernel;
6. pagar coste con `ResourceTransaction`; fallo revierte todo el command estable;
7. calcular `effective_cv` y resolution tier sin duplicar reglas;
8. consumir d10 del `RandomProvider`, conservar raw y normalizar sólo lookup;
9. consultar ERT versionada;
10. ejecutar 2:1 con ChoiceRequest si existen varias atribuciones removibles;
11. colocar remainder, puntuar VP y establecer/subvertir legitimidad;
12. persistir eventos, ledgers, `DieRoll`, `InfluenceResolution` y trace;
13. marcar la activación y continuar el scheduler.

## 11. Eventos, ledgers y AdjudicationTrace

### 11.1 Eventos mínimos del slice

`GAME_CREATED`, `GAME_STARTED`, `PHASE_CHANGED`, `PLAYER_READY_CHANGED`, `DECK_SHUFFLED`, `CARD_DRAWN`, `INITIATIVE_ROLLED`, `INITIATIVE_ORDER_SET`, `ACTION_PLAN_SAVED`, `AP_COMMITTED`, `ACTION_PLAN_LOCKED`, `ACTION_REVEALED`, `CAMPAIGN_CREATED`, `CAMPAIGN_ACTIVATION_STARTED`, `NARRATIVE_SUBMITTED`, `CAMPAIGN_COST_PAID`, `DIE_ROLLED`, `ERT_RESOLVED`, `INFLUENCE_MUTATED`, `LEGITIMACY_CHANGED`, `VP_CHANGED` y `CAMPAIGN_ACTIVATION_COMPLETED`.

Todo event usa envelope con `event_id`, `game_id`, `sequence_number`, `game_version`, schema version, actor, correlation/causation, versions fijadas, visibility policy y timestamp inyectado. `sequence_number`, no el timestamp, define orden.

### 11.2 Ledgers

- AP: allocated, spent y remaining por jugador/turno.
- Resources: `SCENARIO_SETUP`, `TURN_INCOME` y `CAMPAIGN_ACTIVATION_COST` para el golden.
- Influence: mutaciones negativas/positivas por tipo y atribución.
- Legitimacy: establishment/subversion con before/after.
- VP: `CAMPAIGN_CUBES_PLACED` y `LEGITIMACY_ESTABLISHED`/`SUBVERTED`.

Los caches deben reconciliar exactamente con sus fuentes autoritativas; no hay saldo negativo ni mutación silenciosa.

### 11.3 Trace mínimo

El `AdjudicationTrace` de la activación registra todos los campos normativos del Adjudication Spec: contexto del slot, cards/IVs, alignment/DT/PD, base/effective CV, tiers/costes, narrativa, tramo de reacciones, roll raw/modificado/normalizado, ERT, cubos generados/consumidos/removidos/colocados por atribución, legitimidad, VP, referencias de ledger/event, state hashes before/after y las cuatro versiones fijadas.

## 12. AuthorizedProjection y seguridad negativa

El state autoritativo nunca cruza el boundary de aplicación. `ProjectionBuilder` recibe state completo + viewer context y produce:

- `PlayerProjection(owner)`: estado público + HAND propia, composición propia sin orden futuro, plan face-down propio, Secret VO/progress propio y pending interactions propias;
- `PlayerProjection(rival)`: estado público, tamaños/conteos permitidos y acciones ya reveladas; nunca secretos del owner;
- `FacilitatorProjection`: estado completo de gameplay y auditoría, pero sin orden futuro del Operations Deck en la vista normal;
- `ProjectedEvent`: payload omitido o redactado por viewer antes de broadcast.

Negative assertions obligatorias:

- P2 no recibe IDs, nombres ni metadata de HAND de P1;
- P2 no recibe tipos, payloads, cards, targets ni DT de slots P1 face-down;
- P2 no recibe Secret VO, condición, metadata ni progress de P1;
- ningún viewer/AI recibe future deck order;
- errores, logs y existencia de oportunidades no confirman cartas secretas;
- F1 y P1 reciben sólo el positive access aprobado para cada clase;
- reconnect de P2 conserva exactamente las mismas redacciones que su proyección normal.

## 13. Commands, queries y errores del slice

### 13.1 Commands externos

- `CREATE_GAME`, `ASSIGN_PLAYER_SEAT`, `CONFIGURE_GAME_OPTION`, `START_GAME`, `PAUSE_GAME`, `RESUME_GAME`;
- `SUBMIT_OPERATIONS_DECK`, `LOCK_STRATEGY`;
- `REQUEST_INITIATIVE_ROLL`, `SET_INITIATIVE_MAINTENANCE`, `LOCK_INITIATIVE_MAINTENANCE` cuando el readiness explícito sea necesario;
- `SET_ACTION_PLAN`, `LOCK_ACTION_PLAN`;
- `SUBMIT_NARRATIVE`, `SUBMIT_CHOICE`;
- los payloads tipados de `CONSTRUCT_CAMPAIGN` y `ACTIVATE_CAMPAIGN` viven dentro del plan, no como autoridad libre para saltarse el scheduler.

### 13.2 Queries

- `GET_GAME_PROJECTION`;
- `GET_EVENT_FEED(after_sequence_number, limit)`;
- `GET_ADJUDICATION_TRACE` filtrada por viewer;
- `GET_RULE_CAPABILITIES`;
- private state como subproyección, no necesariamente endpoint separado.

Las queries no mutan state, version, idempotency store ni event sequence.

### 13.3 Errores mínimos

Se reutilizan los errores M0 y se completan sólo con códigos normativos ya definidos: `GAME_NOT_ACTIVE`, `UNSUPPORTED_CONTRACT_VERSION`, `UNSUPPORTED_PAYLOAD_VERSION`, `INVALID_COMMAND_PAYLOAD`, `CHOICE_NOT_AUTHORIZED`, `CHOICE_ALREADY_RESOLVED`, `CHOICE_VERSION_STALE`, `INVALID_CHOICE_OPTION`, `COST_PAYMENT_FAILED` y errores de setup/seat tipados sin detalles secretos.

No se crea un error que revele por qué un rival no posee una opción privada.

## 14. Boundaries entre Engine, projections, server y transport

```text
transport adapter
  → application/server: autentica, construye ActorContext, carga state
    → game-engine: valida/resuelve determinísticamente
      → rules: funciones puras
    → repository ports: commit in-memory atómico
    → projections/authz: redacta por viewer
  → realtime port: publica sólo ProjectedEvent/projection cursor post-commit
```

- `game-engine` no importa server, WebSocket, Next/React, DB SDK, auth provider ni OpenAI.
- `projections` no muta state ni decide reglas.
- transport no calcula autorización ni resultados.
- el server no duplica CV, ERT, 2:1 o scoring.

## 15. Realtime, broadcast y reconnect/recovery

### 15.1 Adapter aprobado para el slice

**PTD-M1-001 — APPROVED mediante DEC-065:** M1-3 usa un port realtime y un adapter in-memory/test-only. Demuestra semántica multiplayer y reconnect sin afirmar que existe infraestructura productiva. La dirección HTTP + WebSocket aprobada por `DEC-053` se conserva para un gate posterior; M1 no selecciona librería, hosting ni protocolo operativo.

WebSocket productivo, librería, hosting y protocolo operativo permanecen diferidos y no autorizados.

### 15.2 Semántica mínima

1. un command se confirma en estado/event log antes de publicar;
2. un commit produce un cursor `(game_version, last_sequence_number)`;
3. se construyen mensajes separados para público, participante y facilitador;
4. no se emite raw `CommandResult` a rivales;
5. entrega duplicada es tolerable; el cliente deduplica por `event_id/sequence_number`;
6. un gap obliga a consultar `GET_EVENT_FEED` o una proyección actual, nunca a inferir state;
7. un rollback no genera broadcast.

### 15.3 Reconnect

```text
authenticate
→ verify game membership
→ GET_GAME_PROJECTION latest authorized
→ obtain cursor
→ subscribe from cursor
→ receive only later authorized projected events
```

Si existe `PendingResolution`, sólo el actor autorizado recibe la interacción completa; los rivales reciben el estado público permitido. Presence es operacional y no altera reglas. No hay auto-pass ni timeout; F1 conserva los commands auditados definidos por contrato.

Conforme a la resolución de `IQ-M1-002` en `DEC-065`, M1 cubre recovery/reconnect desde estado serializado y adapter in-memory dentro del proceso de test. M2 cubre durabilidad entre procesos/nodos, DB/outbox y transporte productivo.

## 16. Idempotencia, concurrencia y ordering

- Unicidad propuesta ya documentada: `(game_id, actor_id, idempotency_key)` + fingerprint canónico.
- Retry mismo key/payload retorna el resultado original sin version/event/ledger/roll/trace adicional.
- Mismo key con payload distinto rechaza `IDEMPOTENCY_KEY_REUSED`.
- `expected_game_version` obsoleta rechaza antes de mutar.
- Dos locks concurrentes sólo permiten un commit CAS.
- Un command estable incrementa version una vez aunque genere múltiples eventos.
- Los events del command comparten version y reciben `sequence_number` contiguos.
- Correlation/causation enlaza command, scheduler, pending interaction y resume.

## 17. Snapshots, hashes y replay M1

M1 mantiene state actual + event log append-only, no Event Sourcing puro. Los checkpoints in-memory serializables aprobados son:

1. `GAME_STARTED` tras setup;
2. entrada a `RESOLUTION_STAGE` tras cinco locks;
3. `CAMPAIGN_ACTIVATION_COMPLETED`.

Replay de test usa snapshot inicial + eventos ordenados + RNG/choices persistidos + versiones fijadas. Nunca vuelve a tirar dados ni pide IA. Debe reconstruir el mismo state y la misma proyección autorizada en el checkpoint.

**PTD-M1-002 — APPROVED mediante DEC-065:** `state_hash` de fixtures/traces usa JSON Canonicalization Scheme **RFC 8785/JCS** y **SHA-256**. Snapshot, replay y trace deben usar exactamente el mismo contrato de canonicalization.

La recuperación M1 puede rehidratar un nuevo instance del adapter in-memory desde snapshot serializado para demostrar ausencia de closures vivas. Durabilidad entre procesos/nodos y compaction pertenecen a M2.

## 18. Fixtures y golden data requeridos

| Fixture propuesto | Contenido obligatorio |
|---|---|
| `scenario-base-m1.json` | BASE_2025, cinco países, 14 PD/DT, influencia atribuida, resources/income y reglas de setup |
| `participants-five-plus-facilitator.json` | F1, P1…P5, roles, seats, clockwise y country mapping exactos |
| `cards-registry-m1.json` | snapshot versionado suficiente para 5×108 instancias, starters/decks y golden de campaña |
| `strategy-five-players.json` | 30 IDs únicos elegibles por país, secuencias RNG de shuffle y cinco draws |
| `initiative-ties-m1.json` | secuencias de `GE-INI-001…003` y consumo exacto del provider |
| `hidden-plans-m1.json` | drafts/locks de P1…P5 y proyecciones owner/rival/facilitator |
| `full-campaign-m1.json` | golden exacto de §10 con pre/post state, events, ledgers y trace |
| `pd-mixed-attribution.json` | opciones exactas para `GE-CUBE-004` y suspensión/reanudación |
| `reconnect-checkpoints-m1.json` | snapshots, cursor, event gap, pending interaction y proyecciones por viewer |

Los nombres son propuestas técnicas. El contenido normativo se deriva de fuentes versionadas y no se genera dinámicamente desde fórmulas inventadas.

Los expected results e IDs canónicos de estos fixtures se fijan en `MALIGN_AI_GAME_ENGINE_TEST_ACCEPTANCE_M1_ADDENDUM_v0.1.md` y `MALIGN_AI_M1_TEST_GATE_v0.1.md`.

## 19. Descomposición propuesta en PRs

| PR | Alcance | Dependencia | Gate independiente |
|---|---|---|---|
| M1-0 | session/seats/setup contracts + state y adapters in-memory | M0 | lifecycle/setup/authority; ningún scheduler |
| M1-1 | initiative + maintenance mínimo + hidden planning + AuthorizedProjection | M1-0 | determinismo y cero leakage; ninguna adjudicación completa |
| M1-2 | scheduler + una campaña completa + choices/continuation + trace/ledgers/replay | M1-1 | golden determinístico; ningún transport productivo |
| M1-3 | realtime port/adapter de test + reconnect/recovery + multiplayer integration | M1-2 | broadcast segmentado y reconnect sin leakage |

Se conserva la descomposición sugerida porque cada PR añade un único eje de riesgo y puede rechazarse sin mezclar infraestructura productiva. `DEC-065` resuelve las IQ y aprueba las PTD del gate, pero M1-0 continúa sin autorización de implementación.

## 20. Riesgos, dependencias y rollback boundaries

| Riesgo | Mitigación/gate | Rollback boundary |
|---|---|---|
| Leakage por proyección o broadcast | tests positive+negative por viewer; redacción server-side | revertir M1-1/M1-3 sin tocar Rule Kernel |
| Scope creep hacia M2 | adapters in-memory; lista de no-objetivos | cada PR se detiene en su gate |
| Estado suspendido no recuperable | continuation serializable + rehydrate test | revertir scheduler M1-2 |
| Divergencia entre cache/ledger/event | reconciliation y no-silent-mutation tests | command transaction atómica |
| RNG consumido en orden distinto | secuencias exhaustivas y roll auditado | provider/test fixture versionado |
| Card/Scenario registry incompleto | fixtures fijados y fingerprints | bloquear sólo fixture afectado; no inventar definitions |
| Confundir reconnect in-memory con durabilidad productiva | boundary aprobado por `DEC-065` | M1 sólo rehidrata dentro del proceso de test; M2 conserva DB/outbox/transporte productivo |
| Adelantar Reaction/Veto desde la campaña normal | resolución de `IQ-M1-003` | sólo PRE_ROLL open/evaluate/close con cero elegibles y sin commands de reacción |

Cada PR debe ser revertible sin migraciones, datos productivos ni compatibilidad de red pública, porque M1 no introduce esos elementos.

## 21. Decisiones técnicas aprobadas para el gate

`DEC-065` aprueba documentalmente:

1. **PTD-M1-001 — APPROVED:** realtime port + adapter in-memory/test-only en M1-3; WebSocket productivo permanece diferido.
2. **PTD-M1-002 — APPROVED:** RFC 8785/JCS + SHA-256 para state hashes.
3. **PTD-M1-003 — APPROVED:** el checkpoint M1 termina tras una campaña normal resuelta en `RESOLUTION_STAGE`, antes de Cleanup; Cleanup/End Turn no forman parte del slice.
4. **PTD-M1-004 — APPROVED:** action-plan draft server-side en adapter in-memory antes del lock para soportar reconnect sin usar estado local del browser como autoridad.
5. **PTD-M1-005 — APPROVED:** cursor realtime compuesto por `game_version + last_sequence_number`; `sequence_number` conserva autoridad de ordering.

Estas aprobaciones fijan el plan; no autorizan escribir código.

## 22. IMPLEMENTATION_QUESTIONS resueltas

- `IQ-M1-001 — RESOLVED`: el addendum M1 v0.1 asigna 38 IDs canónicos sin modificar el oracle v0.1.
- `IQ-M1-002 — RESOLVED`: M1 cubre reconnect/recovery desde estado serializado y adapter in-memory dentro del proceso de test; M2 conserva durabilidad entre procesos/nodos, DB/outbox y transporte productivo.
- `IQ-M1-003 — RESOLVED`: el golden audita PRE_ROLL_REACTION como open/evaluate/close inmediato con cero elegibles, sin `PLAY_REACTION`, inspección/revelación de manos ni Reaction/Veto.

Las resoluciones completas están en `docs/implementation/IMPLEMENTATION_QUESTIONS.md` y `DEC-065`.

## 23. Definition of Done M1

M1 sólo podrá declararse implementado cuando una autorización futura defina el alcance y, después:

- los cuatro PR gates aprobados individualmente;
- los 49 IDs oracle v0.1 y 38 IDs addendum M1 asignados pasan;
- suite M0 55/55 permanece verde en cada PR;
- 0 `skip`, 0 `todo`, 0 tests falsamente verdes;
- typecheck, lint, test y build verdes;
- mismo state + command + choices + RNG produce mismo state/events/ledgers/trace/projections;
- cinco jugadores, cinco países y F1 completan el recorrido del slice;
- full campaign golden coincide exactamente;
- state/event/ledger/trace hashes y replay coinciden;
- cero leakage en owner/rival/facilitator, event feed, errors y reconnect;
- idempotencia, stale version, double submit y one-version-per-commit pasan;
- ninguna dependencia de DB, WebSocket productivo, React/Next, auth provider u OpenAI entra al Engine;
- todas las PTD necesarias están aprobadas y las IQ que bloquean el PR están resueltas;
- PROJECT_STATE se actualiza sólo tras revisión humana.

## 24. Diferido a M2/M3

### M2

- Physical DB Spec, PostgreSQL, migraciones, transacciones productivas y outbox;
- idempotencia/durabilidad productiva y recovery entre procesos/nodos;
- Reaction Engine, Veto, Action Cards especiales, Regime Abilities, viral, Cleanup, objectives y victory;
- registry completo más allá del subset versionado necesario;
- realtime/WebSocket productivo si se aprueba el adapter de test para M1.

### M3

- lobby/UI final, Player View, Facilitator Console, mapa, mano, campañas y UX de interacción;
- pruebas browser E2E y despliegue de producto.

OpenAI/RAG permanece posterior al MVP determinístico y siempre fuera del Game Engine.

## 25. Gate de salida documental

`DEC-065` aprueba el addendum, PTD-M1-001…005 y las resoluciones de IQ-M1-001…003. El próximo paso permitido es únicamente la revisión final de esta enmienda documental.

Este spec no autoriza M1-0. Iniciar cualquier PR de implementación requiere una autorización posterior y expresa: **M1 IMPLEMENTATION NOT AUTHORIZED**.
