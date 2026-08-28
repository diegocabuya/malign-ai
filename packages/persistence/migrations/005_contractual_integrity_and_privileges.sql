-- DEC-078/DEC-079 forward-only correction for M2A-R14, R17 and R19.
ALTER TABLE malign.country_definitions ADD COLUMN source_reference text;

UPDATE malign.country_definitions
SET canonical_name = CASE logical_id
      WHEN 'ARDEN' THEN 'Arden'
      WHEN 'FLUMA' THEN 'Republic of Fluma'
      WHEN 'URSARIA' THEN 'Ursaria'
      WHEN 'PRESQUE' THEN 'Presque'
      WHEN 'DINESIA' THEN 'Dinesia'
    END,
    regime_type = CASE logical_id
      WHEN 'ARDEN' THEN 'Democracia Bipartidista'
      WHEN 'FLUMA' THEN 'Territorio Democrático'
      WHEN 'URSARIA' THEN 'Autoritaria'
      WHEN 'PRESQUE' THEN 'Democracia Multipartidista'
      WHEN 'DINESIA' THEN 'Democracia Experimental'
    END,
    mascot = CASE logical_id
      WHEN 'ARDEN' THEN 'Tree'
      WHEN 'FLUMA' THEN 'Tree and River'
      WHEN 'URSARIA' THEN 'Bear'
      WHEN 'PRESQUE' THEN 'Horse'
      WHEN 'DINESIA' THEN 'Shark'
    END,
    color_key = CASE logical_id
      WHEN 'ARDEN' THEN 'verde oscuro'
      WHEN 'FLUMA' THEN 'verde oliva'
      WHEN 'URSARIA' THEN 'rojo'
      WHEN 'PRESQUE' THEN 'naranja'
      WHEN 'DINESIA' THEN 'morado'
    END,
    starting_resource_default = CASE logical_id
      WHEN 'ARDEN' THEN 2 WHEN 'FLUMA' THEN 2 WHEN 'URSARIA' THEN 3
      WHEN 'PRESQUE' THEN 3 WHEN 'DINESIA' THEN 4
    END,
    turn_income_default = CASE logical_id
      WHEN 'ARDEN' THEN 2 WHEN 'FLUMA' THEN 1 WHEN 'URSARIA' THEN 2
      WHEN 'PRESQUE' THEN 2 WHEN 'DINESIA' THEN 3
    END,
    source_reference = 'Malign-Influence-Rulebook_ENGLISH.pdf, section 13 “Countries and Characteristics”, pages 19–20'
WHERE logical_id IN ('ARDEN','FLUMA','URSARIA','PRESQUE','DINESIA') AND version='0.1';

ALTER TABLE malign.country_definitions
  ALTER COLUMN source_reference SET NOT NULL,
  ADD CONSTRAINT country_definitions_source_reference_nonempty CHECK (btrim(source_reference) <> '');

ALTER TABLE malign.planned_actions ADD CONSTRAINT planned_actions_game_id_uk UNIQUE (game_id, id);
ALTER TABLE malign.action_resolutions ADD CONSTRAINT action_resolutions_game_id_uk UNIQUE (game_id, id);

ALTER TABLE malign.action_point_transactions
  ADD CONSTRAINT action_point_transactions_turn_cross_game_fk FOREIGN KEY (game_id, turn_id) REFERENCES malign.turns(game_id, id),
  ADD CONSTRAINT action_point_transactions_participant_cross_game_fk FOREIGN KEY (game_id, participant_id) REFERENCES malign.game_participants(game_id, id);
ALTER TABLE malign.resource_transactions
  ADD CONSTRAINT resource_transactions_turn_cross_game_fk FOREIGN KEY (game_id, turn_id) REFERENCES malign.turns(game_id, id),
  ADD CONSTRAINT resource_transactions_participant_cross_game_fk FOREIGN KEY (game_id, participant_id) REFERENCES malign.game_participants(game_id, id),
  ADD CONSTRAINT resource_transactions_counterparty_cross_game_fk FOREIGN KEY (game_id, counterparty_participant_id) REFERENCES malign.game_participants(game_id, id);
ALTER TABLE malign.influence_mutations
  ADD CONSTRAINT influence_mutations_pd_cross_game_fk FOREIGN KEY (game_id, pd_state_id) REFERENCES malign.population_demographic_states(game_id, id),
  ADD CONSTRAINT influence_mutations_country_fk FOREIGN KEY (attribution_country_definition_id) REFERENCES malign.country_definitions(id);
