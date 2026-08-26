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
| Physical DB Spec v0.1 corregida | 87 tablas; M20-R01…R06 implementadas documentalmente; recheck concurrente y orden event/ordinal explícitos; blob candidato `873049f4dba4297a87f3e8dfdccaf028cc2c4a1f` |
| Registry Spec v0.1 | 100 definitions/108 templates/59 effects/103 operaciones/108 audit rows; blob candidato `c3129937a45f55c94a7546c350b93ac331f5b7b6` |
| Registry Snapshot v0.1 | JCS SHA-256 `6f777a5bafe7611389d80baa47fa3f0a785014d10b659e3446846bf735e1c897`; blob candidato `d8d8afe220d76043d836c5ba15f89acde0f3a939` |
| Product Owner Review Matrix v0.1 | 100/108/6/41/59/103 completos, auditoría primaria 108/108 y checklist canónico vacío; blob candidato `1dbfee8a72016787dd8b829bc1ffb1cf8dc0d826` |
| Primary source M20-R09 | **PREFLIGHT PASS / 108 OF 108 AUDITED**: `Cartas frente.pdf`, SHA-256 verificado `3301fd9e92e5d8a8df7a3efc1407434afe0395263a5d6c0e16e0e486faa35113`; página N = serial N; fuente externa, ausente del repo y del diff. El DOCX fue sólo apoyo, no autoridad. |
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
| PDB-06 | sequences monotónicas, journals append-only y artifacts/outbox atómicos | Game/CAS; event_sequence+artifact_ordinal en ledgers/traces; rollback sin gaps; outbox message/state/attempt; §§5–6 | PASS documental / correction pending review |
| PDB-07 | continuations/Choice/Narrative persistidas y versionadas | #49, #50, #55 | PASS documental |
| PDB-08 | snapshots, replay, idempotency, outbox, cursor y requests durables | continuations/snapshots; fast lookup + recheck obligatorio bajo Game lock; outbox message/state/attempt; cursors/requests | PASS documental / correction pending review |
| PDB-09 | privacy/ownership/secret handling documentados | §2.2, tablas SEC y §9 | PASS documental |
| PDB-10 | migration/retention/backup/restore sin down destructivo | §10 | PASS documental |
| PDB-11 | query/index/N+1 y GE-M2-DB-001 manifest | §§7 y 11 | PASS documental |
| PDB-12 | decisiones técnicas restantes identificadas, no inventadas | IQ-M2-011 UUIDv7, IQ-M2-012 RLS, IQ-M2-013 partitioning | PASS documental / OPEN review |
| PDB-13 | aprobación humana del contenido físico y blob | no existe decisión posterior a DEC-076 | **FAIL — PENDING REVIEW** |

Resultado Physical DB: **M20-R01…R06 CORRECTION IMPLEMENTED / PENDING PRODUCT OWNER AND TECHNICAL REVIEW — NO EXECUTABLE SCHEMA AUTHORIZED**.

## 3. Criterios binarios — Card Registry

| ID | Criterio de PASS | Evidencia | Resultado |
|---|---|---|---|
| REG-01 | 108/108 serial templates y serial único 1…108 | JSON parse/uniqueness; §4 Registry Spec | PASS mecánico |
| REG-02 | 100/100 definitions con logical IDs separados | JSON; `D001…D100` candidato | PASS mecánico / IDs pendientes |
| REG-03 | seis duplicate-name groups comparados semánticamente | Registry Spec §5 + Review Matrix §5 (6/6) | PASS documental / grouping pendiente |
| REG-04 | 5/5 Starter por country y 103 pool | JSON materialization + cardinality check | PASS mecánico |
| REG-05 | cinco países y 540/25 materialización | JSON materialization | PASS mecánico |
| REG-06 | cuatro aliases aprobados sin collisions | Registry Spec §8 + JSON uniqueness | PASS mecánico |
| REG-07 | 100 IDs y mapping 108→100, incluidos seis grupos exactos, aprobados | Review Matrix §§3–5 y 8: 100/108/6 auditados; decisión pendiente | **FAIL — REG-CAND-001** |
| REG-08 | nombres, tipos/subtipos, alignment, IV, costes, flags y 41 ausencias aprobados | Review Matrix §§3, 6, 8–9: evidencia primaria exhaustiva; decisión pendiente | **FAIL — REG-CAND-002** |
| REG-09 | 59 effect IDs, triggers, timings, 103 operaciones, orden y parámetros aprobados | Review Matrix §7: 103/103 parámetros completos pendientes de aprobación | **FAIL — REG-CAND-003** |
| REG-10 | JCS SHA-256 y Git blob hashes finales aprobados después de REG-CAND-001…003 | hashes candidatos recalculados; no hay aprobación expresa | **FAIL — REG-CAND-004** |
| REG-11 | ningún ID M1 `BASE_CARD_001…108` elevado a 100 definitions | namespace candidato separado | PASS |
| REG-12 | seed/fixture/handler no creado | scope diff | PASS |

