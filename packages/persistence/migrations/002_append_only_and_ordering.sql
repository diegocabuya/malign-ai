-- DEC-078 / M2-A. Durable history is corrected by compensation, never rewrite.
CREATE FUNCTION malign.reject_historical_rewrite()
RETURNS trigger
LANGUAGE plpgsql
AS $body$
BEGIN
  RAISE EXCEPTION 'M2A_APPEND_ONLY_VIOLATION:%', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END
$body$;

DO $body$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'registry_seed_runs',
    'action_point_transactions',
    'resource_transactions',
    'influence_mutations',
    'legitimacy_events',
    'reaction_plays',
    'narrative_submissions',
    'veto_votes',
    'die_rolls',
    'modifier_applications',
    'influence_resolutions',
    'viralization_resolutions',
    'regime_ability_activations',
    'adjudication_traces',
    'vp_transactions',
    'victory_objective_awards',
    'game_events',
    'game_snapshots',
    'outbox_messages',
    'outbox_delivery_attempts',
    'facilitator_decisions'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_append_only BEFORE UPDATE OR DELETE ON malign.%I '
      'FOR EACH ROW EXECUTE FUNCTION malign.reject_historical_rewrite()',
      table_name,
      table_name
    );
  END LOOP;
END
$body$;

CREATE FUNCTION malign.seal_idempotency_result()
RETURNS trigger
LANGUAGE plpgsql
AS $body$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'M2A_IDEMPOTENCY_DELETE_FORBIDDEN'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF OLD.status <> 'INTERNAL_PENDING'
     OR NEW.status <> 'COMMITTED'
     OR NEW.game_id <> OLD.game_id
     OR NEW.idempotency_key <> OLD.idempotency_key
     OR NEW.actor_id <> OLD.actor_id
     OR NEW.command_id <> OLD.command_id
     OR NEW.command_fingerprint <> OLD.command_fingerprint
     OR NEW.command_type <> OLD.command_type
     OR NEW.game_version_before <> OLD.game_version_before
     OR NEW.result_json IS NULL
     OR NEW.game_version_after IS NULL
  THEN
    RAISE EXCEPTION 'M2A_IDEMPOTENCY_SEAL_VIOLATION'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END
$body$;

CREATE TRIGGER idempotency_records_seal
BEFORE UPDATE OR DELETE ON malign.idempotency_records
FOR EACH ROW EXECUTE FUNCTION malign.seal_idempotency_result();

CREATE FUNCTION malign.protect_game_version_pins()
RETURNS trigger
LANGUAGE plpgsql
AS $body$
BEGIN
  IF NEW.ruleset_version_id <> OLD.ruleset_version_id
     OR NEW.scenario_definition_id <> OLD.scenario_definition_id
     OR NEW.card_registry_version_id <> OLD.card_registry_version_id
     OR NEW.engine_contract_version_id <> OLD.engine_contract_version_id
     OR NEW.ert_definition_id <> OLD.ert_definition_id
  THEN
    RAISE EXCEPTION 'M2A_GAME_PIN_IMMUTABLE'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$body$;

CREATE TRIGGER games_protect_version_pins
BEFORE UPDATE ON malign.games
FOR EACH ROW EXECUTE FUNCTION malign.protect_game_version_pins();

CREATE INDEX game_events_replay_keyset_idx
  ON malign.game_events (game_id, sequence_number, id);
CREATE INDEX adjudication_traces_artifact_order_idx
  ON malign.adjudication_traces (game_id, game_event_sequence, artifact_ordinal);
CREATE INDEX outbox_messages_claim_idx
  ON malign.outbox_messages (game_id, outbox_sequence, id);
CREATE INDEX outbox_delivery_states_pending_idx
  ON malign.outbox_delivery_states (delivery_status, next_attempt_at, claim_expires_at, outbox_message_id);
CREATE INDEX pending_resolutions_dashboard_idx
  ON malign.pending_resolutions (game_id, status, id);
CREATE INDEX choice_requests_dashboard_idx
  ON malign.choice_requests (game_id, status, id);
