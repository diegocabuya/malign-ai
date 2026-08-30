# MALIGN-AI — M2 IMPLEMENTATION SPECIFICATION v0.1

**Fecha:** 2026-08-27
**Estado:** M2-0 APPROVED AND CLOSED / M2-A/M2-1 IMPLEMENTED AND APPROVED / CLOSED mediante DEC-080
**Autoridad:** DEC-074…DEC-081; DEC-081 aprueba sólo el decision gate de M2-2
**Implementación M2:** **M2-A/M2-1 IMPLEMENTED AND APPROVED / CLOSED; M2-2 DECISION GATE APPROVED / READY FOR IMPLEMENTATION AUTHORIZATION / NOT AUTHORIZED; M2-3…M2-7 NOT AUTHORIZED; M2 global NOT YET CLOSED; M3 NOT AUTHORIZED**

> DEC-078 autorizó y materializó exclusivamente M2-A/M2-1; DEC-080 aprobó su commit funcional final `85ec047726a68007fbcabf07c6b3fe1b911a3070` y cerró M2A-R01…R30. DEC-080 no autoriza M2-2…M2-7, M2 global o M3.

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

1. `MALIGN_AI_DECISIONS_v0.3.md`, incluidas DEC-048…059, DEC-065, DEC-073, DEC-075 y DEC-076.
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
- Regresiones dirigidas M2: 86; ejecuciones dirigidas: `185 + 86 = 271`.
- Suite mínima acumulada futura: `215 + 185 = 400`.
- PostgreSQL 18.6, migrations `001…006`, outbox durable y recovery de M2-A/M2-1 están implementados y aprobados mediante DEC-080. Permanecen no iniciados/no autorizados el transporte/WebSocket productivo, AuthN productiva, las reglas posteriores de M2-2…M2-7, UI final, IA/OpenAI/RAG, hosting y proveedores.

Quedan fuera de M2: UI final, IA/OpenAI/RAG, editor productivo de escenarios, analítica/AAR avanzada, proveedores no aprobados y M3. DEC-081 selecciona sólo referencias técnicas para el gate M2-2 —Auth0, Node.js 24 + `ws`, Render y PostgreSQL `LISTEN/NOTIFY` como wake-up— sin autorizar librerías, cuentas, planes, secrets, infraestructura o despliegue.

## 4. Decisiones técnicas vigentes

| PTD | Clasificación DEC-075 | Regla obligatoria |
|---|---|---|
| PTD-M2-001 | APPROVED | ocho bloques M2-0…M2-7 y golden final `turn_limit=1` |
| PTD-M2-002 | APPROVED | UUIDv7; lookup/version tables; estado crítico normalizado; JSON tipado/versionado sólo autorizado |
| PTD-M2-003 | APPROVED | row lock de `Game` + CAS `game_version` bajo `READ COMMITTED` |
| PTD-M2-004 | INHERITED ARCHITECTURAL CONSTRAINT | state normalizado + historia append-only + snapshots estables |
| PTD-M2-005 | APPROVED | at-least-once + ordering autoritativo + dedup; nunca exactly-once |
| PTD-M2-006 | PARTLY INHERITED / REFINEMENT APPROVED | HTTP + WebSocket heredado; protocolo propio versionado detrás de port |
| PTD-M2-007 | APPROVED AS DESIGN | registry versionado, effect IDs declarativos, handlers tipados; contenido aprobado mediante DEC-077 |
| PTD-M2-008 | APPROVED | continuations discriminadas, versionadas, persistidas y runtime-validated |
| PTD-M2-009 | INHERITED AUTHENTICATION BOUNDARY | AuthN y `ActorContext` sólo application-side; proveedor pendiente |
| PTD-M2-010 | APPROVED | sin timer/auto-pass; `expires_at=null`; intervención F1 auditada |
| PTD-M2-011 | APPROVED | migration forward-only; deploy rollback + restore probado; sin down destructivo |

## 5. Descomposición M2-0…M2-7

