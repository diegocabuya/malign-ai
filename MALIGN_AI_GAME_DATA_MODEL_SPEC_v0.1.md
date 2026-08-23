# MALIGN-AI — GAME DATA MODEL SPECIFICATION v0.1

**Fecha:** 2026-08-22  
**Fase:** FASE 1 — MODELO DE DATOS  
**Estado:** DRAFT BASELINE / listo para revisión  
**Código:** NO iniciado  

> Este documento traduce la especificación de reglas, decisiones aprobadas y matriz de seguridad de MALIGN-AI a un modelo de datos lógico. No constituye implementación ni esquema SQL definitivo.

---

# 1. Objetivo del modelo

El modelo debe representar de forma determinística, auditable y versionable:

- partidas y escenarios;
- jugadores, países y permisos;
- cartas, instancias, mazos, manos y descarte;
- campañas y su ciclo de vida;
- turnos, fases, iniciativa y AP;
- recursos;
- PDs, DTs, influencia, resiliencia y legitimidad;
- acciones, reacciones y ventanas temporales;
- narrativas, vetos y negociación;
- tiradas, ERT, modificadores y adjudicación;
- VP, Victory Objectives y victoria;
- intervención del facilitador;
- trazabilidad completa y replay.

Principios:

1. **Estado actual separado del historial.**
2. **Definiciones separadas de instancias.**
3. **Reglas de escenario separadas del motor base.**
4. **Información privada protegida por autorización, no por convención de UI.**
5. **Toda mutación crítica debe derivar de un evento registrado.**
6. **La IA nunca es fuente autoritativa de Game State.**

---

# 2. Capas del modelo

```text
REFERENCE DATA
  CardDefinition
  CountryDefinition
  RegimeAbilityDefinition
  DemographicTokenDefinition
  ERTDefinition

SCENARIO DATA
  ScenarioDefinition
  ScenarioCountryConfig
  ScenarioPDDefinition
  ScenarioInitialInfluence
  VictoryObjectiveDefinition
  ScenarioRuleConfig

GAME INSTANCE
  Game
  GameParticipant
  PlayerSeat
  GameCountry
  Turn
  PhaseState
  InitiativeEntry

PLAYER STATE
  PlayerResourceState
  CardInstance
  DeckState
  HandState
  DiscardState
  PlayerMatState

BOARD STATE
  PopulationDemographicState
  InfluenceStack
  LegitimacyState

ACTION / ADJUDICATION
  PlannedAction
  ActionResolution
  ReactionWindow
  ReactionPlay
  Campaign
  CampaignCardAssignment
  NarrativeSubmission
  DieRoll
  ModifierApplication
  AdjudicationTrace

SCORING / OUTCOME
  VPTransaction
  VictoryObjectiveProgress
  VictoryObjectiveAward
  GameOutcome

COLLABORATION / HUMAN CONTROL
  VetoCase
  VetoVote
  DealPromise
  TransferTransaction
  FacilitatorDecision

AUDIT / SECURITY
  GameEvent
  VisibilityGrant
  TemporaryReveal
```

---

# 3. Identidad y versionado

Toda entidad persistente debe tener:

```text
id
created_at
updated_at
version
```

Para entidades de definición:

```text
definition_version
source_reference
status = DRAFT | ACTIVE | RETIRED
```

Para decisiones/ruleset:

```text
ruleset_id
ruleset_version
scenario_version
card_registry_version
```

Un `Game` queda fijado a esas versiones al iniciar. Una partida en curso no cambia silenciosamente si luego se actualiza una regla o carta.

---

# 4. Game

Representa una partida concreta.

```text
Game
  id
  name
  status
  ruleset_version
  scenario_definition_id
  scenario_version
  card_registry_version
  facilitator_user_id
  turn_limit
  dice_mode
  beginner_narrative_leniency
  viral_variant
  created_at
  started_at
  ended_at
```

## 4.1 Game.status

```text
DRAFT
LOBBY
SETUP
ACTIVE
PAUSED
COMPLETED
ABORTED
```

## 4.2 Invariantes

- `turn_limit >= 1` antes de `ACTIVE`.
- Exactamente 5 países activos en el MVP base.
- Máximo 1 jugador controlador por país en MVP.
- Exactamente 1 facilitador.
- No se cambia `scenario_version` después de `ACTIVE`.

---

# 5. Usuario, participante y asiento

Debe distinguirse identidad de cuenta, rol en la partida y control de facción.

```text
GameParticipant
  id
  game_id
  user_id
  role
  status
```

`role`:

```text
FACILITATOR
PLAYER
OBSERVER   # reservado para futuras variantes; no MVP base
```

```text
PlayerSeat
  id
  game_id
  participant_id
  seat_index
  clockwise_index
  country_id
```

`seat_index` y `clockwise_index` son persistentes durante la partida y permiten resolver iniciativa tras determinar el ganador de la tirada.

---

# 6. CountryDefinition y GameCountry

## 6.1 CountryDefinition

Datos estables del país:

```text
CountryDefinition
  id
  canonical_name
  regime_type
  mascot
  visual_asset_key
  color_key
  starting_resource_default
  turn_income_default
  regime_ability_definition_id
```

Cinco IDs canónicos:

```text
ARDEN
FLUMA
URSARIA
PRESQUE
DINESIA
```