ALTER TABLE malign.legitimacy_events
  ADD CONSTRAINT legitimacy_events_pd_cross_game_fk FOREIGN KEY (game_id, pd_state_id) REFERENCES malign.population_demographic_states(game_id, id),
  ADD CONSTRAINT legitimacy_events_previous_participant_cross_game_fk FOREIGN KEY (game_id, previous_participant_id) REFERENCES malign.game_participants(game_id, id),
  ADD CONSTRAINT legitimacy_events_new_participant_cross_game_fk FOREIGN KEY (game_id, new_participant_id) REFERENCES malign.game_participants(game_id, id);
ALTER TABLE malign.planned_actions
  ADD CONSTRAINT planned_actions_turn_cross_game_fk FOREIGN KEY (game_id, turn_id) REFERENCES malign.turns(game_id, id),
  ADD CONSTRAINT planned_actions_participant_cross_game_fk FOREIGN KEY (game_id, participant_id) REFERENCES malign.game_participants(game_id, id);
ALTER TABLE malign.action_resolutions
  ADD CONSTRAINT action_resolutions_planned_action_cross_game_fk FOREIGN KEY (game_id, planned_action_id) REFERENCES malign.planned_actions(game_id, id);
ALTER TABLE malign.pending_resolutions
  ADD CONSTRAINT pending_resolutions_source_cross_game_fk FOREIGN KEY (game_id, source_resolution_id) REFERENCES malign.action_resolutions(game_id, id);
ALTER TABLE malign.vp_transactions
  ADD CONSTRAINT vp_transactions_participant_cross_game_fk FOREIGN KEY (game_id, participant_id) REFERENCES malign.game_participants(game_id, id);

ALTER TABLE malign.outbox_delivery_states
  ADD CONSTRAINT outbox_delivery_status_contract CHECK (
    delivery_status IN ('PENDING','CLAIMED','RETRY_SCHEDULED','ACKNOWLEDGED')
  ),
  ADD CONSTRAINT outbox_delivery_ack_contract CHECK (
    (delivery_status='ACKNOWLEDGED' AND acknowledged_at IS NOT NULL)
    OR (delivery_status<>'ACKNOWLEDGED' AND acknowledged_at IS NULL)
  );

CREATE FUNCTION malign.enforce_single_deck_zone()
RETURNS trigger
LANGUAGE plpgsql
AS $body$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM malign.card_instances c
    WHERE c.game_id=NEW.game_id AND c.id=NEW.card_instance_id
      AND c.zone='DRAW_PILE' AND c.removed_from_game=false
  ) THEN
    RAISE EXCEPTION 'M2A_SINGLE_ZONE_VIOLATION'
      USING ERRCODE='integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$body$;

CREATE TRIGGER deck_card_positions_single_zone
BEFORE INSERT OR UPDATE ON malign.deck_card_positions
FOR EACH ROW EXECUTE FUNCTION malign.enforce_single_deck_zone();

CREATE FUNCTION malign.protect_card_zone_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $body$
BEGIN
  IF NEW.zone<>'DRAW_PILE' AND EXISTS (
    SELECT 1 FROM malign.deck_card_positions p
    WHERE p.game_id=NEW.game_id AND p.card_instance_id=NEW.id
  ) THEN
    RAISE EXCEPTION 'M2A_SINGLE_ZONE_VIOLATION'
      USING ERRCODE='integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$body$;

CREATE TRIGGER card_instances_single_zone
BEFORE UPDATE OF zone,removed_from_game ON malign.card_instances
FOR EACH ROW EXECUTE FUNCTION malign.protect_card_zone_membership();

ALTER DEFAULT PRIVILEGES FOR ROLE malign_migration_owner IN SCHEMA malign
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE malign_migration_owner IN SCHEMA malign
  REVOKE ALL ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE malign_migration_owner IN SCHEMA malign
  GRANT SELECT,INSERT,UPDATE ON TABLES TO malign_app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE malign_migration_owner IN SCHEMA malign
  GRANT SELECT ON TABLES TO malign_outbox_publisher;

REVOKE ALL ON FUNCTION malign.enforce_single_deck_zone() FROM PUBLIC;
REVOKE ALL ON FUNCTION malign.protect_card_zone_membership() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION malign.enforce_single_deck_zone(), malign.protect_card_zone_membership()
  TO malign_app_runtime;

REVOKE UPDATE ON malign.facilitator_decisions FROM malign_app_runtime;
REVOKE ALL ON malign.schema_migrations FROM malign_app_runtime, malign_outbox_publisher;
GRANT SELECT ON malign.outbox_delivery_attempts TO malign_outbox_publisher;
