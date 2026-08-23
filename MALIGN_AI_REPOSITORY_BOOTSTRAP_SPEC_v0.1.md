# MALIGN-AI — REPOSITORY BOOTSTRAP SPECIFICATION v0.1

**Fecha:** 2026-08-22  
**Estado:** APPROVED BASELINE / HANDOFF PRE-CODEX  
**Objetivo:** especificar exactamente cómo debe inicializarse el repositorio de MALIGN-AI sin introducir todavía lógica de reglas no cubierta por especificación.

## 1. Requisito

Crear un monorepo TypeScript que soporte:

- aplicación web multijugador;
- servidor autoritativo;
- Game Engine determinístico independiente de frameworks;
- tests rule-first;
- adapters in-memory iniciales;
- PostgreSQL/realtime posteriores;
- separación total de AI respecto al motor.

## 2. Nombre de repositorio

Nombre recomendado:

```text
malign-ai
```

El nombre puede cambiar antes de crear GitHub sin impacto normativo.

## 3. Estructura inicial

```text
malign-ai/
├── apps/
│   ├── web/
│   └── server/
├── packages/
│   ├── contracts/
│   ├── domain/
│   ├── rules/
│   ├── game-engine/
│   ├── projections/
│   ├── persistence/
│   ├── authz/
│   ├── test-support/
│   └── shared/
├── tests/
│   ├── rule-unit/
│   ├── command/
│   ├── engine-integration/
│   ├── multiplayer/
│   ├── security/
│   └── replay/
├── docs/
│   ├── normative/
│   ├── architecture/
│   ├── decisions/
│   └── implementation/
├── scripts/
├── .github/
│   └── workflows/
├── README.md
├── CONTRIBUTING.md
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── eslint.config.*
├── .editorconfig
├── .gitignore
└── .env.example
```

No crear carpetas de microservicios.

## 4. Toolchain baseline

Al momento de bootstrap, Codex deberá verificar versiones estables compatibles y registrar las seleccionadas. No debe inventar versiones a partir de esta especificación.

Baseline:

- Node.js LTS vigente;
- TypeScript con `strict=true`;
- pnpm workspaces;
- ESLint;
- formatter consistente;
- Vitest o equivalente para unit/integration;
- Playwright para E2E web;
- Next.js + React en `apps/web`.

No añadir librerías de IA en M0.

## 5. Package boundaries

### `packages/domain`

Puede importar solamente:

```text
shared
```

No puede importar:

- React;
- Next.js;
- Node HTTP frameworks;
- DB clients;
- WebSocket;
- OpenAI;
- Supabase.

### `packages/rules`

Importa:

```text
domain
shared
```

Contiene definiciones versionadas, ERT, objectives, regime abilities y registry declarativo.

### `packages/game-engine`

Importa:

```text
domain
rules
contracts
shared
```

Contiene command dispatcher, validators, scheduler, adjudication, choices, reactions, reducers y traces.

### `packages/contracts`

Schemas/types de:

- commands;
- results;
- queries;
- events;
- errors;
- projection DTOs.

No contiene reglas.

### `packages/projections`

Construye:

- public projection;
- player projection;
- facilitator projection;
- future AI authorized projection.

### `packages/persistence`

Contiene ports y adapters:

- `memory`;
- futuro `postgres`.

### `apps/server`

Composition root. Puede importar todos los packages necesarios, pero no duplicar reglas.

### `apps/web`

Puede importar contracts/UI, pero **nunca persistence ni domain internals autoritativos**.

## 6. TypeScript policy

Obligatorio:

```text
strict: true
noImplicitAny: true
strictNullChecks: true
noUncheckedIndexedAccess: true
exactOptionalPropertyTypes: true
```

Si alguna opción concreta impide herramientas legítimas, Codex debe registrar la excepción en un ADR antes de relajarla.

No usar `any` en Rule Kernel/Game Engine salvo excepción documentada.

## 7. ID policy

Definiciones canónicas usan IDs semánticos estables:

```text
CYBER_ATTACK
FACT_CHECKING
ARDEN
ARDEN_PD_1
```

Instancias usan IDs opacos.

Los nombres traducidos no son claves primarias.

## 8. Version constants iniciales

Crear constantes/metadata explícitas para:

```text
ruleset_version
scenario_version
card_registry_version
engine_contract_version
```

Los valores deben reflejar las specs actuales, no versiones de npm.

## 9. Runtime validation

Todo boundary externo debe validarse en runtime:

- HTTP input;
- WebSocket input;
- persisted JSON payload;
- environment variables.

La librería concreta puede elegirse durante bootstrap, pero debe:

- funcionar bien con TypeScript;
- permitir schemas discriminados;
- no filtrarse al Domain Kernel.

## 10. Test layout

Cada test ejecutable debe conservar el ID del oracle:

```text
GE-ERT-003
GE-CUBE-001
GE-CORE-003
```

Ejemplo de nombre lógico:

```text
GE-ERT-003.base-cv-low-boundary.test.ts
```

No renombrar IDs del oracle.

## 11. Fixtures

`packages/test-support` debe proporcionar:

- participant fixtures P1..P5/F1;
- semantic PD IDs;
- canonical campaign fixtures;
- deterministic RNG;
- fixed clock;
- in-memory repositories;
- game state builders.

Evitar fixtures mágicos dispersos por tests.

## 12. Primer subset obligatorio de tests P0

El primer milestone Codex **no implementará los 217 P0 de una sola vez**.

### M0A — Rule Kernel, 15 casos

```text
GE-ERT-003  base CV low boundaries
GE-ERT-004  base CV medium boundaries
GE-ERT-005  base CV high boundaries
GE-ERT-006  slot-specific IV
GE-ERT-008  effective CV >15 remains HIGH
GE-ERT-017  roll clamps at 10
GE-ERT-018  ERT low malign row1
GE-ERT-019  ERT medium resiliency row2
GE-ERT-020  ERT high row10
GE-ERT-021  all 30 ERT cells exact
GE-CUBE-001 exact 2:1 pair
GE-CUBE-002 three incoming
GE-CUBE-003 insufficient opposition
GE-CUBE-005 no 1:1 cancellation
GE-CORE-012 global numeric invariants
```

### M0B — Command safety, 10 casos

```text
GE-CORE-001 wrong phase
GE-CORE-002 unauthorized actor
GE-CORE-003 stale version
GE-CORE-004 idempotent retry
GE-CORE-005 atomic cost failure
GE-CORE-006 paused blocks gameplay
GE-CORE-008 illegal transition
GE-CORE-010 double submit/concurrency
GE-PLAN-001 maximum 3 AP
GE-PLAN-005 no edit after lock
```

### M0C — Campaign vertical slice in-memory, 10 casos

```text
GE-CAM-001 valid Intent+Method
GE-CAM-002 missing Method invalid
GE-CAM-003 alignment mismatch
GE-CAM-004 Row I occupied
GE-CAM-005 selected slot IV
GE-CAM-008 fill empty Amplifier
GE-CAM-009 cannot modify Intent
GE-ERT-001 normal repeat activation rejected
GE-ERT-002 target DT mismatch
GE-ERT-007 bonus changes resolution tier, not cost
```

**M0 acceptance:** los 35 casos anteriores pasan sin skips ni modificaciones del oracle.

## 13. CI inicial

Desde el primer commit funcional:

- typecheck;
- lint;
- M0 tests;
- build de packages relevantes.

No bloquear bootstrap vacío por E2E o infraestructura que todavía no existe.

## 14. Branching

Baseline simple:

```text
main
feature/*
fix/*
docs/*
```

`main` debe mantenerse verde.

No adoptar GitFlow complejo.

## 15. Commits

Commits pequeños y auditables.

Formato recomendado:

```text
feat(engine): implement CV tier kernel
test(engine): add GE-ERT-003..005
docs(decision): record ADR ...
```

No es requisito normativo, pero facilita revisión.

## 16. Environment

`.env.example` puede declarar únicamente placeholders.

Nunca:

- secretos reales;
- API keys;
- passwords;
- tokens.

M0 no necesita credenciales de OpenAI.

## 17. No permitido en bootstrap

Codex NO debe:

- implementar AI/RAG;
- contratar hosting;
- crear microservicios;
- cambiar reglas;
- reescribir specs para adaptarlas al código;
- implementar todo el frontend;
- añadir SQL productivo antes del Physical DB Spec;
- usar nombres de cartas como cadenas condicionales autoritativas si existe ID canónico;
- resolver TODOs normativos inventando comportamientos.

## 18. README inicial

Debe explicar:

1. qué es MALIGN-AI;
2. estado del proyecto;
3. principio `LLM != Game Engine`;
4. web multiplayer / server authoritative;
5. cómo instalar dependencias;
6. cómo ejecutar tests M0;
7. dónde están specs normativas;
8. regla de precedencia documental.

## 19. Documentation copy

El repositorio debe incorporar en `docs/` copias versionadas de las specs aprobadas del handoff. Las specs se tratan como inputs del desarrollo.

## 20. Gate de finalización del bootstrap

Bootstrap completo cuando:

- monorepo instala limpio;
- typecheck corre;
- lint corre;
- test runner corre;
- packages respetan boundaries;
- deterministic RNG/fixed clock interfaces existen;
- in-memory repository skeleton existe;
- los 35 tests M0 están creados, inicialmente pudiendo estar failing durante TDD pero nunca skipped;
- CI ejecuta lo anterior;
- no existe lógica de IA;
- no existe DB productiva improvisada.