## 6.2 GameCountry

Instancia del país en una partida:

```text
GameCountry
  id
  game_id
  country_definition_id
  controlling_participant_id
  current_vp
  current_resources
  legitimacy_count_on_board
```

`current_vp/current_resources` pueden funcionar como snapshots de lectura rápida, pero su autoridad debe ser reconciliable con `VPTransaction` y `ResourceTransaction`.

---

# 7. Turn y PhaseState

```text
Turn
  id
  game_id
  number
  status
  started_at
  ended_at
```

`status`:

```text
PENDING
ACTIVE
RESOLVED
```

```text
PhaseState
  id
  turn_id
  phase_type
  status
  opened_at
  locked_at
  resolved_at
```

`phase_type`:

```text
STRATEGY
INITIATIVE
ACTION
RESOLUTION
CLEANUP
```

STRATEGY se ejecuta sólo en el primer turno del modo base.

## 7.1 Action planning lock

Cada jugador debe tener un subestado:

```text
PlayerPhaseReadiness
  participant_id
  phase_state_id
  status = EDITING | LOCKED | RESOLVED
```

Una vez `LOCKED`, las acciones planificadas ya no pueden cambiar salvo intervención explícita del facilitador.

---

# 8. Initiative

```text
InitiativeRoll
  id
  turn_id
  participant_id
  attempt_number
  die_roll_id
  is_tiebreak
```

```text
InitiativeEntry
  turn_id
  participant_id
  initiative_position
  winning_roll
```

Invariante:

- exactamente una posición 1..N por jugador activo;
- en empate por primer lugar se crean nuevos `InitiativeRoll` sólo para empatados hasta resolver un ganador;
- el resto del orden deriva de `clockwise_index` desde el ganador.

---

# 9. Recursos y AP

## 9.1 Recursos

Nunca modelar recursos sólo como contador mutable. Registrar transacciones.

```text
ResourceTransaction
  id
  game_id
  turn_id
  participant_id
  delta
  reason_type
  source_entity_type
  source_entity_id
  counterparty_participant_id nullable
  created_at
```

`reason_type` mínimo:

```text
SCENARIO_SETUP
TURN_INCOME
CAMPAIGN_ACTIVATION_COST
CARD_COST
REGIME_ABILITY_COST
ERT_ROLL_BOOST
TRANSFER
CARD_EFFECT
FACILITATOR_ADJUSTMENT
```

Invariante: saldo nunca < 0.

## 9.2 Action Points

```text
ActionPointLedger
  id
  turn_id
  participant_id
  allocated
  spent
  remaining
```

Default base:

```text
allocated = 3
```

Cada `PlannedAction` que consuma AP registra `ap_cost`.

Reaction Cards no consumen AP salvo texto explícito.

---

# 10. CardDefinition

Define la semántica de una carta, no una copia física.

```text
CardDefinition
  id
  canonical_name
  category
  intent_alignment
  is_starter
  is_action
  is_reaction
  remove_after_use
  description
  effect_text
  source_page
```

`category`:

```text
CAMPAIGN_COMPONENT
ACTION
STARTER
```

`intent_alignment`:

```text
MALIGN
RESILIENCY
DUAL
NONE
```

## 10.1 Valores por slot

```text
CardSlotValue
  card_definition_id
  slot_type
  influence_value
```

`slot_type`:

```text
INTENT
METHOD
AMPLIFIER
```

Una carta sólo puede ocupar slots para los que exista `CardSlotValue`.

## 10.2 Costes y requisitos

```text
CardRequirement
  id
  card_definition_id
  requirement_type
  parameters_json
```

```text
CardEffectDefinition
  id
  card_definition_id
  effect_type
  timing_window
  parameters_json
  order_index
```

Esta capa usa la Rule Effect Taxonomy v0.2 y evita lógica específica por nombre de carta.

---

# 11. CardAlias

```text
CardAlias
  alias
  card_definition_id
  source
```

Los pairings y triggers siempre resuelven por `card_definition_id`, nunca por comparación textual.

---

# 12. CardInstance

Cada una de las 108 copias del set de un país es una instancia.

```text
CardInstance
  id
  game_id
  country_owner_id
  card_definition_id
  serial_within_country_set
  current_controller_participant_id
  zone
  zone_position nullable
  face_state
  removed_from_game
```

## 12.1 Ownership vs control

- `country_owner_id` nunca cambia salvo corrección administrativa.
- `current_controller_participant_id` puede cambiar temporalmente por robo/intercambio.
- Starter robada conserva owner original.

## 12.2 Card zone

```text
OPERATIONS_POOL
OPERATIONS_DECK
HAND
DISCARD
CAMPAIGN_SLOT
PLANNED_ACTION
TEMPORARY_REVEAL
REMOVED_FROM_GAME
```

## 12.3 Face state

```text
FACE_DOWN
FACE_UP
```

---

# 13. Operations Deck, Hand y Discard

El orden del deck sí existe técnicamente aunque no sea visible.

```text
DeckState
  game_id
  participant_id
  ordered_card_instance_ids[]
  shuffle_revision
```

Sin embargo, para persistencia relacional se recomienda una tabla de posiciones:

```text
DeckCardPosition
  participant_id
  card_instance_id
  position
  shuffle_revision
```

