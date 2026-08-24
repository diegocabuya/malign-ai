# MALIGN-AI — M2 IMPLEMENTATION SPECIFICATION v0.1

**Fecha:** 2026-08-24
**Estado:** DOCUMENTED / PENDING REVIEW
**Autoridad:** DEC-074 — documentación únicamente
**Implementación M2:** **NOT AUTHORIZED**

> Este documento propone un plan test-first. No aprueba ninguna PTD, no resuelve ninguna `IMPLEMENTATION_QUESTION`, no selecciona proveedores y no autoriza código, tests ejecutables, migraciones, infraestructura ni ninguna subetapa M2.

## 1. Objetivo verificable y checkpoint propuesto

M2 propone convertir el vertical slice M1, hoy in-memory/test-only, en un Game Engine persistente capaz de ejecutar las reglas determinísticas diferidas y recuperarse entre procesos o nodos sin perder atomicidad, ordering, privacidad ni replay.

El checkpoint final propuesto, sujeto a `IQ-M2-001` y `PTD-M2-001`, es:

```text
checkpoint M1 aprobado
  = campaña normal resuelta en RESOLUTION_STAGE, antes de Cleanup
→ completar el scheduler del turno
→ Reaction/Veto/Action Cards/Regime Abilities cuando correspondan
→ Cleanup: campaign aging + viral
→ End Turn
→ evaluar y materializar objectives/victory cuando turn_number == turn_limit
→ persistir state + ledgers + trace + event log + outbox atómicamente
→ reiniciar proceso y recuperar desde PostgreSQL/snapshot/event log
→ reconectar viewers mediante transporte productivo autorizado
→ obtener el mismo hash, resultado y proyecciones autorizadas
```

La recomendación es cerrar M2 con un golden BASE_2025 de `turn_limit=1` únicamente como fixture determinístico, no como default de producto. Si el Product Owner elige cerrar en el siguiente `INITIATIVE_STAGE` sin completar una partida, M2-5 deberá conservar por separado los gates de objectives/victory/end game. Ninguna alternativa queda aprobada aquí.

## 2. Fuentes y precedencia

Se inspeccionaron README, PROJECT_STATE, DECISIONS, preguntas abiertas/de implementación, specs y gates M1, oracle v0.1, addendum M1, arquitectura, bootstrap, Adjudication Engine, Interface/Command Contract, Data Model, Data Dictionary/ER, Card & Component System, Scenario Data, Rule Effect Taxonomy, Information Security Matrix, inventario del código y los 27 archivos de pruebas existentes.

Rige la precedencia ya aprobada. Las decisiones DEC-001…059 y ARC-01…12 prevalecen sobre propuestas históricas. En particular ya están aprobados PostgreSQL como persistencia primaria, HTTP para commands/queries, WebSocket para realtime, una transacción PostgreSQL por command estable con Transactional Outbox, Ports & Adapters, estado normalizado + historia append-only, proyecciones server-side y AI fuera del Engine. M2 debe materializar esas decisiones; no puede reemplazarlas mediante una PTD.

## 3. Baseline M0/M1 reutilizable

M0 y M1 están **IMPLEMENTED AND APPROVED**. La suite aprobada de entrada es **215/215 PASS en 27 archivos, 0 skips, 0 todo y 0 waivers**; este gate documental no la vuelve a ejecutar.

Se reutilizan sin duplicación:

- monorepo TypeScript strict y package boundaries aprobados;
- Rule Kernel puro: base/effective CV, tier/coste, ERT exacta, roll normalizado y 2:1;
- `CommandEnvelope`, `ActorContext`, errores tipados, fingerprints, idempotencia y CAS in-memory;
- aggregate M1, GameSession/membership verificada, seats y BASE_2025;
- iniciativa, maintenance mínimo, planificación oculta y AP comprometido;
- scheduler/continuations serializables de la campaña normal;
- ledgers, event envelope, trace, snapshots, hashes RFC 8785/JCS + SHA-256 y replay in-memory;
- proyecciones owner/rival/facilitator y política fail-closed;
- realtime port/adapter in-memory test-only, cursor `game_version + last_sequence_number`, deduplicación, gaps y reconnect de pruebas;
- `RandomProvider` y `Clock` inyectables.

