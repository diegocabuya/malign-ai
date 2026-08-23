# MALIGN-AI — M1 TEST GATE v0.1

**Fecha:** 2026-08-23  
**Estado:** M1 PLANNING GATE AMENDED / PENDING FINAL REVIEW  
**Oracle:** `MALIGN_AI_GAME_ENGINE_TEST_ACCEPTANCE_SPEC_v0.1.md`  
**Addendum canónico:** `MALIGN_AI_GAME_ENGINE_TEST_ACCEPTANCE_M1_ADDENDUM_v0.1.md`  
**Implementación M1:** **NOT AUTHORIZED**

> Este documento asigna casos existentes del oracle v0.1 y los 38 casos canónicos del addendum M1 v0.1 sin modificar el oracle. `DEC-065` aprueba la enmienda documental, pero no autoriza implementar M1 ni M1-0.

## 1. Reglas del gate

1. Los IDs `GE-*` se conservan byte-for-byte y existen en el oracle v0.1.
2. Un ID tiene un único PR owner. M1-3 sólo repite siete IDs marcados expresamente `[REGRESSION]`.
3. Los 55 tests existentes de M0 se ejecutan completos en cada PR y no se cuentan otra vez como nuevos casos M1.
4. Los casos del addendum no sustituyen ningún caso nominal del oracle.
5. Todo test expresa fixture/versiones, Given/When/Then, post-state, event order, ledgers, trace, projection e invariantes que apliquen.
6. Gate binario: 100% PASS, 0 skips, 0 todo y ningún P0 suavizado.
7. No se modifica el oracle para acomodar código.

## 2. Conteo y asignación

| PR propuesto | IDs oracle v0.1 owner | IDs addendum M1 owner | Regresiones explícitas | Ejecuciones del gate |
|---|---:|---:|---:|---:|
| M1-0 | 15 | 10 | 0 | 25 |
| M1-1 | 17 | 9 | 0 | 26 |
| M1-2 | 17 | 9 | 0 | 26 |
| M1-3 | 0 | 10 | 7 | 17 |
| **Total** | **49 únicos** | **38 únicos** | **7 reejecuciones** | **94** |

Baseline M1: **87 casos únicos** (49 oracle v0.1 + 38 addendum M1 v0.1). Total de ejecuciones asignadas a gates: **94**, porque M1-3 reejecuta siete casos de seguridad/concurrencia. La suite M0 55/55 se ejecuta adicionalmente en cada PR y no altera este conteo.

## 3. M1-0 — Session, seats y setup

### 3.1 IDs exactos del oracle — 15

| ID | Given | When | Expected result |
|---|---|---|---|
| `GE-SET-001` | Cinco países, cinco jugadores, F1, 14 PD, turn limit válido, 108 instancias y cinco Starter por país | F1 ejecuta `START_GAME` | `GAME_STARTED`, entra a Strategy y fija versions |
| `GE-SET-002` | Setup completo salvo facilitador | `START_GAME` | setup invalid, sin `GAME_STARTED` ni mutación |
| `GE-SET-003` | Cuatro o seis países activos | `START_GAME` | setup invalid; no inicio |
| `GE-SET-004` | `turn_limit` null o 0 | `START_GAME` | rechazo; debe ser >=1 |
| `GE-SET-005` | Selección de 29 o 31 non-Starter | `LOCK_STRATEGY` | rechazo; no shuffle ni move parcial |
| `GE-SET-006` | Selección de 30 incluye Starter | `LOCK_STRATEGY` | `CARD_NOT_ELIGIBLE`; state intacto |
| `GE-SET-007` | Treinta instancias únicas del pool de 103 y RNG fijo | `LOCK_STRATEGY` | deck de 30 en orden determinístico auditado; resto inactive |
| `GE-SET-008` | Deck construido y cinco Starter separadas | resolver mano inicial | HAND=10, cinco Starter + cinco non-Starter y cinco `CARD_DRAWN` |
| `GE-SET-010` | Mismo instance ID dos veces | `LOCK_STRATEGY` | rechazo y unicidad preservada |
| `GE-CORE-002` | Actor intenta operar objeto controlado por otro | command sintácticamente válido | `NOT_AUTHORIZED`/`CARD_NOT_CONTROLLED`; objeto intacto |
| `GE-CORE-003` | `game_version=20`, expected=19 | command mutante | `STALE_STATE_VERSION`; cero eventos de dominio |
| `GE-CORE-004` | Command ya resuelto con key K | retry exacto K | resultado original; sin mutation/event/ledger/version duplicado |
| `GE-CORE-006` | Overlay `PAUSED` | jugador envía gameplay command | `GAME_PAUSED`; commands administrativos permitidos |
| `GE-CORE-010` | Dos locks concurrentes, misma expected version y payload distinto | ambos intentan commit | sólo uno confirma; el segundo stale/equivalente; no mezcla planes |
| `GE-FAC-001` | Partida activa | F1 pausa y reanuda | overlay bloquea/desbloquea, fase subyacente preservada y auditada |