La mano puede derivarse por `CardInstance.zone=HAND`; no necesita entidad separada salvo optimización.

## 13.1 Validaciones

- Operations Deck inicial = exactamente 30 cartas no Starter.
- Starter = 5, fuera del deck.
- hand size <= 10 después de cada operación atómica.
- al agotarse deck, `DISCARD` se baraja y migra a `OPERATIONS_DECK`.
- `REMOVED_FROM_GAME` nunca vuelve al ciclo normal.

---

# 14. Campaign

```text
Campaign
  id
  game_id
  owner_participant_id
  created_turn_id
  row
  state
  intent_alignment
  target_dt_id nullable
  activated_count_this_turn
  last_activated_turn_id nullable
```

`row`:

```text
I
II
```

`state`:

```text
PLANNED
ON_BOARD_HIDDEN
REVEALED
DISCARDED
REMOVED
```

## 14.1 CampaignCardAssignment

```text
CampaignCardAssignment
  campaign_id
  slot_type
  card_instance_id
  assigned_turn_id
```

Restricciones:

- máximo 1 carta por slot;
- Intent obligatorio para activar;
- Method obligatorio para activar;
- Amplifier opcional;
- todas las cartas deben ser compatibles con `intent_alignment`;
- cada carta sólo ocupa un slot.

## 14.2 Edad

Modificar una campaña no cambia `row` ni `created_turn_id`.

Cleanup:

```text
row I -> row II
row II -> DISCARD
```

---

# 15. DemographicTokenDefinition

```text
DemographicTokenDefinition
  id
  category
  canonical_value
  display_label
  visual_asset_key
```

`category`:

```text
POLITICAL_PARTY
ETHNICITY
RELIGION
EDUCATION
OTHER
```

Population Size se modela como atributo de PD (`S/M/L`) y no como DT de targeting salvo que una carta futura lo requiera.

---

# 16. ScenarioDefinition

```text
ScenarioDefinition
  id
  name
  version
  narrative
  default_turn_limit nullable
  allows_instant_victory
  status
```

Base 2025:

```text
default_turn_limit = null
allows_instant_victory = false
```

El `Game.turn_limit` es obligatorio al crear la partida.

---

# 17. ScenarioPDDefinition

```text
ScenarioPDDefinition
  id
  scenario_definition_id
  canonical_pd_id
  host_country_id
  local_index
  gamebook_label
  board_label
  population_size
```

Relación de DTs:

```text
ScenarioPDDemographic
  scenario_pd_definition_id
  demographic_token_definition_id
```

IDs internos base:

```text
PRESQUE_PD_1..3
DINESIA_PD_1..3
URSARIA_PD_1..3
FLUMA_PD_1..2
ARDEN_PD_1..3
```

Total base = 14 PDs.

---

# 18. PopulationDemographicState

Instancia dinámica de una PD durante la partida.

```text
PopulationDemographicState
  id
  game_id
  scenario_pd_definition_id
  host_country_id
  current_legitimacy_participant_id nullable
```

Los DTs son relativamente estáticos en base v1 y se leen del ScenarioPDDefinition.

---

# 19. InfluenceStack

La influencia nunca se almacena sólo como `red_total/blue_total`.

```text
InfluenceStack
  id
  game_id
  pd_state_id
  influence_type
  attribution_country_id
  count
```

`influence_type`:

```text
MALIGN
RESILIENCY
```

Esto permite:

```text
total_malign(pd)
total_resiliency(pd)
attributed_malign(country,pd)
attributed_resiliency(country,pd)
```

## 19.1 InfluenceMutation

Toda alteración crea historial:

```text
InfluenceMutation
  id
  adjudication_trace_id
  pd_state_id
  influence_type
  attribution_country_id
  delta
  mutation_reason
```

`mutation_reason`:

```text
PLACED
CANCELLED_BY_2_TO_1
REMOVED_BY_CARD
REMOVED_BY_REGIME_ABILITY
SCENARIO_SETUP
FACILITATOR_ADJUSTMENT
```

---

# 20. Legitimacy

Puede representarse en `PopulationDemographicState.current_legitimacy_participant_id`, pero el historial debe ser propio:

```text
LegitimacyEvent
  id
  game_id
  turn_id
  pd_state_id
  previous_participant_id nullable
  new_participant_id nullable
  reason_type
  adjudication_trace_id nullable
```

`reason_type`:

```text
CAMPAIGN_ESTABLISH
CAMPAIGN_SUBVERT
PRESQUE_REGIME_ABILITY
PLAYER_REALLOCATION
FACILITATOR_ADJUSTMENT
```

Invariantes:

- máximo 1 legitimidad por PD;
- máximo 3 PD con legitimidad por jugador;
- si Presque ya tiene 3 y usa habilidad, debe seleccionar una propia a retirar antes de colocar nueva.

---

# 21. PlannedAction

Representa la decisión secreta tomada en Action Stage.

```text
PlannedAction
  id
  turn_id
  participant_id
  sequence_within_player
  action_type
  ap_cost
  state
  target_entity_type nullable
  target_entity_id nullable
  card_instance_id nullable
  campaign_id nullable
  parameters_json
```

`action_type`:

```text
CONSTRUCT_CAMPAIGN
MODIFY_CAMPAIGN
ACTIVATE_CAMPAIGN
PLAY_ACTION_CARD
ACTIVATE_REGIME_ABILITY
```

