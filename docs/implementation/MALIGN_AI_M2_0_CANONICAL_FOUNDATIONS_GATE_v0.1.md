# MALIGN-AI — M2-0 CANONICAL FOUNDATIONS GATE v0.1

**Fecha:** 2026-08-25
**Estado:** **BLOCKED / PENDING RESOLUTION**
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
| Physical DB Spec v0.1 | 84 tablas documentadas; blob candidato `30a8bc9657fb958e21a09af22591f6e959edb3fe` |
| Registry Spec v0.1 | 100 definitions/108 templates/59 effects; blob candidato `6472b136a806f403747defe1d59ed44fb78f49fa` |
| Registry Snapshot v0.1 | JCS SHA-256 `37e1e27e142a2e08d8a19418089602bc72d775b9f5944059acc27ee4de93c83e`; blob candidato `a8c3ee9f3b78113e1f94891a9b0c634083107ec3` |
| Baseline ejecutable histórica | 215/215 PASS, 0 skips/todo/waivers; no reejecutada en M2-0 |

Los hashes de los tres artifacts nuevos son candidatos de revisión, no hashes aprobados.

## 2. Criterios binarios — Physical Database Specification

| ID | Criterio de PASS | Evidencia | Resultado |
|---|---|---|---|
| PDB-01 | Conteo físico exacto y reconciliación con modelo/diccionario/contract | 84 = 61 catálogo + ScenarioCountryConfig + 3 joins explícitos + 19 extensiones | PASS documental |
| PDB-02 | Cada tabla documenta columnas/tipos/null/default, PK/FK/UK/checks/índices | catálogo #1…84 y convenciones M/A/V | PASS documental |
| PDB-03 | logical IDs separados de UUIDv7 físicos y version pins explícitos | §2, §3 y §4 | PASS documental |
| PDB-04 | lookup/version tables y estado crítico normalizado | #3…7, #8…78; prohibiciones JSON §8 | PASS documental |
| PDB-05 | Game row lock + CAS/READ COMMITTED + un command/tx | §6 | PASS documental |
| PDB-06 | sequences monotónicas, append-only y artifacts/outbox atómicos | #28, #38, #45…46, #53…66, #77…81 y §6 | PASS documental |
| PDB-07 | continuations/Choice/Narrative persistidas y versionadas | #49, #50, #55 | PASS documental |
| PDB-08 | snapshots, replay, idempotency, outbox, cursor y requests durables | #49…55 y #79…84 | PASS documental |
| PDB-09 | privacy/ownership/secret handling documentados | §2.2, tablas SEC y §9 | PASS documental |
| PDB-10 | migration/retention/backup/restore sin down destructivo | §10 | PASS documental |
| PDB-11 | query/index/N+1 y GE-M2-DB-001 manifest | §§7 y 11 | PASS documental |
| PDB-12 | decisiones técnicas restantes identificadas, no inventadas | IQ-M2-011 UUIDv7, IQ-M2-012 RLS, IQ-M2-013 partitioning | PASS documental / OPEN review |
| PDB-13 | aprobación humana del contenido físico y blob | no existe decisión posterior a DEC-076 | **FAIL — PENDING REVIEW** |

Resultado Physical DB: **DOCUMENTED / PENDING REVIEW — NO EXECUTABLE SCHEMA AUTHORIZED**.

## 3. Criterios binarios — Card Registry

| ID | Criterio de PASS | Evidencia | Resultado |
|---|---|---|---|
| REG-01 | 108/108 serial templates y serial único 1…108 | JSON parse/uniqueness; §4 Registry Spec | PASS mecánico |
| REG-02 | 100/100 definitions con logical IDs separados | JSON; `D001…D100` candidato | PASS mecánico / IDs pendientes |
| REG-03 | seis duplicate-name groups comparados semánticamente | Registry Spec §5 | PASS documental / grouping pendiente |
| REG-04 | 5/5 Starter por country y 103 pool | JSON materialization + cardinality check | PASS mecánico |
| REG-05 | cinco países y 540/25 materialización | JSON materialization | PASS mecánico |
| REG-06 | cuatro aliases aprobados sin collisions | Registry Spec §8 + JSON uniqueness | PASS mecánico |
| REG-07 | tipo/subtype/alignment/IV/cost por definition con autoridad suficiente | datos completos como evidencia DRAFT, no aprobados | **FAIL — REG-CAND-002** |
| REG-08 | effect IDs, triggers, timings, operations y parameters aprobados | 59 mappings candidatas; parameters pending | **FAIL — REG-CAND-003** |
| REG-09 | ausencia de efecto aprobada para las otras 41 definitions | sólo ausencia observada en DRAFT | **FAIL — REG-CAND-002** |
| REG-10 | snapshot/hash expresamente aprobados para seed | no hay aprobación de contenido/hash | **FAIL — REG-CAND-004** |
| REG-11 | ningún ID M1 `BASE_CARD_001…108` elevado a 100 definitions | namespace candidato separado | PASS |
| REG-12 | seed/fixture/handler no creado | scope diff | PASS |

Resultado Registry: **CANONICAL CANDIDATE / PENDING PRODUCT OWNER APPROVAL — NOT SEEDABLE**.

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

`IQ-M2-010` queda **PARTIALLY RESOLVED / BLOCKED BY LISTED ITEMS**:

- `REG-CAND-001`: aprobar/corregir 100 IDs y mapping 108→100, incluidos seis grupos repetidos;
- `REG-CAND-002`: aprobar/corregir names, types/subtypes, alignment, IV, costs y las 41 ausencias de efecto observadas;
- `REG-CAND-003`: aprobar/corregir 59 effect IDs, triggers, timings, operations y parameters;
- `REG-CAND-004`: tras cualquier corrección, recalcular y aprobar JCS SHA-256 y Git blob hashes.

Bloquean el cierre M2-0, el registry seed de M2-1, el manifest completo M2-3 y los effects de M2-4/M2-5. No bloquean conservar el plan aprobado ni revisar el Physical DB Spec. IQ-M2-008 y IQ-M2-009 permanecen OPEN y bloquean el claim productivo M2-2.

## 6. Resultado del gate

```text
M2-0 RESULT = BLOCKED / PENDING RESOLUTION
```

Razón binaria: PDB-13, REG-07…10 y SNP-08 están FAIL/PENDING. El artifact físico está documentado, y el registry/snapshot son reproducibles como candidatos, pero no existe aprobación humana de contenido ni hashes. Por tanto:

- M2-0 **no** queda APPROVED ni CLOSED;
- M2-1…M2-7 permanecen **NOT AUTHORIZED**;
- M2 global y M3 permanecen **NOT AUTHORIZED**;
- PostgreSQL schema/migrations/seed/outbox, realtime productivo, Action/Reaction/Veto/Regime/Cleanup/Objectives/Victory, UI, AuthN productiva e IA no han iniciado.

## 7. Próxima acción permitida

Revisión humana de los tres artifacts candidatos y resolución expresa de `REG-CAND-001…004`/IQ-M2-010. Si hay cambios, se recalculan hashes y se repite este gate. Ningún paso de implementación queda implícitamente autorizado.
