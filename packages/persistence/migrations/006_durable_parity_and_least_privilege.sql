-- DEC-078/DEC-079 forward-only correction for M2A-R20…R24.

-- The approved Physical Database Spec uses typed plan targeting/parameters rather
-- than the bootstrap-only generic payload columns.
ALTER TABLE malign.planned_actions
  ADD COLUMN target_entity_type text,
  ADD COLUMN target_entity_id uuid,
  ADD COLUMN card_instance_id uuid,
  ADD COLUMN campaign_id uuid,
  ADD COLUMN parameters_json jsonb,
  ADD COLUMN parameters_schema_id text,
  ADD COLUMN parameters_schema_version text,
  ADD COLUMN locked_at timestamptz;

UPDATE malign.planned_actions
   SET parameters_json=payload_json,
       parameters_schema_id=payload_schema_id,
       parameters_schema_version=payload_schema_version;

ALTER TABLE malign.planned_actions
  DROP COLUMN payload_json,
  DROP COLUMN payload_schema_id,
  DROP COLUMN payload_schema_version,
  ADD CONSTRAINT planned_actions_target_pair CHECK (
    (target_entity_type IS NULL) = (target_entity_id IS NULL)
  ),
  ADD CONSTRAINT planned_actions_parameters_schema_pair CHECK (
    (parameters_json IS NULL) = (parameters_schema_id IS NULL)
    AND (parameters_json IS NULL) = (parameters_schema_version IS NULL)
  ),
  ADD CONSTRAINT planned_actions_parameters_object CHECK (
    parameters_json IS NULL OR jsonb_typeof(parameters_json)='object'
  ),
  ADD CONSTRAINT planned_actions_card_cross_game_fk
    FOREIGN KEY (game_id,card_instance_id) REFERENCES malign.card_instances(game_id,id),
  ADD CONSTRAINT planned_actions_campaign_cross_game_fk
    FOREIGN KEY (game_id,campaign_id) REFERENCES malign.campaigns(game_id,id);

CREATE INDEX planned_actions_scope_state_idx
  ON malign.planned_actions(game_id,turn_id,participant_id,state);

-- Every legacy event that owns a journal row receives one technical trace. This
-- permits the AP trace column to become NOT NULL without rewriting migrations 001…005.
WITH missing AS (
  SELECT DISTINCT journal.game_id,journal.game_event_sequence
    FROM (
      SELECT game_id,game_event_sequence FROM malign.action_point_transactions WHERE adjudication_trace_id IS NULL
      UNION SELECT game_id,game_event_sequence FROM malign.resource_transactions WHERE adjudication_trace_id IS NULL
      UNION SELECT game_id,game_event_sequence FROM malign.influence_mutations WHERE adjudication_trace_id IS NULL
      UNION SELECT game_id,game_event_sequence FROM malign.legitimacy_events WHERE adjudication_trace_id IS NULL
      UNION SELECT game_id,game_event_sequence FROM malign.vp_transactions WHERE adjudication_trace_id IS NULL
    ) journal
), prepared AS (
  SELECT missing.game_id,missing.game_event_sequence,
         COALESCE((SELECT max(t.artifact_ordinal) FROM malign.adjudication_traces t
                    WHERE t.game_id=missing.game_id AND t.game_event_sequence=missing.game_event_sequence),0)+1 ordinal,
         COALESCE(previous.state_hash_after,current.state_hash_after,g.gameplay_state_hash) pre_hash,
         COALESCE(current.state_hash_after,g.gameplay_state_hash) post_hash,
         COALESCE(current.correlation_id,uuidv7()) correlation_id
    FROM missing JOIN malign.games g ON g.id=missing.game_id
    LEFT JOIN malign.game_events current ON current.game_id=missing.game_id
      AND current.sequence_number=missing.game_event_sequence
    LEFT JOIN malign.game_events previous ON previous.game_id=missing.game_id
      AND previous.sequence_number=missing.game_event_sequence-1
)
INSERT INTO malign.adjudication_traces(
  game_id,game_event_sequence,artifact_ordinal,participant_id,trace_type,
  pre_state_hash,post_state_hash,input_snapshot_json,rule_evaluation_json,
  output_snapshot_json,trace_schema_id,trace_schema_version,correlation_id
)
SELECT game_id,game_event_sequence,ordinal,NULL,'M2A_FORWARD_LINK_BACKFILL',pre_hash,post_hash,
       '{}'::jsonb,'{"actorType":"SYSTEM","reason":"FORWARD_ONLY_TRACE_LINK"}'::jsonb,
       '{}'::jsonb,'malign.adjudication-trace','1.0',correlation_id
  FROM prepared;

UPDATE malign.action_point_transactions journal
   SET adjudication_trace_id=(SELECT trace.id FROM malign.adjudication_traces trace
     WHERE trace.game_id=journal.game_id AND trace.game_event_sequence=journal.game_event_sequence
     ORDER BY trace.artifact_ordinal LIMIT 1)
 WHERE journal.adjudication_trace_id IS NULL;