Inventario real relevante:

| Área | Estado M1 | Gap M2 |
|---|---|---|
| `packages/persistence` | interfaces genéricas + `InMemoryRepository` | Physical DB Spec, adapters PostgreSQL, Unit of Work, migrations y contract tests |
| `packages/domain` | aggregate/setup/adjudicación M1 | estado completo de cards, Reaction/Veto, Cleanup, objectives y outcome |
| `packages/game-engine` | scheduler de campaña normal + pending narrative/choice | scheduler completo, effect handlers, nested continuations y lifecycle completo |
| `packages/projections` | proyecciones M1 autorizadas | nuevos secretos/TemporaryReveal/votes/objectives sin leakage |
| `apps/server` | application boundary + adapter realtime de test | adapters HTTP/WebSocket y worker outbox productivos, sujetos a aprobación |
| registry | BASE_2025 suficiente para M1 | registry completo, versionado y efectos especiales |
| tests | 215 pruebas / 109 IDs canónicos ejecutados | 153 IDs oracle restantes + candidatos complementarios propuestos |

## 4. Estado inicial exacto

Todo flujo M2 parte del checkpoint aprobado por DEC-073:

- M0 y M1 cerrados;
- cinco jugadores, cinco países y F1 autenticados por el boundary de aplicación de pruebas;
- partida BASE_2025 con versiones fijadas;
- una campaña normal resuelta en `RESOLUTION_STAGE`;
- coste, d10, ERT, 2:1, influencia, legitimidad, VP, events, ledgers y trace comprometidos;
- scheduler estable, antes de Cleanup;
- no Reaction/Veto productivo, no PostgreSQL/outbox productivo y no WebSocket productivo;
- cursor M1 coherente con `game_version` y `last_sequence_number`.

La migración desde fixtures M1 a persistencia M2 debe preservar el hash de gameplay y distinguirlo del digest íntegro de snapshot. No se recalcula RNG, narrativa ni decisiones humanas.

## 5. Alcance

### 5.1 Incluido en la propuesta M2

- Physical Database & Migration Specification antes del adapter PostgreSQL;
- esquema PostgreSQL, migraciones, constraints, índices y transaction patterns;
- Unit of Work productiva, idempotencia durable, optimistic concurrency y single-writer lógico por partida;
- state/event/ledger/trace/outbox atómicos y publicación sólo post-commit;
- snapshots, event log, replay, recovery y reconciliación persistentes;
- registry completo y versionado de escenarios, cartas, aliases, slots, costes, requisitos y efectos;
- scheduler completo y continuations persistidas;
- Starter/Action Cards y comportamientos especiales;
- Reaction Engine, Veto y reglas narrativas determinísticas/facilitadas;
- Regime Abilities;
- Cleanup, campaign aging, viralización y End Turn;
- Victory Objectives, final scoring, victory y End Game;
- realtime/WebSocket productivo sobre eventos/proyecciones ya comprometidos;
- recovery/reconnect entre procesos o nodos;
- entrada manual de dado y facilitator overrides ya contratados, con auditoría;
- negative security tests para queries, feeds, sync, realtime, logs y recovery.

### 5.2 Excluido

- React/Next o UI final, lobby, Player View y Facilitator Console;
- browser E2E y UX de M3;
- OpenAI, RAG, Narrative AI, prompts o adjudicación generativa;
- acceso directo del cliente a PostgreSQL o tablas autoritativas;
- lógica de reglas, SQL, SDK de DB, WebSocket o proveedor AuthN dentro del Game Engine;
- microservicios, Event Sourcing puro o autoridad duplicada en el transporte;
- cambios a reglas, oracle v0.1 o addendum M1 v0.1;
- dos jugadores por país, escenarios custom editor y modo híbrido completo.

