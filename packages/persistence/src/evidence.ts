import type { Pool } from 'pg';

import { recoverDurableGame } from './recovery.js';

export interface DurableEvidence {
  readonly state: Readonly<Record<string, unknown>>;
  readonly gameplayHash: string;
  readonly versionPins: readonly Readonly<Record<string, unknown>>[];
  readonly events: readonly Readonly<Record<string, unknown>>[];
  readonly actionPointLedger: readonly Readonly<Record<string, unknown>>[];
  readonly resourceLedger: readonly Readonly<Record<string, unknown>>[];
  readonly victoryPointLedger: readonly Readonly<Record<string, unknown>>[];
  readonly influenceLedger: readonly Readonly<Record<string, unknown>>[];
  readonly legitimacyLedger: readonly Readonly<Record<string, unknown>>[];
  readonly traces: readonly Readonly<Record<string, unknown>>[];
  readonly snapshots: readonly Readonly<Record<string, unknown>>[];
  readonly continuations: readonly Readonly<Record<string, unknown>>[];
  readonly idempotency: readonly Readonly<Record<string, unknown>>[];
  readonly outboxMessages: readonly Readonly<Record<string, unknown>>[];
  readonly outboxStates: readonly Readonly<Record<string, unknown>>[];
  readonly outboxAttempts: readonly Readonly<Record<string, unknown>>[];
  readonly replay: Readonly<Record<string, unknown>>;
  readonly authorizedProjection: unknown;
}

const rows = async (pool:Pool,sql:string,gameId:string):Promise<readonly Readonly<Record<string,unknown>>[]> =>
  (await pool.query<Readonly<Record<string,unknown>>>(sql,[gameId])).rows;

