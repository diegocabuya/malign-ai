import { sha256CanonicalJson } from '@malign-ai/shared';
import type { Pool } from 'pg';

import { PersistenceError } from './errors.js';

export interface RecoveryBundle {
  readonly gameId: string;
  readonly gameVersion: number;
  readonly state: Readonly<Record<string, unknown>>;
  readonly snapshotVersion: number;
  readonly eventTail: readonly Readonly<Record<string, unknown>>[];
  readonly continuation: Readonly<Record<string, unknown>> | null;
  readonly pins: Readonly<Record<string, string>>;
}

export const reconcileDurableGame = async (pool: Pool, gameId: string): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const gameResult = await client.query<{
      game_version: string;
      event_sequence_head: string;
      outbox_sequence_head: string;
      authoritative_state_json: Readonly<Record<string, unknown>>;
      gameplay_state_hash: Buffer;
    }>('SELECT * FROM malign.games WHERE id=$1 FOR UPDATE', [gameId]);
    const game = gameResult.rows[0];
    if (!game) throw new PersistenceError('GAME_NOT_FOUND', 'Game does not exist');
    const aggregates = await client.query<{
      event_head: string;
      outbox_head: string;
      bad_ap: string;
      bad_resource: string;
      bad_vp: string;
      bad_influence: string;
      bad_snapshot: string;
      bad_event_order: string;
      bad_outbox_order: string;
      bad_trace: string;
      bad_outbox: string;
      bad_legitimacy: string;
      bad_pin: string;
    }>(
      `SELECT
        COALESCE((SELECT max(sequence_number) FROM malign.game_events WHERE game_id=$1),0)::text event_head,
        COALESCE((SELECT max(outbox_sequence) FROM malign.outbox_messages WHERE game_id=$1),0)::text outbox_head,
        (SELECT count(*) FROM malign.action_point_balances b WHERE b.game_id=$1 AND
          (b.allocated<>b.spent+b.remaining OR b.remaining<>10+COALESCE((SELECT sum(t.delta) FROM malign.action_point_transactions t WHERE t.game_id=b.game_id AND t.turn_id=b.turn_id AND t.participant_id=b.participant_id),0)))::text bad_ap,
        (SELECT count(*) FROM malign.game_countries c WHERE c.game_id=$1 AND c.current_resources_cache<>
          COALESCE((SELECT sum(t.delta) FROM malign.resource_transactions t WHERE t.game_id=c.game_id AND t.participant_id=c.controlling_participant_id),0))::text bad_resource,
        (SELECT count(*) FROM malign.game_countries c WHERE c.game_id=$1 AND c.current_vp_cache<>
          COALESCE((SELECT sum(t.delta) FROM malign.vp_transactions t WHERE t.game_id=c.game_id AND t.participant_id=c.controlling_participant_id),0))::text bad_vp,
        (SELECT count(*) FROM malign.influence_stacks s WHERE s.game_id=$1 AND s.count<>
          COALESCE((SELECT sum(m.delta) FROM malign.influence_mutations m WHERE m.game_id=s.game_id AND m.pd_state_id=s.pd_state_id AND m.influence_type=s.influence_type AND m.attribution_country_definition_id=s.attribution_country_definition_id),0))::text bad_influence,
        (SELECT count(*) FROM malign.game_snapshots s WHERE s.game_id=$1 AND
          (s.gameplay_state_hash<>s.canonical_jcs_sha256 OR s.game_version>$2))::text bad_snapshot,
        (SELECT CASE WHEN count(*)=0 THEN 0
                     WHEN min(sequence_number)=1 AND count(*)=max(sequence_number) THEN 0 ELSE 1 END
           FROM malign.game_events WHERE game_id=$1)::text bad_event_order,
        (SELECT CASE WHEN count(*)=0 THEN 0
                     WHEN min(outbox_sequence)=1 AND count(*)=max(outbox_sequence) THEN 0 ELSE 1 END
           FROM malign.outbox_messages WHERE game_id=$1)::text bad_outbox_order,
        (SELECT count(*) FROM malign.adjudication_traces t
           LEFT JOIN malign.game_events e ON e.game_id=t.game_id AND e.sequence_number=t.game_event_sequence
          WHERE t.game_id=$1 AND (e.id IS NULL OR octet_length(t.pre_state_hash)<>32 OR octet_length(t.post_state_hash)<>32))::text bad_trace,
        (SELECT count(*) FROM malign.outbox_messages m
           LEFT JOIN malign.outbox_delivery_states s ON s.outbox_message_id=m.id
          WHERE m.game_id=$1 AND s.id IS NULL)::text bad_outbox,
        (SELECT count(*) FROM malign.legitimacy_events l
           LEFT JOIN malign.population_demographic_states p ON p.id=l.pd_state_id AND p.game_id=l.game_id
          WHERE l.game_id=$1 AND p.id IS NULL)::text bad_legitimacy,
        (SELECT count(*) FROM malign.game_snapshots s JOIN malign.games pinned ON pinned.id=s.game_id
          WHERE s.game_id=$1 AND (s.ruleset_version_id<>pinned.ruleset_version_id
             OR s.scenario_definition_id<>pinned.scenario_definition_id
             OR s.card_registry_version_id<>pinned.card_registry_version_id
             OR s.engine_contract_version_id<>pinned.engine_contract_version_id))::text bad_pin`,
      [gameId, game.game_version],
    );
    const a = aggregates.rows[0];
    const stateDigest = sha256CanonicalJson(game.authoritative_state_json);
    const mismatch =
      !a ||
      Number(a.event_head) !== Number(game.event_sequence_head) ||
      Number(a.outbox_head) !== Number(game.outbox_sequence_head) ||
      Number(a.bad_ap) !== 0 ||
      Number(a.bad_resource) !== 0 ||
      Number(a.bad_vp) !== 0 ||
      Number(a.bad_influence) !== 0 ||
      Number(a.bad_snapshot) !== 0 ||
      Number(a.bad_event_order) !== 0 ||
      Number(a.bad_outbox_order) !== 0 ||
      Number(a.bad_trace) !== 0 ||
      Number(a.bad_outbox) !== 0 ||
      Number(a.bad_legitimacy) !== 0 ||
      Number(a.bad_pin) !== 0 ||
      stateDigest !== game.gameplay_state_hash.toString('hex');
    if (mismatch) {
      await client.query('UPDATE malign.games SET recovery_blocked=true WHERE id=$1', [gameId]);
      await client.query('COMMIT');
      throw new PersistenceError('RECONCILIATION_MISMATCH', 'Durable game reconciliation failed', { gameId });
    }
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The mismatch path deliberately commits the recovery gate before throwing.
    }
    throw error;
  } finally {
    client.release();
  }
};

