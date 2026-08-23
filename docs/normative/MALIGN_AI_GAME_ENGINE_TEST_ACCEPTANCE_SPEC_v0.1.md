
# MALIGN-AI — GAME ENGINE TEST & ACCEPTANCE SPECIFICATION v0.1

**Fecha:** 2026-08-22  
**Fase:** FASE 2 — diseño verificable del Game Engine / Adjudication Engine  
**Estado:** DRAFT BASELINE / ORÁCULO PREVIO A IMPLEMENTACIÓN  
**Código:** NO iniciado  
**Predecesores:** `MALIGN_AI_ADJUDICATION_ENGINE_SPEC_v0.1.md`, `MALIGN_AI_DATA_DICTIONARY_ER_SPEC_v0.1.md`, `MALIGN_AI_RULE_EFFECT_TAXONOMY_v0.2.md`, `DECISIONS.md`, `MALIGN_AI_INFORMATION_SECURITY_MATRIX_v0.1.md`

> Este documento convierte el contrato funcional del Adjudication Engine en un conjunto verificable de pruebas de aceptación. Su propósito es impedir que la implementación “interprete” silenciosamente las reglas. El test oracle es determinista: mismos estado inicial, ruleset, elecciones, dados y decisiones del facilitador deben producir exactamente el mismo estado final, eventos, ledgers, traza y proyecciones de visibilidad.

---

# 1. Objetivo de aceptación

El futuro Game Engine sólo podrá considerarse conforme si supera simultáneamente:

1. pruebas funcionales de reglas;
2. pruebas de invariantes;
3. pruebas de seguridad/visibilidad;
4. pruebas de idempotencia y concurrencia;
5. pruebas de auditabilidad/replay;
6. pruebas de cada Action/Reaction/Starter Card con efecto especial;
7. pruebas de Victory Objectives del escenario base;
8. pruebas de decisiones aprobadas que cierran ambigüedades del Gamebook.

La ausencia de una implementación concreta no impide definir ahora el resultado esperado.

---

# 2. Jerarquía del oráculo

Los expected results de esta especificación siguen la misma precedencia del Adjudication Engine:

```text
Gamebook / regla oficial
→ texto impreso de carta/componente
→ ScenarioRuleConfig fijado para la partida
→ DECISIONS.md aprobado
→ Card Registry / Rule Effect Taxonomy
→ FacilitatorDecision explícita y auditada
```

Si una futura implementación discrepa con este documento porque una regla o decisión fue modificada, primero debe versionarse el ruleset y actualizarse el test correspondiente. **Nunca se cambia el test únicamente para hacer pasar el código.**

---

# 3. Niveles de prueba

| Nivel | Propósito |
|---|---|
| `RULE_UNIT` | Función pura o regla local: CV, tier, ERT, 2:1, objective predicate. |
| `COMMAND` | Validación de un command contra estado/fase/permisos. |
| `ENGINE_INTEGRATION` | Flujo completo de una acción con state mutations, eventos y trace. |
| `TURN_INTEGRATION` | Interacciones entre jugadores/fases dentro del mismo turno. |
| `GAME_INTEGRATION` | Setup → turnos → scoring → cierre. |
| `SECURITY` | Proyección autorizada y ausencia de filtraciones. |
| `AUDIT_REPLAY` | Reproducción exacta de eventos/trazas/ledgers. |
| `CONCURRENCY` | optimistic concurrency, idempotencia y suspensión/resume. |

---

# 4. Formato obligatorio de cada test

Todo caso debe poder expresarse como:

```text
Given
  fixture versionado + ruleset/scenario/card-registry versions
  estado autoritativo exacto
  inputs RNG/manuales predeterminados
  elecciones humanas predeterminadas
When
  command(s) exactos
Then
  resultado exacto del command
  post-state exacto
  eventos exactos relevantes y en orden
  ledgers exactos
  AdjudicationTrace exacta en los campos normativos
  proyecciones públicas/privadas esperadas
  invariantes preservadas
```

Los tests no dependen de texto generado por IA. Cuando una decisión humana sea necesaria, se inyecta como fixture/input.

---

# 5. Fixtures canónicos

## 5.1 Participantes

```text
P1 = Arden
P2 = Fluma
P3 = Ursaria
P4 = Presque
P5 = Dinesia
F1 = Facilitator
```

Los asientos físicos/circulares se fijan en ese orden para fixtures de iniciativa salvo que el test indique lo contrario.

## 5.2 Identificadores de PD

Los tests usan IDs internos semánticos, nunca dependen del número gráfico impreso:

```text
ARDEN_PD_1 / ARDEN_PD_2 / ARDEN_PD_3
FLUMA_PD_1 / FLUMA_PD_2
URSARIA_PD_1 / URSARIA_PD_2 / URSARIA_PD_3
PRESQUE_PD_1 / PRESQUE_PD_2 / PRESQUE_PD_3
DINESIA_PD_1 / DINESIA_PD_2 / DINESIA_PD_3
```

El fixture del escenario mantiene por separado cualquier `printed_board_label` y `scenario_reference_label`.

## 5.3 Estado mínimo limpio

`FX-CLEAN-T1-ACTION`:

- turn 1;
- initiative order P1→P2→P3→P4→P5;
- todos con 3 AP;
- recursos suficientes salvo override por test;
- manos <=10;
- no campañas salvo indicación;
- no legitimacy salvo indicación;
- VP = 0 salvo indicación;
- no ventanas de reacción abiertas;
- `game_version=N` conocido.

## 5.4 Campañas canónicas

```text
C_LOW_MALIGN:
  Intent IV1 MALIGN + Method IV2 MALIGN = base_cv 3 => LOW cost 1

C_MEDIUM_MALIGN:
  Intent IV1 + Method IV6 = base_cv 7 => MEDIUM cost 2

C_HIGH_MALIGN:
  Intent IV1 + Method IV6 + Amplifier IV5 = base_cv 12 => HIGH cost 3

C_MEDIUM_RESILIENCY:
  compatible RESILIENCY cards, base_cv 8 => MEDIUM cost 2
```

Todos los fixtures especifican `target_dt` y PDs compatibles de manera explícita.

## 5.5 RNG controlado

El Dice Service y shuffle service deben aceptar un test adapter determinista. No se mockea el resultado final; se inyecta la secuencia de entropía/rolls esperada y se valida que el engine la consuma en el orden correcto.

---

# 6. Reglas generales del oracle

1. `REJECTED` antes de lock no muta estado ni consume AP/recursos/cartas.
2. AP planificado se consume al lock, incluso si el efecto posterior queda negado o invalidado conforme a las decisiones aprobadas.
3. Costes no-AP se pagan en su ventana de resolución, nunca por anticipado salvo texto explícito.
4. Resources y VP nunca son negativos.
5. HAND estable nunca supera 10.
6. Una CardInstance sólo existe en una zona autoritativa.
7. Todos los cambios de Resources/VP tienen ledger entries.
8. Toda tirada tiene DieRoll persistido.
9. Toda campaña resuelta tiene AdjudicationTrace.
10. Toda información privada se verifica con negative assertions: el rival **no** recibe campos no autorizados.

---

# 7. Gates de aceptación

## Gate A — Rule Kernel

Debe pasar el 100% de `RULE_UNIT`, incluyendo ERT, CV, 2:1, legitimacy, scoring y objectives.

## Gate B — Command Safety

Debe pasar el 100% de validación, idempotencia, atomicidad y optimistic concurrency.

## Gate C — Full Turn

Debe reproducir un turno completo de cinco jugadores sin divergencia entre estado, eventos y trace.

## Gate D — Scenario Base

Cada Victory Objective debe superar tests positivos, negativos y boundary.

## Gate E — Privacy

Cero filtraciones de HAND, Secret VO, deck order, face-down actions o TemporaryReveal.

## Gate F — Replay

Replay desde snapshot inicial + event log debe reconstruir el mismo state hash final.

**Criterio recomendado previo a liberar Game Engine MVP:** 100% de casos `BLOCKER/P0`; 100% de invariantes; 100% de seguridad; 100% de objectives; cero test skipped sin waiver aprobado.

---

# 8.1 A. Core, commands, concurrencia y máquina de estados

