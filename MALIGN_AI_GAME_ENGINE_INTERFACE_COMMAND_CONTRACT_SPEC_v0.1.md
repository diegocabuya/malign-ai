# MALIGN-AI — GAME ENGINE INTERFACE & COMMAND CONTRACT SPECIFICATION v0.1

**Fecha:** 2026-08-22  
**Fase:** FASE 2 — especificación del Game / Adjudication Engine  
**Estado:** DRAFT BASELINE / contrato lógico previo a implementación  
**Código:** NO iniciado  
**Predecesores:** `MALIGN_AI_ADJUDICATION_ENGINE_SPEC_v0.1.md`, `MALIGN_AI_GAME_ENGINE_TEST_ACCEPTANCE_SPEC_v0.1.md`, `MALIGN_AI_GAME_DATA_MODEL_SPEC_v0.1.md`, `MALIGN_AI_DATA_DICTIONARY_ER_SPEC_v0.1.md`, `MALIGN_AI_INFORMATION_SECURITY_MATRIX_v0.1.md`, `DECISIONS.md`

> Este documento define **cómo se invoca y observa** el futuro Game Engine de MALIGN-AI. No elige todavía HTTP/REST, WebSocket, RPC, framework backend, base de datos física ni librería de validación. Los nombres y schemas son contratos lógicos. Cuando una decisión es puramente técnica y aún no consta en `DECISIONS.md`, se considera **PROPUESTA TÉCNICA BASELINE**, no una nueva regla oficial de Malign.

---

# 1. Propósito

El contrato debe permitir que cualquier cliente autorizado —Web App, Facilitator Console, test harness y, de manera indirecta, AI Orchestration— interactúe con el Game Engine sin conocer su implementación interna.

El patrón normativo es:

```text
Authenticated Actor
      ↓
CommandEnvelope
      ↓
Authorization + version check + rule validation
      ↓
Deterministic Game Engine
      ↓
CommandResult
  ├─ state/version change
  ├─ domain events
  ├─ ledger/mutations
  ├─ AdjudicationTrace
  └─ suspended interaction, if any
      ↓
Visibility Projection
      ↓
Authorized Client / AI Context
```

El contrato debe conservar:

1. determinismo condicionado;
2. atomicidad;
3. optimistic concurrency;
4. idempotencia;
5. reglas de privacidad por rol;
6. suspensión/reanudación por elecciones, reacciones, Veto o facilitador;
7. auditabilidad y replay;
8. versionado independiente de ruleset, escenario, cartas e interfaz.

---

# 2. Principios del contrato

## 2.1 Command ≠ UI action

La UI puede tener múltiples gestos para preparar una acción. El Game Engine recibe sólo comandos semánticos del dominio.

Ejemplo:

```text
UI drag card → campaign slot
UI select target
UI reorder action slots
        ↓
SET_ACTION_PLAN
```

No se modelan comandos como `CLICK_CARD` o `OPEN_MODAL`.

## 2.2 Query ≠ Command

- `Command`: puede mutar estado autoritativo.
- `Query`: sólo devuelve una proyección autorizada.

Una Query nunca incrementa `game_version`.

## 2.3 AI Engine sin autoridad directa

El AI Engine puede producir una **propuesta de command** para revisión del usuario, pero no debe poseer credenciales de mutación autónoma del Game State. El actor humano/flujo autorizado confirma; el Game Engine valida.

## 2.4 Contratos transport-agnostic

Los schemas lógicos de este documento podrán mapearse posteriormente a:

- TypeScript types;
- JSON Schema;
- Zod/Valibot u otro validador;
- REST/RPC/WebSocket;
- colas/event streams.

No se escoge ninguna opción en esta v0.1.

---

# 3. Identidad y versiones

Toda partida fija al comenzar:

```text
game_id
ruleset_version
scenario_version
card_registry_version
```

La interfaz añade:

```text
engine_contract_version
```

**PROPUESTA TÉCNICA BASELINE:** `engine_contract_version` usa SemVer independiente de las reglas.

Ejemplo:

```text
ruleset_version        = "malign-ai-rules/1.0.0"
scenario_version       = "base-scenario/1.0.0"
card_registry_version  = "es-physical-set/1.0.0"
engine_contract_version= "1.0.0"
```

Una actualización del API/contrato no cambia el ruleset de una partida histórica.

---

# 4. ActorContext

La autenticación del usuario pertenece a la capa de aplicación, pero el Engine debe recibir un contexto de actor verificado.

```text
ActorContext
  actor_id
  actor_type: PLAYER | FACILITATOR | SYSTEM
  participant_id?        // para player/facilitator participant
  player_seat_id?        // si aplica
  country_id?            // si aplica
  authenticated_session_id
  permissions[]
  temporary_visibility_grant_ids[]
```

No se acepta `country_id` enviado libremente por el cliente como prueba de autoridad. Debe derivarse del contexto autenticado.

---

# 5. CommandEnvelope

Todo comando mutante usa el envelope lógico:

```text
CommandEnvelope<TPayload>
  engine_contract_version
  command_id
  idempotency_key
  game_id
  actor_context_ref
  expected_game_version
  command_type
  payload_schema_version
  payload: TPayload
  client_submitted_at?       // informativo, no autoritativo
  correlation_id?            // tracing cross-service
  causation_id?              // command/event previo si aplica
```

## 5.1 Campos normativos

- `command_id`: UUID/ULID único generado por cliente o gateway.
- `idempotency_key`: clave estable para reintentos de la misma intención.
- `expected_game_version`: versión observada por el cliente al construir el command.
- `command_type`: discriminante tipado.
- `payload_schema_version`: versión del payload de ese command.

## 5.2 Campos que NO deben estar en el payload

Nunca confiar en valores derivados que el Engine pueda calcular:

```text
NO: current_resources
NO: current_ap
NO: current_vp
NO: calculated_cv
NO: ert_result
NO: legitimacy_bonus
NO: is_authorized
```

El cliente puede mostrarlos, pero el Engine los recalcula desde estado autoritativo.

---

# 6. Idempotencia

**PROPUESTA TÉCNICA BASELINE:** la unicidad se aplica por:

```text
(game_id, actor_id, idempotency_key)
```

Reglas:

