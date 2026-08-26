# MALIGN-AI — M2 CARD REGISTRY CANONICALIZATION SPECIFICATION v0.1

**Fecha:** 2026-08-25
**Estado:** **CANDIDATE CANONICAL / PENDING CONTENT AND HASH REVIEW — NOT APPROVED FOR SEED OR IMPLEMENTATION**
**Autoridad para preparar el candidato:** DEC-075
**Approval pendiente:** IQ-M2-010

> Este documento no aprueba el contenido del registry ni su hash. No es JSON, seed, migration, fixture ni código. Todo dato sin autoridad suficiente se conserva como `UNRESOLVED`; no se inventan definition IDs, effect IDs, costs, triggers ni rules.

## 1. Propósito y boundary

El objetivo es reconciliar el template físico de **108 seriales por país** con **100 nombres/definition groups nominales**, cinco Starter por país, aliases aprobados y la cobertura del oracle/addendum. La separación canónica futura deberá ser:

```text
CardDefinition (identidad/effect versionado)
  1 ── N CountryCardSerialTemplate (serial dentro del set de país)
          1 ── 1 CardInstance por país y partida
```

DEC-025 aprueba 108 instancias por país: 103 elegibles para Operations pool + 5 Starter. Por tanto, el template contiene 108 seriales; una partida BASE_2025 de cinco países materializa 540 `CardInstance`, 108 por cada uno de `ARDEN`, `FLUMA`, `URSARIA`, `PRESQUE` y `DINESIA`. Los 100 nombres únicos son una reconciliación nominal del DRAFT, no 100 definition IDs aprobados.

## 2. Fuentes exactas y clasificación

| Fuente | Clasificación | Uso permitido en este candidato |
|---|---|---|
| `docs/decisions/MALIGN_AI_DECISIONS_v0.3.md`, DEC-025…029, 039, 043…047, 075 | APPROVED | estructura 108/103+5, edge cases aprobados, aliases, lifecycle/boundaries y enfoque/hash review |
| `docs/normative/MALIGN_AI_CARD_COMPONENT_SYSTEM_SPEC_v0.1.md` §§2–7 | **DRAFT / NO APROBADO** | seriales, nombres, clases, alineación, IV y texto impreso como evidencia; nunca seed autoritativo |
| `docs/normative/MALIGN_AI_GAME_ENGINE_TEST_ACCEPTANCE_SPEC_v0.1.md` | APPROVED oracle | comportamiento esperado y cobertura para Action/Reaction/Veto/bonuses |
| `docs/normative/MALIGN_AI_GAME_ENGINE_TEST_ACCEPTANCE_M2_ADDENDUM_v0.1.md` | APPROVED TEST ACCEPTANCE BASELINE | DB seed/hash y effect dispatch gates; no contenido de carta |
| `docs/normative/MALIGN_AI_ADJUDICATION_ENGINE_SPEC_v0.1.md` | normativa aprobada | lifecycle, timings y operaciones; no asigna effect IDs canónicos al catálogo completo |
| `docs/normative/MALIGN_AI_GAME_ENGINE_INTERFACE_COMMAND_CONTRACT_SPEC_v0.1.md` | normativa aprobada | commands, continuations, privacy y serialization |
| `docs/normative/MALIGN_AI_GAME_DATA_MODEL_SPEC_v0.1.md` y `MALIGN_AI_DATA_DICTIONARY_ER_SPEC_v0.1.md` | normativa aprobada | separación definition/instance, fields y constraints lógicos |
| `docs/normative/MALIGN_AI_SCENARIO_DATA_SPEC_v0.1.md` | normativa aprobada | cinco países BASE_2025 y setup/Strategy |
| `packages/domain/src/base-2025.ts` | **OBSERVED IMPLEMENTATION M1, no autoridad de contenido M2** | confirma 108 seriales, cinco Starter y materialización por país; sus IDs serial-local no resuelven 100 definition groups |

No se utilizó asset externo, proveedor, web, inferencia generativa ni fuente DRAFT adicional.

