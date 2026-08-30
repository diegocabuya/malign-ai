# MALIGN-AI

MALIGN-AI is a fidelity-first, multiplayer web implementation of the Malign serious game. M0 and M1 are approved/closed, M2-0 and M2-A/M2-1 are approved/closed, and M2-2 Productive Transport and Reconnect is **IMPLEMENTED / PENDING REVIEW under DEC-082**. The current suite reports **288/288 PASS in 32 test files, 0 skips, 0 todo and 0 waivers**.

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

The implemented baseline consists of a pure deterministic Rule Kernel, an authoritative Game Engine and application boundaries, the approved M2-A persistence stack, and the review-pending M2-2 transport:

- PostgreSQL 18.6 with 87 product tables and six forward-only SQL migrations;
- the approved, versioned registry seed;
- `READ COMMITTED` transactions with a locked Game row and explicit `game_version` CAS;
- durable idempotency and atomic events, ledgers, adjudication traces, snapshots and replay;
- versioned continuations, recovery and exact three-authority reconciliation;
- a durable transactional outbox with separate message, delivery-state and attempt history;
- backup/restore drills and fault-injection coverage;
- separate, least-privilege PostgreSQL roles for migration ownership, application runtime and outbox publishing.
- Auth0-compatible BFF/session boundary and an application-layer RS256/JWKS identity adapter;
- authoritative HTTP/HTTPS commands, projections and feed;
- WSS `malign.realtime.v1` with first-frame authentication, authorized subscriptions, sync, ACK, gaps/resync and reconnect;
- durable outbox wake-up and stateless multi-node fan-out through PostgreSQL `LISTEN/NOTIFY`;
- heartbeat, bounded backpressure, token/session invalidation, graceful draining and redacted in-process telemetry.

M1's deterministic projection/feed policy remains the single authorization source reused by M2-2; WebSocket never adjudicates gameplay commands.

No Auth0 tenant/account, cloud provider, hosting deployment, productive secrets, final UI, or AI/OpenAI/RAG exists. M2-3…M2-7 remain **NOT AUTHORIZED**, M2 global is **NOT YET CLOSED**, and M3 remains **NOT STARTED / NOT AUTHORIZED**. M2-2 is not approved or closed until external review.

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
pnpm test:m2-2
docker compose down
```

Backup and restore drills use only explicitly named disposable databases with the `malign_m2a_` prefix:

```bash
scripts/m2a-backup.sh malign_m2a_example /tmp/malign-m2a.dump
scripts/m2a-restore.sh malign_m2a_restored /tmp/malign-m2a.dump
```

See [`docs/implementation/MALIGN_AI_M2_A_RUNBOOK_v0.1.md`](docs/implementation/MALIGN_AI_M2_A_RUNBOOK_v0.1.md) for migrations, roles, recovery, query budgets and failure handling.

M2-2 fixes `ws@8.21.3`, `@types/ws@8.18.1`, `jose@6.2.10` and `@auth0/nextjs-auth0@4.28.0`. Copy `.env.example` and provide local/test values; productive AuthN and TLS fail closed when configuration is absent. The BFF performs no Auth0 discovery during build and retains refresh tokens only server-side when configured.

The approved specifications are versioned under `docs/`. Documentary precedence is: official Gamebooks/formalized components, approved decisions, adjudication specification, interface contract, test oracle, data model/data dictionary, then architecture/bootstrap specifications. Contradictions must become an `IMPLEMENTATION_QUESTION`; they must not be silently reconciled.

`ActorContext` is a verified application-layer boundary. The client may submit credentials or intent, but it never constructs authoritative `actorId`, `participantId`, `gameId`, country, role, seat or permissions; M2-2 verifies external identity and derives authority from PostgreSQL before invoking the application port.

## Package boundaries

- `domain` depends only on `shared`.
- `rules` depends on `domain` and `shared`.
- `game-engine` depends on `domain`, `rules`, `contracts`, and `shared`.
- `apps/web` never imports persistence or authoritative domain internals.
- PostgreSQL access remains in persistence/infrastructure adapters; Domain, Rules and Game Engine do not know PostgreSQL.
- `jose`, Auth0, HTTP and WebSocket imports are absent from Domain, Rules and Game Engine.
- M2-3…M2-7 and M3 work must not begin without explicit authorization.
