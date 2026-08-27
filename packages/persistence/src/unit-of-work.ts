import { sha256CanonicalJson } from '@malign-ai/shared';
import type { Pool, PoolClient } from 'pg';

import { PersistenceError } from './errors.js';

export const M2A_WRITE_BOUNDARIES = [
  'normalized_state',
  'ap_balance',
  'ap_journal',
  'resources',
  'vp',
  'influence',
  'legitimacy',
  'rng_record',
  'event',
  'trace',
  'continuation',
  'snapshot',
  'idempotency',
  'outbox_message',
  'delivery_state',
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

  get cursor(): number {
    return this.#cursor;
  }

  checkpoint(): number {
    return this.#cursor;
  }

  next(): T {
    const value = this.values[this.#cursor];
    if (value === undefined) throw new Error('TransactionalSequence exhausted');
    this.#cursor += 1;
    return value;
  }

  restore(checkpoint: number): void {
    this.#cursor = checkpoint;
  }
}

export interface DurableCommand {
  readonly gameId: string;
  readonly actorId: string;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly fingerprintSha256: string;
  readonly expectedGameVersion: number;
  readonly commandType: string;
  readonly resultState: Readonly<Record<string, unknown>>;
  readonly turnId: string;
  readonly pdStateId: string;
  readonly actionResolutionId?: string;
  readonly persistContinuation?: boolean;
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

const assertFingerprint = (fingerprint: string): void => {
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('fingerprintSha256 must be lowercase SHA-256 hex');
};

const failAt = (command: DurableCommand, boundary: M2AWriteBoundary): void => {
  if (command.faultAt === boundary) {
    throw new PersistenceError('TRANSACTION_WRITE_FAILED', `Injected write failure at ${boundary}`, { boundary });
  }
};

const readCommittedResult = async (
  client: Pool | PoolClient,
  command: DurableCommand,
): Promise<DurableCommandResult | undefined> => {
  const existing = await client.query<{
    command_fingerprint: Buffer;
    result_json: DurableCommandResult | null;
    status: string;
  }>(
    `SELECT command_fingerprint,result_json,status
       FROM malign.idempotency_records
      WHERE game_id=$1 AND actor_id=$2 AND idempotency_key=$3`,
    [command.gameId, command.actorId, command.idempotencyKey],
  );
  const row = existing.rows[0];
  if (!row || row.status !== 'COMMITTED' || row.result_json === null) return undefined;
  if (row.command_fingerprint.toString('hex') !== command.fingerprintSha256) {
    throw new PersistenceError('IDEMPOTENCY_CONFLICT', 'Idempotency key was committed with a different fingerprint');
  }
  return row.result_json;
};

export class PostgresDurableUnitOfWork {
  constructor(
    private readonly pool: Pool,
    private readonly options: DurableUnitOfWorkOptions = {},
  ) {}

  async execute(command: DurableCommand): Promise<DurableCommandResult> {
    assertFingerprint(command.fingerprintSha256);
    const fastResult = await readCommittedResult(this.pool, command);
    if (fastResult) return fastResult;

    const rngCheckpoint = this.options.rng?.checkpoint();
    const clockCheckpoint = this.options.clock?.checkpoint();
    const client = await this.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const locked = await client.query<LockedGame>(
        `SELECT game_version,event_sequence_head,outbox_sequence_head,recovery_blocked,
                ruleset_version_id,scenario_definition_id,card_registry_version_id,
                engine_contract_version_id,ert_definition_id,gameplay_state_hash
           FROM malign.games WHERE id=$1 FOR UPDATE`,
        [command.gameId],
      );
      const game = locked.rows[0];
      if (!game) throw new PersistenceError('GAME_NOT_FOUND', 'Game does not exist');
      if (game.recovery_blocked) {
        throw new PersistenceError('GAME_RECOVERY_BLOCKED', 'Game is blocked by durable reconciliation');
      }
      const underLockResult = await readCommittedResult(client, command);
      if (underLockResult) {
        await client.query('COMMIT');
        committed = true;
        return underLockResult;
      }
      const versionBefore = Number(game.game_version);
      if (versionBefore !== command.expectedGameVersion) {
        throw new PersistenceError('GAME_VERSION_CONFLICT', 'Expected game version did not match', {
          expected: command.expectedGameVersion,
          actual: versionBefore,
        });
      }
      const actor = await client.query(
        `SELECT 1 FROM malign.game_participants
          WHERE game_id=$1 AND id=$2 AND status='ACTIVE' AND role IN ('PLAYER','FACILITATOR')`,
        [command.gameId, command.actorId],
      );
      if (actor.rowCount !== 1) throw new PersistenceError('CROSS_GAME_REFERENCE', 'Actor is outside game scope');

      await client.query(
        `INSERT INTO malign.idempotency_records(
           game_id,actor_id,idempotency_key,command_id,command_fingerprint,command_type,status,game_version_before
         ) VALUES ($1,$2,$3,$4,decode($5,'hex'),$6,'INTERNAL_PENDING',$7)`,
        [
          command.gameId,
          command.actorId,
          command.idempotencyKey,
          command.commandId,
          command.fingerprintSha256,
          command.commandType,
          versionBefore,
        ],
      );

      const now = this.options.clock?.next() ?? new Date('2026-01-01T00:00:00.000Z');
      const roll = this.options.rng?.next() ?? 7;
      const stateHash = sha256CanonicalJson(command.resultState);
      const eventSequence = Number(game.event_sequence_head) + 1;
      const outboxSequence = Number(game.outbox_sequence_head) + 1;
      const versionAfter = versionBefore + 1;

      await client.query(
        `UPDATE malign.games SET authoritative_state_json=$2::jsonb,gameplay_state_hash=decode($3,'hex') WHERE id=$1`,
        [command.gameId, JSON.stringify(command.resultState), stateHash],
      );
      failAt(command, 'normalized_state');

      const ap = await client.query<{ remaining: number; last_transaction_sequence: string }>(
        `UPDATE malign.action_point_balances
            SET spent=spent+1,remaining=remaining-1,last_transaction_sequence=last_transaction_sequence+1
          WHERE game_id=$1 AND turn_id=$2 AND participant_id=$3 AND remaining>=1
          RETURNING remaining,last_transaction_sequence`,
        [command.gameId, command.turnId, command.actorId],
      );
      if (!ap.rows[0]) throw new Error('AP balance unavailable');
      failAt(command, 'ap_balance');
      await client.query(
        `INSERT INTO malign.action_point_transactions(
           game_id,game_event_sequence,artifact_ordinal,turn_id,participant_id,sequence_number,
           delta,reason_type,source_entity_type,source_entity_id,correlation_id,balance_after
         ) VALUES ($1,$2,1,$3,$4,$5,-1,'COMMAND','COMMAND',$6,$6,$7)`,
        [command.gameId, eventSequence, command.turnId, command.actorId, ap.rows[0].last_transaction_sequence, command.commandId, ap.rows[0].remaining],
      );
      failAt(command, 'ap_journal');

      const resources = await client.query<{ current_resources_cache: number }>(
        `UPDATE malign.game_countries SET current_resources_cache=current_resources_cache+1
          WHERE game_id=$1 AND controlling_participant_id=$2 RETURNING current_resources_cache`,
        [command.gameId, command.actorId],
      );
      await client.query(
        `INSERT INTO malign.resource_transactions(
           game_id,game_event_sequence,artifact_ordinal,turn_id,participant_id,delta,reason_type,
           source_entity_type,source_entity_id,balance_after
         ) VALUES ($1,$2,2,$3,$4,1,'COMMAND','COMMAND',$5,$6)`,
        [command.gameId, eventSequence, command.turnId, command.actorId, command.commandId, resources.rows[0]?.current_resources_cache ?? 1],
      );
      failAt(command, 'resources');

      const vp = await client.query<{ current_vp_cache: number }>(
        `UPDATE malign.game_countries SET current_vp_cache=current_vp_cache+1
          WHERE game_id=$1 AND controlling_participant_id=$2 RETURNING current_vp_cache`,
        [command.gameId, command.actorId],
      );
      await client.query(
        `INSERT INTO malign.vp_transactions(
           game_id,game_event_sequence,artifact_ordinal,turn_id,participant_id,delta,balance_after,
           reason_type,source_entity_type,source_entity_id
         ) VALUES ($1,$2,3,$3,$4,1,$5,'COMMAND','COMMAND',$6)`,
        [command.gameId, eventSequence, command.turnId, command.actorId, vp.rows[0]?.current_vp_cache ?? 1, command.commandId],
      );
      failAt(command, 'vp');

      const influence = await client.query<{ count: number; attribution_country_definition_id: string }>(
        `UPDATE malign.influence_stacks SET count=count+1
          WHERE game_id=$1 AND pd_state_id=$2
          RETURNING count,attribution_country_definition_id`,
        [command.gameId, command.pdStateId],
      );
      await client.query(
        `INSERT INTO malign.influence_mutations(
           game_id,game_event_sequence,artifact_ordinal,turn_id,pd_state_id,influence_type,
           attribution_country_definition_id,delta,mutation_reason,source_entity_type,source_entity_id,resulting_count
         ) VALUES ($1,$2,4,$3,$4,'MALIGN',$5,1,'COMMAND','COMMAND',$6,$7)`,
        [command.gameId, eventSequence, command.turnId, command.pdStateId, influence.rows[0]?.attribution_country_definition_id, command.commandId, influence.rows[0]?.count ?? 1],
      );
      failAt(command, 'influence');

      await client.query(
        `INSERT INTO malign.legitimacy_events(
           game_id,game_event_sequence,artifact_ordinal,turn_id,pd_state_id,
           previous_participant_id,new_participant_id,reason_type
         ) VALUES ($1,$2,5,$3,$4,$5,$5,'AUDIT_ONLY')`,
        [command.gameId, eventSequence, command.turnId, command.pdStateId, command.actorId],
      );
      failAt(command, 'legitimacy');

      await client.query(
        `INSERT INTO malign.die_rolls(
           game_id,turn_id,participant_id,die_type,mode,raw_value,source_type,source_entity_id,
           rng_metadata_json,rng_schema_id,rng_schema_version,created_at
         ) VALUES ($1,$2,$3,'D10','DETERMINISTIC',$4,'COMMAND',$5,$6::jsonb,'malign.rng','0.1',$7)`,
        [command.gameId, command.turnId, command.actorId, roll, command.commandId, JSON.stringify({ cursor: rngCheckpoint ?? 0 }), now],
      );
      failAt(command, 'rng_record');

      const event = await client.query<{ id: string }>(
        `INSERT INTO malign.game_events(
           game_id,sequence_number,turn_id,event_type,actor_participant_id,subject_type,subject_id,
           payload_json,payload_schema_id,payload_schema_version,visibility_class,correlation_id,
           causation_id,state_hash_after,occurred_at
         ) VALUES ($1,$2,$3,$4,$5,'GAME',$1,$6::jsonb,'malign.game-event','0.1','GAME',$7,$7,decode($8,'hex'),$9)
         RETURNING id`,
        [command.gameId, eventSequence, command.turnId, command.commandType, command.actorId, JSON.stringify({ commandId: command.commandId, gameVersion: versionAfter }), command.commandId, stateHash, now],
      );
      const eventId = event.rows[0]?.id;
      if (!eventId) throw new Error('Event identity missing');
      failAt(command, 'event');

      const trace = await client.query<{ id: string }>(
        `INSERT INTO malign.adjudication_traces(
           game_id,game_event_sequence,artifact_ordinal,turn_id,participant_id,trace_type,
           source_action_id,pre_state_hash,post_state_hash,input_snapshot_json,rule_evaluation_json,
           output_snapshot_json,trace_schema_id,trace_schema_version,correlation_id,causation_id
         ) VALUES ($1,$2,6,$3,$4,'COMMAND',$5,$6,decode($7,'hex'),$8::jsonb,$9::jsonb,$10::jsonb,
                   'malign.adjudication-trace','0.1',$5,$5) RETURNING id`,
        [command.gameId, eventSequence, command.turnId, command.actorId, command.commandId, game.gameplay_state_hash, stateHash, JSON.stringify({ commandType: command.commandType }), JSON.stringify({ deterministic: true }), JSON.stringify(command.resultState)],
      );
      const traceId = trace.rows[0]?.id;
      if (!traceId) throw new Error('Trace identity missing');
      failAt(command, 'trace');

      if (command.persistContinuation && command.actionResolutionId) {
        await client.query(
          `INSERT INTO malign.pending_resolutions(
             game_id,source_resolution_id,continuation_type,continuation_state_json,
             continuation_schema_id,continuation_schema_version,waiting_interaction_type,
             waiting_interaction_id,status,ruleset_version_id,engine_contract_version_id,state_hash
           ) VALUES ($1,$2,'M2A_FIXTURE',$3::jsonb,'malign.continuation','0.1','CHOICE',$4,
                     'OPEN',$5,$6,decode($7,'hex'))`,
          [command.gameId, command.actionResolutionId, JSON.stringify({ commandId: command.commandId }), command.commandId, game.ruleset_version_id, game.engine_contract_version_id, stateHash],
        );
      }
      failAt(command, 'continuation');

      await client.query(
        `INSERT INTO malign.game_snapshots(
           game_id,game_version,last_event_sequence,snapshot_json,snapshot_schema_id,snapshot_schema_version,
           canonical_jcs_sha256,gameplay_state_hash,ruleset_version_id,scenario_definition_id,
           card_registry_version_id,engine_contract_version_id,created_at
         ) VALUES ($1,$2,$3,$4::jsonb,'malign.game-state','0.1',decode($5,'hex'),decode($5,'hex'),$6,$7,$8,$9,$10)`,
        [command.gameId, versionAfter, eventSequence, JSON.stringify(command.resultState), stateHash, game.ruleset_version_id, game.scenario_definition_id, game.card_registry_version_id, game.engine_contract_version_id, now],
      );
      failAt(command, 'snapshot');

      const result: DurableCommandResult = {
        commandId: command.commandId,
        gameId: command.gameId,
        gameVersion: versionAfter,
        eventSequence,
        outboxSequence,
        eventId,
        traceId,
        replayed: false,
      };
      await client.query(
        `UPDATE malign.idempotency_records
            SET status='COMMITTED',game_version_after=$4,result_json=$5::jsonb,
                result_schema_id='malign.command-result',result_schema_version='0.1',completed_at=$6
          WHERE game_id=$1 AND actor_id=$2 AND idempotency_key=$3`,
        [command.gameId, command.actorId, command.idempotencyKey, versionAfter, JSON.stringify(result), now],
      );
      failAt(command, 'idempotency');

      const outbox = await client.query<{ id: string }>(
        `INSERT INTO malign.outbox_messages(
           game_id,outbox_sequence,event_id,topic,audience_class,payload_json,payload_schema_id,
           payload_schema_version,correlation_id,deduplication_key,created_at
         ) VALUES ($1,$2,$3,'GAME_EVENT','GAME',$4::jsonb,'malign.authorized-projection','0.1',$5,$6,$7)
         RETURNING id`,
        [command.gameId, outboxSequence, eventId, JSON.stringify({ eventId, eventSequence, gameVersion: versionAfter }), command.commandId, `${command.gameId}:${eventSequence}:GAME`, now],
      );
      const outboxId = outbox.rows[0]?.id;
      if (!outboxId) throw new Error('Outbox identity missing');
      failAt(command, 'outbox_message');
      await client.query(
        `INSERT INTO malign.outbox_delivery_states(outbox_message_id,delivery_status,next_attempt_at)
         VALUES ($1,'PENDING',$2)`,
        [outboxId, now],
      );
      failAt(command, 'delivery_state');

      const cas = await client.query(
        `UPDATE malign.games
            SET game_version=$3,event_sequence_head=$4,outbox_sequence_head=$5
          WHERE id=$1 AND game_version=$2`,
        [command.gameId, versionBefore, versionAfter, eventSequence, outboxSequence],
      );
      if (cas.rowCount !== 1) throw new PersistenceError('GAME_VERSION_CONFLICT', 'Game CAS lost');
      await client.query('COMMIT');
      committed = true;
      try {
        await this.options.postCommitObserver?.(result);
      } catch {
        // Gameplay is already committed. Observer failures are isolated and retried via outbox.
      }
      return result;
    } catch (error) {
      if (!committed) await client.query('ROLLBACK');
      if (rngCheckpoint !== undefined) this.options.rng?.restore(rngCheckpoint);
      if (clockCheckpoint !== undefined) this.options.clock?.restore(clockCheckpoint);
      if (error instanceof PersistenceError) throw error;
      throw new PersistenceError('TRANSACTION_WRITE_FAILED', 'Durable command transaction failed');
    } finally {
      client.release();
    }
  }
}
