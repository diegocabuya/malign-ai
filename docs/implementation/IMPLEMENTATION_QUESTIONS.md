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
