import { createHash } from 'node:crypto';

import { sha256CanonicalJson } from '@malign-ai/shared';
import {
  durableTransitionCompletenessFailures,
  type DurableAcceptedEngineResult,
  type DurableEngineTransitionV1,
} from '@malign-ai/domain';
import type { Pool, PoolClient } from 'pg';

import { PersistenceError, safeDatabaseError } from './errors.js';
import { synchronizeNormalizedAfterImage } from './normalized-state.js';
import { recoverDurableGame, type RecoveryBundle } from './recovery.js';
import { assertLeastPrivilegeRuntimeIdentity } from './runtime-identity.js';

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

export type AcceptedEngineResult = DurableAcceptedEngineResult;

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

/** @deprecated Construct transitions with buildDurableEngineTransition from the Engine boundary. */
export type AcceptedEngineTransition = DurableEngineTransitionV1;

/** Persistence-only seam for explicitly future, non-M1 fixture commands. */
export interface M2AFutureFixtureTransition {
  readonly fixtureSchemaId: 'malign.m2a-future-persistence-fixture';
  readonly gameId: string;
  readonly actorId: string;
  readonly actorParticipantId: string;
  readonly commandType: string;
  readonly idempotencyKey: string;
  readonly fingerprintSha256: string;
  readonly beforeState: Readonly<Record<string, unknown>>;
  readonly afterState: Readonly<Record<string, unknown>>;
  readonly engineResult: AcceptedEngineResult;
  readonly effects: DurableEffectBatch;
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

export interface DurableUnitOfWorkOptions {
  readonly rng?: TransactionalValueProvider<number>;
  readonly clock?: TransactionalValueProvider<Date>;
  readonly postCommitObserver?: (result: DurableCommandResult) => void | Promise<void>;
  readonly faultAt?: M2AWriteBoundary;
  /** Deterministic fault seam proving that a lost PostgreSQL CAS rolls back the transition. */
  readonly forceCasMiss?: boolean;
}

export interface DurablePersistOptions {
  /** Application-owned RNG/Clock transactions publish only after provider commit. */
  readonly deferPostCommitObserver?: boolean;
}

const assertTransition = (transition: AcceptedEngineTransition): void => {
  const failures = durableTransitionCompletenessFailures(transition);
  if (failures.length > 0) throw new PersistenceError(
    'ENGINE_TRANSITION_INCOMPLETE',
    'Durable Engine transition is incomplete or detached from its authoritative before/after state',
    { families: failures.join(',') },
  );
};

const failAt = (faultAt: M2AWriteBoundary | undefined, boundary: M2AWriteBoundary): void => {
  if (faultAt === boundary) {
    throw new PersistenceError('TRANSACTION_WRITE_FAILED', `Injected write failure at ${boundary}`, { boundary });
  }
};

const readCommittedResult = async (client: PoolClient, transition: AcceptedEngineTransition): Promise<DurableCommandResult | undefined> => {
  const existing = await client.query<{ command_fingerprint: Buffer; result_json: DurableCommandResult | null; status: string }>(
    `SELECT command_fingerprint,result_json,status FROM malign.idempotency_records
      WHERE game_id=$1 AND actor_id=$2 AND idempotency_key=$3`,
    [transition.gameId, transition.actor.actorId, transition.idempotencyKey],
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

const physicalUuid = (logicalId: string): string => {
  const digest=createHash('sha256').update(logicalId).digest('hex').slice(0,32).split('');
  digest[12]='5';
  digest[16]=((Number.parseInt(digest[16]??'0',16)&0x3)|0x8).toString(16);
  const hex=digest.join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
};

const ensureCreateRoot = async (client: PoolClient, transition: AcceptedEngineTransition): Promise<void> => {
  if (transition.commandType !== 'CREATE_GAME') return;
  const state = transition.afterState;
  const pins = await client.query<{
    ruleset_id: string;
    registry_id: string;
    engine_id: string;
    scenario_id: string;
    ert_id: string;
  }>(`
    SELECT r.id ruleset_id,registry.id registry_id,engine.id engine_id,
           scenario.id scenario_id,ert.id ert_id
      FROM malign.ruleset_versions r
      JOIN malign.card_registry_versions registry ON registry.status='ACTIVE'
      JOIN malign.engine_contract_versions engine ON engine.version=$2 AND engine.status='ACTIVE'
      JOIN malign.scenario_definitions scenario ON scenario.logical_id=$3
        AND scenario.scenario_version=$4 AND scenario.ruleset_version_id=r.id
        AND scenario.card_registry_version_id=registry.id AND scenario.status='ACTIVE'
      JOIN malign.ert_definitions ert ON ert.ruleset_version_id=r.id AND ert.status='ACTIVE'
     WHERE r.version=$1 AND r.status='ACTIVE'
     ORDER BY registry.activated_at DESC NULLS LAST,ert.id LIMIT 1
  `,[state.versions.rulesetVersion,state.versions.engineContractVersion,state.scenarioId,state.versions.scenarioVersion]);
  const pin = pins.rows[0];
  if (pin === undefined) throw new PersistenceError(
    'REFERENCE_CONSTRAINT_VIOLATION',
    'Approved BASE_2025 registry, scenario, ERT and version pins must be seeded before CREATE_GAME',
  );
  await client.query(
    `INSERT INTO malign.games(id,name,status,ruleset_version_id,scenario_definition_id,
       card_registry_version_id,engine_contract_version_id,ert_definition_id,turn_limit,dice_mode,
       game_version,event_sequence_head,outbox_sequence_head,authoritative_state_json,gameplay_state_hash)
     VALUES ($1,$2,'SETUP',$3,$4,$5,$6,$7,$8,$9,0,0,0,'{}'::jsonb,decode($10,'hex'))
     ON CONFLICT (id) DO NOTHING`,
    [transition.gameId,`Game ${transition.gameId}`,pin.ruleset_id,pin.scenario_id,pin.registry_id,
      pin.engine_id,pin.ert_id,state.turnLimit,state.diceMode,sha256CanonicalJson({})],
  );
};

const ensureActorPhysicalParticipant = async (
  client: PoolClient,
  transition: AcceptedEngineTransition,
  now: Date,
): Promise<string | null> => {
  if (transition.actor.participantId === null) return null;
  const participant = transition.afterState.participants[transition.actor.participantId];
  if (participant === undefined) throw new PersistenceError('CROSS_GAME_REFERENCE','Actor participant is absent from after-state');
  const row = await client.query<{ id: string }>(
    `INSERT INTO malign.game_participants(game_id,external_user_ref,role,status,joined_at)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (game_id,external_user_ref) DO UPDATE SET
       role=EXCLUDED.role,status=EXCLUDED.status RETURNING id`,
    [transition.gameId,participant.userId,participant.role,participant.status,now],
  );
  return row.rows[0]?.id ?? null;
};

const synchronizeActionResolutions = async (
  client: PoolClient,
  transition: AcceptedEngineTransition,
  participantIds: ReadonlyMap<string,string>,
  turnId: string | null,
  traceId: string,
  now: Date,
): Promise<ReadonlyMap<string,string>> => {
  const resolutions=new Map<string,string>();
  if(turnId===null)return resolutions;
  const pending=transition.afterState.adjudication.pendingResolution;
  for(const [logicalParticipantId,planning] of Object.entries(transition.afterState.actionPlanning)) {
    const participantId=participantIds.get(logicalParticipantId);
    if(participantId===undefined)continue;
    for(const slot of planning.lockedSlots) {
      const isPending=pending?.participantId===logicalParticipantId&&pending.sequenceIndex===slot.sequenceIndex;
      if(slot.terminalOutcome===undefined&&!isPending)continue;
      const planned=await client.query<{id:string}>(
        `SELECT id FROM malign.planned_actions WHERE game_id=$1 AND turn_id=$2 AND participant_id=$3
          AND sequence_within_player=$4`,[transition.gameId,turnId,participantId,slot.sequenceIndex]);
      const plannedActionId=planned.rows[0]?.id;
      if(plannedActionId===undefined)throw new PersistenceError('CONTINUATION_INVALID','Resolved action is missing its durable plan');
      const initiativePosition=transition.afterState.initiative.orderParticipantIds.indexOf(logicalParticipantId)+1;
      if(initiativePosition<1)throw new PersistenceError('ENGINE_TRANSITION_INCOMPLETE','Resolved action has no initiative position');
      const status=isPending?'SUSPENDED':'RESOLVED';
      const resolution=await client.query<{id:string}>(
        `INSERT INTO malign.action_resolutions(game_id,planned_action_id,initiative_position,
           resolution_status,adjudication_trace_id,started_at,ended_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (planned_action_id) DO UPDATE SET
           resolution_status=CASE WHEN malign.action_resolutions.resolution_status='RESOLVED'
             THEN malign.action_resolutions.resolution_status ELSE EXCLUDED.resolution_status END,
           adjudication_trace_id=CASE WHEN malign.action_resolutions.resolution_status='RESOLVED'
             THEN malign.action_resolutions.adjudication_trace_id ELSE EXCLUDED.adjudication_trace_id END,
           ended_at=CASE WHEN malign.action_resolutions.resolution_status='RESOLVED'
             THEN malign.action_resolutions.ended_at ELSE EXCLUDED.ended_at END RETURNING id`,
        [transition.gameId,plannedActionId,initiativePosition,status,traceId,now,status==='RESOLVED'?now:null]);
      const resolutionId=resolution.rows[0]?.id;
      if(resolutionId!==undefined)resolutions.set(`${logicalParticipantId}:${slot.sequenceIndex}`,resolutionId);
    }
  }
  return resolutions;
};

const synchronizeM1AdjudicationArtifacts = async (
  client:PoolClient,
  transition:AcceptedEngineTransition,
  context:Awaited<ReturnType<typeof synchronizeNormalizedAfterImage>>,
  actionResolutions:ReadonlyMap<string,string>,
  dieRollIds:ReadonlyMap<string,string>,
  traceId:string,
  now:Date,
):Promise<string|null>=>{
  const pending=transition.afterState.adjudication.pendingResolution;
  // Regime manual-die requests are adjudication artifacts, but they are not
  // campaign activations and therefore must never be interpreted through the
  // campaign continuation shape below.
  const campaignPending=pending?.kind==='REGIME_MANUAL_DIE'?undefined:pending;
  const engineTrace=transition.traces.at(-1);
  const participantLogical=engineTrace?.participantId??campaignPending?.participantId;
  const sequenceIndex=engineTrace?.sequenceIndex??campaignPending?.sequenceIndex;
  const campaignLogical=engineTrace?.campaignId??campaignPending?.campaignId;
  if(participantLogical===undefined||sequenceIndex===undefined||campaignLogical===undefined||context.turnId===null)return null;
  const participantId=context.participantIds.get(participantLogical);
  const campaignId=context.campaignIds.get(campaignLogical);
  const sourceResolutionId=actionResolutions.get(`${participantLogical}:${sequenceIndex}`);
  const targetPdLogical=engineTrace?.targetPdId??campaignPending?.continuation.targetPdId;
  const targetPdStateId=targetPdLogical===undefined?undefined:context.pdStateIds.get(targetPdLogical);
  const campaign=transition.afterState.adjudication.campaigns[campaignLogical];
  const targetDtLogical=engineTrace?.targetDtId??campaign?.targetDtId;
  if(participantId===undefined||campaignId===undefined||sourceResolutionId===undefined||
      targetPdStateId===undefined||targetDtLogical===undefined) {
    throw new PersistenceError('ENGINE_TRANSITION_INCOMPLETE','Campaign adjudication artifact scope is incomplete');
  }
  const targetDtId=(await client.query<{id:string}>(
    `SELECT id FROM malign.demographic_token_definitions WHERE logical_id=$1
      AND ruleset_version_id=(SELECT ruleset_version_id FROM malign.games WHERE id=$2)`,
    [targetDtLogical,transition.gameId])).rows[0]?.id;
  if(targetDtId===undefined)throw new PersistenceError('CROSS_GAME_REFERENCE','Activation target DT is not pinned');
  const continuation=campaignPending?.continuation;
  const baseCv=engineTrace?.baseCv??continuation?.baseCv;
  const effectiveCv=engineTrace?.effectiveCv??continuation?.effectiveCv;
  const baseTier=engineTrace?.baseTier??continuation?.baseTier;
  const resolutionTier=engineTrace?.resolutionTier??continuation?.resolutionTier;
  const resourceCost=engineTrace?.resourceCost??continuation?.resourceCost;
  if(baseCv===undefined||effectiveCv===undefined||baseTier===undefined||resolutionTier===undefined||resourceCost===undefined)
    throw new PersistenceError('ENGINE_TRANSITION_INCOMPLETE','Campaign activation values are incomplete');
  const ordinal=Math.max(1,campaign?.activationCountThisTurn??1);
  const existing=await client.query<{id:string}>(
    `SELECT id FROM malign.campaign_activations WHERE campaign_id=$1 AND turn_id=$2
      ORDER BY activation_ordinal DESC LIMIT 1`,[campaignId,context.turnId]);
  const activationIdentity=engineTrace?.activationId??
    (campaignPending?.kind==='CHOICE'?campaignPending.continuation.activationId:campaignPending?.resolutionId);
  const dieEvent=activationIdentity===undefined?undefined:transition.afterState.events.find((event)=>
    event.eventType==='DIE_ROLLED'&&event.payload['activationId']===activationIdentity);
  const logicalDieRollId=typeof dieEvent?.payload['dieRollId']==='string'?dieEvent.payload['dieRollId']:undefined;
  const dieRollId=logicalDieRollId===undefined?null:dieRollIds.get(logicalDieRollId)??null;
  if(engineTrace!==undefined&&dieRollId===null)
    throw new PersistenceError('ENGINE_TRANSITION_INCOMPLETE','Campaign trace has no unambiguous RNG request identity');
  const values=[transition.gameId,context.turnId,participantId,campaignId,sourceResolutionId,ordinal,
    targetPdStateId,targetDtId,baseCv,effectiveCv,baseTier,resolutionTier,resourceCost,
    engineTrace?.modifiedRollRaw??null,engineTrace?.ertRoll??null,engineTrace?.ertResult??null,
    engineTrace===undefined?'PENDING': 'RESOLVED',traceId,dieRollId,
    engineTrace===undefined?0:engineTrace.modifiedRollRaw-engineTrace.rawRoll];
  let activationId=existing.rows[0]?.id;
  if(activationId===undefined) {
    activationId=(await client.query<{id:string}>(
      `INSERT INTO malign.campaign_activations(game_id,turn_id,participant_id,campaign_id,planned_action_id,
         activation_ordinal,activation_source,target_pd_state_id,target_dt_id,base_cv,effective_cv,cost_tier,
         resolution_tier,tier_resource_cost,card_resource_cost,total_resource_cost,legitimacy_roll_bonus,
         roll_boost_spent,die_roll_id,modified_roll_raw,ert_lookup_roll,ert_result,outcome_type,adjudication_trace_id)
       VALUES ($1,$2,$3,$4,$5,$6,'ACTION_PLAN',$7,$8,$9,$10,$11,$12,$13,0,$13,$20,false,$19,$14,$15,$16,$17,$18)
       RETURNING id`,values)).rows[0]?.id;
  } else {
    await client.query(
      `UPDATE malign.campaign_activations SET base_cv=$1,effective_cv=$2,cost_tier=$3,resolution_tier=$4,
         tier_resource_cost=$5,card_resource_cost=0,total_resource_cost=$5,legitimacy_roll_bonus=$6,
         die_roll_id=$7,modified_roll_raw=$8,ert_lookup_roll=$9,ert_result=$10,outcome_type=$11,
         adjudication_trace_id=$12 WHERE id=$13`,[baseCv,effectiveCv,baseTier,resolutionTier,resourceCost,
        engineTrace===undefined?0:engineTrace.modifiedRollRaw-engineTrace.rawRoll,dieRollId,
        engineTrace?.modifiedRollRaw??null,engineTrace?.ertRoll??null,engineTrace?.ertResult??null,
        engineTrace===undefined?'PENDING':'RESOLVED',traceId,activationId]);
  }
  if(activationId===undefined)throw new PersistenceError('TRANSACTION_WRITE_FAILED','Campaign activation identity is missing');
  if(pending?.kind==='NARRATIVE') {
    await client.query(
      `INSERT INTO malign.narrative_requests(game_id,campaign_activation_id,actor_participant_id,status,
         visibility_scope,request_schema_id,request_schema_version,opened_at)
       VALUES ($1,$2,$3,'OPEN',$4,'malign.narrative-request','1.0',$5)
       ON CONFLICT (campaign_activation_id) WHERE status='OPEN' DO NOTHING`,
      [transition.gameId,activationId,participantId,pending.narrativeRequest.visibilityScope,now]);
  }
  return activationId;
};

const synchronizeRegimeAbilityActivation = async (
  client:PoolClient,
  transition:AcceptedEngineTransition,
  context:Awaited<ReturnType<typeof synchronizeNormalizedAfterImage>>,
  dieRollIds:ReadonlyMap<string,string>,
  traceId:string,
):Promise<void>=>{
  if(context.turnId===null)return;
  const activated=Object.values(transition.afterState.participants).find(({id,role})=>role==='PLAYER'&&
    transition.afterState.regimeAbilityUsedByParticipant?.[id]===true&&
    transition.beforeState?.regimeAbilityUsedByParticipant?.[id]!==true);
  if(activated===undefined)return;
  const participantId=context.participantIds.get(activated.id);
  const countryId=transition.afterState.seats[activated.id]?.countryId;
  if(participantId===undefined||countryId===undefined)
    throw new PersistenceError('CROSS_GAME_REFERENCE','Regime activation participant scope is invalid');
  const resolvedEvent=transition.events.find(({eventType,payload})=>eventType==='ACTION_RESOLVED'&&
    payload['participantId']===activated.id);
  const sequenceIndex=resolvedEvent?.payload['sequenceIndex'];
  if(typeof sequenceIndex!=='number'||!Number.isInteger(sequenceIndex))
    throw new PersistenceError('ENGINE_TRANSITION_INCOMPLETE','Regime activation has no resolved planned action');
  const plannedActionId=(await client.query<{id:string}>(
    `SELECT id FROM malign.planned_actions WHERE game_id=$1 AND turn_id=$2 AND participant_id=$3
       AND sequence_within_player=$4 AND action_type='USE_REGIME_ABILITY'`,
    [transition.gameId,context.turnId,participantId,sequenceIndex])).rows[0]?.id;
  const abilityDefinitionId=(await client.query<{id:string}>(
    `SELECT r.id FROM malign.regime_ability_definitions r JOIN malign.games g ON g.ruleset_version_id=r.ruleset_version_id
       WHERE g.id=$1 AND r.logical_id=$2 AND r.status='ACTIVE'`,
    [transition.gameId,`REGIME_EFFECT_${countryId}`])).rows[0]?.id;
  if(plannedActionId===undefined||abilityDefinitionId===undefined)
    throw new PersistenceError('ENGINE_TRANSITION_INCOMPLETE','Regime activation definition or planned action is missing');
  const transitionDie=[...dieRollIds.values()].at(-1);
  const dieRollId=transitionDie??(await client.query<{id:string}>(
    `SELECT id FROM malign.die_rolls WHERE game_id=$1 AND turn_id=$2 AND participant_id=$3
       AND source_type='REGIME_ABILITY' ORDER BY created_at DESC,id DESC LIMIT 1`,
    [transition.gameId,context.turnId,participantId])).rows[0]?.id??null;
  const influenceTarget=transition.ledgers.influence.at(-1)?.pdId;
  const legitimacyTarget=transition.ledgers.legitimacy.at(-1)?.pdId;
  const targetLogical=influenceTarget??legitimacyTarget;
  const targetPdStateId=targetLogical===undefined?null:context.pdStateIds.get(targetLogical)??null;
  await client.query(
    `INSERT INTO malign.regime_ability_activations(game_id,turn_id,participant_id,ability_definition_id,
       planned_action_id,die_roll_id,target_pd_state_id,adjudication_trace_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (turn_id,participant_id,ability_definition_id) DO NOTHING`,
    [transition.gameId,context.turnId,participantId,abilityDefinitionId,plannedActionId,dieRollId,targetPdStateId,traceId]);
};

const synchronizeGameOutcome = async (
  client:PoolClient,
  transition:AcceptedEngineTransition,
  context:Awaited<ReturnType<typeof synchronizeNormalizedAfterImage>>,
  now:Date,
):Promise<void>=>{
  const outcome=transition.afterState.endGame?.outcome;
  if(outcome===undefined||context.turnId===null)return;
  const turnNumber=(await client.query<{turn_number:number}>(
    `SELECT turn_number FROM malign.turns WHERE game_id=$1 AND id=$2`,[transition.gameId,context.turnId])).rows[0]?.turn_number;
  if(turnNumber===undefined)throw new PersistenceError('ENGINE_TRANSITION_INCOMPLETE','Completed game has no durable turn');
  await client.query(`INSERT INTO malign.game_outcomes(game_id,completed_turn,shared_tie,tiebreak_stage,
    final_scores_json,scores_schema_id,scores_schema_version,completed_at)
    VALUES ($1,$2,$3,'LEAST_OWN_COUNTRY_MALIGN',$4::jsonb,'malign.final-scores','0.1',$5)
    ON CONFLICT (game_id) DO NOTHING`,
  [transition.gameId,turnNumber,outcome.sharedVictory,JSON.stringify(outcome.scores),now]);
  for(const [index,logicalParticipantId] of outcome.winnerParticipantIds.entries()) {
    const participantId=context.participantIds.get(logicalParticipantId);
    if(participantId===undefined)throw new PersistenceError('CROSS_GAME_REFERENCE','Outcome winner is outside the game');
    await client.query(`INSERT INTO malign.game_outcome_winners(game_id,participant_id,rank) VALUES ($1,$2,$3)
      ON CONFLICT (game_id,participant_id) DO NOTHING`,
      [transition.gameId,participantId,index+1]);
  }
  for(const award of transition.afterState.endGame?.objectiveAwards??[]) {
    const participantId=context.participantIds.get(award.participantId);
    if(participantId===undefined)throw new PersistenceError('CROSS_GAME_REFERENCE','Objective award participant is outside the game');
    const definitionId=(await client.query<{id:string}>(`SELECT v.id FROM malign.victory_objective_definitions v
      JOIN malign.games g ON g.scenario_definition_id=v.scenario_definition_id
      WHERE g.id=$1 AND v.logical_id=$2`,[transition.gameId,award.objectiveLogicalId])).rows[0]?.id;
    if(definitionId===undefined)throw new PersistenceError('ENGINE_TRANSITION_INCOMPLETE','Objective definition is not pinned');
    await client.query(`INSERT INTO malign.victory_objective_awards(game_id,objective_definition_id,participant_id,
      vp_awarded,evaluation_snapshot_json,snapshot_schema_id,snapshot_schema_version,awarded_at)
      VALUES ($1,$2,$3,$4,$5::jsonb,'malign.objective-evaluation','0.1',$6)
      ON CONFLICT (game_id,objective_definition_id,participant_id) DO NOTHING`,
    [transition.gameId,definitionId,participantId,award.vpAwarded,JSON.stringify(award.evaluation),now]);
  }
};

export class PostgresDurableUnitOfWork {
  constructor(private readonly pool: Pool, private readonly options: DurableUnitOfWorkOptions = {}) {}

  recover(gameId:string):Promise<RecoveryBundle> { return recoverDurableGame(this.pool,gameId); }

  /** Allocates the authoritative physical Game PK inside PostgreSQL 18.6. */
  async allocateGameId(): Promise<string> {
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      await client.query('SET LOCAL ROLE malign_app_runtime');
      await assertLeastPrivilegeRuntimeIdentity(client,'malign_app_runtime');
      const id=(await client.query<{id:string}>('SELECT uuidv7()::text id')).rows[0]?.id;
      if(id===undefined)throw new PersistenceError('DATABASE_UNAVAILABLE','PostgreSQL did not allocate a Game identity');
      await client.query('COMMIT');
      return id;
    } catch(error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async resolvePhysicalParticipantId(gameId: string, externalUserRef: string): Promise<string | undefined> {
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      await client.query('SET LOCAL ROLE malign_app_runtime');
      await assertLeastPrivilegeRuntimeIdentity(client,'malign_app_runtime');
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
      await assertLeastPrivilegeRuntimeIdentity(client,'malign_app_runtime');
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

  async persistM2AFutureFixtureTransition(transition: M2AFutureFixtureTransition): Promise<DurableCommandResult> {
    if (transition.fixtureSchemaId !== 'malign.m2a-future-persistence-fixture' ||
        !/^[a-f0-9]{64}$/.test(transition.fingerprintSha256) ||
        transition.engineResult.status !== 'RESOLVED' ||
        transition.engineResult.gameVersionAfter !== transition.engineResult.gameVersionBefore + 1) {
      throw new PersistenceError('ENGINE_TRANSITION_REQUIRED','Future persistence fixture transition is invalid');
    }
    const rngCheckpoint=this.options.rng?.checkpoint();
    const clockCheckpoint=this.options.clock?.checkpoint();
    const client=await this.pool.connect();
    let committed=false;
    const fixtureFail=(boundary:M2AWriteBoundary):void=>failAt(transition.faultAt??this.options.faultAt,boundary);
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query('SET LOCAL ROLE malign_app_runtime');
      const identity=await assertLeastPrivilegeRuntimeIdentity(client,'malign_app_runtime');
      const game=(await client.query<LockedGame>(`SELECT game_version,event_sequence_head,outbox_sequence_head,
        recovery_blocked,ruleset_version_id,scenario_definition_id,card_registry_version_id,
        engine_contract_version_id,ert_definition_id,gameplay_state_hash FROM malign.games WHERE id=$1 FOR UPDATE`,
      [transition.gameId])).rows[0];
      if(!game)throw new PersistenceError('GAME_NOT_FOUND','Game does not exist');
      if(game.recovery_blocked)throw new PersistenceError('GAME_RECOVERY_BLOCKED','Game is blocked');
      const existing=await client.query<{command_fingerprint:Buffer;result_json:DurableCommandResult|null;status:string}>(
        `SELECT command_fingerprint,result_json,status FROM malign.idempotency_records
          WHERE game_id=$1 AND actor_id=$2 AND idempotency_key=$3`,
        [transition.gameId,transition.actorId,transition.idempotencyKey]);
      const prior=existing.rows[0];
      if(prior){
        if(prior.command_fingerprint.toString('hex')!==transition.fingerprintSha256)
          throw new PersistenceError('IDEMPOTENCY_CONFLICT','Idempotency key conflict');
        if(prior.status==='COMMITTED'&&prior.result_json){await client.query('COMMIT');committed=true;return prior.result_json;}
      }
      const versionBefore=Number(game.game_version);
      if(versionBefore!==transition.engineResult.gameVersionBefore ||
          versionBefore!==Number(transition.beforeState['version']) ||
          sha256CanonicalJson(transition.beforeState)!==game.gameplay_state_hash.toString('hex'))
        throw new PersistenceError('GAME_VERSION_CONFLICT','Future fixture before-state is stale');
      const actor=(await client.query(`SELECT 1 FROM malign.game_participants WHERE game_id=$1 AND id=$2
        AND status='ACTIVE'`,[transition.gameId,transition.actorParticipantId])).rowCount;
      if(actor!==1)throw new PersistenceError('CROSS_GAME_REFERENCE','Future fixture actor is outside game');
      const now=this.options.clock?.next()??new Date(transition.engineResult.resolvedAt);
      const sequence=Number(game.event_sequence_head)+1;
      const outboxSequence=Number(game.outbox_sequence_head)+1;
      const stateHash=sha256CanonicalJson(transition.afterState);
      const traceId=(await client.query<{id:string}>(`INSERT INTO malign.adjudication_traces(
        game_id,game_event_sequence,artifact_ordinal,participant_id,trace_type,source_action_id,
        pre_state_hash,post_state_hash,input_snapshot_json,rule_evaluation_json,output_snapshot_json,
        trace_schema_id,trace_schema_version,correlation_id,causation_id)
        VALUES ($1,$2,1,$3,'M2A_FUTURE_FIXTURE',$4,$5,decode($6,'hex'),$7::jsonb,$8::jsonb,$9::jsonb,
        'malign.adjudication-trace','0.2',$4,$4) RETURNING id`,
      [transition.gameId,sequence,transition.actorParticipantId,physicalUuid(transition.engineResult.commandId),
        game.gameplay_state_hash,stateHash,JSON.stringify(transition.beforeState),
        JSON.stringify({fixtureScope:'FUTURE_ONLY',resultCode:transition.engineResult.resultCode}),
        JSON.stringify(transition.afterState)])).rows[0]?.id;
      if(!traceId)throw new PersistenceError('TRANSACTION_WRITE_FAILED','Future fixture trace missing');
      fixtureFail('trace');
      await client.query(`INSERT INTO malign.idempotency_records(game_id,actor_id,idempotency_key,command_id,
        command_fingerprint,command_type,status,game_version_before)
        VALUES ($1,$2,$3,$4,decode($5,'hex'),$6,'INTERNAL_PENDING',$7)`,
      [transition.gameId,transition.actorId,transition.idempotencyKey,physicalUuid(transition.engineResult.commandId),
        transition.fingerprintSha256,transition.commandType,versionBefore]);
      await client.query(`UPDATE malign.games SET authoritative_state_json=$2::jsonb,
        gameplay_state_hash=decode($3,'hex') WHERE id=$1`,[transition.gameId,JSON.stringify(transition.afterState),stateHash]);
      fixtureFail('normalized_state');
      for(const [index,effect] of (transition.effects.actionPoints??[]).entries()){
        requireNonZeroInteger(effect.delta,'AP delta');
        const row=(await client.query<{remaining:number;last_transaction_sequence:string}>(effect.delta>0
          ?`UPDATE malign.action_point_balances SET allocated=allocated+$4,remaining=remaining+$4,
             last_transaction_sequence=last_transaction_sequence+1 WHERE game_id=$1 AND turn_id=$2 AND participant_id=$3
             RETURNING remaining,last_transaction_sequence`
          :`UPDATE malign.action_point_balances SET spent=spent-$4,remaining=remaining+$4,
             last_transaction_sequence=last_transaction_sequence+1 WHERE game_id=$1 AND turn_id=$2 AND participant_id=$3
             AND remaining+$4>=0 RETURNING remaining,last_transaction_sequence`,
          [transition.gameId,effect.turnId,effect.participantId,effect.delta])).rows[0];
        if(!row)throw new PersistenceError('NEGATIVE_BALANCE','AP fixture effect rejected');fixtureFail('ap_balance');
        await client.query(`INSERT INTO malign.action_point_transactions(game_id,game_event_sequence,artifact_ordinal,
          turn_id,participant_id,sequence_number,delta,reason_type,source_entity_type,source_entity_id,
          correlation_id,adjudication_trace_id,balance_after)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'COMMAND',$9,$9,$10,$11)`,
        [transition.gameId,sequence,index+1,effect.turnId,effect.participantId,row.last_transaction_sequence,
          effect.delta,effect.reasonType,physicalUuid(transition.engineResult.commandId),traceId,row.remaining]);fixtureFail('ap_journal');
      }
      for(const [index,effect] of (transition.effects.resources??[]).entries()){
        requireNonZeroInteger(effect.delta,'Resource delta');
        const balance=(await client.query<{current_resources_cache:number}>(`UPDATE malign.game_countries
          SET current_resources_cache=current_resources_cache+$3 WHERE game_id=$1 AND controlling_participant_id=$2
          AND current_resources_cache+$3>=0 RETURNING current_resources_cache`,
        [transition.gameId,effect.participantId,effect.delta])).rows[0]?.current_resources_cache;
        if(balance===undefined)throw new PersistenceError('NEGATIVE_BALANCE','Resource fixture effect rejected');
        await client.query(`INSERT INTO malign.resource_transactions(game_id,game_event_sequence,artifact_ordinal,
          turn_id,participant_id,delta,reason_type,source_entity_type,source_entity_id,counterparty_participant_id,
          adjudication_trace_id,balance_after) VALUES ($1,$2,$3,$4,$5,$6,$7,'COMMAND',$8,$9,$10,$11)`,
        [transition.gameId,sequence,index+1,effect.turnId??null,effect.participantId,effect.delta,effect.reasonType,
          physicalUuid(transition.engineResult.commandId),effect.counterpartyParticipantId??null,traceId,balance]);fixtureFail('resources');
      }
      for(const [index,effect] of (transition.effects.victoryPoints??[]).entries()){
        requireNonZeroInteger(effect.delta,'VP delta');
        const balance=(await client.query<{current_vp_cache:number}>(`UPDATE malign.game_countries
          SET current_vp_cache=current_vp_cache+$3 WHERE game_id=$1 AND controlling_participant_id=$2
          AND current_vp_cache+$3>=0 RETURNING current_vp_cache`,[transition.gameId,effect.participantId,effect.delta])).rows[0]?.current_vp_cache;
        if(balance===undefined)throw new PersistenceError('NEGATIVE_BALANCE','VP fixture effect rejected');
        await client.query(`INSERT INTO malign.vp_transactions(game_id,game_event_sequence,artifact_ordinal,turn_id,
          participant_id,delta,balance_after,reason_type,source_entity_type,source_entity_id,adjudication_trace_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'COMMAND',$9,$10)`,
        [transition.gameId,sequence,index+1,effect.turnId??null,effect.participantId,effect.delta,balance,
          effect.reasonType,physicalUuid(transition.engineResult.commandId),traceId]);fixtureFail('vp');
      }
      for(const [index,effect] of (transition.effects.influence??[]).entries()){
        requireNonZeroInteger(effect.delta,'Influence delta');
        const count=(await client.query<{count:number}>(`UPDATE malign.influence_stacks SET count=count+$5
          WHERE game_id=$1 AND pd_state_id=$2 AND influence_type=$3 AND attribution_country_definition_id=$4
          AND count+$5>=0 RETURNING count`,[transition.gameId,effect.pdStateId,effect.influenceType,
          effect.attributionCountryDefinitionId,effect.delta])).rows[0]?.count;
        if(count===undefined)throw new PersistenceError('NEGATIVE_BALANCE','Influence fixture effect rejected');
        await client.query(`INSERT INTO malign.influence_mutations(game_id,game_event_sequence,artifact_ordinal,turn_id,
          pd_state_id,influence_type,attribution_country_definition_id,delta,mutation_reason,source_entity_type,
          source_entity_id,adjudication_trace_id,resulting_count)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'COMMAND',$10,$11,$12)`,
        [transition.gameId,sequence,index+1,effect.turnId??null,effect.pdStateId,effect.influenceType,
          effect.attributionCountryDefinitionId,effect.delta,effect.reasonType,physicalUuid(transition.engineResult.commandId),traceId,count]);fixtureFail('influence');
      }
      for(const [index,effect] of (transition.effects.legitimacy??[]).entries()){
        const changed=await client.query(`UPDATE malign.population_demographic_states
          SET current_legitimacy_participant_id=$4 WHERE game_id=$1 AND id=$2
          AND current_legitimacy_participant_id IS NOT DISTINCT FROM $3`,
        [transition.gameId,effect.pdStateId,effect.previousParticipantId,effect.newParticipantId]);
        if(changed.rowCount!==1)throw new PersistenceError('CROSS_GAME_REFERENCE','Legitimacy fixture target invalid');
        await client.query(`INSERT INTO malign.legitimacy_events(game_id,game_event_sequence,artifact_ordinal,turn_id,
          pd_state_id,previous_participant_id,new_participant_id,reason_type,adjudication_trace_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[transition.gameId,sequence,index+1,effect.turnId??null,
          effect.pdStateId,effect.previousParticipantId,effect.newParticipantId,effect.reasonType,traceId]);
        await client.query(`UPDATE malign.game_countries c SET legitimacy_count_cache=(SELECT count(*)::int
          FROM malign.population_demographic_states p WHERE p.game_id=c.game_id
          AND p.current_legitimacy_participant_id=c.controlling_participant_id) WHERE c.game_id=$1`,[transition.gameId]);
        fixtureFail('legitimacy');
      }
      for(const effect of transition.effects.dieRolls??[]){
        const rawValue=effect.rawValue??this.options.rng?.next();
        if(rawValue===undefined||!Number.isInteger(rawValue)||rawValue<1||rawValue>10)
          throw new PersistenceError('ENGINE_TRANSITION_REQUIRED','Fixture die roll is invalid');
        await client.query(`INSERT INTO malign.die_rolls(game_id,turn_id,participant_id,die_type,mode,raw_value,
          source_type,source_entity_id,rng_metadata_json,rng_schema_id,rng_schema_version,created_at)
          VALUES ($1,$2,$3,'D10','DETERMINISTIC',$4,$5,$6,$7::jsonb,'malign.rng','0.2',$8)`,
        [transition.gameId,effect.turnId,effect.participantId,rawValue,effect.sourceType,
          physicalUuid(transition.engineResult.commandId),JSON.stringify({cursor:rngCheckpoint??0}),now]);fixtureFail('rng_record');
      }
      const eventId=(await client.query<{id:string}>(`INSERT INTO malign.game_events(game_id,sequence_number,event_type,
        actor_participant_id,subject_type,subject_id,payload_json,payload_schema_id,payload_schema_version,
        visibility_class,adjudication_trace_id,correlation_id,causation_id,state_hash_after,occurred_at)
        VALUES ($1,$2,$3,$4,'GAME',$1,$5::jsonb,'malign.game-transition','0.2','GAME',$6,$7,$7,
        decode($8,'hex'),$9) RETURNING id`,[transition.gameId,sequence,transition.commandType,
        transition.actorParticipantId,JSON.stringify({reducer:{type:'REPLACE_SETUP_STATE',version:'0.1',stateAfter:transition.afterState},
          commandResult:transition.engineResult}),traceId,physicalUuid(transition.engineResult.commandId),stateHash,now])).rows[0]?.id;
      if(!eventId)throw new PersistenceError('TRANSACTION_WRITE_FAILED','Future fixture event missing');fixtureFail('event');
      if(transition.continuation){
        const hash=sha256CanonicalJson(transition.continuation.state);
        await client.query(`INSERT INTO malign.pending_resolutions(game_id,source_resolution_id,continuation_type,
          continuation_state_json,continuation_schema_id,continuation_schema_version,waiting_interaction_type,
          waiting_interaction_id,status,ruleset_version_id,engine_contract_version_id,state_hash)
          VALUES ($1,$2,$3,$4::jsonb,'malign.continuation','0.2','CHOICE',$5,'OPEN',$6,$7,decode($8,'hex'))`,
        [transition.gameId,transition.continuation.sourceResolutionId,transition.continuation.type,
          JSON.stringify(transition.continuation.state),transition.continuation.waitingInteractionId,
          game.ruleset_version_id,game.engine_contract_version_id,hash]);
      }fixtureFail('continuation');
      if(transition.captureSnapshot)await client.query(`INSERT INTO malign.game_snapshots(game_id,game_version,
        last_event_sequence,snapshot_json,snapshot_schema_id,snapshot_schema_version,canonical_jcs_sha256,
        gameplay_state_hash,ruleset_version_id,scenario_definition_id,card_registry_version_id,
        engine_contract_version_id,created_at) VALUES ($1,$2,$3,$4::jsonb,'malign.game-state','0.2',
        decode($5,'hex'),decode($5,'hex'),$6,$7,$8,$9,$10)`,[transition.gameId,
        transition.engineResult.gameVersionAfter,sequence,JSON.stringify(transition.afterState),stateHash,
        game.ruleset_version_id,game.scenario_definition_id,game.card_registry_version_id,
        game.engine_contract_version_id,now]);fixtureFail('snapshot');
      const result:DurableCommandResult={commandId:transition.engineResult.commandId,gameId:transition.gameId,
        gameVersion:transition.engineResult.gameVersionAfter,eventSequence:sequence,outboxSequence,eventId,traceId,
        replayed:false,sessionUser:identity.sessionUser,currentUser:'malign_app_runtime',engineResult:transition.engineResult};
      await client.query(`UPDATE malign.idempotency_records SET status='COMMITTED',game_version_after=$4,
        result_json=$5::jsonb,result_schema_id='malign.command-result',result_schema_version='0.2',completed_at=$6
        WHERE game_id=$1 AND actor_id=$2 AND idempotency_key=$3`,[transition.gameId,transition.actorId,
        transition.idempotencyKey,transition.engineResult.gameVersionAfter,JSON.stringify(result),now]);fixtureFail('idempotency');
      const outboxId=(await client.query<{id:string}>(`INSERT INTO malign.outbox_messages(game_id,outbox_sequence,
        event_id,topic,audience_class,payload_json,payload_schema_id,payload_schema_version,correlation_id,
        deduplication_key,created_at) VALUES ($1,$2,$3,'GAME_EVENT','GAME',$4::jsonb,
        'malign.authorized-projection','0.2',$5,$6,$7) RETURNING id`,[transition.gameId,outboxSequence,eventId,
        JSON.stringify({eventId,eventSequence:sequence,gameVersion:transition.engineResult.gameVersionAfter}),
        physicalUuid(transition.engineResult.commandId),`${transition.gameId}:${sequence}:GAME`,now])).rows[0]?.id;
      if(!outboxId)throw new PersistenceError('TRANSACTION_WRITE_FAILED','Future fixture outbox missing');fixtureFail('outbox_message');
      await client.query(`INSERT INTO malign.outbox_delivery_states(outbox_message_id,delivery_status,next_attempt_at)
        VALUES ($1,'PENDING',$2)`,[outboxId,now]);fixtureFail('delivery_state');
      const cas=await client.query(`UPDATE malign.games SET game_version=$3,event_sequence_head=$4,
        outbox_sequence_head=$5 WHERE id=$1 AND game_version=$2`,[transition.gameId,
        this.options.forceCasMiss?versionBefore+1:versionBefore,
        transition.engineResult.gameVersionAfter,sequence,outboxSequence]);
      if(cas.rowCount!==1)throw new PersistenceError('GAME_VERSION_CONFLICT','Fixture CAS lost');
      await client.query('COMMIT');committed=true;return result;
    }catch(error){
      if(!committed){try{await client.query('ROLLBACK');}catch{/* transaction already failed */}}
      if(rngCheckpoint!==undefined)this.options.rng?.restore(rngCheckpoint);
      if(clockCheckpoint!==undefined)this.options.clock?.restore(clockCheckpoint);
      if(error instanceof PersistenceError)throw error;throw safeDatabaseError(error);
    }finally{client.release();}
  }

  async publishCommittedTransition(result: DurableCommandResult): Promise<void> {
    try { await this.options.postCommitObserver?.(result); } catch { /* durable outbox owns retry */ }
  }

  async persistAcceptedTransition(
    transition: AcceptedEngineTransition,
    persistOptions: DurablePersistOptions = {},
  ): Promise<DurableCommandResult> {
    assertTransition(transition);
    const rngCheckpoint = this.options.rng?.checkpoint();
    const clockCheckpoint = this.options.clock?.checkpoint();
    const client = await this.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query('SET LOCAL ROLE malign_app_runtime');
      const identityRow = await assertLeastPrivilegeRuntimeIdentity(client,'malign_app_runtime');
      await ensureCreateRoot(client,transition);
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
          versionBefore !== (transition.beforeState?.version ?? 0)) {
        throw new PersistenceError('GAME_VERSION_CONFLICT', 'Expected game version did not match', {
          expected: transition.engineResult.gameVersionBefore, actual: versionBefore,
        });
      }
      if (transition.beforeState !== null &&
          sha256CanonicalJson(transition.beforeState) !== game.gameplay_state_hash.toString('hex')) {
        throw new PersistenceError('GAME_VERSION_CONFLICT', 'Engine before-state does not match durable authority');
      }
      const now = this.options.clock?.next() ?? new Date(transition.engineResult.resolvedAt);
      const actorParticipantId = await ensureActorPhysicalParticipant(client,transition,now);
      await client.query(
        `INSERT INTO malign.idempotency_records(
           game_id,actor_id,idempotency_key,command_id,command_fingerprint,command_type,status,game_version_before
         ) VALUES ($1,$2,$3,$4,decode($5,'hex'),$6,'INTERNAL_PENDING',$7)`,
        [transition.gameId, transition.actor.actorId, transition.idempotencyKey, physicalUuid(transition.engineResult.commandId),
          transition.fingerprintSha256, transition.commandType, versionBefore],
      );
      const stateHash = sha256CanonicalJson(transition.afterState);
      const eventSequence = Number(game.event_sequence_head) + 1;
      const outboxSequence = Number(game.outbox_sequence_head) + 1;
      const versionAfter = transition.engineResult.gameVersionAfter;

      const trace = await client.query<{ id: string }>(
        `INSERT INTO malign.adjudication_traces(game_id,game_event_sequence,artifact_ordinal,
           participant_id,trace_type,source_action_id,pre_state_hash,post_state_hash,input_snapshot_json,
           rule_evaluation_json,output_snapshot_json,trace_schema_id,trace_schema_version,correlation_id,causation_id)
         VALUES ($1,$2,1,$3,'ENGINE_COMMAND',$4,decode($5,'hex'),decode($6,'hex'),$7::jsonb,$8::jsonb,$9::jsonb,
                 'malign.adjudication-trace','1.0',$10,$11) RETURNING id`,
        [transition.gameId,eventSequence,actorParticipantId,physicalUuid(transition.engineResult.commandId),
          transition.beforeState===null?sha256CanonicalJson(null):sha256CanonicalJson(transition.beforeState),stateHash,
          JSON.stringify(transition.beforeState??{absent:true}),
          JSON.stringify({resultCode:transition.engineResult.resultCode,deterministic:true,
            actorType:transition.actor.actorType,engineEvents:transition.events,engineTraces:transition.traces}),
          JSON.stringify(transition.afterState),physicalUuid(transition.correlationId),
          transition.causationId===null?null:physicalUuid(transition.causationId)]);
      const traceId = trace.rows[0]?.id;
      if (!traceId) throw new PersistenceError('TRANSACTION_WRITE_FAILED','Trace identity missing');
      failAt(this.options.faultAt, 'trace');

      const normalized = await synchronizeNormalizedAfterImage(client,transition,eventSequence,traceId,now);
      await client.query(`UPDATE malign.games SET authoritative_state_json=$2::jsonb,
        gameplay_state_hash=decode($3,'hex'),facilitator_participant_id=$4,turn_limit=$5,dice_mode=$6,
        status=$7,started_at=CASE WHEN $7='ACTIVE' THEN COALESCE(started_at,$8) ELSE started_at END
        WHERE id=$1`,
      [transition.gameId,JSON.stringify(transition.afterState),stateHash,
        transition.afterState.facilitatorParticipantId===undefined?null:
          normalized.participantIds.get(transition.afterState.facilitatorParticipantId)??null,
        transition.afterState.turnLimit,transition.afterState.diceMode,
        transition.afterState.phase==='SETUP'?'SETUP':'ACTIVE',now]);
      failAt(this.options.faultAt, 'normalized_state');

      for (const [index, entry] of transition.ledgers.actionPoints.entries()) {
        // A locked empty plan produces an authoritative zero-delta audit marker in M1.
        // The physical journal is intentionally mutation-only (`delta <> 0`).
        if(entry.delta===0)continue;
        requireNonZeroInteger(entry.delta, 'AP delta');
        const participantId=normalized.participantIds.get(entry.participantId);
        if (participantId===undefined||normalized.turnId===null) throw new PersistenceError('CROSS_GAME_REFERENCE','AP ledger scope is invalid');
        const updated=await client.query<{remaining:number;last_transaction_sequence:string}>(
          `UPDATE malign.action_point_balances SET last_transaction_sequence=last_transaction_sequence+1
            WHERE game_id=$1 AND turn_id=$2 AND participant_id=$3 AND remaining=$4
            RETURNING remaining,last_transaction_sequence`,
          [transition.gameId,normalized.turnId,participantId,entry.balanceAfter]);
        const balance=updated.rows[0];
        if (!balance) throw new PersistenceError('ENGINE_TRANSITION_INCOMPLETE','AP after-image and ledger do not agree');
        failAt(this.options.faultAt, 'ap_balance');
        await client.query(
          `INSERT INTO malign.action_point_transactions(
             game_id,game_event_sequence,artifact_ordinal,turn_id,participant_id,sequence_number,
             delta,reason_type,source_entity_type,source_entity_id,correlation_id,adjudication_trace_id,balance_after
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'COMMAND',$9,$10,$11,$12)`,
          [transition.gameId,eventSequence,index+1,normalized.turnId,participantId,
            balance.last_transaction_sequence,entry.delta,entry.reason,
            traceId,physicalUuid(transition.correlationId),traceId,entry.balanceAfter]);
        failAt(this.options.faultAt, 'ap_journal');
      }

      for (const [index, entry] of transition.ledgers.resources.entries()) {
        if(entry.participantId===null) continue;
        requireNonZeroInteger(entry.delta,'Resource delta');
        const participantId=normalized.participantIds.get(entry.participantId);
        if(participantId===undefined) throw new PersistenceError('CROSS_GAME_REFERENCE','Resource ledger participant is invalid');
        const balance=await client.query<{current_resources_cache:number}>(
          `SELECT current_resources_cache FROM malign.game_countries WHERE game_id=$1
            AND controlling_participant_id=$2 AND current_resources_cache=$3`,
          [transition.gameId,participantId,entry.balanceAfter]);
        if(balance.rowCount!==1) throw new PersistenceError('ENGINE_TRANSITION_INCOMPLETE','Resource after-image and ledger do not agree');
        await client.query(
          `INSERT INTO malign.resource_transactions(
             game_id,game_event_sequence,artifact_ordinal,turn_id,participant_id,delta,reason_type,
             source_entity_type,source_entity_id,adjudication_trace_id,balance_after
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,'COMMAND',$8,$9,$10)`,
          [transition.gameId,eventSequence,normalized.resourceArtifactOffset+index+1,normalized.turnId,
            participantId,entry.delta,entry.reason,traceId,traceId,entry.balanceAfter]);
        failAt(this.options.faultAt, 'resources');
      }

      for (const [index,entry] of transition.ledgers.victoryPoints.entries()) {
        requireNonZeroInteger(entry.delta,'VP delta');
        const participantId=normalized.participantIds.get(entry.participantId);
        if(participantId===undefined) throw new PersistenceError('CROSS_GAME_REFERENCE','VP ledger participant is invalid');
        await client.query(
          `INSERT INTO malign.vp_transactions(game_id,game_event_sequence,artifact_ordinal,turn_id,
             participant_id,delta,balance_after,reason_type,source_entity_type,source_entity_id,adjudication_trace_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'COMMAND',$9,$10)`,
          [transition.gameId,eventSequence,index+1,normalized.turnId,participantId,entry.delta,
            entry.balanceAfter,entry.reason,traceId,traceId]);
        failAt(this.options.faultAt, 'vp');
      }

      for (const [index,entry] of transition.ledgers.influence.entries()) {
        requireNonZeroInteger(entry.delta,'Influence delta');
        const pdStateId=normalized.pdStateIds.get(entry.pdId);
        const attributionId=normalized.countryDefinitionIds.get(entry.attributionCountryId);
        if(pdStateId===undefined||attributionId===undefined) throw new PersistenceError('CROSS_GAME_REFERENCE','Influence ledger scope is invalid');
        await client.query(
          `INSERT INTO malign.influence_mutations(game_id,game_event_sequence,artifact_ordinal,turn_id,
             pd_state_id,influence_type,attribution_country_definition_id,delta,mutation_reason,
             adjudication_trace_id,source_entity_type,source_entity_id,resulting_count)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'COMMAND',$11,$12)`,
          [transition.gameId,eventSequence,normalized.influenceArtifactOffset+index+1,normalized.turnId,pdStateId,
            entry.type,attributionId,entry.delta,entry.reason,traceId,traceId,entry.balanceAfter]);
        failAt(this.options.faultAt, 'influence');
      }

      for (const [index,entry] of transition.ledgers.legitimacy.entries()) {
        const pdStateId=normalized.pdStateIds.get(entry.pdId);
        if(pdStateId===undefined) throw new PersistenceError('CROSS_GAME_REFERENCE','Legitimacy target is invalid');
        const previous=entry.previousParticipantId===null?null:normalized.participantIds.get(entry.previousParticipantId)??null;
        const next=entry.newParticipantId===null?null:normalized.participantIds.get(entry.newParticipantId)??null;
        await client.query(
          `INSERT INTO malign.legitimacy_events(game_id,game_event_sequence,artifact_ordinal,turn_id,
             pd_state_id,previous_participant_id,new_participant_id,reason_type,adjudication_trace_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [transition.gameId,eventSequence,index+1,normalized.turnId,pdStateId,previous,next,entry.reason,traceId]);
        await client.query(`UPDATE malign.game_countries c SET legitimacy_count_cache=(
          SELECT count(*)::int FROM malign.population_demographic_states p WHERE p.game_id=c.game_id
          AND p.current_legitimacy_participant_id=c.controlling_participant_id) WHERE c.game_id=$1`,
        [transition.gameId]);
        failAt(this.options.faultAt, 'legitimacy');
      }

      const dieRollIds=new Map<string,string>();
      for (const entry of transition.ledgers.dieRolls) {
        if (!Number.isInteger(entry.rawValue) || entry.rawValue < 1 || entry.rawValue > 10) {
          throw new PersistenceError('ENGINE_TRANSITION_REQUIRED', 'Die roll effect is invalid');
        }
        const participantId=normalized.participantIds.get(entry.participantId);
        if(participantId===undefined) throw new PersistenceError('CROSS_GAME_REFERENCE','Die-roll participant is invalid');
        const enteredByParticipantId=entry.submittedByParticipantId===undefined
          ? null
          : normalized.participantIds.get(entry.submittedByParticipantId);
        if(entry.submittedByParticipantId!==undefined&&enteredByParticipantId===undefined)
          throw new PersistenceError('CROSS_GAME_REFERENCE','Manual die submitter is invalid');
        const rngMetadata=entry.manual?null:JSON.stringify({requestId:entry.rngRequestId});
        const persistedDie=await client.query<{id:string}>(
          `INSERT INTO malign.die_rolls(game_id,turn_id,participant_id,die_type,mode,raw_value,
             source_type,source_entity_id,rng_metadata_json,rng_schema_id,rng_schema_version,entered_by_participant_id,created_at)
           VALUES ($1,$2,$3,'D10',$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12)
           RETURNING id`,
          [transition.gameId,normalized.turnId,participantId,entry.manual?'MANUAL_DIE_INPUT':'DETERMINISTIC',entry.rawValue,entry.source,
            traceId,rngMetadata,entry.manual?null:'malign.rng',entry.manual?null:'0.2',enteredByParticipantId,now]);
        const persistedDieId=persistedDie.rows[0]?.id;
        if(persistedDieId===undefined)throw new PersistenceError('TRANSACTION_WRITE_FAILED','Die-roll identity is missing');
        dieRollIds.set(entry.id,persistedDieId);
        failAt(this.options.faultAt, 'rng_record');
      }

      const reducerPayload = {
        reducer: { type: 'REPLACE_SETUP_STATE', version: '0.1', stateAfter: transition.afterState },
        commandResult: transition.engineResult,
      };
      const event = await client.query<{ id: string }>(
        `INSERT INTO malign.game_events(game_id,sequence_number,event_type,actor_participant_id,
           subject_type,subject_id,payload_json,payload_schema_id,payload_schema_version,visibility_class,
           adjudication_trace_id,correlation_id,causation_id,state_hash_after,occurred_at)
         VALUES ($1,$2,$3,$4,'GAME',$1,$5::jsonb,'malign.game-transition','0.2','GAME',$6,$7,$8,decode($9,'hex'),$10)
         RETURNING id`,
        [transition.gameId,eventSequence,transition.commandType,actorParticipantId,
          JSON.stringify(reducerPayload),traceId,physicalUuid(transition.correlationId),
          transition.causationId===null?null:physicalUuid(transition.causationId),stateHash,now]);
      const eventId = event.rows[0]?.id;
      if (!eventId) throw new Error('Event identity missing');
      failAt(this.options.faultAt, 'event');

      const actionResolutions=await synchronizeActionResolutions(client,transition,normalized.participantIds,
        normalized.turnId,traceId,now);
      const sourceResolutionId=transition.afterState.adjudication.pendingResolution===undefined?null:
        actionResolutions.get(`${transition.afterState.adjudication.pendingResolution.participantId}:`+
          `${transition.afterState.adjudication.pendingResolution.sequenceIndex}`)??null;
      const campaignActivationId=await synchronizeM1AdjudicationArtifacts(
        client,transition,normalized,actionResolutions,dieRollIds,traceId,now,
      );
      await synchronizeRegimeAbilityActivation(client,transition,normalized,dieRollIds,traceId);
      await synchronizeGameOutcome(client,transition,normalized,now);
      if(transition.continuation.operation==='CLOSE') {
        const resolvedChoiceEvent=transition.events.find(({eventType})=>eventType==='CHOICE_RESOLVED');
        const selectedOptionIdsJson=resolvedChoiceEvent?.payload['selectedOptionIdsJson'];
        const selectedOptionIds=typeof selectedOptionIdsJson==='string'?JSON.parse(selectedOptionIdsJson) as unknown:null;
        await client.query(`UPDATE malign.pending_resolutions SET status='CLOSED'
          WHERE game_id=$1 AND status='OPEN'`,[transition.gameId]);
        await client.query(`UPDATE malign.choice_requests SET status='RESOLVED',resolved_at=$2,
          resolved_by_participant_id=$3,selected_option_ids_json=$4::jsonb WHERE game_id=$1 AND status='OPEN'`,
        [transition.gameId,now,actorParticipantId,JSON.stringify(Array.isArray(selectedOptionIds)?selectedOptionIds:null)]);
        await client.query(`UPDATE malign.narrative_requests SET status='RESOLVED',resolved_at=$2
          WHERE game_id=$1 AND status='OPEN'`,[transition.gameId,now]);
      } else if(transition.continuation.operation==='CREATE'||transition.continuation.operation==='UPDATE') {
        const pending=transition.continuation.after;
        if(sourceResolutionId===null) throw new PersistenceError('CONTINUATION_INVALID','Continuation source action is missing');
        const continuationHash=sha256CanonicalJson(pending);
        await client.query(
          `INSERT INTO malign.pending_resolutions(game_id,source_resolution_id,continuation_type,
             continuation_state_json,continuation_schema_id,continuation_schema_version,waiting_interaction_type,
             waiting_interaction_id,status,ruleset_version_id,engine_contract_version_id,state_hash)
           VALUES ($1,$2,$3,$4::jsonb,'malign.continuation','0.2',$5,uuidv7(),'OPEN',$6,$7,decode($8,'hex'))
           ON CONFLICT (game_id,source_resolution_id) WHERE status='OPEN' DO UPDATE SET
             continuation_type=EXCLUDED.continuation_type,continuation_state_json=EXCLUDED.continuation_state_json,
             waiting_interaction_type=EXCLUDED.waiting_interaction_type,state_hash=EXCLUDED.state_hash`,
          [transition.gameId,sourceResolutionId,pending.kind,JSON.stringify(pending),pending.kind,
            game.ruleset_version_id,game.engine_contract_version_id,continuationHash]);
        if(pending.kind==='CHOICE') {
          const choice=pending.choice;
          const choiceActor=normalized.participantIds.get(choice.actorParticipantId);
          if(choiceActor===undefined) throw new PersistenceError('CONTINUATION_INVALID','Choice actor is invalid');
          const existingChoice=await client.query<{id:string}>(
            `SELECT id FROM malign.choice_requests WHERE game_id=$1 AND source_resolution_id=$2 AND status='OPEN' LIMIT 1`,
            [transition.gameId,sourceResolutionId]);
          if(existingChoice.rows[0]===undefined) await client.query(
            `INSERT INTO malign.choice_requests(game_id,choice_version,choice_type,actor_participant_id,
               source_resolution_id,source_event_id,visibility_scope,status,selection_mode,min_selections,
               max_selections,options_json,options_schema_id,options_schema_version)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'OPEN',$8,$9,$10,$11::jsonb,'malign.choice-options','1.0')`,
            [transition.gameId,choice.choiceVersion,choice.choiceType,choiceActor,sourceResolutionId,eventId,
              choice.visibilityScope,choice.selectionMode,choice.minSelections,choice.maxSelections,JSON.stringify(choice.options)]);
        }
      }
      const beforeNarratives=transition.beforeState?.adjudication.narrativesByCampaign??{};
      for(const [campaignLogical,narrative] of Object.entries(transition.afterState.adjudication.narrativesByCampaign)) {
        if(beforeNarratives[campaignLogical]!==undefined)continue;
        const activation=campaignActivationId??(await client.query<{id:string}>(
          `SELECT a.id FROM malign.campaign_activations a JOIN malign.campaigns c ON c.id=a.campaign_id
            WHERE a.game_id=$1 AND c.id=$2 ORDER BY a.activation_ordinal DESC LIMIT 1`,
          [transition.gameId,normalized.campaignIds.get(campaignLogical)??null])).rows[0]?.id;
        const participantId=narrative.actorParticipantId===null?actorParticipantId:
          normalized.participantIds.get(narrative.actorParticipantId)??null;
        if(activation===undefined||participantId===null)
          throw new PersistenceError('ENGINE_TRANSITION_INCOMPLETE','Narrative submission has no durable activation or participant');
        await client.query(
          `INSERT INTO malign.narrative_submissions(game_id,campaign_activation_id,participant_id,text,
             sentence_count,objective_tag_fluma_independence,submitted_at)
           VALUES ($1,$2,$3,$4,$5,false,$6) ON CONFLICT (campaign_activation_id) DO NOTHING`,
          [transition.gameId,activation,participantId,narrative.text,
            narrative.text.split(/[.!?]+/u).filter(part=>part.trim().length>0).length,now]);
      }
      for(const resolution of transition.afterState.adjudication.influenceResolutions) {
        if(transition.beforeState?.adjudication.influenceResolutions.some(({id})=>id===resolution.id))continue;
        const pdStateId=normalized.pdStateIds.get(resolution.targetPdId);
        const attributionId=normalized.countryDefinitionIds.get(resolution.incomingAttributionCountryId);
        if(pdStateId===undefined||attributionId===undefined)
          throw new PersistenceError('ENGINE_TRANSITION_INCOMPLETE','Influence resolution scope is incomplete');
        const oppositeRemoved=Object.values(resolution.oppositeRemovedByAttribution).reduce((sum,value)=>sum+value,0);
        await client.query(
          `INSERT INTO malign.influence_resolutions(game_id,adjudication_trace_id,pd_state_id,incoming_type,
             incoming_attribution_country_definition_id,generated_count,consumed_in_cancellation,
             opposite_removed_count,placed_count) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [transition.gameId,traceId,pdStateId,resolution.incomingType,attributionId,resolution.generatedCount,
            resolution.consumedInCancellation,oppositeRemoved,resolution.placedCount]);
      }
      failAt(this.options.faultAt, 'continuation');

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
      failAt(this.options.faultAt, 'snapshot');

      const result: DurableCommandResult = {
        commandId:transition.engineResult.commandId,gameId:transition.gameId,gameVersion:versionAfter,
        eventSequence,outboxSequence,eventId,traceId,replayed:false,
        sessionUser:identityRow.sessionUser,currentUser:'malign_app_runtime',
        engineResult:transition.engineResult,
      };
      await client.query(
        `UPDATE malign.idempotency_records SET status='COMMITTED',game_version_after=$4,
          result_json=$5::jsonb,result_schema_id='malign.command-result',result_schema_version='0.2',completed_at=$6
          WHERE game_id=$1 AND actor_id=$2 AND idempotency_key=$3`,
        [transition.gameId,transition.actor.actorId,transition.idempotencyKey,versionAfter,JSON.stringify(result),now]);
      failAt(this.options.faultAt, 'idempotency');

      const outbox = await client.query<{ id: string }>(
        `INSERT INTO malign.outbox_messages(game_id,outbox_sequence,event_id,topic,audience_class,
           payload_json,payload_schema_id,payload_schema_version,correlation_id,deduplication_key,created_at)
         VALUES ($1,$2,$3,'GAME_EVENT','GAME',$4::jsonb,'malign.authorized-projection','0.2',$5,$6,$7) RETURNING id`,
        [transition.gameId,outboxSequence,eventId,JSON.stringify({eventId,eventSequence,gameVersion:versionAfter}),
          physicalUuid(transition.correlationId),`${transition.gameId}:${eventSequence}:GAME`,now]);
      const outboxId = outbox.rows[0]?.id;
      if (!outboxId) throw new Error('Outbox identity missing');
      failAt(this.options.faultAt, 'outbox_message');
      await client.query(`INSERT INTO malign.outbox_delivery_states(outbox_message_id,delivery_status,next_attempt_at)
        VALUES ($1,'PENDING',$2)`,[outboxId,now]);
      failAt(this.options.faultAt, 'delivery_state');

      const cas = await client.query(`UPDATE malign.games SET game_version=$3,event_sequence_head=$4,
        outbox_sequence_head=$5 WHERE id=$1 AND game_version=$2`,
      [transition.gameId,this.options.forceCasMiss?versionBefore+1:versionBefore,
        versionAfter,eventSequence,outboxSequence]);
      if (cas.rowCount !== 1) throw new PersistenceError('GAME_VERSION_CONFLICT', 'Game CAS lost');
      await client.query('COMMIT');
      committed = true;
      if (!persistOptions.deferPostCommitObserver) await this.publishCommittedTransition(result);
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
