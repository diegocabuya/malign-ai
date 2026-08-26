# MALIGN-AI — M2-0 CANONICAL FOUNDATIONS GATE v0.1

**Fecha:** 2026-08-26
**Estado:** **APPROVED AND CLOSED mediante DEC-077**
**Autoridad de ejecución documental:** DEC-076 + DEC-077
**M2-1/M2-A, M2-2…M2-7, M2 y M3:** **NOT AUTHORIZED**

> Este gate sólo evalúa artifacts documentales. DEC-077 aporta la aprobación humana expresa y la finalización mecánica conserva exactamente la proyección semántica congelada.

## 1. Inputs fijados

| Input | Estado/hash |
|---|---|
| Planning gate M2 corregido | APPROVED/CLOSED mediante DEC-076 en base `2bfc49d17722538ee2f2688d5dd3735b1468fe5c` |
| M2G-R01…R05 | CLOSED mediante DEC-076 |
| Addendum M2 v0.1 | 32 IDs canónicos; blob `6ae87a904a14a82e4fb174ff4d76eefd47052832` |
| Candidate histórico registry | preservado, no canónico; blob `fbcb750e72ae50a2bd4444789b0cfd11e75d7ab0` |
| Physical DB Spec v0.1 | 87 tablas; contenido semántico aprobado; blob final `13cd601b30db2db22be64c4fda5df94144dcf8d5` |
| Registry Spec v0.1 | 100 definitions/108 templates/59 effects/103 operaciones/108 audit rows; blob final `d7d1325da916f4f867c4a142f8e345d66eaa780e` |
| Registry Snapshot v0.1 | APPROVED/SEEDABLE; JCS SHA-256 final `735fd01b65416bdeb1baaa596bb36ea0d0eef31cb1d1d9b7f4b2322c9c585e4a`; blob final `8d5c150bed742391555bc6bafe022f45baee0163` |
| Product Owner Review Matrix v0.1 | 100/108/6/41/59/103 aprobados, auditoría primaria 108/108; blob final `cefed690a7c2068f9fe868efaa3df4b2e504e508` |
| Primary source M20-R09 | **PREFLIGHT PASS / 108 OF 108 AUDITED**: `Cartas frente.pdf`, SHA-256 verificado `3301fd9e92e5d8a8df7a3efc1407434afe0395263a5d6c0e16e0e486faa35113`; página N = serial N; fuente externa, ausente del repo y del diff. El DOCX fue sólo apoyo, no autoridad. |
| Baseline ejecutable histórica | 215/215 PASS, 0 skips/todo/waivers; no reejecutada en M2-0 |

DEC-077 conserva el JCS candidato previo `eb98696020d3694acd8a3374d27ec064ef6db16fd6ea083bb4eaeaac9b30ba74` y aprueba los hashes finales anteriores. La proyección semántica antes/después tiene 264610 bytes y SHA-256 `8a46133ca70883df2d173fddd9c725cd0611b2be8311a5fe42057464415d6a13`.

## 2. Criterios binarios — Physical Database Specification

| ID | Criterio de PASS | Evidencia | Resultado |
|---|---|---|---|
| PDB-01 | Conteo físico exacto y reconciliación con modelo/diccionario/contract | 87 = 61 catálogo + ScenarioCountryConfig + 3 joins explícitos + 22 extensiones | PASS |
| PDB-02 | Cada tabla documenta columnas/tipos/null/default, PK/FK/UK/checks/índices | catálogo #1…87 y convenciones M/A/TXS/V | PASS |
| PDB-03 | logical IDs separados de UUIDv7 físicos y version pins explícitos | §2, §3 y §4 | PASS documental |
| PDB-04 | lookup/version tables y estado crítico normalizado | tablas versionadas/reference, estado normalizado y prohibiciones JSON §8 | PASS documental |
| PDB-05 | Game row lock + CAS/READ COMMITTED + un command/tx | §6 | PASS documental |
| PDB-06 | sequences monotónicas, journals append-only y artifacts/outbox atómicos | Game/CAS; event_sequence+artifact_ordinal en ledgers/traces; rollback sin gaps; outbox message/state/attempt; §§5–6 | PASS |
| PDB-07 | continuations/Choice/Narrative persistidas y versionadas | #49, #50, #55 | PASS documental |
| PDB-08 | snapshots, replay, idempotency, outbox, cursor y requests durables | continuations/snapshots; fast lookup + recheck obligatorio bajo Game lock; outbox message/state/attempt; cursors/requests | PASS |
| PDB-09 | privacy/ownership/secret handling documentados | §2.2, tablas SEC y §9 | PASS documental |
| PDB-10 | migration/retention/backup/restore sin down destructivo | §10 | PASS documental |
| PDB-11 | query/index/N+1 y GE-M2-DB-001 manifest | §§7 y 11 | PASS documental |
| PDB-12 | decisiones técnicas restantes identificadas, no inventadas | IQ-M2-011 UUIDv7, IQ-M2-012 RLS, IQ-M2-013 partitioning permanecen OPEN para bloques futuros | PASS |
| PDB-13 | aprobación humana del contenido físico y blob | DEC-077; blob `13cd601b30db2db22be64c4fda5df94144dcf8d5` | PASS |

