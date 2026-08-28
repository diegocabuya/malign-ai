import { sha256CanonicalJson } from '@malign-ai/shared';
import type { Pool, PoolClient } from 'pg';

import { PersistenceError } from './errors.js';

export interface RecoveryBundle {
  readonly gameId: string;
  readonly gameVersion: number;
  readonly state: Readonly<Record<string, unknown>>;
  readonly stateHash: string;
  readonly snapshotVersion: number;
  readonly snapshotLastEventSequence: number;
  readonly eventTail: readonly Readonly<Record<string, unknown>>[];
  readonly continuation: Readonly<Record<string, unknown>> | null;
  readonly pins: Readonly<Record<string, string>>;
  readonly sessionUser: string;
  readonly currentUser: 'malign_app_runtime';
}

interface GameRow {
  readonly game_version: string;
  readonly event_sequence_head: string;
  readonly outbox_sequence_head: string;
  readonly authoritative_state_json: Readonly<Record<string, unknown>>;
  readonly gameplay_state_hash: Buffer;
  readonly ruleset_version_id: string;
  readonly scenario_definition_id: string;
  readonly card_registry_version_id: string;
  readonly engine_contract_version_id: string;
  readonly ert_definition_id: string;
}

interface SnapshotRow {
  readonly game_version: string;
  readonly last_event_sequence: string;
  readonly snapshot_json: Readonly<Record<string, unknown>>;
  readonly snapshot_schema_id: string;
  readonly snapshot_schema_version: string;
  readonly canonical_jcs_sha256: Buffer;
  readonly gameplay_state_hash: Buffer;
  readonly ruleset_version_id: string;
  readonly scenario_definition_id: string;
  readonly card_registry_version_id: string;
  readonly engine_contract_version_id: string;
}

interface EventRow extends Readonly<Record<string, unknown>> {
  readonly sequence_number: string;
  readonly payload_json: Readonly<Record<string, unknown>>;
  readonly payload_schema_id: string;
  readonly payload_schema_version: string;
  readonly state_hash_after: Buffer | null;
}

interface ReplayInternal extends RecoveryBundle {
  readonly game: GameRow;
}

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;

const identityUnderApplicationRole = async (client: PoolClient): Promise<{ sessionUser: string; currentUser: 'malign_app_runtime' }> => {
  const identity = await client.query<{ session_user: string; current_user: string }>('SELECT session_user,current_user');
  const row = identity.rows[0];
  if (!row || row.current_user !== 'malign_app_runtime') {
    throw new PersistenceError('MIGRATION_AUTHORITY_INVALID', 'Recovery did not execute under application runtime authority');
  }
  return { sessionUser: row.session_user, currentUser: 'malign_app_runtime' };
};

