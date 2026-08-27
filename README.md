# MALIGN-AI

MALIGN-AI is a fidelity-first, multiplayer web implementation of the Malign serious game. Milestones M0 and M1 are **IMPLEMENTED AND APPROVED**. M2-0 is **APPROVED AND CLOSED** and M2-A/M2-1 is **IMPLEMENTED / PENDING EXTERNAL REVIEW** under DEC-078. The current suite reports **237/237 PASS in 28 test files, 0 skips, 0 todo and 0 waivers**.

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

The implemented baseline consists of a pure deterministic Rule Kernel, an authoritative Game Engine and application boundaries, plus PostgreSQL 18.6 persistence behind the existing ports. M2-A adds 87 product tables, forward-only migrations, an approved registry seed, a row-lock/CAS Unit of Work, append-only journals, snapshots/recovery/reconciliation and a durable test publisher. M1 realtime remains exclusively in-memory/test-only and does not constitute production WebSocket infrastructure.

M2-2…M2-7, M2 global, M3, production realtime/WebSocket, final UI, production authentication, AI/OpenAI/RAG and deferred rules are **NOT AUTHORIZED**. M2-A contains no socket or external delivery provider.

> **LLM != Game Engine.** AI may eventually explain or suggest actions from an authorized projection, but it never adjudicates deterministic rules.

## Requirements

- Node.js 24 LTS or newer
- pnpm 11.19.0
- PostgreSQL 18.6 (`docker compose` provides the approved local version)

## Commands

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

For PostgreSQL M2-A:

```bash
cp .env.example .env
docker compose up -d postgres
pnpm db:migrate
pnpm db:seed
pnpm db:verify
pnpm test:m2a
docker compose down
```

Backup and restore drills use only explicitly named disposable databases with the `malign_m2a_` prefix:

```bash
scripts/m2a-backup.sh malign_m2a_example /tmp/malign-m2a.dump
scripts/m2a-restore.sh malign_m2a_restored /tmp/malign-m2a.dump
```

See [`docs/implementation/MALIGN_AI_M2_A_RUNBOOK_v0.1.md`](docs/implementation/MALIGN_AI_M2_A_RUNBOOK_v0.1.md) for migrations, roles, recovery, query budgets and failure handling.

The approved specifications are versioned under `docs/`. Documentary precedence is: official Gamebooks/formalized components, approved decisions, adjudication specification, interface contract, test oracle, data model/data dictionary, then architecture/bootstrap specifications. Contradictions must become an `IMPLEMENTATION_QUESTION`; they must not be silently reconciled.

`ActorContext` is a verified application-layer boundary. A future UI may submit credentials or intent, but it must never construct authoritative `actorId`, `participantId`, `gameId`, country, or permissions values; the application layer authenticates and derives that context before invoking the Game Engine. Production authentication remains outside M1.

## Package boundaries

- `domain` depends only on `shared`.
- `rules` depends on `domain` and `shared`.
- `game-engine` depends on `domain`, `rules`, `contracts`, and `shared`.
- `apps/web` never imports persistence or authoritative domain internals.
- `pg` imports are restricted to `packages/persistence`; Domain, Rules and Game Engine do not know PostgreSQL.
- M2-2…M2-7 and M3 work must not begin without explicit authorization.
