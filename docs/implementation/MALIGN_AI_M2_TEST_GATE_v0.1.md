# MALIGN-AI — M2 TEST GATE v0.1

**Fecha:** 2026-08-25
**Estado:** PLANNING GATE APPROVED AND CLOSED / M2-0 APPROVED AND CLOSED mediante DEC-077
**Autoridad:** DEC-074 + DEC-075 + DEC-076 + DEC-077 — M2-0 documental únicamente
**Oracle:** `MALIGN_AI_GAME_ENGINE_TEST_ACCEPTANCE_SPEC_v0.1.md`
**Addenda:** M1 v0.1 preservado; M2 v0.1 aprobado como test acceptance baseline
**Implementación M2:** **NOT AUTHORIZED**

> Este gate cataloga y asigna cobertura; no crea tests ejecutables. DEC-077 cierra documentalmente M2-0. Los 32 IDs `GE-M2-*` permanecen baseline canónico futuro; su implementación no está autorizada.

## 1. Reglas del gate

1. El oracle v0.1 contiene 224 IDs nominales únicos: 217 P0 y 7 P1.
2. Su partición es `71 implementados M0/M1 + 153 owner M2 = 224`.
3. Cada uno de los 153 pendientes tiene exactamente un owner M2.
4. El addendum M2 contiene exactamente 32 IDs canónicos, cada uno con un owner.
5. Un ID implementado sólo reaparece con `[REGRESSION]`; no cuenta como caso único nuevo.
6. No se duplica una regresión dentro de un bloque; repeticiones entre bloques requieren justificación de riesgo.
7. La suite aprobada de entrada 215/215 se ejecutará completa en cada bloque de implementación autorizado; no se suma como caso nuevo.
8. Gate binario futuro: 100% PASS, 0 skips, 0 todo y 0 waivers.
9. No se modifica oracle/addendum para acomodar código.
10. Tests PostgreSQL/realtime sólo podrán usar infraestructura efímera y reproducible tras autorización expresa.

## 2. Reconciliación global

| Universo | Conteo | Reconciliación |
|---|---:|---|
| Oracle v0.1 | 224 | 71 implementados + 153 owner M2 |
| Addendum M2 v0.1 | 32 | 32 owner únicos, sin choque con oracle/addendum M1 |
| Casos nuevos únicos M2 | 185 | 153 oracle + 32 addendum |
| Baseline aprobada de entrada | 215 | histórica; no reejecutada por esta enmienda |
| Suite mínima acumulada futura | 400 | 215 + 185 |

Los 35 IDs M0 y 49 IDs oracle owner M1 se solapan en 13; su unión verificable es 71. Los 38 IDs M1 addendum no pertenecen a los 224 del oracle.

## 3. Distribución exacta de casos nuevos

| Bloque | Oracle owner | Addendum M2 | Nuevos únicos | Regresiones dirigidas | Ejecuciones owner+regresión | Suite mínima acumulada |
|---|---:|---:|---:|---:|---:|---:|
| M2-0 | 0 | 0 | 0 — gate documental | 0 | 0 | 215 |
| M2-1 | 6 | 16 | 22 | 14 | 36 | 237 |
| M2-2 | 0 | 8 | 8 | 17 | 25 | 245 |
| M2-3 | 37 | 2 | 39 | 18 | 57 | 284 |
| M2-4 | 45 | 0 | 45 | 12 | 57 | 329 |
| M2-5 | 20 | 3 | 23 | 11 | 34 | 352 |
| M2-6 | 17 | 1 | 18 | 6 | 24 | 370 |
| M2-7 | 28 | 2 | 30 | 8 | 38 | 400 |
| **Total** | **153** | **32** | **185** | **86 ejecuciones** | **271** | **400** |

La redistribución recalcula las regresiones por riesgo y reemplaza el total anterior de 66; no intenta preservarlo. Las siete ejecuciones futuras del baseline 215/215 para M2-1…M2-7 son gates completos separados y no forman parte de las 271 ejecuciones dirigidas. Ningún bloque de implementación contiene más de 50 casos nuevos únicos.

