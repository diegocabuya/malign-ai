# Implementation Questions

## IQ-PR0-001 — PR-0 CI green versus 35 executable M0 tests — RESOLVED

- **Sources:** `MALIGN_AI_REPOSITORY_BOOTSTRAP_SPEC_v0.1.md` sections 12, 13 and 20; `CODEX_HANDOFF_PROMPT_v0.1.md`.
- **Conflict:** PR-0 must not implement PR-1 rules, CI must be green, and the 35 M0 tests must exist without skips. Most of those tests require PR-1/PR-2 behavior.
- **PR-0 treatment:** preserve all 35 oracle IDs in a validated inventory, but do not create misleading passing rule tests, skipped tests, or rule implementations.
- **Options for review:** (A) approve the inventory as the PR-0 test manifest; (B) allow failing executable tests on a non-blocking TDD job; (C) move creation of executable cases into PR-1/PR-2.
- **Impact:** no production or normative behavior is blocked in PR-0.
- **Resolution:** `DEC-060` approves the validated inventory for PR-0 and requires functional tests to arrive with PR-1/PR-2 behavior while CI remains green.

## IQ-M1-001 — Canonical test IDs missing for session/realtime/reconnect — RESOLVED

- **Sources:** `MALIGN_AI_CODEX_IMPLEMENTATION_PLAN_v0.1.md` section 8; `MALIGN_AI_GAME_ENGINE_INTERFACE_COMMAND_CONTRACT_SPEC_v0.1.md` sections 10, 29, 34 and 47; `MALIGN_AI_GAME_ENGINE_TEST_ACCEPTANCE_SPEC_v0.1.md` sections 8 and 9.
- **Ambiguity:** M1 requires create game, join/seats, broadcast and reconnect, and the Interface Contract adds explicit obligations for pending-resolution recovery and projections. The 224-case oracle has no nominal IDs dedicated to create/join/seat/realtime/reconnect.
- **Impact:** el Test Gate requería IDs canónicos sin modificar el oracle v0.1.
- **Options:** (A) approve a versioned oracle addendum with canonical IDs before M1-0; (B) approve a separate canonical M1 integration-test namespace and manifest; (C) reduce M1 to the existing oracle, which would leave explicit product requirements untested.
- **Resolution:** `MALIGN_AI_GAME_ENGINE_TEST_ACCEPTANCE_M1_ADDENDUM_v0.1.md` asigna 38 IDs canónicos, preserva intacto el oracle v0.1 y queda aprobado mediante `DEC-065`.
- **Status:** RESOLVED mediante `DEC-065`.

## IQ-M1-002 — Reconnect boundary between M1 and M2 — RESOLVED

- **Sources:** `MALIGN_AI_CODEX_IMPLEMENTATION_PLAN_v0.1.md` sections 8 and 9; `MALIGN_AI_GAME_ENGINE_IMPLEMENTATION_ARCHITECTURE_SPEC_v0.1.md` sections 19 and 37; `DEC-048` and `DEC-053`.
- **Ambiguity:** the Implementation Plan includes `reconnect` in M1 and repeats it under M2; the Architecture milestone list places reconnect in M2, while the approved multiplayer baseline treats reconnection as an initial requirement.
- **Impact:** without a boundary, M1-3 could accidentally introduce PostgreSQL/outbox/productive WebSocket work or, conversely, omit recovery required by the vertical slice.
- **Options:** (A) M1 proves reconnect/recovery with serialized in-memory state, event cursor and test-only realtime adapter; M2 adds durable/process-distributed recovery; (B) move all reconnect to M2 and end M1 at authorized broadcast; (C) expand M1 to productive persistence/realtime.
- **Resolution:** M1 cubre recuperación/reconnect desde estado serializado y adapter in-memory dentro del proceso de test. M2 cubre durabilidad entre procesos/nodos, DB/outbox y transporte productivo.
- **Status:** RESOLVED mediante `DEC-065`.

## IQ-M1-003 — PRE_ROLL_REACTION treatment in a normal M1 campaign — RESOLVED