| Bloque | Alcance | Dependencias/gates | Casos nuevos únicos | Estado |
|---|---|---|---:|---|
| M2-0 | Canonical Foundations Gate documental | Physical DB Spec, addendum M2, registry, Product Owner Review Matrix y hashes | 0 | APPROVED AND CLOSED mediante DEC-077 |
| M2-1 | PostgreSQL Persistence and Durable Recovery | M2-0 aprobado; registry aprobado para seed | 22 | IMPLEMENTED AND APPROVED / CLOSED mediante DEC-080 |
| M2-2 | Productive Transport and Reconnect | M2-1 aprobado; IQ-M2-008/009 resueltas mediante DEC-081 | 8 | DECISION GATE APPROVED / READY FOR IMPLEMENTATION AUTHORIZATION / NOT AUTHORIZED |
| M2-3 | Complete Scheduler and Remaining Core Rules | M2-1; contrato de registry suficiente | 39 | NOT AUTHORIZED |
| M2-4 | Action/Starter Cards and Regime Abilities | M2-3; IQ-M2-010 resuelta | 45 | NOT AUTHORIZED |
| M2-5 | Reaction, Veto and Deterministic Narrative | M2-3/M2-4; transport recovery para gate productivo | 23 | NOT AUTHORIZED |
| M2-6 | Cleanup, Viralization and End Turn | M2-3/M2-5 | 18 | NOT AUTHORIZED |
| M2-7 | Objectives, Victory and End Game | M2-1/M2-2/M2-6 | 30 | NOT AUTHORIZED |

Ningún bloque de implementación supera 50 casos nuevos únicos. La autorización de un bloque requerirá un prompt posterior separado.

## 6. M2-0 — Canonical Foundations Gate

Bloque exclusivamente documental autorizado mediante DEC-076:

- Physical Database Specification;
- addendum normativo M2;
- especificación candidata de canonicalización del registry completo;
- reconciliación de entidades, IDs, versions, effects y fuentes;
- revisión expresa de contenido y hashes.

Artifacts producidos:

- `MALIGN_AI_M2_PHYSICAL_DATABASE_SPEC_v0.1.md`: 87 tablas físicas aprobadas, no DDL; blob final `13cd601b30db2db22be64c4fda5df94144dcf8d5`;
- `MALIGN_AI_CARD_REGISTRY_SPEC_v0.1.md`: 100 definitions, 108 serial templates, 4 aliases, 59 effects y 103 operaciones aprobadas; blob final `d7d1325da916f4f867c4a142f8e345d66eaa780e`;
- `MALIGN_AI_CARD_REGISTRY_SNAPSHOT_v0.1.json`: status `approved`, `seedable=true`; 108 audit rows; JCS SHA-256 final `735fd01b65416bdeb1baaa596bb36ea0d0eef31cb1d1d9b7f4b2322c9c585e4a`; blob final `8d5c150bed742391555bc6bafe022f45baee0163`;
- `MALIGN_AI_M2_CARD_REGISTRY_PRODUCT_OWNER_REVIEW_MATRIX_v0.1.md`: 100/108/6/41/59/103 aprobados, auditoría 102/6/0; blob final `cefed690a7c2068f9fe868efaa3df4b2e504e508`;
- `MALIGN_AI_M2_0_CANONICAL_FOUNDATIONS_GATE_v0.1.md`: resultado `APPROVED AND CLOSED mediante DEC-077`.

### Gate de salida

- Physical DB Spec coherente con PTD-M2-002…005/008/010/011;
- 32/32 IDs del addendum M2 revisados;
- registry candidate reconciliado y `IQ-M2-010` definitivamente resuelta;
- blobs documentales aprobados expresamente;
- ninguna selección silenciosa de provider/ORM/runtime.

En el cierre histórico de DEC-077, REG-CAND-001…004, el Physical DB Spec de 87 tablas, Registry Spec y Snapshot quedaron aprobados; M20-R01…R10 se cerraron e `IQ-M2-010` se resolvió. El snapshot conserva exactamente su proyección semántica de 264610 bytes / SHA-256 `8a46133ca70883df2d173fddd9c725cd0611b2be8311a5fe42057464415d6a13`. DEC-078 resolvió posteriormente IQ-M2-011…013 e implementó M2-A; IQ-M2-008/009 permanecían OPEN en ese momento y fueron resueltas posteriormente mediante DEC-081.

## 7. M2-1 — PostgreSQL Persistence and Durable Recovery

Incluye schema/migrations; registry seed sólo tras aprobación del registry; Unit of Work; transactions; durable idempotency; row lock + CAS; commit atómico de state/events/ledgers/trace/outbox; snapshots, replay y recovery; retention completa sin compaction/hard-delete.

### Invariantes y DoD ejecutado

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

### Cierre mediante DEC-080

M2-A/M2-1 queda **IMPLEMENTED AND APPROVED / CLOSED** en el commit funcional final `85ec047726a68007fbcabf07c6b3fe1b911a3070`. M2A-R01…R30 están **CLOSED**. El owner nominal queda en **22/22 PASS**, el gate acumulado M2-A en **38/38 PASS**, las **14/14 regresiones asignadas previas** y la baseline M0/M1 **215/215** permanecen preservadas, y la suite final reporta **253/253 PASS en 28 archivos, 0 skips, 0 todo y 0 waivers**. Los gates se ejecutaron con PostgreSQL real **18.6**, migrations `001…006` y esquema físico **87/87 tablas**; Catalog SHA-256: `447d8e06e3030a2744135c56edca135a142b2fcc252e69dd377259fc81d8a465`.

