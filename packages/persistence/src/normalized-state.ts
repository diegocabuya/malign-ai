import { createHash } from 'node:crypto';

import type {
  DurableEngineTransitionV1,
  DurableNormalizedFamily,
  SetupGameState,
} from '@malign-ai/domain';
import type { PoolClient } from 'pg';

import { PersistenceError } from './errors.js';

export interface NormalizedPersistenceContext {
  readonly participantIds: ReadonlyMap<string, string>;
  readonly countryDefinitionIds: ReadonlyMap<string, string>;
  readonly pdStateIds: ReadonlyMap<string, string>;
  readonly turnId: string | null;
  readonly phaseStateId: string | null;
  readonly campaignIds: ReadonlyMap<string, string>;
  readonly resourceArtifactOffset: number;
  readonly influenceArtifactOffset: number;
}

const hasFamily = (transition: DurableEngineTransitionV1, family: DurableNormalizedFamily): boolean =>
  transition.normalizedMutations.some((mutation) => mutation.family === family);

const sessionDigest = (sessionId: string): Buffer => createHash('sha256').update(sessionId).digest();

const physicalCardZone = (zone: string): string => zone === 'OPERATIONS_DECK' ? 'DRAW_PILE' : zone;

const loadCountryDefinitions = async (client: PoolClient): Promise<Map<string, string>> => {
  const result = await client.query<{ id: string; logical_id: string }>(
    `SELECT id,logical_id FROM malign.country_definitions WHERE version='0.1' AND status='ACTIVE'`,
  );
  return new Map(result.rows.map(({ logical_id, id }) => [logical_id, id]));
};

const synchronizeParticipants = async (
  client: PoolClient,
  transition: DurableEngineTransitionV1,
  now: Date,
): Promise<Map<string, string>> => {
  const mapping = new Map<string, string>();
  for (const participant of Object.values(transition.afterState.participants)) {
    const persisted = await client.query<{ id: string }>(
      `INSERT INTO malign.game_participants(game_id,external_user_ref,role,status,joined_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (game_id,external_user_ref) DO UPDATE SET role=EXCLUDED.role,status=EXCLUDED.status
       RETURNING id`,
      [transition.gameId, participant.userId, participant.role, participant.status, now],
    );
    const id = persisted.rows[0]?.id;
    if (id === undefined) throw new PersistenceError('TRANSACTION_WRITE_FAILED', 'Participant identity is missing');
    mapping.set(participant.id, id);
  }
  const actorParticipantId = transition.actor.participantId === null
    ? undefined
    : mapping.get(transition.actor.participantId);
  if (transition.actor.participantId !== null && actorParticipantId === undefined) {
    throw new PersistenceError('CROSS_GAME_REFERENCE', 'Transition actor participant is outside the after-state');
  }
  await client.query(
    `INSERT INTO malign.game_sessions(game_id,state,opened_at)
     VALUES ($1,'OPEN',$2) ON CONFLICT (game_id) DO UPDATE SET state='OPEN',closed_at=NULL`,
    [transition.gameId, now],
  );
  if (actorParticipantId !== undefined) {
    await client.query(
      `INSERT INTO malign.game_memberships(game_session_id,participant_id,authenticated_session_digest,
         connected,last_verified_at,disconnected_at)
       SELECT id,$2,$3,true,$4,NULL FROM malign.game_sessions WHERE game_id=$1
       ON CONFLICT (game_session_id,participant_id) DO UPDATE SET
         authenticated_session_digest=EXCLUDED.authenticated_session_digest,connected=true,
         last_verified_at=EXCLUDED.last_verified_at,disconnected_at=NULL`,
      [transition.gameId, actorParticipantId, sessionDigest(transition.actor.authenticatedSessionId), now],
    );
  }
  return mapping;
};

