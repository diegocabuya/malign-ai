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

## IQ-M2-008 — Production AuthN provider — RESOLVED

- **Resolution DEC-081 / PTD-M2-012…013:** Auth0 queda como proveedor productivo de referencia detrás de un port exclusivo de application layer. El flujo será Authorization Code con PKCE y sesión BFF/server-side; cookies `HttpOnly`, `Secure` y `SameSite`; access token de Custom API corto —default inicial 300 segundos configurable— entregado por endpoint BFF protegido y conservado sólo en memoria; refresh token sólo server-side y con rotación si se usa.
- **Validation:** issuer, audience, firma RS256/JWKS, `exp`, `nbf` cuando exista, `azp`/client binding y scopes. El único identificador externo vinculable es `sub` verificado.
- **Authority boundary:** membership, `participantId`, seat, `actorType`, `gameId`, roles y permisos se resuelven desde PostgreSQL; jamás desde claims o autoridad aportada por el cliente. `game_participants.external_user_ref` puede conservar `sub` sin ampliar las 87 tablas.
- **Enrollment/logout:** invitation-only/allowlisted; email verificado no autoriza partidas. Back-channel logout no es baseline por depender de Enterprise; baseline invalida sesión local, cierra sockets y limita acceso residual mediante expiración corta.
- **Future boundary:** cuenta, tenant, plan, secrets, contratación, SDK y versión exacta requieren autorización posterior. Esta resolución no autoriza implementación M2-2.
- **Status:** **RESOLVED mediante DEC-081**.

## IQ-M2-009 — WebSocket runtime and operating envelope — RESOLVED

- **Resolution DEC-081 / PTD-M2-013…016:** protocolo propio `malign.realtime.v1` sobre WSS, Node.js 24 LTS y `ws` detrás del port de transporte; browser WebSocket nativo; servidor `noServer`/HTTP upgrade. Render queda como target productivo de referencia. PostgreSQL 18 `LISTEN/NOTIFY` es sólo wake-up efímero; outbox/event log/snapshots/feed son autoridad durable.
- **Authentication:** primer frame `AUTHENTICATE` dentro de 5 segundos; sin token en URL/query/cookie de autoridad/subprotocolo; Origin allowlist; AuthN por port y membership/AuthZ PostgreSQL; expiry obliga token nuevo y reconnect; fallo opaco 1008.
- **Envelope configurable:** ping 30 s, terminación tras dos pong ausentes, inbound 64 KiB, backpressure 256 mensajes o 1 MiB, overload 1013, backoff full-jitter 500 ms…30 s, draining/SIGTERM y recovery a cualquier nodo.
- **Topology:** mínimo dos instancias stateless para production, publisher separado y PostgreSQL 18 en misma región/red privada; baseline certificado 18.6. No Redis/broker baseline.
- **Future boundary:** versión exacta de `ws`, plan, región, costos, cuenta, secrets, infraestructura y deployment requieren autorización separada. Esta resolución no autoriza implementación M2-2.
- **Status:** **RESOLVED mediante DEC-081**.

## IQ-M2-010 — Registry content and hash approval — RESOLVED

- **Evidence:** DEC-075 aprobó el enfoque, DEC-076 autorizó producir artifacts y DEC-077 aprobó su contenido y hashes tras una finalización exclusivamente mecánica. El snapshot queda `approved` y `seedable=true`.
- **Artifacts aprobados:** definitions `CARD_DEF_BASE_2025_D001…D100`; templates `CARD_SERIAL_BASE_2025_S001…S108`; effects `CARD_EFFECT_BASE_2025_E001…E059`; JCS final `735fd01b65416bdeb1baaa596bb36ea0d0eef31cb1d1d9b7f4b2322c9c585e4a`; snapshot blob `8d5c150bed742391555bc6bafe022f45baee0163`; Registry Spec blob `d7d1325da916f4f867c4a142f8e345d66eaa780e`; Physical DB blob `13cd601b30db2db22be64c4fda5df94144dcf8d5`; Review Matrix blob `cefed690a7c2068f9fe868efaa3df4b2e504e508`.
- **Semantic freeze:** JCS candidato anterior `eb98696020d3694acd8a3374d27ec064ef6db16fd6ea083bb4eaeaac9b30ba74`; proyección semántica antes/después 264610 bytes y SHA-256 `8a46133ca70883df2d173fddd9c725cd0611b2be8311a5fe42057464415d6a13`.

### REG-CAND-001 — Definition identity y mapping 108→100

