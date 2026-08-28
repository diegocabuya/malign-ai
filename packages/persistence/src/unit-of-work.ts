import { sha256CanonicalJson } from '@malign-ai/shared';
import type { Pool, PoolClient } from 'pg';

import { PersistenceError, safeDatabaseError } from './errors.js';
import { recoverDurableGame, type RecoveryBundle } from './recovery.js';

export const M2A_WRITE_BOUNDARIES = [
  'normalized_state', 'ap_balance', 'ap_journal', 'resources', 'vp', 'influence',
  'legitimacy', 'rng_record', 'event', 'trace', 'continuation', 'snapshot',
  'idempotency', 'outbox_message', 'delivery_state',
] as const;

export type M2AWriteBoundary = (typeof M2A_WRITE_BOUNDARIES)[number];

export interface TransactionalValueProvider<T> {
  checkpoint(): number;
  next(): T;
  restore(checkpoint: number): void;
}

export class TransactionalSequence<T> implements TransactionalValueProvider<T> {
  #cursor = 0;
  constructor(private readonly values: readonly T[]) {
    if (values.length === 0) throw new Error('TransactionalSequence requires at least one value');
  }
  get cursor(): number { return this.#cursor; }
  checkpoint(): number { return this.#cursor; }
  next(): T {
    const value = this.values[this.#cursor];
    if (value === undefined) throw new Error('TransactionalSequence exhausted');
    this.#cursor += 1;
    return value;
  }
  restore(checkpoint: number): void { this.#cursor = checkpoint; }
}

export interface AcceptedEngineResult {
  readonly commandId: string;
  readonly gameId: string;
  readonly status: 'RESOLVED';
  readonly gameVersionBefore: number;
  readonly gameVersionAfter: number;
  readonly resultCode: string;
  readonly emittedEventRefs: readonly string[];
  readonly adjudicationTraceRefs: readonly string[];
  readonly resolvedAt: string;
}

export interface ActionPointEffect {
  readonly turnId: string;
  readonly participantId: string;
  readonly delta: number;
  readonly reasonType: 'TURN_ALLOCATION' | 'PLAN_COMMIT' | 'COMMAND';
}

export interface ResourceEffect {
  readonly turnId?: string;
  readonly participantId: string;
  readonly delta: number;
  readonly reasonType: 'SCENARIO_SETUP' | 'TURN_INCOME' | 'SPEND' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'COMMAND';
  readonly counterpartyParticipantId?: string;
}

export interface VictoryPointEffect {
  readonly turnId?: string;
  readonly participantId: string;
  readonly delta: number;
  readonly reasonType: 'CAMPAIGN' | 'LEGITIMACY' | 'CORRUPTION' | 'OBJECTIVE' | 'COMMAND';
}

export interface InfluenceEffect {
  readonly turnId?: string;
  readonly pdStateId: string;
  readonly influenceType: 'MALIGN' | 'RESILIENCY';
  readonly attributionCountryDefinitionId: string;
  readonly delta: number;
  readonly reasonType: string;
}

export interface LegitimacyEffect {
  readonly turnId?: string;
  readonly pdStateId: string;
  readonly previousParticipantId: string | null;
  readonly newParticipantId: string | null;
  readonly reasonType: string;
}

export interface DieRollEffect {
  readonly turnId: string;
  readonly participantId: string;
  readonly rawValue?: number;
  readonly sourceType: string;
}

export interface DurableEffectBatch {
  readonly actionPoints?: readonly ActionPointEffect[];
  readonly resources?: readonly ResourceEffect[];
  readonly victoryPoints?: readonly VictoryPointEffect[];
  readonly influence?: readonly InfluenceEffect[];
  readonly legitimacy?: readonly LegitimacyEffect[];
  readonly dieRolls?: readonly DieRollEffect[];
}

/** Internal application-to-persistence contract; a raw caller state is never accepted. */
export interface AcceptedEngineTransition {
  readonly gameId: string;
  readonly actorId: string;
  readonly actorParticipantId: string;
  readonly commandType: string;
  readonly idempotencyKey: string;
  readonly fingerprintSha256: string;
  readonly beforeState: Readonly<Record<string, unknown>>;
  readonly afterState: Readonly<Record<string, unknown>>;
  readonly engineResult: AcceptedEngineResult;
  readonly effects?: DurableEffectBatch;
  readonly continuation?: Readonly<{
    sourceResolutionId: string;
    waitingInteractionId: string;
    type: string;
    state: Readonly<Record<string, unknown>>;
  }>;
  readonly captureSnapshot?: boolean;
  readonly faultAt?: M2AWriteBoundary;
}

export interface DurableCommandResult {
  readonly commandId: string;
  readonly gameId: string;
  readonly gameVersion: number;
  readonly eventSequence: number;
  readonly outboxSequence: number;
  readonly eventId: string;
  readonly traceId: string;
  readonly replayed: boolean;
  readonly sessionUser: string;
  readonly currentUser: 'malign_app_runtime';
  readonly engineResult: AcceptedEngineResult;
}

interface LockedGame {
  readonly game_version: string;
  readonly event_sequence_head: string;
  readonly outbox_sequence_head: string;
  readonly recovery_blocked: boolean;
  readonly ruleset_version_id: string;
  readonly scenario_definition_id: string;
  readonly card_registry_version_id: string;
  readonly engine_contract_version_id: string;
  readonly ert_definition_id: string;
  readonly gameplay_state_hash: Buffer;
}

interface DurableUnitOfWorkOptions {
  readonly rng?: TransactionalValueProvider<number>;
  readonly clock?: TransactionalValueProvider<Date>;
  readonly postCommitObserver?: (result: DurableCommandResult) => void | Promise<void>;
}

const assertTransition = (transition: AcceptedEngineTransition): void => {
  if (!/^[a-f0-9]{64}$/.test(transition.fingerprintSha256)) {
    throw new PersistenceError('ENGINE_TRANSITION_REQUIRED', 'Transition fingerprint must be lowercase SHA-256');
  }
  const result = transition.engineResult;
  if (result.status !== 'RESOLVED' || result.gameId !== transition.gameId ||
      result.gameVersionAfter !== result.gameVersionBefore + 1 || result.commandId.length === 0) {
    throw new PersistenceError('ENGINE_TRANSITION_REQUIRED', 'Only a coherent RESOLVED Engine transition can be persisted');
  }
};

const failAt = (transition: AcceptedEngineTransition, boundary: M2AWriteBoundary): void => {
  if (transition.faultAt === boundary) {
    throw new PersistenceError('TRANSACTION_WRITE_FAILED', `Injected write failure at ${boundary}`, { boundary });
  }
};

const readCommittedResult = async (client: PoolClient, transition: AcceptedEngineTransition): Promise<DurableCommandResult | undefined> => {
  const existing = await client.query<{ command_fingerprint: Buffer; result_json: DurableCommandResult | null; status: string }>(
    `SELECT command_fingerprint,result_json,status FROM malign.idempotency_records
      WHERE game_id=$1 AND actor_id=$2 AND idempotency_key=$3`,
    [transition.gameId, transition.actorId, transition.idempotencyKey],
  );
  const row = existing.rows[0];
  if (!row) return undefined;
  if (row.command_fingerprint.toString('hex') !== transition.fingerprintSha256) {
    throw new PersistenceError('IDEMPOTENCY_CONFLICT', 'Idempotency key was used with a different fingerprint');
  }
  return row.status === 'COMMITTED' && row.result_json !== null ? row.result_json : undefined;
};

const requireNonZeroInteger = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value === 0) {
    throw new PersistenceError('ENGINE_TRANSITION_REQUIRED', `${label} must be a non-zero safe integer`);
  }
};

export class PostgresDurableUnitOfWork {
  constructor(private readonly pool: Pool, private readonly options: DurableUnitOfWorkOptions = {}) {}

  recover(gameId:string):Promise<RecoveryBundle> { return recoverDurableGame(this.pool,gameId); }

  async resolvePhysicalParticipantId(gameId: string, externalUserRef: string): Promise<string | undefined> {
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      await client.query('SET LOCAL ROLE malign_app_runtime');
      const result=await client.query<{id:string}>(
        `SELECT id FROM malign.game_participants WHERE game_id=$1 AND external_user_ref=$2 AND status='ACTIVE'`,
        [gameId,externalUserRef]);
      await client.query('COMMIT');
      return result.rows[0]?.id;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async loadCommittedEngineResult(input: Readonly<{
    gameId:string;actorId:string;idempotencyKey:string;fingerprintSha256:string;
  }>): Promise<AcceptedEngineResult | undefined> {
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      await client.query('SET LOCAL ROLE malign_app_runtime');
      const result=await client.query<{command_fingerprint:Buffer;result_json:DurableCommandResult;status:string}>(
        `SELECT command_fingerprint,result_json,status FROM malign.idempotency_records
          WHERE game_id=$1 AND actor_id=$2 AND idempotency_key=$3`,
        [input.gameId,input.actorId,input.idempotencyKey]);
      const row=result.rows[0];
      if (row && row.command_fingerprint.toString('hex')!==input.fingerprintSha256) {
        throw new PersistenceError('IDEMPOTENCY_CONFLICT','Idempotency key was used with a different fingerprint');
      }
      await client.query('COMMIT');
      return row?.status==='COMMITTED' ? row.result_json.engineResult : undefined;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async persistAcceptedTransition(transition: AcceptedEngineTransition): Promise<DurableCommandResult> {
    assertTransition(transition);
    const rngCheckpoint = this.options.rng?.checkpoint();
    const clockCheckpoint = this.options.clock?.checkpoint();
    const client = await this.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query('SET LOCAL ROLE malign_app_runtime');
      const identity = await client.query<{ session_user: string; current_user: string }>('SELECT session_user,current_user');
      const identityRow = identity.rows[0];
      if (!identityRow || identityRow.current_user !== 'malign_app_runtime') {
        throw new PersistenceError('MIGRATION_AUTHORITY_INVALID', 'UoW did not execute under application runtime authority');
      }
      const locked = await client.query<LockedGame>(
        `SELECT game_version,event_sequence_head,outbox_sequence_head,recovery_blocked,
                ruleset_version_id,scenario_definition_id,card_registry_version_id,
                engine_contract_version_id,ert_definition_id,gameplay_state_hash
           FROM malign.games WHERE id=$1 FOR UPDATE`, [transition.gameId],
      );
      const game = locked.rows[0];
      if (!game) throw new PersistenceError('GAME_NOT_FOUND', 'Game does not exist');
      if (game.recovery_blocked) throw new PersistenceError('GAME_RECOVERY_BLOCKED', 'Game is blocked by durable reconciliation');
      const replay = await readCommittedResult(client, transition);
      if (replay) { await client.query('COMMIT'); committed = true; return replay; }
      const versionBefore = Number(game.game_version);
      if (versionBefore !== transition.engineResult.gameVersionBefore ||
          versionBefore !== Number(transition.beforeState['version'] ?? versionBefore)) {
        throw new PersistenceError('GAME_VERSION_CONFLICT', 'Expected game version did not match', {
          expected: transition.engineResult.gameVersionBefore, actual: versionBefore,
        });
      }
      if (sha256CanonicalJson(transition.beforeState) !== game.gameplay_state_hash.toString('hex')) {
        throw new PersistenceError('GAME_VERSION_CONFLICT', 'Engine before-state does not match durable authority');
      }
      const actor = await client.query(
        `SELECT 1 FROM malign.game_participants WHERE game_id=$1 AND id=$2
          AND status='ACTIVE' AND role IN ('PLAYER','FACILITATOR')`,
        [transition.gameId, transition.actorParticipantId],
      );
      if (actor.rowCount !== 1) throw new PersistenceError('CROSS_GAME_REFERENCE', 'Actor is outside game scope');

      await client.query(
        `INSERT INTO malign.idempotency_records(
           game_id,actor_id,idempotency_key,command_id,command_fingerprint,command_type,status,game_version_before
         ) VALUES ($1,$2,$3,$4,decode($5,'hex'),$6,'INTERNAL_PENDING',$7)`,
        [transition.gameId, transition.actorId, transition.idempotencyKey, transition.engineResult.commandId,
          transition.fingerprintSha256, transition.commandType, versionBefore],
      );
      const now = this.options.clock?.next() ?? new Date(transition.engineResult.resolvedAt);
      const stateHash = sha256CanonicalJson(transition.afterState);
      const eventSequence = Number(game.event_sequence_head) + 1;
      const outboxSequence = Number(game.outbox_sequence_head) + 1;
      const versionAfter = transition.engineResult.gameVersionAfter;

      await client.query(`UPDATE malign.games SET authoritative_state_json=$2::jsonb,
        gameplay_state_hash=decode($3,'hex') WHERE id=$1`,
      [transition.gameId, JSON.stringify(transition.afterState), stateHash]);
      failAt(transition, 'normalized_state');

      for (const [index, effect] of (transition.effects?.actionPoints ?? []).entries()) {
        requireNonZeroInteger(effect.delta, 'AP delta');
        const updated = effect.delta > 0
          ? await client.query<{ remaining: number; last_transaction_sequence: string }>(
              `UPDATE malign.action_point_balances SET allocated=allocated+$4,remaining=remaining+$4,
                 last_transaction_sequence=last_transaction_sequence+1
               WHERE game_id=$1 AND turn_id=$2 AND participant_id=$3 RETURNING remaining,last_transaction_sequence`,
              [transition.gameId, effect.turnId, effect.participantId, effect.delta])
          : await client.query<{ remaining: number; last_transaction_sequence: string }>(
              `UPDATE malign.action_point_balances SET spent=spent-$4,remaining=remaining+$4,
                 last_transaction_sequence=last_transaction_sequence+1
               WHERE game_id=$1 AND turn_id=$2 AND participant_id=$3 AND remaining+$4>=0
               RETURNING remaining,last_transaction_sequence`,
              [transition.gameId, effect.turnId, effect.participantId, effect.delta]);
        const balance = updated.rows[0];
        if (!balance) throw new PersistenceError('NEGATIVE_BALANCE', 'AP effect cannot be applied');
        failAt(transition, 'ap_balance');
        await client.query(
          `INSERT INTO malign.action_point_transactions(
             game_id,game_event_sequence,artifact_ordinal,turn_id,participant_id,sequence_number,
             delta,reason_type,source_entity_type,source_entity_id,correlation_id,balance_after
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'COMMAND',$9,$9,$10)`,
          [transition.gameId,eventSequence,index+1,effect.turnId,effect.participantId,
            balance.last_transaction_sequence,effect.delta,effect.reasonType,
            transition.engineResult.commandId,balance.remaining]);
        failAt(transition, 'ap_journal');
      }

      for (const [index, effect] of (transition.effects?.resources ?? []).entries()) {
        requireNonZeroInteger(effect.delta, 'Resource delta');
        const updated = await client.query<{ current_resources_cache: number }>(
          `UPDATE malign.game_countries SET current_resources_cache=current_resources_cache+$3
            WHERE game_id=$1 AND controlling_participant_id=$2 AND current_resources_cache+$3>=0
            RETURNING current_resources_cache`, [transition.gameId,effect.participantId,effect.delta]);
        const balance = updated.rows[0]?.current_resources_cache;
        if (balance === undefined) throw new PersistenceError('NEGATIVE_BALANCE', 'Resource effect cannot be applied');
        await client.query(
          `INSERT INTO malign.resource_transactions(
             game_id,game_event_sequence,artifact_ordinal,turn_id,participant_id,delta,reason_type,
             source_entity_type,source_entity_id,counterparty_participant_id,balance_after
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,'COMMAND',$8,$9,$10)`,
          [transition.gameId,eventSequence,index+1,effect.turnId??null,effect.participantId,effect.delta,
            effect.reasonType,transition.engineResult.commandId,effect.counterpartyParticipantId??null,balance]);
        failAt(transition, 'resources');
      }

      for (const [index, effect] of (transition.effects?.victoryPoints ?? []).entries()) {
        requireNonZeroInteger(effect.delta, 'VP delta');
        const updated = await client.query<{ current_vp_cache: number }>(
          `UPDATE malign.game_countries SET current_vp_cache=current_vp_cache+$3
            WHERE game_id=$1 AND controlling_participant_id=$2 AND current_vp_cache+$3>=0
            RETURNING current_vp_cache`, [transition.gameId,effect.participantId,effect.delta]);
        const balance = updated.rows[0]?.current_vp_cache;
        if (balance === undefined) throw new PersistenceError('NEGATIVE_BALANCE', 'VP effect cannot be applied');
        await client.query(
          `INSERT INTO malign.vp_transactions(game_id,game_event_sequence,artifact_ordinal,turn_id,
             participant_id,delta,balance_after,reason_type,source_entity_type,source_entity_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'COMMAND',$9)`,
          [transition.gameId,eventSequence,index+1,effect.turnId??null,effect.participantId,effect.delta,
            balance,effect.reasonType,transition.engineResult.commandId]);
        failAt(transition, 'vp');
      }

      for (const [index, effect] of (transition.effects?.influence ?? []).entries()) {
        requireNonZeroInteger(effect.delta, 'Influence delta');
        const updated = await client.query<{ count: number }>(
          `UPDATE malign.influence_stacks SET count=count+$5 WHERE game_id=$1 AND pd_state_id=$2
            AND influence_type=$3 AND attribution_country_definition_id=$4 AND count+$5>=0 RETURNING count`,
          [transition.gameId,effect.pdStateId,effect.influenceType,effect.attributionCountryDefinitionId,effect.delta]);
        const count = updated.rows[0]?.count;
        if (count === undefined) throw new PersistenceError('NEGATIVE_BALANCE', 'Influence effect cannot be applied');
        await client.query(
          `INSERT INTO malign.influence_mutations(game_id,game_event_sequence,artifact_ordinal,turn_id,
             pd_state_id,influence_type,attribution_country_definition_id,delta,mutation_reason,
             source_entity_type,source_entity_id,resulting_count)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'COMMAND',$10,$11)`,
          [transition.gameId,eventSequence,index+1,effect.turnId??null,effect.pdStateId,effect.influenceType,
            effect.attributionCountryDefinitionId,effect.delta,effect.reasonType,transition.engineResult.commandId,count]);
        failAt(transition, 'influence');
      }

      for (const [index, effect] of (transition.effects?.legitimacy ?? []).entries()) {
        const changed = await client.query(
          `UPDATE malign.population_demographic_states SET current_legitimacy_participant_id=$4
            WHERE game_id=$1 AND id=$2 AND current_legitimacy_participant_id IS NOT DISTINCT FROM $3`,
          [transition.gameId,effect.pdStateId,effect.previousParticipantId,effect.newParticipantId]);
        if (changed.rowCount !== 1) throw new PersistenceError('CROSS_GAME_REFERENCE', 'Legitimacy target is invalid');
        await client.query(
          `INSERT INTO malign.legitimacy_events(game_id,game_event_sequence,artifact_ordinal,turn_id,
             pd_state_id,previous_participant_id,new_participant_id,reason_type)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [transition.gameId,eventSequence,index+1,effect.turnId??null,effect.pdStateId,
            effect.previousParticipantId,effect.newParticipantId,effect.reasonType]);
        await client.query(`UPDATE malign.game_countries c SET legitimacy_count_cache=(
          SELECT count(*)::int FROM malign.population_demographic_states p WHERE p.game_id=c.game_id
          AND p.current_legitimacy_participant_id=c.controlling_participant_id) WHERE c.game_id=$1`,
        [transition.gameId]);
        failAt(transition, 'legitimacy');
      }

      for (const effect of transition.effects?.dieRolls ?? []) {
        const rawValue = effect.rawValue ?? this.options.rng?.next();
        if (!Number.isInteger(rawValue) || rawValue === undefined || rawValue < 1 || rawValue > 10) {
          throw new PersistenceError('ENGINE_TRANSITION_REQUIRED', 'Die roll effect is invalid');
        }
        await client.query(
          `INSERT INTO malign.die_rolls(game_id,turn_id,participant_id,die_type,mode,raw_value,
             source_type,source_entity_id,rng_metadata_json,rng_schema_id,rng_schema_version,created_at)
           VALUES ($1,$2,$3,'D10','DETERMINISTIC',$4,$5,$6,$7::jsonb,'malign.rng','0.2',$8)`,
          [transition.gameId,effect.turnId,effect.participantId,rawValue,effect.sourceType,
            transition.engineResult.commandId,JSON.stringify({cursor:rngCheckpoint??0}),now]);
        failAt(transition, 'rng_record');
      }

      const reducerPayload = {
        reducer: { type: 'REPLACE_SETUP_STATE', version: '0.1', stateAfter: transition.afterState },
        commandResult: transition.engineResult,
      };
      const event = await client.query<{ id: string }>(
        `INSERT INTO malign.game_events(game_id,sequence_number,event_type,actor_participant_id,
           subject_type,subject_id,payload_json,payload_schema_id,payload_schema_version,visibility_class,
           correlation_id,causation_id,state_hash_after,occurred_at)
         VALUES ($1,$2,$3,$4,'GAME',$1,$5::jsonb,'malign.game-transition','0.2','GAME',$6,$6,decode($7,'hex'),$8)
         RETURNING id`,
        [transition.gameId,eventSequence,transition.commandType,transition.actorParticipantId,
          JSON.stringify(reducerPayload),transition.engineResult.commandId,stateHash,now]);
      const eventId = event.rows[0]?.id;
      if (!eventId) throw new Error('Event identity missing');
      failAt(transition, 'event');

      const trace = await client.query<{ id: string }>(
        `INSERT INTO malign.adjudication_traces(game_id,game_event_sequence,artifact_ordinal,
           participant_id,trace_type,source_action_id,pre_state_hash,post_state_hash,input_snapshot_json,
           rule_evaluation_json,output_snapshot_json,trace_schema_id,trace_schema_version,correlation_id,causation_id)
         VALUES ($1,$2,1,$3,'ENGINE_COMMAND',$4,$5,decode($6,'hex'),$7::jsonb,$8::jsonb,$9::jsonb,
                 'malign.adjudication-trace','0.2',$4,$4) RETURNING id`,
        [transition.gameId,eventSequence,transition.actorParticipantId,transition.engineResult.commandId,
          game.gameplay_state_hash,stateHash,JSON.stringify(transition.beforeState),
          JSON.stringify({resultCode:transition.engineResult.resultCode,deterministic:true}),JSON.stringify(transition.afterState)]);
      const traceId = trace.rows[0]?.id;
      if (!traceId) throw new Error('Trace identity missing');
      failAt(transition, 'trace');

      if (transition.continuation) {
        const continuationHash = sha256CanonicalJson(transition.continuation.state);
        await client.query(
          `INSERT INTO malign.pending_resolutions(game_id,source_resolution_id,continuation_type,
             continuation_state_json,continuation_schema_id,continuation_schema_version,waiting_interaction_type,
             waiting_interaction_id,status,ruleset_version_id,engine_contract_version_id,state_hash)
           VALUES ($1,$2,$3,$4::jsonb,'malign.continuation','0.2','CHOICE',$5,'OPEN',$6,$7,decode($8,'hex'))`,
          [transition.gameId,transition.continuation.sourceResolutionId,transition.continuation.type,
            JSON.stringify(transition.continuation.state),transition.continuation.waitingInteractionId,
            game.ruleset_version_id,game.engine_contract_version_id,continuationHash]);
      }
      failAt(transition, 'continuation');

      if (transition.captureSnapshot) {
        await client.query(
          `INSERT INTO malign.game_snapshots(game_id,game_version,last_event_sequence,snapshot_json,
             snapshot_schema_id,snapshot_schema_version,canonical_jcs_sha256,gameplay_state_hash,
             ruleset_version_id,scenario_definition_id,card_registry_version_id,engine_contract_version_id,created_at)
           VALUES ($1,$2,$3,$4::jsonb,'malign.game-state','0.2',decode($5,'hex'),decode($5,'hex'),$6,$7,$8,$9,$10)`,
          [transition.gameId,versionAfter,eventSequence,JSON.stringify(transition.afterState),stateHash,
            game.ruleset_version_id,game.scenario_definition_id,game.card_registry_version_id,
            game.engine_contract_version_id,now]);
      }
      failAt(transition, 'snapshot');

      const result: DurableCommandResult = {
        commandId:transition.engineResult.commandId,gameId:transition.gameId,gameVersion:versionAfter,
        eventSequence,outboxSequence,eventId,traceId,replayed:false,
        sessionUser:identityRow.session_user,currentUser:'malign_app_runtime',
        engineResult:transition.engineResult,
      };
      await client.query(
        `UPDATE malign.idempotency_records SET status='COMMITTED',game_version_after=$4,
          result_json=$5::jsonb,result_schema_id='malign.command-result',result_schema_version='0.2',completed_at=$6
          WHERE game_id=$1 AND actor_id=$2 AND idempotency_key=$3`,
        [transition.gameId,transition.actorId,transition.idempotencyKey,versionAfter,JSON.stringify(result),now]);
      failAt(transition, 'idempotency');

      const outbox = await client.query<{ id: string }>(
        `INSERT INTO malign.outbox_messages(game_id,outbox_sequence,event_id,topic,audience_class,
           payload_json,payload_schema_id,payload_schema_version,correlation_id,deduplication_key,created_at)
         VALUES ($1,$2,$3,'GAME_EVENT','GAME',$4::jsonb,'malign.authorized-projection','0.2',$5,$6,$7) RETURNING id`,
        [transition.gameId,outboxSequence,eventId,JSON.stringify({eventId,eventSequence,gameVersion:versionAfter}),
          transition.engineResult.commandId,`${transition.gameId}:${eventSequence}:GAME`,now]);
      const outboxId = outbox.rows[0]?.id;
      if (!outboxId) throw new Error('Outbox identity missing');
      failAt(transition, 'outbox_message');
      await client.query(`INSERT INTO malign.outbox_delivery_states(outbox_message_id,delivery_status,next_attempt_at)
        VALUES ($1,'PENDING',$2)`,[outboxId,now]);
      failAt(transition, 'delivery_state');

      const cas = await client.query(`UPDATE malign.games SET game_version=$3,event_sequence_head=$4,
        outbox_sequence_head=$5 WHERE id=$1 AND game_version=$2`,
      [transition.gameId,versionBefore,versionAfter,eventSequence,outboxSequence]);
      if (cas.rowCount !== 1) throw new PersistenceError('GAME_VERSION_CONFLICT', 'Game CAS lost');
      await client.query('COMMIT');
      committed = true;
      try { await this.options.postCommitObserver?.(result); } catch { /* outbox owns retry */ }
      return result;
    } catch (error) {
      if (!committed) { try { await client.query('ROLLBACK'); } catch { /* already failed */ } }
      if (rngCheckpoint !== undefined) this.options.rng?.restore(rngCheckpoint);
      if (clockCheckpoint !== undefined) this.options.clock?.restore(clockCheckpoint);
      if (error instanceof PersistenceError) throw error;
      throw safeDatabaseError(error);
    } finally { client.release(); }
  }
}