`state`:

```text
DRAFT
LOCKED
REVEALED
RESOLVING
RESOLVED
CANCELLED
INVALIDATED
```

No se usa JSON para lógica crítica cuando exista un campo normalizable; `parameters_json` sólo alberga selectores menores no estabilizados en v0.1.

---

# 22. ActionResolution

```text
ActionResolution
  id
  planned_action_id
  initiative_position
  started_at
  ended_at
  resolution_status
  adjudication_trace_id nullable
```

`resolution_status`:

```text
SUCCESS
FAILED
CANCELLED_BY_EFFECT
VETOED
INVALID
NO_EFFECT
```

---

# 23. ReactionWindow

```text
ReactionWindow
  id
  game_id
  turn_id
  window_type
  triggering_entity_type
  triggering_entity_id
  triggering_participant_id
  state
  opened_at
  closed_at
```

`window_type` incluye al menos:

```text
PRE_CAMPAIGN_ROLL
ON_CAMPAIGN_ROLL
ON_ACTION_CARD_PLAY
ON_SPECIFIC_CARD_TARGET
ON_CARD_DRAW
COALITION_CONTRIBUTION
```

```text
ReactionEligibility
  reaction_window_id
  participant_id
  priority_order
  eligible_card_definition_ids[]
  passed
```

```text
ReactionPlay
  id
  reaction_window_id
  participant_id
  card_instance_id
  priority_order
  resolution_status
  adjudication_trace_id
```

No se permite una reacción fuera de un `ReactionWindow` explícito.

---

# 24. NarrativeSubmission

```text
NarrativeSubmission
  id
  campaign_activation_id
  participant_id
  text
  sentence_count
  submitted_at
  objective_tag_fluma_independence
```

```text
NarrativeReview
  narrative_submission_id
  exceeds_length_rule
  suspected_card_text_reading
  facilitator_confirmed_reading_violation
  facilitator_plausibility_status
  notes
```

`facilitator_plausibility_status`:

```text
NOT_REVIEWED
ACCEPTABLE
UNACCEPTABLE
```

IA puede generar un advisory separado, nunca el valor autoritativo.

---

# 25. VetoCase y VetoVote

```text
VetoCase
  id
  game_id
  turn_id
  narrative_submission_id
  veto_card_instance_id
  initiator_participant_id
  rationale
  defender_response
  state
  result
```

`result`:

```text
NARRATIVE_ACCEPTED
NARRATIVE_REJECTED
FACILITATOR_STOPPED_ABUSE
```

```text
VetoVote
  veto_case_id
  participant_id
  vote
```

`vote`:

```text
ACCEPTABLE
UNACCEPTABLE
```

Rechazo requiere:

```text
unacceptable_votes > active_player_count / 2
```

---

# 26. DieRoll

```text
DieRoll
  id
  game_id
  turn_id
  participant_id nullable
  die_type
  mode
  raw_value
  source_type
  source_entity_id
  rng_metadata nullable
  created_at
```

`die_type` base = `D10`.

`mode`:

```text
ENGINE_RNG
MANUAL_INPUT
```

`source_type`:

```text
INITIATIVE
CAMPAIGN_ERT
REGIME_ABILITY
REACTION
VIRAL_SPREAD_CHECK
VIRAL_CUBE_COUNT
CARD_EFFECT
```

Los modificadores no alteran `raw_value`.

---

# 27. ModifierApplication

```text
ModifierApplication
  id
  adjudication_trace_id
  modifier_type
  source_entity_type
  source_entity_id
  value
  applied_to
  stacking_key
```

`applied_to`:

```text
BASE_CV
EFFECTIVE_CV
DIE_ROLL
RESOURCE_COST
ERT_RESULT
```

El sistema debe detectar doble aplicación accidental mediante `stacking_key` y las reglas de efecto.

---

# 28. CampaignActivation

```text
CampaignActivation
  id
  game_id
  turn_id
  participant_id
  campaign_id
  planned_action_id nullable
  activation_source
  target_pd_state_id
  target_dt_id
  base_cv
  effective_cv
  cost_tier
  resolution_tier
  tier_resource_cost
  card_specific_resource_cost
  total_resource_cost
  legitimacy_roll_bonus
  roll_boost_spent
  die_roll_id
  modified_roll
  ert_result
  outcome_type
  adjudication_trace_id
```

`activation_source`:

```text
NORMAL_AP_ACTION
DOUBLE_ACTION_CARD
FACILITATOR_OVERRIDE
```

`outcome_type`:

```text
POSITIVE
ZERO
BACKLASH
VETOED
CANCELLED
```

---

# 29. ERTDefinition

No hardcodear la tabla dentro de lógica dispersa.

```text
ERTDefinition
  id
  ruleset_version
```

```text
ERTCell
  ert_definition_id
  tier
  die_value
  malign_result
  resiliency_result
```

`tier`:

```text
LOW
MEDIUM
HIGH
```

Tier selection:

```text
LOW    if effective_cv <= 6
MEDIUM if 7 <= effective_cv <= 11
HIGH   if effective_cv >= 12
```

Cost tier usa `base_cv` con los mismos thresholds, pero High también cierra en 12+ por DEC-007.

---