- **Dato/afectados:** todos los templates `S001…S108` y definitions candidatas `D001…D100`. Revisión especial de `S095–096→D095`, `S097–098→D096`, `S099–101→D097`, `S102–103→D098`, `S104–106→D099`, `S107–108→D100`.
- **Fuentes:** DEC-025 (108=103+5); Card Component DRAFT §3; candidate histórico blob `fbcb750e72ae50a2bd4444789b0cfd11e75d7ab0`; Registry Spec §§4–5.
- **Alternativas:** (A) aprobar el mapping candidato tras comparación cara-a-cara; (B) separar cualquier grupo con diferencia material, aceptando más de 100 definitions; (C) solicitar evidencia física adicional antes de decidir.
- **Recomendación:** A sólo si revisión humana confirma igualdad exacta de nombre, tipo, alignment, IV, coste y texto/effect; de lo contrario B. Nunca forzar 100.
- **Resolution DEC-077:** REG-CAND-001 APPROVED. El mapping, IDs y seis grupos quedan congelados.

### REG-CAND-002 — Contenido impreso y ausencia de efecto

- **Dato/afectados:** `D001…D100` / `S001…S108` para display name, type/subtype, alignment, slot IV, Starter flag y coste. Costes de recurso explícitos candidatos afectan S012/D012, S028/D028, S032/D032, S051/D051, S054/D054, S064/D064, S069/D069 y S088/D088. La ausencia observada de texto/effect afecta las 41 definitions cuya primera copia es S003, S004, S005, S006, S007, S011, S014, S016, S019, S022, S024, S025, S027, S029, S030, S034, S035, S036, S039, S040, S041, S044, S045, S047, S048, S050, S052, S053, S062, S067, S070, S071, S072, S076, S079, S083, S084, S089, S091, S092 y S095.
- **Fuentes:** Card Component DRAFT §3 como evidencia; DEC-025/026/039/043…047 y oracle sólo donde fijan comportamiento; Registry Snapshot `field_authority`.
- **Alternativas:** (A) aprobar campos por revisión del material físico; (B) corregir field-by-field con nueva evidencia; (C) mantener `null`/pending y no seedear.
- **Recomendación:** revisión de 108/108 caras y registro de source reference por definición; usar C hasta decisión expresa.
- **Resolution DEC-077:** REG-CAND-002 APPROVED. Contenido impreso, aliases, clasificación, IV, costes, flags, cinco Starter y 41 ausencias quedan aprobados.

### REG-CAND-003 — Effect identity, trigger, timing y operaciones

- **Dato/afectados:** effects `E001…E059`, ligados a las definitions cuya primera copia es S001, S002, S008, S009, S010, S012, S013, S015, S017, S018, S020, S021, S023, S026, S028, S031, S032, S033, S037, S038, S042, S043, S046, S049, S051, S054, S055, S056, S057, S058, S059, S060, S061, S063, S064, S065, S066, S068, S069, S073, S074, S075, S077, S078, S080, S081, S082, S085, S086, S087, S088, S090, S093, S094, S097, S099, S102, S104 y S107.
- **Fuentes:** texto exacto Card Component DRAFT §3; Rule Effect Taxonomy v0.2; Adjudication Engine; DEC-026…029, 039, 043…047; oracle Action/Reaction/Veto/ERT. La semántica aprobada no aprueba automáticamente el binding al nuevo ID.
- **Alternativas:** (A) aprobar cada binding/operation sequence y parameters; (B) corregir mappings con una registry version nueva; (C) mantener effects pending y fuera del manifest ejecutable.
- **Recomendación:** revisión effect-by-effect contra oracle/decisions; unknown/unsupported debe fallar cerrado. Usar C hasta aprobación.
- **Resolution DEC-077:** REG-CAND-003 APPROVED. Effect IDs, triggers, timings, 103 operaciones, orden, parámetros, E021 y bindings 26/28 quedan aprobados.

### REG-CAND-004 — Snapshot y hashes

- **Dato/afectados:** snapshot completo, Registry Spec, Physical Database Spec, Review Matrix y sus digests finales registrados arriba.
- **Fuentes:** DEC-075/076; RFC 8785/JCS contract; M2 Addendum DB/hash cases.
- **Alternativas:** (A) aprobar hashes sólo después de aprobar contenido sin cambios; (B) cambiar contenido, regenerar JCS/blobs y repetir review.
- **Recomendación:** B si cambia cualquier byte semántico; A únicamente mediante decisión posterior expresa.
- **Resolution DEC-077:** REG-CAND-004 APPROVED con hashes finales. M2-0 queda cerrado; M2-1/M2-A continúa NOT AUTHORIZED.