1. mismo key + mismo command/payload canónico → devolver el resultado original;
2. mismo key + payload distinto → `IDEMPOTENCY_KEY_REUSED`;
3. un retry idempotente no incrementa de nuevo `game_version`;
4. no duplica eventos, ledgers, tiradas ni trazas;
5. el resultado idempotente conserva referencias a los artefactos originales.

Para detectar reutilización incorrecta, el Engine puede persistir un `command_fingerprint` canónico.

---

# 7. Optimistic concurrency

Todo command autoritativo de juego requiere `expected_game_version`.

```text
if expected_game_version != current_game_version:
    REJECTED(STALE_STATE_VERSION)
```

Excepción: un retry con idempotency key ya completado devuelve el resultado original antes de intentar una nueva ejecución.

**PROPUESTA TÉCNICA BASELINE:** cada transacción autoritativa confirmada incrementa `game_version` exactamente una vez, aunque emita múltiples Domain Events.

---

# 8. CommandResult

```text
CommandResult
  command_id
  game_id
  status
  game_version_before
  game_version_after
  result_code
  result_payload?             // filtrado para actor
  emitted_event_refs[]
  adjudication_trace_refs[]
  pending_interaction?
  actor_projection_delta?
  error?
  resolved_at
```

## 8.1 Status

```text
ACCEPTED
REQUIRES_CHOICE
REQUIRES_REACTION
REQUIRES_FACILITATOR
RESOLVED
REJECTED
```

Semántica:

- `ACCEPTED`: estado válido persistido, pero no constituye una adjudicación final del flujo (p. ej. draft de plan guardado).
- `REQUIRES_CHOICE`: scheduler suspendido por una elección autorizada.
- `REQUIRES_REACTION`: existe Reaction Window activa.
- `REQUIRES_FACILITATOR`: requiere resolución humana autorizada.
- `RESOLVED`: command y continuaciones automáticas asociadas terminaron.
- `REJECTED`: no se produjo mutación normativa del Game State por ese command.

## 8.2 `pending_interaction`

Discriminated union:

```text
ChoiceRequest
ReactionWindowProjection
FacilitatorRequest
ManualDieRequest
NarrativeRequest
```

---

# 9. Typed Error Contract

```text
EngineError
  code
  category
  retryable
  safe_message_key
  safe_details?       // nunca secretos
  correlation_id?
```

## 9.1 Categorías

```text
AUTHORIZATION
PHASE_STATE
CONCURRENCY
RESOURCE
CARD
CAMPAIGN
TARGETING
REACTION
CHOICE
DICE
VOTE
RULE_INVARIANT
FACILITATOR
CONTRACT
INTERNAL
```

## 9.2 Códigos baseline

Se mantienen los definidos por Adjudication Engine y se añaden los necesarios para el contrato:

```text
WRONG_PHASE
NOT_CURRENT_ACTOR
NOT_AUTHORIZED
GAME_PAUSED
GAME_NOT_ACTIVE
GAME_ALREADY_FINISHED
STALE_STATE_VERSION
IDEMPOTENCY_KEY_REUSED
UNSUPPORTED_CONTRACT_VERSION
UNSUPPORTED_PAYLOAD_VERSION
INVALID_COMMAND_PAYLOAD
INSUFFICIENT_AP
INSUFFICIENT_RESOURCES
CARD_NOT_CONTROLLED
CARD_WRONG_ZONE
CARD_NOT_ELIGIBLE
HAND_LIMIT_VIOLATION
CAMPAIGN_ROW_OCCUPIED
CAMPAIGN_NOT_FOUND
CAMPAIGN_NOT_OWNED
CAMPAIGN_ALREADY_ACTIVATED
CAMPAIGN_INVALID_STRUCTURE
CAMPAIGN_ALIGNMENT_MISMATCH
INVALID_SLOT
INVALID_DT
INVALID_TARGET_PD
TARGET_NO_LONGER_EXISTS
REACTION_NOT_ELIGIBLE
REACTION_WINDOW_CLOSED
REACTION_NOT_CURRENT_PRIORITY
CHOICE_NOT_AUTHORIZED
CHOICE_ALREADY_RESOLVED
CHOICE_VERSION_STALE
INVALID_CHOICE_OPTION
REGIME_ABILITY_ALREADY_USED
ROLL_MODIFIER_ALREADY_USED
LEGITIMACY_CAP_REQUIRES_CHOICE
INVALID_DIE_VALUE
DIE_REQUEST_NOT_FOUND
DIE_ALREADY_RESOLVED
MANUAL_DIE_CONFIRMATION_REQUIRED
VOTE_ALREADY_CAST
VETO_CASE_CLOSED
COST_PAYMENT_FAILED
OBJECT_NO_LONGER_VALID
TRANSFER_NOT_CONFIRMED
TRANSFER_NO_LONGER_VALID
FACILITATOR_REASON_REQUIRED
```

## 9.3 Anti-leakage

Un error nunca debe confirmar secretos del rival.

Ejemplo prohibido:

```text
"P3 no puede reaccionar porque no tiene Contrainteligencia en mano"
```

Respuesta permitida para una acción no autorizada:

```text
REACTION_NOT_ELIGIBLE
```

La explicación detallada sólo puede existir en el audit trace visible al facilitador si corresponde.

---

# 10. Catálogo de Commands — Lifecycle / Setup

Todos los comandos de esta sección son de Facilitator salvo indicación.

## 10.1 `CREATE_GAME`

Responsabilidad de dominio: crear instancia aún no activa y fijar versiones solicitadas.

Payload lógico:

```text
scenario_definition_id
ruleset_version
scenario_version
card_registry_version
turn_limit
preferred_dice_mode: DIGITAL | MANUAL_DIE_INPUT
```

Resultado:

```text
game_id
status = SETUP
pinned_versions
```

## 10.2 `ASSIGN_PLAYER_SEAT`

```text
player_participant_id
country_id
seat_index
```

MVP: exactamente un jugador por cada una de las cinco facciones.

## 10.3 `CONFIGURE_GAME_OPTION`

Sólo opciones previamente declaradas en `ScenarioRuleConfig`/ruleset.

```text
option_id
value
```

No permite introducir reglas libres por string.

## 10.4 `START_GAME`

Sin payload de reglas. El Engine valida setup completo, fija el snapshot inicial y entra a Strategy Stage.

## 10.5 `PAUSE_GAME`

```text
reason_code
reason_text?
```

## 10.6 `RESUME_GAME`

```text
reason_code?
```