## 3. Contrato de registro de campos

Cada fila del inventario se combina con los siguientes campos obligatorios. Esto evita repetir valores idénticos sin ocultarlos:

| Campo | Valor del candidato para cada serial | Estado/provenance |
|---|---|---|
| `serial` | número 1…108 de la fila | evidencia Card Component DRAFT; secuencia observada en M1 |
| `definition_id` | `UNRESOLVED` | no existe mapping aprobado 108 seriales →100 IDs; `BASE_CARD_NNN` de M1 es serial-local y no se eleva silenciosamente |
| `name` | nombre exacto de la fila | evidencia DRAFT; aliases separados por DEC-029 |
| `country` | `ARDEN`, `FLUMA`, `URSARIA`, `PRESQUE`, `DINESIA` al materializar cada template | DEC-025 + Scenario; una copia del serial por país |
| `type/subtype` | clase/alineación de la fila; subtype ausente=`UNRESOLVED` | clase/alineación son DRAFT salvo Starter structure aprobada |
| `starter` | sí sólo en 59, 63, 75, 85, 93 | DEC-025/039 + evidencia DRAFT |
| `slots/IV` | valor de fila prefijado `DRAFT:`; `—` si no hay | evidencia no aprobada, pendiente IQ-M2-010 |
| `cost` | valor explícito de fila prefijado `DRAFT:` o `UNRESOLVED` | ningún default se infiere; costes normativos se validarán contra oracle/decisions |
| `trigger/timing` | `DRAFT_EFFECT_TEXT` si hay texto impreso; de otro modo `UNRESOLVED` | el texto está en Card Component §3; timing canónico requiere mapping aprobado |
| `effect_id` | `UNRESOLVED` | no se acuñan IDs en este candidato |
| `aliases` | sólo los aliases aprobados indicados en fila; los demás `—` | DEC-029 |
| `source` | `CCS-DRAFT §3` más decisión/oracle indicada | provenance explícita; no implica approval |

`DRAFT_EFFECT_TEXT` no es un efecto ejecutable ni una omisión: registra que existe texto impreso en la fuente DRAFT, pero que trigger, timing, operations y `effect_id` aún requieren canonicalización. `UNRESOLVED` bloquea seed/handler; no equivale a `NONE`.

## 4. Inventario de 108 serial templates

Columnas abreviadas: `Clase/alineación` registra tipo y subtype candidato; `S` es Starter; `IV` conserva evidencia DRAFT; `Coste` sólo reproduce coste explícito DRAFT; `Efecto` indica presencia de texto DRAFT; `Alias` sólo registra DEC-029. Los campos `definition_id`, `country`, `trigger/timing`, `effect_id` y `source` se completan para cada fila por el contrato de §3.