### 3.2 IDs exactos del addendum M1 — 10

| ID | Given | When | Expected result |
|---|---|---|---|
| `GE-M1-SES-001` | F1 autenticado y versions válidas | `CREATE_GAME` | estado `SETUP`, facilitator único y versions/turn-limit del command fijados |
| `GE-M1-SES-002` | Caller PLAYER | intenta `CREATE_GAME` o `ASSIGN_PLAYER_SEAT` | rechazo seguro, cero state/event/version |
| `GE-M1-SES-003` | Membership autenticada P1 | join se materializa | `GameParticipant` activo enlazado a la sesión, sin autoridad derivada de payload |
| `GE-M1-SES-004` | Actor autenticado A y payload que suplanta participant/country B | command | application boundary ignora/rechaza el spoof antes del Engine |
| `GE-M1-SES-005` | P1 ya seated | segundo seat para P1 | rechazo atómico |
| `GE-M1-SES-006` | ARDEN ya asignado | segundo participante solicita ARDEN | rechazo atómico |
| `GE-M1-SES-007` | `seat_index` o `clockwise_index` duplicado | assignment | rechazo sin alterar seats existentes |
| `GE-M1-SES-008` | Actor/member de juego G1 | usa envelope de G2 | `GAME_ID_MISMATCH`/`NOT_AUTHORIZED` seguro |
| `GE-M1-SES-009` | Version N | cualquier query M1-0 | state/version/events/idempotency permanecen idénticos |
| `GE-M1-SES-010` | Retry exacto de create/seat/setup command | se reenvía | mismo result/ref, sin duplicar participante, seat ni evento |

## 4. M1-1 — Initiative, hidden planning y projections

### 4.1 IDs exactos del oracle — 17

| ID | Given | When | Expected result |
|---|---|---|---|
| `GE-INI-001` | Rolls P1=8,P2=4,P3=10,P4=9,P5=2 | resolver iniciativa | P3 primero y resto clockwise desde P3; orden exacto |
| `GE-INI-002` | P1=10,P2=10,P3=9,P4=3,P5=2; reroll 4/7 | resolver | sólo P1/P2 reroll; P2 gana; rolls auditados |
| `GE-INI-003` | Primera y segunda rondas empatan en máximo; tercera desempata | resolver | rerolls continúan sólo para empatados hasta ganador único |
| `GE-INI-004` | P1 HAND=8, descarta 3, target=10 | maintenance P1 | HAND final 10 tras cinco draws; destinos e ingreso correctos |
| `GE-INI-005` | Deck con 2 y discard reciclable >=4; faltan cinco draws | fill-to-10 | roba 2, reshuffle único, roba 3; RNG determinístico |
| `GE-INI-006` | Deck/discard sin cartas | fill-to-10 | roba 0, sin error; ingreso sí se recibe |
| `GE-INI-009` | Fixture base sin otros ingresos | aplicar income | Arden+2, Fluma+1, Ursaria+2, Presque+2, Dinesia+3 en ledger |
| `GE-PLAN-001` | P1 sin efectos extra | lock de cuatro acciones de 1 AP | `INSUFFICIENT_AP`; no lock |
| `GE-PLAN-003` | P1 lock con cards/targets | P2 consulta antes de reveal | ve status permitido, no payload/card IDs/target/DT |
| `GE-PLAN-004` | P1 lockea tres acciones y luego primera es vetada | resolver turno | AP_available=0; no refund por Veto |
| `GE-PLAN-005` | P1 ya locked | intenta cambiar slot 2 | rechazo; sólo override F1 auditado podría reabrir |
| `GE-SEC-001` | HAND P1 con IDs/nombres | projections P1/P2/F1 | P1/F1 ven autorizado; P2 no contents |
| `GE-SEC-002` | Cada país con Secret VO | P2 consulta P1 y se construye AI-P2 context | no condición/progress/metadata P1; F1 sí |
| `GE-SEC-003` | Deck order exacto server-side | P2/AI-P2 projection | no orden ni top-card identity |
| `GE-SEC-004` | P1 locked | consulta antes y después de reveal | antes no payload; después sólo campos públicos de timing |
| `GE-CORE-001` | INITIATIVE; P1 intenta construct | command con version actual | `WRONG_PHASE`; cero mutación/version |
| `GE-CORE-008` | ACTION_STAGE_PLAN | intento directo de end-game scoring | rechazo; fase intacta |