## 10.7 `ABANDON_GAME`

```text
reason_code
reason_text
```

No equivale a adjudicar victoria.

---

# 11. Strategy Commands

## 11.1 `SUBMIT_OPERATIONS_DECK`

```text
card_instance_ids[30]
```

El Engine valida:

- control/ownership;
- 30 cartas exactamente;
- ninguna Starter;
- todas pertenecen al pool legal de ese país/set;
- sin exceder multiplicidades físicas disponibles en el set.

La composición permanece privada para owner + facilitator.

## 11.2 `LOCK_STRATEGY`

```text
no payload
```

Cuando todos los jugadores han bloqueado, el scheduler puede continuar a shuffle/initial draw conforme al ruleset.

---

# 12. Initiative Commands

## 12.1 `REQUEST_INITIATIVE_ROLL`

En modo DIGITAL el Engine genera el d10 y resuelve/continúa automáticamente.

En modo MANUAL:

```text
CommandResult.status = REQUIRES_CHOICE or ACCEPTED
pending_interaction = ManualDieRequest
```

La necesidad exacta de input se modela mediante `DieRequest`, no con un campo ad hoc.

## 12.2 `SET_INITIATIVE_MAINTENANCE`

Permite preparar en una operación la decisión de descarte antes de fill-to-10.

```text
discard_card_instance_ids[]
```

El Engine ejecuta discard → draw/reshuffle/fill-to-10 → income cuando corresponde al turno de maintenance del jugador.

## 12.3 `LOCK_INITIATIVE_MAINTENANCE`

Marca al participante listo cuando el flujo requiera explicit readiness.

---

# 13. Negotiation / Transfer Commands

Los acuerdos/promesas no son vinculantes. El motor sólo muta estado por transferencias confirmadas.

## 13.1 `PROPOSE_TRANSFER`

```text
recipient_participant_id
items[]:
  RESOURCE { quantity }
  CARD { card_instance_id }
private_note?   // collaboration metadata; no regla
```

Crea una propuesta revocable. No transfiere todavía.

## 13.2 `CONFIRM_TRANSFER`

```text
transfer_proposal_id
```

La transferencia sólo se ejecuta cuando se cumplen las confirmaciones requeridas y las precondiciones siguen válidas.

## 13.3 `REJECT_TRANSFER`

```text
transfer_proposal_id
```

## 13.4 `CANCEL_TRANSFER`

Sólo proponente antes de ejecución.

Las promesas narrativas más amplias pueden vivir en un servicio de colaboración; no necesitan mutar Game State.

---

# 14. Action Planning Commands

## 14.1 Diseño del plan

**PROPUESTA TÉCNICA BASELINE:** el plan autoritativo puede guardarse y editarse mientras no esté bloqueado.

Esto evita que la UI dependa sólo de estado local y permite reconexión sin revelar el plan a rivales.

## 14.2 `SET_ACTION_PLAN`

Payload:

```text
action_slots[]   // 0..3, sequence_index único 1..3
  sequence_index
  action_type
  action_payload
```

Tipos de `action_type`:

```text
CONSTRUCT_CAMPAIGN
MODIFY_CAMPAIGN
ACTIVATE_CAMPAIGN
PLAY_ACTION_CARD
ACTIVATE_REGIME_ABILITY
```

El Engine valida estructura/ownership y mueve las CardInstances comprometidas a zonas privadas de planificación según corresponda.

Mientras el plan no esté bloqueado:

- puede reemplazarse por otro `SET_ACTION_PLAN`;
- cartas retiradas del nuevo plan vuelven a la zona apropiada;
- no se consumen AP todavía;
- sigue aplicando el hand limit estable.

## 14.3 Payload `CONSTRUCT_CAMPAIGN`

```text
row = I
intent_card_instance_id
method_card_instance_id
amplifier_card_instance_id?
target_dt_id
```

El target PD no tiene por qué fijarse aquí si el ruleset permite seleccionar el objetivo durante resolución; en ese caso se genera ChoiceRequest posteriormente.

## 14.4 Payload `MODIFY_CAMPAIGN`

```text
campaign_id
slot: METHOD | AMPLIFIER
replacement_card_instance_id
```

Permite llenar Amplifier vacío conforme DEC-046.

## 14.5 Payload `ACTIVATE_CAMPAIGN`

```text
campaign_id
requested_target_pd_id?   // si el cliente ya seleccionó uno válido
```

El Engine recalcula target eligibility al resolver.

## 14.6 Payload `PLAY_ACTION_CARD`

```text
card_instance_id
preselected_targets?      // sólo IDs; el Engine valida o pide ChoiceRequest
```

## 14.7 Payload `ACTIVATE_REGIME_ABILITY`

```text
regime_ability_definition_id
preselected_target_pd_id?
```

## 14.8 `LOCK_ACTION_PLAN`

```text
no payload
```

Al resolver:

- plan deja de ser editable;
- se consumen AP de los slots;
- plan permanece privado hasta su reveal/timing;
- `PlayerPhaseReadiness=LOCKED`.

Si todos han bloqueado, scheduler entra a Resolution.

## 14.9 `UNLOCK_ACTION_PLAN`

**No forma parte del baseline normal de jugador.** Sólo Facilitator puede efectuar una reapertura administrativa auditada antes de Resolution si fuera imprescindible.

---

# 15. Starter Card Commands

Starter Cards de uso inmediato durante Action planning se resuelven con comandos explícitos, no como slots de 1 AP.

## 15.1 `PLAY_STARTER_CARD`

```text
card_instance_id
starter_payload
```

`starter_payload` es discriminado por definición de carta.

Ejemplos:

### `Increased Budget / Presupuesto Aumentado`

```text
{}
```

### `Priority Policy / Política Prioritaria`

```text
selected_effect / parameters según Card Registry
```

### `Policy Pivot / Giro de Política`

```text
selected_cards / parameters según Card Registry
```

`Wild Intent / Intención Libre` no se modela como free-play separado cuando funciona como componente de campaña; se compromete dentro de `SET_ACTION_PLAN` y conserva su lifecycle específico.

`Veto` usa Reaction/Veto contract.

---

# 16. Resolution Scheduler Interface

El scheduler es interno. Los jugadores no envían `RESOLVE_NEXT_ACTION`.

El Engine avanza automáticamente hasta encontrar un punto que requiera input externo:

```text
NARRATIVE_REQUIRED
CHOICE_REQUIRED
REACTION_WINDOW
MANUAL_DIE_REQUIRED
FACILITATOR_REVIEW_REQUIRED
```

Al recibir el input, reanuda desde el continuation token interno asociado.

**Invariante:** el cliente nunca decide cuál es el siguiente action slot autoritativo.

---

# 17. Narrative Contract

## 17.1 `NarrativeRequest`

```text
narrative_request_id
campaign_activation_id
actor_participant_id
min_sentences = 2
max_sentences = 3
status
visibility = OWNER_UNTIL_SUBMITTED_THEN_PUBLIC
```

## 17.2 `SUBMIT_NARRATIVE`

```text
narrative_request_id
text
```

El sistema puede calcular métricas objetivas (p. ej. sentence count), pero la evaluación semántica/plausibilidad no pertenece al LLM como autoridad.

Si se requiere revisión:

```text
CommandResult.status = REQUIRES_FACILITATOR
pending_interaction = FacilitatorRequest
```

---

# 18. ChoiceRequest Contract

Toda decisión normativamente relevante se representa explícitamente.

```text
ChoiceRequest
  choice_id
  choice_version
  game_id
  choice_type
  actor_participant_id
  source_resolution_id
  source_event_id?
  visibility_scope
  status: OPEN | RESOLVED | CANCELLED
  selection_mode: SINGLE | MULTI | ORDERED | BOOLEAN | NUMERIC
  min_selections
  max_selections
  options[]
  constraints?
  expires_at?          // null por default; no auto-timeout normativo
```

## 18.1 ChoiceOption

```text
ChoiceOption
  option_id            // opaque ID
  option_type
  entity_ref?
  safe_label?
  metadata?            // ya filtrada para actor
```

Nunca enviar al actor opciones que no está autorizado a conocer.

## 18.2 Choice types baseline

```text
SELECT_TARGET_PD
SELECT_DT
SELECT_CARD_FROM_HAND
SELECT_CARD_FROM_DISCARD
SELECT_DECK_CARD
SELECT_OPPOSITE_ATTRIBUTION_TO_REMOVE
SELECT_LEGITIMACY_TO_REPLACE
SELECT_VIRAL_DESTINATION
SELECT_VIRAL_TYPE_ON_TIE
COALITION_CONTRIBUTION
VETO_VOTE
HAND_LIMIT_DISCARD
SELECT_ACTION_CARD_TO_DISCARD
SELECT_STOLEN_HAND_POSITION
```

## 18.3 `SUBMIT_CHOICE`

```text
choice_id
choice_version
selected_option_ids[]
```

Validaciones:

- actor autorizado;
- choice OPEN;
- version actual;
- cardinalidad válida;
- options pertenecen al set calculado;
- estado subyacente aún compatible.

No se aceptan objetos arbitrarios como respuesta; sólo `option_id` emitidos por el Engine, salvo choices numéricos expresamente tipados.

---

# 19. ReactionWindow Contract

```text
ReactionWindow
  reaction_window_id
  game_id
  trigger_type
  source_event_id
  source_resolution_id
  source_actor_participant_id
  parent_reaction_window_id?
  status: OPEN | RESOLVED | CANCELLED
  priority_order_participant_ids[]
  current_priority_index
  current_priority_participant_id
  allowed_reaction_types[]
  opened_at
```

## 19.1 Regla anti-side-channel crítica

`priority_order_participant_ids` indica **quién puede tener derecho normativo a responder al trigger**, no quién realmente posee una carta elegible.

El Engine **no revela la mano** mediante la existencia o ausencia de elegibilidad.

Ejemplo:

- si P3 es el target de una acción a la que podría responder Contrainteligencia, P3 recibe turno de reacción;
- los demás no reciben una señal de si P3 efectivamente posee Contrainteligencia;
- P3 puede jugar una reacción válida o pasar.

## 19.2 `PLAY_REACTION`

```text
reaction_window_id
card_instance_id
reaction_payload?
```

Puede abrir una child Reaction Window sólo cuando el ruleset/card trigger lo contempla (p. ej. Ciberseguridad contra Hack Back).

## 19.3 `PASS_REACTION`

```text
reaction_window_id
```

Sólo el participant con prioridad actual puede pasar.

## 19.4 Cierre

La ventana cierra conforme al ruleset cuando:

- todos los participantes con prioridad relevante han pasado;
- una reacción resuelve/cancela el trigger y no existe child window pendiente;
- el trigger deja de existir;
- Facilitator cancela por una excepción auditada.

---

# 20. Veto Contract

Veto usa Reaction Window especializada.

## 20.1 `PLAY_VETO`

Semánticamente puede implementarse como `PLAY_REACTION` con la Starter Card Veto, pero el contrato expone un alias de dominio claro:

```text
reaction_window_id
veto_card_instance_id
reason_text
```

Al aceptarse:

```text
VetoCase
  veto_case_id
  campaign_activation_id
  initiator_participant_id
  offending_participant_id
  reason_text
  defense_text?
  status
```

## 20.2 `SUBMIT_VETO_DEFENSE`

```text
veto_case_id
defense_text
```

## 20.3 `CAST_VETO_VOTE`

```text
veto_case_id
vote: ACCEPT_NARRATIVE | REJECT_NARRATIVE
```

Una persona sólo vota una vez. El Engine calcula la mayoría aprobada por ruleset/DECISIONS; el cliente no envía el resultado.

---

# 21. Dice Contract

## 21.1 `DieRequest`

```text
DieRequest
  die_request_id
  game_id
  purpose
  die_type = D10
  requested_for_participant_id?
  source_mode: DIGITAL | MANUAL_DIE_INPUT
  status: OPEN | RESOLVED | CANCELLED
  visibility_scope
  modifier_policy_ref?
```

Purposes mínimos:

```text
INITIATIVE
CAMPAIGN_ERT
REGIME_ARDEN
REGIME_PRESQUE
REACTION_ANTI_CORRUPTION
REACTION_RIGHT_OF_FIRST_REFUSAL
CYBER_THEFT
VIRAL_SPREAD_CHECK
VIRAL_CUBE_COUNT
OTHER_CARD_CHECK
```

## 21.2 DIGITAL

No requiere command de usuario para el valor. El Engine obtiene el valor 1..10 de Dice Service y registra `rng_request_id`.