| Serial | Nombre | Clase / alineación | S | Slots/IV | Coste | Efecto | Alias aprobado |
|---:|---|---|:---:|---|---|---|---|
| 1 | Acuerdos Comerciales | Acción / UNRESOLVED | no | — | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 2 | Agravios Históricos | Campaña / Maligna | no | DRAFT A:4 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 3 | Asesores Militares | Campaña / Dual | no | DRAFT M:3,A:3 | UNRESOLVED | — | — |
| 4 | Asociaciones Público-Privadas | Campaña / Dual | no | DRAFT M:5,A:5 | UNRESOLVED | — | `Alianzas Público-Privadas` |
| 5 | Ataque de Denegación de Servicio | Campaña / Maligna | no | DRAFT M:2,A:2 | UNRESOLVED | — | — |
| 6 | Atribución | Campaña / Resiliencia | no | DRAFT M:3,A:3 | UNRESOLVED | — | — |
| 7 | Cabildos | Campaña / Dual | no | DRAFT M:4,A:4 | UNRESOLVED | — | — |
| 8 | Campaña de Alfabetización Mediática | Campaña / Resiliencia | no | DRAFT M:5 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 9 | #Campaña | Campaña / Dual | no | DRAFT A:1 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 10 | Campaña de Hostigamiento | Campaña / Maligna | no | DRAFT M:4,A:4 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 11 | Acción Encubierta | Campaña / Maligna | no | DRAFT M:5,A:5 | UNRESOLVED | — | — |
| 12 | Agente Doble | Acción / UNRESOLVED | no | — | DRAFT 1 Recurso | DRAFT_EFFECT_TEXT | — |
| 13 | Apps de Chat | Campaña / Maligna | no | DRAFT A:4 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 14 | Aprendizaje basado en juegos | Campaña / Dual | no | DRAFT M:4,A:4 | UNRESOLVED | — | — |
| 15 | Astroturfing | Campaña / Maligna | no | DRAFT M:3,A:3 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 16 | Cámara de Eco | Campaña / Maligna | no | DRAFT M:3,A:3 | UNRESOLVED | — | — |
| 17 | Censura Doméstica | Campaña / Maligna | no | DRAFT M:5,A:5 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 18 | Ciberseguridad | Reacción / UNRESOLVED | no | — | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 19 | Cohesión Social | Campaña / Resiliencia | no | DRAFT I:3 | UNRESOLVED | — | — |
| 20 | Comentaristas Políticos | Campaña / Maligna | no | DRAFT A:4 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 21 | Contrainteligencia | Reacción / UNRESOLVED | no | — | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 22 | Control Editorial | Campaña / Maligna | no | DRAFT M:4,A:4 | UNRESOLVED | — | — |
| 23 | Descartar | Acción / UNRESOLVED | no | — | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 24 | Desinformación | Campaña / Maligna | no | DRAFT M:4,A:4 | UNRESOLVED | — | — |
| 25 | Ejército de Bots | Campaña / Maligna | no | DRAFT A:2 | UNRESOLVED | — | — |
| 26 | Filtraciones | Acción / UNRESOLVED | no | — | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 27 | Financiamiento Externo | Campaña / Dual | no | DRAFT M:4,A:4 | UNRESOLVED | — | — |
| 28 | Gestión de Crisis | Acción / UNRESOLVED | no | — | DRAFT 3 Recursos | DRAFT_EFFECT_TEXT | — |
| 29 | Influencers | Campaña / Dual | no | DRAFT M:2,A:2 | UNRESOLVED | — | — |
| 30 | Intercambio de Inteligencia | Campaña / Resiliencia | no | DRAFT M:5,A:5 | UNRESOLVED | — | — |
| 31 | Ladrón Encubierto | Acción / UNRESOLVED | no | — | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 32 | Medidas Activas | Acción / UNRESOLVED | no | — | DRAFT 1 Recurso | DRAFT_EFFECT_TEXT | — |
| 33 | Microtargeting | Campaña / Dual | no | DRAFT A:6 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 34 | Noticias Falsas | Campaña / Maligna | no | DRAFT M:5,A:5 | UNRESOLVED | — | — |
| 35 | Patrocinio educativo | Campaña / Dual | no | DRAFT M:3,A:3 | UNRESOLVED | — | — |
| 36 | Prensa Independiente | Campaña / Resiliencia | no | DRAFT M:4 | UNRESOLVED | — | — |
| 37 | Sanciones Económicas | Acción / UNRESOLVED | no | — | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 38 | Seguridad Electoral | Campaña / Resiliencia | no | DRAFT M:3,A:3 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 39 | Think Tanks | Campaña / Dual | no | DRAFT M:4,A:4 | UNRESOLVED | — | — |
| 40 | Chantaje | Campaña / Maligna | no | DRAFT M:4,A:4 | UNRESOLVED | — | — |
| 41 | Ciberataque | Campaña / Dual | no | DRAFT M:5,A:5 | UNRESOLVED | — | — |
| 42 | Construcción de coalición | Campaña / Dual | no | DRAFT M:2,A:2 | DRAFT contribución 0/1 por otro jugador según DEC-027 | DRAFT_EFFECT_TEXT | — |
| 43 | Contraataque Informático | Reacción / UNRESOLVED | no | — | UNRESOLVED | DRAFT_EFFECT_TEXT | `HACK BACK` |
| 44 | Curso de Alfabetización Mediática | Campaña / Resiliencia | no | DRAFT M:3,A:3 | UNRESOLVED | — | — |
| 45 | Deepfake | Campaña / Maligna | no | DRAFT M:6,A:6 | UNRESOLVED | — | — |
| 46 | Desinformación Electoral | Campaña / Maligna | no | DRAFT M:4,A:4 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 47 | Desplataformización | Campaña / Dual | no | DRAFT M:6,A:6 | UNRESOLVED | — | — |
| 48 | Detección de Bots y Spam | Campaña / Resiliencia | no | DRAFT M:2,A:2 | UNRESOLVED | — | — |
| 49 | Diásporas | Campaña / Dual | no | DRAFT M:4,A:4 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 50 | Diplomacia Pública | Campaña / Resiliencia | no | DRAFT M:5 | UNRESOLVED | — | — |
| 51 | Doble Acción | Acción / UNRESOLVED | no | — | DRAFT 1 Recurso | DRAFT_EFFECT_TEXT | — |
| 52 | Doxing | Campaña / Dual | no | DRAFT M:3,A:3 | UNRESOLVED | — | — |
| 53 | Efectos Nacionales | Campaña / Dual | no | DRAFT M:6,A:6 | UNRESOLVED | — | — |
| 54 | Ejercicios Militares | Campaña / Dual | no | DRAFT M:6,A:6 | DRAFT 1 Recurso | DRAFT_EFFECT_TEXT | — |
| 55 | Emitir Códigos y Estándares | Campaña / Resiliencia | no | DRAFT M:2,A:2 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 56 | Espionaje | Acción / UNRESOLVED | no | — | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 57 | Foros en Línea | Campaña / Maligna | no | DRAFT A:4 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 58 | Fortalecer Instituciones | Campaña / Resiliencia | no | DRAFT M:4,A:4 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 59 | Giro de Política | Starter / free-play candidate | sí | — | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 60 | Guerra Jurídica | Campaña / Dual | no | DRAFT M:5,A:5 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 61 | Identidades Falsas | Campaña / Dual | no | DRAFT A:3 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 62 | Infraestructura de Información | Campaña / Dual | no | DRAFT A:4 | UNRESOLVED | — | — |
| 63 | Intención Libre | Starter / Campaña Dual | sí | DRAFT I:1 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 64 | Interagencia | Acción / UNRESOLVED | no | — | DRAFT 1 Recurso | DRAFT_EFFECT_TEXT | — |
| 65 | Leyes Anticorrupción | Reacción / UNRESOLVED | no | — | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 66 | Lista Blanca | Campaña / Resiliencia | no | DRAFT A:2 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 67 | Manipulación Electoral | Campaña / Maligna | no | DRAFT M:5,A:5 | UNRESOLVED | — | — |
| 68 | Memes Maliciosos | Campaña / Maligna | no | DRAFT M:2,A:2 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 69 | Movilización Militar | Campaña / Dual | no | DRAFT M:6,A:6 | DRAFT 3 Recursos | DRAFT_EFFECT_TEXT | — |
| 70 | Movilización Popular | Campaña / Dual | no | DRAFT M:4,A:4 | UNRESOLVED | — | — |
| 71 | Participación de la Sociedad Civil | Campaña / Resiliencia | no | DRAFT M:5 | UNRESOLVED | — | — |
| 72 | Política Coordinada | Campaña / Resiliencia | no | DRAFT M:6,A:6 | UNRESOLVED | — | — |
| 73 | Derecho preferente de compra | Reacción / UNRESOLVED | no | — | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 74 | Presión Económica | Campaña / Maligna | no | DRAFT M:6,A:6 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 75 | Presupuesto Aumentado | Starter / free-play candidate | sí | — | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 76 | Protestas Organizadas | Campaña / Dual | no | DRAFT M:4,A:4 | UNRESOLVED | — | — |
| 77 | Radicalización en Línea | Campaña / Maligna | no | DRAFT M:4,A:4 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 78 | Regulación de Plataformas | Campaña / Resiliencia | no | DRAFT M:5,A:5 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 79 | Restricciones de Viaje | Campaña / Maligna | no | DRAFT M:2,A:2 | UNRESOLVED | — | — |
| 80 | Robar | Acción / UNRESOLVED | no | — | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 81 | Robo Cibernético | Acción / UNRESOLVED | no | — | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 82 | Tarro de Miel | Acción / UNRESOLVED | no | — | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 83 | Teoría Conspirativa | Campaña / Maligna | no | DRAFT M:4 | UNRESOLVED | — | `Teoría de la Conspiración` |
| 84 | Verificación de Hechos | Campaña / Resiliencia | no | DRAFT M:2,A:2 | UNRESOLVED | — | `Verificación de Datos` |
| 85 | Veto | Starter / Reaction timing candidate | sí | — | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 86 | Videos de Propaganda | Campaña / Maligna | no | DRAFT M:3,A:3 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 87 | ¡Impulso! | Acción / on-roll timing candidate | no | — | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 88 | Corrupción | Acción / UNRESOLVED | no | — | DRAFT 1 Recurso | DRAFT_EFFECT_TEXT | — |
| 89 | Organizaciones Internacionales | Campaña / Dual | no | DRAFT M:4,A:4 | UNRESOLVED | — | — |
| 90 | Operación de Desinformación | Campaña / Maligna | no | DRAFT M:6,A:6 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 91 | Rastreo de Datos | Campaña / Resiliencia | no | DRAFT M:2,A:2 | UNRESOLVED | — | — |
| 92 | Influencia Política | Campaña / Dual | no | DRAFT M:4,A:4 | UNRESOLVED | — | — |
| 93 | Política Prioritaria | Starter / free-play candidate | sí | — | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 94 | Protocolos de Seguridad | Reacción / draw trigger aprobado DEC-028 | no | — | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 95 | Inteligencia Artificial | Campaña / Dual | no | DRAFT A:3 | UNRESOLVED | — | — |
| 96 | Inteligencia Artificial | Campaña / Dual | no | DRAFT A:3 | UNRESOLVED | — | — |
| 97 | Divisiones Sociales | Campaña / Maligna | no | DRAFT I:2 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 98 | Divisiones Sociales | Campaña / Maligna | no | DRAFT I:2 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 99 | Influencia Maligna | Campaña / Maligna | no | DRAFT I:1 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 100 | Influencia Maligna | Campaña / Maligna | no | DRAFT I:1 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 101 | Influencia Maligna | Campaña / Maligna | no | DRAFT I:1 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 102 | Temas Divisivos | Campaña / Maligna | no | DRAFT I:3 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 103 | Temas Divisivos | Campaña / Maligna | no | DRAFT I:3 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 104 | Resiliencia | Campaña / Resiliencia | no | DRAFT I:1 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 105 | Resiliencia | Campaña / Resiliencia | no | DRAFT I:1 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 106 | Resiliencia | Campaña / Resiliencia | no | DRAFT I:1 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 107 | Políticas de identidad | Campaña / Dual | no | DRAFT I:3 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |
| 108 | Políticas de identidad | Campaña / Dual | no | DRAFT I:3 | UNRESOLVED | DRAFT_EFFECT_TEXT | — |

