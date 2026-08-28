import { sha256CanonicalJson } from '@malign-ai/shared';
import type { Pool, PoolClient } from 'pg';

import { PersistenceError } from './errors.js';
import { assertLeastPrivilegeRuntimeIdentity } from './runtime-identity.js';

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

const identityUnderApplicationRole = (client: PoolClient) =>
  assertLeastPrivilegeRuntimeIdentity(client, 'malign_app_runtime');

const sortCanonical = <T>(values: readonly T[]): T[] =>
  [...values].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

const physicalCardZone = (zone: unknown): string =>
  zone === 'OPERATIONS_DECK' ? 'DRAW_PILE' : String(zone);

const recordKey = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';

const isCompleteSetupState = (value: Readonly<Record<string, unknown>>): boolean => {
  const adjudication = asRecord(value['adjudication']);
  return asRecord(value['participants']) !== undefined && asRecord(value['seats']) !== undefined &&
    asRecord(value['countries']) !== undefined && asRecord(value['cards']) !== undefined &&
    asRecord(value['actionPlanning']) !== undefined && adjudication !== undefined &&
    Array.isArray(adjudication['influenceStacks']) && Array.isArray(adjudication['dieRolls']) &&
    Array.isArray(value['events']);
};

const crossAuthorityFailures = async (
  client: PoolClient,
  gameId: string,
  state: Readonly<Record<string, unknown>>,
): Promise<readonly string[]> => {
  if (!isCompleteSetupState(state)) return [];
  const failures: string[] = [];
  const participants = asRecord(state['participants']) ?? {};
  const seats = asRecord(state['seats']) ?? {};
  const countries = asRecord(state['countries']) ?? {};
  const cards = asRecord(state['cards']) ?? {};
  const plans = asRecord(state['actionPlanning']) ?? {};
  const adjudication = asRecord(state['adjudication']) ?? {};
  const expectedParticipants = Object.values(participants).map((entry) => {
    const participant = asRecord(entry) ?? {};
    return `${String(participant['userId'])}:${String(participant['role'])}`;
  }).sort();
  const physicalParticipants = await client.query<{ external_user_ref: string; role: string }>(
    `SELECT external_user_ref,role FROM malign.game_participants WHERE game_id=$1 AND status='ACTIVE' ORDER BY external_user_ref,role`,
    [gameId],
  );
  if (!Object.is(JSON.stringify(expectedParticipants), JSON.stringify(physicalParticipants.rows.map((row) => `${row.external_user_ref}:${row.role}`).sort()))) {
    failures.push('normalized_participants');
  }
  const expectedSeats = Object.values(seats).map((entry) => {
    const seat = asRecord(entry) ?? {};
    const participant = asRecord(participants[String(seat['participantId'])]) ?? {};
    return `${String(participant['userId'])}:${String(seat['countryId'])}:${String(seat['seatIndex'])}:${String(seat['clockwiseIndex'])}`;
  }).sort();
  const physicalSeats = await client.query<{ external_user_ref: string; logical_id: string; seat_index: number; clockwise_index: number }>(
    `SELECT p.external_user_ref,c.logical_id,s.seat_index,s.clockwise_index
       FROM malign.player_seats s JOIN malign.game_participants p ON p.id=s.participant_id
       JOIN malign.country_definitions c ON c.id=s.country_definition_id
      WHERE s.game_id=$1 ORDER BY p.external_user_ref`, [gameId]);
  if (JSON.stringify(expectedSeats) !== JSON.stringify(physicalSeats.rows.map((row) => `${row.external_user_ref}:${row.logical_id}:${row.seat_index}:${row.clockwise_index}`).sort())) failures.push('normalized_seats');

  const physicalGame = await client.query<{ phase: string | null; resources: Record<string, number>; vp: Record<string, number> }>(
    `SELECT (SELECT phase_type FROM malign.phase_states WHERE game_id=$1 ORDER BY opened_at DESC NULLS LAST,id DESC LIMIT 1) phase,
       COALESCE((SELECT jsonb_object_agg(c.logical_id,g.current_resources_cache) FROM malign.game_countries g
         JOIN malign.country_definitions c ON c.id=g.country_definition_id WHERE g.game_id=$1),'{}') resources,
       COALESCE((SELECT jsonb_object_agg(p.external_user_ref,g.current_vp_cache) FROM malign.game_countries g
         JOIN malign.game_participants p ON p.id=g.controlling_participant_id WHERE g.game_id=$1),'{}') vp`, [gameId]);
  const phase = physicalGame.rows[0]?.phase;
  if (phase !== null && phase !== undefined && phase !== state['phase']) failures.push('normalized_phase');
  const expectedResources = Object.fromEntries(Object.entries(countries).flatMap(([countryId, value]) => {
    const country = asRecord(value);
    return country?.['controllerParticipantId'] === undefined ? [] : [[countryId, Number(country['resources'])]];
  }));
  if (!equalJson(expectedResources, physicalGame.rows[0]?.resources ?? {})) failures.push('normalized_resources');
  const vpByParticipant = asRecord(adjudication['vpByParticipant']) ?? {};
  const expectedVp = Object.fromEntries(Object.entries(vpByParticipant).flatMap(([participantId, balance]) => {
    if (seats[participantId] === undefined) return [];
    const participant = asRecord(participants[participantId]) ?? {};
    return [[String(participant['userId']), Number(balance)]];
  }));
  if (!equalJson(expectedVp, physicalGame.rows[0]?.vp ?? {})) failures.push('normalized_vp');

  const expectedAp = Object.values(plans).map((entry) => {
    const plan = asRecord(entry) ?? {};
    const participant = asRecord(participants[String(plan['participantId'])]) ?? {};
    return `${String(participant['userId'])}:${String(plan['apAllocated'])}:${String(plan['apAvailable'])}`;
  }).sort();
  const physicalAp = await client.query<{ external_user_ref: string; allocated: number; remaining: number }>(
    `SELECT p.external_user_ref,b.allocated,b.remaining FROM malign.action_point_balances b
       JOIN malign.game_participants p ON p.id=b.participant_id WHERE b.game_id=$1 ORDER BY p.external_user_ref`, [gameId]);
  if (expectedAp.length > 0 && JSON.stringify(expectedAp) !== JSON.stringify(physicalAp.rows.map((row) => `${row.external_user_ref}:${row.allocated}:${row.remaining}`).sort())) failures.push('normalized_ap');

  const expectedCards = sortCanonical(Object.values(cards).flatMap((entry) => {
    const card = asRecord(entry);
    if (card?.['controllerParticipantId'] === undefined) return [];
    const participant = asRecord(participants[recordKey(card['controllerParticipantId'])]) ?? {};
    return [{country:String(card['countryOwnerId']),serial:Number(card['serialWithinCountrySet']),
      controller:String(participant['userId']),zone:physicalCardZone(card['zone']),
      face:card['zone']==='HAND'?'FACE_UP':'FACE_DOWN',
      position:card['zone']==='OPERATIONS_DECK'?Number(card['zonePosition']??0)+1:null}];
  }));
  const physicalCards = await client.query<{country:string;serial:number;controller:string;zone:string;face:string;position:number|null}>(
    `SELECT c.logical_id country,t.serial_within_country_set serial,p.external_user_ref controller,
            i.zone,i.face_state face,d.position
       FROM malign.card_instances i JOIN malign.country_definitions c ON c.id=i.country_owner_definition_id
       JOIN malign.country_card_serial_templates t ON t.id=i.serial_template_id
       JOIN malign.game_participants p ON p.id=i.current_controller_participant_id
       LEFT JOIN malign.deck_card_positions d ON d.card_instance_id=i.id
      WHERE i.game_id=$1`,[gameId]);
  if (!equalJson(expectedCards,sortCanonical(physicalCards.rows))) failures.push('normalized_cards');

  const expectedPlans = sortCanonical(Object.values(plans).flatMap((entry) => {
    const plan=asRecord(entry)??{};
    const participant=asRecord(participants[String(plan['participantId'])])??{};
    const slots=(plan['locked']===true?plan['lockedSlots']:plan['draftSlots']) as readonly unknown[]|undefined;
    return (slots??[]).map((slotValue)=>{
      const slot=asRecord(slotValue)??{};
      return {participant:String(participant['userId']),sequence:Number(slot['sequenceIndex']),
        actionType:String(slot['actionType']),apCost:Number(slot['apCost']),parameters:slot['actionPayload']??{},
        state:slot['terminalOutcome']==='RESOLVED'?'RESOLVED':plan['locked']===true?'LOCKED':'DRAFT'};
    });
  }));
  const physicalPlans=await client.query<{participant:string;sequence:number;actionType:string;apCost:number;parameters:unknown;state:string}>(
    `SELECT p.external_user_ref participant,a.sequence_within_player sequence,a.action_type "actionType",
            a.ap_cost "apCost",a.parameters_json parameters,a.state
       FROM malign.planned_actions a JOIN malign.game_participants p ON p.id=a.participant_id
      WHERE a.game_id=$1 AND a.state<>'SUPERSEDED'`,[gameId]);
  if (!equalJson(expectedPlans,sortCanonical(physicalPlans.rows))) failures.push('normalized_plans');

  const initiative=asRecord(state['initiative'])??{};
  const expectedRolls=sortCanonical(((initiative['rolls'] as readonly unknown[]|undefined)??[]).map((entry)=>{
    const roll=asRecord(entry)??{};
    const participant=asRecord(participants[String(roll['participantId'])])??{};
    return {participant:String(participant['userId']),attempt:Number(roll['attempt']),
      rawValue:Number(roll['rawValue']),isTiebreak:Number(roll['attempt'])>1};
  }));
  const physicalRolls=await client.query<{participant:string;attempt:number;rawValue:number;isTiebreak:boolean}>(
    `SELECT p.external_user_ref participant,i.attempt_number attempt,d.raw_value "rawValue",i.is_tiebreak "isTiebreak"
       FROM malign.initiative_rolls i JOIN malign.game_participants p ON p.id=i.participant_id
       JOIN malign.die_rolls d ON d.id=i.die_roll_id WHERE i.game_id=$1`,[gameId]);
  if (!equalJson(expectedRolls,sortCanonical(physicalRolls.rows))) failures.push('normalized_initiative_rolls');
  const expectedOrder=((initiative['orderParticipantIds'] as readonly unknown[]|undefined)??[]).map((participantId,index)=>({
    participant:String((asRecord(participants[recordKey(participantId)])??{})['userId']),position:index+1,
  }));
  const physicalOrder=await client.query<{participant:string;position:number}>(
    `SELECT p.external_user_ref participant,i.initiative_position position FROM malign.initiative_entries i
       JOIN malign.game_participants p ON p.id=i.participant_id WHERE i.game_id=$1 ORDER BY i.initiative_position`,[gameId]);
  if (!equalJson(expectedOrder,physicalOrder.rows)) failures.push('normalized_initiative_order');

  const campaigns=asRecord(adjudication['campaigns'])??{};
  const expectedCampaigns=sortCanonical(Object.values(campaigns).map((entry)=>{
    const campaign=asRecord(entry)??{};
    const participant=asRecord(participants[String(campaign['ownerParticipantId'])])??{};
    return {owner:String(participant['userId']),row:String(campaign['row']),alignment:String(campaign['alignment']),
      target:String(campaign['targetDtId']),activationCount:Number(campaign['activationCountThisTurn'])};
  }));
  const physicalCampaigns=await client.query<{owner:string;row:string;alignment:string;target:string;activationCount:number}>(
    `SELECT p.external_user_ref owner,c.row,c.intent_alignment alignment,d.logical_id target,
            c.activation_count_current_turn_cache "activationCount"
       FROM malign.campaigns c JOIN malign.game_participants p ON p.id=c.owner_participant_id
       JOIN malign.demographic_token_definitions d ON d.id=c.target_dt_id
      WHERE c.game_id=$1 AND c.state='ACTIVE'`,[gameId]);
  if (!equalJson(expectedCampaigns,sortCanonical(physicalCampaigns.rows))) failures.push('normalized_campaigns');
  const expectedAssignments=sortCanonical(Object.values(campaigns).flatMap((entry)=>{
    const campaign=asRecord(entry)??{};
    const participant=asRecord(participants[String(campaign['ownerParticipantId'])])??{};
    return ((campaign['assignments'] as readonly unknown[]|undefined)??[]).map((assignmentValue)=>{
      const assignment=asRecord(assignmentValue)??{};
      const card=asRecord(cards[String(assignment['cardInstanceId'])])??{};
      return {owner:String(participant['userId']),row:String(campaign['row']),slot:String(assignment['slot']),
        country:String(card['countryOwnerId']),serial:Number(card['serialWithinCountrySet'])};
    });
  }));
  const physicalAssignments=await client.query<{owner:string;row:string;slot:string;country:string;serial:number}>(
    `SELECT p.external_user_ref owner,c.row,a.slot_type slot,d.logical_id country,t.serial_within_country_set serial
       FROM malign.campaign_card_assignments a JOIN malign.campaigns c ON c.id=a.campaign_id
       JOIN malign.game_participants p ON p.id=c.owner_participant_id
       JOIN malign.card_instances i ON i.id=a.card_instance_id
       JOIN malign.country_definitions d ON d.id=i.country_owner_definition_id
       JOIN malign.country_card_serial_templates t ON t.id=i.serial_template_id
      WHERE a.game_id=$1 AND a.removed_turn_id IS NULL`,[gameId]);
  if (!equalJson(expectedAssignments,sortCanonical(physicalAssignments.rows))) failures.push('normalized_campaign_assignments');

  const populationDemographics=asRecord(state['populationDemographics'])??{};
  const legitimacy=asRecord(adjudication['legitimacyByPd'])??{};
  const expectedPd=sortCanonical(Object.values(populationDemographics).map((entry)=>{
    const pd=asRecord(entry)??{};
    const participantId=legitimacy[String(pd['id'])];
    const participant=participantId===null||participantId===undefined?undefined:asRecord(participants[recordKey(participantId)]);
    return {pd:String(pd['id']),host:String(pd['hostCountryId']),legitimacy:participant===undefined?null:String(participant['userId'])};
  }));
  const physicalPd=await client.query<{pd:string;host:string;legitimacy:string|null}>(
    `SELECT d.logical_pd_id pd,c.logical_id host,p.external_user_ref legitimacy
       FROM malign.population_demographic_states s JOIN malign.scenario_pd_definitions d ON d.id=s.scenario_pd_definition_id
       JOIN malign.country_definitions c ON c.id=s.host_country_definition_id
       LEFT JOIN malign.game_participants p ON p.id=s.current_legitimacy_participant_id WHERE s.game_id=$1`,[gameId]);
  if (!equalJson(expectedPd,sortCanonical(physicalPd.rows))) failures.push('normalized_pd');
  const expectedInfluence=sortCanonical(((adjudication['influenceStacks'] as readonly unknown[]|undefined)??[]).map((entry)=>{
    const stack=asRecord(entry)??{};
    return {pd:String(stack['pdId']),type:String(stack['type']),country:String(stack['attributionCountryId']),count:Number(stack['count'])};
  }));
  const physicalInfluence=await client.query<{pd:string;type:string;country:string;count:number}>(
    `SELECT d.logical_pd_id pd,s.influence_type type,c.logical_id country,s.count
       FROM malign.influence_stacks s JOIN malign.population_demographic_states p ON p.id=s.pd_state_id
       JOIN malign.scenario_pd_definitions d ON d.id=p.scenario_pd_definition_id
       JOIN malign.country_definitions c ON c.id=s.attribution_country_definition_id WHERE s.game_id=$1`,[gameId]);
  if (!equalJson(expectedInfluence,sortCanonical(physicalInfluence.rows))) failures.push('normalized_influence');

  const pending = asRecord(adjudication['pendingResolution']);
  const durablePending = await client.query<{ pending: string; choices: string }>(
    `SELECT (SELECT count(*) FROM malign.pending_resolutions WHERE game_id=$1 AND status='OPEN')::text pending,
            (SELECT count(*) FROM malign.choice_requests WHERE game_id=$1 AND status='OPEN')::text choices`, [gameId]);
  if ((pending === undefined ? 0 : 1) !== Number(durablePending.rows[0]?.pending ?? 0)) failures.push('normalized_continuations');
  if ((pending?.['kind'] === 'CHOICE' ? 1 : 0) !== Number(durablePending.rows[0]?.choices ?? 0)) failures.push('normalized_choices');
  return failures;
};