| ID | Pri. | Nivel | Caso | Given | When | Then |
|---|---|---|---|---|---|---|
| `GE-CORE-001` | P0 | `COMMAND` | **Wrong phase rejected** | Game en INITIATIVE; command CONSTRUCT_CAMPAIGN de P1. | P1 envía command con expected version actual. | REJECTED WRONG_PHASE; cero mutaciones; version sin cambio. |
| `GE-CORE-002` | P0 | `COMMAND` | **Unauthorized actor rejected** | P1 intenta mover carta controlada por P2. | P1 envía command válido de forma sintáctica. | REJECTED NOT_AUTHORIZED/CARD_NOT_CONTROLLED; carta permanece con P2. |
| `GE-CORE-003` | P0 | `CONCURRENCY` | **Stale version rejected** | game_version=20. | Command expected_game_version=19. | REJECTED STALE_STATE_VERSION; no events de dominio de juego. |
| `GE-CORE-004` | P0 | `CONCURRENCY` | **Idempotent retry** | Command X ya RESOLVED con idempotency_key K. | Se reenvía exactamente K. | Devuelve resultado previo; no duplica mutation/event/ledger; game_version no incrementa otra vez. |
| `GE-CORE-005` | P0 | `ENGINE_INTEGRATION` | **Atomic cost failure** | Action requiere 3 Resources; actor tiene 2 al llegar a resolución. | Se resuelve action ya planificada. | FAILED_COST/INVALIDATED según action; no pago parcial; saldo sigue 2; AP ya comprometido permanece gastado. |
| `GE-CORE-006` | P0 | `COMMAND` | **Paused blocks gameplay** | Game overlay PAUSED. | Jugador envía command de juego. | REJECTED GAME_PAUSED; Facilitator commands administrativos siguen permitidos. |
| `GE-CORE-007` | P0 | `TURN_INTEGRATION` | **State machine legal progression** | Partida válida en STRATEGY_STAGE. | Se completan locks/resolution/cleanup con inputs válidos. | Sólo transiciones legales; después de turno no final vuelve a INITIATIVE_STAGE. |
| `GE-CORE-008` | P0 | `COMMAND` | **Illegal state transition rejected** | Game en ACTION_STAGE_PLAN. | Command intenta END_GAME_SCORING directo. | REJECTED; estado de fase intacto. |
| `GE-CORE-009` | P0 | `ENGINE_INTEGRATION` | **Suspension preserves scheduler** | P1 action abre ChoiceRequest. | P2 intenta forzar resolución normal antes de choice. | Scheduler no avanza; action/turn permanece suspendido hasta input autorizado. |
| `GE-CORE-010` | P0 | `CONCURRENCY` | **Double submit from two clients** | Mismo jugador envía dos locks concurrentes con misma expected version y distintas payloads. | Ambos llegan casi simultáneamente. | Sólo uno puede commit; el segundo falla STALE_STATE_VERSION o equivalente; no mezcla planes. |
| `GE-CORE-011` | P1 | `COMMAND` | **Unknown target object invalidated** | Target fue eliminado por acción previa antes de resolver. | Llega slot que lo referenciaba. | OBJECT_NO_LONGER_VALID/TARGET_NO_LONGER_EXISTS; semántica DEC-040; sin mutación parcial. |
| `GE-CORE-012` | P0 | `RULE_UNIT` | **Global numeric invariants** | Estado arbitrario válido. | Aplicar cualquier reducer autorizado. | AP/resources/VP/cubes no negativos; hand<=10; single-zone card invariant preservado. |

# 8.2 B. Setup y Strategy

| ID | Pri. | Nivel | Caso | Given | When | Then |
|---|---|---|---|---|---|---|
| `GE-SET-001` | P0 | `ENGINE_INTEGRATION` | **Valid base setup accepted** | 5 países, 5 jugadores, 1 facilitador, 14 PD internas, turn_limit>=1, 108 card instances por país, 5 Starter separadas. | START_GAME. | GAME_STARTED; estado entra STRATEGY_STAGE; versiones de ruleset/scenario/registry fijadas. |
| `GE-SET-002` | P0 | `COMMAND` | **Missing facilitator blocks start** | Setup completo salvo facilitador. | START_GAME. | REJECTED setup invalid; no GAME_STARTED. |
| `GE-SET-003` | P0 | `COMMAND` | **Wrong country count blocks start** | 4 o 6 países activos en MVP. | START_GAME. | REJECTED setup invalid. |
| `GE-SET-004` | P0 | `COMMAND` | **Turn limit required** | turn_limit nulo/0. | START_GAME. | REJECTED; turn_limit debe ser >=1. |
| `GE-SET-005` | P0 | `COMMAND` | **Operations Deck exactly 30** | Jugador selecciona 29 o 31 non-Starter. | LOCK_STRATEGY. | REJECTED; no shuffle/move parcial. |
| `GE-SET-006` | P0 | `COMMAND` | **Starter cannot enter operations deck** | Selección de 30 incluye una Starter. | LOCK_STRATEGY. | REJECTED CARD_NOT_ELIGIBLE. |
| `GE-SET-007` | P0 | `ENGINE_INTEGRATION` | **Valid 30-card deck shuffled** | 30 instancias únicas del pool de 103. | LOCK_STRATEGY con RNG fijo. | 30 pasan a OPERATIONS_DECK en orden determinista auditado; resto queda inactive pool. |
| `GE-SET-008` | P0 | `ENGINE_INTEGRATION` | **Initial hand = five starters + five draws** | Deck construido; 5 Starter separadas. | Resolver mano inicial con cinco draws normales. | HAND=10; 5 Starter + 5 non-Starter; cinco CARD_DRAWN; ninguna Starter en deck. |
| `GE-SET-009` | P0 | `ENGINE_INTEGRATION` | **Protocolos during initial draw** | Protocolos ya en HAND por fixture permitido; siguiente draw es Filtraciones. | CARD_DRAW de Filtraciones. | Protocolos y Filtraciones a DISCARD; Filtraciones no entra a HAND; draw cuenta; events en orden. |
| `GE-SET-010` | P1 | `COMMAND` | **Duplicate CardInstance selection rejected** | Mismo instance_id aparece dos veces en selección. | LOCK_STRATEGY. | REJECTED; unicidad de instancias preservada. |

# 8.3 C. Initiative y maintenance

| ID | Pri. | Nivel | Caso | Given | When | Then |
|---|---|---|---|---|---|---|
| `GE-INI-001` | P0 | `TURN_INTEGRATION` | **Unique highest initiative** | Rolls P1=8,P2=4,P3=10,P4=9,P5=2. | Resolver iniciativa. | P3 primero; resto continúa clockwise desde P3; INITIATIVE_ORDER_SET exacto. |
| `GE-INI-002` | P0 | `TURN_INTEGRATION` | **Tie highest reroll only tied** | P1=10,P2=10,P3=9,P4=3,P5=2; reroll P1=4,P2=7. | Resolver. | Sólo P1/P2 reroll; P2 ganador; rolls auditados. |
| `GE-INI-003` | P0 | `TURN_INTEGRATION` | **Multiple reroll ties** | Primera y segunda ronda empatan entre mismos tied-highest; tercera produce ganador. | Resolver. | Continúa hasta unique winner; no reroll de no empatados. |
| `GE-INI-004` | P0 | `ENGINE_INTEGRATION` | **Discard any subset then fill-to-10** | P1 HAND=8, descarta 3, target hand size 10. | Maintenance P1. | HAND final 10 tras 5 draws; destinos especiales respetados; ingreso aplicado. |
| `GE-INI-005` | P0 | `ENGINE_INTEGRATION` | **Deck exhaustion plus reshuffle** | Deck tiene 2 cartas; discard reciclable tiene >=4; HAND requiere 5 draws. | Fill-to-10. | Roba 2, DECK_RESHUFFLED una vez, continúa con 3; orden RNG determinista. |
| `GE-INI-006` | P0 | `ENGINE_INTEGRATION` | **No cards left stops fill** | Deck vacío y discard sin cartas reciclables. | Jugador intenta completar mano. | Roba lo disponible=0; no error; ingreso sí se recibe. |
| `GE-INI-007` | P0 | `ENGINE_INTEGRATION` | **Protocolos replacement in fill-to-N** | HAND=8, quiere 10; primer draw Filtraciones dispara Protocolos, segundo y tercero normales. | Maintenance. | Draw cancelado cuenta como evento, pero fill-to-N continúa hasta HAND=10 si hay cartas. |
| `GE-INI-008` | P0 | `ENGINE_INTEGRATION` | **Protocolos in draw-exactly-N** | Action Robar hace 3 draws; uno es Filtraciones cancelada por Protocolos. | Resolver 3 draw events. | Sólo se consumen 3 eventos; no cuarto draw compensatorio; hand refleja dos cartas netas normales. |
| `GE-INI-009` | P0 | `RULE_UNIT` | **Income exact by country** | Fixture base sin otros ingresos. | Aplicar turn income. | Arden+2,Fluma+1,Ursaria+2,Presque+2,Dinesia+3 ledger INCOME. |
| `GE-INI-010` | P1 | `ENGINE_INTEGRATION` | **Discarded stolen card returns owner** | P1 controla carta stolen de P2 con return flag. | P1 la descarta en maintenance. | No va al discard P1; vuelve a control de P2 según lifecycle; provenance intacta. |

# 8.4 D. Action planning, Starter y negociación