Resultado Physical DB: **APPROVED mediante DEC-077 — 87 TABLES — NO EXECUTABLE SCHEMA AUTHORIZED**.

## 3. Criterios binarios — Card Registry

| ID | Criterio de PASS | Evidencia | Resultado |
|---|---|---|---|
| REG-01 | 108/108 serial templates y serial único 1…108 | JSON parse/uniqueness; §4 Registry Spec | PASS mecánico |
| REG-02 | 100/100 definitions con logical IDs separados | JSON; `D001…D100` aprobados mediante DEC-077 | PASS |
| REG-03 | seis duplicate-name groups comparados semánticamente | Registry Spec §5 + Review Matrix §5 (6/6); DEC-077 | PASS |
| REG-04 | 5/5 Starter por country y 103 pool | JSON materialization + cardinality check | PASS mecánico |
| REG-05 | cinco países y 540/25 materialización | JSON materialization | PASS mecánico |
| REG-06 | cuatro aliases aprobados sin collisions | Registry Spec §8 + JSON uniqueness | PASS mecánico |
| REG-07 | 100 IDs y mapping 108→100, incluidos seis grupos exactos, aprobados | REG-CAND-001 aprobado mediante DEC-077 | PASS |
| REG-08 | nombres, tipos/subtipos, alignment, IV, costes, flags y 41 ausencias aprobados | REG-CAND-002 aprobado mediante DEC-077 | PASS |
| REG-09 | 59 effect IDs, triggers, timings, 103 operaciones, orden y parámetros aprobados | REG-CAND-003 aprobado mediante DEC-077 | PASS |
| REG-10 | JCS SHA-256 y Git blob hashes finales aprobados después de REG-CAND-001…003 | REG-CAND-004 aprobado mediante DEC-077 | PASS |
| REG-11 | ningún ID M1 `BASE_CARD_001…108` elevado a 100 definitions | namespace candidato separado | PASS |
| REG-12 | seed/fixture/handler no creado | scope diff | PASS |

Resultado Registry: **APPROVED / SEEDABLE mediante DEC-077**.

### 3.1 Corrección M20-R01…R04

| Hallazgo | Corrección documental | Estado |
|---|---|---|
| M20-R01 — AP auditability | `action_point_balances` queda como proyección mutable y `action_point_transactions` como journal autoritativo append-only; reconciliación y rollback están fijados. | **CLOSED mediante DEC-077** |
| M20-R02 — durable idempotency lifecycle | identidad/fingerprint inmutables, reserva interna en la command tx, sólo `COMMITTED` durable, retry/mismatch/CAS-loser y fault boundaries explícitos. | **CLOSED mediante DEC-077** |
| M20-R03 — outbox attempt history | mensaje inmutable, delivery state mutable e historial de attempts append-only; etapas de crash/retry y reconstrucción post-commit explícitas. | **CLOSED mediante DEC-077** |
| M20-R04 — human registry review | matriz exhaustiva 100/108/6/41/59; REG-CAND-001…004 aprobados. | **CLOSED mediante DEC-077** |

### 3.2 Segunda corrección M20-R05…R10

El preflight de `Cartas frente.pdf` verificó exactamente SHA-256 `3301fd9e92e5d8a8df7a3efc1407434afe0395263a5d6c0e16e0e486faa35113`, 108 páginas y mapping página N = serial N. El PDF permaneció externo y no fue copiado a Git. Con ese gate satisfecho se ejecutó la corrección documental completa:

| Hallazgo | Evidencia de corrección | Estado |
|---|---|---|
| M20-R05 — concurrent idempotency recheck | fast path, lock Game, recheck obligatorio, same-fingerprint return antes de expected version, typed mismatch y casos concurrentes/fault matrix/manifest | **CLOSED mediante DEC-077** |
| M20-R06 — deterministic journal ordering | `game_event_sequence + artifact_ordinal`, UK/CK/IDX, replay total y rollback/CAS sin gaps en resource/AP/VP/influence/legitimacy/traces | **CLOSED mediante DEC-077** |
| M20-R07 — canonical REG-CAND meanings | §§5–10, gate y checklist usan exactamente IDs/mapping; campos+41 ausencias; 59 effects+103 ops; hashes finales posteriores | **CLOSED mediante DEC-077** |
| M20-R08 — complete typed parameters | 103/103 operaciones completas y aprobadas; 0 unknown/N/A/unresolved; unknown falla cerrado | **CLOSED mediante DEC-077** |
| M20-R09 — exhaustive primary-source audit | 108/108 páginas; cinco starters, cuatro aliases, seis grupos, 59 effects/41 ausencias por definition | **CLOSED mediante DEC-077** |
| M20-R10 — E021 + bindings 26/28 | E021 mantiene dos operaciones y 103 totales; bindings aprobados; literal primario intacto; auditoría 102/6/0 | **CLOSED mediante DEC-077** |

DEC-077 aprueba las cuatro selecciones, los hashes finales y `seedable=true`; no ejecuta ningún seed.

## 4. Criterios binarios — Snapshot y reproducibilidad

| ID | Criterio de PASS | Resultado |
|---|---|---|
| SNP-01 | JSON válido; status `approved`; `seedable=true` | PASS |
| SNP-02 | 100 definitions, 108 templates, 4 aliases, 59 effects, 103 operations y 108 audit rows | PASS |
| SNP-03 | keys canonicalizables, arrays con orden declarado, sólo JSON válido | PASS |
| SNP-04 | serial/template/definition/effect/alias uniqueness y refs completas | PASS |
| SNP-05 | Markdown↔snapshot igualdad de conteos/mapping/hashes | PASS mecánico |
| SNP-06 | JCS final determinístico en dos canonicalizaciones independientes | PASS; 313904 bytes; `735fd01b65416bdeb1baaa596bb36ea0d0eef31cb1d1d9b7f4b2322c9c585e4a` |
| SNP-07 | source digests y hashes normativos preservados | PASS mecánico |
| SNP-08 | JCS SHA y blobs aprobados expresamente | PASS — DEC-077 |
| SNP-09 | proyección semántica antes/después idéntica | PASS; 264610 bytes; `8a46133ca70883df2d173fddd9c725cd0611b2be8311a5fe42057464415d6a13` |

## 5. IQ-M2-010 y aprobaciones

`IQ-M2-010` queda **RESOLVED mediante DEC-077**:

- `REG-CAND-001`: APPROVED;
- `REG-CAND-002`: APPROVED;
- `REG-CAND-003`: APPROVED;
- `REG-CAND-004`: APPROVED con hashes finales.

`IQ-M2-008`, `IQ-M2-009` e `IQ-M2-011…013` permanecen **OPEN** para bloques futuros. DEC-077 no autoriza esos bloques.

## 6. Resultado del gate

```text
M2-0 RESULT = APPROVED AND CLOSED — DEC-077
```

Razón binaria: PDB-01…13, REG-01…12 y SNP-01…09 quedan PASS; REG-CAND-001…004 están aprobadas; M20-R01…R10 están cerradas; la proyección semántica permanece idéntica y el snapshot queda `approved`/`seedable=true`. Por tanto:

- M2-0 queda **APPROVED AND CLOSED**;
- M2-1/M2-A y M2-2…M2-7 permanecen **NOT AUTHORIZED**;
- M2 global y M3 permanecen **NOT AUTHORIZED**;
- PostgreSQL schema/migrations/seed/outbox, realtime productivo, Action/Reaction/Veto/Regime/Cleanup/Objectives/Victory, UI, AuthN productiva e IA no han iniciado.

## 7. Límite posterior al cierre

El cierre termina en M2-0. Cualquier inicio de M2-1/M2-A o de M2-2…M2-7 requiere autorización expresa posterior. No se autoriza código, migrations, seeds, dependencias, infraestructura o proveedores.