const synchronizeSeatsAndCountries = async (
  client: PoolClient,
  transition: DurableEngineTransitionV1,
  participantIds: ReadonlyMap<string, string>,
  countryIds: ReadonlyMap<string, string>,
  eventSequence: number,
  traceId: string,
): Promise<number> => {
  let resourceArtifactOffset = 0;
  for (const seat of Object.values(transition.afterState.seats)) {
    const participantId = participantIds.get(seat.participantId);
    const countryDefinitionId = countryIds.get(seat.countryId);
    if (participantId === undefined || countryDefinitionId === undefined) {
      throw new PersistenceError('CROSS_GAME_REFERENCE', 'Seat references an unknown participant or country');
    }
    await client.query(
      `INSERT INTO malign.player_seats(game_id,participant_id,seat_index,clockwise_index,country_definition_id)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (game_id,participant_id) DO UPDATE SET seat_index=EXCLUDED.seat_index,
         clockwise_index=EXCLUDED.clockwise_index,country_definition_id=EXCLUDED.country_definition_id`,
      [transition.gameId, participantId, seat.seatIndex, seat.clockwiseIndex, countryDefinitionId],
    );
    const country = transition.afterState.countries[seat.countryId];
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO malign.game_countries(game_id,country_definition_id,controlling_participant_id,
         current_vp_cache,current_resources_cache,legitimacy_count_cache)
       VALUES ($1,$2,$3,0,$4,0) ON CONFLICT (game_id,country_definition_id) DO NOTHING RETURNING id`,
      [transition.gameId, countryDefinitionId, participantId, country.resources],
    );
    await client.query(
      `UPDATE malign.game_countries SET controlling_participant_id=$3,current_resources_cache=$4,
         current_vp_cache=$5 WHERE game_id=$1 AND country_definition_id=$2`,
      [transition.gameId, countryDefinitionId, participantId, country.resources,
        transition.afterState.adjudication.vpByParticipant[seat.participantId] ?? 0],
    );
    if (inserted.rowCount === 1 && country.resources > 0) {
      resourceArtifactOffset += 1;
      await client.query(
         `INSERT INTO malign.resource_transactions(game_id,game_event_sequence,artifact_ordinal,
           participant_id,delta,reason_type,source_entity_type,source_entity_id,adjudication_trace_id,balance_after)
         VALUES ($1,$2,$3,$4,$5::integer,'SCENARIO_SETUP','COMMAND',$6,$7,$5::integer)`,
        [transition.gameId,eventSequence,resourceArtifactOffset,participantId,country.resources,
          traceId,traceId],
      );
    }
  }
  return resourceArtifactOffset;
};

const synchronizeTurnPhaseAndInitiative = async (
  client: PoolClient,
  state: SetupGameState,
  participantIds: ReadonlyMap<string, string>,
  traceId: string,
  now: Date,
): Promise<{ turnId: string | null; phaseStateId: string | null }> => {
  if (state.phase === 'SETUP') return { turnId: null, phaseStateId: null };
  const turn = await client.query<{ id: string }>(
    `INSERT INTO malign.turns(game_id,number,status,started_at) VALUES ($1,1,'ACTIVE',$2)
     ON CONFLICT (game_id,number) DO UPDATE SET status='ACTIVE' RETURNING id`, [state.id, now]);
  const turnId = turn.rows[0]?.id;
  if (turnId === undefined) throw new PersistenceError('TRANSACTION_WRITE_FAILED', 'Turn identity is missing');
  await client.query(
    `UPDATE malign.phase_states SET status='RESOLVED',resolved_at=COALESCE(resolved_at,$3)
      WHERE game_id=$1 AND turn_id=$2 AND phase_type<>$4 AND status='ACTIVE'`,
    [state.id,turnId,now,state.phase],
  );
  const phase = await client.query<{ id: string }>(
    `INSERT INTO malign.phase_states(game_id,turn_id,phase_type,status,opened_at)
     VALUES ($1,$2,$3,'ACTIVE',$4)
     ON CONFLICT (turn_id,phase_type) DO UPDATE SET status='ACTIVE',resolved_at=NULL RETURNING id`,
    [state.id,turnId,state.phase,now],
  );
  const phaseStateId = phase.rows[0]?.id;
  if (phaseStateId === undefined) throw new PersistenceError('TRANSACTION_WRITE_FAILED', 'Phase identity is missing');
  for (const [logicalParticipantId, maintenance] of Object.entries(state.initiative.maintenance)) {
    const participantId = participantIds.get(logicalParticipantId);
    if (participantId === undefined) continue;
    await client.query(
      `INSERT INTO malign.player_phase_readiness(phase_state_id,game_id,participant_id,status,locked_at)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (phase_state_id,participant_id) DO UPDATE SET
         status=EXCLUDED.status,locked_at=EXCLUDED.locked_at,row_version=malign.player_phase_readiness.row_version+1`,
      [phaseStateId,state.id,participantId,maintenance.locked?'LOCKED':maintenance.submitted?'READY':'PENDING',maintenance.locked?now:null],
    );
  }
  for (const roll of state.initiative.rolls) {
    const participantId = participantIds.get(roll.participantId);
    if (participantId === undefined) continue;
    const existing = await client.query<{ die_roll_id: string | null }>(
      `SELECT die_roll_id FROM malign.initiative_rolls
        WHERE turn_id=$1 AND participant_id=$2 AND attempt_number=$3`,
      [turnId,participantId,roll.attempt],
    );
    if (existing.rows[0] === undefined) {
      const dieRoll = await client.query<{ id: string }>(
        `INSERT INTO malign.die_rolls(game_id,turn_id,participant_id,die_type,mode,raw_value,
           source_type,source_entity_id,rng_metadata_json,rng_schema_id,rng_schema_version,created_at)
         VALUES ($1,$2,$3,'D10',$4,$5,'INITIATIVE',$6,$7::jsonb,'malign.rng','0.2',$8) RETURNING id`,
        [state.id,turnId,participantId,state.diceMode,roll.rawValue,traceId,
          JSON.stringify({attempt:roll.attempt,tiebreak:roll.attempt>1}),now],
      );
      await client.query(
        `INSERT INTO malign.initiative_rolls(game_id,turn_id,participant_id,attempt_number,die_roll_id,is_tiebreak,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [state.id,turnId,participantId,roll.attempt,dieRoll.rows[0]?.id,roll.attempt>1,now],
      );
    }
  }
  for (const [index, logicalParticipantId] of state.initiative.orderParticipantIds.entries()) {
    const participantId = participantIds.get(logicalParticipantId);
    if (participantId === undefined) continue;
    const winningRoll = [...state.initiative.rolls].reverse().find((roll) => roll.participantId === logicalParticipantId)?.rawValue ?? 1;
    await client.query(
      `INSERT INTO malign.initiative_entries(game_id,turn_id,participant_id,initiative_position,winning_roll)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (turn_id,participant_id) DO UPDATE SET
         initiative_position=EXCLUDED.initiative_position,winning_roll=EXCLUDED.winning_roll,
         row_version=malign.initiative_entries.row_version+1`,
      [state.id,turnId,participantId,index+1,winningRoll],
    );
  }
  return { turnId, phaseStateId };
};