## 8. M2-2 — Productive Transport and Reconnect

Incluye, sólo para una futura autorización: HTTP commands/queries; protocolo WebSocket propio y versionado; AuthN application-side; outbox publisher; delivery at-least-once; ordering, dedup y gaps; reconnect/recovery entre procesos o nodos.

DEC-081 resuelve `IQ-M2-008/009` y aprueba PTD-M2-012…016: Auth0 detrás de port application-side; primer frame WebSocket y autoridad PostgreSQL interna; Node.js 24 + `ws` + `malign.realtime.v1`; `LISTEN/NOTIFY` sólo como wake-up; Render como target de referencia y envelope configurable. El Engine no importa HTTP, WebSocket, SDK AuthN ni infraestructura. Cuenta, plan, secrets, versiones exactas, infraestructura y despliegue requieren autorización posterior.

Especificación final del decision gate: `MALIGN_AI_M2_2_PRODUCTIVE_TRANSPORT_AND_RECONNECT_SPEC_v0.1.md`. Estado: **DECISION GATE APPROVED / READY FOR IMPLEMENTATION AUTHORIZATION / NOT AUTHORIZED**.

DoD futuro: handshake no confía en claims del cliente; cursor/projection ligados a viewer; initial sync sin ventana de pérdida; gap recovery desde feed autoritativo; privacy omissions distinguibles sin leakage; **8/8 nuevos únicos** y regresiones dirigidas, más baseline 215/215.

## 9. M2-3 — Complete Scheduler and Remaining Core Rules

Incluye setup/maintenance restantes; planning y negociación; campaign lifecycle restante; costs, bonuses, backlash y legitimacy; manual die; seguridad relacionada; scheduler completo y `GE-M2-SCH-001`.

No incluye comportamiento de Action Cards ni Regime Abilities. El test gate asigna también `GE-M2-EFX-001` a M2-3 para conservar el reparto exacto `37 oracle + 2 addendum`: aquí se prueba exclusivamente el contrato genérico del dispatcher, selección por `effect_id` y versión, handler tipado, determinismo y cobertura exhaustiva del manifest habilitado para M2-3. IDs desconocidos o conocidos pero aún no habilitados fallan cerrados con cero state mutation, costs, AP/Resources, RNG/Clock/provider cursor, events, ledgers, trace, outbox o resultado idempotente. No se exige implementar Action/Starter, Regime, Reaction ni Veto.

DoD futuro: continuations persistibles, actoría SYSTEM correcta, orden por initiative/sequence, costes atómicos y reuse del Rule Kernel; **39/39 nuevos únicos** y regresiones dirigidas, más baseline 215/215.

## 10. M2-4 — Action/Starter Cards and Regime Abilities

Incluye 30 IDs `GE-ACT-*`; 15 IDs `GE-REG-*`; lifecycle, costes, zonas, secretos y proyecciones relacionados; integración de registry effect dispatch.

`GE-M2-EFX-001` conserva owner único M2-3 por el reparto obligatorio de DEC-075 y se reejecuta aquí como `[REGRESSION]` con el manifest expandido para cubrir Action Cards, Starter Cards y Regime Abilities; esa repetición no lo convierte en caso nuevo M2-4.

DoD futuro: 30/30 Action y 15/15 Regime owner, effects sólo por IDs/handlers aprobados, atomicidad completa, no dispatch por nombre/prompt y no leakage; **45/45 nuevos únicos** y regresiones dirigidas, más baseline 215/215.

## 11. M2-5 — Reaction, Veto and Deterministic Narrative

Incluye 10 `GE-REA-*`, cuatro `GE-NAR-*`, cinco `GE-VETO-*`, `GE-AUD-005` y `GE-M2-RX-001…003`; nested continuations, privacy y reconnect.

`GE-M2-EFX-001 [REGRESSION]` se reejecuta nuevamente con el manifest expandido para Reaction, Veto y efectos narrativos determinísticos relacionados. M2-5 demuestra la cobertura completa final de todos los efectos de cartas del registry aprobado y la ausencia de fallback textual o handler genérico silencioso.

