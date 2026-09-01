import type { ActorContext } from '@malign-ai/contracts';
import type {
  AdjudicationTrace,
  ChoiceRequest,
  CoalitionContributionRequest,
  ManualDieRequest,
  NarrativeRequest,
  SetupGameEvent,
  SetupGameEventType,
  SetupGameState,
  M2BAuditRecord,
} from '@malign-ai/domain';
import { buildSetupGameProjection, type SetupGameProjection } from './setup-projection.js';

export interface PublicAdjudicationTraceProjection {
  readonly id: string;
  readonly participantId: string;
  readonly campaignId: string;
  readonly targetPdId: string;
  readonly baseCv: number;
  readonly effectiveCv: number;
  readonly resourceCost: number;
  readonly rawRoll: number;
  readonly modifiedRollRaw: number;
  readonly ertRoll: number;
  readonly ertResult: number;
  readonly placedCount: number;
  readonly vpDelta: number;
}

export interface M1AdjudicationProjection {
  readonly game: SetupGameProjection;
  readonly pendingChoice?: ChoiceRequest;
  readonly pendingNarrativeRequest?: NarrativeRequest;
  readonly pendingCoalitionRequest?: CoalitionContributionRequest & { readonly mayRespond: boolean };
  readonly pendingManualDieRequest?: ManualDieRequest & { readonly maySubmit: boolean };
  readonly events: readonly SetupGameEvent[];
  readonly audit: {
    readonly resourceLedgerEntries: number;
    readonly influenceLedgerEntries: number;
    readonly legitimacyLedgerEntries: number;
    readonly vpLedgerEntries: number;
    readonly traces: readonly (AdjudicationTrace | PublicAdjudicationTraceProjection)[];
    readonly m2AuditEntries: number;
    readonly m2Audit?: readonly M2BAuditRecord[];
  };
}

const publicTrace = (trace: AdjudicationTrace): PublicAdjudicationTraceProjection => ({
  id: trace.id,
  participantId: trace.participantId,
  campaignId: trace.campaignId,
  targetPdId: trace.targetPdId,
  baseCv: trace.baseCv,
  effectiveCv: trace.effectiveCv,
  resourceCost: trace.resourceCost,
  rawRoll: trace.rawRoll,
  modifiedRollRaw: trace.modifiedRollRaw,
  ertRoll: trace.ertRoll,
  ertResult: trace.ertResult,
  placedCount: trace.placedCount,
  vpDelta: trace.vpDelta,
});