## 5. Reconciliación 108 instancias / 100 definiciones

La reconciliación nominal, sin forzar IDs, es:

| Nombre repetido | Seriales | Instancias template | Definition group nominal candidato | Exceso sobre una definición |
|---|---|---:|---:|---:|
| Inteligencia Artificial | 95, 96 | 2 | 1 | 1 |
| Divisiones Sociales | 97, 98 | 2 | 1 | 1 |
| Influencia Maligna | 99, 100, 101 | 3 | 1 | 2 |
| Temas Divisivos | 102, 103 | 2 | 1 | 1 |
| Resiliencia | 104, 105, 106 | 3 | 1 | 2 |
| Políticas de identidad | 107, 108 | 2 | 1 | 1 |
| **Total** | — | **14** | **6** | **8** |

Los otros 94 nombres aparecen una vez. Así, `108 serial templates - 8 duplicados físicos adicionales = 100 grupos nominales`. Esto verifica el conteo del DRAFT, pero no prueba que dos caras de igual nombre deban compartir un futuro `definition_id`; esa decisión y sus 100 IDs permanecen `UNRESOLVED` bajo IQ-M2-010.

### 5.1 Starter y países

| Serial | Starter | ARDEN | FLUMA | URSARIA | PRESQUE | DINESIA |
|---:|---|:---:|:---:|:---:|:---:|:---:|
| 59 | Giro de Política | ✓ | ✓ | ✓ | ✓ | ✓ |
| 63 | Intención Libre | ✓ | ✓ | ✓ | ✓ | ✓ |
| 75 | Presupuesto Aumentado | ✓ | ✓ | ✓ | ✓ | ✓ |
| 85 | Veto | ✓ | ✓ | ✓ | ✓ | ✓ |
| 93 | Política Prioritaria | ✓ | ✓ | ✓ | ✓ | ✓ |

