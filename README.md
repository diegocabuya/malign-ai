# MALIGN-AI

MALIGN-AI is a fidelity-first, multiplayer web implementation of the Malign serious game. Milestone M0 is **IMPLEMENTED AND APPROVED**:

- PR-0 — Repository Bootstrap: **APPROVED**;
- PR-1 — Rule Kernel: **IMPLEMENTED AND APPROVED**;
- PR-2 — Command Safety + Campaign Slice: **IMPLEMENTED AND CODE APPROVED**;
- selected M0 oracle: **35/35 PASS, 0 skips**;
- complete suite at M0 close: **55/55 PASS**.

## Architecture

Five players and one facilitator share a game session. The server is authoritative. The codebase is a TypeScript modular monolith with separate web and server applications, a framework-independent domain and Game Engine, server-side security projections, and persistence behind ports.

The implemented M0 baseline consists of a pure deterministic Rule Kernel plus in-memory command safety and a minimal campaign construction, modification, and activation-eligibility slice. Production PostgreSQL, production realtime, final UI, and OpenAI/RAG are **NOT STARTED / NOT AUTHORIZED**. M1 is **NOT AUTHORIZED**.

> **LLM != Game Engine.** AI may eventually explain or suggest actions from an authorized projection, but it never adjudicates deterministic rules.

## Requirements

- Node.js 24 LTS or newer
- pnpm 11.19.0

## Commands

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The approved specifications are versioned under `docs/`. Documentary precedence is: official Gamebooks/formalized components, approved decisions, adjudication specification, interface contract, test oracle, data model/data dictionary, then architecture/bootstrap specifications. Contradictions must become an `IMPLEMENTATION_QUESTION`; they must not be silently reconciled.

`ActorContext` is a verified application-layer boundary. A future UI may submit credentials or intent, but it must never construct authoritative `actorId`, `participantId`, `gameId`, country, or permissions values; the application layer authenticates and derives that context before invoking the Game Engine. Productive authentication remains outside M0.

## Package boundaries

- `domain` depends only on `shared`.
- `rules` depends on `domain` and `shared`.
- `game-engine` depends on `domain`, `rules`, `contracts`, and `shared`.
- `apps/web` never imports persistence or authoritative domain internals.
- Production PostgreSQL, production realtime, final UI, and OpenAI/RAG remain outside completed M0 and are not authorized.
- M1 work must not begin without explicit authorization.