| ID | Pri. | Nivel | Caso | Given | When | Then |
|---|---|---|---|---|---|---|
| `GE-PLAN-001` | P0 | `COMMAND` | **Maximum three AP actions** | P1 sin efectos extra. | Intenta lockear 4 acciones de 1 AP. | REJECTED INSUFFICIENT_AP; no lock. |
| `GE-PLAN-002` | P0 | `ENGINE_INTEGRATION` | **Explicit intraplayer order preserved** | P1 plan [ActionCard, Activate, Regime]. | Lock y resolver. | Scheduler ejecuta exactamente sequence_index 1→2→3. |
| `GE-PLAN-003` | P0 | `SECURITY` | **Locked plan hidden from rivals** | P1 lock con payload de cartas/targets. | P2 solicita game projection antes de reveal. | P2 ve locked/pass status permitido, no payload, card IDs, target ni DT. |
| `GE-PLAN-004` | P0 | `ENGINE_INTEGRATION` | **AP consumed at lock** | P1 lockea 3 acciones y luego primera es vetada. | Resolver turno. | AP_available=0; no refund por Veto. |
| `GE-PLAN-005` | P0 | `COMMAND` | **No edit after lock** | P1 ya locked. | P1 intenta cambiar slot 2. | REJECTED; sólo Facilitator override podría alterar, dejando audit trail. |
| `GE-PLAN-006` | P0 | `ENGINE_INTEGRATION` | **Increased Budget free Starter** | P1 HAND contiene Presupuesto Aumentado. | Juega durante STARTER_FREE_PLAY. | +4 Resources; Starter REMOVED_FROM_GAME; 0 AP; events STARTER_PLAYED/RESOURCE_GAINED/STARTER_REMOVED. |
| `GE-PLAN-007` | P0 | `ENGINE_INTEGRATION` | **Priority Policy search two** | Deck contiene cards A/B conocidas; HAND=7. | Starter busca A/B. | A/B a HAND; deck restante shuffled; Starter removed; hand<=10. |
| `GE-PLAN-008` | P0 | `ENGINE_INTEGRATION` | **Priority Policy hand-limit choice** | HAND=9 y se seleccionan 2 del deck. | Resolver. | Choice de descarte/selección evita estado estable >10; deck shuffle correcto. |
| `GE-PLAN-009` | P0 | `ENGINE_INTEGRATION` | **Policy Pivot full reset** | HAND contiene Giro + normal cards + otra Starter + stolen-return card. | Juega Giro. | Normales→discard propio; Starter propia→removed; stolen→owner; own deck+eligible discard shuffled; draw hasta 10; Giro removed. |
| `GE-PLAN-010` | P0 | `ENGINE_INTEGRATION` | **Wild Intent lifecycle in campaign** | Intención Libre en HAND. | Construye campaña con Starter Intent; luego campaña es descartada. | Starter permanece en campaña mientras existe; al abandonar mat pasa REMOVED_FROM_GAME. |
| `GE-PLAN-011` | P0 | `ENGINE_INTEGRATION` | **Deal promise non-binding** | P1 promete 2 Resources a P2 sin confirmación de transferencia. | Registrar DEAL_PROMISE. | No saldo cambia; promesa auditada si modelo la conserva. |
| `GE-PLAN-012` | P0 | `ENGINE_INTEGRATION` | **Confirmed resource deal** | P1 tiene 3 y confirma transferir 2 a P2. | Ejecutar transferencia. | P1-2/P2+2; ledger DEAL_TRANSFER; no saldo negativo. |
| `GE-PLAN-013` | P0 | `COMMAND` | **Cannot negotiate committed card** | Carta está en PLANNED_ACTION. | P1 intenta transferirla a P2. | REJECTED CARD_WRONG_ZONE/CARD_NOT_ELIGIBLE. |
| `GE-PLAN-014` | P0 | `ENGINE_INTEGRATION` | **Negotiated card keeps ownership provenance** | P1 transfiere carta propia A a P2 por acuerdo. | Confirmación mutua/transferidor. | current_controller=P2; owner=P1; no return_on_discard por defecto; hand limit P2. |

# 8.5 E. Campañas: build, modify, lifecycle

| ID | Pri. | Nivel | Caso | Given | When | Then |
|---|---|---|---|---|---|---|
| `GE-CAM-001` | P0 | `ENGINE_INTEGRATION` | **Build Intent+Method valid** | Row I libre; compatible Intent+Method; DT válido. | Resolver CONSTRUCT_CAMPAIGN. | CAMPAIGN_CREATED en Row I; 2 cartas asignadas; Amplifier vacío permitido. |
| `GE-CAM-002` | P0 | `COMMAND` | **Build without Method invalid** | Intent solamente. | Resolver build. | CAMPAIGN_INVALID_STRUCTURE; cards no se consumen si mutación no ejecutó; AP ya comprometido si post-lock. |
| `GE-CAM-003` | P0 | `COMMAND` | **Alignment mismatch invalid** | Intent MALIGN + Method RESILIENCY-only. | Resolver build. | CAMPAIGN_ALIGNMENT_MISMATCH; sin campaign. |
| `GE-CAM-004` | P0 | `COMMAND` | **Row I occupied** | Row I ya contiene campaña. | Resolver segundo build planificado. | CAMPAIGN_ROW_OCCUPIED; nueva cards permanecen/retornan según DEC-040; no campaign extra. |
| `GE-CAM-005` | P0 | `ENGINE_INTEGRATION` | **Multi-slot card uses selected slot** | Carta apta Method/Amplifier con IV distintos. | Se coloca como Method. | CampaignSlot=METHOD; cálculo futuro usa IV Method, nunca Amplifier. |
| `GE-CAM-006` | P0 | `ENGINE_INTEGRATION` | **Modify Row I Method** | Campaña Row I con Method M1; HAND M2 compatible. | MODIFY Method M1→M2. | M1 a discard; M2 asignada; campaign modified. |
| `GE-CAM-007` | P0 | `ENGINE_INTEGRATION` | **Modify Row II allowed** | Campaña válida en Row II. | Replace Amplifier. | Modificación aceptada; Row II sigue activa hasta Cleanup. |
| `GE-CAM-008` | P0 | `ENGINE_INTEGRATION` | **Fill empty Amplifier** | Campaña Intent+Method sin Amp. | MODIFY con Amplifier compatible. | Amp asignado; no carta reemplazada/discard adicional. |
| `GE-CAM-009` | P0 | `COMMAND` | **Cannot modify Intent** | Campaña existente. | MODIFY intenta reemplazar Intent. | REJECTED INVALID_SLOT. |
| `GE-CAM-010` | P0 | `COMMAND` | **Cannot delete without substitute** | Campaña con Amplifier. | MODIFY intenta quitarlo sin carta. | REJECTED; campaign intacta. |
| `GE-CAM-011` | P0 | `TURN_INTEGRATION` | **Cleanup Row I ages to II** | Campaña Row I sobrevive Resolution. | Cleanup aging. | CAMPAIGN_AGED; Row II ocupada; Row I libre. |
| `GE-CAM-012` | P0 | `TURN_INTEGRATION` | **Cleanup Row II discards whole campaign** | Campaña Row II con 3 cards normales. | Cleanup aging. | Campaign discarded; cards a destinos de lifecycle; row II libre. |
| `GE-CAM-013` | P0 | `ENGINE_INTEGRATION` | **Whole campaign discard handles Wild Intent** | Campaña incluye Intención Libre Starter. | Medidas Activas descarta campaña. | Starter→REMOVED_FROM_GAME; otras own cards→discard normal. |
| `GE-CAM-014` | P0 | `ENGINE_INTEGRATION` | **Stolen card lifecycle in discarded campaign** | Campaña controla carta stolen con return flag. | Campaign discard. | Stolen instance vuelve owner, no discard del controlador. |

# 8.6 F. Action Cards