## 4. M2-0 — Canonical Foundations Gate

No tiene owner ni regresión ejecutable. Su gate es documental: Physical DB Spec, addendum M2, registry, snapshot, reconciliación de fuentes y aprobación expresa de contenido/hashes. **0 casos nuevos / 0 regresiones / DOCUMENTATION CLOSED**.

Resultado actual: **APPROVED AND CLOSED mediante DEC-077**. Physical DB Spec conserva 87 tablas (blob final `13cd601b30db2db22be64c4fda5df94144dcf8d5`). Registry/snapshot conservan 100 definitions, 108 templates, 4 aliases, 59 effects, 103 operaciones y 108 audit rows (Registry blob final `d7d1325da916f4f867c4a142f8e345d66eaa780e`; JCS final `735fd01b65416bdeb1baaa596bb36ea0d0eef31cb1d1d9b7f4b2322c9c585e4a`; JSON blob final `8d5c150bed742391555bc6bafe022f45baee0163`). Review Matrix expone 100/108/6/41/59/103 aprobados y auditoría 102/6/0 (blob final `cefed690a7c2068f9fe868efaa3df4b2e504e508`). REG-CAND-001…004 están aprobadas, M20-R01…R10 cerradas e IQ-M2-010 resuelta. La proyección semántica antes/después permanece en 264610 bytes / SHA-256 `8a46133ca70883df2d173fddd9c725cd0611b2be8311a5fe42057464415d6a13`. M2-1/M2-A no queda autorizado.

## 5. M2-1 — PostgreSQL Persistence and Durable Recovery

### 5.1 Oracle owner — 6

- `GE-E2E-006`
- `GE-CORE-011`
- `GE-AUD-002`
- `GE-AUD-003`
- `GE-AUD-004`
- `GE-FAC-002`

### 5.2 Addendum owner — 16

- `GE-M2-DB-001…007`
- `GE-M2-TX-001…009`

### 5.3 Regresiones — 14

- `GE-SET-001 [REGRESSION]`
- `GE-SET-007 [REGRESSION]`
- `GE-SET-008 [REGRESSION]`
- `GE-ERT-021 [REGRESSION]`
- `GE-CORE-003 [REGRESSION]`
- `GE-CORE-004 [REGRESSION]`
- `GE-CORE-005 [REGRESSION]`
- `GE-CORE-010 [REGRESSION]`
- `GE-AUD-001 [REGRESSION]`
- `GE-AUD-006 [REGRESSION]`
- `GE-M1-ADJ-004 [REGRESSION]`
- `GE-M1-ADJ-007 [REGRESSION]`
- `GE-M1-ADJ-008 [REGRESSION]`
- `GE-M1-ADJ-009 [REGRESSION]`

Riesgo trazado: setup/registry materializado, matriz ERT persistida, CAS/idempotencia, audit ordering, snapshots y replay. La antigua repetición de `GE-M1-ADJ-008` entre los bloques físicos se deduplicó al fusionarlos.

Gate futuro: **36 ejecuciones dirigidas + baseline 215/215**; 22 casos nuevos; suite mínima acumulada 237.

## 6. M2-2 — Productive Transport and Reconnect

### 6.1 Oracle owner — 0

El oracle no contiene ID nominal de transporte productivo; M1 sólo cubre semántica in-memory.

### 6.2 Addendum owner — 8

- `GE-M2-RT-001…008`

### 6.3 Regresiones — 17

- `GE-CORE-003 [REGRESSION]`
- `GE-CORE-004 [REGRESSION]`
- `GE-CORE-010 [REGRESSION]`
- `GE-SEC-001 [REGRESSION]`
- `GE-SEC-002 [REGRESSION]`
- `GE-SEC-003 [REGRESSION]`
- `GE-SEC-004 [REGRESSION]`
- `GE-M1-RT-001 [REGRESSION]`
- `GE-M1-RT-002 [REGRESSION]`
- `GE-M1-RT-003 [REGRESSION]`
- `GE-M1-RT-004 [REGRESSION]`
- `GE-M1-RT-005 [REGRESSION]`
- `GE-M1-RT-006 [REGRESSION]`
- `GE-M1-RT-007 [REGRESSION]`
- `GE-M1-RT-008 [REGRESSION]`
- `GE-M1-RT-009 [REGRESSION]`
- `GE-M1-RT-010 [REGRESSION]`

