# MALIGN-AI — M2 IMPLEMENTATION SPECIFICATION v0.1

**Fecha:** 2026-08-25
**Estado:** AMENDED / PENDING FINAL REVIEW
**Autoridad:** DEC-074 + DEC-075 — documentación únicamente
**Implementación M2:** **NOT AUTHORIZED**

> Este documento cataloga un plan test-first. DEC-075 aprueba decisiones de planificación y el baseline de aceptación M2, pero no autoriza código, tests ejecutables, migrations, seeds, infraestructura, dependencias, proveedores ni ninguna subetapa M2.

## 1. Objetivo y checkpoint aprobado

M2 deberá convertir el vertical slice M1, actualmente in-memory/test-only, en un Game Engine persistente que complete las reglas BASE_2025 diferidas y se recupere entre procesos o nodos sin perder atomicidad, ordering, privacidad ni replay.

El checkpoint aprobado mediante DEC-075 es:

```text
checkpoint M1 aprobado, antes de Cleanup
→ ejecutar reglas restantes y scheduler completo
→ Cleanup / Viral / End Turn
→ evaluar objectives, victory y finalización
→ persistir state + events + ledgers + trace + outbox atómicamente
→ reiniciar proceso y recuperar por snapshot + log autoritativo
→ reconectar viewers con proyección autorizada
→ GAME_COMPLETED
```

El golden usa BASE_2025 con `turn_limit=1` sólo como fixture determinístico. No cambia el default del producto ni sustituye los gates individuales.

## 2. Fuentes y precedencia

1. `MALIGN_AI_DECISIONS_v0.3.md`, incluidas DEC-048…059, DEC-065, DEC-073 y DEC-075.
2. Especificaciones normativas de Game Engine, Scenario, Contract, Data Model, Data Dictionary, Security y Architecture.
3. `MALIGN_AI_GAME_ENGINE_TEST_ACCEPTANCE_SPEC_v0.1.md` (224 IDs; blob aprobado `8291b56e20b9fdf55b8c01c156b66cd641b52d92`).
4. `MALIGN_AI_GAME_ENGINE_TEST_ACCEPTANCE_M1_ADDENDUM_v0.1.md` (38 IDs; blob aprobado `a5e140eb55b442230110e8ae77d5763401db3117`).
5. `MALIGN_AI_GAME_ENGINE_TEST_ACCEPTANCE_M2_ADDENDUM_v0.1.md` (32 IDs aprobados como baseline mediante DEC-075; implementación no autorizada).
6. Card & Component System v0.1 sólo como evidencia `DRAFT / NO APROBADO`; nunca como seed silencioso.

Ante contradicción se falla cerrado, se registra pregunta y no se inventa comportamiento.

## 3. Baseline y límites

- M0 y M1: **IMPLEMENTED AND APPROVED**.
- Baseline aprobada de entrada: **215/215 PASS en 27 archivos, 0 skips, 0 todo, 0 waivers**; no se reejecuta en esta enmienda.
- Oracle: `71 implementados + 153 owner M2 = 224`.
- Addendum M2: 32 IDs canónicos de aceptación.
- Casos nuevos únicos M2: `153 + 32 = 185`.
- Suite mínima acumulada futura: `215 + 185 = 400`.
- PostgreSQL, migrations, outbox, transporte productivo, AuthN productiva, reglas M2, UI final e IA no han iniciado.

Quedan fuera de M2: UI final, IA/OpenAI/RAG, editor productivo de escenarios, analítica/AAR avanzada, proveedores no aprobados y M3. Ninguna librería, cloud, ORM, AuthN provider o WebSocket provider queda seleccionada.

## 4. Decisiones técnicas vigentes

| PTD | Clasificación DEC-075 | Regla obligatoria |
|---|---|---|
| PTD-M2-001 | APPROVED | ocho bloques M2-0…M2-7 y golden final `turn_limit=1` |
| PTD-M2-002 | APPROVED | UUIDv7; lookup/version tables; estado crítico normalizado; JSON tipado/versionado sólo autorizado |
| PTD-M2-003 | APPROVED | row lock de `Game` + CAS `game_version` bajo `READ COMMITTED` |
| PTD-M2-004 | INHERITED ARCHITECTURAL CONSTRAINT | state normalizado + historia append-only + snapshots estables |
| PTD-M2-005 | APPROVED | at-least-once + ordering autoritativo + dedup; nunca exactly-once |
| PTD-M2-006 | PARTLY INHERITED / REFINEMENT APPROVED | HTTP + WebSocket heredado; protocolo propio versionado detrás de port |
| PTD-M2-007 | APPROVED AS DESIGN | registry versionado, effect IDs declarativos, handlers tipados; contenido pendiente |
| PTD-M2-008 | APPROVED | continuations discriminadas, versionadas, persistidas y runtime-validated |
| PTD-M2-009 | INHERITED AUTHENTICATION BOUNDARY | AuthN y `ActorContext` sólo application-side; proveedor pendiente |
| PTD-M2-010 | APPROVED | sin timer/auto-pass; `expires_at=null`; intervención F1 auditada |
| PTD-M2-011 | APPROVED | migration forward-only; deploy rollback + restore probado; sin down destructivo |