Resultado: **5/5 Starter definitions nominales por set** y **25 Starter CardInstance por partida de cinco países**, dentro de 108/país y fuera del Operations Deck de 30 conforme DEC-025. No se asigna un país exclusivo a ninguna definición; el reverso/owner se materializa por country set.

## 6. Duplicados, aliases e identidades

- **Seriales duplicados:** ninguno; el rango 1…108 es continuo y único.
- **Nombres duplicados:** seis grupos, exactamente los de §5; son duplicados físicos esperados, no collision resuelta de `definition_id`.
- **Definition IDs:** todos `UNRESOLVED`; no se puede verificar duplicidad antes de aprobar el mapping 108→100.
- **Effect IDs:** todos `UNRESOLVED`; no se puede verificar duplicidad/aliasing antes de aprobar taxonomy mapping.
- **Aliases aprobados DEC-029:** `HACK BACK → Contraataque Informático`; `Verificación de Datos → Verificación de Hechos`; `Alianzas Público-Privadas → Asociaciones Público-Privadas`; `Teoría de la Conspiración → Teoría Conspirativa`.
- **Colisiones de alias observadas:** ninguna contra los 100 nombres nominales; cada alias apunta a un único nombre.
- **IDs M1 observados:** `BASE_CARD_001…108` son serial-local y únicos en código; no se consideran prueba de 100 definitions canónicas ni se modifican aquí.