# 30. AdjudicationTrace

Es la entidad crítica para auditabilidad.

```text
AdjudicationTrace
  id
  game_id
  turn_id
  phase_state_id
  participant_id
  trace_type
  source_action_id nullable
  source_card_instance_id nullable
  source_campaign_id nullable
  target_pd_state_id nullable

  pre_state_hash
  post_state_hash

  input_snapshot_json
  rule_evaluation_json
  output_snapshot_json

  facilitator_intervention_id nullable
  created_at
```

Aunque el detalle pueda serializarse en JSON para replay, los campos operativos principales siguen normalizados.

## 30.1 Para campaña debe registrar explícitamente

```text
intent_card
method_card
amplifier_card
intent_alignment
target_dt
target_pd
base_iv_values
base_cv
bonus_sources
effective_cv
cost_tier
resolution_tier
resource_costs
legitimacy_bonus
roll_boost
raw_die_roll
modified_die_roll
ert_result
influence_type_generated
cubes_generated
cubes_consumed_in_cancellation
opposite_cubes_removed
cubes_placed
legitimacy_before
legitimacy_after
vp_delta
```

---

# 31. Regla 2:1 como registro de resolución

```text
InfluenceResolution
  id
  adjudication_trace_id
  pd_state_id
  incoming_type
  incoming_attribution_country_id
  generated_count
  consumed_in_cancellation
  opposite_removed_count
  placed_count
```

Con:

```text
pairs_available = floor(generated_count / 2)
opposite_removed = min(pairs_available, available_opposite_count)
consumed_in_cancellation = opposite_removed * 2
placed_count = generated_count - consumed_in_cancellation
```

La elección de atribución removida se representa como varias `InfluenceMutation` negativas.

---

# 32. VPTransaction

```text
VPTransaction
  id
  game_id
  turn_id nullable
  participant_id
  delta
  reason_type
  source_entity_type
  source_entity_id
  created_at
```

`reason_type`:

```text
CAMPAIGN_CUBES_PLACED
LEGITIMACY_ESTABLISHED
LEGITIMACY_SUBVERTED
BACKLASH
VICTORY_OBJECTIVE
CARD_EFFECT
FACILITATOR_ADJUSTMENT
```

Invariante: VP no baja de 0 cuando la fuente sea una carta que resta VP, conforme a DEC-026.

---

# 33. VictoryObjectiveDefinition

```text
VictoryObjectiveDefinition
  id
  scenario_definition_id
  country_id
  tier
  title
  description
  points_mode
  points_value
  evaluator_type
  evaluator_parameters_json
  requires_facilitator_tag
  instant_victory
```

`tier`:

```text
HARD
MEDIUM
EASY
```

`points_mode`:

```text
FIXED
PER_PD
PER_COUNTRY
FIXED_PLUS_BONUS
OR_FIXED
```

La lógica exacta del escenario base está definida en Scenario Data Specification v0.1.

---

# 34. VictoryObjectiveProgress y Award

```text
VictoryObjectiveProgress
  game_id
  objective_definition_id
  participant_id
  current_status_json
  currently_qualifies
  calculated_at
```

Privado owner+facilitador.

```text
VictoryObjectiveAward
  game_id
  objective_definition_id
  participant_id
  vp_awarded
  awarded_at
  evaluation_snapshot_json
```

Base 2025: se crean al cierre de partida.

---

# 35. GameOutcome

```text
GameOutcome
  game_id
  completed_turn
  winner_participant_ids[]
  shared_tie
  tiebreak_stage
  final_scores_json
  completed_at
```

`tiebreak_stage`:

```text
VP
LEAST_OWN_COUNTRY_MALIGN
SHARED_TIE
```

---

# 36. ViralizationResolution

```text
ViralizationResolution
  id
  game_id
  turn_id
  origin_pd_state_id
  legitimacy_owner_participant_id
  influence_type
  origin_count
  threshold
  target_pd_state_id nullable
  shares_dt
  spread_check_die_roll_id nullable
  spread_succeeded
  quantity_die_roll_id nullable
  cubes_generated
  adjudication_trace_id
```

Condiciones base:

- `origin_count > 8`;
- debe existir legitimacy owner;
- destino comparte al menos un DT;
- spread check >= 6;
- segundo d10 par -> 2, impar -> 1.

Variant flags viven en `ScenarioRuleConfig/Game`.

---

# 37. RegimeAbilityDefinition y Activation

```text
RegimeAbilityDefinition
  id
  country_id
  name
  effect_definition_ids[]
  once_per_turn
  ap_cost
```

```text
RegimeAbilityActivation
  id
  game_id
  turn_id
  participant_id
  ability_definition_id
  planned_action_id
  die_roll_id nullable
  target_pd_state_id nullable
  adjudication_trace_id
```

Invariante: máximo una activación por turno/participante.

---

# 38. DealPromise

Promesa social no vinculante:

```text
DealPromise
  id
  game_id
  turn_id
  proposer_participant_id
  participant_ids[]
  terms_text
  visibility_scope
  state
```

`state`:

```text
PROPOSED
ACKNOWLEDGED
REJECTED
EXPIRED
```

Nunca modifica Game State.

---

# 39. TransferTransaction

La transferencia sí modifica estado una vez confirmada.