const synchronizeActionPlanning = async (
  client: PoolClient,
  state: SetupGameState,
  participantIds: ReadonlyMap<string, string>,
  turnId: string | null,
  now: Date,
): Promise<void> => {
  if (turnId === null) return;
  for (const [logicalParticipantId, planning] of Object.entries(state.actionPlanning)) {
    const participantId = participantIds.get(logicalParticipantId);
    if (participantId === undefined) continue;
    await client.query(
      `INSERT INTO malign.action_point_balances(game_id,turn_id,participant_id,allocated,spent,remaining,last_transaction_sequence)
       VALUES ($1,$2,$3,$4,$5,$6,0) ON CONFLICT (turn_id,participant_id) DO UPDATE SET
         allocated=EXCLUDED.allocated,spent=EXCLUDED.spent,remaining=EXCLUDED.remaining`,
      [state.id,turnId,participantId,planning.apAllocated,planning.apAllocated-planning.apAvailable,planning.apAvailable],
    );
    const slots = planning.locked ? planning.lockedSlots : planning.draftSlots;
    await client.query(
      `UPDATE malign.planned_actions SET state='SUPERSEDED' WHERE game_id=$1 AND turn_id=$2
        AND participant_id=$3 AND sequence_within_player>$4 AND state<>'RESOLVED'`,
      [state.id,turnId,participantId,slots.length],
    );
    for (const slot of slots) {
      await client.query(
        `INSERT INTO malign.planned_actions(game_id,turn_id,participant_id,sequence_within_player,
           action_type,ap_cost,parameters_json,parameters_schema_id,parameters_schema_version,state,locked_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'malign.action-plan','1.0',$8,$9)
         ON CONFLICT (turn_id,participant_id,sequence_within_player) DO UPDATE SET
           action_type=EXCLUDED.action_type,ap_cost=EXCLUDED.ap_cost,parameters_json=EXCLUDED.parameters_json,
           parameters_schema_id=EXCLUDED.parameters_schema_id,parameters_schema_version=EXCLUDED.parameters_schema_version,
           state=EXCLUDED.state,locked_at=EXCLUDED.locked_at`,
        [state.id,turnId,participantId,slot.sequenceIndex,slot.actionType,slot.apCost,
          JSON.stringify(slot.actionPayload),slot.terminalOutcome==='RESOLVED'?'RESOLVED':planning.locked?'LOCKED':'DRAFT',planning.locked?now:null],
      );
    }
  }
};

