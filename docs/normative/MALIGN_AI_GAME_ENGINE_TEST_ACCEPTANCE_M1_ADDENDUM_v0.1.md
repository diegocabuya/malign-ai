# MALIGN-AI — GAME ENGINE TEST & ACCEPTANCE M1 ADDENDUM v0.1

**Fecha:** 2026-08-23  
**Estado:** APPROVED CANONICAL M1 BASELINE v0.1  
**Autoridad:** `DEC-065`  
**Documento complementado:** `MALIGN_AI_GAME_ENGINE_TEST_ACCEPTANCE_SPEC_v0.1.md`  
**Implementación M1:** **NOT AUTHORIZED**

> Este addendum preserva intacto el oracle v0.1 y asigna IDs canónicos a las 38 obligaciones complementarias aprobadas para el gate M1. Esta versión es inmutable: cualquier modificación futura de un ID, Given/When/Then, fixture o expected result requiere una nueva versión del addendum. No se reescribe ni se reemplaza ningún caso `GE-*` del oracle v0.1.

## 1. Alcance y reglas comunes

Los 38 casos de este addendum:

- complementan, pero no sustituyen, los 49 IDs únicos del oracle v0.1 asignados a M1;
- conservan el Given/When/Then aprobado en `MALIGN_AI_M1_TEST_GATE_v0.1.md`;
- usan las versiones y fixtures exactos de las secciones 7.1…7.5 de ese Test Gate;
- fijan `ruleset_version`, `scenario_version`, `card_registry_version`, `engine_contract_version` y `fixture_schema_version`;
- usan `RandomProvider` y `Clock` determinísticos, sin red, DB, UI, auth productiva o IA;
- validan expected state, `game_version`, event order, ledgers, `AdjudicationTrace`, proyecciones y invariantes cuando la categoría sea aplicable;
- exigen que todo rechazo deje state/version/events/ledgers/trace/broadcast sin mutación normativa;
- exigen filtrado server-side antes de UI, realtime o AI context;
- se ejecutan con 0 skips y 0 todo.

Reglas transversales para expected artifacts:

| Artefacto | Assertion común |
|---|---|
| State | post-state exacto, invariantes globales y single-zone preservados |
| Version | rechazo/query/retry no incrementa; un commit estable incrementa exactamente una vez |
| Events | IDs y `sequence_number` exactos, monotónicos y contiguos dentro del commit cuando corresponda |
| Ledgers | AP/resources/VP/influence/legitimacy reconciliables; ningún saldo negativo |
| Trace | refs de versiones, pre/post hash, inputs/rules/output y decisiones auditadas cuando exista adjudicación |
| Projections | owner/rival/facilitator reciben únicamente campos autorizados; negative assertions obligatorias |
| Realtime | sólo artifacts post-commit; no raw `CommandResult` rival ni payload secreto |

## 2. M1-0 — Session/setup — 10 casos

| ID | Given | When | Then / expected result | Assertions adicionales aplicables |
|---|---|---|---|---|
| `GE-M1-SES-001` | F1 autenticado y versions válidas | `CREATE_GAME` | estado `SETUP`, facilitator único y versions/turn-limit del command fijados | `GAME_CREATED`; version/event exactos; projection F1 autorizada; ningún default de turn limit |
| `GE-M1-SES-002` | Caller `PLAYER` | intenta `CREATE_GAME` o `ASSIGN_PLAYER_SEAT` | rechazo seguro, cero state/event/version | error sin leakage; cero ledger/trace/broadcast |
| `GE-M1-SES-003` | Membership autenticada P1 | join se materializa | `GameParticipant` activo enlazado a la sesión, sin autoridad derivada de payload | membership y projection P1/F1 exactas; rival sólo ve datos públicos permitidos |
| `GE-M1-SES-004` | Actor autenticado A y payload que suplanta participant/country B | command | application boundary ignora/rechaza el spoof antes del Engine | cero mutación; error seguro; logs sin secretos |
| `GE-M1-SES-005` | P1 ya seated | segundo seat para P1 | rechazo atómico | seats/state/version/events intactos; unicidad participant preservada |
| `GE-M1-SES-006` | ARDEN ya asignado | segundo participante solicita ARDEN | rechazo atómico | state/version/events intactos; unicidad country preservada |
| `GE-M1-SES-007` | `seat_index` o `clockwise_index` duplicado | assignment | rechazo sin alterar seats existentes | unicidad de ambos índices; cero ledger/trace/broadcast |
| `GE-M1-SES-008` | Actor/member de juego G1 | usa envelope de G2 | `GAME_ID_MISMATCH`/`NOT_AUTHORIZED` seguro | ambos juegos intactos; ningún dato de G2 filtrado |
| `GE-M1-SES-009` | Version N | cualquier query M1-0 | state/version/events/idempotency permanecen idénticos | projection autorizada exacta; cero event/ledger/trace/broadcast mutante |
| `GE-M1-SES-010` | Retry exacto de create/seat/setup command | se reenvía | mismo result/ref, sin duplicar participante, seat ni evento | mismo game version; mismo fingerprint/result; cero duplicación |