| ID | Pri. | Nivel | Caso | Given | When | Then |
|---|---|---|---|---|---|---|
| `GE-ACT-001` | P0 | `ENGINE_INTEGRATION` | **Trade Agreements** | P1/P2 activos. | P1 juega Acuerdos Comerciales target P2. | P1+2,P2+2 Resources; no consentimiento; card a discard. |
| `GE-ACT-002` | P0 | `ENGINE_INTEGRATION` | **Double Agent no reaction** | P1 paga 1; P2 HAND=7; no Contrainteligencia. | Agente Doble target P2; P1 elige 5. | TemporaryReveal sólo P1/F1; hasta 5 descartadas con lifecycle; reveal cerrado; coste no reembolsado. |
| `GE-ACT-003` | P0 | `ENGINE_INTEGRATION` | **Double Agent hand <=5 discards all** | P2 HAND=4. | Agente Doble sin reacción. | Las 4 son seleccionables/descartadas; no exige 5 inexistentes. |
| `GE-ACT-004` | P0 | `ENGINE_INTEGRATION` | **Discard action recovers one** | P1 HAND≥2 y discard propio tiene carta C. | Juega Descartar; elige 2 hand y C. | 2 procesadas a destino; C→HAND; hand limit. |
| `GE-ACT-005` | P1 | `ENGINE_INTEGRATION` | **Discard action no eligible recovery** | Tras los 2 descartes especiales no existe carta elegible en own discard. | Resolver. | Paso de recuperación produce 0; action completa. |
| `GE-ACT-006` | P0 | `ENGINE_INTEGRATION` | **Leaks direct cubes** | PD sin oposición. | P1 juega Filtraciones. | 3 MALIGN attributed P1 placed; no VP/no legitimacy. |
| `GE-ACT-007` | P0 | `ENGINE_INTEGRATION` | **Leaks applies 2:1** | PD tiene 1 RESILIENCY. | Filtraciones genera 3 MALIGN. | Consume 2 incoming, remove 1 resiliency, place 1 malign; no VP/legitimacy. |
| `GE-ACT-008` | P0 | `ENGINE_INTEGRATION` | **Crisis Management cost and direct cubes** | P1 Resources=3; PD vacía. | Gestión de Crisis. | Pay3; place3 RESILIENCY; no VP/legitimacy. |
| `GE-ACT-009` | P0 | `ENGINE_INTEGRATION` | **Covert Thief blind steal** | P2 HAND=6; P1 elige posición 3 sin ver contenido. | Ladrón Encubierto. | Sólo selected instance revelada/transferida; owner=P2 controller=P1 return flag true. |
| `GE-ACT-010` | P0 | `ENGINE_INTEGRATION` | **Covert Thief stolen Starter used** | Carta robada es Presupuesto Aumentado. | P1 la usa legalmente. | Starter effect resuelve para controller P1; después REMOVED_FROM_GAME; no retorna P2. |
| `GE-ACT-011` | P0 | `ENGINE_INTEGRATION` | **Covert Thief stolen Starter discarded** | Carta robada Starter no usada. | P1 la descarta. | Excepción DEC-026/lifecycle: retorna al owner según regla aprobada para stolen discard, no se elimina por simple control ajeno. |
| `GE-ACT-012` | P0 | `ENGINE_INTEGRATION` | **Active Measures any campaign I/II** | Campaña target existente. | P1 paga1 y juega Medidas Activas. | Whole campaign discarded; lifecycle exacto; no VP. |
| `GE-ACT-013` | P0 | `ENGINE_INTEGRATION` | **Economic Sanctions target 2+** | P2 Resources=5. | Sanciones P1→P2. | Transfer2: P2=3,P1+2. |
| `GE-ACT-014` | P0 | `ENGINE_INTEGRATION` | **Economic Sanctions target 1** | P2 Resources=1. | Sanciones. | Transfer1; nunca negativo. |
| `GE-ACT-015` | P0 | `ENGINE_INTEGRATION` | **Economic Sanctions target 0** | P2 Resources=0. | Sanciones. | Transfer0; action se consume normalmente; saldos intactos. |
| `GE-ACT-016` | P0 | `ENGINE_INTEGRATION` | **Double Action permits repeat** | Campaña propia ya activada una vez, Resources suficientes. | Juega Doble Acción, paga1 y activa misma campaña extra. | Extra activation aceptada; paga nuevamente costes campaña; activation ordinal incrementa. |
| `GE-ACT-017` | P0 | `COMMAND` | **Double Action insufficient card cost** | P1 Resources=0 al resolver. | Doble Acción. | FAILED_COST; no extra activation; action card jugada va a destino normal; AP sigue consumido. |
| `GE-ACT-018` | P0 | `SECURITY` | **Espionage temporary reveal** | P2 HAND>=3. | P1 juega Espionaje con RNG fijo. | Exactamente min(3,n) sampled sin replacement; sólo P1/F1 ven; cards quedan HAND P2; reveal cerrado. |
| `GE-ACT-019` | P0 | `ENGINE_INTEGRATION` | **Interagency swap** | P1 paga1; deck card D, hand card H elegible. | Interagencia swap. | D→HAND, H→deck, deck shuffle; hand size constante; H no Starter/stolen. |
| `GE-ACT-020` | P0 | `ENGINE_INTEGRATION` | **Draw exactly three** | Deck suficiente, HAND=6. | Juega Robar. | 3 CARD_DRAW events; HAND=9; action discarded. |
| `GE-ACT-021` | P0 | `ENGINE_INTEGRATION` | **Draw causes hand limit** | HAND=9, Robar 3. | Resolver. | Tras draws ChoiceRequest obliga descartar hasta HAND=10 antes de commit estable. |
| `GE-ACT-022` | P0 | `ENGINE_INTEGRATION` | **Cyber Theft all opponents** | Rolls otros jugadores: 1,4,5,10; saldos positivos. | Robo Cibernético. | Sólo <=4 transfieren 1; orden relativo de iniciativa; exactos DieRoll/ledger. |
| `GE-ACT-023` | P0 | `ENGINE_INTEGRATION` | **Cyber Theft zero-resource target** | Un target roll<=4 pero Resources=0. | Resolver. | Transfer0; no negativo; roll igualmente auditado. |
| `GE-ACT-024` | P0 | `ENGINE_INTEGRATION` | **Honey Pot success with Action card** | Target roll=6 y posee Action-class. | Tarro de Miel. | Target elige una Action de HAND y descarta; Starter no califica. |
| `GE-ACT-025` | P0 | `ENGINE_INTEGRATION` | **Honey Pot success no Action card** | Target roll<=6 pero HAND sin Action-class. | Resolver. | No discard; action completa. |
| `GE-ACT-026` | P0 | `ENGINE_INTEGRATION` | **Honey Pot failure** | Target roll=7. | Resolver. | No discard. |
| `GE-ACT-027` | P0 | `ENGINE_INTEGRATION` | **Boost linked to later activation** | P1 plan slot1 Boost linked slot2 Activate. | Resolver con activation alcanzando roll. | Boost revela ON_CAMPAIGN_ROLL, +1 baseline, luego discard; trace vincula card. |
| `GE-ACT-028` | P0 | `ENGINE_INTEGRATION` | **Boost linked activation negated** | Boost comprometido; activation posterior negada antes de roll. | Resolver. | Boost no modifica nada; en su lifecycle queda consumido/discard; AP no se reembolsa. |
| `GE-ACT-029` | P0 | `ENGINE_INTEGRATION` | **Corruption no reaction** | P1 paga1; P2 VP=5. | Corrupción target P2. | P2 VP=3; ledger CORRUPTION_PENALTY. |
| `GE-ACT-030` | P0 | `ENGINE_INTEGRATION` | **Corruption floor zero** | P2 VP=1. | Corrupción no negada. | P2 VP=0, no -1; ledger delta -1 efectivo o registro solicitado consistente con floor. |

# 8.7 G. Reacciones, narrativa y Veto

| ID | Pri. | Nivel | Caso | Given | When | Then |
|---|---|---|---|---|---|---|
| `GE-REA-001` | P0 | `ENGINE_INTEGRATION` | **Counterintelligence negates Double Agent** | P2 HAND contiene Contrainteligencia. | P1 Agente Doble; P2 reacciona. | Agente Doble negado; no TemporaryReveal; coste P1 no vuelve; reaction→discard. |
| `GE-REA-002` | P0 | `ENGINE_INTEGRATION` | **Anti-Corruption success** | Corrupción target P2; P2 juega Leyes Anticorrupción; roll=4. | Resolver reaction. | Corrupción negada; VP sin cambio; reaction consumed. |
| `GE-REA-003` | P0 | `ENGINE_INTEGRATION` | **Anti-Corruption failure** | Mismo, roll=5. | Resolver. | Reaction consumida; Corrupción continúa y aplica VP penalty. |
| `GE-REA-004` | P0 | `ENGINE_INTEGRATION` | **Cyberattack Hack Back no Cybersecurity** | MALIGN campaign contiene Ciberataque target PD de P2; P2 tiene Hack Back. | P2 juega reacción; P1 pasa child window. | Campaign activation NEGATED; no campaña cost/roll/ERT posteriores; Hack Back discarded. |
| `GE-REA-005` | P0 | `ENGINE_INTEGRATION` | **Cyberattack chain restored by Cybersecurity** | Mismo pero P1 tiene Ciberseguridad. | P2 Hack Back; P1 child reaction Ciberseguridad. | Hack Back negado; ambas reaction cards discarded; campaign continúa pipeline. |
| `GE-REA-006` | P0 | `COMMAND` | **Ineligible generic reaction rejected** | Jugador intenta jugar Contrainteligencia ante evento no Agente Doble. | PLAY_REACTION. | REJECTED REACTION_NOT_ELIGIBLE. |
| `GE-REA-007` | P0 | `COMMAND` | **Reaction after window closed rejected** | Reaction window ya CLOSED. | PLAY_REACTION. | REJECTED REACTION_WINDOW_CLOSED; card permanece HAND. |
| `GE-REA-008` | P0 | `TURN_INTEGRATION` | **Reaction priority order** | Trigger con varios elegibles; initiative P1→P2→P3→P4→P5, actor=P3. | Open window. | Priority empieza P4, luego P5,P1,P2; passes auditados; no stack genérico. |
| `GE-REA-009` | P0 | `ENGINE_INTEGRATION` | **Right of First Refusal success** | Campaña revelada, reactor juega carta y roll=4. | Resolver. | Whole campaign discarded; activation INVALIDATED; no campaign cost paid; reaction consumed. |
| `GE-REA-010` | P0 | `ENGINE_INTEGRATION` | **Right of First Refusal failure** | Mismo roll=5. | Resolver. | Campaign continúa; reaction consumed. |
| `GE-NAR-001` | P0 | `ENGINE_INTEGRATION` | **Strict narrative 2 sentences** | Narrative strict mode, exactamente 2 oraciones. | Submit. | Aceptada sin penalty; pipeline continúa. |
| `GE-NAR-002` | P0 | `ENGINE_INTEGRATION` | **Strict narrative <2 blocked** | Narrativa 1 oración. | Submit. | No avanza hasta corrección o Facilitator override; no random penalty automático. |
| `GE-NAR-003` | P0 | `ENGINE_INTEGRATION` | **Strict narrative >3 random discard** | Narrativa 4 oraciones; HAND=5; RNG selecciona card X. | Submit. | X se descarta con lifecycle; NARRATIVE_PENALTY_APPLIED; cards PLANNED_ACTION no elegibles. |
| `GE-NAR-004` | P0 | `ENGINE_INTEGRATION` | **Reading card text penalty** | Facilitator confirma “simplemente leyó cartas”; HAND=1. | Apply decision. | Descarta min(2,1)=1 aleatoria; decision auditada. |
| `GE-VETO-001` | P0 | `ENGINE_INTEGRATION` | **Veto campaign rejected by strict majority** | 5 jugadores activos; votes 3 UNACCEPTABLE,2 ACCEPTABLE. | Resolver Veto. | Campaign discarded; campaign actor bloqueado de nuevas activations este turno; Veto removed-from-game. |
| `GE-VETO-002` | P0 | `ENGINE_INTEGRATION` | **Veto fails 2-3** | 5 activos; 2 UNACCEPTABLE. | Resolver. | Campaign continúa; Veto igualmente removed. |
| `GE-VETO-003` | P0 | `ENGINE_INTEGRATION` | **Veto tie with four active** | 4 activos; 2/2. | Resolver. | No strict majority; campaign continúa. |
| `GE-VETO-004` | P0 | `ENGINE_INTEGRATION` | **Veto abuse rejected before mutation** | Facilitator marca intento como VETO_ABUSE antes de aceptar reaction. | Jugador envía PLAY_REACTION Veto. | Command rejected; Veto permanece HAND; razón auditada. |
| `GE-VETO-005` | P1 | `TURN_INTEGRATION` | **Sequential multiple veto** | Veto1 falla y campaign sigue; otro jugador posee Veto. | Segundo Veto en misma pre-roll window. | Segundo proceso permitido; cada Veto independiente/removed si aceptado para play. |

