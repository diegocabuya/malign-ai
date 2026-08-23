# MALIGN-AI — GAME ENGINE IMPLEMENTATION ARCHITECTURE SPECIFICATION v0.1

**Fecha:** 2026-08-22  
**Fase:** FASE 2 — arquitectura previa a implementación  
**Estado:** PROPUESTA TÉCNICA PARA APROBACIÓN  
**Código:** NO iniciado

## 1. Requisito rector

MALIGN-AI se implementará como una **plataforma web multijugador de sesión compartida** para cinco jugadores y un facilitador. El backend será autoritativo; todos participan en la misma `GameSession`, pero reciben proyecciones distintas de acuerdo con rol, permisos e información oculta.

```text
PLAYER 1 ─┐
PLAYER 2 ─┤
PLAYER 3 ─┤
PLAYER 4 ─┼──> WEB APPLICATION ──> AUTHORITATIVE BACKEND ──> GAME ENGINE
PLAYER 5 ─┤                                  │                    │
FACILITATOR┘                                  ├── PostgreSQL       │
                                              ├── Event/Audit Log  │
                                              └── Realtime Gateway ┘
```

El sistema no se diseñará como cinco aplicaciones independientes, una app local que sincroniza archivos ni un frontend que decide reglas.

## 2. Drivers arquitectónicos

Prioridades:

1. correctitud de reglas;
2. privacidad;
3. servidor autoritativo;
4. trazabilidad y replay;
5. multiplayer realtime;
6. testabilidad sin UI/red;
7. versionado de ruleset;
8. simplicidad operativa del MVP;
9. integración posterior con AI/RAG;
10. escalabilidad razonable sin microservicios prematuros.

## 3. Alternativas

### A. Next.js full-stack único

**Pros:** pocas piezas, rápido para prototipo.  
**Contras:** riesgo de mezclar UI/reglas, realtime persistente más incómodo, Game Engine demasiado unido al framework.

**Resultado:** no recomendado como arquitectura objetivo.

### B. Modular monolith TypeScript en monorepo

```text
apps/web
apps/server
packages/game-engine
packages/domain
packages/rules
packages/contracts
packages/projections
packages/persistence
packages/test-support
```

**Pros:** separación fuerte, una sola base de código/lenguaje, excelente testabilidad, realtime sencillo, transacciones simples, migración futura posible.  
**Resultado:** **RECOMENDADO**.

### C. Microservicios

**Pros:** escalado independiente.  
**Contras:** transacciones distribuidas, consistencia eventual, mucha complejidad operativa innecesaria para seis participantes por partida.

**Resultado:** no recomendado para v1.

## 4. Arquitectura recomendada

**Modular Monolith + Ports & Adapters + separación Domain/Application.**

Dos desplegables lógicos:

- `apps/web`: interfaz browser.
- `apps/server`: API, realtime y autoridad de sesión.

Paquetes:

```text
packages/
  contracts/
  domain/
  rules/
  game-engine/
  projections/
  persistence/
  authz/
  test-support/
  shared/
```

La dependencia siempre apunta hacia el dominio. `game-engine` no importa React, Next.js, SDK de base de datos, WebSocket concreto ni OpenAI.

## 5. Frontend

**Propuesta:** Next.js + React + TypeScript.

Responsabilidades:

- login/lobby;
- Player View;
- Facilitator Console;
- mapa;
- mano;
- campañas;
- planificación;
- narrativa;
- veto/votación;
- prompts de reacciones;
- historial autorizado;
- commands/queries;
- conexión realtime.

El frontend **no** adjudica reglas autoritativas. Puede calcular previews de UX, pero el servidor recalcula todo antes de commit.

## 6. Backend autoritativo

**Propuesta:** servicio Node.js/TypeScript separado de Next.js.

Responsabilidades:

- autenticar;
- construir `ActorContext`;
- command/query endpoints;
- realtime gateway;
- command dispatcher;
- Unit of Work;
- persistencia;
- publicación de eventos;
- proyecciones por actor;
- reconnect/presence;
- futura integración AI.

## 7. Transporte

**Commands y queries:** HTTP request/response.

Motivos: semántica transaccional clara, idempotencia, retries y observabilidad.

**Realtime:** WebSocket.