- **Sources:** `MALIGN_AI_ADJUDICATION_ENGINE_SPEC_v0.1.md` section 20.2; `MALIGN_AI_CODEX_IMPLEMENTATION_PLAN_v0.1.md` sections 8 and 9; M1 gate instruction requiring one normal campaign while Reaction/Veto remain deferred.
- **Ambiguity:** the normative activation pipeline includes a `PRE_ROLL_REACTION_WINDOW`, but M2 is the planned milestone for Reaction Engine and Veto. A campaign cannot be called end-to-end if an obligatory pipeline stage is silently skipped.
- **Impact:** M1-2 needs an explicit approved boundary for a fixture with no playable reactions, without leaking hand contents or implementing Reaction/Veto early.
- **Options:** (A) M1 deterministically evaluates that the golden fixture has no eligible reactions and records an immediate no-play stage/open-close audit result, without accepting reaction commands; (B) omit the stage in M1 and mark the trace partial; (C) move full Reaction/Veto handling into M1.
- **Resolution:** el golden M1 ejecuta y audita `PRE_ROLL_REACTION` como open/evaluate/close inmediato con cero elegibles; no acepta `PLAY_REACTION`, no inspecciona/revela manos para inferir elegibilidad y no implementa Reaction/Veto.
- **Status:** RESOLVED mediante `DEC-065`.

## IQ-M2-001 — Final checkpoint and closure evidence for M2 — RESOLVED

- **Evidence preserved:** Architecture Spec §37 defines M2 as persistence + Scenario Base; M1 Spec §24 defers reactions, Veto, regimes, viral, objectives and victory; DEC-073 leaves the canonical state before Cleanup; Scenario Data §9 ends a game only when the configured turn limit is reached.
- **Problem preserved:** the sources did not choose between one complete turn, a persisted/recovered full game or infrastructure-only closure.
- **Resolution:** DEC-075 selecciona un golden BASE_2025 determinístico con `turn_limit=1` hasta `GAME_COMPLETED`, exclusivamente como fixture; no cambia el default del producto.
- **Impact:** fija el checkpoint de M2-7 y el DoD global sin eliminar los gates individuales de objectives/victory/end game.
- **Status:** RESOLVED mediante DEC-075.

## IQ-M2-002 — Physical schema choices and DSL storage — RESOLVED

- **Evidence preserved:** Data Dictionary §§2,30 y Game Data Model §61 difieren UUID strategy, ENUM/lookup, snapshot normalization y almacenamiento de Card Effect/Victory Objective al diseño físico.
- **Problem preserved:** migrations requerían una regla aprobada para IDs, dominios evolutivos, normalización y JSON.
- **Resolution:** DEC-075 adopta UUIDv7, lookup/version tables para dominios evolutivos, estado crítico normalizado y JSON tipado/versionado sólo donde una fuente lo autorice expresamente.
- **Impact:** habilita la futura Physical Database Specification; no autoriza schema ni migrations.
- **Status:** RESOLVED mediante DEC-075.

## IQ-M2-003 — Authority of the complete 108-card registry snapshot — RESOLVED AS APPROACH

- **Evidence preserved:** Card & Component System v0.1 inventaría 108 instancias pero es `DRAFT / NO APROBADO`; DEC-025/026/029 y el oracle aprueban estructura, edge cases y aliases; M1 materializa sólo un subset de fixtures.
- **Problem preserved:** elevar silenciosamente el DRAFT a reference data canónica sería improcedente.
- **Resolution:** DEC-075 ordena una especificación separada de canonicalización del registry completo. El contenido, campos `UNRESOLVED`, snapshot y hash requieren revisión expresa antes de seed o implementación.
- **Impact:** resuelve el enfoque documental, no la autoridad del contenido. El seed y las reglas dependientes del catálogo quedan bloqueados por `IQ-M2-010`.
- **Status:** RESOLVED AS APPROACH mediante DEC-075.

## IQ-M2-004 — Production AuthN scope and provider — RESOLVED AS BOUNDARY