export const captureDurableEvidence = async (
  pool:Pool,
  gameId:string,
  project:(state:Readonly<Record<string,unknown>>)=>unknown = state=>state,
):Promise<DurableEvidence> => {
  const replay=await recoverDurableGame(pool,gameId);
  const [game,events,ap,resources,vp,influence,legitimacy,traces,snapshots,continuations,idempotency,
    outboxMessages,outboxStates,outboxAttempts]=await Promise.all([
    rows(pool,`SELECT game_version,event_sequence_head,outbox_sequence_head,
      encode(gameplay_state_hash,'hex') gameplay_hash,ruleset_version_id,scenario_definition_id,
      card_registry_version_id,engine_contract_version_id,ert_definition_id,authoritative_state_json
      FROM malign.games WHERE id=$1`,gameId),
    rows(pool,`SELECT sequence_number,event_type,payload_json,payload_schema_id,payload_schema_version,
      encode(state_hash_after,'hex') state_hash_after FROM malign.game_events WHERE game_id=$1 ORDER BY sequence_number,id`,gameId),
    rows(pool,`SELECT game_event_sequence,artifact_ordinal,turn_id,participant_id,sequence_number,delta,
      reason_type,balance_after FROM malign.action_point_transactions WHERE game_id=$1
      ORDER BY game_event_sequence,artifact_ordinal,id`,gameId),
    rows(pool,`SELECT game_event_sequence,artifact_ordinal,turn_id,participant_id,counterparty_participant_id,
      delta,reason_type,balance_after FROM malign.resource_transactions WHERE game_id=$1
      ORDER BY game_event_sequence,artifact_ordinal,id`,gameId),
    rows(pool,`SELECT game_event_sequence,artifact_ordinal,turn_id,participant_id,delta,balance_after,reason_type
      FROM malign.vp_transactions WHERE game_id=$1 ORDER BY game_event_sequence,artifact_ordinal,id`,gameId),
    rows(pool,`SELECT game_event_sequence,artifact_ordinal,turn_id,pd_state_id,influence_type,
      attribution_country_definition_id,delta,mutation_reason,resulting_count FROM malign.influence_mutations
      WHERE game_id=$1 ORDER BY game_event_sequence,artifact_ordinal,id`,gameId),
    rows(pool,`SELECT game_event_sequence,artifact_ordinal,turn_id,pd_state_id,previous_participant_id,
      new_participant_id,reason_type FROM malign.legitimacy_events WHERE game_id=$1
      ORDER BY game_event_sequence,artifact_ordinal,id`,gameId),
    rows(pool,`SELECT game_event_sequence,artifact_ordinal,trace_type,encode(pre_state_hash,'hex') pre_state_hash,
      encode(post_state_hash,'hex') post_state_hash,input_snapshot_json,rule_evaluation_json,output_snapshot_json,
      trace_schema_id,trace_schema_version FROM malign.adjudication_traces WHERE game_id=$1
      ORDER BY game_event_sequence,artifact_ordinal,id`,gameId),
    rows(pool,`SELECT game_version,last_event_sequence,snapshot_json,snapshot_schema_id,snapshot_schema_version,
      encode(canonical_jcs_sha256,'hex') canonical_jcs_sha256,encode(gameplay_state_hash,'hex') gameplay_state_hash,
      ruleset_version_id,scenario_definition_id,card_registry_version_id,engine_contract_version_id
      FROM malign.game_snapshots WHERE game_id=$1 ORDER BY game_version,id`,gameId),
    rows(pool,`SELECT continuation_type,continuation_state_json,continuation_schema_id,continuation_schema_version,
      waiting_interaction_type,waiting_interaction_id,status,ruleset_version_id,engine_contract_version_id,
      encode(state_hash,'hex') state_hash FROM malign.pending_resolutions WHERE game_id=$1 ORDER BY id`,gameId),
    rows(pool,`SELECT actor_id,idempotency_key,command_id,encode(command_fingerprint,'hex') command_fingerprint,
      command_type,status,game_version_before,game_version_after,result_json,result_schema_id,result_schema_version
      FROM malign.idempotency_records WHERE game_id=$1 ORDER BY id`,gameId),
    rows(pool,`SELECT outbox_sequence,event_id,topic,audience_class,audience_id,payload_json,payload_schema_id,
      payload_schema_version,correlation_id,deduplication_key FROM malign.outbox_messages WHERE game_id=$1
      ORDER BY outbox_sequence,id`,gameId),
    rows(pool,`SELECT m.outbox_sequence,s.delivery_status,s.last_attempt_ordinal,s.claim_token_digest IS NOT NULL claimed,
      s.last_error_code FROM malign.outbox_delivery_states s JOIN malign.outbox_messages m ON m.id=s.outbox_message_id
      WHERE m.game_id=$1 ORDER BY m.outbox_sequence`,gameId),
    rows(pool,`SELECT m.outbox_sequence,a.attempt_ordinal,a.stage_ordinal,a.event_type,a.error_code,a.result_code
      FROM malign.outbox_delivery_attempts a JOIN malign.outbox_messages m ON m.id=a.outbox_message_id
      WHERE m.game_id=$1 ORDER BY m.outbox_sequence,a.attempt_ordinal,a.stage_ordinal`,gameId),
  ]);
  const gameRow=game[0]??{};
  const gameplayHash=gameRow['gameplay_hash'];
  return {
    state:replay.state,
    gameplayHash:typeof gameplayHash==='string'?gameplayHash:'',
    versionPins:game,
    events,actionPointLedger:ap,resourceLedger:resources,victoryPointLedger:vp,
    influenceLedger:influence,legitimacyLedger:legitimacy,traces,snapshots,continuations,idempotency,
    outboxMessages,outboxStates,outboxAttempts,
    replay:{gameVersion:replay.gameVersion,stateHash:replay.stateHash,snapshotVersion:replay.snapshotVersion,
      snapshotLastEventSequence:replay.snapshotLastEventSequence,eventTailLength:replay.eventTail.length,pins:replay.pins},
    authorizedProjection:project(replay.state),
  };
};
