# MALIGN-AI — M2 Technical Review v0.1

**Fecha:** 2026-08-30  
**Baseline revisado:** `6fbab743130d8e5df84de62bc58091090b610d2b`  
**Resultado:** **CHANGES REQUIRED — M2 NOT CLOSED**

## Evidencia positiva preservada

- PostgreSQL 18.6, migrations `001…006` y 87/87 tablas permanecen verdes.
- M2-A 38/38 y M2-2 75/75 permanecen aprobados.
- La suite reportada en el baseline es 512/512 en 44 archivos, sin skips/todo/waivers.
- Oracle y addenda no fueron modificados.

La cifra anterior demuestra que los ejecutables actuales pasan; no demuestra por sí sola que los owners M2-3…M2-7 satisfagan su nivel `COMMAND`, `TURN_INTEGRATION`, `GAME_INTEGRATION`, `AUDIT_REPLAY` o persistencia durable.

## Hallazgos bloqueantes

### M2R-R01 — Application/command integration ausente

`packages/game-engine/src/m2b*.ts` sólo es importado por sus propios módulos y tests. `SetupCommandDispatcher`, `M1AdjudicationEngine`, server/application commands y scheduler productivo no invocan M2-B, Reaction, Cleanup o End Game. Los comandos de los owners no atraviesan phase enforcement, actoría, idempotencia ni CAS application-wide.

**Corrección en progreso:** se añadió un seam bidireccional tipado `buildM2StateFromCanonical` / `applyM2StateToCanonical`, con regresión `M2R-R01.integrated-state`, para que Resources, VP, cards/campaigns, influence, legitimacy y scheduler utilicen el `SetupGameState` canónico. Cleanup y End Game atraviesan `dispatchAtomicCommand` y sus puertos internos usan `PostgresGameSessionApplication.coordinateDurableOperation`. Reaction se abre exclusivamente por `InternalM2ReactionPort`; `PASS_REACTION` y `PLAY_REACTION` cruzan la sesión autenticada con prioridad, binding, zona/control y RNG transaccional. `InternalM2EffectPort` conecta los handlers ejecutables M2-3/M2-4 con binding effect/card del registry, lifecycle, auditoría canónica, CAS e idempotencia durable. AuthorizedProjection limita las opciones de Reaction al actor prioritario y a F1. Ninguna frontera acepta ActorContext, permisos, métricas o rolls libres del caller. M2R-R01 permanece **OPEN** para las operaciones core que aún sólo existen como funciones aisladas; los handlers ausentes se rastrean separadamente en M2R-R04.

### M2R-R02 — Persistencia, replay y outbox ausentes para M2-3…M2-7

`M2BState`, `ReactionContinuation`, `CleanupContinuation` y `EndGameState` no aparecen en persistence, recovery, AuthorizedProjection ni server. Reaction/Veto, viral, awards y `GAME_COMPLETED` no se materializan mediante el UoW PostgreSQL, ledgers, traces, events y outbox aprobados.

### M2R-R03 — Owner tests no representan el oracle

Parte de `GE-M2-3.owner`, `GE-M2-4.owner`, M2-6 y las regresiones modifica fixtures directamente o verifica constantes/IDs en lugar de ejecutar el comportamiento descrito. Ejemplos: swaps de zona manuales, descarte manual, counters manuales y regresiones que sólo comprueban `expect(id).toMatch`. Estos casos son ejecutables verdes pero no constituyen evidencia válida del owner.

### M2R-R04 — Manifest de efectos incompleto

El dispatcher M2-B registra sólo un subconjunto de IDs, mientras el registry aprobado contiene 59 effect definitions y M2-5 exige cobertura completa final, sin fallback silencioso. `GE-M2-EFX-001 [REGRESSION]` no enumera ni ejecuta exhaustivamente el manifest aprobado.

**Corrección en progreso:** `M2_EFFECT_MANIFEST` materializa y prueba por igualdad exacta los 59 pares `effect_id`/`source_definition_id` del snapshot DEC-077. El dispatcher distingue ID desconocido (`EFFECT_UNKNOWN`) de ID aprobado sin handler (`EFFECT_DISABLED`), siempre sin mutación. Permanecen 51 handlers de cartas sin implementar; por ello M2R-R04 continúa **OPEN** y no se presenta el inventario como cobertura funcional 59/59.

### M2R-R05 — Atomicidad/idempotencia final insuficiente

Reaction, Cleanup y End Game mutan estructuras in-memory fuera de la frontera transaccional application-wide. `finalizeGame` guarda un resultado local por key, pero no prueba commit atómico de awards, VP ledger, outcome, event, trace, snapshot y outbox ni retry durable entre procesos.

### M2R-R06 — Privacy/reconnect incompletos

La proyección de Reaction es una función aislada; no reutiliza el pipeline productivo de AuthorizedProjection/feed. No existe evidencia durable de reconnect para nested reaction, cleanup checkpoint o `GAME_COMPLETED` con viewers owner/rival/F1.

## Corrección obligatoria

1. Integrar M2-3…M2-7 en un único application command/session boundary con actoría verificada, phase enforcement, idempotencia, Game row lock y CAS.
2. Persistir estado normalizado, continuations, reactions/votes/narratives, viral attempts, objective awards y outcome usando migrations existentes; cualquier cambio físico nuevo exige migration forward-only y manifest verificado.
3. Emitir events, ledgers, trace, snapshot y outbox atómicamente y reconciliarlos en recovery/replay.
4. Reemplazar cada owner no representativo por una ejecución observable del caso exacto, conservando el ID original.
5. Generar el manifest exhaustivo desde el registry aprobado o validar explícitamente 59/59 effect definitions; IDs fuera de bloque fallan cerrados.
6. Añadir gates PostgreSQL multiproceso para retry/CAS/restart/reconnect y matriz de AuthorizedProjection.
7. Mantener 0 skips, 0 todo, 0 waivers y preservar toda evidencia aprobada M2-A/M2-2.

## Estado

- M2-3…M2-7: **IMPLEMENTED IN ISOLATION / CHANGES REQUIRED**.
- M2 global: **NOT APPROVED / NOT CLOSED**.
- M3: **NOT AUTHORIZED / NOT STARTED**.
- No hay ambigüedad normativa nueva; son defectos de integración y evidencia, no `IMPLEMENTATION_QUESTION`.