UPDATE malign.resource_transactions journal
   SET adjudication_trace_id=(SELECT trace.id FROM malign.adjudication_traces trace
     WHERE trace.game_id=journal.game_id AND trace.game_event_sequence=journal.game_event_sequence
     ORDER BY trace.artifact_ordinal LIMIT 1)
 WHERE journal.adjudication_trace_id IS NULL;
UPDATE malign.influence_mutations journal
   SET adjudication_trace_id=(SELECT trace.id FROM malign.adjudication_traces trace
     WHERE trace.game_id=journal.game_id AND trace.game_event_sequence=journal.game_event_sequence
     ORDER BY trace.artifact_ordinal LIMIT 1)
 WHERE journal.adjudication_trace_id IS NULL;
UPDATE malign.legitimacy_events journal
   SET adjudication_trace_id=(SELECT trace.id FROM malign.adjudication_traces trace
     WHERE trace.game_id=journal.game_id AND trace.game_event_sequence=journal.game_event_sequence
     ORDER BY trace.artifact_ordinal LIMIT 1)
 WHERE journal.adjudication_trace_id IS NULL;
UPDATE malign.vp_transactions journal
   SET adjudication_trace_id=(SELECT trace.id FROM malign.adjudication_traces trace
     WHERE trace.game_id=journal.game_id AND trace.game_event_sequence=journal.game_event_sequence
     ORDER BY trace.artifact_ordinal LIMIT 1)
 WHERE journal.adjudication_trace_id IS NULL;

ALTER TABLE malign.action_point_transactions
  ALTER COLUMN adjudication_trace_id SET NOT NULL;

ALTER TABLE malign.action_point_transactions
  ADD CONSTRAINT action_point_transactions_trace_fk FOREIGN KEY (adjudication_trace_id) REFERENCES malign.adjudication_traces(id);
ALTER TABLE malign.resource_transactions
  ADD CONSTRAINT resource_transactions_trace_fk FOREIGN KEY (adjudication_trace_id) REFERENCES malign.adjudication_traces(id);
ALTER TABLE malign.influence_mutations
  ADD CONSTRAINT influence_mutations_trace_fk FOREIGN KEY (adjudication_trace_id) REFERENCES malign.adjudication_traces(id);
ALTER TABLE malign.legitimacy_events
  ADD CONSTRAINT legitimacy_events_trace_fk FOREIGN KEY (adjudication_trace_id) REFERENCES malign.adjudication_traces(id);
ALTER TABLE malign.vp_transactions
  ADD CONSTRAINT vp_transactions_trace_fk FOREIGN KEY (adjudication_trace_id) REFERENCES malign.adjudication_traces(id);
ALTER TABLE malign.action_resolutions
  ADD CONSTRAINT action_resolutions_trace_fk FOREIGN KEY (adjudication_trace_id) REFERENCES malign.adjudication_traces(id);
ALTER TABLE malign.reaction_plays
  ADD CONSTRAINT reaction_plays_trace_fk FOREIGN KEY (adjudication_trace_id) REFERENCES malign.adjudication_traces(id);
ALTER TABLE malign.campaign_activations
  ADD CONSTRAINT campaign_activations_trace_fk FOREIGN KEY (adjudication_trace_id) REFERENCES malign.adjudication_traces(id);
ALTER TABLE malign.modifier_applications
  ADD CONSTRAINT modifier_applications_trace_fk FOREIGN KEY (adjudication_trace_id) REFERENCES malign.adjudication_traces(id);
ALTER TABLE malign.influence_resolutions
  ADD CONSTRAINT influence_resolutions_trace_fk FOREIGN KEY (adjudication_trace_id) REFERENCES malign.adjudication_traces(id);
ALTER TABLE malign.viralization_resolutions
  ADD CONSTRAINT viralization_resolutions_trace_fk FOREIGN KEY (adjudication_trace_id) REFERENCES malign.adjudication_traces(id);
ALTER TABLE malign.regime_ability_activations
  ADD CONSTRAINT regime_ability_activations_trace_fk FOREIGN KEY (adjudication_trace_id) REFERENCES malign.adjudication_traces(id);
ALTER TABLE malign.game_events
  ADD CONSTRAINT game_events_trace_fk FOREIGN KEY (adjudication_trace_id) REFERENCES malign.adjudication_traces(id);
ALTER TABLE malign.facilitator_requests
  ADD CONSTRAINT facilitator_requests_trace_fk FOREIGN KEY (full_context_trace_id) REFERENCES malign.adjudication_traces(id);

CREATE INDEX action_point_transactions_trace_idx ON malign.action_point_transactions(adjudication_trace_id);
CREATE INDEX resource_transactions_trace_idx ON malign.resource_transactions(adjudication_trace_id);
CREATE INDEX legitimacy_events_trace_idx ON malign.legitimacy_events(adjudication_trace_id);
CREATE INDEX vp_transactions_trace_idx ON malign.vp_transactions(adjudication_trace_id);