const canonicalPayloadKeys: Readonly<Record<SetupGameEventType, readonly string[]>> = {
  GAME_CREATED: ['phase'],
  PARTICIPANT_JOINED: ['participantId'],
  PLAYER_SEAT_ASSIGNED: ['participantId', 'countryId', 'seatIndex', 'clockwiseIndex'],
  GAME_OPTION_CONFIGURED: ['optionId', 'value'],
  GAME_STARTED: ['phase'],
  PHASE_CHANGED: ['phase'],
  OPERATIONS_DECK_SUBMITTED: ['participantId', 'count'],
  DECK_SHUFFLED: ['participantId', 'count', 'source'],
  CARD_DRAWN: ['participantId', 'cardInstanceId', 'drawIndex', 'handSizeAfter'],
  PLAYER_READY_CHANGED: [
    'participantId',
    'strategyLocked',
    'initiativeResolved',
    'initiativeMaintenanceSubmitted',
    'initiativeMaintenanceLocked',
    'actionPlanLocked',
  ],
  GAME_PAUSED: ['reasonCode', 'reasonText'],
  GAME_RESUMED: ['reasonCode'],
  INITIATIVE_ROLLED: ['rngRequestId', 'source', 'attempt', 'participantId', 'rawValue', 'consumptionOrder'],
  INITIATIVE_ORDER_SET: ['winnerParticipantId', 'order'],
  RESOURCE_CHANGED: ['participantId', 'countryId', 'reason', 'delta', 'balanceAfter'],
  CARD_MOVED: ['participantId', 'cardInstanceId', 'fromZone', 'toZone'],
  ACTION_PLAN_SAVED: ['participantId', 'actionCount'],
  AP_COMMITTED: ['participantId', 'amount', 'balanceAfter'],
  ACTION_PLAN_LOCKED: ['participantId', 'actionCount'],
  ACTION_REVEALED: ['participantId', 'sequenceIndex', 'actionType'],
  ACTION_RESOLVED: ['participantId', 'sequenceIndex', 'outcome', 'errorCode'],
  CAMPAIGN_CREATED: [
    'campaignId',
    'participantId',
    'alignment',
    'targetDtId',
    'intentCardInstanceId',
    'methodCardInstanceId',
    'amplifierCardInstanceId',
  ],
  CAMPAIGN_ACTIVATION_STARTED: ['activationId', 'campaignId', 'participantId', 'targetPdId'],
  NARRATIVE_REQUESTED: ['requestId', 'campaignId', 'actorParticipantId', 'ownerParticipantId'],
  NARRATIVE_SUBMITTED: [
    'activationId',
    'campaignId',
    'inputId',
    'source',
    'text',
    'inputCausationId',
    'ownerParticipantId',
  ],
  COALITION_REQUESTED: ['requestId', 'campaignId', 'sourceParticipantId', 'eligibleCount'],
  COALITION_RESPONSE_COMMITTED: ['requestId', 'participantId', 'responseCount', 'resolved'],
  COALITION_RESOLVED: ['requestId', 'campaignId', 'contributorCount'],
  DIE_REQUESTED: ['requestId', 'activationId', 'participantId', 'dieType'],
  BOOST_PLANNED: ['participantId', 'cardInstanceId', 'campaignId', 'activationSequenceIndex'],
  BOOST_APPLIED: ['activationId', 'participantId', 'cardInstanceId', 'modifier'],
  PRE_ROLL_REACTION_OPENED: ['activationId', 'stage', 'eligibleCount'],
  PRE_ROLL_REACTION_EVALUATED: ['activationId', 'stage', 'eligibleCount'],
  PRE_ROLL_REACTION_CLOSED: ['activationId', 'stage', 'eligibleCount'],
  CAMPAIGN_COST_PAID: ['activationId', 'participantId', 'countryId', 'amount', 'balanceAfter', 'ledgerId'],
  DIE_ROLLED: [
    'activationId',
    'dieRollId',
    'source',
    'participantId',
    'rawValue',
    'manual',
    'rngRequestId',
    'submittedByParticipantId',
    'legitimacyModifier',
    'boostModifier',
    'modifiedRollRaw',
    'ertRoll',
  ],
  ERT_RESOLVED: ['activationId', 'alignment', 'baseCv', 'effectiveCv', 'baseTier', 'resolutionTier', 'result'],
  CHOICE_REQUESTED: [
    'choiceId',
    'choiceVersion',
    'actorParticipantId',
    'ownerParticipantId',
    'optionCount',
    'minSelections',
    'maxSelections',
  ],
  CHOICE_RESOLVED: ['choiceId', 'choiceVersion', 'selectionCount', 'ownerParticipantId'],
  INFLUENCE_MUTATED: ['activationId', 'pdId', 'type', 'attributionCountryId', 'reason', 'delta', 'balanceAfter', 'ledgerId'],
  LEGITIMACY_CHANGED: ['activationId', 'pdId', 'previousParticipantId', 'newParticipantId', 'reason', 'ledgerId'],
  VP_CHANGED: ['activationId', 'participantId', 'reason', 'delta', 'balanceAfter', 'ledgerId'],
  CAMPAIGN_ACTIVATION_COMPLETED: ['activationId', 'campaignId', 'traceId', 'placedCount', 'vpDelta', 'influenceResolutionId'],
  CLEANUP_STARTED: [],
  CAMPAIGN_AGED: ['campaignId', 'row'],
  CAMPAIGN_DISCARDED: ['campaignId'],
  TURN_FLAGS_RESET: [],
  CLEANUP_COMPLETED: ['nextPhase'],
  OBJECTIVE_AWARDED: ['participantId', 'countryId', 'baseVp', 'objectiveVp', 'finalVp'],
  GAME_COMPLETED: ['winnerParticipantIds', 'sharedVictory'],
  REACTION_WINDOW_OPENED: ['windowId', 'trigger', 'currentParticipantId'],
  REACTION_PRIORITY_PASSED: ['windowId', 'participantId'],
  REACTION_PLAYED: ['windowId', 'participantId', 'cardId', 'effectId', 'negated'],
  REACTION_WINDOW_CLOSED: ['windowId'],
  VETO_STARTED: ['vetoCaseId', 'campaignId', 'initiatorParticipantId', 'offendingParticipantId'],
  VETO_DEFENSE_SUBMITTED: ['vetoCaseId', 'participantId'],
  VETO_VOTE_CAST: ['vetoCaseId', 'participantId'],
  VETO_RESOLVED: ['vetoCaseId', 'campaignId', 'rejectedCampaign', 'unacceptable', 'activePlayers'],
  VETO_ABUSE_REVIEWED: ['windowId', 'participantId', 'decision'],
  M2_EFFECT_EXECUTED: ['effectId', 'actorParticipantId', 'sourceCardInstanceId', 'auditCount'],
  M2_CORE_OPERATION_EXECUTED: ['operation', 'actorParticipantId', 'subjectId'],
};