## 7. Campos pendientes y bloques bloqueados

| Dato pendiente | Estado | Evidencia disponible | Bloque bloqueado |
|---|---|---|---|
| 100 `definition_id` canónicos y mapping de 108 seriales | UNRESOLVED | nombres/duplicados DRAFT; DEC-029 exige ID | M2-1 registry seed; M2-3 bonuses/dispatch; M2-4/M2-5 cards |
| tipo/subtype canónico por definición | UNRESOLVED salvo estructura Starter | clases DRAFT + oracle | M2-4/M2-5 |
| slots/IV completos aprobados | UNRESOLVED | matriz DRAFT; subset M1 observado | M2-3/M2-4 |
| costes por carta y su relación con AP/activation | UNRESOLVED | texto DRAFT + oracle/decisions parciales | M2-3/M2-4/M2-5 |
| trigger/timing canónico | UNRESOLVED | DRAFT + Adjudication/oracle parcial | M2-4/M2-5 |
| `effect_id` por definition | UNRESOLVED | taxonomy/handlers conceptuales, sin mapping completo | M2-3 `GE-M2-EFX-001`; M2-4/M2-5 |
| operations/parameters versionados por effect | UNRESOLVED | oracle describe resultados, no snapshot | M2-4/M2-5 |
| snapshot content approval | OPEN IQ-M2-010 | este candidato | M2-0 review; todos los consumers |
| snapshot/hash approval | OPEN IQ-M2-010 | blob de este markdown sólo informativo | M2-1 seed y todo bloque registry-dependent |