## 5. Descomposición M2-0…M2-7

| Bloque | Alcance | Dependencias/gates | Casos nuevos únicos | Estado |
|---|---|---|---:|---|
| M2-0 | Canonical Foundations Gate documental | revisión de Physical DB Spec, addendum M2, registry candidate y hashes | 0 | NOT AUTHORIZED |
| M2-1 | PostgreSQL Persistence and Durable Recovery | M2-0 aprobado; registry aprobado para seed | 22 | NOT AUTHORIZED |
| M2-2 | Productive Transport and Reconnect | M2-1; IQ-M2-008/009 | 8 | NOT AUTHORIZED |
| M2-3 | Complete Scheduler and Remaining Core Rules | M2-1; contrato de registry suficiente | 39 | NOT AUTHORIZED |
| M2-4 | Action/Starter Cards and Regime Abilities | M2-3; IQ-M2-010 resuelta | 45 | NOT AUTHORIZED |
| M2-5 | Reaction, Veto and Deterministic Narrative | M2-3/M2-4; transport recovery para gate productivo | 23 | NOT AUTHORIZED |
| M2-6 | Cleanup, Viralization and End Turn | M2-3/M2-5 | 18 | NOT AUTHORIZED |
| M2-7 | Objectives, Victory and End Game | M2-1/M2-2/M2-6 | 30 | NOT AUTHORIZED |

Ningún bloque de implementación supera 50 casos nuevos únicos. La autorización de un bloque requerirá un prompt posterior separado.

## 6. M2-0 — Canonical Foundations Gate

Bloque exclusivamente documental:

- Physical Database Specification;
- addendum normativo M2;
- especificación candidata de canonicalización del registry completo;
- reconciliación de entidades, IDs, versions, effects y fuentes;
- revisión expresa de contenido y hashes.

### Gate de salida futuro

- Physical DB Spec coherente con PTD-M2-002…005/008/010/011;
- 32/32 IDs del addendum M2 revisados;
- registry candidate reconciliado y `IQ-M2-010` resuelta;
- blobs documentales aprobados expresamente;
- ninguna selección silenciosa de provider/ORM/runtime.

M2-0 no implementa código, migrations, seeds ni tests ejecutables. DEC-075 no autoriza ejecutar siquiera este gate.

## 7. M2-1 — PostgreSQL Persistence and Durable Recovery

Incluye schema/migrations; registry seed sólo tras aprobación del registry; Unit of Work; transactions; durable idempotency; row lock + CAS; commit atómico de state/events/ledgers/trace/outbox; snapshots, replay y recovery; retention completa sin compaction/hard-delete.

### Invariantes y DoD futuro

- una transaction por command;
- lock de fila `Game` y CAS de `game_version` en `READ COMMITTED`;
- rollback de todos los artifacts ante cualquier write fault;
- outbox sólo visible/publicable post-commit;
- retry durable conserva fingerprint/result y no duplica efectos;
- replay/recovery no consume RNG ni IA;
- pinned ruleset/scenario/registry/contract versions;
- migrations forward-only, rollback de deploy y restore ensayado;
- **22/22 nuevos únicos** y regresiones dirigidas verdes, más baseline completo 215/215.

Reversión operativa: volver al adapter in-memory por el mismo port y restaurar backup ensayado; nunca borrar historia o ejecutar downgrade destructivo.

## 8. M2-2 — Productive Transport and Reconnect

Incluye HTTP commands/queries; protocolo WebSocket propio y versionado; AuthN application-side; outbox publisher; delivery at-least-once; ordering, dedup y gaps; reconnect/recovery entre procesos o nodos.

No puede denominarse plenamente productivo hasta aprobar proveedor AuthN (`IQ-M2-008`), librería/runtime, hosting y operating envelope (`IQ-M2-009`). El Engine no importa HTTP, WebSocket, SDK AuthN ni infraestructura.