Resultado Registry: **M20-R07…R09 CORRECTION IMPLEMENTED / PENDING PRODUCT OWNER AND TECHNICAL REVIEW — NOT SEEDABLE**.

### 3.1 Corrección M20-R01…R04

| Hallazgo | Corrección documental | Estado |
|---|---|---|
| M20-R01 — AP auditability | `action_point_balances` queda como proyección mutable y `action_point_transactions` como journal autoritativo append-only; reconciliación y rollback están fijados. | **CORRECTION IMPLEMENTED / PENDING TECHNICAL REVIEW** |
| M20-R02 — durable idempotency lifecycle | identidad/fingerprint inmutables, reserva interna en la command tx, sólo `COMMITTED` durable, retry/mismatch/CAS-loser y fault boundaries explícitos. | **CORRECTION IMPLEMENTED / PENDING TECHNICAL REVIEW** |
| M20-R03 — outbox attempt history | mensaje inmutable, delivery state mutable e historial de attempts append-only; etapas de crash/retry y reconstrucción post-commit explícitas. | **CORRECTION IMPLEMENTED / PENDING TECHNICAL REVIEW** |
| M20-R04 — human registry review | nueva matriz exhaustiva 100/108/6/41/59, source trace y checklist REG-CAND-001…004 vacío. | **CORRECTION IMPLEMENTED / PENDING PRODUCT OWNER AND TECHNICAL REVIEW** |

### 3.2 Segunda corrección M20-R05…R09

El preflight de `Cartas frente.pdf` verificó exactamente SHA-256 `3301fd9e92e5d8a8df7a3efc1407434afe0395263a5d6c0e16e0e486faa35113`, 108 páginas y mapping página N = serial N. El PDF permaneció externo y no fue copiado a Git. Con ese gate satisfecho se ejecutó la corrección documental completa:

| Hallazgo | Evidencia de corrección | Estado |
|---|---|---|
| M20-R05 — concurrent idempotency recheck | fast path, lock Game, recheck obligatorio, same-fingerprint return antes de expected version, typed mismatch y casos concurrentes/fault matrix/manifest | **CORRECTION IMPLEMENTED / PENDING TECHNICAL REVIEW** |
| M20-R06 — deterministic journal ordering | `game_event_sequence + artifact_ordinal`, UK/CK/IDX, replay total y rollback/CAS sin gaps en resource/AP/VP/influence/legitimacy/traces | **CORRECTION IMPLEMENTED / PENDING TECHNICAL REVIEW** |
| M20-R07 — canonical REG-CAND meanings | §§5–10, gate y checklist usan exactamente IDs/mapping; campos+41 ausencias; 59 effects+103 ops; hashes finales posteriores | **CORRECTION IMPLEMENTED / PENDING PRODUCT OWNER AND TECHNICAL REVIEW** |
| M20-R08 — complete typed parameters | 103/103 operaciones con parámetros machine-readable y provenance; 103 complete pending approval, 0 unknown/N/A/unresolved; unknown falla cerrado | **CORRECTION IMPLEMENTED / PENDING PRODUCT OWNER AND TECHNICAL REVIEW** |
| M20-R09 — exhaustive primary-source audit | 108/108 páginas; 102 MATCH, 5 DIFFERENCE, 1 AMBIGUOUS; cinco starters, cuatro aliases, seis grupos, 59 effects/41 ausencias por definition | **CORRECTION IMPLEMENTED / PENDING PRODUCT OWNER AND TECHNICAL REVIEW** |