const facilitatorAuditPayloadKeys: Readonly<Partial<Record<SetupGameEventType, readonly string[]>>> = {
  NARRATIVE_REQUESTED: ['pendingResolutionDigest'],
  CHOICE_REQUESTED: ['pendingResolutionDigest'],
  DIE_REQUESTED: ['pendingResolutionDigest'],
  CAMPAIGN_ACTIVATION_COMPLETED: ['influenceResolutionDigest', 'traceDigest'],
};

const setupPrivateOwnerEventTypes = new Set<SetupGameEventType>([
  'DECK_SHUFFLED',
  'CARD_DRAWN',
  'CARD_MOVED',
  'ACTION_PLAN_SAVED',
  'ACTION_PLAN_LOCKED',
]);

const explicitPrivateOwner = (event: SetupGameEvent): string | undefined => {
  const explicit = event.payload.ownerParticipantId;
  if (typeof explicit === 'string') return explicit;
  const setupOwner = event.payload.participantId;
  if (setupPrivateOwnerEventTypes.has(event.eventType) && typeof setupOwner === 'string') return setupOwner;
  return undefined;
};

const selectPayload = (
  event: SetupGameEvent,
  facilitator: boolean,
): Readonly<Record<string, string | number | boolean>> => {
  const keys = new Set([
    ...canonicalPayloadKeys[event.eventType],
    ...(facilitator ? facilitatorAuditPayloadKeys[event.eventType] ?? [] : []),
  ]);
  return Object.fromEntries(Object.entries(event.payload).filter(([key]) => keys.has(key)));
};

export interface CanonicalM1EventProjection {
  readonly authorized: boolean;
  readonly event: SetupGameEvent;
}

/** Single fail-closed event authorization and payload policy for query, feed and realtime. */
export const projectCanonicalM1Event = (
  event: SetupGameEvent,
  viewer: ActorContext,
): CanonicalM1EventProjection => {
  const participantId = viewer.participantId;
  if (participantId === undefined || viewer.actorType === 'SYSTEM') {
    throw new Error('M1 event projection requires a verified human participant');
  }
  const facilitator = viewer.actorType === 'FACILITATOR';
  const authorized = event.visibilityClass === 'PUBLIC' ||
    facilitator ||
    explicitPrivateOwner(event) === participantId;
  return {
    authorized,
    event: {
      ...structuredClone(event),
      payload: authorized ? selectPayload(event, facilitator) : { redacted: true },
    },
  };
};

const projectedEvents = (state: SetupGameState, viewer: ActorContext): SetupGameEvent[] =>
  state.events.map((event) => projectCanonicalM1Event(event, viewer).event);

export const buildM1AdjudicationProjection = (state: SetupGameState, viewer: ActorContext): M1AdjudicationProjection => {
  const participantId = viewer.participantId;
  if (participantId === undefined) throw new Error('Adjudication projection requires a verified participant');
  const participant = state.participants[participantId];
  if (participant === undefined || participant.role !== viewer.actorType) throw new Error('Adjudication projection viewer mismatch');
  const pending = state.adjudication.pendingResolution;
  const maySeePending = pending !== undefined &&
    (participant.role === 'FACILITATOR' || pending.participantId === participantId);
  return {
    game: buildSetupGameProjection(state, viewer),
    ...(maySeePending && pending?.kind === 'CHOICE' ? { pendingChoice: structuredClone(pending.choice) } : {}),
    ...(maySeePending && pending?.kind === 'NARRATIVE'
      ? { pendingNarrativeRequest: structuredClone(pending.narrativeRequest) }
      : {}),
    ...(pending?.kind === 'COALITION' && (participant.role === 'FACILITATOR' || pending.request.eligibleParticipantIds.includes(participantId))
      ? { pendingCoalitionRequest: { ...structuredClone(pending.request),
          mayRespond: participant.role === 'PLAYER' && pending.request.eligibleParticipantIds.includes(participantId) && pending.decisions[participantId] === undefined } }
      : {}),
    ...(pending?.kind === 'MANUAL_DIE' && (participant.role === 'FACILITATOR' || pending.request.requestedForParticipantId === participantId)
      ? { pendingManualDieRequest: { ...structuredClone(pending.request),
          maySubmit: participant.role === 'FACILITATOR' || pending.request.requestedForParticipantId === participantId } }
      : {}),
    events: projectedEvents(state, viewer),
    audit: {
      resourceLedgerEntries: state.resourceLedger.length,
      influenceLedgerEntries: state.adjudication.influenceLedger.length,
      legitimacyLedgerEntries: state.adjudication.legitimacyLedger.length,
      vpLedgerEntries: state.adjudication.vpLedger.length,
      traces: participant.role === 'FACILITATOR'
        ? structuredClone(state.adjudication.traces)
        : state.adjudication.traces.map(publicTrace),
      m2AuditEntries: state.m2Audit?.length ?? 0,
      ...(participant.role === 'FACILITATOR' ? { m2Audit: structuredClone(state.m2Audit ?? []) } : {}),
    },
  };
};
