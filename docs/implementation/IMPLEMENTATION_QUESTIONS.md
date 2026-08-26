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

## IQ-M2-010 — Registry candidate content and hash approval — OPEN

- **Evidence:** DEC-075 sólo aprueba el enfoque; el candidato deriva 108 seriales/100 nombres del documento DRAFT y conserva campos sin autoridad como `UNRESOLVED`.
- **Question:** revisar las 108 instancias/100 definiciones, resolver todos los campos `UNRESOLVED` y aprobar expresamente snapshot y blob hash.
- **Impact:** bloquea registry seed y reglas de M2-3/M2-4 dependientes del catálogo.
- **Status:** OPEN / PENDING RESOLUTION.
