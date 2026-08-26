# MALIGN-AI — CARD REGISTRY SPECIFICATION v0.1

**Fecha:** 2026-08-26
**Estado:** **M20-R07…R09 CORRECTION IMPLEMENTED / PENDING PRODUCT OWNER AND TECHNICAL REVIEW — NOT SEEDABLE**
**Autoridad de preparación:** DEC-076
**Snapshot compañero:** `MALIGN_AI_CARD_REGISTRY_SNAPSHOT_v0.1.json`

> Este documento y su snapshot son candidatos documentales. No elevan `MALIGN_AI_CARD_COMPONENT_SYSTEM_SPEC_v0.1.md` de DRAFT a autoridad normativa, no son seed/fixture/código y no autorizan handlers. Cualquier campo pendiente falla cerrado.

## 1. Resultado y conteos

| Objeto | Conteo candidato | Estado |
|---|---:|---|
| `CardDefinition` lógicas | 100 | IDs candidatos; pendiente aprobación |
| `CountryCardSerialTemplate` por country set | 108 | mapping candidato; pendiente aprobación |
| Starter templates por country | 5 | estructura 103+5 aprobada; identidad/content mapping pendiente |
| Countries BASE_2025 | 5 | `ARDEN`, `FLUMA`, `URSARIA`, `PRESQUE`, `DINESIA` |
| CardInstance materializadas por juego BASE_2025 | 540 | futura: 5×108; no seed autorizado |
| Aliases | 4 | aprobados por DEC-029; mapping a IDs candidato |
| Effect definitions candidatas | 59 | IDs/trigger/timing/operations pendientes de aprobación |
| Definitions sin texto de efecto observado | 41 | ausencia DRAFT pendiente de aprobación, no `NONE` aprobado |
| Operaciones tipadas | 103 | 103 con parámetros machine-readable completos pendientes de aprobación; 0 unknown/N/A |
| Auditoría primaria | 108/108 páginas | 102 MATCH, 5 DIFFERENCE, 1 AMBIGUOUS; no implica aprobación |

El snapshot tiene status exacto `candidate_pending_review`, `seedable=false`, 100 definitions ordenadas, 108 templates ordenados, 59 effects, 103 operaciones y 108 filas de auditoría primaria. Su JCS SHA-256 candidato es `6f777a5bafe7611389d80baa47fa3f0a785014d10b659e3446846bf735e1c897`; su Git blob SHA candidato es `d8d8afe220d76043d836c5ba15f89acde0f3a939`. Ninguno queda aprobado por DEC-076.

## 2. Fuentes, autoridad y precedencia

| Fuente | Digest Git blob | Clasificación y uso |
|---|---|---|
| Decisions DEC-025…075 antes de DEC-076 | `727abe37c3a3c9d98b5f2389811dfdeb1f503dd3` | decisiones aprobadas; estructura, aliases y edge cases |
| Card & Component System v0.1 | `d446ce7aff0660043c0c35a7371a274510a4d17f` | **DRAFT evidence**: nombres, seriales, clase/alineación, IV y texto impreso |
| Oracle v0.1 | `8291b56e20b9fdf55b8c01c156b66cd641b52d92` | comportamiento de aceptación aprobado |
| Adjudication Engine v0.1 | `6b3ae75432e0b0488c4c74abdba8b654cae15519` | lifecycle/timings/semántica aprobada |
| Interface/Command Contract v0.1 | `16d519b7f9d321f5a21e61dd201f58509a8b29bd` | versioning, privacy, continuation y dispatch |
| Rule Effect Taxonomy v0.2 | `cc595f184f9a5ff8efd09614a2a391cf170af372` | vocabulario de operaciones tipadas aprobado |
| Addendum M2 v0.1 | `6ae87a904a14a82e4fb174ff4d76eefd47052832` | gate de DB/seed/effect; no contenido de cartas |
| Candidate histórico | `fbcb750e72ae50a2bd4444789b0cfd11e75d7ab0` | comparación/provenance; permanece candidato, no autoridad |
| `Cartas frente.pdf` | SHA-256 `3301fd9e92e5d8a8df7a3efc1407434afe0395263a5d6c0e16e0e486faa35113` | **PRIMARY_SOURCE_EXTERNAL**: 108 caras; página N = serial N; auditada 108/108; el PDF no se almacena en Git |

Precedencia: decisiones aprobadas → normativa aprobada → fuente primaria visual para literal impreso → oracle/addendum → DRAFT/DOCX sólo como apoyo → implementación observada sólo como contraste. El PDF gobierna nombre y texto impresos; Gamebook, Adjudication y Taxonomy sustentan la semántica candidata sin reemplazar el literal. Todo `authority_status` sigue pendiente.