## 21.3 `SUBMIT_MANUAL_DIE`

```text
die_request_id
value: 1..10
```

Registra submitter y `manual=true`.

## 21.4 `CONFIRM_MANUAL_DIE`

Sólo si la configuración/facilitador exige confirmación:

```text
die_request_id
confirm: true | false
reason_text?   // obligatorio si false
```

El Engine nunca acepta un valor de dado incluido directamente dentro de `ACTIVATE_CAMPAIGN` o similar.

---

# 22. Resource / Roll Modifier Commands durante Activation

Cuando el ruleset ofrece decisiones pre-roll, el Engine abre ChoiceRequest específico.

No se recomienda un command genérico `SPEND_RESOURCE` porque permitiría pagos sin semántica.

Ejemplos:

```text
SUBMIT_CHOICE(CAMPAIGN_CORE_ROLL_MODIFIER = USE / DECLINE)
SUBMIT_CHOICE(COALITION_CONTRIBUTION = CONTRIBUTE / DECLINE)
```

Los pagos se generan como consecuencia de la selección válida.

---

# 23. FacilitatorRequest Contract

```text
FacilitatorRequest
  facilitator_request_id
  request_type
  game_id
  source_resolution_id?
  subject_participant_id?
  safe_context
  full_context_ref       // sólo facilitator projection
  status
```

Tipos mínimos:

```text
NARRATIVE_REVIEW
VETO_ABUSE_REVIEW
MANUAL_DIE_CONFIRMATION
RULE_EXCEPTION
STATE_CORRECTION_REVIEW
DISCONNECTION_FORCE_ACTION
```

---

# 24. Facilitator Commands

Todos exigen `actor_type=FACILITATOR` y reason/audit cuando afectan reglas o estado.

## 24.1 `FACILITATOR_REVIEW_NARRATIVE`

```text
facilitator_request_id
decision: ACCEPT | APPLY_LENGTH_PENALTY | APPLY_READ_CARD_PENALTY | OTHER_APPROVED
reason_code
reason_text?
```

`OTHER_APPROVED` debe producir una FacilitatorDecision explícita y puede marcar `noncanonical` si altera el baseline.

## 24.2 `FACILITATOR_RESOLVE_VETO_ABUSE`

```text
veto_case_id
decision: ALLOW_VETO | CANCEL_VETO_AS_ABUSE
reason_text
```

## 24.3 `FACILITATOR_FORCE_PASS`

```text
pending_interaction_id
participant_id
reason_code
reason_text
```

No puede fabricar una carta/reacción inexistente; sólo elige la opción neutral/pass disponible.

## 24.4 `FACILITATOR_FORCE_LOCK`

```text
participant_id
phase
reason_code
reason_text
```

Por defecto bloquea el estado ya guardado; no inventa acciones nuevas.

## 24.5 `FACILITATOR_RESOLVE_EXCEPTION`

```text
facilitator_request_id
decision_code
structured_parameters?
reason_text
```

Debe usar un catálogo de decision codes versionado. No se ejecuta código arbitrario ni scripts enviados por texto.

## 24.6 `FACILITATOR_APPLY_STATE_CORRECTION`

Contrato de alto riesgo:

```text
correction_type
entity_ref
expected_current_value
new_value
reason_code
reason_text
```

Requisitos:

- optimistic concurrency;
- before/after snapshot refs;
- GameEvents de dominio correspondientes;
- `GAME_STATE_OVERRIDE_AUDITED`;
- `noncanonical=true` cuando altera un resultado/regla histórica.

No se permite un payload genérico `patch: any` para el MVP.

## 24.7 `FACILITATOR_SET_DICE_MODE`

Sólo en puntos permitidos por configuración de partida; cambiar modo durante una tirada abierta está prohibido.

```text
mode: DIGITAL | MANUAL_DIE_INPUT
reason_text?
```

---

# 25. Internal System Commands / Scheduler Actions

Algunas transiciones son internas y no deben exponerse como autoridad de jugador:

```text
ADVANCE_PHASE_IF_READY
RESOLVE_NEXT_ACTION_SLOT
OPEN_REACTION_WINDOW
CLOSE_REACTION_WINDOW
REQUEST_DIE
APPLY_ERT
APPLY_INFLUENCE_2_TO_1
EVALUATE_LEGITIMACY
APPLY_SCORING
AGE_CAMPAIGNS
SNAPSHOT_VIRAL_ORIGINS
RESOLVE_VIRAL_ORIGIN
EVALUATE_VICTORY_OBJECTIVES
FINALIZE_GAME_OUTCOME
```

Pueden existir como funciones/commands internos testeables, pero no son parte de la API de mutación del cliente.

---

# 26. Domain Event Envelope

El Event Log canónico usa:

```text
DomainEventEnvelope<TPayload>
  event_id
  game_id
  sequence_number
  game_version
  event_type
  event_payload_version
  aggregate_type
  aggregate_id
  actor_type
  actor_id?
  command_id?
  correlation_id?
  causation_event_id?
  ruleset_version
  scenario_version
  card_registry_version
  visibility_policy_id
  payload: TPayload
  occurred_at
```

## 26.1 Orden

- `sequence_number` es monotónico por `game_id`.
- múltiples events del mismo command comparten `game_version` confirmado.
- `occurred_at` no sustituye `sequence_number` para ordering autoritativo.

## 26.2 Payload histórico

Los payloads persistidos son inmutables. Si el schema evoluciona:

- conservar `event_payload_version`;
- agregar upcaster/migración de lectura si fuera necesaria;
- no reescribir silenciosamente eventos históricos.

---

# 27. Event Taxonomy mínima de interfaz

El Adjudication Engine mantiene el catálogo normativo. Para integración, como mínimo deben ser observables familias de:

```text
GAME_CREATED
GAME_STARTED
GAME_PAUSED
GAME_RESUMED
PHASE_CHANGED
TURN_STARTED
TURN_ENDED
PLAYER_READY_CHANGED
INITIATIVE_ROLLED
INITIATIVE_ORDER_SET
RESOURCE_CHANGED
AP_COMMITTED
CARD_MOVED
DECK_SHUFFLED
CARD_DRAWN
ACTION_PLAN_SAVED
ACTION_PLAN_LOCKED
ACTION_REVEALED
CAMPAIGN_CREATED
CAMPAIGN_MODIFIED
CAMPAIGN_ACTIVATION_STARTED
NARRATIVE_SUBMITTED
REACTION_WINDOW_OPENED
REACTION_PLAYED
REACTION_PASSED
REACTION_WINDOW_CLOSED
VETO_OPENED
VETO_VOTE_CAST
VETO_RESOLVED
CHOICE_REQUESTED
CHOICE_RESOLVED
DIE_REQUESTED
DIE_ROLLED
MODIFIER_APPLIED
CAMPAIGN_COST_PAID
ERT_RESOLVED
INFLUENCE_MUTATED
LEGITIMACY_CHANGED
VP_CHANGED
CAMPAIGN_DISCARDED
REGIME_ABILITY_RESOLVED
VIRAL_ORIGIN_IDENTIFIED
VIRAL_RESOLVED
VICTORY_OBJECTIVE_EVALUATED
VICTORY_OBJECTIVE_AWARDED
GAME_OUTCOME_FINALIZED
FACILITATOR_DECISION_RECORDED
GAME_STATE_OVERRIDE_AUDITED
```

No todos los events son públicos.

---

# 28. Client Event Projection

El event log completo no se transmite directamente a jugadores.

Se define una proyección:

```text
ProjectedEvent
  event_id
  game_id
  sequence_number
  game_version
  event_type
  public_or_authorized_payload
  occurred_at
```

La capa de autorización puede:

- ocultar completamente un evento;
- redactar campos;
- sustituir una identidad por conteo público;
- revelar contenido temporalmente a un destinatario autorizado.

Ejemplo:

```text
Canonical event: CARD_DRAWN(card_instance_id=X, player=P2)
P2 projection: identity X
P1 projection: "P2 drew 1 card" or no event, según matriz
Facilitator: full identity X
```

---

# 29. Query Contracts

Queries no mutan estado y no usan idempotency key.

## 29.1 `GET_GAME_PROJECTION`

Request:

```text
game_id
viewer_context
at_game_version?    // opcional para replay autorizado
```

Response:

```text
GameProjection
  game_id
  game_version
  status
  turn
  phase
  initiative
  public_state
  viewer_private_state
  pending_interactions_for_viewer[]
  permissions
  pinned_versions
```

## 29.2 `GET_PLAYER_PRIVATE_STATE`

Puede ser una subproyección de `GET_GAME_PROJECTION`; no debe requerir un endpoint independiente en implementación si no aporta valor.

Incluye sólo para owner/facilitator:

- own hand identities;
- own secret objectives/progress;
- own face-down plan;
- own private campaign/DT data;
- authorized TemporaryReveal.

## 29.3 `GET_EVENT_FEED`

```text
game_id
after_sequence_number
limit
viewer_context
```

Devuelve sólo `ProjectedEvent` autorizados.

## 29.4 `GET_ADJUDICATION_TRACE`

```text
trace_id
viewer_context
```

El Facilitator recibe full trace. Jugadores reciben versión filtrada.

## 29.5 `GET_RULE_CAPABILITIES`

Devuelve capacidades del contract/ruleset para que el cliente no hardcodee flags de versiones:

```text
engine_contract_version
supported_command_types[]
supported_query_types[]
supported_payload_versions
ruleset_capabilities
```

---

# 30. GameProjection — contrato de visibilidad

La proyección no debe ser una serialización directa de tablas internas.

## 30.1 Public state

Incluye:

- scenario narrative y atributos PD públicos;
- turn/phase/initiative;
- VP totals;
- Resource totals;
- influence/resiliency y attribution en mapa;
- legitimacy;
- hand sizes;
- Operations Deck remaining counts;
- discard pile identities;
- revealed campaigns/actions;
- narrative declarada;
- Veto/votes/resultados conforme timing.

## 30.2 Viewer private state

Para jugador owner:

- hand identities;
- Operations Deck composition, no future order;
- planned face-down actions;
- own face-down campaign details;
- face-down target DT;
- Secret VOs y progress;
- own private negotiation;
- active TemporaryReveal permitido.

## 30.3 Facilitator projection

Puede ver todo excepto que **el orden futuro del Operations Deck no se expone como UI normal**, aunque esté almacenado técnicamente. Puede auditar shuffles/draws sin recibir la secuencia futura, salvo herramienta de debugging excepcional fuera del gameplay y debidamente auditada.

---

# 31. AI Authorization Contract

El AI Orchestration Layer no consulta tablas crudas del juego.

Debe recibir:

```text
AIContextRequest
  game_id
  requesting_participant_id
  ai_role: PLAYER_ASSISTANT | FACILITATOR_ASSISTANT
  purpose
  requested_context_classes[]
```

Y sólo obtener una proyección autorizada equivalente o más restrictiva que la UI del actor.

**Invariantes:**

1. filtrado antes del prompt;
2. Secret VO rival nunca llega al Player AI;
3. opponent hand identities nunca llegan al Player AI;
4. future deck order nunca llega a ningún LLM;
5. TemporaryReveal sólo se incluye mientras el grant esté vigente;
6. el AI no recibe un `CommandAuthorityToken` autónomo.

---

# 32. Command Authority Matrix

| Command family | Player | Facilitator | System |
|---|:---:|:---:|:---:|
| CREATE/CONFIGURE/START GAME |  | ✓ |  |
| PAUSE/RESUME |  | ✓ |  |
| SUBMIT_OPERATIONS_DECK | owner | inspect |  |
| LOCK_STRATEGY | owner | force | scheduler |
| REQUEST_INITIATIVE_ROLL | owner/current | force/admin | scheduler |
| SET_INITIATIVE_MAINTENANCE | owner | force/admin |  |
| PROPOSE/CONFIRM TRANSFER | participant | inspect |  |
| SET_ACTION_PLAN | owner | inspect |  |
| LOCK_ACTION_PLAN | owner | force | scheduler |
| PLAY_STARTER_CARD | owner | inspect |  |
| SUBMIT_NARRATIVE | owner | review |  |
| SUBMIT_CHOICE | designated actor | force neutral where permitted |  |
| PLAY/PASS REACTION | priority actor | resolve abuse/exception |  |
| CAST_VETO_VOTE | active player | moderate |  |
| SUBMIT_MANUAL_DIE | designated submitter | ✓ |  |
| FACILITATOR_* |  | ✓ |  |
| Internal adjudication |  |  | ✓ |