### 5.3 Diferido o pendiente de decisión

- proveedor AuthN y si su integración productiva pertenece a M2 (`IQ-M2-004`);
- framework/subprotocolo WebSocket, retry/backpressure y hosting (`IQ-M2-005`);
- proveedor PostgreSQL gestionado, cloud y deployment topology;
- retention/archivado/compaction de partidas (`IQ-M2-006`);
- timers como variante futura. El baseline normativo mantiene `expires_at=null`, sin auto-pass, y sólo permite force-pass/force-lock auditado por F1;
- Narrative AI/OpenAI/RAG, siempre posterior y fuera del Engine;
- UI y M3.

## 6. Descomposición propuesta

Las seis subetapas son propuestas; todas permanecen **NOT AUTHORIZED**.

| Bloque | Resultado acotado | Dependencias | Owner gate propuesto |
|---|---|---|---:|
| M2-0 | Physical DB Spec, schema/migrations y registries versionados | M1 cerrado; IQ-M2-002/003 | 8 casos nuevos + 5 regresiones |
| M2-1 | PostgreSQL Unit of Work, durable idempotency/CAS, event log, snapshots/replay y outbox | M2-0; IQ-M2-006/007 | 14 nuevos + 10 regresiones |
| M2-2 | HTTP/WebSocket productivo, delivery, reconnect/recovery y privacidad | M2-1; IQ-M2-004/005 | 8 nuevos + 17 regresiones |
| M2-3 | registry/effect interpreter, scheduler completo, Starter/Action Cards y Regime Abilities | M2-0 y M2-1 | 84 nuevos + 18 regresiones |
| M2-4 | Reaction Engine, Veto, narrativa determinística y nested continuations | M2-3 y M2-1; M2-2 para gate productivo | 23 nuevos + 10 regresiones |
| M2-5 | Cleanup, viral, End Turn, objectives, victory, End Game y golden final | M2-3/M2-4; M2-1/M2-2 | 48 nuevos + 6 regresiones |

Orden recomendado: `M2-0 → M2-1 → M2-2`; en paralelo lógico posterior a M2-1, `M2-3 → M2-4 → M2-5`. M2-5 integra todos los bloques. No se autoriza paralelismo de implementación mediante este documento.

## 7. Definition of Done y reversión por bloque

### M2-0 — Physical schema y registry

Definition of Done propuesta:

- Physical Database & Migration Spec revisada y aprobada antes de SQL productivo;
- tablas/PK/FK/UK/checks/índices trazan el Data Dictionary, sin JSON como única autoridad de datos críticos;
- migrations forward/upgrade reproducibles y fallos fail-closed;
- seed/version snapshot de BASE_2025 y registry completo exacto;
- ninguna dependencia PostgreSQL entra a domain/rules/game-engine;
- 13/13 ejecuciones asignadas y baseline anterior completo verde.

Reversión: retirar exclusivamente migration/schema/seed del bloque antes de datos productivos; conservar puertos, Engine M1 y fixtures. No hacer downgrade destructivo automático de datos sin estrategia aprobada.

### M2-1 — Persistencia transaccional y recovery

Definition of Done propuesta:

- una transacción por command estable incluye state, game version, idempotency, events, ledgers, trace y outbox;
- fallo en cualquier write revierte el conjunto;
- competing writers/CAS e idempotency entre procesos son determinísticos;
- outbox se publica sólo post-commit y tolera retry sin readjudicar;
- snapshot + event log rehidratan el mismo estado/hash sin RNG;
- reconciliation detecta divergencias y falla cerrado;
- 24/24 ejecuciones asignadas y baseline acumulado verde.

Reversión: volver al adapter in-memory mediante el mismo port; no revertir reglas ni borrar historia append-only. Las migrations propias requieren plan compatible del bloque M2-0.

