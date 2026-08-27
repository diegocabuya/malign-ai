-- DEC-078 / M2-A. PostgreSQL 18.6 only. Forward-only.
CREATE SCHEMA IF NOT EXISTS malign;

CREATE DOMAIN malign.nonnegative_int AS integer CHECK (VALUE >= 0);
CREATE DOMAIN malign.positive_bigint AS bigint CHECK (VALUE > 0);

CREATE TABLE malign.schema_migrations (
  version text PRIMARY KEY,
  name text NOT NULL,
  checksum bytea NOT NULL UNIQUE CHECK (octet_length(checksum) = 32),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  application_build text NOT NULL,
  restore_drill_ref text
);
CREATE INDEX schema_migrations_applied_at_idx ON malign.schema_migrations (applied_at);

CREATE TABLE malign.ruleset_versions (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  logical_id text NOT NULL,
  version text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  compatibility_parent_id uuid REFERENCES malign.ruleset_versions(id),
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (logical_id, version)
);
CREATE TABLE malign.engine_contract_versions (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  logical_id text NOT NULL,
  version text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  compatibility_parent_id uuid REFERENCES malign.engine_contract_versions(id),
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (logical_id, version)
);
CREATE TABLE malign.card_registry_versions (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  logical_id text NOT NULL,
  version text NOT NULL,
  status text NOT NULL,
  jcs_sha256 bytea NOT NULL CHECK (octet_length(jcs_sha256) = 32),
  snapshot_blob_sha1 bytea NOT NULL CHECK (octet_length(snapshot_blob_sha1) = 20),
  approved_decision_id text NOT NULL,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (logical_id, version),
  UNIQUE (version, jcs_sha256),
  CHECK (status <> 'ACTIVE' OR (approved_decision_id <> '' AND activated_at IS NOT NULL))
);
CREATE TABLE malign.registry_seed_runs (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  registry_version_id uuid NOT NULL UNIQUE REFERENCES malign.card_registry_versions(id),
  snapshot_jcs_sha256 bytea NOT NULL CHECK (octet_length(snapshot_jcs_sha256) = 32),
  snapshot_git_blob_sha1 bytea NOT NULL CHECK (octet_length(snapshot_git_blob_sha1) = 20),
  row_count integer NOT NULL CHECK (row_count >= 0),
  status text NOT NULL,
  migration_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX registry_seed_runs_status_idx ON malign.registry_seed_runs (status);

CREATE TABLE malign.ruleset_domain_values (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  domain_name text NOT NULL,
  value text NOT NULL,
  ruleset_version_id uuid NOT NULL REFERENCES malign.ruleset_versions(id),
  display_order integer NOT NULL CHECK (display_order >= 0),
  status text NOT NULL DEFAULT 'ACTIVE',
  source_reference text NOT NULL,
  UNIQUE (domain_name, value, ruleset_version_id)
);
CREATE INDEX ruleset_domain_values_lookup_idx ON malign.ruleset_domain_values (ruleset_version_id, domain_name, status);
CREATE TABLE malign.json_schema_versions (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  schema_id text NOT NULL,
  schema_version text NOT NULL,
  schema_json jsonb NOT NULL CHECK (jsonb_typeof(schema_json) = 'object'),
  jcs_sha256 bytea NOT NULL CHECK (octet_length(jcs_sha256) = 32),
  compatibility_mode text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  source_reference text NOT NULL,
  UNIQUE (schema_id, schema_version)
);

CREATE TABLE malign.regime_ability_definitions (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  logical_id text NOT NULL,
  ruleset_version_id uuid NOT NULL REFERENCES malign.ruleset_versions(id),
  name text NOT NULL,
  ap_cost malign.nonnegative_int NOT NULL,
  once_per_turn boolean NOT NULL DEFAULT true,
  effect_definition_id uuid,
  status text NOT NULL,
  source_reference text NOT NULL,
  UNIQUE (logical_id, ruleset_version_id)
);
CREATE TABLE malign.country_definitions (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  logical_id text NOT NULL,
  version text NOT NULL,
  canonical_name text NOT NULL,
  regime_type text NOT NULL,
  mascot text NOT NULL,
  color_key text NOT NULL,
  visual_asset_key text,
  starting_resource_default malign.nonnegative_int NOT NULL,
  turn_income_default malign.nonnegative_int NOT NULL,
  regime_ability_definition_id uuid REFERENCES malign.regime_ability_definitions(id),
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (logical_id, version),
  UNIQUE (canonical_name, version),
  UNIQUE (color_key, version)
);
ALTER TABLE malign.regime_ability_definitions ADD COLUMN country_definition_id uuid REFERENCES malign.country_definitions(id);

CREATE TABLE malign.card_definitions (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  logical_id text NOT NULL,
  registry_version_id uuid NOT NULL REFERENCES malign.card_registry_versions(id),
  canonical_name text NOT NULL,
  category text NOT NULL,
  subtype text,
  intent_alignment text,
  is_starter boolean NOT NULL DEFAULT false,
  is_action boolean NOT NULL DEFAULT false,
  is_reaction boolean NOT NULL DEFAULT false,
  remove_after_use boolean NOT NULL DEFAULT false,
  action_point_cost malign.nonnegative_int NOT NULL DEFAULT 0,
  resource_cost malign.nonnegative_int NOT NULL DEFAULT 0,
  description text,
  effect_text text,
  status text NOT NULL,
  source_reference text NOT NULL,
  UNIQUE (logical_id, registry_version_id),
  UNIQUE (canonical_name, registry_version_id),
  CHECK (NOT is_starter OR category = 'STARTER'),
  CHECK (NOT is_reaction OR is_action)
);
CREATE INDEX card_definitions_registry_idx ON malign.card_definitions (registry_version_id, status, category);
CREATE TABLE malign.country_card_serial_templates (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  template_id text NOT NULL,
  registry_version_id uuid NOT NULL REFERENCES malign.card_registry_versions(id),
  serial_within_country_set smallint NOT NULL CHECK (serial_within_country_set BETWEEN 1 AND 108),
  card_definition_id uuid NOT NULL REFERENCES malign.card_definitions(id),
  starter boolean NOT NULL,
  primary_source_ref text NOT NULL,
  primary_source_sha256 bytea NOT NULL,
  UNIQUE (template_id, registry_version_id),
  UNIQUE (registry_version_id, serial_within_country_set)
);
CREATE INDEX country_card_serial_templates_definition_idx ON malign.country_card_serial_templates (card_definition_id);
CREATE TABLE malign.card_slot_values (
  card_definition_id uuid NOT NULL REFERENCES malign.card_definitions(id),
  slot_type text NOT NULL,
  influence_value smallint NOT NULL CHECK (influence_value BETWEEN 1 AND 6),
  registry_version_id uuid NOT NULL REFERENCES malign.card_registry_versions(id),
  PRIMARY KEY (card_definition_id, slot_type, registry_version_id)
);
CREATE TABLE malign.card_requirements (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  card_definition_id uuid NOT NULL REFERENCES malign.card_definitions(id),
  registry_version_id uuid NOT NULL REFERENCES malign.card_registry_versions(id),
  requirement_type text NOT NULL,
  parameters_json jsonb NOT NULL CHECK (jsonb_typeof(parameters_json) = 'object'),
  parameters_schema_id text NOT NULL,
  parameters_schema_version text NOT NULL,
  order_index integer NOT NULL CHECK (order_index >= 0),
  UNIQUE (card_definition_id, order_index, registry_version_id)
);
CREATE TABLE malign.card_effect_definitions (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  logical_effect_id text NOT NULL,
  card_definition_id uuid REFERENCES malign.card_definitions(id),
  ruleset_version_id uuid NOT NULL REFERENCES malign.ruleset_versions(id),
  registry_version_id uuid REFERENCES malign.card_registry_versions(id),
  effect_type text NOT NULL,
  timing_window text NOT NULL,
  trigger_json jsonb NOT NULL CHECK (jsonb_typeof(trigger_json) = 'object'),
  operations_json jsonb NOT NULL CHECK (jsonb_typeof(operations_json) = 'array'),
  operations_schema_id text NOT NULL,
  operations_schema_version text NOT NULL,
  order_index integer NOT NULL CHECK (order_index >= 0),
  effect_version text NOT NULL,
  source_text text NOT NULL,
  status text NOT NULL,
  UNIQUE (logical_effect_id, effect_version),
  UNIQUE NULLS NOT DISTINCT (card_definition_id, order_index, effect_version)
);
ALTER TABLE malign.regime_ability_definitions ADD CONSTRAINT regime_effect_fk FOREIGN KEY (effect_definition_id) REFERENCES malign.card_effect_definitions(id);
CREATE TABLE malign.card_aliases (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  registry_version_id uuid NOT NULL REFERENCES malign.card_registry_versions(id),
  alias_normalized text NOT NULL,
  alias_display text NOT NULL,
  card_definition_id uuid NOT NULL REFERENCES malign.card_definitions(id),
  locale text NOT NULL DEFAULT 'es',
  source_reference text NOT NULL,
  UNIQUE (registry_version_id, alias_normalized, locale)
);
CREATE TABLE malign.demographic_token_definitions (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  logical_id text NOT NULL,
  ruleset_version_id uuid NOT NULL REFERENCES malign.ruleset_versions(id),
  category text NOT NULL,
  canonical_value text NOT NULL,
  display_label text NOT NULL,
  visual_asset_key text,
  status text NOT NULL,
  UNIQUE (logical_id, ruleset_version_id),
  UNIQUE (category, canonical_value, ruleset_version_id)
);

CREATE TABLE malign.ert_definitions (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  logical_id text NOT NULL,
  name text NOT NULL,
  ruleset_version_id uuid NOT NULL REFERENCES malign.ruleset_versions(id),
  status text NOT NULL,
  UNIQUE (logical_id, ruleset_version_id)
);
CREATE TABLE malign.ert_cells (
  ert_definition_id uuid NOT NULL REFERENCES malign.ert_definitions(id),
  tier text NOT NULL,
  die_value smallint NOT NULL CHECK (die_value BETWEEN 1 AND 10),
  malign_result integer NOT NULL,
  resiliency_result integer NOT NULL,
  PRIMARY KEY (ert_definition_id, tier, die_value)
);
CREATE TABLE malign.scenario_definitions (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  logical_id text NOT NULL,
  canonical_name text NOT NULL,
  scenario_version text NOT NULL,
  narrative text NOT NULL,
  default_turn_limit integer CHECK (default_turn_limit > 0),
  allows_instant_victory boolean NOT NULL DEFAULT false,
  ruleset_version_id uuid NOT NULL REFERENCES malign.ruleset_versions(id),
  card_registry_version_id uuid NOT NULL REFERENCES malign.card_registry_versions(id),
  status text NOT NULL,
  source_reference text NOT NULL,
  UNIQUE (logical_id, scenario_version),
  UNIQUE (canonical_name, scenario_version)
);
CREATE TABLE malign.scenario_country_configs (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  scenario_definition_id uuid NOT NULL REFERENCES malign.scenario_definitions(id),
  country_definition_id uuid NOT NULL REFERENCES malign.country_definitions(id),
  starting_resources malign.nonnegative_int NOT NULL,
  turn_income malign.nonnegative_int NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  UNIQUE (scenario_definition_id, country_definition_id)
);
CREATE TABLE malign.scenario_pd_definitions (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  scenario_definition_id uuid NOT NULL REFERENCES malign.scenario_definitions(id),
  logical_pd_id text NOT NULL,
  host_country_definition_id uuid NOT NULL REFERENCES malign.country_definitions(id),
  local_index smallint NOT NULL CHECK (local_index > 0),
  gamebook_label text,
  board_label text,
  population_size text NOT NULL,
  visual_anchor_key text,
  UNIQUE (scenario_definition_id, logical_pd_id),
  UNIQUE (scenario_definition_id, host_country_definition_id, local_index)
);
CREATE TABLE malign.scenario_pd_demographics (
  scenario_pd_definition_id uuid NOT NULL REFERENCES malign.scenario_pd_definitions(id),
  demographic_token_definition_id uuid NOT NULL REFERENCES malign.demographic_token_definitions(id),
  PRIMARY KEY (scenario_pd_definition_id, demographic_token_definition_id)
);
CREATE TABLE malign.scenario_initial_influences (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  scenario_pd_definition_id uuid NOT NULL REFERENCES malign.scenario_pd_definitions(id),
  influence_type text NOT NULL,
  attribution_country_definition_id uuid NOT NULL REFERENCES malign.country_definitions(id),
  count integer NOT NULL CHECK (count > 0),
  source_reference text NOT NULL
);
CREATE TABLE malign.scenario_rule_configs (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  scenario_definition_id uuid NOT NULL REFERENCES malign.scenario_definitions(id),
  key text NOT NULL,
  value_json jsonb NOT NULL,
  value_schema_id text NOT NULL,
  value_schema_version text NOT NULL,
  rule_version text NOT NULL,
  UNIQUE (scenario_definition_id, key, rule_version)
);
CREATE TABLE malign.victory_objective_definitions (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  scenario_definition_id uuid NOT NULL REFERENCES malign.scenario_definitions(id),
  logical_id text NOT NULL,
  country_definition_id uuid NOT NULL REFERENCES malign.country_definitions(id),
  tier text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  points_mode text NOT NULL,
  points_value integer NOT NULL,
  evaluator_type text NOT NULL,
  evaluator_parameters_json jsonb NOT NULL CHECK (jsonb_typeof(evaluator_parameters_json) = 'object'),
  evaluator_schema_id text NOT NULL,
  evaluator_schema_version text NOT NULL,
  requires_facilitator_tag boolean NOT NULL,
  instant_victory boolean NOT NULL,
  display_order integer NOT NULL CHECK (display_order >= 0),
  UNIQUE (scenario_definition_id, logical_id)
);

CREATE TABLE malign.games (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  name text NOT NULL,
  status text NOT NULL,
  ruleset_version_id uuid NOT NULL REFERENCES malign.ruleset_versions(id),
  scenario_definition_id uuid NOT NULL REFERENCES malign.scenario_definitions(id),
  card_registry_version_id uuid NOT NULL REFERENCES malign.card_registry_versions(id),
  engine_contract_version_id uuid NOT NULL REFERENCES malign.engine_contract_versions(id),
  ert_definition_id uuid NOT NULL REFERENCES malign.ert_definitions(id),
  facilitator_participant_id uuid,
  turn_limit integer CHECK (turn_limit > 0),
  dice_mode text NOT NULL,
  beginner_narrative_leniency boolean NOT NULL DEFAULT false,
  viral_variant text NOT NULL DEFAULT 'BASE',
  game_version bigint NOT NULL DEFAULT 0 CHECK (game_version >= 0),
  event_sequence_head bigint NOT NULL DEFAULT 0 CHECK (event_sequence_head >= 0),
  outbox_sequence_head bigint NOT NULL DEFAULT 0 CHECK (outbox_sequence_head >= 0),
  authoritative_state_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(authoritative_state_json) = 'object'),
  gameplay_state_hash bytea NOT NULL DEFAULT decode(repeat('00', 32), 'hex'),
  noncanonical boolean NOT NULL DEFAULT false,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, game_version)
);
CREATE INDEX games_status_created_idx ON malign.games (status, created_at);
CREATE TABLE malign.game_sessions (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL UNIQUE REFERENCES malign.games(id),
  state text NOT NULL,
  opened_at timestamptz NOT NULL,
  closed_at timestamptz
);
CREATE TABLE malign.game_participants (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  external_user_ref text NOT NULL,
  role text NOT NULL,
  status text NOT NULL,
  joined_at timestamptz NOT NULL,
  left_at timestamptz,
  UNIQUE (game_id, external_user_ref),
  UNIQUE (game_id, id)
);
CREATE INDEX game_participants_scope_idx ON malign.game_participants (game_id, role, status);
ALTER TABLE malign.games ADD CONSTRAINT games_facilitator_fk FOREIGN KEY (id, facilitator_participant_id) REFERENCES malign.game_participants(game_id, id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE malign.game_memberships (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_session_id uuid NOT NULL REFERENCES malign.game_sessions(id),
  participant_id uuid NOT NULL REFERENCES malign.game_participants(id),
  authenticated_session_digest bytea NOT NULL CHECK (octet_length(authenticated_session_digest) > 0),
  connected boolean NOT NULL DEFAULT false,
  last_verified_at timestamptz NOT NULL,
  disconnected_at timestamptz,
  UNIQUE (game_session_id, participant_id),
  UNIQUE (game_session_id, authenticated_session_digest)
);
CREATE TABLE malign.player_seats (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  participant_id uuid NOT NULL,
  seat_index smallint NOT NULL CHECK (seat_index >= 0),
  clockwise_index smallint NOT NULL CHECK (clockwise_index >= 0),
  country_definition_id uuid NOT NULL REFERENCES malign.country_definitions(id),
  UNIQUE (game_id, participant_id),
  UNIQUE (game_id, country_definition_id),
  UNIQUE (game_id, clockwise_index),
  FOREIGN KEY (game_id, participant_id) REFERENCES malign.game_participants(game_id, id)
);
CREATE TABLE malign.game_countries (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  country_definition_id uuid NOT NULL REFERENCES malign.country_definitions(id),
  controlling_participant_id uuid NOT NULL,
  current_vp_cache malign.nonnegative_int NOT NULL DEFAULT 0,
  current_resources_cache malign.nonnegative_int NOT NULL DEFAULT 0,
  legitimacy_count_cache malign.nonnegative_int NOT NULL DEFAULT 0,
  UNIQUE (game_id, country_definition_id),
  UNIQUE (game_id, id),
  FOREIGN KEY (game_id, controlling_participant_id) REFERENCES malign.game_participants(game_id, id)
);
CREATE TABLE malign.turns (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  number integer NOT NULL CHECK (number > 0),
  status text NOT NULL,
  started_at timestamptz,
  ended_at timestamptz,
  UNIQUE (game_id, number),
  UNIQUE (game_id, id)
);
CREATE TABLE malign.phase_states (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  turn_id uuid NOT NULL,
  phase_type text NOT NULL,
  status text NOT NULL,
  opened_at timestamptz,
  locked_at timestamptz,
  resolved_at timestamptz,
  UNIQUE (turn_id, phase_type),
  UNIQUE (game_id, id),
  FOREIGN KEY (game_id, turn_id) REFERENCES malign.turns(game_id, id)
);
CREATE TABLE malign.player_phase_readiness (
  phase_state_id uuid NOT NULL,
  game_id uuid NOT NULL REFERENCES malign.games(id),
  participant_id uuid NOT NULL,
  status text NOT NULL,
  locked_at timestamptz,
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  PRIMARY KEY (phase_state_id, participant_id),
  FOREIGN KEY (game_id, phase_state_id) REFERENCES malign.phase_states(game_id, id),
  FOREIGN KEY (game_id, participant_id) REFERENCES malign.game_participants(game_id, id)
);
CREATE TABLE malign.initiative_rolls (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  turn_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  die_roll_id uuid,
  is_tiebreak boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (turn_id, participant_id, attempt_number),
  FOREIGN KEY (game_id, turn_id) REFERENCES malign.turns(game_id, id),
  FOREIGN KEY (game_id, participant_id) REFERENCES malign.game_participants(game_id, id)
);
CREATE TABLE malign.initiative_entries (
  game_id uuid NOT NULL REFERENCES malign.games(id),
  turn_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  initiative_position smallint NOT NULL CHECK (initiative_position > 0),
  winning_roll smallint NOT NULL CHECK (winning_roll BETWEEN 1 AND 10),
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  PRIMARY KEY (turn_id, participant_id),
  UNIQUE (turn_id, initiative_position),
  FOREIGN KEY (game_id, turn_id) REFERENCES malign.turns(game_id, id),
  FOREIGN KEY (game_id, participant_id) REFERENCES malign.game_participants(game_id, id)
);

CREATE TABLE malign.action_point_balances (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  turn_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  allocated malign.nonnegative_int NOT NULL,
  spent malign.nonnegative_int NOT NULL,
  remaining malign.nonnegative_int NOT NULL,
  last_transaction_sequence bigint NOT NULL DEFAULT 0 CHECK (last_transaction_sequence >= 0),
  UNIQUE (turn_id, participant_id),
  CHECK (allocated = spent + remaining),
  FOREIGN KEY (game_id, turn_id) REFERENCES malign.turns(game_id, id),
  FOREIGN KEY (game_id, participant_id) REFERENCES malign.game_participants(game_id, id)
);
CREATE TABLE malign.action_point_transactions (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  game_event_sequence malign.positive_bigint NOT NULL,
  artifact_ordinal smallint NOT NULL CHECK (artifact_ordinal > 0),
  turn_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  sequence_number malign.positive_bigint NOT NULL,
  delta integer NOT NULL CHECK (delta <> 0),
  reason_type text NOT NULL,
  source_entity_type text,
  source_entity_id uuid,
  correlation_id uuid NOT NULL,
  adjudication_trace_id uuid,
  balance_after malign.nonnegative_int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (game_id, turn_id, participant_id, sequence_number),
  UNIQUE (game_id, game_event_sequence, artifact_ordinal),
  CHECK ((source_entity_type IS NULL) = (source_entity_id IS NULL))
);
CREATE TABLE malign.resource_transactions (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  game_event_sequence malign.positive_bigint NOT NULL,
  artifact_ordinal smallint NOT NULL CHECK (artifact_ordinal > 0),
  turn_id uuid,
  participant_id uuid NOT NULL,
  delta integer NOT NULL CHECK (delta <> 0),
  reason_type text NOT NULL,
  source_entity_type text,
  source_entity_id uuid,
  counterparty_participant_id uuid,
  adjudication_trace_id uuid,
  balance_after malign.nonnegative_int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (game_id, game_event_sequence, artifact_ordinal),
  CHECK ((source_entity_type IS NULL) = (source_entity_id IS NULL))
);
CREATE TABLE malign.card_instances (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  country_owner_definition_id uuid NOT NULL REFERENCES malign.country_definitions(id),
  serial_template_id uuid NOT NULL REFERENCES malign.country_card_serial_templates(id),
  card_definition_id uuid NOT NULL REFERENCES malign.card_definitions(id),
  current_controller_participant_id uuid NOT NULL,
  zone text NOT NULL,
  face_state text NOT NULL DEFAULT 'FACE_DOWN',
  removed_from_game boolean NOT NULL DEFAULT false,
  return_to_owner_on_discard boolean NOT NULL DEFAULT false,
  UNIQUE (game_id, country_owner_definition_id, serial_template_id),
  UNIQUE (game_id, id),
  FOREIGN KEY (game_id, current_controller_participant_id) REFERENCES malign.game_participants(game_id, id),
  CHECK (NOT removed_from_game OR zone = 'REMOVED_FROM_GAME')
);
CREATE INDEX card_instances_controller_zone_idx ON malign.card_instances (game_id, current_controller_participant_id, zone);
CREATE TABLE malign.deck_card_positions (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  participant_id uuid NOT NULL,
  card_instance_id uuid NOT NULL,
  position integer NOT NULL CHECK (position > 0),
  shuffle_revision bigint NOT NULL CHECK (shuffle_revision > 0),
  UNIQUE (game_id, participant_id, shuffle_revision, position),
  UNIQUE (card_instance_id, shuffle_revision),
  FOREIGN KEY (game_id, participant_id) REFERENCES malign.game_participants(game_id, id),
  FOREIGN KEY (game_id, card_instance_id) REFERENCES malign.card_instances(game_id, id)
);
CREATE TABLE malign.campaigns (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  owner_participant_id uuid NOT NULL,
  created_turn_id uuid NOT NULL,
  row text NOT NULL CHECK (row IN ('I','II')),
  state text NOT NULL,
  intent_alignment text NOT NULL,
  target_dt_id uuid,
  last_activated_turn_id uuid,
  activation_count_current_turn_cache malign.nonnegative_int NOT NULL DEFAULT 0,
  UNIQUE (game_id, id),
  FOREIGN KEY (game_id, owner_participant_id) REFERENCES malign.game_participants(game_id, id),
  FOREIGN KEY (game_id, created_turn_id) REFERENCES malign.turns(game_id, id)
);
CREATE TABLE malign.campaign_card_assignments (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  campaign_id uuid NOT NULL,
  slot_type text NOT NULL,
  card_instance_id uuid NOT NULL,
  assigned_turn_id uuid NOT NULL,
  removed_turn_id uuid,
  FOREIGN KEY (game_id, campaign_id) REFERENCES malign.campaigns(game_id, id),
  FOREIGN KEY (game_id, card_instance_id) REFERENCES malign.card_instances(game_id, id)
);
CREATE UNIQUE INDEX campaign_slot_active_uk ON malign.campaign_card_assignments (campaign_id, slot_type) WHERE removed_turn_id IS NULL;
CREATE UNIQUE INDEX campaign_card_active_uk ON malign.campaign_card_assignments (card_instance_id) WHERE removed_turn_id IS NULL;
CREATE TABLE malign.population_demographic_states (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  scenario_pd_definition_id uuid NOT NULL REFERENCES malign.scenario_pd_definitions(id),
  host_country_definition_id uuid NOT NULL REFERENCES malign.country_definitions(id),
  current_legitimacy_participant_id uuid,
  UNIQUE (game_id, scenario_pd_definition_id),
  UNIQUE (game_id, id)
);
CREATE TABLE malign.influence_stacks (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  pd_state_id uuid NOT NULL,
  influence_type text NOT NULL,
  attribution_country_definition_id uuid NOT NULL REFERENCES malign.country_definitions(id),
  count malign.nonnegative_int NOT NULL DEFAULT 0,
  UNIQUE (pd_state_id, influence_type, attribution_country_definition_id),
  FOREIGN KEY (game_id, pd_state_id) REFERENCES malign.population_demographic_states(game_id, id)
);
CREATE TABLE malign.influence_mutations (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  game_event_sequence malign.positive_bigint NOT NULL,
  artifact_ordinal smallint NOT NULL CHECK (artifact_ordinal > 0),
  turn_id uuid,
  adjudication_trace_id uuid,
  pd_state_id uuid NOT NULL,
  influence_type text NOT NULL,
  attribution_country_definition_id uuid NOT NULL,
  delta integer NOT NULL CHECK (delta <> 0),
  mutation_reason text NOT NULL,
  source_entity_type text,
  source_entity_id uuid,
  resulting_count malign.nonnegative_int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (game_id, game_event_sequence, artifact_ordinal)
);
CREATE TABLE malign.legitimacy_events (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  game_event_sequence malign.positive_bigint NOT NULL,
  artifact_ordinal smallint NOT NULL CHECK (artifact_ordinal > 0),
  turn_id uuid,
  pd_state_id uuid NOT NULL,
  previous_participant_id uuid,
  new_participant_id uuid,
  reason_type text NOT NULL,
  adjudication_trace_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (game_id, game_event_sequence, artifact_ordinal),
  CHECK (previous_participant_id IS DISTINCT FROM new_participant_id OR reason_type = 'AUDIT_ONLY')
);
CREATE TABLE malign.planned_actions (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  turn_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  sequence_within_player smallint NOT NULL CHECK (sequence_within_player BETWEEN 1 AND 3),
  action_type text NOT NULL,
  ap_cost malign.nonnegative_int NOT NULL,
  payload_json jsonb NOT NULL CHECK (jsonb_typeof(payload_json) = 'object'),
  payload_schema_id text NOT NULL,
  payload_schema_version text NOT NULL,
  state text NOT NULL,
  UNIQUE (turn_id, participant_id, sequence_within_player)
);
CREATE TABLE malign.action_resolutions (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  planned_action_id uuid NOT NULL UNIQUE REFERENCES malign.planned_actions(id),
  initiative_position smallint NOT NULL CHECK (initiative_position > 0),
  resolution_status text NOT NULL,
  adjudication_trace_id uuid,
  started_at timestamptz NOT NULL,
  ended_at timestamptz
);

CREATE TABLE malign.pending_resolutions (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  source_resolution_id uuid NOT NULL REFERENCES malign.action_resolutions(id),
  continuation_type text NOT NULL,
  continuation_state_json jsonb NOT NULL CHECK (jsonb_typeof(continuation_state_json) = 'object'),
  continuation_schema_id text NOT NULL,
  continuation_schema_version text NOT NULL,
  waiting_interaction_type text NOT NULL,
  waiting_interaction_id uuid NOT NULL,
  status text NOT NULL,
  ruleset_version_id uuid NOT NULL REFERENCES malign.ruleset_versions(id),
  engine_contract_version_id uuid NOT NULL REFERENCES malign.engine_contract_versions(id),
  state_hash bytea NOT NULL CHECK (octet_length(state_hash) = 32),
  UNIQUE (game_id, id)
);
CREATE UNIQUE INDEX pending_resolution_open_uk ON malign.pending_resolutions (game_id, source_resolution_id) WHERE status = 'OPEN';
CREATE TABLE malign.choice_requests (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  choice_version bigint NOT NULL CHECK (choice_version > 0),
  choice_type text NOT NULL,
  actor_participant_id uuid NOT NULL,
  source_resolution_id uuid NOT NULL,
  source_event_id uuid,
  visibility_scope text NOT NULL,
  status text NOT NULL,
  selection_mode text NOT NULL,
  min_selections malign.nonnegative_int NOT NULL,
  max_selections malign.nonnegative_int NOT NULL,
  options_json jsonb NOT NULL CHECK (jsonb_typeof(options_json) = 'array'),
  options_schema_id text NOT NULL,
  options_schema_version text NOT NULL,
  constraints_json jsonb,
  constraints_schema_id text,
  constraints_schema_version text,
  selected_option_ids_json jsonb,
  resolved_by_participant_id uuid,
  resolved_at timestamptz,
  expires_at timestamptz DEFAULT NULL CHECK (expires_at IS NULL),
  CHECK (max_selections >= min_selections),
  CHECK ((constraints_json IS NULL) = (constraints_schema_id IS NULL) AND (constraints_json IS NULL) = (constraints_schema_version IS NULL))
);
CREATE TABLE malign.reaction_windows (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  turn_id uuid NOT NULL,
  window_type text NOT NULL,
  triggering_entity_type text NOT NULL,
  triggering_entity_id uuid NOT NULL,
  triggering_participant_id uuid NOT NULL,
  parent_window_id uuid REFERENCES malign.reaction_windows(id),
  current_priority_index malign.nonnegative_int NOT NULL,
  state text NOT NULL,
  opened_at timestamptz NOT NULL,
  closed_at timestamptz,
  expires_at timestamptz DEFAULT NULL CHECK (expires_at IS NULL),
  UNIQUE (game_id, id)
);
CREATE TABLE malign.reaction_eligibilities (
  reaction_window_id uuid NOT NULL,
  game_id uuid NOT NULL REFERENCES malign.games(id),
  participant_id uuid NOT NULL,
  priority_order smallint NOT NULL CHECK (priority_order > 0),
  passed boolean NOT NULL DEFAULT false,
  row_version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (reaction_window_id, participant_id),
  UNIQUE (reaction_window_id, priority_order),
  FOREIGN KEY (game_id, reaction_window_id) REFERENCES malign.reaction_windows(game_id, id)
);
CREATE TABLE malign.reaction_plays (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  reaction_window_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  card_instance_id uuid NOT NULL,
  priority_order smallint NOT NULL CHECK (priority_order > 0),
  resolution_status text NOT NULL,
  adjudication_trace_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE malign.campaign_activations (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  turn_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  planned_action_id uuid,
  activation_ordinal integer NOT NULL CHECK (activation_ordinal > 0),
  activation_source text NOT NULL,
  target_pd_state_id uuid NOT NULL,
  target_dt_id uuid NOT NULL,
  base_cv integer NOT NULL,
  effective_cv integer NOT NULL,
  cost_tier text NOT NULL,
  resolution_tier text NOT NULL,
  tier_resource_cost malign.nonnegative_int NOT NULL,
  card_resource_cost malign.nonnegative_int NOT NULL,
  total_resource_cost malign.nonnegative_int NOT NULL,
  legitimacy_roll_bonus integer NOT NULL,
  roll_boost_spent boolean NOT NULL,
  die_roll_id uuid,
  modified_roll_raw integer,
  ert_lookup_roll smallint CHECK (ert_lookup_roll BETWEEN 1 AND 10),
  ert_result integer,
  outcome_type text NOT NULL,
  adjudication_trace_id uuid NOT NULL,
  UNIQUE (campaign_id, turn_id, activation_ordinal),
  CHECK (total_resource_cost = tier_resource_cost + card_resource_cost)
);
CREATE TABLE malign.narrative_requests (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  campaign_activation_id uuid NOT NULL,
  actor_participant_id uuid NOT NULL,
  status text NOT NULL,
  visibility_scope text NOT NULL,
  request_schema_id text NOT NULL,
  request_schema_version text NOT NULL,
  opened_at timestamptz NOT NULL,
  resolved_at timestamptz,
  expires_at timestamptz DEFAULT NULL CHECK (expires_at IS NULL)
);
CREATE UNIQUE INDEX narrative_request_open_uk ON malign.narrative_requests (campaign_activation_id) WHERE status = 'OPEN';
CREATE TABLE malign.narrative_submissions (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  campaign_activation_id uuid NOT NULL UNIQUE,
  participant_id uuid NOT NULL,
  text text NOT NULL,
  sentence_count malign.nonnegative_int NOT NULL,
  objective_tag_fluma_independence boolean NOT NULL,
  submitted_at timestamptz NOT NULL
);
CREATE TABLE malign.narrative_reviews (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  narrative_submission_id uuid NOT NULL UNIQUE REFERENCES malign.narrative_submissions(id),
  exceeds_length_rule boolean NOT NULL,
  suspected_card_text_reading boolean NOT NULL,
  facilitator_confirmed_reading_violation boolean NOT NULL,
  facilitator_plausibility_status text NOT NULL,
  notes text,
  reviewed_by_participant_id uuid,
  reviewed_at timestamptz
);
CREATE TABLE malign.veto_cases (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  turn_id uuid NOT NULL,
  narrative_submission_id uuid NOT NULL,
  veto_card_instance_id uuid NOT NULL,
  initiator_participant_id uuid NOT NULL,
  rationale text NOT NULL,
  defender_response text,
  state text NOT NULL,
  result text,
  resolved_at timestamptz
);
CREATE UNIQUE INDEX veto_case_active_uk ON malign.veto_cases (narrative_submission_id) WHERE resolved_at IS NULL;
CREATE TABLE malign.veto_votes (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  veto_case_id uuid NOT NULL REFERENCES malign.veto_cases(id),
  participant_id uuid NOT NULL,
  vote text NOT NULL,
  cast_at timestamptz NOT NULL,
  UNIQUE (veto_case_id, participant_id)
);
CREATE TABLE malign.die_rolls (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  turn_id uuid,
  participant_id uuid,
  die_type text NOT NULL,
  mode text NOT NULL,
  raw_value integer NOT NULL,
  source_type text NOT NULL,
  source_entity_id uuid NOT NULL,
  rng_metadata_json jsonb,
  rng_schema_id text,
  rng_schema_version text,
  entered_by_participant_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (die_type <> 'D10' OR raw_value BETWEEN 1 AND 10),
  CHECK ((rng_metadata_json IS NULL) = (rng_schema_id IS NULL) AND (rng_metadata_json IS NULL) = (rng_schema_version IS NULL))
);
ALTER TABLE malign.initiative_rolls ADD CONSTRAINT initiative_die_roll_fk FOREIGN KEY (die_roll_id) REFERENCES malign.die_rolls(id);
CREATE TABLE malign.modifier_applications (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  adjudication_trace_id uuid NOT NULL,
  modifier_type text NOT NULL,
  source_entity_type text NOT NULL,
  source_entity_id uuid NOT NULL,
  value integer NOT NULL,
  applied_to text NOT NULL,
  stacking_key text NOT NULL,
  UNIQUE (adjudication_trace_id, stacking_key)
);
CREATE TABLE malign.influence_resolutions (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  adjudication_trace_id uuid NOT NULL,
  pd_state_id uuid NOT NULL,
  incoming_type text NOT NULL,
  incoming_attribution_country_definition_id uuid NOT NULL,
  generated_count malign.nonnegative_int NOT NULL,
  consumed_in_cancellation malign.nonnegative_int NOT NULL,
  opposite_removed_count malign.nonnegative_int NOT NULL,
  placed_count malign.nonnegative_int NOT NULL,
  CHECK (generated_count = consumed_in_cancellation + placed_count),
  CHECK (consumed_in_cancellation = 2 * opposite_removed_count)
);
CREATE TABLE malign.viralization_resolutions (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  turn_id uuid NOT NULL,
  origin_pd_state_id uuid NOT NULL,
  legitimacy_owner_participant_id uuid NOT NULL,
  influence_type text NOT NULL,
  origin_count malign.nonnegative_int NOT NULL,
  threshold malign.nonnegative_int NOT NULL,
  target_pd_state_id uuid,
  shares_dt boolean NOT NULL,
  spread_check_die_roll_id uuid,
  spread_succeeded boolean NOT NULL,
  quantity_die_roll_id uuid,
  cubes_generated malign.nonnegative_int NOT NULL,
  adjudication_trace_id uuid NOT NULL
);
CREATE TABLE malign.regime_ability_activations (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  turn_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  ability_definition_id uuid NOT NULL REFERENCES malign.regime_ability_definitions(id),
  planned_action_id uuid NOT NULL REFERENCES malign.planned_actions(id),
  die_roll_id uuid,
  target_pd_state_id uuid,
  adjudication_trace_id uuid NOT NULL,
  UNIQUE (turn_id, participant_id, ability_definition_id)
);
CREATE TABLE malign.adjudication_traces (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  game_event_sequence malign.positive_bigint NOT NULL,
  artifact_ordinal smallint NOT NULL CHECK (artifact_ordinal > 0),
  turn_id uuid,
  phase_state_id uuid,
  participant_id uuid,
  trace_type text NOT NULL,
  source_action_id uuid,
  source_card_instance_id uuid,
  source_campaign_id uuid,
  target_pd_state_id uuid,
  pre_state_hash bytea NOT NULL CHECK (octet_length(pre_state_hash) = 32),
  post_state_hash bytea NOT NULL CHECK (octet_length(post_state_hash) = 32),
  input_snapshot_json jsonb NOT NULL CHECK (jsonb_typeof(input_snapshot_json) = 'object'),
  rule_evaluation_json jsonb NOT NULL CHECK (jsonb_typeof(rule_evaluation_json) = 'object'),
  output_snapshot_json jsonb NOT NULL CHECK (jsonb_typeof(output_snapshot_json) = 'object'),
  trace_schema_id text NOT NULL,
  trace_schema_version text NOT NULL,
  facilitator_intervention_id uuid,
  correlation_id uuid NOT NULL,
  causation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (game_id, game_event_sequence, artifact_ordinal)
);
CREATE TABLE malign.vp_transactions (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  game_event_sequence malign.positive_bigint NOT NULL,
  artifact_ordinal smallint NOT NULL CHECK (artifact_ordinal > 0),
  turn_id uuid,
  participant_id uuid NOT NULL,
  delta integer NOT NULL CHECK (delta <> 0),
  balance_after malign.nonnegative_int NOT NULL,
  reason_type text NOT NULL,
  source_entity_type text NOT NULL,
  source_entity_id uuid NOT NULL,
  adjudication_trace_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (game_id, game_event_sequence, artifact_ordinal)
);
CREATE TABLE malign.victory_objective_progress (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  objective_definition_id uuid NOT NULL REFERENCES malign.victory_objective_definitions(id),
  participant_id uuid NOT NULL,
  current_status_json jsonb NOT NULL,
  status_schema_id text NOT NULL,
  status_schema_version text NOT NULL,
  currently_qualifies boolean NOT NULL,
  calculated_at timestamptz NOT NULL,
  evaluator_version text NOT NULL,
  UNIQUE (game_id, objective_definition_id, participant_id)
);

CREATE TABLE malign.victory_objective_awards (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  objective_definition_id uuid NOT NULL REFERENCES malign.victory_objective_definitions(id),
  participant_id uuid NOT NULL,
  vp_awarded malign.nonnegative_int NOT NULL,
  evaluation_snapshot_json jsonb NOT NULL,
  snapshot_schema_id text NOT NULL,
  snapshot_schema_version text NOT NULL,
  awarded_at timestamptz NOT NULL,
  UNIQUE (game_id, objective_definition_id, participant_id)
);
CREATE TABLE malign.game_outcomes (
  game_id uuid PRIMARY KEY REFERENCES malign.games(id),
  completed_turn integer NOT NULL CHECK (completed_turn > 0),
  shared_tie boolean NOT NULL,
  tiebreak_stage text NOT NULL,
  final_scores_json jsonb NOT NULL,
  scores_schema_id text NOT NULL,
  scores_schema_version text NOT NULL,
  completed_at timestamptz NOT NULL,
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0)
);
CREATE TABLE malign.game_outcome_winners (
  game_id uuid NOT NULL REFERENCES malign.games(id),
  participant_id uuid NOT NULL,
  rank integer NOT NULL CHECK (rank > 0),
  PRIMARY KEY (game_id, participant_id)
);
CREATE TABLE malign.deal_promises (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  turn_id uuid,
  proposer_participant_id uuid NOT NULL,
  terms_text text NOT NULL,
  visibility_scope text NOT NULL,
  state text NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (game_id, id)
);
CREATE TABLE malign.deal_participants (
  deal_promise_id uuid NOT NULL,
  game_id uuid NOT NULL REFERENCES malign.games(id),
  participant_id uuid NOT NULL,
  role text NOT NULL,
  PRIMARY KEY (deal_promise_id, participant_id),
  FOREIGN KEY (game_id, deal_promise_id) REFERENCES malign.deal_promises(game_id, id)
);
CREATE TABLE malign.transfer_transactions (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  turn_id uuid NOT NULL,
  transfer_type text NOT NULL,
  from_participant_id uuid NOT NULL,
  to_participant_id uuid NOT NULL,
  card_instance_id uuid,
  resource_amount integer,
  state text NOT NULL,
  confirmed_by_from boolean NOT NULL DEFAULT false,
  confirmed_by_to boolean NOT NULL DEFAULT false,
  executed_at timestamptz,
  CHECK ((transfer_type = 'CARD' AND card_instance_id IS NOT NULL AND resource_amount IS NULL) OR (transfer_type = 'RESOURCE' AND card_instance_id IS NULL AND resource_amount > 0))
);
CREATE TABLE malign.temporary_reveals (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  source_effect_definition_id uuid NOT NULL REFERENCES malign.card_effect_definitions(id),
  viewer_participant_id uuid NOT NULL,
  target_participant_id uuid NOT NULL,
  scope text NOT NULL,
  opened_at timestamptz NOT NULL,
  expires_at_event_id uuid,
  closed_at timestamptz,
  UNIQUE (game_id, id)
);
CREATE TABLE malign.temporary_reveal_cards (
  temporary_reveal_id uuid NOT NULL,
  game_id uuid NOT NULL REFERENCES malign.games(id),
  card_instance_id uuid NOT NULL,
  PRIMARY KEY (temporary_reveal_id, card_instance_id),
  FOREIGN KEY (game_id, temporary_reveal_id) REFERENCES malign.temporary_reveals(game_id, id),
  FOREIGN KEY (game_id, card_instance_id) REFERENCES malign.card_instances(game_id, id)
);
CREATE TABLE malign.visibility_grants (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  viewer_type text NOT NULL,
  viewer_id uuid,
  permission text NOT NULL,
  source text NOT NULL,
  expires_at timestamptz,
  CHECK ((viewer_type = 'PUBLIC' AND viewer_id IS NULL) OR (viewer_type <> 'PUBLIC' AND viewer_id IS NOT NULL))
);
CREATE TABLE malign.facilitator_decisions (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  turn_id uuid,
  participant_id uuid,
  decision_type text NOT NULL,
  target_entity_type text NOT NULL,
  target_entity_id uuid NOT NULL,
  rationale text NOT NULL CHECK (btrim(rationale) <> ''),
  before_snapshot_json jsonb,
  after_snapshot_json jsonb,
  snapshot_schema_id text,
  snapshot_schema_version text,
  created_by_participant_id uuid NOT NULL,
  noncanonical boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((before_snapshot_json IS NULL AND after_snapshot_json IS NULL AND snapshot_schema_id IS NULL AND snapshot_schema_version IS NULL) OR (snapshot_schema_id IS NOT NULL AND snapshot_schema_version IS NOT NULL))
);
CREATE TABLE malign.game_events (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  sequence_number malign.positive_bigint NOT NULL,
  turn_id uuid,
  phase_state_id uuid,
  event_type text NOT NULL,
  actor_participant_id uuid,
  subject_type text,
  subject_id uuid,
  payload_json jsonb NOT NULL CHECK (jsonb_typeof(payload_json) = 'object'),
  payload_schema_id text NOT NULL,
  payload_schema_version text NOT NULL,
  visibility_class text NOT NULL,
  caused_by_event_id uuid,
  adjudication_trace_id uuid,
  correlation_id uuid NOT NULL,
  causation_id uuid,
  state_hash_after bytea,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (game_id, sequence_number),
  UNIQUE (game_id, id)
);
CREATE INDEX game_events_replay_idx ON malign.game_events (game_id, sequence_number, id);
CREATE INDEX game_events_type_idx ON malign.game_events (game_id, event_type, sequence_number);
CREATE TABLE malign.game_snapshots (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  game_version bigint NOT NULL CHECK (game_version >= 0),
  last_event_sequence bigint NOT NULL CHECK (last_event_sequence >= 0),
  snapshot_json jsonb NOT NULL CHECK (jsonb_typeof(snapshot_json) = 'object'),
  snapshot_schema_id text NOT NULL,
  snapshot_schema_version text NOT NULL,
  canonical_jcs_sha256 bytea NOT NULL CHECK (octet_length(canonical_jcs_sha256) = 32),
  gameplay_state_hash bytea NOT NULL CHECK (octet_length(gameplay_state_hash) = 32),
  ruleset_version_id uuid NOT NULL REFERENCES malign.ruleset_versions(id),
  scenario_definition_id uuid NOT NULL REFERENCES malign.scenario_definitions(id),
  card_registry_version_id uuid NOT NULL REFERENCES malign.card_registry_versions(id),
  engine_contract_version_id uuid NOT NULL REFERENCES malign.engine_contract_versions(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (game_id, game_version)
);
CREATE INDEX game_snapshots_latest_idx ON malign.game_snapshots (game_id, game_version DESC);
CREATE TABLE malign.idempotency_records (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  actor_id text NOT NULL,
  idempotency_key text NOT NULL,
  command_id uuid NOT NULL,
  command_fingerprint bytea NOT NULL CHECK (octet_length(command_fingerprint) = 32),
  command_type text NOT NULL,
  status text NOT NULL DEFAULT 'INTERNAL_PENDING',
  game_version_before bigint NOT NULL CHECK (game_version_before >= 0),
  game_version_after bigint CHECK (game_version_after >= 0),
  result_json jsonb,
  result_schema_id text,
  result_schema_version text,
  completed_at timestamptz,
  UNIQUE (game_id, actor_id, idempotency_key),
  UNIQUE (game_id, command_id),
  CHECK ((status = 'INTERNAL_PENDING' AND game_version_after IS NULL AND result_json IS NULL AND result_schema_id IS NULL AND result_schema_version IS NULL AND completed_at IS NULL) OR (status = 'COMMITTED' AND game_version_after IS NOT NULL AND result_json IS NOT NULL AND result_schema_id IS NOT NULL AND result_schema_version IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE TABLE malign.outbox_messages (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  outbox_sequence malign.positive_bigint NOT NULL,
  event_id uuid NOT NULL,
  topic text NOT NULL,
  audience_class text NOT NULL,
  audience_id uuid,
  payload_json jsonb NOT NULL CHECK (jsonb_typeof(payload_json) = 'object'),
  payload_schema_id text NOT NULL,
  payload_schema_version text NOT NULL,
  correlation_id uuid NOT NULL,
  deduplication_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (game_id, outbox_sequence),
  UNIQUE NULLS NOT DISTINCT (event_id, audience_class, audience_id),
  FOREIGN KEY (game_id, event_id) REFERENCES malign.game_events(game_id, id)
);
CREATE INDEX outbox_messages_claim_order_idx ON malign.outbox_messages (game_id, outbox_sequence, id);
CREATE TABLE malign.outbox_delivery_states (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  outbox_message_id uuid NOT NULL UNIQUE REFERENCES malign.outbox_messages(id),
  delivery_status text NOT NULL DEFAULT 'PENDING',
  last_attempt_ordinal bigint NOT NULL DEFAULT 0 CHECK (last_attempt_ordinal >= 0),
  claim_token_digest bytea,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  acknowledged_at timestamptz,
  next_attempt_at timestamptz,
  last_error_code text
);
CREATE INDEX outbox_delivery_states_claim_idx ON malign.outbox_delivery_states (delivery_status, next_attempt_at, claim_expires_at);
CREATE TABLE malign.outbox_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  outbox_message_id uuid NOT NULL REFERENCES malign.outbox_messages(id),
  attempt_ordinal bigint NOT NULL CHECK (attempt_ordinal > 0),
  stage_ordinal smallint NOT NULL CHECK (stage_ordinal > 0),
  event_type text NOT NULL CHECK (event_type IN ('CLAIM','SEND_STARTED','SEND_RETURNED','ACK','FAIL','LEASE_EXPIRED','RETRY_SCHEDULED')),
  occurred_at timestamptz NOT NULL,
  claim_token_digest bytea,
  transport_message_id text,
  result_code text,
  error_code text,
  redacted_detail_json jsonb,
  correlation_id uuid NOT NULL,
  UNIQUE (outbox_message_id, attempt_ordinal, stage_ordinal)
);
CREATE TABLE malign.realtime_delivery_cursors (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  participant_id uuid NOT NULL,
  projection_id text NOT NULL,
  game_version bigint NOT NULL CHECK (game_version >= 0),
  last_sequence_number bigint NOT NULL CHECK (last_sequence_number >= 0),
  subscription_epoch bigint NOT NULL CHECK (subscription_epoch >= 0),
  last_acknowledged_at timestamptz NOT NULL,
  status text NOT NULL,
  UNIQUE (game_id, participant_id, projection_id)
);
CREATE TABLE malign.die_requests (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  purpose text NOT NULL,
  die_type text NOT NULL,
  requested_for_participant_id uuid,
  source_mode text NOT NULL,
  status text NOT NULL,
  visibility_scope text NOT NULL,
  modifier_policy_ref text,
  resolved_die_roll_id uuid REFERENCES malign.die_rolls(id),
  resolved_at timestamptz,
  expires_at timestamptz DEFAULT NULL CHECK (expires_at IS NULL),
  CHECK (status <> 'RESOLVED' OR (resolved_die_roll_id IS NOT NULL AND resolved_at IS NOT NULL))
);
CREATE UNIQUE INDEX die_requests_open_uk ON malign.die_requests (game_id, purpose, requested_for_participant_id) WHERE status = 'OPEN';
CREATE TABLE malign.facilitator_requests (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) = 7),
  game_id uuid NOT NULL REFERENCES malign.games(id),
  request_type text NOT NULL,
  source_resolution_id uuid,
  subject_participant_id uuid,
  safe_context_json jsonb NOT NULL CHECK (jsonb_typeof(safe_context_json) = 'object'),
  safe_context_schema_id text NOT NULL,
  safe_context_schema_version text NOT NULL,
  full_context_trace_id uuid,
  status text NOT NULL,
  resolved_by_participant_id uuid,
  resolved_at timestamptz,
  expires_at timestamptz DEFAULT NULL CHECK (expires_at IS NULL)
);
CREATE UNIQUE INDEX facilitator_requests_open_uk ON malign.facilitator_requests (game_id, request_type, source_resolution_id) WHERE status = 'OPEN';
