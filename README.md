# MALIGN-AI

MALIGN-AI is a fidelity-first, multiplayer web implementation of the Malign serious game. Milestones M0 and M1 are **IMPLEMENTED AND APPROVED**. The final suite at M1 close reports **215/215 PASS in 27 test files, 0 skips, 0 todo and 0 waivers**.

M0 comprises the approved repository bootstrap, pure Rule Kernel, command safety, and in-memory campaign slice. M1 adds:

- GameSession, participants, seats, and setup;
- initiative and maintenance;
- hidden action planning and authorized projections;
- scheduler and campaign adjudication;
- ChoiceRequest and serializable continuations;
- ledgers, adjudication trace, snapshots, and replay;
- an in-memory/test-only realtime port and adapter;
- multiplayer reconnect and recovery tests.

## Architecture

Five players and one facilitator share a game session. The server is authoritative. The codebase is a TypeScript modular monolith with separate web and server applications, a framework-independent domain and Game Engine, server-side security projections, and persistence behind ports.

The implemented baseline consists of a pure deterministic Rule Kernel plus authoritative in-memory Game Engine and application boundaries. M1 realtime is exclusively in-memory/test-only and does not constitute production WebSocket infrastructure.

M2, M3, production PostgreSQL/outbox, cross-process or cross-node durability, production realtime/WebSocket, final UI, production authentication, AI/OpenAI/RAG, and deferred rules are **NOT STARTED / NOT AUTHORIZED**.

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

`ActorContext` is a verified application-layer boundary. A future UI may submit credentials or intent, but it must never construct authoritative `actorId`, `participantId`, `gameId`, country, or permissions values; the application layer authenticates and derives that context before invoking the Game Engine. Production authentication remains outside M1.

## Package boundaries

- `domain` depends only on `shared`.
- `rules` depends on `domain` and `shared`.
- `game-engine` depends on `domain`, `rules`, `contracts`, and `shared`.
- `apps/web` never imports persistence or authoritative domain internals.
- Production PostgreSQL/outbox, production realtime/WebSocket, final UI, production authentication, and OpenAI/RAG remain outside completed M1 and are not authorized.
- M2 and M3 work must not begin without explicit authorization.