- **Evidence preserved:** DEC-057/059 y Architecture §21 fijan autorización/application boundaries; Interface Contract §4 exige `ActorContext` verificado y deja proveedor AuthN sin decidir; M1 usa bindings in-memory verificados.
- **Problem preserved:** HTTP/WebSocket productivo necesita identidad autenticada sin introducir SDKs dentro del Engine.
- **Resolution:** DEC-075 mantiene AuthN exclusivamente en application layer mediante port; el proveedor productivo se aprueba por separado antes del transporte.
- **Impact:** Engine y persistencia no quedan bloqueados; afirmar transporte productivo M2-2 sí queda bloqueado por `IQ-M2-008`.
- **Status:** RESOLVED AS BOUNDARY mediante DEC-075.

## IQ-M2-005 — Productive realtime protocol, framework and operating envelope — RESOLVED AS CONTRACT DIRECTION

- **Evidence preserved:** DEC-053 aprueba HTTP + WebSocket; Architecture §§7/19 define el flujo semántico; Interface Contract §49 deja framework, retry, rate limits y topology abiertos; M1 sólo prueba adapter in-memory.
- **Problem preserved:** faltaba dirección de protocolo y separación respecto de librería/proveedor/hosting.
- **Resolution:** DEC-075 adopta un protocolo versionado propio detrás de un port WebSocket, con delivery at-least-once, ordering y recovery; librería, runtime, hosting y proveedor siguen pendientes.
- **Impact:** la dirección contractual queda resuelta; la implementación productiva M2-2 queda bloqueada por `IQ-M2-009`.
- **Status:** RESOLVED AS CONTRACT DIRECTION mediante DEC-075.

## IQ-M2-006 — Snapshot retention, compaction and archival policy — RESOLVED

- **Evidence preserved:** Data Dictionary §§18/28 exige historia y replay; Game Data Model §44 aprueba state normalizado + append-only; el detalle físico se había diferido.
- **Problem preserved:** cadence, retention, compaction y restore no estaban fijados.
- **Resolution:** DEC-075 ordena preservar íntegramente events, ledgers y traces durante M2; permite snapshots estables y prohíbe compaction y hard-delete.
- **Impact:** M2-1 debe probar restore y reconciliación conservando historia completa.
- **Status:** RESOLVED mediante DEC-075.

## IQ-M2-007 — Single-writer enforcement and PostgreSQL locking strategy — RESOLVED

- **Evidence preserved:** Architecture §31 exige un writer lógico por juego; DEC-054 exige transaction por command; Data Dictionary §19 enumera atomicidad; M1 sólo prueba CAS in-memory.
- **Problem preserved:** faltaba elegir row/advisory locking, isolation y CAS para concurrencia multiproceso.
- **Resolution:** DEC-075 adopta lock transaccional de la fila `Game` más CAS explícito de `game_version` bajo `READ COMMITTED`, sujeto a fault tests.
- **Impact:** M2-1 debe demostrar un solo commit, rollback completo e idempotencia durable; no se autoriza implementación.
- **Status:** RESOLVED mediante DEC-075.

## IQ-M2-008 — Production AuthN provider — OPEN

- **Evidence:** DEC-075 fija el boundary application-side, pero no selecciona proveedor ni adapter productivo.
- **Question:** qué proveedor AuthN y qué adapter verificable se usarán para construir identidad y `ActorContext` sin confiar en claims del cliente.
- **Impact:** bloquea afirmar transporte productivo M2-2; no bloquea Engine ni persistencia.
- **Status:** OPEN / PENDING RESOLUTION.

## IQ-M2-009 — WebSocket runtime and operating envelope — OPEN

- **Evidence:** DEC-075 aprueba la dirección del protocolo, no su librería/runtime ni entorno operativo.
- **Question:** selección de librería/runtime y hosting; heartbeat; acknowledgements; retry/backpressure; límites, topology y observabilidad.
- **Impact:** bloquea implementación productiva M2-2.
- **Status:** OPEN / PENDING RESOLUTION.

## IQ-M2-010 — Registry candidate content and hash approval — PARTIALLY RESOLVED / BLOCKED BY LISTED ITEMS