### 4.2 IDs exactos del addendum M1 — 9

| ID | Given | When | Expected result |
|---|---|---|---|
| `GE-M1-IPL-001` | Draft autoritativo de P1 y version N | P1 solicita owner projection | contiene exactamente sus slots privados y no incrementa version |
| `GE-M1-IPL-002` | Dos drafts P1 que sólo difieren en card IDs, target o DT secretos | P2 solicita rival projection | proyecciones equivalentes salvo status/conteo permitido |
| `GE-M1-IPL-003` | Cinco planes draft/locked y deck order técnico | F1 solicita facilitator projection | payload completo de cinco planes, sin future deck order |
| `GE-M1-IPL-004` | Plan locked con slots futuros | scheduler inicia un slot | `ACTION_REVEALED` ocurre al iniciar ese slot, no al lock ni para slots futuros |
| `GE-M1-IPL-005` | Secuencia determinística de seats/attempts | resolver RNG hasta consumirla o invalidarla | consumo exacto; exhaustion/out-of-range falla sin fallback |
| `GE-M1-IPL-006` | Cuatro players locked y quinto plan válido | quinto lock | una transición a Resolution, un version increment y events contiguos |
| `GE-M1-IPL-007` | State válido con campos clasificados | serializar rival projection | ningún valor privado o `SYSTEM_ONLY` aparece |
| `GE-M1-IPL-008` | Plan válido y fallo posterior | lock y resolución fallida | 1 AP exacto por slot, sin reembolso posterior |
| `GE-M1-IPL-009` | Plan `[CONSTRUCT_CAMPAIGN, ACTIVATE_CAMPAIGN]` | lock y scheduler lee plan | `sequence_index` 1→2 preservado |

## 5. M1-2 — Scheduler, campaña completa, trace y ledgers

### 5.1 IDs exactos del oracle — 17