```text
TransferTransaction
  id
  game_id
  turn_id
  transfer_type
  from_participant_id
  to_participant_id
  card_instance_id nullable
  resource_amount nullable
  state
  confirmed_by_from
  confirmed_by_to
  executed_at nullable
```

`transfer_type`:

```text
CARD
RESOURCE
```

Restricciones MVP:

- sólo Initiative/Action planning antes de lock;
- no consume AP;
- hand limit debe cumplirse tras transferencia;
- Ownership de la carta no cambia, sólo control/zone.

---

# 40. TemporaryReveal

Para Espionaje/Agente Doble y efectos similares:

```text
TemporaryReveal
  id
  game_id
  source_effect_id
  viewer_participant_id
  target_participant_id
  revealed_card_instance_ids[]
  scope
  opened_at
  expires_at_event_id nullable
  closed_at nullable
```

Nunca se replica a otros jugadores o Player AI no autorizado.

---

# 41. VisibilityGrant

Control declarativo de información especial:

```text
VisibilityGrant
  id
  game_id
  subject_type
  subject_id
  viewer_type
  viewer_id
  permission
  source
  expires_at nullable
```

En la mayoría de datos la visibilidad se deriva por política; esta tabla se usa para excepciones temporales.

---

# 42. FacilitatorDecision

```text
FacilitatorDecision
  id
  game_id
  turn_id nullable
  participant_id nullable
  decision_type
  target_entity_type
  target_entity_id
  rationale
  before_snapshot_json
  after_snapshot_json
  created_at
```

`decision_type`:

```text
NARRATIVE_READING_VIOLATION
NARRATIVE_PLAUSIBILITY
VETO_ABUSE_STOP
OBJECTIVE_NARRATIVE_ELIGIBILITY
MANUAL_STATE_CORRECTION
RULE_EXCEPTION
PAUSE_RESUME
```

Toda `MANUAL_STATE_CORRECTION` debe producir además GameEvents y transacciones/mutaciones de dominio correspondientes.

---

# 43. GameEvent — Event Log canónico

```text
GameEvent
  id
  game_id
  sequence_number
  turn_id nullable
  phase_state_id nullable
  event_type
  actor_participant_id nullable
  subject_type nullable
  subject_id nullable
  payload_json
  visibility_class
  caused_by_event_id nullable
  adjudication_trace_id nullable
  created_at
```

`sequence_number` es monotónico dentro de la partida.

Ejemplos de `event_type`:

```text
GAME_CREATED
GAME_STARTED
TURN_STARTED
PHASE_OPENED
INITIATIVE_ROLLED
INITIATIVE_SET
CARDS_DISCARDED
CARDS_DRAWN
DECK_SHUFFLED
TURN_INCOME_GRANTED
ACTION_PLANNED
ACTIONS_LOCKED
ACTION_REVEALED
CAMPAIGN_CONSTRUCTED
CAMPAIGN_MODIFIED
CAMPAIGN_ACTIVATION_STARTED
NARRATIVE_SUBMITTED
REACTION_WINDOW_OPENED
REACTION_PLAYED
VETO_STARTED
VETO_RESOLVED
DIE_ROLLED
ERT_RESOLVED
INFLUENCE_CHANGED
LEGITIMACY_CHANGED
VP_CHANGED
CAMPAIGN_AGED
CAMPAIGN_DISCARDED
VIRALIZATION_RESOLVED
OBJECTIVE_EVALUATED
GAME_COMPLETED
FACILITATOR_OVERRIDE
```

---

# 44. Event sourcing vs snapshot model

**PROPUESTA TÉCNICA PARA FASE 2:** usar un modelo híbrido:

- tablas de estado actual para consultas rápidas;
- `GameEvent` append-only para auditoría/replay;
- transacciones de dominio para recursos, VP, influencia y legitimidad;
- hash/snapshot en adjudicaciones críticas.

No se recomienda Event Sourcing puro para el MVP porque aumentaría complejidad operativa sin necesidad inmediata.

---

# 45. Information visibility classes

```text
PUBLIC
OWNER_ONLY
PARTICIPANTS_ONLY
OWNER_AND_FACILITATOR
FACILITATOR_ONLY
TEMPORARY_AUTHORIZED_VIEWERS
SYSTEM_ONLY
```

Reglas de baseline:

- mapa, cubos, recursos, VP, legitimidad: `PUBLIC`;
- mano y planificación: `OWNER_AND_FACILITATOR`;
- Secret VO: `OWNER_AND_FACILITATOR`;
- orden futuro del deck: `SYSTEM_ONLY`;
- revelaciones por efecto: `TEMPORARY_AUTHORIZED_VIEWERS`.

El backend debe aplicar autorización antes de entregar contexto a IA.

---

# 46. Aggregate roots recomendados

Para evitar mutaciones inconsistentes, los agregados conceptuales son:

```text
GameAggregate
  Game
  Turn/Phase
  participants

PlayerAggregate
  resources
  AP
  hand/deck/discard
  campaigns

BoardAggregate
  PD states
  influence stacks
  legitimacy

AdjudicationAggregate
  action
  reactions
  dice
  modifiers
  trace

ScoringAggregate
  VP ledger
  objective evaluator
  outcome
```

No es una decisión de microservicios; son fronteras lógicas para mantener invariantes.

---