const replayWithClient = async (client: PoolClient, gameId: string): Promise<ReplayInternal> => {
  const identity = await identityUnderApplicationRole(client);
  const gameResult = await client.query<GameRow>('SELECT * FROM malign.games WHERE id=$1', [gameId]);
  const game = gameResult.rows[0];
  if (!game) throw new PersistenceError('GAME_NOT_FOUND', 'Game does not exist');
  const snapshotResult = await client.query<SnapshotRow>(
    `SELECT * FROM malign.game_snapshots WHERE game_id=$1 ORDER BY game_version DESC LIMIT 1`, [gameId]);
  const snapshot = snapshotResult.rows[0];
  if (!snapshot) throw new PersistenceError('REPLAY_SCHEMA_UNSUPPORTED', 'A stable snapshot is required');
  if (snapshot.snapshot_schema_id !== 'malign.game-state' || snapshot.snapshot_schema_version !== '0.2') {
    throw new PersistenceError('REPLAY_SCHEMA_UNSUPPORTED', 'Snapshot schema/version is unsupported');
  }
  const snapshotHash = sha256CanonicalJson(snapshot.snapshot_json);
  if (snapshotHash !== snapshot.canonical_jcs_sha256.toString('hex') ||
      snapshotHash !== snapshot.gameplay_state_hash.toString('hex')) {
    throw new PersistenceError('REPLAY_HASH_MISMATCH', 'Snapshot canonical hash is invalid');
  }
  if (snapshot.ruleset_version_id !== game.ruleset_version_id ||
      snapshot.scenario_definition_id !== game.scenario_definition_id ||
      snapshot.card_registry_version_id !== game.card_registry_version_id ||
      snapshot.engine_contract_version_id !== game.engine_contract_version_id) {
    throw new PersistenceError('REPLAY_SCHEMA_UNSUPPORTED', 'Snapshot version pins differ from the game');
  }

  const lastSnapshotSequence = Number(snapshot.last_event_sequence);
  const events = await client.query<EventRow>(
    `SELECT sequence_number,event_type,payload_json,payload_schema_id,payload_schema_version,state_hash_after
       FROM malign.game_events WHERE game_id=$1 AND sequence_number>$2
      ORDER BY sequence_number,id`, [gameId,lastSnapshotSequence]);
  let state = snapshot.snapshot_json;
  let expectedSequence = lastSnapshotSequence + 1;
  let expectedVersion = Number(snapshot.game_version);
  for (const event of events.rows) {
    if (Number(event.sequence_number) !== expectedSequence) {
      throw new PersistenceError('REPLAY_EVENT_SEQUENCE_INVALID', 'Replay event sequence is not contiguous', {
        expected:expectedSequence,actual:Number(event.sequence_number),
      });
    }
    if (event.payload_schema_id !== 'malign.game-transition' || event.payload_schema_version !== '0.2') {
      throw new PersistenceError('REPLAY_SCHEMA_UNSUPPORTED', 'Event reducer schema/version is unsupported');
    }
    const reducer = asRecord(event.payload_json['reducer']);
    const result = asRecord(event.payload_json['commandResult']);
    if (reducer?.['type'] !== 'REPLACE_SETUP_STATE' || reducer['version'] !== '0.1' || !result) {
      throw new PersistenceError('REPLAY_SCHEMA_UNSUPPORTED', 'Event reducer type/version is unsupported');
    }
    const stateAfter = asRecord(reducer['stateAfter']);
    if (!stateAfter || Number(result['gameVersionBefore']) !== expectedVersion ||
        Number(result['gameVersionAfter']) !== expectedVersion + 1 || result['status'] !== 'RESOLVED') {
      throw new PersistenceError('REPLAY_SCHEMA_UNSUPPORTED', 'Event reducer payload is invalid');
    }
    const digest = sha256CanonicalJson(stateAfter);
    if (event.state_hash_after === null || digest !== event.state_hash_after.toString('hex')) {
      throw new PersistenceError('REPLAY_HASH_MISMATCH', 'Event state hash is invalid', { sequence:expectedSequence });
    }
    state = stateAfter;
    expectedSequence += 1;
    expectedVersion += 1;
  }
  if (expectedSequence - 1 !== Number(game.event_sequence_head) || expectedVersion !== Number(game.game_version)) {
    throw new PersistenceError('REPLAY_EVENT_SEQUENCE_INVALID', 'Replay tail does not reach durable heads');
  }
  const finalHash = sha256CanonicalJson(state);
  if (finalHash !== game.gameplay_state_hash.toString('hex') ||
      finalHash !== sha256CanonicalJson(game.authoritative_state_json)) {
    throw new PersistenceError('REPLAY_HASH_MISMATCH', 'Replay disagrees with authoritative state cache');
  }

  const continuations = await client.query<{
    continuation_state_json: Readonly<Record<string, unknown>>;
    continuation_schema_id: string;
    continuation_schema_version: string;
    state_hash: Buffer;
    ruleset_version_id: string;
    engine_contract_version_id: string;
  }>(`SELECT continuation_state_json,continuation_schema_id,continuation_schema_version,state_hash,
            ruleset_version_id,engine_contract_version_id
       FROM malign.pending_resolutions WHERE game_id=$1 AND status='OPEN' ORDER BY id`,[gameId]);
  for (const continuation of continuations.rows) {
    if (continuation.continuation_schema_id !== 'malign.continuation' ||
        continuation.continuation_schema_version !== '0.2' ||
        continuation.ruleset_version_id !== game.ruleset_version_id ||
        continuation.engine_contract_version_id !== game.engine_contract_version_id ||
        sha256CanonicalJson(continuation.continuation_state_json) !== continuation.state_hash.toString('hex')) {
      throw new PersistenceError('CONTINUATION_INVALID', 'Continuation schema, pins or hash is invalid');
    }
  }
  return {
    gameId,gameVersion:Number(game.game_version),state,stateHash:finalHash,
    snapshotVersion:Number(snapshot.game_version),snapshotLastEventSequence:lastSnapshotSequence,
    eventTail:events.rows,continuation:continuations.rows[0]?.continuation_state_json??null,
    pins:{ruleset:game.ruleset_version_id,scenario:game.scenario_definition_id,
      registry:game.card_registry_version_id,engine:game.engine_contract_version_id,ert:game.ert_definition_id},
    ...identity,game,
  };
};