export const recoverDurableGame = async (pool: Pool, gameId: string): Promise<RecoveryBundle> => {
  await reconcileDurableGame(pool, gameId);
  const gameResult = await pool.query<{
    game_version: string;
    authoritative_state_json: Readonly<Record<string, unknown>>;
    ruleset_version_id: string;
    scenario_definition_id: string;
    card_registry_version_id: string;
    engine_contract_version_id: string;
    ert_definition_id: string;
  }>('SELECT * FROM malign.games WHERE id=$1', [gameId]);
  const game = gameResult.rows[0];
  if (!game) throw new PersistenceError('GAME_NOT_FOUND', 'Game does not exist');
  const snapshot = await pool.query<{ game_version: string; last_event_sequence: string }>(
    `SELECT game_version,last_event_sequence FROM malign.game_snapshots
      WHERE game_id=$1 ORDER BY game_version DESC LIMIT 1`,
    [gameId],
  );
  const snapshotRow = snapshot.rows[0];
  const lastSequence = Number(snapshotRow?.last_event_sequence ?? 0);
  const tail = await pool.query<Readonly<Record<string, unknown>>>(
    `SELECT sequence_number,event_type,payload_json,state_hash_after
       FROM malign.game_events WHERE game_id=$1 AND sequence_number>$2
      ORDER BY sequence_number,id LIMIT 500`,
    [gameId, lastSequence],
  );
  const continuation = await pool.query<{ continuation_state_json: Readonly<Record<string, unknown>> }>(
    `SELECT continuation_state_json FROM malign.pending_resolutions
      WHERE game_id=$1 AND status='OPEN' ORDER BY id LIMIT 1`,
    [gameId],
  );
  return {
    gameId,
    gameVersion: Number(game.game_version),
    state: game.authoritative_state_json,
    snapshotVersion: Number(snapshotRow?.game_version ?? 0),
    eventTail: tail.rows,
    continuation: continuation.rows[0]?.continuation_state_json ?? null,
    pins: {
      ruleset: game.ruleset_version_id,
      scenario: game.scenario_definition_id,
      registry: game.card_registry_version_id,
      engine: game.engine_contract_version_id,
      ert: game.ert_definition_id,
    },
  };
};