| ID | Given | When | Expected result |
|---|---|---|---|
| `GE-CORE-005` | Acción requiere 3 Resources; actor tiene 2 al resolver | scheduler llega al slot | `FAILED_COST`/invalidated, sin pago parcial; AP comprometido sigue gastado |
| `GE-CORE-009` | Acción P1 abre `ChoiceRequest` | P2 intenta forzar resolución | scheduler suspendido hasta input autorizado |
| `GE-CAM-001` | Row I libre, Intent+Method compatibles y DT válido | resolver construct | campaña Row I, dos cards asignadas, Amplifier opcional |
| `GE-CAM-005` | Multi-slot con IV distintos | colocar como Method | slot METHOD y futuro CV usa IV Method |
| `GE-ERT-007` | base_cv=10 y pair +2 | activation | coste 2 MEDIUM; effective_cv12; ERT tier HIGH |
| `GE-ERT-016` | Actor posee legitimacy target; raw=6 | activation | modified incluye +1 y trace lo registra |
| `GE-DIE-001` | mode DIGITAL; adapter retorna 7 | pedir d10 campaña | DieRoll raw7, manual=false, source/rng request persistidos |
| `GE-CUBE-004` | Oposición P2=1/P3=2; incoming4 | actor elige P3 dos veces | consume4, remueve2 P3, P2 intacto; choice exacta |
| `GE-CUBE-006` | ERT positiva +2 y oposición >=1 | resolver | `ERT_POSITIVE + NO_CUBE_PLACED`; VP 0; legitimacy intacta |
| `GE-CUBE-007` | Resultado +3 y una oposición | resolver | coloca1 remainder; VP+1; abre flujo legitimacy |
| `GE-LEG-001` | PD sin marker; coloca >=1; actor <3 markers | resolver | marker actor +1 establishment VP además de cube VP |
| `GE-LEG-002` | Marker ya es del actor; coloca1 | resolver | marker igual; sólo +1 cube VP |
| `GE-LEG-003` | Marker=P2; P1 coloca >=1 | resolver | marker P2 removido; P1 +1 subversion; no marker P1 aún |
| `GE-CHO-001` | Opciones [A,B] | actor envía C | rechazo; state/scheduler no avanza |
| `GE-CHO-002` | Choice pertenece P1 | P2 envía opción válida | `NOT_AUTHORIZED` |
| `GE-AUD-001` | Campaña con bonus, costes, roll, 2:1 y VP | resolver | trace completa, hashes/version refs, sin campo crítico nulo sin razón |
| `GE-AUD-006` | Pre/post de resolución aceptada | diff state | toda mutación crítica explicada por event/ledger/trace |

### 5.2 IDs exactos del addendum M1 — 9

| ID | Given | When | Expected result |
|---|---|---|---|
| `GE-M1-ADJ-001` | Golden exacto de Spec §10 y Test Gate §7.4 | P1 construye y activa HIGH MALIGN | CV12, cost3, raw7, ERT+3, 2:1→1 placed, legitimacy Arden, VP+2, resources1 |
| `GE-M1-ADJ-002` | Cinco planes locked con initiative/sequence conocidos | scheduler resuelve | orden por `initiative_position` y `sequence_index`; cliente no elige slot |
| `GE-M1-ADJ-003` | Cliente sin autoridad SYSTEM | intenta scheduler/mutación interna | rechazo en authority boundary sin mutación |
| `GE-M1-ADJ-004` | Pending choice 2:1 | serializar y rehidratar Engine nuevo | actor, options y cursor se conservan |
| `GE-M1-ADJ-005` | Choice vigente y respuestas valid/late/double | responder/reintentar | válida reanuda una vez; late/double no duplica |
| `GE-M1-ADJ-006` | Full campaign golden | resolver activation | event order exacto, incluido PRE_ROLL open/evaluate/close |
| `GE-M1-ADJ-007` | Activación con múltiples artifacts | commit | un version increment y sequences contiguas |
| `GE-M1-ADJ-008` | State estable y variante con cambio autoritativo | RFC 8785/JCS + SHA-256 | hash estable y sensible al cambio |
| `GE-M1-ADJ-009` | Secuencias válidas generadas | aplicar commands/replay | invariantes, ledgers y events preservados |

## 6. M1-3 — Realtime adapter y reconnect

### 6.1 Regresiones explícitas del oracle — 7

Estos IDs ya tienen owner en M1-0/M1-1/M1-2. Su repetición es deliberada para probar el nuevo boundary de transport/recovery.

| ID | Marcador | Propósito en M1-3 |
|---|---|---|
| `GE-CORE-003` | `[REGRESSION]` | reconnect con expected version obsoleta sigue rechazando sin broadcast |
| `GE-CORE-004` | `[REGRESSION]` | retry después de pérdida de respuesta no duplica publish/event/ledger |
| `GE-CORE-010` | `[REGRESSION]` | dos clientes del mismo jugador no mezclan locks |
| `GE-SEC-001` | `[REGRESSION]` | HAND no aparece en canal rival/reconnect |
| `GE-SEC-002` | `[REGRESSION]` | Secret VO/progress no aparece en canal rival/reconnect |
| `GE-SEC-003` | `[REGRESSION]` | future deck order ausente de mensajes y recovery |
| `GE-SEC-004` | `[REGRESSION]` | plan face-down conserva redacción antes del reveal |