Transporta eventos/proyecciones ya comprometidos, presence, fases/turnos, `ReactionWindow`, `ChoiceRequest`, Veto y cambios visibles.

WebSocket no sustituye el command contract.

## 8. Sincronización multiplayer

Cada partida tiene `game_id` y `game_version`.

Si dos clientes mutan desde versión 42:

```text
A expected=42 -> commit -> version 43
B expected=42 -> STALE_STATE_VERSION
```

La publicación realtime debe poder segmentarse conceptualmente por:

- público de la partida;
- participante;
- facilitador.

## 9. Seguridad de proyecciones

Nunca se entrega el estado autoritativo completo al browser.

```text
Authoritative State
  -> Visibility Policy
  -> Projection Builder
  -> PlayerProjection / FacilitatorProjection
  -> HTTP/WebSocket
```

El navegador de un rival no recibe mano, deck order, VO secreto, acciones face-down, reacción disponible ni reveal temporal no autorizado.

La seguridad no depende de ocultar componentes en React.

## 10. Game Engine puro

Debe poder ejecutarse en tests sin red, navegador, PostgreSQL, Supabase, reloj real, RNG real ni OpenAI.

Entrada lógica:

```text
pre-state + command + choices + explicit RNG
```

Salida:

```text
CommandResult
state mutations
domain events
ledgers
AdjudicationTrace
pending interactions
```

## 11. Application Layer

Flujo de un command:

```text
1. Receive command
2. Authenticate / build ActorContext
3. Load required state
4. Verify game version
5. Invoke Game Engine
6. Persist mutations
7. Persist ledgers
8. Persist events
9. Persist trace
10. Increment game version
11. Commit
12. Publish committed events
13. Send authorized projections
```

## 12. Transacción

**Propuesta:** una transacción PostgreSQL por command que produzca estado estable.

Incluye:

- state mutations;
- resource/VP ledgers;
- influence mutations;
- card movements;
- legitimacy;
- pending interactions;
- event log;
- trace;
- game version;
- idempotency;
- outbox.

Cualquier fallo -> rollback total.

## 13. Transactional Outbox

Problema:

```text
DB commit OK
WebSocket publish fails
```

Solución propuesta: persistir `outbox_event` dentro de la misma transacción y publicar después del commit.

La base de datos sigue siendo autoritativa. Las notificaciones pueden reintentarse sin duplicar adjudicación.

## 14. Persistencia

**Propuesta:** PostgreSQL.

Supabase puede administrarlo inicialmente, pero el dominio no debe depender del SDK de Supabase.

Patrón:

- estado actual normalizado;
- `game_event` append-only;
- resource/VP ledgers;
- influence mutation history;
- facilitator decisions;
- adjudication traces;
- snapshots opcionales.

No Event Sourcing puro en MVP.

## 15. Repository Ports

Puertos conceptuales:

```text
GameRepository
CardRepository
ScenarioRepository
RulesetRepository
IdempotencyRepository
EventRepository
TraceRepository
OutboxRepository
```

Adapters:

```text
InMemory*
Postgres*
```

El Game Engine no conoce SQL.

## 16. Rule Kernel

Funciones normativas pequeñas y puras para:

- CV base/efectivo;
- tiers;
- ERT;
- normalización de d10;
- 2:1;
- legitimidad;
- VP;
- Victory Objectives.

Sin I/O, DB, clock, RNG interno ni UI.

## 17. Effect Interpreter

No se recomienda programar cientos de condiciones por nombre de carta.

Las definiciones deben usar IDs canónicos y secuencias declarativas de operadores autorizados, por ejemplo:

```text
REQUIRE
CHOOSE_TARGET
SPEND_RESOURCE
ROLL_D10
ADD_MODIFIER
ADD_CUBES
DISCARD_CARD
```

Veto, Reaction Engine, campaña, viral y objectives pueden usar handlers dedicados.

## 18. Scheduler y continuations

La resolución puede suspenderse por:

- Choice;
- Reaction;
- Veto;
- manual die;
- facilitator decision.

Nunca debe mantenerse una función JavaScript viva durante minutos.

Se persiste:

```text
resolution_status=SUSPENDED
pending_interaction
continuation_state
```

