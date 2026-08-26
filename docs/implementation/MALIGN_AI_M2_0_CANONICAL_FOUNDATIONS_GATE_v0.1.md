# MALIGN-AI — M2-0 CANONICAL FOUNDATIONS GATE v0.1

**Fecha:** 2026-08-26
**Estado:** **BLOCKED / PENDING PRODUCT OWNER AND TECHNICAL REVIEW**
**Autoridad de ejecución documental:** DEC-076
**M2-1…M2-7, M2 y M3:** **NOT AUTHORIZED**

> Este gate sólo evalúa artifacts documentales. `PASS` requiere revisión humana y aprobación expresa de contenido y hashes; la mera existencia de archivos o un check mecánico verde no cierra M2-0.

## 1. Inputs fijados

| Input | Estado/hash |
|---|---|
| Planning gate M2 corregido | APPROVED/CLOSED mediante DEC-076 en base `2bfc49d17722538ee2f2688d5dd3735b1468fe5c` |
| M2G-R01…R05 | CLOSED mediante DEC-076 |
| Addendum M2 v0.1 | 32 IDs canónicos; blob `6ae87a904a14a82e4fb174ff4d76eefd47052832` |
| Candidate histórico registry | preservado, no canónico; blob `fbcb750e72ae50a2bd4444789b0cfd11e75d7ab0` |
| Physical DB Spec v0.1 corregida | 87 tablas documentadas; AP balance+journal, idempotencia transaction-sealed y outbox message/state/attempt; blob candidato `90a7236e2fde6c86e807764630a579bc494aee7a` |
| Registry Spec v0.1 | 100 definitions/108 templates/59 effects; blob candidato `6472b136a806f403747defe1d59ed44fb78f49fa` |
| Registry Snapshot v0.1 | JCS SHA-256 `37e1e27e142a2e08d8a19418089602bc72d775b9f5944059acc27ee4de93c83e`; blob candidato `a8c3ee9f3b78113e1f94891a9b0c634083107ec3` |
| Product Owner Review Matrix v0.1 | 100 definitions, expansión 108→100, 6 grupos repetidos, 41 ausencias de efecto, 59 efectos y checklist vacío; blob candidato `e148918b9414c49baa25fd84691ce8328edd4f14` |
| Baseline ejecutable histórica | 215/215 PASS, 0 skips/todo/waivers; no reejecutada en M2-0 |

Los hashes de los artifacts candidatos son datos de integridad para revisión, no hashes aprobados.

## 2. Criterios binarios — Physical Database Specification

| ID | Criterio de PASS | Evidencia | Resultado |
|---|---|---|---|
| PDB-01 | Conteo físico exacto y reconciliación con modelo/diccionario/contract | 87 = 61 catálogo + ScenarioCountryConfig + 3 joins explícitos + 22 extensiones | PASS documental / correction pending review |
| PDB-02 | Cada tabla documenta columnas/tipos/null/default, PK/FK/UK/checks/índices | catálogo #1…87 y convenciones M/A/TXS/V | PASS documental / correction pending review |
| PDB-03 | logical IDs separados de UUIDv7 físicos y version pins explícitos | §2, §3 y §4 | PASS documental |
| PDB-04 | lookup/version tables y estado crítico normalizado | tablas versionadas/reference, estado normalizado y prohibiciones JSON §8 | PASS documental |
| PDB-05 | Game row lock + CAS/READ COMMITTED + un command/tx | §6 | PASS documental |
| PDB-06 | sequences monotónicas, journals append-only y artifacts/outbox atómicos | Game/CAS; resource/AP/VP journals; events/traces; outbox message/state/attempt; §§5–6 | PASS documental / correction pending review |
| PDB-07 | continuations/Choice/Narrative persistidas y versionadas | #49, #50, #55 | PASS documental |
| PDB-08 | snapshots, replay, idempotency, outbox, cursor y requests durables | continuations/snapshots; idempotencia transaction-sealed; outbox message/state/attempt; cursors/requests | PASS documental / correction pending review |
| PDB-09 | privacy/ownership/secret handling documentados | §2.2, tablas SEC y §9 | PASS documental |
| PDB-10 | migration/retention/backup/restore sin down destructivo | §10 | PASS documental |
| PDB-11 | query/index/N+1 y GE-M2-DB-001 manifest | §§7 y 11 | PASS documental |
| PDB-12 | decisiones técnicas restantes identificadas, no inventadas | IQ-M2-011 UUIDv7, IQ-M2-012 RLS, IQ-M2-013 partitioning | PASS documental / OPEN review |
| PDB-13 | aprobación humana del contenido físico y blob | no existe decisión posterior a DEC-076 | **FAIL — PENDING REVIEW** |

Resultado Physical DB: **M20-R01…R03 CORRECTION IMPLEMENTED / PENDING TECHNICAL REVIEW — NO EXECUTABLE SCHEMA AUTHORIZED**.

## 3. Criterios binarios — Card Registry