DoD futuro: handshake no confía en claims del cliente; cursor/projection ligados a viewer; initial sync sin ventana de pérdida; gap recovery desde feed autoritativo; privacy omissions distinguibles sin leakage; **8/8 nuevos únicos** y regresiones dirigidas, más baseline 215/215.

## 9. M2-3 — Complete Scheduler and Remaining Core Rules

Incluye setup/maintenance restantes; planning y negociación; campaign lifecycle restante; costs, bonuses, backlash y legitimacy; manual die; seguridad relacionada; scheduler completo y `GE-M2-SCH-001`.

No incluye comportamiento de Action Cards ni Regime Abilities. El test gate asigna también `GE-M2-EFX-001` a M2-3 para conservar el reparto exacto `37 oracle + 2 addendum`: aquí sólo se prueba el contrato genérico de dispatch tipado/fail-closed, sin efectos de Action/Starter/Regime. M2-4 debe reejecutarlo como regresión de integración cuando conecte el catálogo.

DoD futuro: continuations persistibles, actoría SYSTEM correcta, orden por initiative/sequence, costes atómicos y reuse del Rule Kernel; **39/39 nuevos únicos** y regresiones dirigidas, más baseline 215/215.

## 10. M2-4 — Action/Starter Cards and Regime Abilities

Incluye 30 IDs `GE-ACT-*`; 15 IDs `GE-REG-*`; lifecycle, costes, zonas, secretos y proyecciones relacionados; integración de registry effect dispatch.

`GE-M2-EFX-001` conserva owner único M2-3 por el reparto obligatorio de DEC-075 y se reejecuta aquí como `[REGRESSION]`; esa repetición no lo convierte en caso nuevo M2-4.

DoD futuro: 30/30 Action y 15/15 Regime owner, effects sólo por IDs/handlers aprobados, atomicidad completa, no dispatch por nombre/prompt y no leakage; **45/45 nuevos únicos** y regresiones dirigidas, más baseline 215/215.

## 11. M2-5 — Reaction, Veto and Deterministic Narrative

Incluye 10 `GE-REA-*`, cuatro `GE-NAR-*`, cinco `GE-VETO-*`, `GE-AUD-005` y `GE-M2-RX-001…003`; nested continuations, privacy y reconnect.

DoD futuro: ventanas/priority determinísticas; continuation discriminada persistida; no timer ni auto-pass; `expires_at=null`; F1 auditado; opciones/errores opacos; **23/23 nuevos únicos** y regresiones dirigidas, más baseline 215/215.

## 12. M2-6 — Cleanup, Viralization and End Turn

Incluye state progression y campaign aging; Cleanup; 12 `GE-VIR-*`; `GE-M2-LC-001`; transición segura a End Turn o siguiente fase.

DoD futuro: aging con snapshot/simultaneidad aprobada; no cascada viral; ordering estable; continuation reiniciable sin duplicados; **18/18 nuevos únicos** y regresiones dirigidas, más baseline 215/215.

## 13. M2-7 — Objectives, Victory and End Game

Incluye 18 Victory Objective IDs; cinco `GE-END-*`; `GE-E2E-001…005`; `GE-M2-END-001/002`; golden final BASE_2025 `turn_limit=1`; restart, replay y reconnect hasta `GAME_COMPLETED`.

DoD futuro: awards/outcome/final events/outbox atómicos e idempotentes; tiebreak exacto; replay conserva hash/winner/projections; **30/30 nuevos únicos** y regresiones dirigidas, más baseline 215/215; suite acumulada mínima **400/400**.

## 14. Boundaries obligatorios

- Game Engine puro: sin PostgreSQL, HTTP, WebSocket, AuthN SDK, React/Next, Supabase ni OpenAI.
- Application layer autentica, verifica membership y construye `ActorContext`.
- Ports separan persistence, clock, RNG, outbox, projections y transport.
- Un solo writer lógico por game; clients nunca deciden phase, cost, eligibility, ordering o permissions.
- Estado crítico normalizado; JSON únicamente tipado, versionado y autorizado.
- Events/ledgers/traces append-only íntegros durante M2; snapshots estables; no compaction/hard-delete.
- Outbox at-least-once con ordering y consumer dedup; no promesa exactly-once.
- Continuations son datos, no closures.
- Secrets se filtran server-side con fail-closed policy compartida.
- Registry/effects no se implementan antes de aprobar contenido y hash.

## 15. Trazabilidad resumida

