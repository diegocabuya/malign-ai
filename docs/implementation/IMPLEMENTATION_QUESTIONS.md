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

## IQ-M2-001 — Final checkpoint and closure evidence for M2 — OPEN

- **Evidence:** Architecture Spec §37 defines M2 as persistence + Scenario Base; M1 Spec §24 defers reactions, Veto, regimes, viral, objectives and victory; DEC-073 leaves the canonical state before Cleanup; Scenario Data §9 ends a game only when the configured turn limit is reached.
- **Exact problem:** the sources enumerate M2 capabilities but do not state whether M2 closes after one complete turn, after a persisted/recovered full game, or after infrastructure is proven independently of lifecycle completion.
- **Alternatives:** (A) close after Cleanup/End Turn returning to `INITIATIVE_STAGE`; (B) close after a BASE_2025 `turn_limit=1` golden reaches `GAME_COMPLETED`; (C) close persistence and rules as separate milestones without one global golden.
- **Recommendation:** B, using `turn_limit=1` only as a deterministic fixture and retaining all individual objective/victory gates.
- **Affected block:** M2-5 and global M2 DoD.
- **Blocking:** **YES for M2-5 authorization/closure; NO for reviewing M2-0/M2-1 documentation.**
- **Status:** OPEN / PENDING PRODUCT OWNER RESOLUTION.

## IQ-M2-002 — Physical schema choices and DSL storage — OPEN

- **Evidence:** Data Dictionary §§2,30 and Game Data Model §61 explicitly defer UUID strategy, PostgreSQL ENUM vs lookup tables, snapshot normalization, Card Effect DSL and Victory Objective evaluator representation to the physical schema phase.
- **Exact problem:** migrations cannot be designed safely until identifier generation, evolvable enums, JSON-vs-normalized boundaries and evaluator/effect storage have approved physical rules.
- **Alternatives:** (A) UUIDv7 + version/lookup tables + typed JSON DSL validated at runtime; (B) UUIDv4 + PostgreSQL ENUM + typed tables per effect; (C) ULID + mixed lookup/JSON representation.
- **Recommendation:** A for opaque sortable IDs and evolvable versioned domains, while keeping resources/VP/cards/campaigns/influence/legitimacy normalized and using JSON only where already permitted.
- **Affected block:** M2-0.
- **Blocking:** **YES before Physical DB Spec approval or migrations.**
- **Status:** OPEN / PENDING TECHNICAL APPROVAL.

## IQ-M2-003 — Authority of the complete 108-card registry snapshot — OPEN

- **Evidence:** Card & Component System v0.1 contains the 108-instance catalog but its header says `DRAFT / NO APROBADO`; DEC-025/026/029 and the oracle approve deck structure, edge cases and aliases; M1 implements only the subset required by its versioned fixtures.
- **Exact problem:** M2 requires a complete immutable registry, but silently treating the entire draft catalog as approved reference data would elevate documentary status without authorization.
- **Alternatives:** (A) approve a canonical registry snapshot/hash derived from the catalog plus DEC-025…029; (B) approve the whole Card Component document after editorial reconciliation; (C) create a separate canonical registry specification and keep the analysis document as evidence.
- **Recommendation:** C, with exact serials, definition IDs, aliases, slots, costs, triggers, effect IDs, source references and blob/hash approval before seed/migrations.
- **Affected block:** M2-0 and M2-3.
- **Blocking:** **YES for complete registry seed and full card effect implementation.**
- **Status:** OPEN / PENDING PRODUCT OWNER APPROVAL.

## IQ-M2-004 — Production AuthN scope and provider — OPEN

- **Evidence:** DEC-057/059 and Architecture §21 fix authorization/application boundaries; Interface Contract §4 requires verified `ActorContext`; the Interface Contract explicitly leaves auth provider undecided; M1 used verified in-memory session bindings.
- **Exact problem:** productive WebSocket/HTTP handshake needs authenticated identity, but neither inclusion in M2 nor provider/SDK is approved.
- **Alternatives:** (A) M2 implements a provider-neutral AuthN port plus a production adapter selected separately; (B) M2 proves transport with a signed test identity and defers productive AuthN to M3; (C) select a managed AuthN provider as part of M2.
- **Recommendation:** A at the architecture boundary, with provider selection requiring a separate approval; if no provider is approved, use B and do not call the handshake productive.
- **Affected block:** M2-2.
- **Blocking:** **YES for claiming a productive authenticated transport; NO for Engine/persistence rules.**
- **Status:** OPEN / PENDING PRODUCT OWNER RESOLUTION.

## IQ-M2-005 — Productive realtime protocol, framework and operating envelope — OPEN

- **Evidence:** DEC-053 approves HTTP + WebSocket direction; Architecture §§7/19 define semantic flow; Interface Contract §49 leaves framework, retry policy, rate limits and deployment topology undecided; M1 proves only an in-memory adapter.
- **Exact problem:** the concrete WebSocket subprotocol, auth handshake, cursor encoding, acknowledgement/retry/backpressure, heartbeat/presence and hosting/runtime are not fixed.
- **Alternatives:** (A) versioned project-owned protocol behind a neutral port on a long-lived Node server; (B) managed realtime provider adapter; (C) raw framework-specific protocol coupled to one vendor.
- **Recommendation:** A for the contract and port, leaving library/hosting/provider as a separately approved adapter decision; delivery remains at-least-once with sequence recovery.
- **Affected block:** M2-2.
- **Blocking:** **YES before productive WebSocket code or dependency selection.**
- **Status:** OPEN / PENDING TECHNICAL APPROVAL.

## IQ-M2-006 — Snapshot retention, compaction and archival policy — OPEN

- **Evidence:** Data Dictionary §§18/28 requires historical records and replay integrity; Game Data Model §44 approves a hybrid state/event model; Data Model §61 and Architecture §29 leave retention/compaction physical details open.
- **Exact problem:** snapshot cadence, archive horizon, compaction preconditions, backup/restore and completed-game retention are not specified.
- **Alternatives:** (A) retain all events/ledgers/traces, take stable checkpoint snapshots and defer compaction; (B) compact after verified reconciliation while archiving immutable logs; (C) TTL/delete historical data.
- **Recommendation:** A for initial M2, explicitly prohibiting hard-delete and requiring restore drills; revisit B only with an approved operational policy.
- **Affected block:** M2-1.
- **Blocking:** **YES for production retention/archival claims; NO for the base append-only schema if it retains everything.**
- **Status:** OPEN / PENDING PRODUCT OWNER RESOLUTION.

## IQ-M2-007 — Single-writer enforcement and PostgreSQL locking strategy — OPEN

- **Evidence:** Architecture §31 requires one logical writer per game; DEC-054 requires a transaction per command; Data Dictionary §19 lists atomic operations; the current implementation only proves in-memory CAS.
- **Exact problem:** no approved choice exists between row locking, PostgreSQL advisory locks, serializable isolation, an application queue or a combination, nor is multi-node topology fixed.
- **Alternatives:** (A) lock the game row + compare `game_version` in `READ COMMITTED`; (B) transaction-scoped advisory lock keyed by game + CAS; (C) `SERIALIZABLE` retries; (D) external per-game command queue.
- **Recommendation:** begin with A plus explicit CAS/fault tests; adopt B only if schema/test evidence requires it; do not introduce an external queue without a new approval.
- **Affected block:** M2-1 and recovery portions of M2-2.
- **Blocking:** **YES before productive multi-process concurrency implementation.**
- **Status:** OPEN / PENDING TECHNICAL APPROVAL.