Riesgo trazado: authenticated boundary, privacy, cursor binding, initial-sync race, duplicate/out-of-order delivery y gap/reconnect recovery. La repetición de core concurrency respecto de M2-1 se justifica porque ahora cruza el boundary de transporte.

Gate futuro: **25 ejecuciones dirigidas + baseline 215/215**; 8 casos nuevos; suite mínima acumulada 245. IQ-M2-008/009 deben resolverse antes de llamarlo productivo.

## 7. M2-3 — Complete Scheduler and Remaining Core Rules

### 7.1 Oracle owner — 37

| Área | IDs exactos | Conteo |
|---|---|---:|
| Setup/maintenance | `GE-SET-009`, `GE-INI-007`, `GE-INI-008`, `GE-INI-010` | 4 |
| Planning/negotiation | `GE-PLAN-002`, `GE-PLAN-006`, `GE-PLAN-007`, `GE-PLAN-008`, `GE-PLAN-009`, `GE-PLAN-010`, `GE-PLAN-011`, `GE-PLAN-012`, `GE-PLAN-013`, `GE-PLAN-014` | 10 |
| Campaign lifecycle | `GE-CAM-006`, `GE-CAM-007`, `GE-CAM-010`, `GE-CAM-013`, `GE-CAM-014` | 5 |
| ERT/costs/bonuses | `GE-ERT-009`, `GE-ERT-010`, `GE-ERT-011`, `GE-ERT-012`, `GE-ERT-013`, `GE-ERT-014`, `GE-ERT-015`, `GE-ERT-022`, `GE-ERT-023` | 9 |
| Backlash/legitimacy | `GE-CUBE-008`, `GE-CUBE-009`, `GE-LEG-004`, `GE-LEG-005`, `GE-LEG-006` | 5 |
| Manual die/security | `GE-DIE-002`, `GE-DIE-003`, `GE-SEC-005`, `GE-SEC-006` | 4 |
| **Total** | — | **37** |

Los 30 `GE-ACT-*` y 15 `GE-REG-*` se trasladan a M2-4.

### 7.2 Addendum owner — 2

- `GE-M2-SCH-001`
- `GE-M2-EFX-001`

`GE-M2-EFX-001` valida aquí sólo el contrato genérico: dispatch por `effect_id` y versión, nunca por nombre/prompt; handler tipado y determinístico; cobertura exhaustiva del manifest habilitado para M2-3; rechazo fail-closed tanto de ID desconocido como de ID conocido pero todavía no habilitado. Todo rechazo conserva state/AP/Resources/RNG/Clock/provider cursors y crea cero events, ledgers, trace, outbox o resultado idempotente. No exige Action/Starter, Regime, Reaction ni Veto. M2-4 y M2-5 lo repiten incrementalmente como regresión; conserva un solo owner.

### 7.3 Regresiones — 18

- `GE-CORE-001 [REGRESSION]`
- `GE-CORE-002 [REGRESSION]`
- `GE-CORE-005 [REGRESSION]`
- `GE-CORE-006 [REGRESSION]`
- `GE-CORE-009 [REGRESSION]`
- `GE-CORE-012 [REGRESSION]`
- `GE-PLAN-001 [REGRESSION]`
- `GE-PLAN-003 [REGRESSION]`
- `GE-PLAN-004 [REGRESSION]`
- `GE-PLAN-005 [REGRESSION]`
- `GE-CAM-001 [REGRESSION]`
- `GE-CAM-005 [REGRESSION]`
- `GE-CAM-008 [REGRESSION]`
- `GE-CAM-009 [REGRESSION]`
- `GE-ERT-001 [REGRESSION]`
- `GE-ERT-002 [REGRESSION]`
- `GE-ERT-007 [REGRESSION]`
- `GE-ERT-008 [REGRESSION]`