- **Evidence:** DEC-075 aprobó el enfoque y DEC-076 autorizó producir artifacts candidatos, pero ninguna de las dos decisiones convierte el Card Component DRAFT en autoridad. `MALIGN_AI_CARD_REGISTRY_SPEC_v0.1.md` y `MALIGN_AI_CARD_REGISTRY_SNAPSHOT_v0.1.json` reconcilian mecánicamente 100 definitions, 108 serial templates, 4 aliases y 59 effects con status `candidate_pending_review` y `seedable=false`.
- **Propuesta reproducible preparada:** definitions `CARD_DEF_BASE_2025_D001…D100`; templates `CARD_SERIAL_BASE_2025_S001…S108`; effects `CARD_EFFECT_BASE_2025_E001…E059`; JCS SHA-256 candidato `37e1e27e142a2e08d8a19418089602bc72d775b9f5944059acc27ee4de93c83e`; JSON blob candidato `a8c3ee9f3b78113e1f94891a9b0c634083107ec3`; Registry Markdown blob candidato `6472b136a806f403747defe1d59ed44fb78f49fa`.

### REG-CAND-001 — Definition identity y mapping 108→100

- **Dato/afectados:** todos los templates `S001…S108` y definitions candidatas `D001…D100`. Revisión especial de `S095–096→D095`, `S097–098→D096`, `S099–101→D097`, `S102–103→D098`, `S104–106→D099`, `S107–108→D100`.
- **Fuentes:** DEC-025 (108=103+5); Card Component DRAFT §3; candidate histórico blob `fbcb750e72ae50a2bd4444789b0cfd11e75d7ab0`; Registry Spec §§4–5.
- **Alternativas:** (A) aprobar el mapping candidato tras comparación cara-a-cara; (B) separar cualquier grupo con diferencia material, aceptando más de 100 definitions; (C) solicitar evidencia física adicional antes de decidir.
- **Recomendación:** A sólo si revisión humana confirma igualdad exacta de nombre, tipo, alignment, IV, coste y texto/effect; de lo contrario B. Nunca forzar 100.
- **Bloqueado:** cierre M2-0; registry seed M2-1; manifest de effects M2-3; M2-4/M2-5.

### REG-CAND-002 — Contenido impreso y ausencia de efecto

- **Dato/afectados:** `D001…D100` / `S001…S108` para display name, type/subtype, alignment, slot IV, Starter flag y coste. Costes de recurso explícitos candidatos afectan S012/D012, S028/D028, S032/D032, S051/D051, S054/D054, S064/D064, S069/D069 y S088/D088. La ausencia observada de texto/effect afecta las 41 definitions cuya primera copia es S003, S004, S005, S006, S007, S011, S014, S016, S019, S022, S024, S025, S027, S029, S030, S034, S035, S036, S039, S040, S041, S044, S045, S047, S048, S050, S052, S053, S062, S067, S070, S071, S072, S076, S079, S083, S084, S089, S091, S092 y S095.
- **Fuentes:** Card Component DRAFT §3 como evidencia; DEC-025/026/039/043…047 y oracle sólo donde fijan comportamiento; Registry Snapshot `field_authority`.
- **Alternativas:** (A) aprobar campos por revisión del material físico; (B) corregir field-by-field con nueva evidencia; (C) mantener `null`/pending y no seedear.
- **Recomendación:** revisión de 108/108 caras y registro de source reference por definición; usar C hasta decisión expresa.
- **Bloqueado:** cierre M2-0; seed M2-1; slots/bonuses M2-3; Action/Starter/Regime M2-4; Reaction/Veto M2-5.

### REG-CAND-003 — Effect identity, trigger, timing y operaciones