# 8.8 H. Activación, CV, costes, ERT y modificadores

| ID | Pri. | Nivel | Caso | Given | When | Then |
|---|---|---|---|---|---|---|
| `GE-ERT-001` | P0 | `COMMAND` | **Normal repeat activation rejected** | Campaña activada una vez este turno; no extra effect. | Segundo ACTIVATE_CAMPAIGN normal. | CAMPAIGN_ALREADY_ACTIVATED. |
| `GE-ERT-002` | P0 | `ENGINE_INTEGRATION` | **Target DT mismatch** | Campaña target_dt=ASIAN; PD elegida carece ASIAN. | Activation. | INVALID_TARGET_PD/INVALID_DT; no cost/roll. |
| `GE-ERT-003` | P0 | `RULE_UNIT` | **Base CV low boundary** | IVs sum=3 y 6. | calculate. | LOW para ambos; cost1. |
| `GE-ERT-004` | P0 | `RULE_UNIT` | **Base CV medium boundaries** | sum=7 y 11. | calculate. | MEDIUM; cost2. |
| `GE-ERT-005` | P0 | `RULE_UNIT` | **Base CV high boundaries** | sum=12 y 15. | calculate. | HIGH; cost3. |
| `GE-ERT-006` | P0 | `RULE_UNIT` | **Slot-specific IV** | Multi-type card IV Method=2,Amp=5 colocada Method. | calculate base_cv. | Aporta2, no5. |
| `GE-ERT-007` | P0 | `ENGINE_INTEGRATION` | **Bonus changes tier not cost** | base_cv=10, valid +2 pair. | Activation. | Campaign cost2 MEDIUM; effective_cv12; ERT tier HIGH. |
| `GE-ERT-008` | P0 | `RULE_UNIT` | **Effective CV >15 remains high** | base15 + pair2 + coalition4 =21. | tier lookup. | resolution HIGH; raw effective_cv21 retained. |
| `GE-ERT-009` | P0 | `ENGINE_INTEGRATION` | **Military Exercises extra cost** | Base low campaign contiene Ejercicios Militares. | Activation. | Total cost=1 tier +1 component; ledger distingue costes. |
| `GE-ERT-010` | P0 | `ENGINE_INTEGRATION` | **Military Mobilization extra cost** | Base low contiene Movilización Militar. | Activation. | Total cost=1+3. |
| `GE-ERT-011` | P0 | `ENGINE_INTEGRATION` | **Insufficient after earlier forced transfer** | P1 tenía coste justo, pero Sanciones previa le quitó recursos. | Llega activation. | FAILED_COST; no die/ERT; campaign permanece mat; AP ya comprometido. |
| `GE-ERT-012` | P0 | `ENGINE_INTEGRATION` | **Coalition zero contributors** | Campaign contiene Construcción de Coalición; todos pass. | Contribution window. | coalition_bonus0; no payments. |
| `GE-ERT-013` | P0 | `ENGINE_INTEGRATION` | **Coalition four contributors** | Otros 4 tienen resources y cada uno aporta1. | Contribution window. | effective_cv +4; cuatro RESOURCE_SPENT contribution; contributions públicas. |
| `GE-ERT-014` | P0 | `ENGINE_INTEGRATION` | **Coalition contributor lacks resource** | Un jugador intenta contribuir1 con saldo0. | Submit contribution. | Contribution rechazada/0; no negativo; resto window sigue. |
| `GE-ERT-015` | P0 | `ENGINE_INTEGRATION` | **Core +1 pre-roll once per turn** | P1 paga2 antes de roll. | Use modifier en activation1; intenta otra vez activation2 mismo turno. | Primera +1; segunda REJECTED/option not offered ROLL_MODIFIER_ALREADY_USED. |
| `GE-ERT-016` | P0 | `ENGINE_INTEGRATION` | **Legitimacy modifier** | P1 posee marker en target PD. | Activation roll raw=6. | modified includes +1; trace legitimacy modifier. |
| `GE-ERT-017` | P0 | `RULE_UNIT` | **Roll clamps at 10** | die10 + core1 + Boost1 + legitimacy1. | ERT lookup. | modified_roll_raw13; ert_roll10. |
| `GE-ERT-018` | P0 | `RULE_UNIT` | **ERT low malign row1** | LOW malign, ert_roll1. | lookup. | -2 backlash. |
| `GE-ERT-019` | P0 | `RULE_UNIT` | **ERT medium resiliency row2** | MEDIUM resiliency, roll2. | lookup. | 0. |
| `GE-ERT-020` | P0 | `RULE_UNIT` | **ERT high positive row10** | HIGH either alignment, roll10. | lookup. | +4 matching campaign type. |
| `GE-ERT-021` | P0 | `RULE_UNIT` | **All 30 ERT cells exact** | Iterar 10 rows ×3 tiers para MALIGN/RESILIENCY. | lookup each. | Matriz coincide byte-for-byte con tabla autoritativa de spec. |
| `GE-ERT-022` | P0 | `ENGINE_INTEGRATION` | **All pair bonuses registered** | Para cada una de las 23 parejas, campaign contiene ambas definiciones. | calculate bonuses. | Cada par aporta exactamente +2 una vez; alias normalizados; coste base no cambia. |
| `GE-ERT-023` | P1 | `RULE_UNIT` | **No false pair bonus** | Campaign contiene sólo una carta del par o nombre similar no alias. | calculate. | No +2. |

# 8.9 I. Cubos, backlash, legitimidad y VP

| ID | Pri. | Nivel | Caso | Given | When | Then |
|---|---|---|---|---|---|---|
| `GE-CUBE-001` | P0 | `RULE_UNIT` | **2:1 exact pair** | PD opposite=1; incoming2. | resolve2to1. | Consume2 incoming, remove1 opposite, place0. |
| `GE-CUBE-002` | P0 | `RULE_UNIT` | **2:1 three incoming** | PD opposite>=1; incoming3. | resolve. | Consume2, remove1, place1 incoming. |
| `GE-CUBE-003` | P0 | `RULE_UNIT` | **2:1 insufficient opposition** | PD opposite=1; incoming6. | resolve. | Sólo consume2/remove1; place4. |
| `GE-CUBE-004` | P0 | `ENGINE_INTEGRATION` | **Removal attribution choice** | PD opposite stacks P2=1,P3=2; incoming4. | Actor elige remove P3 dos veces. | Consume4; remove2 P3; P2 intacto; choice records exact. |
| `GE-CUBE-005` | P0 | `RULE_UNIT` | **No 1:1 cancellation** | Opposite1,incoming1. | resolve. | No removal; incoming1 placed y opposite1 permanece. |
| `GE-CUBE-006` | P0 | `ENGINE_INTEGRATION` | **Positive ERT all incoming consumed** | Campaign result +2; PD opposite>=1. | Resolve. | ERT_POSITIVE + NO_CUBE_PLACED; VP+0; legitimacy unchanged. |
| `GE-CUBE-007` | P0 | `ENGINE_INTEGRATION` | **Positive ERT partial placement scores remainder** | Result +3; one opposite. | Resolve. | 1 cube remains; +1 VP; legitimacy flow triggered. |
| `GE-CUBE-008` | P0 | `ENGINE_INTEGRATION` | **Backlash placed penalizes actor** | Malign campaign ERT -2; no opposite malign? backlash creates2 RESILIENCY and both remain. | Resolve. | 2 RESILIENCY attributed actor; VP -2 floor0; no legitimacy. |
| `GE-CUBE-009` | P0 | `ENGINE_INTEGRATION` | **Backlash cubes consumed penalize only placed** | ERT -2 opposite malign existing1. | 2 backlash resiliency cancel1 malign, place0. | No backlash VP penalty because 0 remain; no legitimacy. |
| `GE-LEG-001` | P0 | `ENGINE_INTEGRATION` | **Establish legitimacy** | PD no marker; positive campaign places>=1; actor markers<3. | Resolve. | Marker actor placed; +1 establishment VP plus cube VP. |
| `GE-LEG-002` | P0 | `ENGINE_INTEGRATION` | **Same owner no extra establishment VP** | PD marker already actor; campaign places1. | Resolve. | Marker unchanged; +1 cube VP only. |
| `GE-LEG-003` | P0 | `ENGINE_INTEGRATION` | **Subvert foreign legitimacy** | PD marker=P2; P1 successful places>=1. | Resolve. | P2 marker removed; P1 +1 subversion VP; P1 marker not placed. |
| `GE-LEG-004` | P0 | `ENGINE_INTEGRATION` | **Fourth marker replace own** | P1 already3; new establishment eligible. | P1 chooses old marker X to remove. | X removed, new marker placed, +1 establishment VP; max3. |
| `GE-LEG-005` | P0 | `ENGINE_INTEGRATION` | **Fourth marker renounce** | P1 already3; eligible new marker. | P1 chooses renounce. | No new marker, no establishment bonus; cube VP still applies. |
| `GE-LEG-006` | P0 | `ENGINE_INTEGRATION` | **Direct cube effect no legitimacy or VP** | Filtraciones/Gestión/Dinesia/Fluma/viral places cubes. | Resolve. | 2:1 applies; no cube VP; no establish/subvert unless explicit future effect. |