Riesgo trazado: phase progression, hidden plan/reveal, campaign integrity, costs y ERT reuse. Gate futuro: **57 ejecuciones dirigidas + baseline 215/215**; 39 casos nuevos; suite mínima acumulada 284.

## 8. M2-4 — Action/Starter Cards and Regime Abilities

### 8.1 Oracle owner — 45

- Action Cards: `GE-ACT-001…030`.
- Regime Abilities: `GE-REG-001…015`.

### 8.2 Addendum owner — 0

`GE-M2-EFX-001` no se duplica: owner M2-3; se ejecuta abajo como regresión con un manifest expandido que debe cubrir Action Cards, Starter Cards y Regime Abilities.

### 8.3 Regresiones — 12

- `GE-CORE-002 [REGRESSION]`
- `GE-CORE-005 [REGRESSION]`
- `GE-CORE-009 [REGRESSION]`
- `GE-CORE-012 [REGRESSION]`
- `GE-PLAN-003 [REGRESSION]`
- `GE-PLAN-004 [REGRESSION]`
- `GE-CAM-001 [REGRESSION]`
- `GE-CAM-005 [REGRESSION]`
- `GE-CAM-008 [REGRESSION]`
- `GE-ERT-007 [REGRESSION]`
- `GE-ERT-008 [REGRESSION]`
- `GE-M2-EFX-001 [REGRESSION]`

Riesgo trazado: atomicidad de Action/Starter/Regime, AP/costs, zonas, campaign integration y dispatch por effect ID. Las repeticiones de core/plan/campaign/ERT respecto de M2-3 se justifican por los nuevos efectos que cruzan esos invariantes.

Gate futuro: **57 ejecuciones dirigidas + baseline 215/215**; 45 casos nuevos; suite mínima acumulada 329.

## 9. M2-5 — Reaction, Veto and Deterministic Narrative

### 9.1 Oracle owner — 20

- Reactions: `GE-REA-001…010`.
- Narrative: `GE-NAR-001…004`.
- Veto: `GE-VETO-001…005`.
- Audit ordering: `GE-AUD-005`.

### 9.2 Addendum owner — 3

- `GE-M2-RX-001…003`

### 9.3 Regresiones — 11

- `GE-CORE-009 [REGRESSION]`
- `GE-CHO-001 [REGRESSION]`
- `GE-CHO-002 [REGRESSION]`
- `GE-PLAN-004 [REGRESSION]`
- `GE-SEC-001 [REGRESSION]`
- `GE-SEC-002 [REGRESSION]`
- `GE-SEC-003 [REGRESSION]`
- `GE-SEC-004 [REGRESSION]`
- `GE-M1-ADJ-006 [REGRESSION]`
- `GE-M1-RT-003 [REGRESSION]`
- `GE-M2-EFX-001 [REGRESSION]`

Riesgo trazado: nested continuations, choices, ordering, no-auto-pass, privacy/reconnect y completitud final del registry effect manifest. `GE-M2-EFX-001 [REGRESSION]` expande el manifest para cubrir Reaction, Veto y efectos narrativos determinísticos relacionados; aquí se demuestra por primera vez la cobertura completa de todos los efectos de cartas del registry aprobado, sin fallback textual ni handler genérico silencioso. Las security/choice repeticiones se justifican por ventanas privadas nuevas.

Gate futuro: **34 ejecuciones dirigidas + baseline 215/215**; 23 casos nuevos; suite mínima acumulada 352.

## 10. M2-6 — Cleanup, Viralization and End Turn

### 10.1 Oracle owner — 17

- State progression/campaign aging: `GE-CORE-007`, `GE-CAM-011`, `GE-CAM-012`, `GE-CLN-001`, `GE-CLN-002`.
- Viral: `GE-VIR-001…012`.

### 10.2 Addendum owner — 1

- `GE-M2-LC-001`

### 10.3 Regresiones — 6

