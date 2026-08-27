-- DEC-078 / IQ-M2-012. Cluster roles have no login and no versioned credentials.
DO $body$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'malign_migration_owner') THEN
    CREATE ROLE malign_migration_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'malign_app_runtime') THEN
    CREATE ROLE malign_app_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'malign_outbox_publisher') THEN
    CREATE ROLE malign_outbox_publisher NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END
$body$;

DO $body$
DECLARE
  object_name text;
BEGIN
  EXECUTE format('GRANT malign_migration_owner TO %I', current_user);
  ALTER SCHEMA malign OWNER TO malign_migration_owner;
  IF to_regnamespace('malign_meta') IS NOT NULL THEN
    ALTER SCHEMA malign_meta OWNER TO malign_migration_owner;
  END IF;
  FOR object_name IN SELECT tablename FROM pg_tables WHERE schemaname='malign'
  LOOP
    EXECUTE format('ALTER TABLE malign.%I OWNER TO malign_migration_owner', object_name);
  END LOOP;
  IF to_regclass('malign_meta.schema_migrations') IS NOT NULL THEN
    ALTER TABLE malign_meta.schema_migrations OWNER TO malign_migration_owner;
  END IF;
  FOR object_name IN SELECT p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='malign' AND p.pronargs=0
  LOOP
    EXECUTE format('ALTER FUNCTION malign.%I() OWNER TO malign_migration_owner', object_name);
  END LOOP;
END
$body$;

REVOKE ALL ON SCHEMA malign FROM PUBLIC;
REVOKE ALL ON SCHEMA malign_meta FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA malign FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA malign_meta FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA malign FROM PUBLIC;
DO $body$
BEGIN
  EXECUTE format('REVOKE CREATE, TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
END
$body$;

GRANT USAGE ON SCHEMA malign TO malign_app_runtime;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA malign TO malign_app_runtime;
REVOKE UPDATE ON
  malign.registry_seed_runs,
  malign.action_point_transactions,
  malign.resource_transactions,
  malign.influence_mutations,
  malign.legitimacy_events,
  malign.reaction_plays,
  malign.narrative_submissions,
  malign.veto_votes,
  malign.die_rolls,
  malign.modifier_applications,
  malign.influence_resolutions,
  malign.viralization_resolutions,
  malign.regime_ability_activations,
  malign.adjudication_traces,
  malign.vp_transactions,
  malign.victory_objective_awards,
  malign.game_events,
  malign.game_snapshots,
  malign.outbox_messages,
  malign.outbox_delivery_attempts,
  malign.facilitator_decisions
FROM malign_app_runtime;
REVOKE ALL ON malign.schema_migrations FROM malign_app_runtime;

GRANT USAGE ON SCHEMA malign TO malign_outbox_publisher;
GRANT SELECT ON malign.outbox_messages, malign.outbox_delivery_states TO malign_outbox_publisher;
GRANT INSERT ON malign.outbox_delivery_attempts TO malign_outbox_publisher;
GRANT UPDATE (delivery_status, last_attempt_ordinal, claim_token_digest, claimed_at, claim_expires_at, next_attempt_at, acknowledged_at, last_error_code)
  ON malign.outbox_delivery_states TO malign_outbox_publisher;

ALTER DEFAULT PRIVILEGES IN SCHEMA malign REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA malign REVOKE ALL ON FUNCTIONS FROM PUBLIC;

COMMENT ON ROLE malign_migration_owner IS 'M2-A migration ownership role; never used by application runtime';
COMMENT ON ROLE malign_app_runtime IS 'M2-A server-side gameplay persistence role; no DDL and no browser access';
COMMENT ON ROLE malign_outbox_publisher IS 'M2-A delivery role; cannot adjudicate or mutate gameplay';