### 6.2 IDs exactos del addendum M1 — 10

| ID | Given | When | Expected result |
|---|---|---|---|
| `GE-M1-RT-001` | Initial sync mientras puede ocurrir commit | fetch projection/cursor y subscribe | no pierde commit entre operaciones |
| `GE-M1-RT-002` | Commit con cambio público | construir broadcasts por viewer | payload público semánticamente consistente |
| `GE-M1-RT-003` | Canonical event privado owner | proyectar/publicar | sólo owner + facilitator reciben payload permitido |
| `GE-M1-RT-004` | F1 solicita stream/audit normal | proyectar/publicar | audit completo sin future deck order normal |
| `GE-M1-RT-005` | Actor recibe raw `CommandResult` | publicar a otros viewers | raw result nunca llega a rivales |
| `GE-M1-RT-006` | Rechazo o rollback | adapter procesa outcome | no publica mutación |
| `GE-M1-RT-007` | Delivery duplicado | consumidor aplica | deduplica por event ID/sequence |
| `GE-M1-RT-008` | Gap detectado | recuperar event feed | converge con latest projection |
| `GE-M1-RT-009` | Actor con pending se reconecta | authenticate/fetch/subscribe | restaura projection/cursor/pending autorizado |
| `GE-M1-RT-010` | Rival se reconecta | comparar projection normal | conserva todas las redacciones |

## 7. Fixtures exactos

### 7.1 Versiones comunes

Todo fixture fija explícitamente:

```text
ruleset_version
scenario_version
card_registry_version
engine_contract_version
fixture_schema_version
```

No se usan `latest`, timestamps reales, RNG real ni IDs generados al vuelo en expected results.

### 7.2 Session/setup

- F1 + P1…P5 y mapping de seats/countries de Implementation Spec §4.
- BASE_2025 con 14 PD y pilas iniciales exactas.
- `turn_limit=1` únicamente como input determinístico del happy-path de test; no es default del producto. Casos boundary usan null/0 y otro entero positivo parametrizado.
- cinco sets de 108 instancias; seriales estables 1…108 por country; cinco Starter separados.
- cinco selecciones exactas de 30 non-Starter y secuencias completas de shuffle/draw.

### 7.3 Initiative/planning/security

- secuencias exactas del oracle para `GE-INI-001…003`;
- deck exhaustion/discard sequences para `GE-INI-004…006`;
- plans P1…P5 con IDs de instancia/targets conocidos y snapshots owner/rival/F1 antes y después de reveal;
- Secret VO definitions/progress presentes en state para negative assertions, aunque M1 no los evalúa.

### 7.4 Full campaign golden

```text
actor=P1/ARDEN
campaign_alignment=MALIGN
Intent=serial 102 Temas Divisivos, IV(INTENT)=3
Method=serial 45 Deepfake, IV(METHOD)=6
Amplifier=serial 3 Asesores Militares, IV(AMPLIFIER)=3
target_dt=BLACK
target_pd=PRESQUE_PD_1
pre-target=RESILIENCY 1 attributed PRESQUE; no legitimacy
actor_resources_before_income=2
income=2
activation_cost=3
die_sequence=[7]
expected_base_cv=12
expected_effective_cv=12
expected_ert=+3 MALIGN
expected_2_to_1=consume2/remove1/place1
expected_legitimacy=ARDEN
expected_vp_delta=2
expected_actor_resources=1
```

El fixture incluye expected event sequence, resource/AP/VP/influence/legitimacy ledgers, full trace y state hashes. Nombres son metadata; resolución usa definition/instance IDs versionados.

### 7.5 Choice/reconnect

- `pd-mixed-attribution`: oposición P2=1/P3=2, incoming=4, options opacas A/B vinculadas internamente a attribution; selección P3,P3.
- checkpoint antes de Choice, después de rehydrate y después de resume.
- feeds público/P1/P2/F1 a partir del mismo event log canónico.
- cursor antes/después de un gap y expected latest projection por viewer.

## 8. Seguridad positiva y negativa