## 3. Jerarquía canónica propuesta

```text
CardRegistryVersion (snapshot JCS + digests + approval decision)
  ├─ CardDefinition (logical_id estable, contenido y effect bindings)
  │    ├─ CardSlotValue 0..3
  │    ├─ CardRequirement 0..N
  │    ├─ CardEffectDefinition 0..N
  │    └─ CardAlias 0..N
  └─ CountryCardSerialTemplate 108, serial 1..108
         └─ se materializa una vez por cada uno de 5 country IDs
                └─ CardInstance: UUIDv7, owner country y controller mutable
```

`CardDefinition` expresa identidad/regla lógica. `CountryCardSerialTemplate` expresa copia física dentro del set. `CardInstance` expresa una copia por juego/país. Un nombre visible o alias nunca es FK, handler key o identidad.

## 4. Metodología reproducible de IDs

Los IDs de este candidato se asignan sólo para permitir revisión y hashing:

1. recorrer seriales 1→108 del catálogo DRAFT;
2. normalizar únicamente igualdad exacta de la cadena visible; aliases DEC-029 no fusionan definitions;
3. para la primera aparición, asignar el siguiente `CARD_DEF_BASE_2025_D001…D100`;
4. compartir definition candidata sólo cuando las copias de igual nombre también coinciden en tipo, subtype, alignment, IV, coste y texto de efecto;
5. asignar `CARD_SERIAL_BASE_2025_S001…S108` uno-a-uno al serial físico;
6. recorrer definitions por ID y, si existe texto de efecto DRAFT, asignar `CARD_EFFECT_BASE_2025_E001…E059`;
7. conservar provenance y status pendiente en cada row; ninguna asignación pasa a ACTIVE sin decisión posterior.

Esto no usa `BASE_CARD_001…108` como 100 IDs. Esos IDs M1 son serial-local/fixtures observados y no se elevan. Los IDs candidatos tampoco se consideran aprobados por aparecer en el JSON.

### 4.1 Mapping completo de seriales a definitions

- Seriales `S001…S094` mapean uno-a-uno a `D001…D094`.
- `S095` y `S096` → `D095` Inteligencia Artificial.
- `S097` y `S098` → `D096` Divisiones Sociales.
- `S099`, `S100` y `S101` → `D097` Influencia Maligna.
- `S102` y `S103` → `D098` Temas Divisivos.
- `S104`, `S105` y `S106` → `D099` Resiliencia.
- `S107` y `S108` → `D100` Políticas de identidad.

El snapshot contiene la expansión exacta 108/108, no rangos interpretados en runtime.

## 5. Comparación semántica de los seis grupos repetidos

| Grupo / seriales | Tipo / alignment | IV | Coste | Trigger/timing/texto | Resultado candidato |
|---|---|---|---|---|---|
| Inteligencia Artificial 95–96 | Campaign / DUAL | A:3 en ambas | ninguno observado | sin texto en ambas | MATCH intragrupo; una `D095`; identidad pendiente |
| Divisiones Sociales 97–98 | Campaign / MALIGN | I:2 en ambas | ninguno observado | literal idéntico: `Coloca cualquier DT en esta carta…` | MATCH intragrupo; una `D096` + un effect; pendiente |
| Influencia Maligna 99–101 | Campaign / MALIGN | I:1 en las tres | ninguno observado | literal idéntico: `Coloca cualquier DT en esta carta…` | MATCH intragrupo; una `D097` + un effect; pendiente |
| Temas Divisivos 102–103 | Campaign / MALIGN | I:3 en ambas | ninguno observado | literal idéntico: `Coloca cualquier DT en esta carta…` | MATCH intragrupo; una `D098` + un effect; pendiente |
| Resiliencia 104–106 | Campaign / RESILIENCY | I:1 en las tres | ninguno observado | literal idéntico: `Coloca DT en esta tarjeta…` | MATCH intragrupo; una `D099` + un effect; pendiente |
| Políticas de identidad 107–108 | Campaign / DUAL | I:3 en ambas | ninguno observado | literal idéntico: `Coloca cualquier DT en esta tarjeta…` | MATCH intragrupo; una `D100` + un effect; pendiente |

No se observó diferencia visual ni literal dentro de estos grupos en la fuente primaria. Por eso el candidato comparte definition, pero Product Owner debe confirmar o separar las caras antes de seed.

## 6. Contrato de cada definition

Cada objeto en `definitions[]` contiene:

- `definition_id`, `display_name`, `serials[]` y `authority_status`;
- `card_type = CAMPAIGN_COMPONENT | ACTION | STARTER`;
- `subtype = REACTION | FREE_PLAY | CAMPAIGN_INTENT | VETO_REACTION | null`;
- `alignment = MALIGN | RESILIENCY | DUAL | NONE`;
- `influence_values` por `intent/method/amplifier` sin coerción;
- `action_point_cost`, `resource_cost`, `is_starter`, `is_reaction`, `remove_after_use`;
- `effect_ids[]`, `source_refs[]` y estado de autoridad por grupo de campos.
- cada serial tiene `primary_source_ref`, SHA-256 del PDF y una fila `primary_source_audit[]` con los campos impresos, literal/ausencia y `MATCH | DIFFERENCE | AMBIGUOUS`.

`null` significa que no hay valor canónico aprobado o que no aplica según el candidato; no autoriza asumir cero. `effect_ids=[]` registra ausencia observada en el DRAFT, no prueba una regla `NO_EFFECT` aprobada.

## 7. Serial templates, countries y materialización

`serial_templates[]` contiene exactamente 108 objetos ordenados por `serial_within_country_set`, cada uno con `template_id`, `definition_id` y `starter`. El orden canónico de materialización es:

```text
ARDEN → FLUMA → URSARIA → PRESQUE → DINESIA
  para cada country: serial 1 → 108
```

Resultado futuro: 540 CardInstance, 108 por country, 5 Starter por country y 103 pool candidates por country. La instancia conserva a la vez country owner, serial-template provenance, logical definition y controller. No se materializa nada durante M2-0.

## 8. Aliases aprobados

| Alias normalizado | Display fuente | Definition candidata |
|---|---|---|
| `alianzas público-privadas` | Alianzas Público-Privadas | D004 Asociaciones Público-Privadas |
| `hack back` | HACK BACK | D043 Contraataque Informático |
| `teoría de la conspiración` | Teoría de la Conspiración | D083 Teoría Conspirativa |
| `verificación de datos` | Verificación de Datos | D084 Verificación de Hechos |

Los cuatro aliases provienen de DEC-029. La normalización es Unicode NFC + trim + case-fold para lookup; el snapshot conserva el display exacto. Si dos aliases normalizados colisionan, el registry falla cerrado.

## 9. Effects y operaciones declarativas

El candidato define 59 effect IDs, uno por definition con texto primario observado. Cada effect conserva:

- `effect_id`, `effect_version`, `source_definition_id`;
- `source_text` literal transcrito desde `Cartas frente.pdf`, `primary_source_ref`, SHA-256 y provenance;
- `timing_window` candidato de la taxonomy aprobada;
- `trigger` discriminado;
- secuencia `operations[]` usando sólo códigos de Rule Effect Taxonomy v0.2;
- parameters machine-readable con `operation_ordinal`, valores operativos concretos, provenance, `fail_closed_if_unsupported=true` y estado `complete_pending_product_owner_approval`.

Las 59 definitions se descomponen en 23 pair bonuses, 16 Action, 6 Reaction, 5 Starter y 9 campaign-special/target effects. La auditoría cubre **103/103 operaciones: 103 complete_pending_product_owner_approval, 0 unknown, 0 N/A y 0 unresolved_parameter_id**. Esto describe completitud estructural, no aprobación normativa. No existe un handler genérico que ignore un effect desconocido: una operación, versión, trigger o parámetro no soportado debe rechazar/fallar el gate. Las operaciones en el JSON son datos declarativos, nunca JavaScript, SQL, prompt o nombre de función.

La conversión de texto a operaciones es candidata. Aun cuando el oracle aprueba una semántica, el binding entre esa semántica, el nuevo definition ID y el nuevo effect ID requiere aprobación expresa.

## 10. Versionado y compatibilidad

```text
registry_version = BASE_2025/0.1-candidate
registry_schema_version = MALIGN_AI_CARD_REGISTRY_SNAPSHOT/0.1
effect_version   = 0.1-candidate
status           = candidate_pending_review
seedable         = false
```

- Una futura versión ACTIVE fija JCS SHA-256, Git blob hashes, source digests y decisión de aprobación.
- Una partida fija `card_registry_version`; no se reinterpretan games históricos.
- Cambiar identity mapping, IV, cost, trigger, timing, operations o materialization crea una nueva registry version.
- Aliases pueden ampliarse sólo sin colisión y con source/compatibility explícitos.
- Runtime debe validar schema y soportar cada effect ID/version del manifest; unknown → fail closed.
- No hay migración silenciosa de una partida activa ni fallback por display name.