-- Replace broad inherited/default grants with a table-specific application contract.
ALTER DEFAULT PRIVILEGES FOR ROLE malign_migration_owner IN SCHEMA malign
  REVOKE ALL ON TABLES FROM malign_app_runtime,malign_outbox_publisher;
ALTER DEFAULT PRIVILEGES FOR ROLE malign_migration_owner IN SCHEMA malign
  REVOKE ALL ON FUNCTIONS FROM malign_app_runtime,malign_outbox_publisher;
REVOKE ALL ON ALL TABLES IN SCHEMA malign FROM malign_app_runtime,malign_outbox_publisher;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA malign FROM malign_app_runtime,malign_outbox_publisher;

GRANT USAGE ON SCHEMA malign TO malign_app_runtime,malign_outbox_publisher;

GRANT SELECT ON
  malign.ruleset_versions,malign.engine_contract_versions,malign.card_registry_versions,
  malign.ruleset_domain_values,malign.json_schema_versions,malign.country_definitions,
  malign.card_definitions,malign.country_card_serial_templates,malign.card_slot_values,
  malign.card_requirements,malign.card_effect_definitions,malign.card_aliases,
  malign.demographic_token_definitions,malign.ert_definitions,malign.ert_cells,
  malign.scenario_definitions,malign.scenario_country_configs,malign.scenario_pd_definitions,
  malign.scenario_pd_demographics,malign.scenario_initial_influences,
  malign.scenario_rule_configs,malign.victory_objective_definitions
TO malign_app_runtime;

GRANT SELECT ON
  malign.games,malign.game_sessions,malign.game_participants,malign.game_memberships,
  malign.player_seats,malign.game_countries,malign.turns,malign.phase_states,
  malign.player_phase_readiness,malign.initiative_rolls,malign.initiative_entries,
  malign.action_point_balances,malign.action_point_transactions,malign.resource_transactions,
  malign.card_instances,malign.deck_card_positions,malign.campaigns,
  malign.campaign_card_assignments,malign.population_demographic_states,
  malign.influence_stacks,malign.influence_mutations,malign.legitimacy_events,
  malign.planned_actions,malign.action_resolutions,malign.pending_resolutions,
  malign.choice_requests,malign.campaign_activations,malign.narrative_requests,
  malign.narrative_submissions,malign.die_rolls,malign.influence_resolutions,
  malign.adjudication_traces,malign.vp_transactions,malign.facilitator_decisions,
  malign.game_events,malign.game_snapshots,malign.idempotency_records,
  malign.outbox_messages,malign.outbox_delivery_states,malign.outbox_delivery_attempts
TO malign_app_runtime;

GRANT INSERT ON
  malign.games,malign.game_sessions,malign.game_participants,malign.game_memberships,
  malign.player_seats,malign.game_countries,malign.turns,malign.phase_states,
  malign.player_phase_readiness,malign.initiative_rolls,malign.initiative_entries,
  malign.action_point_balances,malign.action_point_transactions,malign.resource_transactions,
  malign.card_instances,malign.deck_card_positions,malign.campaigns,
  malign.campaign_card_assignments,malign.population_demographic_states,
  malign.influence_stacks,malign.influence_mutations,malign.legitimacy_events,
  malign.planned_actions,malign.action_resolutions,malign.pending_resolutions,
  malign.choice_requests,malign.campaign_activations,malign.narrative_requests,
  malign.narrative_submissions,malign.die_rolls,malign.influence_resolutions,
  malign.adjudication_traces,malign.vp_transactions,malign.facilitator_decisions,
  malign.game_events,malign.game_snapshots,malign.idempotency_records,
  malign.outbox_messages,malign.outbox_delivery_states
TO malign_app_runtime;

GRANT UPDATE ON
  malign.games,malign.game_sessions,malign.game_participants,malign.game_memberships,
  malign.player_seats,malign.game_countries,malign.turns,malign.phase_states,
  malign.player_phase_readiness,malign.initiative_entries,malign.action_point_balances,
  malign.card_instances,malign.campaigns,malign.campaign_card_assignments,
  malign.population_demographic_states,malign.influence_stacks,malign.planned_actions,
  malign.action_resolutions,malign.pending_resolutions,malign.choice_requests,
  malign.campaign_activations,malign.narrative_requests,malign.idempotency_records,
  malign.outbox_delivery_states
TO malign_app_runtime;
GRANT DELETE ON malign.deck_card_positions TO malign_app_runtime;

GRANT SELECT ON malign.outbox_messages,malign.outbox_delivery_states,
  malign.outbox_delivery_attempts TO malign_outbox_publisher;
GRANT INSERT ON malign.outbox_delivery_attempts TO malign_outbox_publisher;
GRANT UPDATE (delivery_status,last_attempt_ordinal,claim_token_digest,claimed_at,
  claim_expires_at,next_attempt_at,acknowledged_at,last_error_code)
  ON malign.outbox_delivery_states TO malign_outbox_publisher;

REVOKE ALL ON malign.schema_migrations,malign.registry_seed_runs
  FROM malign_app_runtime,malign_outbox_publisher;