- **Dato/afectados:** effects `E001…E059`, ligados a las definitions cuya primera copia es S001, S002, S008, S009, S010, S012, S013, S015, S017, S018, S020, S021, S023, S026, S028, S031, S032, S033, S037, S038, S042, S043, S046, S049, S051, S054, S055, S056, S057, S058, S059, S060, S061, S063, S064, S065, S066, S068, S069, S073, S074, S075, S077, S078, S080, S081, S082, S085, S086, S087, S088, S090, S093, S094, S097, S099, S102, S104 y S107.
- **Fuentes:** texto exacto Card Component DRAFT §3; Rule Effect Taxonomy v0.2; Adjudication Engine; DEC-026…029, 039, 043…047; oracle Action/Reaction/Veto/ERT. La semántica aprobada no aprueba automáticamente el binding al nuevo ID.
- **Alternativas:** (A) aprobar cada binding/operation sequence y parameters; (B) corregir mappings con una registry version nueva; (C) mantener effects pending y fuera del manifest ejecutable.
- **Recomendación:** revisión effect-by-effect contra oracle/decisions; unknown/unsupported debe fallar cerrado. Usar C hasta aprobación.
- **Bloqueado:** cierre M2-0; `GE-M2-EFX-001` completo en M2-3; M2-4; M2-5.

### REG-CAND-004 — Snapshot y hashes

- **Dato/afectados:** snapshot completo `MALIGN_AI_CARD_REGISTRY_SNAPSHOT_v0.1.json`, Registry Spec y sus digests. Hashes actuales: JCS SHA-256 `37e1e27e142a2e08d8a19418089602bc72d775b9f5944059acc27ee4de93c83e`, JSON blob `a8c3ee9f3b78113e1f94891a9b0c634083107ec3`, Markdown blob `6472b136a806f403747defe1d59ed44fb78f49fa`.
- **Fuentes:** DEC-075/076; RFC 8785/JCS contract; M2 Addendum DB/hash cases.
- **Alternativas:** (A) aprobar hashes sólo después de aprobar contenido sin cambios; (B) cambiar contenido, regenerar JCS/blobs y repetir review.
- **Recomendación:** B si cambia cualquier byte semántico; A únicamente mediante decisión posterior expresa.
- **Bloqueado:** cierre M2-0 y registry seed M2-1.

- **Status:** **PARTIALLY RESOLVED / BLOCKED BY LISTED ITEMS**. La estructura y los artifacts reproducibles existen; contenido, bindings y hashes no están aprobados.

## IQ-M2-011 — UUIDv7 generation boundary — OPEN

- **Evidence:** PTD-M2-002 exige UUIDv7 para identidades físicas, pero no aprueba versión concreta de PostgreSQL, extensión, función ni generación application-side.
- **Question:** generar UUIDv7 mediante primitive PostgreSQL aprobada, extensión auditada o port application-side con validation DB.
- **Recommendation:** decidir en el gate técnico previo al DDL y probar monotonicidad/uniqueness; no acoplar Domain a la elección.
- **Impact:** bloquea defaults/DDL exactos de PK físicas en M2-1, no el modelo documental.
- **Status:** OPEN / PENDING RESOLUTION.

## IQ-M2-012 — PostgreSQL RLS defense-in-depth — OPEN

- **Evidence:** autorización/proyección server-side está aprobada; no existe decisión sobre RLS, identity binding ni policy matrix en DB.
- **Question:** adoptar RLS como defensa adicional o restringir todas las tablas a un application role sin acceso cliente-directo.
- **Recommendation:** evaluar ambos modelos con la Information Security Matrix; cualquier ausencia de policy debe fallar cerrada, nunca habilitar acceso browser-directo.
- **Impact:** bloquea afirmar seguridad productiva del adapter M2-1/M2-2; no bloquea Rule Engine.
- **Status:** OPEN / PENDING RESOLUTION.

## IQ-M2-013 — Partitioning, archival thresholds and recovery tiers — OPEN

- **Evidence:** DEC-075 exige retención íntegra, snapshots y no compaction/hard-delete durante M2, pero no fija volúmenes, edades, RPO/RTO ni thresholds de partition/archive.
- **Question:** qué métricas disparan partitioning de events/traces/outbox y qué tiers/restore drills se requieren.
- **Recommendation:** mantener tablas no particionadas en el primer DDL hasta medir y aprobar thresholds; diseñar índices por `game_id` sin prometer topology.
- **Impact:** bloquea operating envelope/archival productivo, no el catálogo físico ni la retención íntegra de M2.
- **Status:** OPEN / PENDING RESOLUTION.