const nonZero = (row: Readonly<Record<string, unknown>> | undefined): string[] =>
  Object.entries(row??{}).filter(([,value])=>Number(value)!==0).map(([key])=>key);

export const reconcileDurableGame = async (pool: Pool, gameId: string): Promise<void> => {
  const client = await pool.connect();
  let mismatchCommitted = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await client.query('SET LOCAL ROLE malign_app_runtime');
    await client.query('SELECT id FROM malign.games WHERE id=$1 FOR UPDATE',[gameId]);
    const failures: string[] = [];
    let replay: ReplayInternal | undefined;
    try { replay = await replayWithClient(client,gameId); }
    catch (error) { failures.push(error instanceof PersistenceError ? error.code : 'REPLAY_UNKNOWN'); }
    if (!replay) {
      const exists = await client.query('SELECT 1 FROM malign.games WHERE id=$1',[gameId]);
      if (exists.rowCount!==1) throw new PersistenceError('GAME_NOT_FOUND','Game does not exist');
    }
    const integrity = await client.query<Record<string,string>>(
      `SELECT
       (SELECT count(*) FROM malign.action_point_balances b WHERE b.game_id=$1 AND (
          b.allocated<>COALESCE((SELECT sum(GREATEST(t.delta,0)) FROM malign.action_point_transactions t
             WHERE t.game_id=b.game_id AND t.turn_id=b.turn_id AND t.participant_id=b.participant_id),0)
          OR b.spent<>-COALESCE((SELECT sum(LEAST(t.delta,0)) FROM malign.action_point_transactions t
             WHERE t.game_id=b.game_id AND t.turn_id=b.turn_id AND t.participant_id=b.participant_id),0)
          OR b.remaining<>COALESCE((SELECT sum(t.delta) FROM malign.action_point_transactions t
             WHERE t.game_id=b.game_id AND t.turn_id=b.turn_id AND t.participant_id=b.participant_id),0)
          OR b.last_transaction_sequence<>COALESCE((SELECT max(t.sequence_number) FROM malign.action_point_transactions t
             WHERE t.game_id=b.game_id AND t.turn_id=b.turn_id AND t.participant_id=b.participant_id),0)))::text bad_ap,
       (SELECT count(*) FROM malign.game_countries c WHERE c.game_id=$1 AND c.current_resources_cache<>
          COALESCE((SELECT sum(t.delta) FROM malign.resource_transactions t WHERE t.game_id=c.game_id
             AND t.participant_id=c.controlling_participant_id),0))::text bad_resources,
       (SELECT count(*) FROM malign.game_countries c WHERE c.game_id=$1 AND c.current_vp_cache<>
          COALESCE((SELECT sum(t.delta) FROM malign.vp_transactions t WHERE t.game_id=c.game_id
             AND t.participant_id=c.controlling_participant_id),0))::text bad_vp,
       (SELECT count(*) FROM malign.influence_stacks s WHERE s.game_id=$1 AND s.count<>
          COALESCE((SELECT sum(m.delta) FROM malign.influence_mutations m WHERE m.game_id=s.game_id
             AND m.pd_state_id=s.pd_state_id AND m.influence_type=s.influence_type
             AND m.attribution_country_definition_id=s.attribution_country_definition_id),0))::text bad_influence,
       (SELECT count(*) FROM malign.game_countries c WHERE c.game_id=$1 AND c.legitimacy_count_cache<>
          (SELECT count(*) FROM malign.population_demographic_states p WHERE p.game_id=c.game_id
             AND p.current_legitimacy_participant_id=c.controlling_participant_id))::text bad_legitimacy,
       (SELECT CASE WHEN count(*)=0 THEN 0 WHEN min(sequence_number)=1 AND count(*)=max(sequence_number) THEN 0 ELSE 1 END
          FROM malign.game_events WHERE game_id=$1)::text bad_event_order,
       (SELECT CASE WHEN count(*)=0 THEN 0 WHEN min(outbox_sequence)=1 AND count(*)=max(outbox_sequence) THEN 0 ELSE 1 END
          FROM malign.outbox_messages WHERE game_id=$1)::text bad_outbox_order,
       (SELECT count(*) FROM malign.game_events e LEFT JOIN malign.adjudication_traces t
          ON t.game_id=e.game_id AND t.game_event_sequence=e.sequence_number
          WHERE e.game_id=$1 AND e.payload_schema_id='malign.game-transition'
          AND (t.id IS NULL OR t.post_state_hash<>e.state_hash_after))::text bad_trace,
       (SELECT count(*) FROM malign.idempotency_records i WHERE i.game_id=$1 AND (
          i.status<>'COMMITTED' OR i.result_schema_id<>'malign.command-result' OR i.result_schema_version<>'0.2'
          OR (i.result_json->>'gameId')::uuid<>i.game_id OR (i.result_json->>'gameVersion')::bigint<>i.game_version_after))::text bad_idempotency,
       (SELECT count(*) FROM malign.outbox_messages m LEFT JOIN malign.outbox_delivery_states s
          ON s.outbox_message_id=m.id LEFT JOIN malign.game_events e ON e.game_id=m.game_id AND e.id=m.event_id
          WHERE m.game_id=$1 AND (s.id IS NULL OR e.id IS NULL OR m.payload_schema_id<>'malign.authorized-projection'
            OR m.payload_schema_version<>'0.2'))::text bad_outbox,
       (SELECT count(*) FROM malign.outbox_delivery_states s JOIN malign.outbox_messages m ON m.id=s.outbox_message_id
          WHERE m.game_id=$1 AND s.last_attempt_ordinal<>
            COALESCE((SELECT max(a.attempt_ordinal) FROM malign.outbox_delivery_attempts a
              WHERE a.outbox_message_id=s.outbox_message_id),0))::text bad_attempt_head,
       (SELECT count(*) FROM malign.pending_resolutions p JOIN malign.games g ON g.id=p.game_id
          WHERE p.game_id=$1 AND (p.ruleset_version_id<>g.ruleset_version_id
            OR p.engine_contract_version_id<>g.engine_contract_version_id))::text bad_continuation_pins`,[gameId]);
    failures.push(...nonZero(integrity.rows[0]));
    if (replay) {
      const heads = await client.query<{event_head:string;outbox_head:string}>(
        `SELECT event_sequence_head::text event_head,outbox_sequence_head::text outbox_head FROM malign.games WHERE id=$1`,[gameId]);
      const maxima = await client.query<{event_head:string;outbox_head:string}>(
        `SELECT COALESCE((SELECT max(sequence_number) FROM malign.game_events WHERE game_id=$1),0)::text event_head,
                COALESCE((SELECT max(outbox_sequence) FROM malign.outbox_messages WHERE game_id=$1),0)::text outbox_head`,[gameId]);
      if (heads.rows[0]?.event_head!==maxima.rows[0]?.event_head) failures.push('event_head');
      if (heads.rows[0]?.outbox_head!==maxima.rows[0]?.outbox_head) failures.push('outbox_head');
      const traceRows = await client.query<{game_event_sequence:string;pre_state_hash:Buffer;post_state_hash:Buffer}>(
        `SELECT game_event_sequence,pre_state_hash,post_state_hash FROM malign.adjudication_traces
          WHERE game_id=$1 ORDER BY game_event_sequence,artifact_ordinal`,[gameId]);
      let previousHash: string | undefined;
      const snapshot = await client.query<{gameplay_state_hash:Buffer;last_event_sequence:string}>(
        `SELECT gameplay_state_hash,last_event_sequence FROM malign.game_snapshots WHERE game_id=$1 ORDER BY game_version DESC LIMIT 1`,[gameId]);
      previousHash=snapshot.rows[0]?.gameplay_state_hash.toString('hex');
      for (const trace of traceRows.rows.filter(row=>Number(row.game_event_sequence)>Number(snapshot.rows[0]?.last_event_sequence??0))) {
        if (trace.pre_state_hash.toString('hex')!==previousHash) failures.push('trace_pre_chain');
        previousHash=trace.post_state_hash.toString('hex');
      }
    }
    if (failures.length>0) {
      const participant = await client.query<{id:string}>(
        `SELECT id FROM malign.game_participants WHERE game_id=$1 ORDER BY joined_at,id LIMIT 1`,[gameId]);
      const participantId=participant.rows[0]?.id;
      if (participantId) {
        await client.query(
          `INSERT INTO malign.facilitator_decisions(game_id,participant_id,decision_type,target_entity_type,
             target_entity_id,rationale,before_snapshot_json,snapshot_schema_id,snapshot_schema_version,
             created_by_participant_id,noncanonical)
           VALUES ($1,$2,'RECONCILIATION_DIAGNOSTIC','GAME',$1,'Fail-closed durable reconciliation mismatch',
                   $3::jsonb,'malign.reconciliation-diagnostic','0.1',$2,false)`,
          [gameId,participantId,JSON.stringify({families:[...new Set(failures)].sort()})]);
      }
      await client.query('UPDATE malign.games SET recovery_blocked=true WHERE id=$1',[gameId]);
      await client.query('COMMIT');
      mismatchCommitted=true;
      throw new PersistenceError('RECONCILIATION_MISMATCH','Durable game reconciliation failed',{gameId});
    }
    await client.query('COMMIT');
  } catch (error) {
    if (!mismatchCommitted) { try { await client.query('ROLLBACK'); } catch { /* already failed */ } }
    throw error;
  } finally { client.release(); }
};