const equalJson = (left: unknown, right: unknown): boolean =>
  sha256CanonicalJson(left) === sha256CanonicalJson(right);

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
        Number(result['gameVersionAfter']) !== expectedVersion + 1 ||
        (result['status'] !== 'RESOLVED' && result['status'] !== 'REQUIRES_CHOICE')) {
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
    sessionUser: identity.sessionUser,
    currentUser: 'malign_app_runtime',
    game,
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
    await assertLeastPrivilegeRuntimeIdentity(client,'malign_app_runtime');
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
      failures.push(...await crossAuthorityFailures(client, gameId, replay.state));
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
      const diagnostic = await client.query<{ event_sequence_head: string; gameplay_state_hash: Buffer }>(
        'SELECT event_sequence_head,gameplay_state_hash FROM malign.games WHERE id=$1', [gameId]);
      const diagnosticRow = diagnostic.rows[0];
      if (diagnosticRow !== undefined && Number(diagnosticRow.event_sequence_head) > 0) {
        await client.query(
          `INSERT INTO malign.adjudication_traces(game_id,game_event_sequence,artifact_ordinal,participant_id,
             trace_type,pre_state_hash,post_state_hash,input_snapshot_json,rule_evaluation_json,
             output_snapshot_json,trace_schema_id,trace_schema_version,correlation_id)
           SELECT $1::uuid,$2::bigint,COALESCE(max(artifact_ordinal),0)+1,NULL,'RECONCILIATION_DIAGNOSTIC_SYSTEM',
                  $3::bytea,$3::bytea,$4::jsonb,$5::jsonb,$6::jsonb,'malign.reconciliation-diagnostic','1.0',uuidv7()
             FROM malign.adjudication_traces WHERE game_id=$1::uuid AND game_event_sequence=$2::bigint`,
          [gameId,Number(diagnosticRow.event_sequence_head),diagnosticRow.gameplay_state_hash,
            JSON.stringify({families:[...new Set(failures)].sort()}),
            JSON.stringify({actorType:'SYSTEM',visibility:'FACILITATOR_ONLY',createsGameplayEvent:false}),
            JSON.stringify({recoveryBlocked:true})]);
      }
      await client.query('UPDATE malign.games SET recovery_blocked=true WHERE id=$1',[gameId]);
      await client.query('COMMIT');
      mismatchCommitted=true;
      throw new PersistenceError('RECONCILIATION_MISMATCH',`Durable game reconciliation failed (${[...new Set(failures)].sort().join(',')})`,{
        gameId,
        families:[...new Set(failures)].sort().join(','),
      });
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