Luego un nuevo command reanuda la adjudicación. Esto soporta refresh, desconexión y reinicio del servidor.

## 19. Reconexión y presence

Reconexión:

```text
authenticate
join game
fetch latest authorized projection
subscribe realtime
```

Presence (`ONLINE/OFFLINE/RECONNECTING/IDLE`) es operacional, no regla del Game Engine.

El facilitador decide qué hacer ante desconexiones.

## 20. Facilitator Console

Debe permitir:

- crear/configurar partida;
- asignar jugadores;
- iniciar/pausar/reanudar;
- ver presence;
- ver estado completo;
- revisar pending interactions;
- entrada manual de dados cuando corresponda;
- revisión humana de narrativa;
- control de Veto Abuse;
- overrides tipados;
- event log / trace;
- finalizar/abortar;
- futuro AAR.

Todo override se audita.

## 21. AuthN/AuthZ

La autenticación vive en la capa de aplicación.

**Propuesta de infraestructura:** Supabase Auth como opción preferente inicial, sin acoplar el dominio.

Autorización deriva server-side:

```text
user -> GameParticipant -> PlayerSeat -> Country -> permissions
```

Dos controles distintos:

1. command authorization;
2. projection authorization.

## 22. AI boundary

AI se integra después y queda fuera del Game Engine.

```text
Authorized Projection
 -> AI Context Builder
 -> RAG/OpenAI
 -> Suggestion/Explanation
 -> Human review
 -> normal Command
```

No hay vista omnisciente de IA para jugadores.

## 23. RNG y Clock

Ports:

```text
RandomProvider
Clock
```

Producción usa providers reales; tests usan providers deterministas/fijos.

El Engine no utiliza RNG o tiempo global directamente.

## 24. Versionado

Una partida fija:

```text
ruleset_version
scenario_version
card_registry_version
engine_contract_version
```

La aplicación registra además build y schema version.

No se migran reglas de una partida activa silenciosamente.

## 25. Cache de cliente

Puede haber cache para UX, pero:

```text
server projection wins
```

No usar optimistic UI para operaciones cuya validez pueda depender de secretos rivales.

## 26. Observabilidad

Mínimo:

- structured logs;
- correlation id;
- command id;
- game id;
- actor id;
- version before/after;
- duration;
- error code;
- event ids.

No registrar secretos de mano/VO en logs generales.

## 27. Testing / TDD

Orden:

```text
Rule Kernel tests
-> domain/command tests
-> in-memory integration
-> persistence contract tests
-> PostgreSQL integration
-> realtime multiplayer tests
-> web E2E
```

Primer objetivo ejecutable: Game Engine in-memory + P0 rules/commands.

## 28. In-memory first, no throwaway prototype

Los adapters in-memory implementan los mismos ports que PostgreSQL.

Sirven para validar reglas y cientos de tests antes de introducir infraestructura, no para crear una rama desechable.

## 29. Physical Database gate

Antes del adapter PostgreSQL productivo se producirá:

**MALIGN-AI — PHYSICAL DATABASE & MIGRATION SPECIFICATION v0.1**

Contendrá tablas, tipos, PK/FK, checks, indexes, transaction patterns, seguridad y migration policy.

## 30. Deployment direction

No se aprueba proveedor final todavía.

Arquitectura compatible con:

```text
Next.js web hosting
Node server long-lived
PostgreSQL/Auth gestionados
WebSocket
```

La selección de hosting se hará tras validar el MVP y coste operativo.

## 31. Escalabilidad

La unidad natural de partición futura es `game_id`.

No se necesita microservicios ahora. Si algún día se distribuye carga, una partida debe conservar un único escritor lógico.

## 32. Seguridad contra leakage

Tests negativos obligatorios para:

- projections;
- WebSocket;
- errors;
- reaction opportunities;
- logs;
- AI context;
- facilitator-only data.

Un mensaje como “no puedes reaccionar porque no tienes X” es una filtración.

## 33. Localización y assets

IDs canónicos independientes del idioma.

```text
card_id = FACT_CHECKING
label_es = Verificación de Hechos
label_en = Fact-Checking
```

La lógica referencia `visual_asset_key`, nunca nombres físicos de archivo.

## 34. Dependencias permitidas

