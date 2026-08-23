# MALIGN-AI

MALIGN-AI is a fidelity-first, multiplayer web implementation of the Malign serious game. The current state is **PR-0 Repository Bootstrap**: architecture and executable tooling only; game rules are not implemented.

## Architecture

Five players and one facilitator share a game session. The server is authoritative. The codebase is a TypeScript modular monolith with separate web and server applications, a framework-independent domain and Game Engine, server-side security projections, and persistence behind ports.

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

## Package boundaries

- `domain` depends only on `shared`.
- `rules` depends on `domain` and `shared`.
- `game-engine` depends on `domain`, `rules`, `contracts`, and `shared`.
- `apps/web` never imports persistence or authoritative domain internals.
- AI, production PostgreSQL, production realtime, final UI, and PR-1 rules are outside PR-0.