| ID | Criterio de PASS | Evidencia | Resultado |
|---|---|---|---|
| REG-01 | 108/108 serial templates y serial único 1…108 | JSON parse/uniqueness; §4 Registry Spec | PASS mecánico |
| REG-02 | 100/100 definitions con logical IDs separados | JSON; `D001…D100` candidato | PASS mecánico / IDs pendientes |
| REG-03 | seis duplicate-name groups comparados semánticamente | Registry Spec §5 + Review Matrix §5 (6/6) | PASS documental / grouping pendiente |
| REG-04 | 5/5 Starter por country y 103 pool | JSON materialization + cardinality check | PASS mecánico |
| REG-05 | cinco países y 540/25 materialización | JSON materialization | PASS mecánico |
| REG-06 | cuatro aliases aprobados sin collisions | Registry Spec §8 + JSON uniqueness | PASS mecánico |
| REG-07 | tipo/subtype/alignment/IV/cost por definition con autoridad suficiente | Review Matrix §3: 100/100, con authority/source trace; evidencia DRAFT, no aprobada | **FAIL — REG-CAND-001/002** |
| REG-08 | effect IDs, triggers, timings, operations y parameters aprobados | Review Matrix §7: 59/59 mappings candidatas completas; approval pendiente | **FAIL — REG-CAND-003** |
| REG-09 | ausencia de efecto aprobada para las otras 41 definitions | Review Matrix §6: 41/41 identificadas; verificación primaria pendiente | **FAIL — REG-CAND-003** |
| REG-10 | snapshot/hash expresamente aprobados para seed | no hay aprobación de contenido/hash | **FAIL — REG-CAND-004** |
| REG-11 | ningún ID M1 `BASE_CARD_001…108` elevado a 100 definitions | namespace candidato separado | PASS |
| REG-12 | seed/fixture/handler no creado | scope diff | PASS |

Resultado Registry: **CANONICAL CANDIDATE / PENDING PRODUCT OWNER APPROVAL — NOT SEEDABLE**.

### 3.1 Corrección M20-R01…R04

| Hallazgo | Corrección documental | Estado |
|---|---|---|
| M20-R01 — AP auditability | `action_point_balances` queda como proyección mutable y `action_point_transactions` como journal autoritativo append-only; reconciliación y rollback están fijados. | **CORRECTION IMPLEMENTED / PENDING TECHNICAL REVIEW** |
| M20-R02 — durable idempotency lifecycle | identidad/fingerprint inmutables, reserva interna en la command tx, sólo `COMMITTED` durable, retry/mismatch/CAS-loser y fault boundaries explícitos. | **CORRECTION IMPLEMENTED / PENDING TECHNICAL REVIEW** |
| M20-R03 — outbox attempt history | mensaje inmutable, delivery state mutable e historial de attempts append-only; etapas de crash/retry y reconstrucción post-commit explícitas. | **CORRECTION IMPLEMENTED / PENDING TECHNICAL REVIEW** |
| M20-R04 — human registry review | nueva matriz exhaustiva 100/108/6/41/59, source trace y checklist REG-CAND-001…004 vacío. | **CORRECTION IMPLEMENTED / PENDING PRODUCT OWNER AND TECHNICAL REVIEW** |

## 4. Criterios binarios — Snapshot y reproducibilidad

| ID | Criterio de PASS | Resultado |
|---|---|---|
| SNP-01 | JSON válido; status `candidate_pending_review` | PASS |
| SNP-02 | 100 definitions, 108 templates, 4 aliases, 59 effects | PASS |
| SNP-03 | keys canonicalizables, arrays con orden declarado, sólo JSON válido | PASS |
| SNP-04 | serial/template/definition/effect/alias uniqueness y refs completas | PASS |
| SNP-05 | Markdown↔snapshot igualdad de conteos/mapping/hashes | PASS mecánico |
| SNP-06 | JCS determinístico en dos canonicalizaciones independientes | PASS; `37e1e27e…de93c83e` |
| SNP-07 | source digests y hashes normativos preservados | PASS mecánico |
| SNP-08 | JCS SHA y blobs aprobados expresamente | **FAIL — PENDING PRODUCT OWNER APPROVAL** |

## 5. IQ-M2-010 y bloqueos exactos

`IQ-M2-010` queda **PARTIALLY RESOLVED / BLOCKED BY LISTED ITEMS**. La nueva matriz hace todos los candidatos revisables, pero no selecciona ni sustituye las decisiones:

- `REG-CAND-001`: aprobar/corregir 100 IDs y mapping 108→100, incluidos seis grupos repetidos;
- `REG-CAND-002`: aprobar/corregir names, types/subtypes, alignment, IV, costs y las 41 ausencias de efecto observadas;
- `REG-CAND-003`: aprobar/corregir 59 effect IDs, triggers, timings, operations y parameters;
- `REG-CAND-004`: tras cualquier corrección, recalcular y aprobar JCS SHA-256 y Git blob hashes.

Bloquean el cierre M2-0, el registry seed de M2-1, el manifest completo M2-3 y los effects de M2-4/M2-5. `IQ-M2-011…013` permanecen **OPEN**. IQ-M2-008 y IQ-M2-009 también permanecen OPEN y bloquean el claim productivo M2-2.

## 6. Resultado del gate

```text
M2-0 RESULT = BLOCKED / PENDING PRODUCT OWNER AND TECHNICAL REVIEW
```

Razón binaria: las correcciones M20-R01…R04 están implementadas documentalmente, pero PDB-13, REG-07…10 y SNP-08 siguen FAIL/PENDING hasta revisión. El artifact físico está documentado, y registry/snapshot/matriz son reproducibles como candidatos, pero no existe aprobación humana de contenido ni hashes. Por tanto:

- M2-0 **no** queda APPROVED ni CLOSED;
- M2-1…M2-7 permanecen **NOT AUTHORIZED**;
- M2 global y M3 permanecen **NOT AUTHORIZED**;
- PostgreSQL schema/migrations/seed/outbox, realtime productivo, Action/Reaction/Veto/Regime/Cleanup/Objectives/Victory, UI, AuthN productiva e IA no han iniciado.

## 7. Próxima acción permitida

Revisión técnica de Physical DB Spec + Gate y revisión del Product Owner/técnica de Registry Spec + Snapshot + Review Matrix; después, resolución expresa de `REG-CAND-001…004`/IQ-M2-010. Si hay cambios, se recalculan hashes y se repite este gate. Ningún paso de implementación queda implícitamente autorizado.