`inspect` significa visibilidad/autoridad supervisora, no suplantación silenciosa del jugador.

---

# 33. Suspension / Continuation Contract

Una resolución suspendida debe persistir suficiente información para continuar tras reconexión o restart.

Conceptualmente:

```text
PendingResolution
  resolution_id
  continuation_type
  continuation_state_ref
  waiting_on_interaction_id
  status
  created_at
```

No se persiste una closure de memoria como única fuente de verdad.

Al resolver la interacción:

```text
SUBMIT_CHOICE / PASS_REACTION / ...
        ↓
validate pending resolution still current
        ↓
resume deterministic scheduler
```

---

# 34. Timeouts y desconexión

El Gamebook no define timeouts.

Por tanto:

- no hay auto-pass normativo por reloj en baseline;
- `expires_at` de Choice/Reaction es `null` por defecto;
- el Facilitator puede usar `FACILITATOR_FORCE_PASS` o `FACILITATOR_FORCE_LOCK` por desconexión;
- todo uso queda auditado.

Una futura variante de timer debe ser `ScenarioRuleConfig`/ruleset versionada, no comportamiento oculto del transporte.

---

# 35. Atomicidad de comandos compuestos

Un command puede causar múltiples mutations internas.

Ejemplo `ACTIVATE_CAMPAIGN` puede:

1. revelar cartas;
2. consumir recursos;
3. generar die roll;
4. ERT;
5. aplicar 2:1;
6. modificar legitimacy;
7. puntuar VP;
8. generar trace/events.

Si el command alcanza una suspensión externa antes de pagar/confirmar determinados costes, el estado de la suspensión debe seguir exactamente el pipeline del Adjudication Spec.

No se permite un “medio commit” que deje ledger y board fuera de sincronía.

---

# 36. Result payloads por privacidad

El mismo command puede producir resultados distintos por viewer.

El actor recibe un `CommandResult` con sus detalles autorizados. Otros clientes reciben después `ProjectedEvent`/`GameProjection`, nunca el raw `CommandResult` del actor.

Ejemplo: `Agente Doble` puede revelar cartas al actor autorizado y Facilitator; la identidad de esas cartas no debe estar en broadcast payload.

---

# 37. Contractos para Card Effects declarativos

El cliente no ejecuta `CardEffectDefinition`.

Para una Action/Reaction Card:

```text
PLAY_ACTION_CARD / PLAY_REACTION
      ↓
Engine resolves CardDefinition + CardEffectDefinition pinned version
      ↓
ChoiceRequests si faltan parámetros
      ↓
Rule Effect Interpreter / deterministic handlers
```

No se permite al cliente enviar:

```text
"effect": "add 3 cubes"
```

Sólo envía la carta/targets/choices permitidos; el efecto proviene del registry versionado.

---

# 38. Ruleset compatibility

## 38.1 Breaking rules changes

Si cambia una regla que altera outcomes históricos:

- nueva `ruleset_version`;
- partidas existentes permanecen fijadas a la anterior;
- tests/fixtures se versionan;
- no se reinterpretan eventos viejos.

## 38.2 Card text/effect changes

Nueva `card_registry_version`.

## 38.3 Scenario changes

Nueva `scenario_version`.

## 38.4 Interface changes

Nueva `engine_contract_version`.

Estas cuatro dimensiones no deben colapsarse en un único `app_version`.

---

# 39. SemVer policy propuesta para `engine_contract_version`

**PROPUESTA TÉCNICA BASELINE:**

- PATCH: aclaraciones/optional fields compatibles;
- MINOR: nuevos commands/events/optional payload fields compatibles;
- MAJOR: eliminación/renombre/cambio de semántica incompatible.

Todo command/event guarda su `payload_schema_version` independientemente para permitir evolución granular.

---

# 40. Canonical serialization y fingerprints

Para idempotencia, replay y test fixtures, debe existir una serialización canónica determinista de:

- Command payloads;
- rule inputs relevantes;
- projected state hashes de testing;
- AdjudicationTrace normativa.

No se prescribe algoritmo hash en v0.1.

**PROPUESTA:** en implementación futura usar hash criptográfico estándar sobre representación JSON canónica; decidir en arquitectura técnica, no aquí.

---

# 41. Correlation / causation

Cada flujo puede rastrearse:

```text
Command X
  └─ Event A
      └─ Reaction Window R
          └─ Command Y (reaction)
              └─ Event B
                  └─ Child Reaction Window R2
```

`correlation_id` agrupa la adjudicación de alto nivel. `causation_id` permite reconstruir el grafo causal sin usar timestamps como inferencia.

---

# 42. Replay contract

Replay autorizado usa:

```text
initial_snapshot
+ ordered canonical DomainEvents
+ pinned definitions/versions
→ reconstructed authoritative state
```

Debe verificarse contra un `state_hash` de checkpoint/test cuando exista.

Las proyecciones históricas se generan después del replay aplicando las reglas de visibilidad correspondientes al viewer y al momento histórico.

---

# 43. Security invariants de interfaz

1. Nunca usar un endpoint/query “full state” para Player UI y luego filtrar en frontend.
2. Autorización y redacción ocurren server-side antes de transmisión.
3. `ChoiceOption` privado sólo llega al actor autorizado.
4. Reaction windows no revelan possession de cartas por side channel.
5. Error details no revelan secretos.
6. `TemporaryReveal` expira y deja de aparecer en proyecciones posteriores.
7. Secret VO y objective progress rival nunca aparecen en event feed/player projection.
8. Future Operations Deck order nunca se expone a usuario/LLM.
9. Facilitator raw access se registra cuando sea una acción sensible de auditoría si la implementación lo soporta.
10. Game Engine ejecuta validación con estado completo; el cliente nunca es autoridad de reglas.

---

# 44. Observability mínima

El contrato técnico de implementación deberá poder correlacionar sin incluir secretos en logs operativos:

```text
request_id
command_id
game_id
actor_id
command_type
result_status
error_code?
game_version_before
game_version_after
latency_ms
correlation_id
```

No registrar por defecto:

- hand contents;
- Secret VO;
- private negotiations;
- future deck order;
- narrative text completo si no es necesario para diagnóstico.

Los datos normativos sensibles permanecen en Game Store/Audit Store con controles de acceso, no en logs generales.

---

# 45. Command catalogue consolidado

## Lifecycle / Facilitator