# 8.10 J. Regime Abilities

| ID | Pri. | Nivel | Caso | Given | When | Then |
|---|---|---|---|---|---|---|
| `GE-REG-001` | P0 | `ENGINE_INTEGRATION` | **Arden success** | Arden attempts once; die=4; own PD has malign stacks. | Resolve. | Remove1 chosen malign attribution; no VP/legitimacy. |
| `GE-REG-002` | P0 | `ENGINE_INTEGRATION` | **Arden failure** | die=5. | Resolve. | No cube removed; attempt flag consumed. |
| `GE-REG-003` | P0 | `COMMAND` | **Regime ability twice rejected** | Ability already attempted this turn. | Second command. | REGIME_ABILITY_ALREADY_USED. |
| `GE-REG-004` | P0 | `TURN_INTEGRATION` | **Fluma retroactive spends** | P2 Fluma plan ability slot3; before reveal other players already spent 3 qualifying Resource units desde ACTION_STAGE_LOCKED. | Reveal ability. | Processes exactly those3 units retroactively: 3 triggers ×2 malign into chosen Arden PDs; then subscribes forward. |
| `GE-REG-005` | P0 | `TURN_INTEGRATION` | **Fluma forward spends** | Ability active; later campaign cost2 by another player. | Spend occurs. | Exactly2 trigger units, each generates2 malign; exactly-once IDs. |
| `GE-REG-006` | P0 | `RULE_UNIT` | **Fluma excludes transfer/income** | Ability active. | Other player receives income or transfers Resources. | No Fluma trigger. |
| `GE-REG-007` | P0 | `TURN_INTEGRATION` | **Fluma includes coalition and core modifier** | Ability active; other player contributes1 coalition and pays2 core modifier. | Resolve spends. | 3 qualifying units trigger exactly once. |
| `GE-REG-008` | P0 | `ENGINE_INTEGRATION` | **Ursaria dual malign cards qualify** | HAND has two dual cards with malign icon. | Controles Internos. | Both discard as cost; remove up to3 malign from one own PD. |
| `GE-REG-009` | P0 | `ENGINE_INTEGRATION` | **Ursaria insufficient two cards** | Only1 qualifying malign card. | Resolve. | No discard/effect; attempt consumed; AP already committed. |
| `GE-REG-010` | P0 | `ENGINE_INTEGRATION` | **Ursaria removes fewer if fewer exist** | PD has1 malign. | Success after paying cards. | Remove1 only; no negative count. |
| `GE-REG-011` | P0 | `ENGINE_INTEGRATION` | **Presque success empty PD marker** | die4; chosen PD no marker; Presque markers<3. | Resolve. | Place Presque marker; no VP. |
| `GE-REG-012` | P0 | `ENGINE_INTEGRATION` | **Presque replaces foreign marker** | die<=4; target marker=P1. | Resolve. | Remove P1, place Presque; no establishment/subversion VP. |
| `GE-REG-013` | P0 | `ENGINE_INTEGRATION` | **Presque at cap replaces own** | Presque already3. | Success; chooses own marker X then target. | X removed first, target marker logic, final count<=3; no VP. |
| `GE-REG-014` | P0 | `ENGINE_INTEGRATION` | **Dinesia direct resiliency** | Resources>=2; own PD empty. | Compra de Favor. | Pay2; generate/place1 RESILIENCY attributed Dinesia; no VP/legitimacy. |
| `GE-REG-015` | P0 | `ENGINE_INTEGRATION` | **Dinesia 2:1 edge** | Own PD has1 MALIGN; ability generates1 RESILIENCY. | Resolve. | No 2:1 cancellation because incoming1; both remain. |

# 8.11 K. Cleanup y viralización

| ID | Pri. | Nivel | Caso | Given | When | Then |
|---|---|---|---|---|---|---|
| `GE-CLN-001` | P0 | `TURN_INTEGRATION` | **Aging simultaneous semantics** | Un jugador RowI C1/RowII C2. | Cleanup aging snapshot. | C2 discarded; C1→RowII; no conflict de capacidad. |
| `GE-CLN-002` | P0 | `TURN_INTEGRATION` | **Turn flags reset** | Campaña activada, regime used, core modifier used. | Cleanup complete. | Surviving campaign activation counter/turn flags reset for next turn. |
| `GE-VIR-001` | P0 | `TURN_INTEGRATION` | **No legitimacy no viral** | PD total malign=9, no marker. | CLEANUP_VIRAL. | No VIRAL_ATTEMPTED. |
| `GE-VIR-002` | P0 | `TURN_INTEGRATION` | **Legitimacy owner lacks attributed cube** | PD malign=9 pero marker owner no tiene malign attributed allí. | Viral snapshot. | Origin ineligible; no attempt. |
| `GE-VIR-003` | P0 | `TURN_INTEGRATION` | **Baseline spread success even second roll** | Origin eligible; first roll6; second roll8; destination shares DT. | Resolve. | Generate2 matching cubes attributed legitimacy owner; direct 2:1; no VP/legit. |
| `GE-VIR-004` | P0 | `TURN_INTEGRATION` | **Baseline spread success odd second roll** | first7 second3. | Resolve. | Generate1 cube. |
| `GE-VIR-005` | P0 | `TURN_INTEGRATION` | **Baseline spread fails first roll** | first5. | Resolve. | No second die consumed; no cube. |
| `GE-VIR-006` | P0 | `TURN_INTEGRATION` | **Both types threshold choose larger** | malign10,resiliency9; marker owner has both attribution. | Snapshot. | MALIGN type chosen automatically. |
| `GE-VIR-007` | P0 | `TURN_INTEGRATION` | **Both types equal tie choice** | malign9,resiliency9; owner has both. | Choice selects RESILIENCY. | Spread uses RESILIENCY; choice auditada. |
| `GE-VIR-008` | P0 | `COMMAND` | **Destination must share DT** | Only selected destination has no shared DT. | Submit viral destination. | INVALID_TARGET_PD; engine ofrece sólo valid options. |
| `GE-VIR-009` | P0 | `TURN_INTEGRATION` | **Multiple origins ordered** | Two+ eligible origins owned by different players. | Viral phase. | Order by owner initiative rank then stable pd_id. |
| `GE-VIR-010` | P0 | `TURN_INTEGRATION` | **Snapshot prevents cascade** | Destination below threshold at snapshot becomes >8 by spread. | Continue viral phase. | Destination no se convierte en nuevo origin ese turno. |
| `GE-VIR-011` | P0 | `TURN_INTEGRATION` | **Short variant threshold and one cube** | variant short, origin total7, first roll6. | Resolve. | Eligible because >6; no second roll; exactly1 cube. |
| `GE-VIR-012` | P0 | `TURN_INTEGRATION` | **Threshold strict greater-than** | Baseline total exactly8 o short exactly6. | Snapshot. | No origin; requiere > threshold. |

# 8.12 L. Victory Objectives y fin de partida