# 47. Invariantes globales del Game Engine

1. Un jugador nunca puede gastar más recursos de los disponibles.
2. Un jugador nunca puede consumir más AP de los asignados.
3. Hand size nunca >10 al terminar una operación atómica.
4. Starter no forma parte del Operations Deck inicial.
5. Campaign activation exige Intent + Method válidos.
6. Todas las cartas de campaña comparten intent alignment compatible.
7. Target PD debe cumplir DT de Intent.
8. Campaña normal máximo 1 activación/turno, salvo excepción explícita.
9. Regime Ability máximo 1/turno.
10. Una PD máximo 1 legitimacy marker.
11. Un jugador máximo 3 legitimacy markers.
12. Sólo cubos colocados tras 2:1 generan VP/legitimidad de campaña.
13. Direct cube effects no generan VP/legitimidad salvo texto explícito.
14. VP nunca <0.
15. Reacción sólo dentro de ventana válida.
16. Action Card normal consume 1 AP al planificarse.
17. Reactions no consumen AP salvo texto.
18. Veto se resuelve antes de roll.
19. Cost tier usa base CV; ERT tier usa effective CV.
20. Game State no puede ser mutado por el AI Engine.
21. Toda mutación crítica genera GameEvent.
22. Toda intervención manual del facilitador es auditable.

---

# 48. Relaciones cardinales resumidas

```text
ScenarioDefinition 1 ── * ScenarioPDDefinition
ScenarioDefinition 1 ── * VictoryObjectiveDefinition
CountryDefinition 1 ── 1 RegimeAbilityDefinition
CardDefinition 1 ── * CardEffectDefinition
CardDefinition 1 ── * CardSlotValue

Game 1 ── * GameParticipant
Game 1 ── 5 GameCountry
Game 1 ── * Turn
Game 1 ── 14 PopulationDemographicState   [base scenario]
Game 1 ── * CardInstance

Turn 1 ── 5 PhaseState
Turn 1 ── * PlannedAction
Turn 1 ── * DieRoll

Participant 1 ── * CardInstance [control]
Participant 1 ── * Campaign
Participant 1 ── * ResourceTransaction
Participant 1 ── * VPTransaction

Campaign 1 ── 2..3 CampaignCardAssignment
Campaign 1 ── * CampaignActivation

PDState 1 ── * InfluenceStack
PDState 1 ── 0..1 current legitimacy

PlannedAction 1 ── 0..1 ActionResolution
ActionResolution 1 ── 0..1 AdjudicationTrace
```

---

# 49. Data that must never be denormalized without authoritative source

Los siguientes valores pueden tener caches, pero no deben convertirse en la única verdad:

- current resources;
- current VP;
- hand size;
- influence totals;
- legitimacy count;
- objective progress.

Su fuente debe poder reconstruirse desde transacciones/estado detallado.

---

# 50. State machine — Campaign

```text
NOT_EXISTENT
   ↓ construct
ON_BOARD_HIDDEN (row I)
   ↓ reveal / resolve
REVEALED (row I)
   ↓ cleanup
REVEALED or HIDDEN (row II)
   ↓ cleanup
DISCARDED
```

Modificar:

```text
row I/II -> same row
```

Activar:

```text
hidden -> revealed
revealed -> revealed
```

`Doble Acción` permite segunda activación en mismo turno sin modificar lifecycle.

---

# 51. State machine — PlannedAction

```text
DRAFT
  ↓ player lock
LOCKED
  ↓ initiative reveal
REVEALED
  ↓
RESOLVING
  ↓
RESOLVED
```

Alternativas:

```text
LOCKED/REVEALED -> CANCELLED_BY_EFFECT
REVEALED -> INVALIDATED
```

---

# 52. State machine — Game

```text
DRAFT -> LOBBY -> SETUP -> ACTIVE
ACTIVE <-> PAUSED
ACTIVE -> COMPLETED
DRAFT/LOBBY/SETUP/ACTIVE -> ABORTED [facilitator authority]
```

---

# 53. State machine — Reaction Window

```text
CREATED -> OPEN
OPEN -> RESOLVING_PRIORITY
RESOLVING_PRIORITY -> OPEN [next eligible]
OPEN/RESOLVING_PRIORITY -> CLOSED
```

Se cierra anticipadamente si el objeto reaccionado queda anulado/destruido.

---

# 54. Escenario base como datos, no código

La siguiente información debe cargarse desde definición de escenario:

- 14 PDs;
- DTs por PD;
- tamaño;
- influencia inicial y atribución;
- VOs;
- variante viral;
- reglas de victoria;
- narrativa general.

El Game Engine nunca debe contener condiciones como `if pd == FLUMA_PD_2` salvo que provengan de un evaluator configurado por ScenarioDefinition.

---

# 55. Modelo de evaluator de Victory Objectives

Para evitar hardcodear 15 evaluadores únicos, usar operadores composables:

```text
ALL
ANY
COUNT_AT_LEAST
FOR_EACH
SUM
COMPARE
DISTINCT_COUNTRIES_AT_LEAST
PD_FILTER
ATTRIBUTION_FILTER
NET_VALUE
FACILITATOR_TAG_REQUIRED
```

Ejemplo conceptual:

```text
PRESQUE_HARD =
COUNT_AT_LEAST(
  2,
  PD_FILTER(country=DINESIA),
  attributed_malign(PRESQUE, pd) > 3
)
```

Esto es **PROPUESTA TÉCNICA**, a validar durante diseño del Adjudication Engine.

---

# 56. AI authorization context

Antes de cualquier consulta a IA se construye:

```text
AuthorizationContext
  game_id
  requesting_participant_id
  role
  country_id nullable
  allowed_visibility_classes
  temporary_reveal_ids
  current_turn
  current_phase
```

Luego el Knowledge/RAG layer sólo obtiene objetos permitidos.

No se pasa `full_game_state` al Player AI para confiar en que el modelo “no lo revele”.

---

# 57. Replay requirements

Para reproducir una partida se necesita:

1. ruleset/card/scenario versions;
2. estado inicial;
3. `GameEvent.sequence_number` completo;
4. todos los resultados RNG/manual input;
5. todas las decisiones de target/atribución;
6. reacciones/vetos/votos;
7. intervenciones del facilitador.

El replay no debe volver a tirar dados ni reconsultar IA para obtener el resultado histórico.

---

# 58. Integridad y concurrencia conceptual

En Multiplayer, operaciones críticas requieren transacción atómica/locking lógico:

- gastar recursos;
- robar carta;
- transferir carta;
- lock de acciones;
- aplicar 2:1;
- modificar legitimidad;
- VP;
- resolver reacción.

La futura implementación deberá prevenir doble gasto y doble resolución de un mismo evento.

---

# 59. Entidades que NO deben existir como autoridad

No crear como fuente principal:

- `AIAdjudicationResult` autoritativo;
- `PlayerDeclaredVP`;
- `ClientCalculatedResources`;
- `ClientCalculatedERT`;
- `NarrativePlausibilityByLLM` con efecto automático.

Pueden existir advisories de IA, pero nunca escriben estado crítico directamente.

---

# 60. Catálogo mínimo de tablas lógicas

**Reference**
1. CountryDefinition
2. RegimeAbilityDefinition
3. CardDefinition
4. CardSlotValue
5. CardRequirement
6. CardEffectDefinition
7. CardAlias
8. DemographicTokenDefinition
9. ERTDefinition
10. ERTCell

**Scenario**
11. ScenarioDefinition
12. ScenarioPDDefinition
13. ScenarioPDDemographic
14. ScenarioInitialInfluence
15. ScenarioRuleConfig
16. VictoryObjectiveDefinition

**Game**
17. Game
18. GameParticipant
19. PlayerSeat
20. GameCountry
21. Turn
22. PhaseState
23. PlayerPhaseReadiness
24. InitiativeRoll
25. InitiativeEntry

**Player/Card State**
26. CardInstance
27. DeckCardPosition
28. Campaign
29. CampaignCardAssignment
30. ActionPointLedger
31. ResourceTransaction

**Board**
32. PopulationDemographicState
33. InfluenceStack
34. InfluenceMutation
35. LegitimacyEvent

**Action/Resolution**
36. PlannedAction
37. ActionResolution
38. ReactionWindow
39. ReactionEligibility
40. ReactionPlay
41. CampaignActivation
42. NarrativeSubmission
43. NarrativeReview
44. VetoCase
45. VetoVote
46. DieRoll
47. ModifierApplication
48. InfluenceResolution
49. ViralizationResolution
50. RegimeAbilityActivation
51. AdjudicationTrace

**Scoring**
52. VPTransaction
53. VictoryObjectiveProgress
54. VictoryObjectiveAward
55. GameOutcome

**Interaction/Security/Audit**
56. DealPromise
57. TransferTransaction
58. TemporaryReveal
59. VisibilityGrant
60. FacilitatorDecision
61. GameEvent

---

# 61. Decisiones de modelo que quedan para Fase 1.1

No bloquean el modelo lógico, pero deben cerrarse antes del esquema físico:

1. PostgreSQL enums vs lookup tables.
2. UUIDv7 vs UUIDv4/ULID para IDs.
3. Qué snapshots JSON conservar completos y cuánto normalizar.
4. Estrategia de soft-delete para definiciones; Game State crítico no debe borrarse.
5. Compresión/retención de GameEvent para partidas históricas.
6. Representación física del orden del deck (position integer vs linked ordering).
7. Motor declarativo de CardEffectDefinition: JSON DSL vs tablas tipadas.
8. Motor declarativo de VictoryObjectiveDefinition: AST/JSON DSL vs evaluadores tipados.

Estas son decisiones de ingeniería de Fase 1/2, no reglas del juego.

---

# 62. Criterio de cierre de Fase 1

La Fase 1 podrá considerarse cerrada cuando existan:

- este modelo lógico aprobado;
- Data Dictionary campo por campo;
- diagrama ER definitivo;
- reglas de ownership/possession;
- matriz de visibilidad vinculada a entidades;
- state machines aprobadas;
- esquema de GameEvent/AdjudicationTrace;
- especificación de effect DSL/evaluator suficiente para iniciar Game Engine.

---

# 63. Próximo entregable

**MALIGN-AI — DATA DICTIONARY & ENTITY RELATIONSHIP SPECIFICATION v0.1**

Después:

**MALIGN-AI — ADJUDICATION ENGINE SPECIFICATION v0.1**

Todavía no se inicia programación.