- **Status:** **RESOLVED mediante DEC-077**. REG-CAND-001…004 están aprobadas y M2-0 cerrado; esta resolución no autoriza código, migrations ni seed.

## IQ-M2-011 — UUIDv7 generation boundary — RESOLVED

- **Evidence:** PTD-M2-002 exige UUIDv7 para identidades físicas, pero no aprueba versión concreta de PostgreSQL, extensión, función ni generación application-side.
- **Resolution DEC-078:** PostgreSQL 18.6 genera UUIDv7 mediante `uuidv7()` sin extensión; las PK físicas usan `DEFAULT uuidv7()` y `uuid_extract_version(id)=7`; el adapter obtiene identidades con `RETURNING`; Domain y Game Engine permanecen desacoplados.
- **Acceptance:** pruebas reales de version, uniqueness y orden temporal controlado.
- **Status:** **RESOLVED mediante DEC-078**.

## IQ-M2-012 — PostgreSQL RLS defense-in-depth — RESOLVED

- **Evidence:** autorización/proyección server-side está aprobada; no existe decisión sobre RLS, identity binding ni policy matrix en DB.
- **Resolution DEC-078:** M2-A no usa RLS. Se prohíbe acceso DB directo desde browser/cliente y se separan migration owner, application runtime y outbox publisher con mínimo privilegio y `REVOKE` de `PUBLIC`. AuthZ y proyecciones fail-closed permanecen en application layer; toda consulta es game-scoped.
- **Future boundary:** cualquier RLS futuro requiere decisión expresa.
- **Status:** **RESOLVED mediante DEC-078**.

## IQ-M2-013 — Partitioning, archival thresholds and recovery tiers — RESOLVED FOR M2

- **Evidence:** DEC-075 exige retención íntegra, snapshots y no compaction/hard-delete durante M2, pero no fija volúmenes, edades, RPO/RTO ni thresholds de partition/archive.
- **Resolution DEC-078:** durante M2 las tablas permanecen no particionadas, con conservación íntegra, sin compaction, archival ni hard-delete. Se instrumentan métricas, query counts y planes.
- **Future boundary:** cualquier particionado, tier o política de archivo requiere evidencia y nueva aprobación.
- **Status:** **RESOLVED FOR M2 mediante DEC-078**.

## IQ-M2-014 — Canonical CountryDefinition mascot values — RESOLVED

- **Primary normative source:** `Malign-Influence-Rulebook_ENGLISH.pdf`, section 13 “Countries and Characteristics”, pages 19–20.
- **Official values:** `ARDEN=Tree`; `FLUMA=Tree and River`; `URSARIA=Bear`; `PRESQUE=Horse`; `DINESIA=Shark`.
- **Classification:** official rule/gamebook data; these literals are neither interpretation nor proposal.
- **Resolution DEC-079:** preserve `country_definitions.mascot` as `NOT NULL`, create no nullable migration, remove the `mascot=logical_id` placeholder and persist exactly the five official literals with the source reference above. Gamebooks, oracle, addenda and the approved registry remain unchanged.
- **Status:** **RESOLVED mediante DEC-079**.

## IQ-M2-015 — Published migration 003 versus migration-role-only execution — RESOLVED

- **Resolution DEC-079:** migration `003` is an exceptional, separate, idempotent cluster-level administrative bootstrap because role creation, role membership, ownership and database grants require authority superior to the provisioned `NOLOGIN` migration owner.
- **Execution contract:** the administrative bootstrap creates `malign_migration_owner`, `malign_app_runtime` and `malign_outbox_publisher` if absent, preserves all three as `NOLOGIN` and minimum privilege, grants only the authorized migrator membership needed for `SET ROLE malign_migration_owner`, and stores no credentials. Migrations `001` and `002` run under `SET ROLE malign_migration_owner`; `003` runs under bootstrap administrative authority without byte or checksum changes; `004` and `005+` run under `SET ROLE malign_migration_owner`.
- **Verification contract:** audit expected `session_user/current_user` at every stage; application UoW runs as `malign_app_runtime`; publisher runs as `malign_outbox_publisher`; administrative credentials are never exposed to runtime, publisher, browser or gameplay.
- **Status:** **RESOLVED mediante DEC-079**.
