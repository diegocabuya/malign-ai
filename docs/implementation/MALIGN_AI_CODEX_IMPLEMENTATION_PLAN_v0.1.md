# MALIGN-AI — CODEX IMPLEMENTATION PLAN v0.1

**Fecha:** 2026-08-22  
**Estado:** READY FOR CODEX HANDOFF  
**Prerequisito:** ARC-01…ARC-12 aprobadas por Product Owner.  
**Alcance inicial:** M0 — Repository + Rule Kernel + in-memory command safety.  
**Prohibición:** No implementar IA ni modificar reglas.

## 1. Objetivo de Codex

Codex debe transformar las especificaciones aprobadas en un repositorio ejecutable **sin reinterpretar el juego**.

La prioridad inicial no es construir una UI bonita. Es demostrar:

```text
same state + same command + same choices + same RNG
= same state/events/trace
```

## 2. Fuente de verdad

Precedencia:

```text
1. Gamebooks / regla oficial
2. texto físico de carta/componente ya formalizado
3. DECISIONS APPROVED
4. Adjudication Engine Spec
5. Interface/Command Contract
6. Test & Acceptance oracle
7. Data Model / Data Dictionary
8. Architecture / Bootstrap specs
```

Si hay contradicción nueva:

**STOP. Documentar. No inventar.**

## 3. Archivos que Codex debe leer primero

En este orden:

1. `MALIGN_AI_PROJECT_STATE_v0.3.md`
2. `MALIGN_AI_DECISIONS_v0.3.md`
3. `OPEN_QUESTIONS.md`
4. `MALIGN_AI_GAME_ENGINE_IMPLEMENTATION_ARCHITECTURE_SPEC_v0.1.md`
5. `MALIGN_AI_REPOSITORY_BOOTSTRAP_SPEC_v0.1.md`
6. `MALIGN_AI_GAME_ENGINE_TEST_ACCEPTANCE_SPEC_v0.1.md`
7. `MALIGN_AI_ADJUDICATION_ENGINE_SPEC_v0.1.md`
8. `MALIGN_AI_GAME_ENGINE_INTERFACE_COMMAND_CONTRACT_SPEC_v0.1.md`
9. `MALIGN_AI_GAME_DATA_MODEL_SPEC_v0.1.md`
10. `MALIGN_AI_DATA_DICTIONARY_ER_SPEC_v0.1.md`
11. `MALIGN_AI_RULE_EFFECT_TAXONOMY_v0.2.md`
12. `MALIGN_AI_SCENARIO_DATA_SPEC_v0.1.md`
13. `MALIGN_AI_INFORMATION_SECURITY_MATRIX_v0.1.md`
14. `MALIGN_AI_CARD_COMPONENT_SYSTEM_SPEC_v0.1.md`

## 4. Regla fundamental para Codex

Codex NO está autorizado a:

- crear reglas;
- “simplificar” reglas;
- corregir el oracle para que pase el código;
- mover adjudicación al LLM;
- revelar información secreta;
- ignorar attribution de cubos;
- omitir audit trail por conveniencia;
- construir microservicios;
- acoplar Game Engine a React/Next/Postgres/OpenAI.

## 5. Milestone M0

M0 se divide en tres pull requests lógicos.

### PR-0 — Bootstrap

Entregables:

- monorepo;
- workspace;
- TypeScript strict;
- lint/format;
- test runner;
- CI;
- package skeleton;
- docs copied;
- deterministic `RandomProvider`;
- fixed `Clock`;
- repository ports e in-memory skeleton;
- no rules todavía salvo types mínimos.

Debe compilar y tener CI verde.

### PR-1 — Rule Kernel

Implementar únicamente lo necesario para estos 15 P0:

```text
GE-ERT-003
GE-ERT-004
GE-ERT-005
GE-ERT-006
GE-ERT-008
GE-ERT-017
GE-ERT-018
GE-ERT-019
GE-ERT-020
GE-ERT-021
GE-CUBE-001
GE-CUBE-002
GE-CUBE-003
GE-CUBE-005
GE-CORE-012
```

Requisitos:

- ERT como data versionada, no fórmula inventada;
- tier basado en especificación;
- mantener `raw_effective_cv`;
- clamp de roll sólo al consultar ERT;
- algoritmo 2:1 exacto;
- property tests para invariantes numéricas.

No implementar todavía cartas especiales.

### PR-2 — Command safety + campaign slice

Implementar estos 20 P0:

```text
GE-CORE-001
GE-CORE-002
GE-CORE-003
GE-CORE-004
GE-CORE-005
GE-CORE-006
GE-CORE-008
GE-CORE-010
GE-PLAN-001
GE-PLAN-005

GE-CAM-001
GE-CAM-002
GE-CAM-003
GE-CAM-004
GE-CAM-005
GE-CAM-008
GE-CAM-009
GE-ERT-001
GE-ERT-002
GE-ERT-007
```

Requisitos:

- `CommandEnvelope`;
- typed errors;
- game version;
- idempotency in-memory;
- basic actor authorization;
- action-plan lock;
- campaign creation/validation;
- target DT validation;
- basic activation eligibility;
- base/effective CV separation.

No implementar WebSocket todavía.

## 6. Definition of Done M0

M0 finaliza únicamente si:

- 35/35 tests seleccionados pasan;
- 0 skips;
- TypeScript strict;
- lint/typecheck verdes;
- no `any` no documentado en Engine;
- deterministic RNG/clock;
- no framework imports en Domain/Game Engine;
- command retry idempotente;
- test names conservan IDs del oracle;
- README explica arquitectura y ejecución;
- ningún TODO normativo sin issue/registro;
- `main` verde.

## 7. Después de M0

**STOP para revisión humana.**

No continuar automáticamente a M1.

El Product Owner/arquitecto revisará:

- código;
- tests;
- package boundaries;
- divergencias;
- nuevas preguntas.

Sólo tras aprobación se inicia M1.

## 8. M1 planificado — Multiplayer Engine Vertical Slice

Todavía no autorizado para implementación automática.

Objetivo futuro:

```text
create game
join 5 seats + facilitator
initiative
action planning hidden
lock
resolve one campaign
ERT
2:1
VP/legitimacy
authorized projections
WebSocket broadcast
reconnect
```

## 9. M2 planificado

Persistencia productiva:

- Physical DB Spec primero;
- PostgreSQL adapter;
- migrations;
- transaction-per-command;
- idempotency persistente;
- outbox;
- reconnect;
- reactions;
- Veto;
- cards/regime/viral/objectives.

## 10. M3 planificado

Web MVP:

- lobby;
- player board;
- facilitator console;
- map;
- cards;
- action planning;
- reactions/veto;
- final scoring.

## 11. Política de cambios

Si Codex descubre un problema en una spec:

1. no corregir silenciosamente;
2. crear `IMPLEMENTATION_QUESTION`;
3. citar spec y sección;
4. describir impacto;
5. proponer opciones;
6. detener sólo la parte afectada;
7. continuar únicamente trabajo no dependiente si es seguro.

## 12. Entrega de cada PR

Codex debe informar:

- archivos creados/modificados;
- tests implementados;
- tests passing/failing;
- decisiones no tomadas;
- questions/blockers;
- desviaciones cero o explícitas;
- commands para reproducir CI localmente.

## 13. Primer prompt operativo

Usar `CODEX_HANDOFF_PROMPT_v0.1.md`.

Codex debe empezar exclusivamente por **PR-0 Bootstrap** y detenerse al terminarlo para revisión, salvo que el usuario le autorice explícitamente continuar con PR-1.