## 3. M1-1 — Initiative/planning/projections — 9 casos

| ID | Given | When | Then / expected result | Assertions adicionales aplicables |
|---|---|---|---|---|
| `GE-M1-IPL-001` | Draft autoritativo de P1 y version N | P1 solicita owner projection | contiene exactamente sus slots privados y no incrementa version | query sin events/ledgers/trace; clasificación owner respetada |
| `GE-M1-IPL-002` | Dos drafts P1 que sólo difieren en card IDs, target o DT secretos | P2 solicita rival projection | las proyecciones rivales son equivalentes salvo status/conteo permitido | ningún secreto aparece en payload, error, log o hash público |
| `GE-M1-IPL-003` | Cinco planes draft/locked y deck order técnico | F1 solicita facilitator projection | contiene payload completo de los cinco planes y no expone future deck order | query no mutante; clasificación `SYSTEM_ONLY` preservada |
| `GE-M1-IPL-004` | Plan locked con slots futuros | scheduler inicia un slot | `ACTION_REVEALED` se emite al iniciar ese slot, nunca al lock global ni para slots futuros | event order exacto; rival recibe sólo campos públicos del slot revelado |
| `GE-M1-IPL-005` | Secuencia determinística de seats/attempts | resolver RNG de initiative/shuffle hasta consumirla o invalidarla | `RandomProvider` consume exactamente la secuencia; exhaustion/out-of-range falla sin fallback | rolls/requests auditados; rechazo/fallo no usa entropía real |
| `GE-M1-IPL-006` | Cuatro players locked y quinto plan válido | quinto `LOCK_ACTION_PLAN` | una única transición a `ACTION_STAGE_LOCKED/RESOLUTION_STAGE`, un version increment y events contiguos | readiness de cinco players exacto; retry no repite transición |
| `GE-M1-IPL-007` | Cualquier state válido generado con campos clasificados | serializar rival projection | no contiene valores `OWNER_ONLY`, `OWNER_AND_FACILITATOR` o `SYSTEM_ONLY` | property test sobre state/projection; F1/owner positives correspondientes |
| `GE-M1-IPL-008` | Plan válido de N slots y un fallo posterior del slice | lock y posterior resolución fallida | consume exactamente 1 AP por slot y no reembolsa AP comprometido | AP ledger reconciliado; fallo posterior sin pago parcial no-AP |
| `GE-M1-IPL-009` | Plan M1 `[CONSTRUCT_CAMPAIGN, ACTIVATE_CAMPAIGN]` | lock y scheduler lee el plan | conserva `sequence_index` 1→2 | ningún Action Card, Regime Ability o Veto requerido; reveal/event order exacto |

## 4. M1-2 — Adjudication/audit — 9 casos