export const recoverDurableGame = async (pool: Pool, gameId: string): Promise<RecoveryBundle> => {
  await reconcileDurableGame(pool,gameId);
  const client=await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query('SET LOCAL ROLE malign_app_runtime');
    const replay=await replayWithClient(client,gameId);
    await client.query('COMMIT');
    const bundle={...replay};
    Reflect.deleteProperty(bundle,'game');
    return bundle;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
};

export const recordFacilitatorOverride = async (
  pool: Pool,
  input: Readonly<{gameId:string;facilitatorParticipantId:string;targetCardInstanceId:string;reason:string;noncanonical:boolean}>,
): Promise<string> => {
  if (input.reason.trim()==='') throw new PersistenceError('FACILITATOR_REASON_REQUIRED','Facilitator override reason is required');
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE malign_app_runtime');
    const game=await client.query<{
      event_sequence_head:string;outbox_sequence_head:string;game_version:string;
      authoritative_state_json:Readonly<Record<string,unknown>>;gameplay_state_hash:Buffer;
    }>(`SELECT event_sequence_head,outbox_sequence_head,game_version,
              authoritative_state_json,gameplay_state_hash
          FROM malign.games WHERE id=$1 FOR UPDATE`,[input.gameId]);
    const currentGame=game.rows[0];
    if (!currentGame) throw new PersistenceError('GAME_NOT_FOUND','Game does not exist');
    const facilitator=await client.query(`SELECT 1 FROM malign.game_participants WHERE game_id=$1 AND id=$2
      AND role='FACILITATOR' AND status='ACTIVE'`,[input.gameId,input.facilitatorParticipantId]);
    if (facilitator.rowCount!==1) throw new PersistenceError('CROSS_GAME_REFERENCE','Facilitator is outside game scope');
    const target=await client.query('SELECT 1 FROM malign.card_instances WHERE game_id=$1 AND id=$2',[input.gameId,input.targetCardInstanceId]);
    if (target.rowCount!==1) throw new PersistenceError('UNKNOWN_TARGET','Override target does not exist in this game');
    const decision=await client.query<{id:string}>(
      `INSERT INTO malign.facilitator_decisions(game_id,participant_id,decision_type,target_entity_type,
         target_entity_id,rationale,before_snapshot_json,after_snapshot_json,snapshot_schema_id,
         snapshot_schema_version,created_by_participant_id,noncanonical)
       VALUES ($1,$2,'OVERRIDE','CARD_INSTANCE',$3,$4,$5::jsonb,$6::jsonb,
               'malign.facilitator-ref','0.1',$2,$7) RETURNING id`,
      [input.gameId,input.facilitatorParticipantId,input.targetCardInstanceId,input.reason,
        JSON.stringify({ref:'pre'}),JSON.stringify({ref:'post'}),input.noncanonical]);
    const decisionId=decision.rows[0]?.id;
    if (!decisionId) throw new PersistenceError('TRANSACTION_WRITE_FAILED','Facilitator decision identity is missing');
    const sequence=Number(currentGame.event_sequence_head)+1;
    const outboxSequence=Number(currentGame.outbox_sequence_head)+1;
    const versionBefore=Number(currentGame.game_version);
    const versionAfter=versionBefore+1;
    const afterState={...structuredClone(currentGame.authoritative_state_json),version:versionAfter};
    const stateHash=sha256CanonicalJson(afterState);
    const commandResult={commandId:decisionId,gameId:input.gameId,status:'RESOLVED',
      gameVersionBefore:versionBefore,gameVersionAfter:versionAfter,resultCode:'FACILITATOR_OVERRIDE_RECORDED',
      emittedEventRefs:[`${input.gameId}:event:${sequence}`],adjudicationTraceRefs:[],
      resolvedAt:new Date().toISOString()};
    const event=await client.query<{id:string}>(
      `INSERT INTO malign.game_events(game_id,sequence_number,event_type,actor_participant_id,subject_type,
         subject_id,payload_json,payload_schema_id,payload_schema_version,visibility_class,correlation_id,
         causation_id,state_hash_after)
       VALUES ($1,$2,'FACILITATOR_OVERRIDE',$3,'CARD_INSTANCE',$4,$5::jsonb,
               'malign.game-transition','0.2','GAME',$6,$6,decode($7,'hex')) RETURNING id`,
      [input.gameId,sequence,input.facilitatorParticipantId,input.targetCardInstanceId,
        JSON.stringify({reducer:{type:'REPLACE_SETUP_STATE',version:'0.1',stateAfter:afterState},commandResult}),
        decisionId,stateHash]);
    const eventId=event.rows[0]?.id;
    if (!eventId) throw new PersistenceError('TRANSACTION_WRITE_FAILED','Facilitator event identity is missing');
    await client.query(
      `INSERT INTO malign.adjudication_traces(game_id,game_event_sequence,artifact_ordinal,participant_id,
         trace_type,source_action_id,pre_state_hash,post_state_hash,input_snapshot_json,rule_evaluation_json,
         output_snapshot_json,trace_schema_id,trace_schema_version,correlation_id,causation_id)
       VALUES ($1,$2,1,$3,'FACILITATOR_OVERRIDE',$4,$5,decode($6,'hex'),$7::jsonb,$8::jsonb,$9::jsonb,
               'malign.adjudication-trace','0.2',$4,$4)`,
      [input.gameId,sequence,input.facilitatorParticipantId,decisionId,currentGame.gameplay_state_hash,stateHash,
        JSON.stringify(currentGame.authoritative_state_json),JSON.stringify({decisionId,noncanonical:input.noncanonical}),
        JSON.stringify(afterState)]);
    const outbox=await client.query<{id:string}>(
      `INSERT INTO malign.outbox_messages(game_id,outbox_sequence,event_id,topic,audience_class,payload_json,
         payload_schema_id,payload_schema_version,correlation_id,deduplication_key)
       VALUES ($1,$2,$3,'GAME_EVENT','GAME',$4::jsonb,'malign.authorized-projection','0.2',$5,$6) RETURNING id`,
      [input.gameId,outboxSequence,eventId,JSON.stringify({eventId,eventSequence:sequence,gameVersion:versionAfter}),
        decisionId,`${input.gameId}:${sequence}:GAME`]);
    await client.query(`INSERT INTO malign.outbox_delivery_states(outbox_message_id,delivery_status,next_attempt_at)
      VALUES ($1,'PENDING',clock_timestamp())`,[outbox.rows[0]?.id]);
    await client.query(`UPDATE malign.games SET authoritative_state_json=$2::jsonb,
      gameplay_state_hash=decode($3,'hex'),game_version=$4,event_sequence_head=$5,outbox_sequence_head=$6,
      noncanonical=noncanonical OR $7 WHERE id=$1`,
      [input.gameId,JSON.stringify(afterState),stateHash,versionAfter,sequence,outboxSequence,input.noncanonical]);
    await client.query('COMMIT');
    return decisionId;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
};