### M2-2 — Transporte productivo

Definition of Done propuesta:

- commands/queries conservan HTTP y realtime usa WebSocket conforme ARC/DEC aprobadas;
- conexión se liga a identidad/membership verificada, nunca a campos del cliente;
- delivery at-least-once, ordering por `sequence_number`, dedup y gap recovery convergen;
- initial sync y reconnect no tienen ventana de pérdida entre procesos/nodos;
- omisiones privadas no se confunden con pérdida de transporte;
- fallo de socket/publicación no revierte un commit válido ni duplica adjudicación;
- 25/25 ejecuciones asignadas y baseline acumulado verde.

Reversión: apagar el adapter/gateway productivo y conservar HTTP/polling autorizado sobre state/event feed; DB, outbox y Engine permanecen.

### M2-3 — Scheduler completo, cards y abilities

Definition of Done propuesta:

- registry completo version-pinned y dispatch de efectos declarativos/handlers tipados;
- scheduler recorre planes completos y suspende sólo mediante datos serializables;
- todos los Starter/Action Cards, costes/bonuses/coalition/manual die y Regime Abilities cumplen oracle;
- ownership/control/lifecycle/single-zone, AP y ledgers permanecen exactos;
- secretos de manos, TemporaryReveal y future deck order no filtran;
- 102/102 ejecuciones asignadas y baseline acumulado verde.

Reversión: feature/version gate del ruleset impide crear partidas con registry M2; partidas M1 fijadas no migran reglas. Revertir handlers no altera datos históricos versionados.

### M2-4 — Reaction/Veto/Narrative

Definition of Done propuesta:

- priority, pass, child windows, negation y close siguen Rule Effect Taxonomy;
- Reaction/Veto/narrative usan pending interactions y continuations persistibles, sin closures vivas;
- Veto majority/tie/abuse y cards remove-after-use exactos;
- eligibility no se filtra por errores, opciones, feeds o timing;
- no auto-pass por reloj; disconnect requiere recovery o intervención F1 auditada;
- 33/33 ejecuciones asignadas y baseline acumulado verde.

Reversión: deshabilitar ruleset/registry M2 para partidas nuevas y preservar continuations/eventos históricos; nunca reinterpretar una partida activa con otra versión.

### M2-5 — Lifecycle y victoria

Definition of Done propuesta:

- campaign aging simultáneo, flags reset, viral snapshot/no-cascade y End Turn exactos;
- 18 Victory Objective IDs, awards, final VP, turn limit y tiebreak cumplen oracle;
- game completion y objective awards son atómicos e idempotentes;
- golden full-turn/full-game sobrevive restart y reconnect sin RNG nuevo;
- state/events/ledgers/trace/outbox/projections reconcilian al checkpoint elegido;
- 54/54 ejecuciones asignadas y suite mínima acumulada propuesta 400/400 verde.

Reversión: bloquear inicio de partidas con ruleset M2 si M2-5 falla; no retroceder partidas completadas ni borrar outcomes/awards append-only.

## 8. Boundaries obligatorios

```text
HTTP/WebSocket/AuthN adapters
  → application layer: identity, membership, Unit of Work, retries
    → game-engine: state + command + choices + RNG/Clock ports
      → rules: funciones puras y datos versionados
    → persistence ports: PostgreSQL transaction/outbox/snapshot/event log
    → projections/authz: redacción por viewer
  → outbox publisher: sólo artifacts comprometidos
```

- `domain`, `rules` y `game-engine` no importan SQL clients, ORM, WebSocket, React/Next, AuthN SDK u OpenAI.
- `packages/persistence` implementa ports y mappings; no decide reglas.
- `apps/server` autentica y construye `ActorContext`; no calcula outcomes.
- `projections` filtra antes de HTTP/WebSocket/logs/IA; no muta state.
- outbox/realtime transportan `ProjectedEvent`/cursors, no raw authoritative state ni raw results a rivales.