const synchronizeCards = async (
  client: PoolClient,
  state: SetupGameState,
  participantIds: ReadonlyMap<string, string>,
): Promise<void> => {
  const deckCards: { participantId: string; cardId: string; position: number }[] = [];
  for (const card of Object.values(state.cards)) {
    if (card.controllerParticipantId === undefined) continue;
    const participantId = participantIds.get(card.controllerParticipantId);
    if (participantId === undefined) continue;
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO malign.card_instances(game_id,country_owner_definition_id,serial_template_id,
         card_definition_id,current_controller_participant_id,zone,face_state)
       SELECT $1,c.id,t.id,t.card_definition_id,$2,$3,$4
         FROM malign.country_definitions c JOIN malign.country_card_serial_templates t ON t.serial_within_country_set=$5
        WHERE c.logical_id=$6 AND c.version='0.1' AND t.registry_version_id=(SELECT card_registry_version_id FROM malign.games WHERE id=$1)
       ON CONFLICT (game_id,country_owner_definition_id,serial_template_id) DO UPDATE SET
         current_controller_participant_id=EXCLUDED.current_controller_participant_id,zone=EXCLUDED.zone,
         face_state=EXCLUDED.face_state RETURNING id`,
      [state.id,participantId,physicalCardZone(card.zone),card.zone==='HAND'?'FACE_UP':'FACE_DOWN',card.serialWithinCountrySet,card.countryOwnerId],
    );
    const physicalId = inserted.rows[0]?.id;
    if (physicalId !== undefined && card.zone === 'OPERATIONS_DECK') {
      deckCards.push({ participantId, cardId: physicalId, position: (card.zonePosition ?? deckCards.length) + 1 });
    }
  }
  await client.query('DELETE FROM malign.deck_card_positions WHERE game_id=$1', [state.id]);
  for (const card of deckCards) {
    await client.query(
      `INSERT INTO malign.deck_card_positions(game_id,participant_id,card_instance_id,position,shuffle_revision)
       VALUES ($1,$2,$3,$4,1)`, [state.id,card.participantId,card.cardId,card.position]);
  }
};

const synchronizePopulationAndInfluence = async (
  client: PoolClient,
  transition: DurableEngineTransitionV1,
  participantIds: ReadonlyMap<string, string>,
  countryIds: ReadonlyMap<string, string>,
  eventSequence: number,
  traceId: string,
): Promise<{ pdStateIds: Map<string, string>; influenceArtifactOffset: number }> => {
  const pdStateIds = new Map<string, string>();
  for (const pd of Object.values(transition.afterState.populationDemographics)) {
    const hostCountryId = countryIds.get(pd.hostCountryId);
    if (hostCountryId === undefined) continue;
    const legitimacyLogical = transition.afterState.adjudication.legitimacyByPd[pd.id];
    const legitimacyParticipantId = legitimacyLogical === null || legitimacyLogical === undefined
      ? null : participantIds.get(legitimacyLogical) ?? null;
    const row = await client.query<{ id: string }>(
      `INSERT INTO malign.population_demographic_states(game_id,scenario_pd_definition_id,
         host_country_definition_id,current_legitimacy_participant_id)
       SELECT $1,d.id,$2,$3 FROM malign.scenario_pd_definitions d
        WHERE d.scenario_definition_id=(SELECT scenario_definition_id FROM malign.games WHERE id=$1)
          AND d.logical_pd_id=$4
       ON CONFLICT (game_id,scenario_pd_definition_id) DO UPDATE SET
         current_legitimacy_participant_id=EXCLUDED.current_legitimacy_participant_id RETURNING id`,
      [transition.gameId,hostCountryId,legitimacyParticipantId,pd.id],
    );
    const id = row.rows[0]?.id;
    if (id !== undefined) pdStateIds.set(pd.id,id);
  }
  let influenceArtifactOffset = 0;
  for (const stack of transition.afterState.adjudication.influenceStacks) {
    const pdStateId = pdStateIds.get(stack.pdId);
    const attributionId = countryIds.get(stack.attributionCountryId);
    if (pdStateId === undefined || attributionId === undefined) continue;
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO malign.influence_stacks(game_id,pd_state_id,influence_type,attribution_country_definition_id,count)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (pd_state_id,influence_type,attribution_country_definition_id)
       DO NOTHING RETURNING id`, [transition.gameId,pdStateId,stack.type,attributionId,stack.count]);
    await client.query(
      `UPDATE malign.influence_stacks SET count=$5 WHERE game_id=$1 AND pd_state_id=$2
        AND influence_type=$3 AND attribution_country_definition_id=$4`,
      [transition.gameId,pdStateId,stack.type,attributionId,stack.count],
    );
    if (transition.beforeState === null && inserted.rowCount === 1 && stack.count > 0) {
      influenceArtifactOffset += 1;
      await client.query(
        `INSERT INTO malign.influence_mutations(game_id,game_event_sequence,artifact_ordinal,
           adjudication_trace_id,pd_state_id,influence_type,attribution_country_definition_id,
           delta,mutation_reason,source_entity_type,source_entity_id,resulting_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::integer,'SCENARIO_SETUP','COMMAND',$9,$8::integer)`,
        [transition.gameId,eventSequence,influenceArtifactOffset,traceId,pdStateId,stack.type,attributionId,
          stack.count,traceId],
      );
    }
  }
  return { pdStateIds, influenceArtifactOffset };
};