| Obligación | Fuente principal | Owner/gate |
|---|---|---|
| Physical schema, IDs, versions, migrations | Architecture §29; Data Dictionary; PTD-M2-002/011 | M2-0 review → M2-1 |
| Registry 108/100 y aliases | DEC-025/029; Card Component DRAFT; IQ-M2-010 | M2-0 review → M2-1 seed/M2-4 rules |
| Transaction/outbox | DEC-054; PTD-M2-003/005 | M2-1; `GE-M2-TX-*` |
| Durable replay/recovery | Data Dictionary §28; PTD-M2-004 | M2-1; `GE-AUD-004`, `GE-M2-TX-008/009` |
| Productive transport | DEC-053; Contract; IQ-M2-008/009 | M2-2; `GE-M2-RT-*` |
| Scheduler/core remainder | Adjudication; oracle | M2-3; 37 oracle + SCH/EFX |
| Action/Starter/Regime | DEC-011…016/23/25…29/39…47; oracle | M2-4; 45 oracle |
| Reaction/Veto/Narrative | DEC-014/017/018; Contract | M2-5; 20 oracle + RX |
| Cleanup/Viral | DEC-019/042; Adjudication | M2-6; 17 oracle + LC |
| Objectives/Victory/End | DEC-020…024; Scenario | M2-7; 28 oracle + END |

## 16. Riesgos y mitigaciones

| Riesgo | Mitigación | Bloque |
|---|---|---|
| schema cristaliza interpretación no aprobada | M2-0 + Physical DB Spec review | M2-1 |
| DRAFT se convierte silenciosamente en seed | candidate con `UNRESOLVED`, snapshot/hash approval | M2-0/M2-1/M2-4 |
| doble gasto o sequence duplicada | row lock + CAS + fault injection | M2-1 |
| commit no publicado o publicación duplicada | transactional outbox + at-least-once/dedup | M2-1/M2-2 |
| replay diverge/consume RNG | reconciliation fail-closed | M2-1/M2-7 |
| provider invade Engine | application ports + IQ-M2-008/009 | M2-2 |
| gaps privados causan leakage | projection policy + authorized ranges | M2-2/M2-5 |
| scheduler no reanuda | continuation persistida y versionada | M2-3/M2-5/M2-6 |
| effect dispatch inventa regla | ID declarado + handler tipado + registry aprobado | M2-3/M2-4 |
| auto-pass inventado | `expires_at=null`; F1 auditado | M2-5 |
| scope creep | autorización separada por bloque | todos |

## 17. IMPLEMENTATION_QUESTIONS

| ID | Estado DEC-075 | Impacto vigente |
|---|---|---|
| IQ-M2-001…002, 006…007 | RESOLVED | decisiones aplicables en futuros gates |
| IQ-M2-003 | RESOLVED AS APPROACH | sustituida por approval de contenido/hash IQ-M2-010 |
| IQ-M2-004 | RESOLVED AS BOUNDARY | provider pendiente en IQ-M2-008 |
| IQ-M2-005 | RESOLVED AS CONTRACT DIRECTION | runtime/envelope pendiente en IQ-M2-009 |
| IQ-M2-008 | OPEN | bloquea afirmar transporte productivo M2-2 |
| IQ-M2-009 | OPEN | bloquea implementar transporte productivo M2-2 |
| IQ-M2-010 | OPEN | bloquea seed y reglas dependientes del registry |

No surgió una contradicción nueva entre reglas oficiales durante la reconciliación documental; `OPEN_QUESTIONS.md` permanece intacto.

## 18. Definition of Done global futura

M2 sólo podrá cerrarse tras nuevas autorizaciones si:

- los ocho gates se revisan en orden compatible;
- 153 IDs oracle owner + 32 IDs addendum pasan al 100%;
- regresiones dirigidas y baseline completo 215/215 pasan por bloque aplicable;
- suite mínima acumulada alcanza 400/400, 0 skips, 0 todo, 0 waivers;
- state/events/ledgers/trace/outbox reconcilian;
- recovery/replay no consume RNG ni IA;
- privacy y actor boundaries permanecen fail-closed;
- IQ bloqueantes del bloque están resueltas;
- PROJECT_STATE sólo cambia a implemented/approved tras revisión humana.

## 19. Gate de salida documental

El paquete queda **AMENDED / PENDING FINAL REVIEW** mediante DEC-075. M2, M2-0…M2-7 y M3 permanecen **NOT AUTHORIZED**. El siguiente paso permitido es revisión humana de esta enmienda, del addendum M2 y del candidate registry; no implementación ni preparación de implementación.