No se detectó una contradicción nueva entre reglas oficiales. La diferencia DRAFT 108/100 se reconcilia estructuralmente mediante DEC-025 sin modificar `OPEN_QUESTIONS.md`; los campos de contenido pendientes son IQ-M2-010, no una resolución inventada.

## 8. Matriz de cobertura registry → aceptación

| Registry concern | Oracle | Addendum M2 | Owner futuro |
|---|---|---|---|
| 108 por país, 5 Starter, 103 pool, sin caps físicos | `GE-SET-007/008`, `GE-E2E-006` | `GE-M2-DB-005` | M2-1 |
| pinned registry/version compatibility | `GE-AUD-003/004` | `GE-M2-DB-003/006`, `GE-M2-TX-008/009` | M2-1 |
| slots/IV/campaign compatibility | `GE-CAM-006/007/010`, `GE-ERT-022/023` | `GE-M2-EFX-001` | M2-3; regression M2-4 |
| 23 pair bonuses y aliases | `GE-ERT-022` | `GE-M2-DB-005`, `GE-M2-EFX-001` | M2-3/M2-4 |
| Action/Starter effects | `GE-ACT-001…030`, `GE-PLAN-006…014` | `GE-M2-EFX-001` | M2-4 |
| Regime effect dispatch | `GE-REG-001…015` | `GE-M2-EFX-001` | M2-4 |
| Reaction/Veto/timing | `GE-REA-001…010`, `GE-VETO-001…005`, `GE-NAR-001…004` | `GE-M2-RX-001…003` | M2-5 |
| privacy/secret options | `GE-SEC-001…006`, Action/Reaction privacy cases | `GE-M2-RT-007`, `GE-M2-RX-002` | M2-2/M2-4/M2-5 |
| lifecycle/zone ownership | `GE-ACT-004/009…012`, `GE-CLN-001` | `GE-M2-DB-004`, `GE-M2-LC-001` | M2-1/M2-4/M2-6 |

La matriz traza coverage, no aprueba contenido ni permite fabricar fixtures desde el DRAFT.

## 9. Snapshot y hash propuestos para aprobación posterior

Después de resolver IQ-M2-010, un artifact separado deberá serializarse de forma canónica con:

1. `registry_version` y `schema_version` explícitos;
2. digests de todas las fuentes aprobadas;
3. 100 definitions ordenadas por `definition_id` aprobado;
4. 108 serial templates ordenados por serial, cada uno ligado a una definition;
5. cinco country IDs y regla de materialización;
6. aliases ordenados por normalized alias;
7. effect IDs/operations tipados y versionados;
8. ausencia total de `UNRESOLVED`;
9. canonical JSON (JCS) y SHA-256 del snapshot;
10. blob SHA Git del artifact y de la decisión que lo apruebe.

El blob SHA del presente markdown se reporta sólo para revisión documental. **No es el hash canónico del registry y no queda aprobado silenciosamente.** Este documento no crea el JSON propuesto.

## 10. Gate de aprobación futuro

El candidate sólo podrá convertirse en canonical/seedable si:

- 108/108 seriales y 100/100 definitions se revisan contra fuentes;
- 5/5 Starter y cinco country sets se confirman;
- todos los `UNRESOLVED` se resuelven mediante autoridad válida;
- aliases, IDs, effect IDs y seriales no colisionan;
- coverage oracle/addendum está completa;
- snapshot/hash se aprueban expresamente mediante decisión posterior;
- IQ-M2-010 cambia a RESOLVED.

Hasta entonces: **NOT APPROVED FOR SEED OR IMPLEMENTATION**.
