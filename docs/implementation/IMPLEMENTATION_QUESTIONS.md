# Implementation Questions

## IQ-PR0-001 — PR-0 CI green versus 35 executable M0 tests

- **Sources:** `MALIGN_AI_REPOSITORY_BOOTSTRAP_SPEC_v0.1.md` sections 12, 13 and 20; `CODEX_HANDOFF_PROMPT_v0.1.md`.
- **Conflict:** PR-0 must not implement PR-1 rules, CI must be green, and the 35 M0 tests must exist without skips. Most of those tests require PR-1/PR-2 behavior.
- **PR-0 treatment:** preserve all 35 oracle IDs in a validated inventory, but do not create misleading passing rule tests, skipped tests, or rule implementations.
- **Options for review:** (A) approve the inventory as the PR-0 test manifest; (B) allow failing executable tests on a non-blocking TDD job; (C) move creation of executable cases into PR-1/PR-2.
- **Impact:** no production or normative behavior is blocked in PR-0.