## 9. Persistencia y operación

La futura Physical DB Spec debe cubrir como mínimo:

- 61 tablas lógicas o una reconciliación explícita campo por campo;
- IDs opacos, versionado, lifecycle de definitions, PK/FK/UK/checks e índices;
- autoridad de recursos/AP/VP/influence/legitimacy/cards/deck/campaigns;
- monotonicidad y unicidad `(game_id, sequence_number)`;
- durable idempotency con fingerprint canónico;
- lock/CAS por `game_id`, version increment único y sequences contiguas;
- append-only para events, ledgers, rolls, traces, decisions y outcomes;
- outbox en la misma transaction, claim/retry/ordering/dedup;
- snapshots con schema/ruleset/scenario/registry/contract versions y hash;
- migration compatibility para partidas activas version-pinned;
- redacción de datos en observabilidad, backups/recovery y pruebas de fallos parciales;
- policy de no hard-delete histórico.

No se propone Redis, queue, ORM, managed PostgreSQL, hosting o proveedor concreto. Cualquier selección requiere aprobación separada.

## 10. Reglas y scheduler

El scheduler M2 debe completar la máquina:

```text
RESOLUTION_STAGE remaining slots
→ Action/Starter/Regime handlers
→ Reaction/Veto/Narrative/Choice/manual die continuations
→ Cleanup campaign aging
→ Cleanup viral snapshot
→ End Turn victory check
→ next INITIATIVE_STAGE o GAME_COMPLETED
```

Los efectos se resuelven mediante reglas/handlers versionados, no por nombres libres, prompts o SQL. Cada continuation conserva actor, opciones opacas, cursor, version, correlation/causation y datos suficientes para reanudar después de restart.

## 11. Seguridad y privacidad

Cada bloque debe probar owner, rival y F1, más boundary de aplicación/transport cuando aplique:

- HAND, Secret VO/progress, deck order, planes y TemporaryReveal;
- eligibility de reactions/choices sin side-channel;
- event/trace/feed/outbox/projection redacted antes del envío;
- conexión/reconnect ligados a membership vigente;
- logs/metrics sin secretos;
- errores indistinguibles cuando revelar existencia sea indebido;
- F1 recibe auditoría autorizada, pero no future deck order en vista normal;
- AI/OpenAI/RAG no existen en el path M2 y nunca reciben full state.

## 12. Matriz de trazabilidad resumida

La matriz detallada de IDs está en `MALIGN_AI_M2_TEST_GATE_v0.1.md`.

| Requisito | Fuente principal | Código esperado si se autoriza | Gate |
|---|---|---|---|
| Physical DB + migrations | Architecture §29; Data Dictionary §§3,17–30 | `packages/persistence` + migrations/spec | M2-0; `GE-E2E-006`, `GE-M2-DB-*` |
| Registry completo/versionado | Card Component; Data Model §§10–13; DEC-025/029 | domain reference data + repository/seed | M2-0/M2-3; `GE-ERT-022`, `GE-M2-DB-005/006`, `GE-M2-EFX-001` |
| Transaction per command/outbox | DEC-054; Architecture §§12–13 | Unit of Work + outbox port/adapter | M2-1; `GE-AUD-002…004`, `GE-M2-TX-*` |
| Durable idempotency/concurrency | Contract §§6–7,35 | idempotency repo + CAS/locking | M2-1; `GE-CORE-003/004/010 [REGRESSION]`, `GE-M2-TX-003…005` |
| Persistent replay/recovery | Data Dictionary §28; Contract §42 | snapshot/event/trace adapters | M2-1; `GE-AUD-004`, `GE-M2-TX-008/009` |
| Productive realtime/reconnect | DEC-053; Architecture §§7–9,19 | HTTP/WebSocket/outbox adapters | M2-2; `GE-M1-RT-001…010 [REGRESSION]`, `GE-M2-RT-*` |
| Scheduler/cards/abilities | Adjudication §§12–16,28; oracle §§8.4–8.10 | Engine handlers + registry effects | M2-3; 82 oracle owners + `GE-M2-SCH-001/EFX-001` |
| Reaction/Veto/narrative | Adjudication §§17–19; Contract §§17–20 | pending/continuation handlers | M2-4; 20 oracle owners + `GE-M2-RX-*` |
| Cleanup/viral | Adjudication §§31–32 | lifecycle/viral handlers | M2-5; `GE-CAM-011/012`, `GE-CLN-*`, `GE-VIR-*` |
| Objectives/victory/end | Scenario §§8–9; Adjudication §§33–34 | evaluator/outcome handlers | M2-5; 18 `GE-VO-*`, 5 `GE-END-*`, E2E |
| Secrets/projections | Security Matrix; DEC-057 | authz/projections before transport | todos; targeted `GE-SEC-* [REGRESSION/owner]` |