La corrección no selecciona casillas, no aprueba hashes, no vuelve seedable/ACTIVE al registry y no crea DEC-077.

## 4. Criterios binarios — Snapshot y reproducibilidad

| ID | Criterio de PASS | Resultado |
|---|---|---|
| SNP-01 | JSON válido; status `candidate_pending_review` | PASS |
| SNP-02 | 100 definitions, 108 templates, 4 aliases, 59 effects, 103 operations y 108 audit rows | PASS |
| SNP-03 | keys canonicalizables, arrays con orden declarado, sólo JSON válido | PASS |
| SNP-04 | serial/template/definition/effect/alias uniqueness y refs completas | PASS |
| SNP-05 | Markdown↔snapshot igualdad de conteos/mapping/hashes | PASS mecánico |
| SNP-06 | JCS determinístico en dos canonicalizaciones independientes | PASS; `6f777a5bafe7611389d80baa47fa3f0a785014d10b659e3446846bf735e1c897` |
| SNP-07 | source digests y hashes normativos preservados | PASS mecánico |
| SNP-08 | JCS SHA y blobs aprobados expresamente | **FAIL — PENDING PRODUCT OWNER APPROVAL** |

## 5. IQ-M2-010 y bloqueos exactos

`IQ-M2-010` queda **PARTIALLY RESOLVED / BLOCKED BY LISTED ITEMS**. La nueva matriz hace todos los candidatos revisables, pero no selecciona ni sustituye las decisiones:

- `REG-CAND-001`: aprobar/corregir 100 IDs y mapping 108→100, incluidos 95–96, 97–98, 99–101, 102–103, 104–106 y 107–108;
- `REG-CAND-002`: aprobar/corregir names, types/subtypes, alignment, IV, costs, flags y las 41 ausencias de efecto;
- `REG-CAND-003`: aprobar/corregir 59 effect IDs, triggers, timings, 103 operations, order y machine-readable parameters;
- `REG-CAND-004`: aprobar JCS SHA-256 y Git blob hashes finales sólo después de resolver REG-CAND-001…003.

Bloquean el cierre M2-0, el registry seed de M2-1, el manifest completo M2-3 y los effects de M2-4/M2-5. `IQ-M2-011…013` permanecen **OPEN**. IQ-M2-008 y IQ-M2-009 también permanecen OPEN y bloquean el claim productivo M2-2.

## 6. Resultado del gate

```text
M2-0 RESULT = BLOCKED / PENDING PRODUCT OWNER AND TECHNICAL REVIEW
```

Razón binaria: M20-R01…R09 están **CORRECTION IMPLEMENTED / PENDING REVIEW**, pero PDB-13, REG-07…10 y SNP-08 siguen FAIL/PENDING hasta aprobación humana. La corrección técnica-documental no sustituye esa decisión; registry/snapshot/matriz permanecen candidatos no aprobados y `seedable=false`. Por tanto:

- M2-0 **no** queda APPROVED ni CLOSED;
- M2-1…M2-7 permanecen **NOT AUTHORIZED**;
- M2 global y M3 permanecen **NOT AUTHORIZED**;
- PostgreSQL schema/migrations/seed/outbox, realtime productivo, Action/Reaction/Veto/Regime/Cleanup/Objectives/Victory, UI, AuthN productiva e IA no han iniciado.

## 7. Próxima acción permitida

Revisión técnica de M20-R05/R06 y decisión humana explícita REG-CAND-001…004 sobre la matriz, contenido y hashes candidatos. Hasta entonces M2-0 permanece bloqueado y no cerrado. Ningún bloque M2-1…M2-7 ni paso de implementación queda implícitamente autorizado.