| ID | Given | When | Then / expected result | Assertions adicionales aplicables |
|---|---|---|---|---|
| `GE-M1-ADJ-001` | Golden exacto de Implementation Spec §10 y Test Gate §7.4 | P1 construye y activa campaña HIGH MALIGN | base/effective CV12, cost3, raw7, ERT+3, 2:1→1 placed, legitimacy Arden, VP+2 y resources1 | state/events/ledgers/trace/projections/hashes exactos |
| `GE-M1-ADJ-002` | Cinco planes locked con initiative y `sequence_index` conocidos | scheduler resuelve | ordena por `initiative_position` y luego `sequence_index` | reveal/resolution event order exacto; ningún cliente elige el siguiente slot |
| `GE-M1-ADJ-003` | Cliente autenticado sin autoridad SYSTEM | intenta `RESOLVE_NEXT_ACTION_SLOT` o mutación directa de cube/VP/resource | rechazo en authority boundary | cero state/version/event/ledger/trace/broadcast |
| `GE-M1-ADJ-004` | `PendingResolution` de elección 2:1 | serializar y rehidratar en Engine instance nuevo | actor, options y cursor se conservan exactamente | mismo state hash; options sólo para actor/F1; sin closure viva |
| `GE-M1-ADJ-005` | Pending choice vigente y luego respuestas valid/late/double | responder y reintentar | respuesta válida reanuda una vez; late/double no duplica efectos | una sola continuation, event, ledger, trace y version commit |
| `GE-M1-ADJ-006` | Full campaign golden | resolver activation | orden: started → narrative → pre-roll open/evaluate/close → cost → die → ERT → cancellation → placement → legitimacy → VP → completed | `sequence_number` y causation exactos; sin silent mutation |
| `GE-M1-ADJ-007` | Activación con múltiples events/ledgers/trace | commit | `game_version` incrementa exactamente una vez y usa sequences contiguas | todos los artifacts comparten refs/correlation correctos |
| `GE-M1-ADJ-008` | State estable y una variante con un campo autoritativo cambiado | serializar con RFC 8785/JCS y hashear SHA-256 | misma state produce hash estable; cambio autoritativo cambia hash | snapshot/replay y trace usan el mismo contrato de canonicalization |
| `GE-M1-ADJ-009` | Secuencias válidas generadas del slice | aplicar commands/replay | no negativos, single-zone, conservation 2:1, hand<=10, legitimacy caps, events monotónicos y ledgers reconciliados | property integrada; state hash/replay/projections válidos |

## 5. M1-3 — Realtime/reconnect — 10 casos

| ID | Given | When | Then / expected result | Assertions adicionales aplicables |
|---|---|---|---|---|
| `GE-M1-RT-001` | Viewer autorizado solicita initial projection mientras puede ocurrir un commit | fetch projection/cursor y subscribe | initial sync race-free no pierde el commit entre operaciones | latest projection + feed desde cursor convergen al mismo state/version |
| `GE-M1-RT-002` | Commit con cambio público | construir broadcasts por viewer | payload público es semánticamente consistente para todos los viewers autorizados | IDs/sequence/version conservados; campos privados varían sólo por autorización |
| `GE-M1-RT-003` | Canonical event privado del owner | proyectar/publicar | evento privado sólo llega a owner y facilitator con payload permitido | rival no recibe evento ni side channel; future deck order ausente |
| `GE-M1-RT-004` | F1 solicita stream/audit normal | proyectar/publicar | facilitator recibe variante completa auditada sin future deck order normal | acceso no mutante; `SYSTEM_ONLY` preservado |
| `GE-M1-RT-005` | Actor recibe raw `CommandResult` autorizado | publicar resultado del commit a otros viewers | raw `CommandResult` nunca llega a rivales | sólo `ProjectedEvent`/cursor filtrado; IDs secretos ausentes |
| `GE-M1-RT-006` | Command rechazado o transacción revertida | realtime adapter procesa outcome | no publica domain event ni projection delta mutante | state/version/event sequence/ledgers/trace intactos |
| `GE-M1-RT-007` | Consumidor recibe dos veces mismo `event_id/sequence_number` | aplica delivery | mutación se aplica una vez y el duplicado se deduplica | projection final/hash igual a entrega única |
| `GE-M1-RT-008` | Cliente detecta gap de sequence | recupera `GET_EVENT_FEED(after_sequence_number)` | feed recuperado converge con latest projection | ordering autoritativo por sequence; ningún secreto fuera del viewer |
| `GE-M1-RT-009` | Actor autorizado se reconecta con pending interaction | autenticar, fetch latest y subscribe desde cursor | restaura projection, cursor y `PendingResolution` sólo para actor designado | state/version/hash exactos; no auto-pass/timeout |
| `GE-M1-RT-010` | Rival se reconecta al mismo checkpoint | comparar con rival projection normal | conserva redacciones de HAND, face-down plans, Secret VO y private choice options | ausencia también en feed, errors y payload realtime |

## 6. Conteo canónico

| Grupo | IDs |
|---|---:|
| `GE-M1-SES-*` | 10 |
| `GE-M1-IPL-*` | 9 |
| `GE-M1-ADJ-*` | 9 |
| `GE-M1-RT-*` | 10 |
| **Total addendum M1 v0.1** | **38 únicos** |

Los IDs son canónicos, únicos y quedan asignados a M1-0…M1-3 según las secciones anteriores. `DEC-065` aprueba este baseline documental, pero **no autoriza implementar M1 ni M1-0**.