const synchronizeCampaigns = async (
  client: PoolClient,
  state: SetupGameState,
  participantIds: ReadonlyMap<string, string>,
  turnId: string | null,
): Promise<Map<string, string>> => {
  const campaignIds = new Map<string,string>();
  if (turnId === null) return campaignIds;
  for (const campaign of Object.values(state.adjudication.campaigns)) {
    const ownerId = participantIds.get(campaign.ownerParticipantId);
    if (ownerId === undefined) continue;
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM malign.campaigns WHERE game_id=$1 AND owner_participant_id=$2 AND row=$3 ORDER BY id LIMIT 1`,
      [state.id,ownerId,campaign.row],
    );
    let campaignId = existing.rows[0]?.id;
    const targetDtId=(await client.query<{id:string}>(
      `SELECT id FROM malign.demographic_token_definitions
        WHERE logical_id=$1 AND ruleset_version_id=(SELECT ruleset_version_id FROM malign.games WHERE id=$2)`,
      [campaign.targetDtId,state.id],
    )).rows[0]?.id;
    if(targetDtId===undefined) throw new PersistenceError('CROSS_GAME_REFERENCE','Campaign target DT is not pinned');
    if (campaignId === undefined) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO malign.campaigns(game_id,owner_participant_id,created_turn_id,row,state,
           intent_alignment,target_dt_id,activation_count_current_turn_cache)
         VALUES ($1,$2,$3,$4,'ACTIVE',$5,$6,$7) RETURNING id`,
        [state.id,ownerId,turnId,campaign.row,campaign.alignment,targetDtId,campaign.activationCountThisTurn],
      );
      campaignId = inserted.rows[0]?.id;
    } else {
      await client.query(
        `UPDATE malign.campaigns SET state='ACTIVE',intent_alignment=$3,target_dt_id=$4,
           activation_count_current_turn_cache=$5 WHERE game_id=$1 AND id=$2`,
        [state.id,campaignId,campaign.alignment,targetDtId,campaign.activationCountThisTurn],
      );
    }
    if (campaignId === undefined) continue;
    campaignIds.set(campaign.id,campaignId);
    await client.query(
      `UPDATE malign.campaign_card_assignments SET removed_turn_id=$3
        WHERE game_id=$1 AND campaign_id=$2 AND removed_turn_id IS NULL`, [state.id,campaignId,turnId]);
    for (const assignment of campaign.assignments) {
      const card = state.cards[assignment.cardInstanceId];
      if (card === undefined) continue;
      await client.query(
        `INSERT INTO malign.campaign_card_assignments(game_id,campaign_id,slot_type,card_instance_id,assigned_turn_id)
         SELECT $1,$2,$3,i.id,$4 FROM malign.card_instances i
         JOIN malign.country_definitions c ON c.id=i.country_owner_definition_id
         JOIN malign.country_card_serial_templates t ON t.id=i.serial_template_id
         WHERE i.game_id=$1 AND c.logical_id=$5 AND t.serial_within_country_set=$6`,
        [state.id,campaignId,assignment.slot,turnId,card.countryOwnerId,card.serialWithinCountrySet],
      );
    }
  }
  return campaignIds;
};