```text
CREATE_GAME
ASSIGN_PLAYER_SEAT
CONFIGURE_GAME_OPTION
START_GAME
PAUSE_GAME
RESUME_GAME
ABANDON_GAME
FACILITATOR_REVIEW_NARRATIVE
FACILITATOR_RESOLVE_VETO_ABUSE
FACILITATOR_FORCE_PASS
FACILITATOR_FORCE_LOCK
FACILITATOR_RESOLVE_EXCEPTION
FACILITATOR_APPLY_STATE_CORRECTION
FACILITATOR_SET_DICE_MODE
CONFIRM_MANUAL_DIE
```

## Strategy / Initiative

```text
SUBMIT_OPERATIONS_DECK
LOCK_STRATEGY
REQUEST_INITIATIVE_ROLL
SET_INITIATIVE_MAINTENANCE
LOCK_INITIATIVE_MAINTENANCE
```

## Negotiation

```text
PROPOSE_TRANSFER
CONFIRM_TRANSFER
REJECT_TRANSFER
CANCEL_TRANSFER
```

## Action planning

```text
SET_ACTION_PLAN
LOCK_ACTION_PLAN
PLAY_STARTER_CARD
```

## Resolution interactions

```text
SUBMIT_NARRATIVE
SUBMIT_CHOICE
PLAY_REACTION
PASS_REACTION
PLAY_VETO
SUBMIT_VETO_DEFENSE
CAST_VETO_VOTE
SUBMIT_MANUAL_DIE
```

La ausencia de un command público `APPLY_ERT`, `ADD_CUBES`, `ADD_VP`, `SET_LEGITIMACY`, etc. es deliberada: esas mutaciones son consecuencias del motor, no autoridad del cliente.

---

# 46. Query catalogue consolidado

```text
GET_GAME_PROJECTION
GET_EVENT_FEED
GET_ADJUDICATION_TRACE
GET_RULE_CAPABILITIES
```

Opcionalmente la implementación puede exponer consultas especializadas, pero nunca con mayor visibilidad que `GET_GAME_PROJECTION` para ese actor.

---

# 47. Test obligations derivados del contrato

Además de los 224 casos existentes, la futura suite ejecutable debe probar específicamente:

1. same idempotency key + same payload returns original result;
2. same idempotency key + different payload rejects;
3. stale version on mutation;
4. queries do not increment version;
5. one commit → one game version increment even with multiple events;
6. actor cannot spoof participant/country in payload;
7. hidden choice options never reach rival;
8. reaction window existence does not leak card possession;
9. raw CommandResult is not broadcast to rivals;
10. manual die cannot be injected in campaign command;
11. closed ChoiceRequest rejects late answer;
12. stale `choice_version` rejects;
13. reaction priority enforcement;
14. child reaction causation chain;
15. facilitator correction requires reason and audit event;
16. player cannot call facilitator commands;
17. client cannot submit direct cube/VP mutations;
18. card effects always resolve from pinned Card Registry;
19. historical game remains pinned after new rules/card version published;
20. unsupported contract/payload version rejects safely;
21. event sequence monotonicity;
22. projected event redaction by viewer;
23. AI context never exceeds actor visibility;
24. future deck order absent from all normal projections;
25. pending resolution survives process restart fixture;
26. no normative timeout auto-pass when no scenario timer is configured;
27. command error text/details do not expose secret data;
28. command fingerprint canonicalization stable across retries;
29. correlation/causation preserved through Reaction child window;
30. replay + projection produces same authorized view at checkpoint.

---

# 48. Criterios de aceptación de esta especificación

Esta v0.1 se considera suficiente antes de arquitectura de implementación cuando:

- todo cambio autoritativo del jugador/facilitador tiene un command tipado;
- todo input externo suspendible tiene contract explícito;
- no existe mutación crítica genérica accesible al jugador;
- Choice/Reaction/Dice/Veto tienen lifecycle y versionado;
- errores son tipados y seguros;
- idempotencia y optimistic concurrency están definidos;
- event envelope y ordering son inequívocos;
- queries/projections respetan la Information Security Matrix;
- AI no obtiene autoridad ni datos superiores al actor;
- versionado separa contract/rules/scenario/cards;
- tests adicionales de interfaz están enumerados.

El baseline actual cumple esos criterios como especificación lógica.

---

# 49. Qué NO decide esta v0.1

Permanece deliberadamente fuera de alcance:

- REST vs RPC vs GraphQL;
- WebSocket vs SSE para realtime;
- framework Node/Next/Nest/Fastify u otro;
- PostgreSQL schema físico;
- Redis/queues;
- proveedor de auth;
- librería RNG concreta;
- algoritmo hash concreto;
- JSON Schema/Zod concretos;
- topology de deployment;
- rate limits;
- retry policy de red;
- UI/UX de cada interaction.

Estas decisiones pertenecen a la arquitectura de implementación y no deben contaminar el contrato normativo del Game Engine.

---

# 50. Evaluación de readiness para implementación

Con los documentos existentes ya están especificados:

```text
RULES
  ↓
DATA MODEL
  ↓
ADJUDICATION PIPELINES
  ↓
TEST ORACLE
  ↓
COMMAND / QUERY / EVENT CONTRACTS
```

Por tanto, **no se identifica una laguna normativa de primer orden que obligue a seguir ampliando el Game Engine antes de diseñar su arquitectura de implementación**.

Todavía no significa que deba escribirse código inmediatamente: falta definir la arquitectura técnica mínima y el esquema físico que materializarán estos contratos.

---

# 51. Próximo entregable recomendado

**MALIGN-AI — GAME ENGINE IMPLEMENTATION ARCHITECTURE SPECIFICATION v0.1**

Objetivo:

- seleccionar estructura modular interna del Game Engine;
- definir bounded modules / packages;
- command dispatcher, validators, scheduler, effect interpreter y reducers;
- transaction boundary;
- repositories y ports;
- RNG port;
- event/audit ports;
- projection/authorization layer;
- strategy de persistencia concreta a nivel lógico-físico;
- estrategia de tests/TDD;
- decidir qué parte será TypeScript puro y qué parte dependerá de infraestructura;
- **sin construir todavía frontend ni integrar IA**.

Como esa especificación sí contiene decisiones importantes de arquitectura de software, sus elecciones deberán registrarse como `PROPOSED` y someterse a aprobación antes de iniciar la implementación.