Cada requisito incluido traza a un ID real del oracle o a un candidato `PROPOSED / NON-CANONICAL / PENDING APPROVAL`.

## 13. Riesgos y mitigaciones

| Riesgo | Gate/mitigación | Bloque |
|---|---|---|
| schema físico cristaliza una interpretación no aprobada | Physical DB Spec + IQ/PTD aprobadas antes de SQL | M2-0 |
| registry DRAFT usado como autoridad silenciosa | `IQ-M2-003`, snapshot/hash y approval gate | M2-0/M2-3 |
| doble gasto o event sequence duplicado entre nodos | transaction, lock/CAS y fault injection | M2-1 |
| commit válido no publicado o publish duplicado | transactional outbox + at-least-once/dedup | M2-1/M2-2 |
| snapshot/event log divergen | replay/reconciliation fail-closed, no RNG | M2-1 |
| AuthN/provider invade Engine | application port y `IQ-M2-004` | M2-2 |
| WebSocket filtra secretos o interpreta gaps privados | projection policy común y rangos autorizados | M2-2 |
| scheduler queda bloqueado por restart | continuation persistida, no closure | M2-3/M2-4 |
| eligibility revela mano | opciones/errores/timing opacos | M2-4 |
| auto-pass inventa regla | `expires_at=null`; F1 auditado | M2-4 |
| viral/objective evaluator hardcoded | ScenarioDefinition/evaluator versionado | M2-5 |
| migration cambia reglas de partida activa | pinned versions + compatibility tests | todos |
| scope creep UI/IA/hosting | exclusiones y gates por bloque | todos |

## 14. PTD-M2 propuestas

Todas permanecen **PROPOSED FOR APPROVAL**.

| ID | Alternativas | Recomendación propuesta | Impacto |
|---|---|---|---|
| PTD-M2-001 | checkpoint next turn / game complete / persistence-only | seis bloques y golden BASE_2025 `turn_limit=1` hasta `GAME_COMPLETED`, sujeto a IQ-M2-001 | fija DoD global y orden |
| PTD-M2-002 | UUIDv7/UUIDv4/ULID; ENUM/lookup | IDs opacos ordenables + lookup/version tables para dominios evolutivos; decisión final en Physical DB Spec | schema/migrations |
| PTD-M2-003 | serializable global / row lock / advisory lock / queue | transaction `READ COMMITTED` con lock lógico por game + CAS explícito; validar con fault tests antes de aprobar | throughput y concurrencia |
| PTD-M2-004 | Event Sourcing / snapshots ad hoc / híbrido | conservar modelo aprobado: state normalizado + append-only + snapshots versionados/reconciliables | recovery/retención |
| PTD-M2-005 | at-most-once / at-least-once / exactly-once afirmado | at-least-once, ordering por sequence, dedup consumidor e idempotencia; no prometer exactly-once | outbox/realtime |
| PTD-M2-006 | protocolo propietario / provider SDK / port neutral | WebSocket detrás de port, envelope/version/cursor explícitos y HTTP como recovery source | transport portability |
| PTD-M2-007 | nombres/hardcode / JSON arbitrario / registry+handlers | registry snapshot inmutable + effect IDs declarativos + handlers tipados; nunca código/prompt arbitrario | cards/rules/replay |
| PTD-M2-008 | closures / blob opaco / union tipada persistida | continuations Reaction/Veto/Choice como unión discriminada versionada y validada runtime | restart/replay |
| PTD-M2-009 | AuthN en Engine / SDK directo / application adapter | AuthN sólo application-side mediante port/provider adapter; inclusión productiva depende IQ-M2-004 | seguridad/dependencias |
| PTD-M2-010 | auto-pass oculto / timer default / sin timer | baseline sin timers, `expires_at=null`, force-pass/lock F1 auditado; variantes sólo ScenarioRuleConfig versionada | disconnect/liveness |
| PTD-M2-011 | down migrations automáticas / roll-forward / snapshot restore | forward-only para datos históricos con rollback de despliegue + restore ensayado; detalle sujeto a Physical DB Spec | operación segura |