DoD futuro: ventanas/priority determinísticas; una sola transición de continuation comprometida mediante idempotencia + CAS, con retry del resultado original y sin afirmar exactly-once delivery; no timer ni auto-pass; `expires_at=null`; F1 auditado; opciones/errores opacos; **23/23 nuevos únicos + 11 regresiones = 34 ejecuciones dirigidas**, más baseline 215/215.

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
| Registry: 108 serial templates por country set × 5 países = 540 `CardInstance`; 100 definition groups aprobados; 5 Starter templates por set = 25 Starter materializadas; aliases | DEC-025/029/077; IQ-M2-010 resuelta | contenido/hash aprobados; implementación futura requiere autorización separada |
| Transaction/outbox | DEC-054; PTD-M2-003/005 | M2-1; `GE-M2-TX-*` |
| Durable replay/recovery | Data Dictionary §28; replay contracts; PTD-M2-004/008 | M2-1; `GE-AUD-004`, `GE-M2-TX-008/009` |
| Productive transport | DEC-053; Contract; IQ-M2-008/009 | M2-2; `GE-M2-RT-*` |
| Scheduler/core remainder | Adjudication; oracle | M2-3; 37 oracle + SCH/EFX |
| Action/Starter/Regime | DEC-011…016/23/25…29/39…47; oracle | M2-4; 45 oracle |
| Reaction/Veto/Narrative | DEC-014/017/018; Contract | M2-5; 20 oracle + RX |
| Cleanup/Viral | DEC-019/042; Adjudication | M2-6; 17 oracle + LC |
| Objectives/Victory/End | DEC-020…024; Scenario | M2-7; 28 oracle + END |

## 16. Riesgos y mitigaciones

| Riesgo | Mitigación | Bloque |
|---|---|---|
| schema cristaliza interpretación no aprobada | M2-0 cerrado mediante DEC-077; cambios futuros requieren nuevo gate | M2-1 |
| seed con contenido no aprobado | verificación JCS fail-closed antes de write; snapshot DEC-077 | M2-1 |
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
| IQ-M2-004 | RESOLVED AS BOUNDARY | provider resuelto posteriormente en IQ-M2-008/DEC-081 |
| IQ-M2-005 | RESOLVED AS CONTRACT DIRECTION | runtime/envelope resuelto posteriormente en IQ-M2-009/DEC-081 |
| IQ-M2-008 | RESOLVED mediante DEC-081 | Auth0 application-side; identidad `sub` verificada y autoridad PostgreSQL interna |
| IQ-M2-009 | RESOLVED mediante DEC-081 | WSS + Node.js 24/`ws` + protocolo propio + Render; LISTEN/NOTIFY sólo wake-up |
| IQ-M2-010 | RESOLVED mediante DEC-077 | REG-CAND-001…004 aprobadas; no autoriza implementación |
| IQ-M2-011 | RESOLVED mediante DEC-078 | PostgreSQL 18.6 `uuidv7()` sin extensión; defaults/checks/RETURNING implementados |
| IQ-M2-012 | RESOLVED mediante DEC-078 | sin RLS en M2-A; tres roles de mínimo privilegio y `PUBLIC` revocado |
| IQ-M2-013 | RESOLVED FOR M2 mediante DEC-078 | no partition/archive/compaction/hard-delete; planes y query counts instrumentados |
| IQ-M2-014 | RESOLVED mediante DEC-079 | mascots oficiales persistidos como `NOT NULL` con referencia normativa primaria |
| IQ-M2-015 | RESOLVED mediante DEC-079 | bootstrap administrativo separado e idempotente para roles y migrations |

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

El planning gate queda **APPROVED AND CLOSED mediante DEC-076** y M2-0 **APPROVED AND CLOSED mediante DEC-077**. M2-A/M2-1 queda **IMPLEMENTED AND APPROVED / CLOSED mediante DEC-080**, con commit funcional final `85ec047726a68007fbcabf07c6b3fe1b911a3070`, M2A-R01…R30 **CLOSED**, owner nominal **22/22 PASS**, gate acumulado **38/38 PASS**, regresiones asignadas previas **14/14 preservadas**, baseline M0/M1 **215/215 preservada** y suite final **253/253 PASS en 28 archivos** sobre PostgreSQL 18.6, migrations `001…006`, esquema físico **87/87 tablas** y Catalog SHA-256 `447d8e06e3030a2744135c56edca135a142b2fcc252e69dd377259fc81d8a465`. IQ-M2-008…015 están **RESOLVED** según sus decisiones aplicables. El decision gate M2-2 queda **APPROVED / READY FOR IMPLEMENTATION AUTHORIZATION / NOT AUTHORIZED mediante DEC-081**, con 8 owners + 17 regresiones = 25 ejecuciones dirigidas, baseline previa 253/253 y suite mínima futura 261 casos únicos. M2-3…M2-7 permanecen **NOT AUTHORIZED**, M2 global **NOT YET CLOSED** y M3 **NOT AUTHORIZED**.