## 11. Canonical JSON y hashes candidatos

Reglas de serialización:

- RFC 8785/JCS, UTF-8 y object keys ordenadas lexicográficamente por unidades UTF-16;
- arrays en el orden normativo declarado en `normalization.arrays`;
- enteros exactos; prohibidos NaN, Infinity, `undefined` y coerción implícita;
- los hashes no se incluyen dentro del mismo snapshot para evitar autorreferencia circular;
- `definitions`, `serial_templates`, `aliases`, `effect_definitions`, sources y unresolved items tienen orden reproducible.
- `primary_source_audit` se ordena por serial 1→108; los arrays de parámetros conservan el orden normativo declarado.

Hashes calculados sobre el artifact actual:

| Artifact | Algoritmo | Hash candidato |
|---|---|---|
| Snapshot canonicalizado | SHA-256 sobre bytes JCS | `6f777a5bafe7611389d80baa47fa3f0a785014d10b659e3446846bf735e1c897` |
| Snapshot pretty JSON | Git blob SHA-1 | `d8d8afe220d76043d836c5ba15f89acde0f3a939` |
| Este Markdown | Git blob SHA-1 | se calcula después de cerrar el artifact y se registra en gate/state |

Estos hashes son evidencia de revisión, **no aprobación**.

## 12. Trazabilidad a aceptación

| Concern | Fuente/gate | Estado candidato |
|---|---|---|
| 108/país, 5 Starter, 103 pool, 540/25 | DEC-025; GE-SET-007/008; GE-E2E-006; GE-M2-DB-005 | estructura reconciliada; content pending |
| versions/hash/seed | GE-AUD-003/004; GE-M2-DB-003/005/006; GE-M2-TX-008/009 | snapshot preparado; no aprobado/seedable |
| slots/IV/compatibility | GE-CAM-006/007/010; GE-ERT-022/023 | matriz completa candidata |
| 23 pair bonuses/aliases | GE-ERT-022; DEC-029; GE-M2-EFX-001 | operations/mapping candidatos |
| Action/Starter | GE-ACT-001…030; GE-PLAN-006…010 | 21 definitions/effects trazadas; pending mapping |
| Reaction/Veto/timings | GE-REA-001…010; GE-VETO-001…005; GE-M2-RX-001…003 | 7 reaction-capable effects candidatas |
| privacy/lifecycle | GE-SEC-001…006; GE-M2-RT-007; GE-M2-LC-001 | storage/dispatch boundary documentado |
| exhaustive typed dispatch | GE-M2-EFX-001 | 59 effect IDs, 103 ordered operations y parameters completos manifestados; no executable handler |
| primary source audit | M20-R09 / REG-CAND-001…003 | 108/108 páginas, 59 literales/41 ausencias por definition, diferencias explícitas; pendiente PO |

## 13. Pendientes que bloquean cierre

1. `REG-CAND-001`: aprobar o corregir los 100 IDs y mapping 108→100, incluidos exactamente 95–96, 97–98, 99–101, 102–103, 104–106 y 107–108;
2. `REG-CAND-002`: aprobar nombres, types/subtypes, alignment, IV, costs, flags y las 41 definitions sin texto de efecto;
3. `REG-CAND-003`: aprobar o corregir 59 effect IDs, triggers, timings, 103 operaciones, orden y parámetros;
4. `REG-CAND-004`: aprobar el JCS SHA-256 y los Git blob hashes finales sólo después de resolver REG-CAND-001…003.

`REG-CAND-004` no significa “hacer seedable/ACTIVE”: la transición futura a ACTIVE requerirá una decisión canónica separada posterior a los cuatro gates. Mientras alguno permanezca pendiente, IQ-M2-010 está sólo parcialmente resuelta y M2-0 no puede cerrar. M2-1 seed y M2-3/M2-4/M2-5 registry-dependent permanecen bloqueados y no autorizados.

## 14. Estado del gate

M20-R07…R09 quedan **CORRECTION IMPLEMENTED / PENDING PRODUCT OWNER AND TECHNICAL REVIEW**. El inventario y la auditoría primaria están completos como **candidato reproducible**; la autoridad de IDs, contenido, bindings y hashes no está cerrada. Resultado: **BLOCKED / PENDING PRODUCT OWNER AND TECHNICAL REVIEW — NOT SEEDABLE**. No se creó seed, fixture, handler ni código ejecutable; M2-1…M2-7 permanecen **NOT AUTHORIZED**.