export const recordFacilitatorOverride = async (
  pool: Pool,
  input: Readonly<{
    gameId: string;
    facilitatorParticipantId: string;
    targetCardInstanceId: string;
    reason: string;
    noncanonical: boolean;
  }>,
): Promise<string> => {
  if (input.reason.trim() === '') {
    throw new PersistenceError('FACILITATOR_REASON_REQUIRED', 'Facilitator override reason is required');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const game = await client.query<{ game_version: string; event_sequence_head: string }>(
      'SELECT game_version,event_sequence_head FROM malign.games WHERE id=$1 FOR UPDATE',
      [input.gameId],
    );
    if (!game.rows[0]) throw new PersistenceError('GAME_NOT_FOUND', 'Game does not exist');
    const facilitator = await client.query(
      `SELECT 1 FROM malign.game_participants WHERE game_id=$1 AND id=$2 AND role='FACILITATOR' AND status='ACTIVE'`,
      [input.gameId, input.facilitatorParticipantId],
    );
    if (facilitator.rowCount !== 1) throw new PersistenceError('CROSS_GAME_REFERENCE', 'Facilitator is outside game scope');
    const target = await client.query(
      'SELECT 1 FROM malign.card_instances WHERE game_id=$1 AND id=$2',
      [input.gameId, input.targetCardInstanceId],
    );
    if (target.rowCount !== 1) throw new PersistenceError('UNKNOWN_TARGET', 'Override target does not exist in this game');
    const decision = await client.query<{ id: string }>(
      `INSERT INTO malign.facilitator_decisions(
         game_id,participant_id,decision_type,target_entity_type,target_entity_id,rationale,
         before_snapshot_json,after_snapshot_json,snapshot_schema_id,snapshot_schema_version,
         created_by_participant_id,noncanonical
       ) VALUES ($1,$2,'OVERRIDE','CARD_INSTANCE',$3,$4,$5::jsonb,$6::jsonb,
                 'malign.facilitator-ref','0.1',$2,$7) RETURNING id`,
      [input.gameId, input.facilitatorParticipantId, input.targetCardInstanceId, input.reason, JSON.stringify({ ref: 'pre' }), JSON.stringify({ ref: 'post' }), input.noncanonical],
    );
    const sequence = Number(game.rows[0].event_sequence_head) + 1;
    await client.query(
      `INSERT INTO malign.game_events(
         game_id,sequence_number,event_type,actor_participant_id,subject_type,subject_id,payload_json,
         payload_schema_id,payload_schema_version,visibility_class,correlation_id
       ) VALUES ($1,$2,'FACILITATOR_OVERRIDE',$3,'CARD_INSTANCE',$4,$5::jsonb,
                 'malign.facilitator-event','0.1','GAME',uuidv7())`,
      [input.gameId, sequence, input.facilitatorParticipantId, input.targetCardInstanceId, JSON.stringify({ decisionId: decision.rows[0]?.id, noncanonical: input.noncanonical })],
    );
    await client.query(
      `UPDATE malign.games SET game_version=game_version+1,event_sequence_head=$2,noncanonical=noncanonical OR $3 WHERE id=$1`,
      [input.gameId, sequence, input.noncanonical],
    );
    await client.query('COMMIT');
    return decision.rows[0]?.id ?? '';
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