- `GE-CORE-012 [REGRESSION]`
- `GE-CAM-009 [REGRESSION]`
- `GE-AUD-006 [REGRESSION]`
- `GE-M1-ADJ-008 [REGRESSION]`
- `GE-M1-ADJ-009 [REGRESSION]`
- `GE-M1-RT-009 [REGRESSION]`

Riesgo trazado: transición terminal de turno, campaign state, deterministic trace, snapshot/replay y pending-state recovery. Las repeticiones con M2-3/M2-7 se justifican por el nuevo boundary Cleanup→End Turn.

Gate futuro: **24 ejecuciones dirigidas + baseline 215/215**; 18 casos nuevos; suite mínima acumulada 370.

## 11. M2-7 — Objectives, Victory and End Game

### 11.1 Oracle owner — 28

- Victory Objectives: `GE-VO-ARD-001…004`, `GE-VO-URS-001…003`, `GE-VO-PRE-001…003`, `GE-VO-FLU-001…005`, `GE-VO-DIN-001…003` — 18.
- End Game: `GE-END-001…005` — 5.
- E2E: `GE-E2E-001…005` — 5.

### 11.2 Addendum owner — 2

- `GE-M2-END-001`
- `GE-M2-END-002`

### 11.3 Regresiones — 8

- `GE-CORE-012 [REGRESSION]`
- `GE-AUD-001 [REGRESSION]`
- `GE-AUD-004 [REGRESSION]`
- `GE-AUD-006 [REGRESSION]`
- `GE-M1-ADJ-008 [REGRESSION]`
- `GE-M1-ADJ-009 [REGRESSION]`
- `GE-M1-RT-008 [REGRESSION]`
- `GE-M1-RT-009 [REGRESSION]`

Riesgo trazado: atomic final awards/outcome, replay/hash, ordering, idempotency, final projection y reconnect. Las repeticiones con persistencia/lifecycle son necesarias porque el golden cruza process restart hasta `GAME_COMPLETED`.

Gate futuro: **38 ejecuciones dirigidas + baseline 215/215**; 30 casos nuevos; suite mínima acumulada 400.

## 12. Cobertura transversal

| Obligación | Owner principal | Cobertura |
|---|---|---|
| schema/version compatibility | M2-1 | `GE-M2-DB-001…007` |
| atomic state/events/ledgers/trace/outbox | M2-1/M2-7 | `GE-M2-TX-001/002/009`, `GE-M2-END-001` |
| idempotencia/concurrencia | M2-1 | `GE-M2-TX-003…005` + core regressions |
| publish post-commit | M2-1/M2-2 | `GE-M2-TX-006/007`, `GE-M2-RT-008` |
| replay sin RNG | M2-1/M2-7 | `GE-AUD-004`, `GE-M2-TX-008`, `GE-M2-END-002` |
| AuthN/application boundary | M2-2 | `GE-M2-RT-001`; IQ-M2-008 |
| ordering/dedup/gaps | M2-2 | `GE-M2-RT-002…005` |
| privacy/reconnect | M2-2/M2-5 | `GE-M2-RT-006/007`, `GE-M2-RX-002/003` |
| scheduler/core | M2-3 | 37 oracle + `GE-M2-SCH-001` |
| registry dispatch incremental | M2-3 owner; M2-4/M2-5 regression | `GE-M2-EFX-001`: manifest core → Action/Starter/Regime → complete cards con Reaction/Veto/narrativa |
| Action/Starter/Regime | M2-4 | 30 ACT + 15 REG |
| Reaction/Veto/Narrative | M2-5 | 20 oracle + 3 RX |
| Cleanup/Viral/End Turn | M2-6 | 17 oracle + LC |
| Objectives/Victory/End | M2-7 | 28 oracle + END |

## 13. Fixtures y failure matrix futuros

Los nombres son contractuales, no autorización de creación:

- schema vacío, N-1, incompatibilidad y restore;
- registry snapshot/hash expresamente aprobado;
- persisted M1 checkpoint pre-Cleanup;
- two-writer/two-process row-lock + CAS harness;
- fault injection por write y antes/después de commit;
- outbox message inmutable + delivery state + attempt stages/lease/failure/retry;
- protocol-version/cursor/authorized-viewer matrix;
- nested Reaction/Veto continuations;
- full-turn BASE_2025 `turn_limit=1` y final objective fixture.

Cada fallo afirma ausencia de publish, mutación parcial, RNG adicional y leakage. Recovery crea proceso/adapter nuevo, no reutiliza closures/caches del writer.

## 14. Validaciones documentales

- 224 IDs oracle existentes y únicos;
- 71 implementados + 153 owners M2 = 224;
- 32/32 addendum M2 únicos, un owner, sin choque oracle/addendum M1;
- 185 nuevos únicos = 153 + 32;
- máximo por bloque de implementación = 45, menor que 51;
- 86 regresiones reconciliadas, sin duplicado intrabloque;
- repeticiones interbloque justificadas por boundary/riesgo;
- baseline 215 separado de nuevos/regresiones;
- oracle y addendum M1 byte-for-byte intactos;
- addendum M2 preservado con blob `6ae87a904a14a82e4fb174ff4d76eefd47052832`;
- candidate histórico preservado con blob `fbcb750e72ae50a2bd4444789b0cfd11e75d7ab0`;
- snapshot JSON válido, JCS determinístico y cardinalidades/IDs/refs reconciliados;
- idempotency manifest exige fast lookup + Game lock + recheck obligatorio y cubre same-key concurrente con fingerprint igual/diferente antes de CAS;
- journals/traces manifiestan `(game_id,game_event_sequence,artifact_ordinal)` único/positivo, replay total y rollback/CAS loser sin gaps permanentes;
- registry contiene 103/103 operaciones con parameters machine-readable y unknown parameters fail closed;
- E021 manifiesta contributor payer/elegibility/exclusion, voluntariedad, una contribución de 1 por participante, commit evidence, rechazo sin mutación, deduplicación y máximo; dos operaciones, 103 totales;
- los invariantes futuros de E021 prueban no contribución del source-card player, +1 `EFFECTIVE_CV` por contribuidor único, atomicidad ante rechazo/saldo insuficiente y retry idempotente sin doble débito/bonus;
- auditoría primaria cubre `Cartas frente.pdf` 108/108 con SHA-256 `3301fd9e92e5d8a8df7a3efc1407434afe0395263a5d6c0e16e0e486faa35113`, 59 literales/41 ausencias por definition, 102 MATCH, 6 DIFFERENCE y 0 AMBIGUOUS; seriales 26/28 preservan sus literales y registran los bindings internos aprobados por M20-R10;
- REG-07…10 PASS; REG-CAND-001…004 aprobadas mediante DEC-077;
- IQ-M2-010 resuelta; IQ-M2-008/009 e IQ-M2-011…013 permanecen OPEN;
- baseline histórica 215/215 no reejecutada en M2-0;
- ningún test, fixture o código creado por este gate.

## 15. Criterios PASS/FAIL futuros

PASS sólo con 100% owner + addendum + regresiones del bloque, baseline completo 215/215, 0 skips, 0 todo, 0 waivers, checks técnicos aplicables verdes, privacy/replay/fault gates verdes y ninguna IQ bloqueante.

FAIL ante ID/owner inválido, conteo irreconciliable, test suavizado, fixture que inventa regla, estado/event/ledger/trace/outbox divergente, leakage, dependencia productiva dentro del Engine o provider seleccionado sin aprobación.

## 16. Estado

El planning gate está **APPROVED AND CLOSED mediante DEC-076** y M2-0 **APPROVED AND CLOSED mediante DEC-077**. M20-R01…R10 están **CLOSED**, REG-CAND-001…004 **APPROVED** e IQ-M2-010 **RESOLVED**. M2-1/M2-A, M2-2…M2-7, M2 global y M3 permanecen **NOT AUTHORIZED**. Este documento no crea tests ejecutables ni autoriza implementación.