export const synchronizeNormalizedAfterImage = async (
  client: PoolClient,
  transition: DurableEngineTransitionV1,
  eventSequence: number,
  traceId: string,
  now: Date,
): Promise<NormalizedPersistenceContext> => {
  const participantIds = await synchronizeParticipants(client,transition,now);
  const countryDefinitionIds = await loadCountryDefinitions(client);
  const resourceArtifactOffset = await synchronizeSeatsAndCountries(
    client,transition,participantIds,countryDefinitionIds,eventSequence,traceId,
  );
  const {turnId,phaseStateId} = await synchronizeTurnPhaseAndInitiative(
    client,transition.afterState,participantIds,traceId,now,
  );
  await synchronizeActionPlanning(client,transition.afterState,participantIds,turnId,now);
  if (hasFamily(transition,'CARDS_ZONES_DECK') || transition.commandType === 'CREATE_GAME') {
    await synchronizeCards(client,transition.afterState,participantIds);
  }
  const {pdStateIds,influenceArtifactOffset} = await synchronizePopulationAndInfluence(
    client,transition,participantIds,countryDefinitionIds,eventSequence,traceId,
  );
  const campaignIds = await synchronizeCampaigns(client,transition.afterState,participantIds,turnId);
  return {participantIds,countryDefinitionIds,pdStateIds,turnId,phaseStateId,campaignIds,
    resourceArtifactOffset,influenceArtifactOffset};
};