## 15. IMPLEMENTATION_QUESTIONS

| ID | Tema | Bloque | Estado |
|---|---|---|---|
| IQ-M2-001 | checkpoint final M2 | M2-5 | OPEN / PENDING RESOLUTION — bloquea M2-5 |
| IQ-M2-002 | IDs/enums/DSL/schema físico | M2-0 | OPEN / PENDING RESOLUTION — bloquea M2-0 |
| IQ-M2-003 | autoridad del catálogo completo de 108 cartas | M2-0/M2-3 | OPEN / PENDING RESOLUTION — bloquea registry |
| IQ-M2-004 | alcance/proveedor de AuthN productiva | M2-2 | OPEN / PENDING RESOLUTION — bloquea handshake productivo |
| IQ-M2-005 | protocolo/framework/hosting realtime | M2-2 | OPEN / PENDING RESOLUTION — bloquea adapter productivo |
| IQ-M2-006 | retention/compaction/archive | M2-1 | OPEN / PENDING RESOLUTION — bloquea política operativa, no modelo base |
| IQ-M2-007 | single-writer/locking/topology | M2-1 | OPEN / PENDING RESOLUTION — bloquea concurrencia productiva |

El detalle, evidencia, alternativas y recomendación está en `IMPLEMENTATION_QUESTIONS.md`. Ninguna IQ se resuelve en este documento. No se identificó una nueva ambigüedad de regla oficial; `OPEN_QUESTIONS.md` no requiere modificación.

## 16. Definition of Done global propuesta

M2 sólo podría declararse implementado tras autorización y revisión posteriores si:

- cada bloque autorizado cumple su DoD y rollback boundary;
- 153 IDs oracle restantes y 32 candidatos complementarios aprobados pasan;
- 66 ejecuciones `[REGRESSION]` asignadas pasan;
- la suite previa 215/215 se preserva en cada bloque;
- suite mínima acumulada propuesta alcanza 400/400, 0 skips, 0 todo y 0 waivers;
- todos los conteos state/event/ledger/trace/outbox reconcilian;
- recovery/replay no consume RNG ni IA;
- PostgreSQL/WebSocket/AuthN/React/Next/OpenAI permanecen fuera del Engine;
- no hay leakage en ningún boundary;
- las PTD necesarias están aprobadas y las IQ bloqueantes resueltas antes del bloque afectado;
- PROJECT_STATE sólo cambia a implemented/approved tras revisión técnica humana.

## 17. Gate de salida documental

Este paquete queda **DOCUMENTED / PENDING REVIEW**. DEC-074 autoriza únicamente su preparación. M2, M2-0…M2-5 y M3 permanecen **NOT AUTHORIZED**. El siguiente paso permitido es revisión humana, reconciliación de conteos, resolución/aprobación expresa de IQ/PTD y una autorización posterior separada.