| Clase | Positive assertion | Negative assertion |
|---|---|---|
| HAND | P1/F1 ven identidad autorizada | P2/event feed/reconnect/AI-P2 no la contienen |
| Plan face-down | P1/F1 ven slots | P2 no ve action type, card, target, DT ni private choice |
| Secret VO | P1/F1 ven condition/progress | P2 no ve condition, metadata, progress ni error inferible |
| Deck | owner conoce composición permitida; F1 audita draws | nadie recibe future order/top card |
| Choice | actor designado recibe options | otro actor recibe `NOT_AUTHORIZED`, no options/details |
| Trace | F1 recibe full trace; player versión autorizada | rival no obtiene campos secretos por query/realtime |
| Error | actor recibe code seguro | `safe_details` no confirma cartas/objetivos/eligibilidad secreta |

Cada nueva propiedad privada requiere al menos un viewer autorizado y un viewer no autorizado en el mismo test o par de tests.

## 9. Idempotencia, stale version y doble submit

Deben permanecer en todos los PR gates:

- `GE-CORE-003` stale version;
- `GE-CORE-004` idempotent retry;
- `GE-CORE-010` double submit;
- same idempotency key + payload distinto → `IDEMPOTENCY_KEY_REUSED` como invariant del contract cubierta por `GE-CORE-004`/`GE-M1-SES-010`;
- query no incrementa version;
- one stable commit incrementa version una sola vez;
- rejected command no emite domain mutation/event/ledger/trace/broadcast.

M1-3 reejecuta los tres IDs para simular respuesta perdida, dos clientes y reconnect.

## 10. Event ordering, ledgers, trace y hashes

Assertions mínimas por resolución:

- `sequence_number` estrictamente creciente y único por game;
- events de un command comparten `game_version` y correlation;
- causation enlaza scheduler → pending interaction → resume;
- recursos, AP, VP, influencia y legitimidad reconciliables;
- `AdjudicationTrace` contiene inputs, rules, output y refs de versiones;
- pre/post hash corresponden al state realmente comprometido;
- replay desde snapshot + events almacenados no consume RNG nuevo;
- ProjectedEvent conserva ID/sequence/version del canonical event aunque redacte payload.

## 11. Property/invariant tests propuestos

Además de las propiedades del oracle:

1. cualquier assignment válido conserva unicidad participant/country/clockwise;
2. cualquier permutación de delivery realtime con duplicados, preservando sequence recovery, converge a la misma proyección;
3. projection de rival no contiene valores clasificados como privados en ningún state válido generado;
4. retry/reconnect no cambia event count, ledger totals, roll count ni trace count;
5. un scheduler suspendido no cambia su next slot hasta una respuesta válida;
6. serializar/rehidratar cualquier stable state o pending state conserva hash y opciones autorizadas;
7. una secuencia de commands aceptados mantiene single-zone, no-negativos, hand<=10 y legitimacy caps;
8. incoming 2:1 conserva `generated=consumed+placed` y `consumed=2×removed`.

Property tests complementan, nunca sustituyen, los IDs nominales.

## 12. Criterios PASS/FAIL

### PASS de un PR

- 100% de IDs owner y regresiones del PR pasan;
- 100% de IDs del addendum asignados al PR pasan;
- suite M0 55/55 pasa intacta;
- 0 skips, 0 todo, 0 waivers implícitos;
- typecheck, lint, test y build verdes;
- snapshots/goldens revisados y versionados;
- no leakage en ningún viewer/boundary;
- no desviaciones no documentadas.

### FAIL del gate

Cualquiera de los siguientes bloquea aprobación:

- un expected result diferente del oracle;
- test skipped/todo o assertion reducida para acomodar código;
- ID duplicado sin `[REGRESSION]`;
- state/event/ledger/trace/projection incoherentes;
- dependencia de RNG/reloj/red/IA no determinística;
- filtrado sólo en frontend;
- implementación de scope M2/M3;
- IQ bloqueante sin resolver.

## 13. Matriz de trazabilidad M1