| ID | Pri. | Nivel | Caso | Given | When | Then |
|---|---|---|---|---|---|---|
| `GE-VO-ARD-001` | P0 | `RULE_UNIT` | **Arden hard positive** | attributed_malign(ARDEN,FLUMA_PD_2)=6. | Evaluate final. | +15. |
| `GE-VO-ARD-002` | P0 | `RULE_UNIT` | **Arden hard boundary fail** | valor=5. | Evaluate. | +0. |
| `GE-VO-ARD-003` | P0 | `RULE_UNIT` | **Arden medium positive** | net attributed resilience in FLUMA_PD_1=4. | Evaluate. | +7. |
| `GE-VO-ARD-004` | P0 | `RULE_UNIT` | **Arden easy per PD** | Arden PD resilience totals [3,2,7]. | Evaluate. | +10 (2 qualifying PD). |
| `GE-VO-URS-001` | P0 | `RULE_UNIT` | **Ursaria hard positive** | sum attributed malign in Arden=8. | Evaluate. | +20. |
| `GE-VO-URS-002` | P0 | `RULE_UNIT` | **Ursaria medium religious PDs** | Dos Presque Christian PD tienen net attributed malign >=2. | Evaluate. | +7 según objective baseline una vez, no por PD, conforme spec. |
| `GE-VO-URS-003` | P0 | `RULE_UNIT` | **Ursaria easy per foreign country** | Qualifying presence en Arden,Fluma,Dinesia; no Presque. | Evaluate. | +15. |
| `GE-VO-PRE-001` | P0 | `RULE_UNIT` | **Presque hard exactly two Dinesia PD** | Dos PD attributed malign=4+, tercera0. | Evaluate. | +15. |
| `GE-VO-PRE-002` | P0 | `RULE_UNIT` | **Presque medium per Arden PD + all bonus** | Todas 3 Arden PD net attributed resilience>2. | Evaluate. | +20 (3×5 +5). |
| `GE-VO-PRE-003` | P0 | `RULE_UNIT` | **Presque easy all own PD bonus** | Tres Presque PD total resilience>2. | Evaluate. | +14 (3×3 +5). |
| `GE-VO-FLU-001` | P0 | `RULE_UNIT` | **Fluma hard M/L positive** | Arden M y L net_total_malign=4 y4. | Evaluate. | +20. |
| `GE-VO-FLU-002` | P0 | `RULE_UNIT` | **Fluma medium strict comparative** | Liberty net resilience4, Workers3. | Evaluate. | +10. |
| `GE-VO-FLU-003` | P0 | `RULE_UNIT` | **Fluma medium equality fail** | Liberty4, Workers4. | Evaluate. | +0 porque debe ser mayor. |
| `GE-VO-FLU-004` | P0 | `RULE_UNIT` | **Fluma easy narrative-tag requirement** | Tres foreign PD tienen net attributed resilience>2 pero sólo dos tienen narrative tag aprobado. | Evaluate. | Sólo las dos tagged aportan +3; bonus de 3 países no se cumple. |
| `GE-VO-FLU-005` | P0 | `RULE_UNIT` | **Fluma easy three-country bonus** | Al menos una qualifying M/L tagged PD en 3 países distintos; total qualifying PD=4. | Evaluate. | 4×3 +5 bonus =17. |
| `GE-VO-DIN-001` | P0 | `RULE_UNIT` | **Dinesia hard all Presque PD** | Todas Presque PD net_total_malign=3. | Evaluate. | +20. |
| `GE-VO-DIN-002` | P0 | `RULE_UNIT` | **Dinesia medium per PD + all** | Dinesia PD net resilience [2,3,2]. | Evaluate. | +20 (3×5+5). |
| `GE-VO-DIN-003` | P0 | `RULE_UNIT` | **Dinesia easy OR both true** | Liberty resil attributed>2 y Workers malign attributed>2. | Evaluate. | +5 máximo, no +10. |
| `GE-END-001` | P0 | `GAME_INTEGRATION` | **VO awards materialized once** | End-game scoring se ejecuta dos veces por retry idempotente. | Retry mismo idempotency key. | Cada OBJECTIVE_AWARDED existe una sola vez; VP no duplica. |
| `GE-END-002` | P0 | `GAME_INTEGRATION` | **No base instant victory** | VO hard se cumple en turno1 y turn_limit>1. | End-turn check. | Partida continúa; BASE_2025 no instant_victory. |
| `GE-END-003` | P0 | `GAME_INTEGRATION` | **Turn limit ends game** | turn_number==turn_limit. | End-turn after viral. | End-game objectives→final VP→winner; GAME_COMPLETED. |
| `GE-END-004` | P0 | `GAME_INTEGRATION` | **Tiebreak least own-country malign** | P1/P2 same final VP; own malign P1=3,P2=5. | Determine winner. | P1 wins. |
| `GE-END-005` | P0 | `GAME_INTEGRATION` | **Persistent tie shared** | Same VP and same own-country malign. | Tiebreak. | Shared result; no invented third criterion. |

# 8.13 M. Dice, Choice, seguridad y auditabilidad

| ID | Pri. | Nivel | Caso | Given | When | Then |
|---|---|---|---|---|---|---|
| `GE-DIE-001` | P0 | `ENGINE_INTEGRATION` | **Digital die in range and recorded** | Dice mode DIGITAL; deterministic adapter returns7. | Request campaign die. | DieRoll raw7, manual=false, source correct, rng_request_id present. |
| `GE-DIE-002` | P0 | `COMMAND` | **Manual die invalid rejected** | Dice mode MANUAL; submitted0 or11. | Submit. | INVALID_DIE_VALUE; no DieRoll committed. |
| `GE-DIE-003` | P0 | `ENGINE_INTEGRATION` | **Manual die audit** | Submitted8 by authorized participant/facilitator path. | Resolve. | DieRoll raw8 manual=true submitter persisted; modifiers applied identically to digital. |
| `GE-CHO-001` | P0 | `COMMAND` | **Choice cannot select outside options** | Choice options [A,B], actor submits C. | Resolve choice. | REJECTED; no state advance. |
| `GE-CHO-002` | P0 | `COMMAND` | **Wrong actor cannot answer choice** | Choice belongs P1. | P2 submits valid option. | NOT_AUTHORIZED. |
| `GE-SEC-001` | P0 | `SECURITY` | **Hand owner/facilitator only** | P1 HAND has card IDs/names. | Get projections P1,P2,F1. | P1/F1 see authorized details; P2 no hand contents. |
| `GE-SEC-002` | P0 | `SECURITY` | **Secret VO isolation** | Cada país tiene VOs. | P2 queries P1 state; AI context built for P2. | No P1 VO condition/progress/metadata leaks; F1 sí puede ver. |
| `GE-SEC-003` | P0 | `SECURITY` | **Operations deck order private** | Deck exact order known server-side. | P2/AI-P2 projection. | No order ni top-card identity. |
| `GE-SEC-004` | P0 | `SECURITY` | **Face-down plan private until reveal** | P1 locked actions. | Before P1 resolution. | Rivals no action payload; after ACTION_REVEALED sólo campos públicos de timing. |
| `GE-SEC-005` | P0 | `SECURITY` | **TemporaryReveal scope** | Espionage creates reveal to P1/F1. | P3 and AI-P3 query during window. | No revealed card details; P1/F1 sí; after close P1 no persistent authorization salvo audit private policy. |
| `GE-SEC-006` | P0 | `SECURITY` | **AI cannot mutate authoritative state** | AI layer proposes command without authorized user confirmation/flow. | Attempt mutation. | Rejected by authority boundary; no state change. |
| `GE-FAC-001` | P0 | `ENGINE_INTEGRATION` | **Facilitator pause/resume** | Game active. | F1 pauses then resumes. | Overlay blocks/unblocks gameplay; events/decisions auditados; underlying phase preserved. |
| `GE-FAC-002` | P0 | `AUDIT_REPLAY` | **Facilitator override marked noncanonical** | F1 corrige resultado fuera de flujo normal. | Apply override con reason. | FACILITATOR_OVERRIDE/GAME_STATE_OVERRIDE_AUDITED; pre/post refs; game noncanonical=true cuando altera regla/resultado. |
| `GE-AUD-001` | P0 | `AUDIT_REPLAY` | **Campaign trace completeness** | Campaña completa con bonus, resource costs, roll, 2:1, VP. | Resolve. | Trace contiene todos campos mínimos, state hashes y version refs; no campo normativo crítico nulo sin razón. |
| `GE-AUD-002` | P0 | `AUDIT_REPLAY` | **Resource ledger reconciles cache** | Secuencia income/spend/transfer. | Recompute balance from ledger. | Coincide exactamente con cached balance. |
| `GE-AUD-003` | P0 | `AUDIT_REPLAY` | **VP ledger reconciles cache** | Campaign + legitimacy + corruption + objective. | Recompute. | Coincide final VP; floor-zero semantics consistente. |
| `GE-AUD-004` | P0 | `AUDIT_REPLAY` | **Event replay reaches same state hash** | Snapshot inicial + event log de turno complejo. | Replay con reducers versionados. | Final authoritative state hash = original. |
| `GE-AUD-005` | P0 | `AUDIT_REPLAY` | **Event order stable around reaction** | Action opens reaction, child reaction, resumes campaign. | Resolve. | REACTION_WINDOW_OPENED/REACTION_PLAYED/(child)/CLOSED aparecen antes de cost/roll según pipeline. |
| `GE-AUD-006` | P1 | `AUDIT_REPLAY` | **No silent mutation** | Comparar pre/post state de cualquier accepted resolution. | Diff state. | Toda mutación crítica está explicada por uno o más domain events/ledger/trace; cero cambios huérfanos. |

# 8.14 N. Escenarios de integración end-to-end

| ID | Pri. | Nivel | Caso | Given | When | Then |
|---|---|---|---|---|---|---|
| `GE-E2E-001` | P0 | `TURN_INTEGRATION` | **Five-player full turn deterministic** | Fixture completo con cada jugador 3 acciones, una reaction, una campaña, viral potential; RNG/choices fijos. | Resolver Initiative→Action→Resolution→Cleanup→EndTurn. | Post-state, event stream y hashes coinciden golden fixture; no deadlock/suspension pendiente. |
| `GE-E2E-002` | P0 | `GAME_INTEGRATION` | **Two-turn campaign lifecycle** | Turn1 build RowI; cleanup→II; turn2 activate/modify; cleanup. | Resolver dos turnos. | Campaign usable en II durante turn2 y luego discarded; cards lifecycle exacto. |
| `GE-E2E-003` | P0 | `TURN_INTEGRATION` | **Action ordering changes outcome** | P1 plan ActionCard que modifica campaña antes de activation vs mismo cards en orden inverso en fixture B. | Resolver A y B. | A obtiene efecto sólo cuando timing lo permite; B no retroactúa; diferencia esperada y auditada. |
| `GE-E2E-004` | P0 | `TURN_INTEGRATION` | **Initiative gives pre-existing cube advantage** | P1 coloca cubes antes que P2 por initiative; fixture espejo invierte initiative. | Resolver ambas. | 2:1 trata primeros como pre-existing; estados finales pueden diferir exactamente como regla. |
| `GE-E2E-005` | P0 | `GAME_INTEGRATION` | **Base scenario final scoring golden** | Estado final sintético satisface mezcla conocida de VOs de los cinco países. | END_GAME_SCORING. | Awards por país coinciden funciones; winner/tiebreak exacto; VOs permanecen privados antes de reveal policy. |
| `GE-E2E-006` | P0 | `GAME_INTEGRATION` | **No physical component caps** | Estado requiere >40 cubes o VP>track visual. | Aplicar efectos válidos. | Engine permite cantidades; no error por stock/pista física. |