```text
domain -> shared
rules -> domain + shared
game-engine -> domain + rules + contracts + shared
projections -> domain + authz + contracts
persistence -> domain ports/contracts
apps/server -> application-facing packages
apps/web -> contracts/UI
```

Prohibido:

```text
domain -> persistence
domain -> web
game-engine -> React
game-engine -> database SDK
apps/web -> persistence
```

## 35. TypeScript

**Propuesta:** `strict=true`, unions discriminadas, exhaustiveness checks, runtime validation en boundaries y cero `any` en Game Engine salvo excepción documentada.

La librería concreta de validation se elige justo antes del bootstrap.

## 36. Tooling baseline

Propuesta inicial:

- Node.js LTS vigente al comenzar;
- TypeScript;
- pnpm workspaces;
- ESLint;
- formatter;
- Vitest o equivalente;
- Playwright para E2E.

Las versiones concretas se fijarán en el momento de crear el repositorio.

## 37. Milestones recomendados

### M0 — Repository + Rule Kernel
- monorepo;
- TypeScript strict;
- packages base;
- rule data/contracts;
- Rule Kernel;
- in-memory adapters;
- P0 Rule Unit tests;
- Command Dispatcher mínimo;
- determinismo/replay básico.

### M1 — Multiplayer Engine Vertical Slice
- create game;
- join seats;
- initiative;
- plan/lock;
- resolve una campaña;
- ERT;
- cubes;
- VP;
- broadcast de proyecciones.

### M2 — Persistencia + Scenario Base
- PostgreSQL;
- migrations;
- idempotency;
- outbox;
- reconnect;
- registry completo;
- reactions;
- Veto;
- regime abilities;
- viral;
- victory.

### M3 — Web MVP
- lobby;
- Player View;
- Facilitator Console;
- mapa;
- mano;
- campañas;
- action planning;
- resolution;
- reactions;
- Veto;
- victory.

AI/RAG entra después.

## 38. Decisiones arquitectónicas para aprobación

| ID | Propuesta | Recomendación |
|---|---|---|
| ARC-01 | Web multijugador compartida, 5 jugadores + facilitador, backend autoritativo y realtime | APPROVE |
| ARC-02 | Modular monolith TypeScript en monorepo | APPROVE |
| ARC-03 | `apps/web` + `apps/server`; Game Engine separado de framework | APPROVE |
| ARC-04 | Next.js + React + TypeScript | APPROVE |
| ARC-05 | PostgreSQL; Supabase como opción gestionada sin acoplar dominio | APPROVE |
| ARC-06 | HTTP commands/queries + WebSocket realtime | APPROVE |
| ARC-07 | `game_version` + transacción por command + Transactional Outbox | APPROVE |
| ARC-08 | Ports & Adapters; RNG/clock/persistence como ports | APPROVE |
| ARC-09 | Current state + append-only audit/events/ledgers/traces | APPROVE |
| ARC-10 | Rule Kernel + in-memory + P0 tests primero | APPROVE |
| ARC-11 | Proyecciones y filtrado de secretos server-side | APPROVE |
| ARC-12 | AI fuera del Game Engine; sólo Authorized Projection | APPROVE |

## 39. Gate para pasar a Codex

El proyecto estará listo para pasar a Codex cuando:

1. ARC-01…ARC-12 estén aprobadas;
2. `DECISIONS.md` registre esas decisiones como APPROVED;
3. se prepare `REPOSITORY_BOOTSTRAP_SPEC.md`;
4. se prepare `CODEX_IMPLEMENTATION_PLAN.md`;
5. se seleccione el primer subset exacto de tests P0;
6. se prepare un paquete de contexto autocontenido para Codex.

**Todavía no corresponde pasar a Codex mientras esta arquitectura permanezca PROPOSED.**

## 40. Conclusión

La arquitectura recomendada es:

```text
Web multiplayer
+ authoritative TypeScript server
+ pure deterministic Game Engine
+ PostgreSQL
+ HTTP commands/queries
+ WebSocket realtime
+ transactional outbox
+ server-side security projections
+ audit/event/trace history
+ modular monolith
```

El siguiente gate es aprobar o modificar `ARC-01…ARC-12`. Sólo después debe prepararse el bootstrap del repositorio y el handoff a Codex.