| Requisito M1 | Test/cobertura | PR |
|---|---|---|
| create GameSession y fijar versions | `GE-M1-SES-001`, `GE-SET-001/004` | M1-0 |
| cinco players/countries + F1 | `GE-SET-001/002/003`, `GE-M1-SES-003/005/006/007` | M1-0 |
| join/authority/spoof/cross-game | `GE-CORE-002`, `GE-M1-SES-002/003/004/008` | M1-0 |
| setup BASE_2025/decks/hands | `GE-SET-005/006/007/008/010` | M1-0 |
| query no mutante + idempotencia/CAS/double submit | `GE-CORE-003/004/010`, `GE-M1-SES-009/010`, `GE-M1-RT-006/007` | M1-0, M1-3 |
| pause overlay | `GE-CORE-006`, `GE-FAC-001` | M1-0 |
| iniciativa/rerolls determinísticos | `GE-INI-001/002/003`, `GE-M1-IPL-005` | M1-1 |
| maintenance e income | `GE-INI-004/005/006/009` | M1-1 |
| plan 0…3, AP, lock/no edit/no refund | `GE-PLAN-001/004/005`, `GE-M1-IPL-008` | M1-1 |
| order intraplayer | `GE-M1-IPL-009`, `GE-M1-ADJ-002` | M1-1/M1-2 |
| hidden plan/reveal | `GE-PLAN-003`, `GE-SEC-004`, `GE-M1-IPL-001/002/004/007` | M1-1 |
| HAND/deck/Secret VO y facilitator view | `GE-SEC-001/002/003`, `GE-M1-IPL-003/007`, `GE-M1-RT-003/004/010` | M1-1/M1-3 |
| phase/state machine | `GE-CORE-001/008`, `GE-M1-IPL-006` | M1-1 |
| scheduler y suspensión | `GE-CORE-009`, `GE-CHO-001/002`, `GE-M1-ADJ-002/004/005` | M1-2 |
| campaign construction/slot IV | `GE-CAM-001/005` | M1-2 |
| atomic cost/CV/tier y golden | `GE-CORE-005`, `GE-ERT-007`, `GE-M1-ADJ-001/007` | M1-2 |
| dado/roll/ERT | `GE-DIE-001`, `GE-ERT-016`, `GE-M1-ADJ-001` | M1-2 |
| PRE_ROLL no-play auditado | `GE-M1-ADJ-006` | M1-2 |
| 2:1/attribution choice | `GE-CUBE-004/006/007`, `GE-M1-ADJ-001/004/005/009` | M1-2 |
| VP/legitimacy | `GE-LEG-001/002/003`, `GE-M1-ADJ-001/009` | M1-2 |
| events/ledgers/trace/no silent mutation | `GE-AUD-001/006`, `GE-M1-ADJ-006/007/009` | M1-2 |
| snapshots/replay/state hashes | `GE-M1-ADJ-004/008/009`, `GE-M1-RT-008/009` | M1-2/M1-3 |
| clientes sin autoridad SYSTEM | `GE-M1-ADJ-003` | M1-2 |
| broadcast post-commit segmentado | `GE-M1-RT-001…008` | M1-3 |
| reconnect/recovery sin leakage | `GE-M1-RT-008/009/010` + `GE-SEC-001…004` regressions | M1-3 |
| LLM/AI fuera del Engine | `GE-M1-SES-004`, `GE-M1-IPL-007`, `GE-SEC-002` | M1-0/M1-1 |

## 14. Validación documental realizada

- Los **49 IDs únicos** citados del oracle existen en v0.1.
- Los **38 IDs** del addendum M1 v0.1 son únicos y canónicos.
- No hay IDs owner duplicados entre M1-0, M1-1, M1-2 y M1-3.
- Las siete repeticiones de M1-3 están marcadas `[REGRESSION]`.
- El baseline contiene **87 casos únicos** y **94 ejecuciones de gate**.
- Todos los requisitos M1 de la matriz trazan a uno o más IDs canónicos.
- `IQ-M1-001…003` están resueltas mediante `DEC-065` y el addendum.
- El inventario y la suite M0 no se modifican.

## 15. Gate pendiente

El addendum, las cinco PTD y `IQ-M1-001…003` quedan resueltos/aprobados documentalmente mediante `DEC-065`. La revisión final debe confirmar esta enmienda y emitir, si corresponde, una autorización posterior y expresa para iniciar M1-0.

Hasta esa aprobación: **M1 IMPLEMENTATION NOT AUTHORIZED**.