---

# 9. Cobertura cuantitativa del baseline

Esta v0.1 contiene **224 casos nominales**, de los cuales **217 son P0/BLOCKER**. Algunos casos son parametrizados y representan múltiples ejecuciones reales; por ejemplo `GE-ERT-021` cubre toda la matriz ERT y `GE-ERT-022` cubre cada pareja de bonus registrada.

La suite implementada será necesariamente mayor porque cada test nominal puede tener:

- variante DIGITAL/MANUAL cuando corresponda;
- variante MALIGN/RESILIENCY;
- boundary inferior/superior;
- proyección jugador/rival/facilitador;
- event/trace assertions adicionales.

Por ello, el conteo nominal no debe usarse como límite máximo de tests ejecutables.

---

# 10. Matriz de trazabilidad de los 47 casos obligatorios del Adjudication Engine v0.1

| Requisito previo | Cobertura principal |
|---|---|
| 1 initiative tie con múltiples rerolls | `GE-INI-002`, `GE-INI-003` |
| 2 deck exhaustion + reshuffle | `GE-INI-005` |
| 3 Protocolos durante draw | `GE-SET-009`, `GE-INI-007`, `GE-INI-008` |
| 4 Starter play + hand limit | `GE-PLAN-006..010` |
| 5 build Intent+Method | `GE-CAM-001` |
| 6 modify Row II | `GE-CAM-007` |
| 7 fill empty Amplifier | `GE-CAM-008` |
| 8 action order | `GE-PLAN-002`, `GE-E2E-003` |
| 9 normal repeat rejected | `GE-ERT-001` |
| 10 Doble Acción repeat | `GE-ACT-016` |
| 11 Veto accepted/rejected/tie | `GE-VETO-001..003` |
| 12 Derecho preferente success/failure | `GE-REA-009..010` |
| 13 Cyber chain | `GE-REA-004..005` |
| 14 Anti-Corruption | `GE-REA-002..003` |
| 15 base cost vs bonus tier | `GE-ERT-007` |
| 16 effective CV >15 | `GE-ERT-008` |
| 17 card-specific costs | `GE-ERT-009..010` |
| 18 insufficient after transfer | `GE-ERT-011` |
| 19 coalition 0..4 | `GE-ERT-012..014` |
| 20 core modifier once | `GE-ERT-015` |
| 21 roll >10 clamp | `GE-ERT-017` |
| 22 ERT backlash | `GE-ERT-018`, `GE-CUBE-008..009` |
| 23 positive all consumed | `GE-CUBE-006` |
| 24 attribution choice 2:1 | `GE-CUBE-004` |
| 25 legitimacy paths | `GE-LEG-001..003` |
| 26 fourth legitimacy | `GE-LEG-004..005` |
| 27 direct cubes no score | `GE-LEG-006` |
| 28 Fluma retroactive | `GE-REG-004..007` |
| 29 Ursaria dual malign | `GE-REG-008` |
| 30 Presque replaces foreign | `GE-REG-012` |
| 31 Dinesia direct resilience | `GE-REG-014..015` |
| 32 Identidades Falsas / campaign discard lifecycle | cubierto por generic whole-campaign lifecycle `GE-CAM-013..014`; añadir card-registry fixture específico al implementar registry tests |
| 33 stolen return-on-discard | `GE-INI-010`, `GE-CAM-014` |
| 34 stolen Starter | `GE-ACT-010..011` |
| 35 Policy Pivot with Starter | `GE-PLAN-009` |
| 36 Sanciones 0/1/2+ | `GE-ACT-013..015` |
| 37 Cyber Theft target 0 | `GE-ACT-023` |
| 38 viral no legitimacy | `GE-VIR-001` |
| 39 viral no attributed cube | `GE-VIR-002` |
| 40 multiple origins no cascade | `GE-VIR-009..010` |
| 41 both types tie | `GE-VIR-006..007` |
| 42 each base VO | `GE-VO-*` |
| 43 final tiebreak | `GE-END-004` |
| 44 persistent tie | `GE-END-005` |
| 45 manual die audit | `GE-DIE-003` |
| 46 facilitator override | `GE-FAC-002` |
| 47 authorization hand/VO/temp reveal | `GE-SEC-001..005` |

---

# 11. Golden fixtures obligatorios

Antes de implementar reglas, el repositorio deberá contener fixtures versionados, legibles y sin lógica oculta:

```text
tests/fixtures/
  scenario-base-clean.json
  cards-registry-v1.json
  campaign-low-malign.json
  campaign-medium-malign.json
  campaign-high-malign.json
  campaign-medium-resiliency.json
  pd-mixed-attribution.json
  legitimacy-cap.json
  reaction-cyber-chain.json
  viral-multi-origin.json
  victory-objectives-positive.json
  victory-objectives-boundaries.json
  full-turn-golden-01.json
```

Los nombres son propuesta técnica; el contenido normativo sí es requerido.

---

# 12. Assertions mínimas por categoría

## 12.1 Commands

- status;
- typed error code;
- `game_version`;
- ausencia/presencia de mutation;
- idempotency result.

## 12.2 Cartas

- zone before/after;
- owner/controller;
- return/remove flags;
- hand limit;
- hidden/public projection.

## 12.3 Campañas

- row/slots;
- card instances;
- target DT;
- activation ordinal;
- base/effective CV;
- costs;
- modifiers;
- die/ERT;
- cubes;
- legitimacy/VP;
- trace.

## 12.4 Cubes

- type;
- attribution;
- incoming generated;
- incoming consumed;
- opposite removed by attribution;
- remainder placed;
- exact PD totals.

## 12.5 Seguridad

Cada positive authorization assertion requiere al menos una negative assertion equivalente para un actor no autorizado.

---

# 13. Property-based tests recomendados

Estos tests son **PROPUESTA TÉCNICA**, pero deben adoptarse antes de producción:

1. para cualquier `N>=0`, `resolve_2_to_1` nunca produce negativos;
2. conservación: incoming = consumed + placed;
3. cada cancelación consume exactamente 2 incoming y remueve exactamente 1 opposite;
4. resources después de cualquier secuencia válida >=0;
5. VP después de cualquier secuencia válida >=0;
6. CardInstance ocupa exactamente una zona;
7. mano estable <=10;
8. legitimacy por PD <=1 y por jugador <=3;
9. ERT lookup siempre retorna una celda definida para `ert_roll∈1..10`;
10. replay de cualquier prefix de eventos produce estado validable;
11. serializar/deserializar estado no cambia state hash canónico;
12. una proyección de rival nunca contiene IDs privados marcados `OWNER_ONLY/FACILITATOR`.

---

# 14. Mutation testing requerido para reglas críticas

Para evitar una suite que “pase” sin realmente proteger las reglas, se recomienda mutation testing sobre:

- límites 3/6/7/11/12/15 del CV;
- comparación `<` vs `<=` en rolls de habilidades/reactions;
- threshold viral `>8` y variante `>6`;
- razón 2:1;
- floor de VP/resources;
- strict majority de Veto;
- once-per-turn flags;
- order de iniciativa;
- atribución de cubes;
- objetivos `>`, `>=` y condiciones “todas”.

Un mutant que cambie cualquiera de esos operadores debe ser detectado por al menos un test P0.

---

# 15. Test de regresión de reglas y versionado

Cada partida fija:

```text
ruleset_version
scenario_version
card_registry_version
decision_baseline_version
```

Cuando una regla cambie:

1. no modificar fixtures históricos en sitio;
2. crear nueva versión;
3. conservar golden tests del ruleset anterior si debe soportarse replay;
4. añadir regression test que demuestra la diferencia intencional;
5. actualizar CHANGELOG/DECISIONS cuando corresponda.

---

# 16. Definition of Done del futuro Game Engine MVP

No basta con “funciona en UI”. Para declarar Game Engine MVP:

- [ ] Todos los P0 de esta especificación pasan.
- [ ] Toda matriz ERT está exhaustivamente cubierta.
- [ ] Cada Action/Reaction/Starter especial tiene al menos un happy path y un edge/failure path.
- [ ] Cada Regime Ability tiene success/failure/cost boundary.
- [ ] Cada VO tiene positive/boundary/negative coverage.
- [ ] Cero invariantes rotas en property tests.
- [ ] Cero fugas en security tests.
- [ ] Replay reproduce hashes finales.
- [ ] Idempotency/concurrency pasan bajo ejecución paralela.
- [ ] Toda campaña produce trace completa.
- [ ] Facilitator overrides quedan auditados.
- [ ] No hay tests P0 `skip`/`todo` sin waiver registrado.

---

# 17. Estado de esta especificación

La v0.1 es suficiente para servir como **oráculo de implementación** del Game Engine central. No implica que el código esté autorizado/iniciado; únicamente reduce el riesgo de implementar reglas ambiguas o de ajustar tests a posteriori para acomodar comportamiento accidental.

El siguiente entregable recomendado, todavía previo a programación, es:

**`MALIGN-AI — GAME ENGINE INTERFACE & COMMAND CONTRACT SPECIFICATION v0.1`**

Ese documento definirá commands, responses, typed errors, choice/reaction payloads, event envelopes y contratos de proyección sin elegir todavía framework, endpoint HTTP ni esquema SQL físico.
