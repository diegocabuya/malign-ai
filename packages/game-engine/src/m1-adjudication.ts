import type {
  ActorContext,
  AnyEngineErrorCode,
  CommandEnvelope,
  EngineCommandResult,
} from '@malign-ai/contracts';
import {
  M1_0_BASELINE_VERSIONS,
  type AdjudicationTrace,
  type CampaignContinuationState,
  type CampaignNarrativeProvenance,
  type CountryId,
  type InfluenceStackState,
  type M1ActionPlanSlot,
  type M1CampaignAssignment,
  type M1CampaignState,
  type NarrativeContinuationState,
  type NarrativePendingResolution,
  type PendingResolution,
  type SetupGameEvent,
  type SetupGameEventType,
  type SetupGameState,
  type TransactionalRandomProvider,
} from '@malign-ai/domain';
import {
  calculateCampaignValue,
  lookupErt,
  normalizeErtRoll,
  resolveTwoToOne,
  type AssignedCampaignComponent,
  type CampaignAlignment,
} from '@malign-ai/rules';
import { canonicalizeJson, sha256CanonicalJson } from '@malign-ai/shared';
import { dispatchAtomicCommand, rejectedResult, type PreparedResolution } from './atomic-dispatch.js';
import type { InMemorySetupGameStore } from './setup-dispatcher.js';

export interface SubmitChoicePayload {
  readonly choiceId: string;
  readonly choiceVersion: number;
  readonly selectedOptionIds: readonly string[];
}

export interface SubmitCampaignNarrativePayload {
  readonly campaignId: string;
  readonly narrative: string;
}

export interface SchedulerRunOptions {
  readonly gameId: string;
  readonly expectedGameVersion: number;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly correlationId?: string;
}

export interface M1StateSnapshot {
  readonly fixtureSchemaVersion: '0.1';
  readonly canonicalStateJson: string;
  readonly gameplayStateHash: string;
  readonly snapshotIntegrityDigest: string;
}

export interface M1ReplayBundle {
  readonly fixtureSchemaVersion: '0.1';
  readonly canonicalArtifactsJson: string;
  readonly integrityDigest: string;
}

type InteractionEnvelope = CommandEnvelope<string, unknown>;
type InternalEnvelope = CommandEnvelope<'INTERNAL_RUN_M1_SCHEDULER', Record<string, never>>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const exactKeys = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

const isSubmitChoicePayload = (value: unknown): value is SubmitChoicePayload =>
  exactKeys(value, ['choiceId', 'choiceVersion', 'selectedOptionIds']) &&
  typeof value.choiceId === 'string' &&
  Number.isInteger(value.choiceVersion) &&
  Number.isFinite(value.choiceVersion) &&
  Array.isArray(value.selectedOptionIds) &&
  value.selectedOptionIds.every((optionId) => typeof optionId === 'string');

const isSubmitCampaignNarrativePayload = (value: unknown): value is SubmitCampaignNarrativePayload =>
  exactKeys(value, ['campaignId', 'narrative']) &&
  typeof value.campaignId === 'string' &&
  value.campaignId.length > 0 &&
  typeof value.narrative === 'string' &&
  value.narrative.trim().length > 0;

const countryForParticipant = (state: SetupGameState, participantId: string): CountryId | undefined =>
  state.seats[participantId]?.countryId;

const oppositeType = (alignment: CampaignAlignment): CampaignAlignment =>
  alignment === 'MALIGN' ? 'RESILIENCY' : 'MALIGN';

const gameplayPayloadForHash = (state: SetupGameState, version = state.version) => ({
  id: state.id,
  version,
  scenarioId: state.scenarioId,
  phase: state.phase,
  overlay: state.overlay,
  versions: state.versions,
  facilitatorParticipantId: state.facilitatorParticipantId ?? null,
  turnLimit: state.turnLimit,
  diceMode: state.diceMode,
  participants: state.participants,
  seats: state.seats,
  countries: state.countries,
  populationDemographics: state.populationDemographics,
  cardDefinitions: state.cardDefinitions,
  cards: state.cards,
  actionPlanning: state.actionPlanning,
  initiative: state.initiative,
  strategy: state.strategy,
  secretVictoryObjectives: state.secretVictoryObjectives,
  currentRevealedAction: state.currentRevealedAction ?? null,
  campaigns: state.adjudication.campaigns,
  influenceStacks: [...state.adjudication.influenceStacks].sort((left, right) =>
    `${left.pdId}:${left.type}:${left.attributionCountryId}`.localeCompare(
      `${right.pdId}:${right.type}:${right.attributionCountryId}`,
    ),
  ),
  legitimacyByPd: state.adjudication.legitimacyByPd,
  vpByParticipant: state.adjudication.vpByParticipant,
  narrativesByCampaign: state.adjudication.narrativesByCampaign,
  resolvedChoiceIds: state.adjudication.resolvedChoiceIds,
  scheduler: state.adjudication.scheduler,
  pendingResolution: state.adjudication.pendingResolution ?? null,
});

/** Gameplay hash: deterministic state used by adjudication, excluding append-only audit artifacts. */
export const hashM1GameplayState = (state: SetupGameState, version = state.version): string =>
  sha256CanonicalJson(gameplayPayloadForHash(state, version));

/** @deprecated Use hashM1GameplayState; retained for compatibility with approved M1-2 callers. */
export const hashAuthoritativeM1State = (state: SetupGameState, version = state.version): string =>
  hashM1GameplayState(state, version);

export const createM1StateSnapshot = (state: SetupGameState): M1StateSnapshot => ({
  fixtureSchemaVersion: '0.1',
  canonicalStateJson: canonicalizeJson(state),
  gameplayStateHash: hashM1GameplayState(state),
  snapshotIntegrityDigest: sha256CanonicalJson(state),
});

export const rehydrateM1StateSnapshot = (snapshot: M1StateSnapshot): SetupGameState => {
  if (snapshot.fixtureSchemaVersion !== '0.1') throw new Error('Unsupported M1 snapshot schema');
  const state = JSON.parse(snapshot.canonicalStateJson) as SetupGameState;
  if (canonicalizeJson(state) !== snapshot.canonicalStateJson) throw new Error('Snapshot is not canonical JCS');
  if (sha256CanonicalJson(state) !== snapshot.snapshotIntegrityDigest) throw new Error('Snapshot integrity digest mismatch');
  if (hashM1GameplayState(state) !== snapshot.gameplayStateHash) throw new Error('Snapshot gameplay hash mismatch');
  return state;
};

interface PersistedReplayArtifacts {
  readonly events: readonly SetupGameEvent[];
  readonly traces: readonly AdjudicationTrace[];
}

export const createM1ReplayBundle = (
  events: readonly SetupGameEvent[],
  traces: readonly AdjudicationTrace[],
): M1ReplayBundle => {
  const artifacts: PersistedReplayArtifacts = { events, traces };
  return {
    fixtureSchemaVersion: '0.1',
    canonicalArtifactsJson: canonicalizeJson(artifacts),
    integrityDigest: sha256CanonicalJson(artifacts),
  };
};

const rehydrateReplayBundle = (bundle: M1ReplayBundle): PersistedReplayArtifacts => {
  if (bundle.fixtureSchemaVersion !== '0.1') throw new Error('Unsupported M1 replay schema');
  const artifacts = JSON.parse(bundle.canonicalArtifactsJson) as PersistedReplayArtifacts;
  if (canonicalizeJson(artifacts) !== bundle.canonicalArtifactsJson) throw new Error('Replay bundle is not canonical JCS');
  if (sha256CanonicalJson(artifacts) !== bundle.integrityDigest) throw new Error('Replay bundle integrity digest mismatch');
  return artifacts;
};

const replayAdvanceCursor = (state: SetupGameState): void => {
  const cursor = state.adjudication.scheduler;
  cursor.slotIndex += 1;
  delete state.currentRevealedAction;
  while (cursor.participantIndex < state.initiative.orderParticipantIds.length) {
    const participantId = state.initiative.orderParticipantIds[cursor.participantIndex];
    const slots = participantId === undefined ? undefined : state.actionPlanning[participantId]?.lockedSlots;
    if (slots !== undefined && cursor.slotIndex < slots.length) {
      cursor.status = 'READY';
      return;
    }
    cursor.participantIndex += 1;
    cursor.slotIndex = 0;
  }
  cursor.status = 'COMPLETE';
};

const nullableString = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new Error('Replay nullable string payload is invalid');
  return value;
};

const parseCanonicalRecord = <T>(json: unknown, digest: unknown, label: string): T => {
  if (typeof json !== 'string' || typeof digest !== 'string') throw new Error(`${label} replay payload missing`);
  const parsed = JSON.parse(json) as T;
  if (canonicalizeJson(parsed) !== json || sha256CanonicalJson(parsed) !== digest) {
    throw new Error(`${label} replay payload integrity mismatch`);
  }
  return parsed;
};

const reconstructTrace = (
  state: SetupGameState,
  activationEvents: readonly SetupGameEvent[],
  preStateHash: string,
  postStateHash: string,
): AdjudicationTrace => {
  const eventOf = (type: SetupGameEventType): SetupGameEvent => {
    const event = activationEvents.find((candidate) => candidate.type === type);
    if (event === undefined) throw new Error(`Replay trace is missing ${type}`);
    return event;
  };
  const started = eventOf('CAMPAIGN_ACTIVATION_STARTED');
  const reveal = eventOf('ACTION_REVEALED');
  const narrative = eventOf('NARRATIVE_SUBMITTED');
  const cost = eventOf('CAMPAIGN_COST_PAID');
  const die = eventOf('DIE_ROLLED');
  const ert = eventOf('ERT_RESOLVED');
  const completed = eventOf('CAMPAIGN_ACTIVATION_COMPLETED');
  const campaignId = String(started.payload.campaignId);
  const participantId = String(started.payload.participantId);
  const targetPdId = String(started.payload.targetPdId);
  const campaign = state.adjudication.campaigns[campaignId];
  const influenceResolution = state.adjudication.influenceResolutions.find(({ id }) =>
    id === String(completed.payload.influenceResolutionId));
  if (campaign === undefined || influenceResolution === undefined) throw new Error('Replay trace source artifacts missing');
  const legitimacyEvent = activationEvents.find(({ type }) => type === 'LEGITIMACY_CHANGED');
  const legitimacyAfter = state.adjudication.legitimacyByPd[targetPdId] ?? null;
  const legitimacyBefore = legitimacyEvent === undefined
    ? legitimacyAfter
    : nullableString(legitimacyEvent.payload.previousParticipantId);
  const vpEvents = activationEvents.filter(({ type, payload }) =>
    type === 'VP_CHANGED' && payload.participantId === participantId);
  const firstVp = vpEvents[0];
  const lastVp = vpEvents.at(-1);
  const vpAfter = state.adjudication.vpByParticipant[participantId] ?? 0;
  const vpBefore = firstVp === undefined
    ? vpAfter
    : Number(firstVp.payload.balanceAfter) - Number(firstVp.payload.delta);
  if (lastVp !== undefined && Number(lastVp.payload.balanceAfter) !== vpAfter) {
    throw new Error('Replay VP ledger/event balance mismatch');
  }
  const reactionTypes = activationEvents
    .filter(({ type }) => type.startsWith('PRE_ROLL_REACTION_'))
    .map(({ payload }) => String(payload.stage));
  if (canonicalizeJson(reactionTypes) !== canonicalizeJson(['OPEN', 'EVALUATE_ZERO_ELIGIBLE', 'CLOSE'])) {
    throw new Error('Replay PRE_ROLL sequence mismatch');
  }
  const ledgerRefs = activationEvents.flatMap(({ payload }) =>
    typeof payload.ledgerId === 'string' ? [payload.ledgerId] : []);
  return {
    id: String(completed.payload.traceId),
    participantId,
    sequenceIndex: Number(reveal.payload.sequenceIndex),
    campaignId,
    activationId: String(started.payload.activationId),
    cards: structuredClone(campaign.assignments),
    alignment: campaign.alignment,
    targetDtId: campaign.targetDtId,
    targetPdId,
    baseCv: Number(ert.payload.baseCv),
    effectiveCv: Number(ert.payload.effectiveCv),
    baseTier: String(ert.payload.baseTier) as AdjudicationTrace['baseTier'],
    resolutionTier: String(ert.payload.resolutionTier) as AdjudicationTrace['resolutionTier'],
    resourceCost: Number(cost.payload.amount),
    narrative: String(narrative.payload.text),
    preRollReaction: ['OPEN', 'EVALUATE_ZERO_ELIGIBLE', 'CLOSE'],
    rawRoll: Number(die.payload.rawValue),
    modifiedRollRaw: Number(die.payload.modifiedRollRaw),
    ertRoll: Number(die.payload.ertRoll),
    ertResult: Number(ert.payload.result),
    generatedType: influenceResolution.incomingType,
    generatedCount: influenceResolution.generatedCount,
    consumedInCancellation: influenceResolution.consumedInCancellation,
    oppositeRemovedByAttribution: structuredClone(influenceResolution.oppositeRemovedByAttribution),
    placedCount: influenceResolution.placedCount,
    legitimacyBefore,
    legitimacyAfter,
    vpBefore,
    vpAfter,
    vpDelta: vpAfter - vpBefore,
    eventRefs: activationEvents.map(({ id }) => id),
    ledgerRefs,
    preStateHash,
    postStateHash,
    versions: structuredClone(state.versions),
  };
};

/** Replays an integrity-protected M1-2 artifact bundle without consulting RNG. */
export const replayM1Events = (
  initialSnapshot: M1StateSnapshot,
  bundle: M1ReplayBundle,
): SetupGameState => {
  const state = rehydrateM1StateSnapshot(initialSnapshot);
  const { events, traces } = rehydrateReplayBundle(bundle);
  const activationStarts = new Map<string, { readonly eventIndex: number; readonly preStateHash: string }>();
  let pendingActionPreHash: string | undefined;
  const replayedTraceIds = new Set<string>();
  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex];
    if (event === undefined) throw new Error('Replay event missing');
    if (event.sequenceNumber !== state.events.length + 1) throw new Error('Replay event sequence gap');
    if (event.gameId !== state.id) throw new Error('Replay event game mismatch');
    state.version = Math.max(state.version, event.gameVersion);
    const payload = event.payload;
    switch (event.type) {
      case 'ACTION_REVEALED': {
        pendingActionPreHash = hashM1GameplayState(state, event.gameVersion - 1);
        const participantId = String(payload.participantId);
        const sequenceIndex = Number(payload.sequenceIndex);
        const slot = state.actionPlanning[participantId]?.lockedSlots.find((candidate) => candidate.sequenceIndex === sequenceIndex);
        if (slot === undefined) throw new Error('Replay action slot missing');
        slot.revealed = true;
        state.currentRevealedAction = { participantId, sequenceIndex, actionType: slot.actionType };
        break;
      }
      case 'CAMPAIGN_ACTIVATION_STARTED': {
        const activationId = String(payload.activationId);
        if (pendingActionPreHash === undefined || payload.preStateHash !== pendingActionPreHash) {
          throw new Error('Replay activation pre-state hash mismatch');
        }
        activationStarts.set(activationId, { eventIndex: eventIndex - 1, preStateHash: pendingActionPreHash });
        pendingActionPreHash = undefined;
        break;
      }
      case 'NARRATIVE_REQUESTED': {
        state.adjudication.pendingResolution = parseCanonicalRecord<PendingResolution>(
          payload.pendingResolutionJson,
          payload.pendingResolutionDigest,
          'Narrative pending resolution',
        );
        state.adjudication.scheduler.status = 'SUSPENDED';
        break;
      }
      case 'NARRATIVE_SUBMITTED': {
        const campaignId = String(payload.campaignId);
        state.adjudication.narrativesByCampaign[campaignId] = {
          inputId: String(payload.inputId),
          text: String(payload.text),
          source: String(payload.source) as CampaignNarrativeProvenance['source'],
          actorId: event.actorId,
          actorParticipantId: event.actorParticipantId,
          correlationId: event.correlationId,
          causationId: String(payload.inputCausationId ?? event.causationId ?? event.eventId),
        };
        if (state.adjudication.pendingResolution?.kind === 'NARRATIVE') {
          delete state.adjudication.pendingResolution;
          state.adjudication.scheduler.status = 'READY';
        }
        break;
      }
      case 'CAMPAIGN_CREATED': {
        const participantId = String(payload.participantId);
        const campaignId = String(payload.campaignId);
        const assignmentInputs = [
          ['INTENT', String(payload.intentCardInstanceId)],
          ['METHOD', String(payload.methodCardInstanceId)],
          ['AMPLIFIER', String(payload.amplifierCardInstanceId)],
        ] as const;
        const assignments: M1CampaignAssignment[] = assignmentInputs.flatMap(([assignedSlot, cardId]) => {
          if (cardId.length === 0) return [];
          const card = state.cards[cardId];
          const rule = card === undefined ? undefined : state.adjudication.campaignCardRules[card.definitionId];
          const influenceValue = rule?.influenceValueBySlot[assignedSlot];
          if (card === undefined || influenceValue === undefined) throw new Error('Replay campaign card definition missing');
          card.zone = 'CAMPAIGN';
          const strategy = state.strategy[participantId];
          if (strategy !== undefined) strategy.handCardInstanceIds = strategy.handCardInstanceIds.filter((id) => id !== cardId);
          return [{ slot: assignedSlot, cardInstanceId: cardId, definitionId: card.definitionId, influenceValue }];
        });
        state.adjudication.campaigns[campaignId] = {
          id: campaignId,
          ownerParticipantId: participantId,
          row: 'I',
          alignment: String(payload.alignment) as CampaignAlignment,
          targetDtId: String(payload.targetDtId),
          assignments,
          activationCountThisTurn: 0,
        };
        break;
      }
      case 'CAMPAIGN_COST_PAID': {
        const countryId = String(payload.countryId) as CountryId;
        const participantId = String(payload.participantId);
        const balanceAfter = Number(payload.balanceAfter);
        state.countries[countryId].resources = balanceAfter;
        state.resourceLedger.push({
          id: String(payload.ledgerId), participantId, countryId, reason: 'CAMPAIGN_ACTIVATION_COST',
          delta: -Number(payload.amount), balanceAfter, gameVersion: event.gameVersion,
        });
        break;
      }
      case 'DIE_ROLLED':
        state.adjudication.dieRolls.push({
          id: String(payload.dieRollId), source: 'CAMPAIGN_ERT', participantId: String(payload.participantId),
          rawValue: Number(payload.rawValue), manual: false, rngRequestId: String(payload.rngRequestId), gameVersion: event.gameVersion,
        });
        break;
      case 'INFLUENCE_MUTATED': {
        const pdId = String(payload.pdId);
        const type = String(payload.type) as CampaignAlignment;
        const attributionCountryId = String(payload.attributionCountryId) as CountryId;
        let stack = state.adjudication.influenceStacks.find((candidate) => candidate.pdId === pdId && candidate.type === type && candidate.attributionCountryId === attributionCountryId);
        if (stack === undefined) {
          stack = { pdId, type, attributionCountryId, count: 0 };
          state.adjudication.influenceStacks.push(stack);
        }
        stack.count = Number(payload.balanceAfter);
        state.adjudication.influenceLedger.push({
          id: String(payload.ledgerId), pdId, type, attributionCountryId,
          reason: String(payload.reason) as 'CANCELLED_BY_2_TO_1' | 'PLACED', delta: Number(payload.delta),
          balanceAfter: stack.count, gameVersion: event.gameVersion,
        });
        break;
      }
      case 'LEGITIMACY_CHANGED': {
        const pdId = String(payload.pdId);
        const previousParticipantId = String(payload.previousParticipantId) || null;
        const newParticipantId = String(payload.newParticipantId) || null;
        state.adjudication.legitimacyByPd[pdId] = newParticipantId;
        state.adjudication.legitimacyLedger.push({
          id: String(payload.ledgerId), pdId, previousParticipantId, newParticipantId,
          reason: String(payload.reason) as 'CAMPAIGN_ESTABLISH' | 'CAMPAIGN_SUBVERT', gameVersion: event.gameVersion,
        });
        break;
      }
      case 'VP_CHANGED': {
        const participantId = String(payload.participantId);
        const balanceAfter = Number(payload.balanceAfter);
        state.adjudication.vpByParticipant[participantId] = balanceAfter;
        state.adjudication.vpLedger.push({
          id: String(payload.ledgerId), participantId,
          reason: String(payload.reason) as 'CAMPAIGN_CUBE_PLACED' | 'CAMPAIGN_BACKLASH' | 'LEGITIMACY_ESTABLISHED' | 'LEGITIMACY_SUBVERTED',
          delta: Number(payload.delta), balanceAfter, gameVersion: event.gameVersion,
        });
        break;
      }
      case 'CHOICE_RESOLVED':
        state.adjudication.resolvedChoiceIds.push(String(payload.choiceId));
        delete state.adjudication.pendingResolution;
        break;
      case 'CHOICE_REQUESTED':
        state.adjudication.pendingResolution = parseCanonicalRecord<PendingResolution>(
          payload.pendingResolutionJson,
          payload.pendingResolutionDigest,
          'Choice pending resolution',
        );
        state.adjudication.scheduler.status = 'SUSPENDED';
        break;
      case 'ACTION_RESOLVED': {
        const participantId = String(payload.participantId);
        const sequenceIndex = Number(payload.sequenceIndex);
        const slot = state.actionPlanning[participantId]?.lockedSlots.find((candidate) => candidate.sequenceIndex === sequenceIndex);
        if (slot === undefined) throw new Error('Replay resolved action slot missing');
        slot.terminalOutcome = String(payload.outcome) === 'FAILED_COST' ? 'FAILED_COST' : 'RESOLVED';
        replayAdvanceCursor(state);
        break;
      }
      case 'CAMPAIGN_ACTIVATION_COMPLETED': {
        const campaign = state.adjudication.campaigns[String(payload.campaignId)];
        if (campaign === undefined) throw new Error('Replay completed campaign missing');
        campaign.activationCountThisTurn += 1;
        const influenceResolution = parseCanonicalRecord<SetupGameState['adjudication']['influenceResolutions'][number]>(
          payload.influenceResolutionJson,
          payload.influenceResolutionDigest,
          'Influence resolution',
        );
        state.adjudication.influenceResolutions.push(influenceResolution);
        const traceId = String(payload.traceId);
        const persistedTrace = traces.find(({ id }) => id === traceId);
        const activation = activationStarts.get(String(payload.activationId));
        if (persistedTrace === undefined || activation === undefined) throw new Error('Replay trace missing');
        const activationEvents = events.slice(activation.eventIndex, eventIndex + 1);
        const postStateHash = hashM1GameplayState(state, event.gameVersion);
        const reconstructed = reconstructTrace(
          state,
          activationEvents,
          activation.preStateHash,
          postStateHash,
        );
        if (canonicalizeJson(reconstructed) !== canonicalizeJson(persistedTrace)) {
          throw new Error('Replay trace does not match reconstructed artifacts');
        }
        if (payload.traceDigest !== sha256CanonicalJson(reconstructed)) throw new Error('Replay trace event digest mismatch');
        state.adjudication.traces.push(reconstructed);
        replayedTraceIds.add(traceId);
        break;
      }
      default:
        break;
    }
    state.events.push(structuredClone(event));
  }
  if (replayedTraceIds.size !== traces.length) throw new Error('Replay contains unauthenticated traces');
  return state;
};

interface LocatedSlot {
  readonly participantId: string;
  readonly slot: M1ActionPlanSlot;
}

interface ActivationPending {
  readonly kind: 'PENDING';
  readonly pending: PendingResolution;
  readonly eventRefs: readonly string[];
}

interface ActivationComplete {
  readonly kind: 'COMPLETE';
  readonly traceId: string;
  readonly eventRefs: readonly string[];
}

interface ActivationFailed {
  readonly kind: 'FAILED_COST';
  readonly eventRefs: readonly string[];
}

type ActivationOutcome = ActivationPending | ActivationComplete | ActivationFailed | { readonly error: AnyEngineErrorCode };

export class M1AdjudicationEngine {
  constructor(
    private readonly store: InMemorySetupGameStore,
    private readonly random: TransactionalRandomProvider,
    private readonly now: () => Date,
    private readonly randomTransactionOwner: 'ENGINE' | 'APPLICATION' = 'ENGINE',
  ) {}

  runNext(options: SchedulerRunOptions): EngineCommandResult {
    const envelope = this.internalEnvelope(options);
    return this.withTransactionalRandom((deferStableNotification) => dispatchAtomicCommand({
      envelope,
      store: this.store,
      now: this.now,
      prepare: (before, candidate) => this.prepareScheduler(before, candidate),
      deferStableNotification,
    }));
  }

  runUntilBlocked(options: Omit<SchedulerRunOptions, 'expectedGameVersion' | 'commandId' | 'idempotencyKey'>): readonly EngineCommandResult[] {
    const results: EngineCommandResult[] = [];
    for (let guard = 0; guard < 100; guard += 1) {
      const state = this.store.snapshot(options.gameId);
      if (state === undefined || state.adjudication.scheduler.status === 'COMPLETE' || state.adjudication.pendingResolution !== undefined) return results;
      const suffix = `${state.version}:${state.adjudication.scheduler.participantIndex}:${state.adjudication.scheduler.slotIndex}`;
      const result = this.runNext({
        ...options,
        expectedGameVersion: state.version,
        commandId: `m1-scheduler:${suffix}`,
        idempotencyKey: `m1-scheduler:${suffix}`,
      });
      results.push(result);
      if (result.status !== 'RESOLVED') return results;
    }
    throw new Error('M1 scheduler exceeded its deterministic guard');
  }

  dispatchInteraction(envelope: InteractionEnvelope): EngineCommandResult {
    const beforeVersion = this.store.snapshot(envelope.gameId)?.version ?? 0;
    if (envelope.commandType !== 'SUBMIT_CHOICE' && envelope.commandType !== 'SUBMIT_CAMPAIGN_NARRATIVE') {
      return rejectedResult(envelope, beforeVersion, 'NOT_AUTHORIZED', this.now);
    }
    return this.withTransactionalRandom((deferStableNotification) => dispatchAtomicCommand({
      envelope,
      store: this.store,
      now: this.now,
      validatePayload: ({ commandType, payload }) => commandType === 'SUBMIT_CHOICE'
        ? isSubmitChoicePayload(payload) ? undefined : 'INVALID_COMMAND_PAYLOAD'
        : isSubmitCampaignNarrativePayload(payload) ? undefined : 'INVALID_COMMAND_PAYLOAD',
      prepare: (before, candidate) => candidate.commandType === 'SUBMIT_CHOICE'
        ? this.prepareChoice(before, candidate)
        : this.prepareNarrative(before, candidate),
      deferStableNotification,
    }));
  }

  private withTransactionalRandom(
    operation: (deferStableNotification: (notify: () => void) => void) => EngineCommandResult,
  ): EngineCommandResult {
    if (this.randomTransactionOwner === 'APPLICATION') {
      // The durable application boundary owns checkpoint/restore/commit so the
      // RNG cannot become stable before PostgreSQL commits its CAS transaction.
      return operation(() => undefined);
    }
    const checkpoint = this.random.checkpoint();
    let notifyStableCommit: (() => void) | undefined;
    try {
      const result = operation((notify) => { notifyStableCommit = notify; });
      if (result.status === 'REJECTED') this.random.restore(checkpoint);
      else {
        this.random.commit(checkpoint);
        notifyStableCommit?.();
      }
      return result;
    } catch (error) {
      this.random.restore(checkpoint);
      throw error;
    }
  }

  private internalEnvelope(options: SchedulerRunOptions): InternalEnvelope {
    return {
      engineContractVersion: M1_0_BASELINE_VERSIONS.engineContractVersion,
      commandId: options.commandId,
      idempotencyKey: options.idempotencyKey,
      gameId: options.gameId,
      actorContext: {
        actorId: 'M1_INTERNAL_SCHEDULER',
        actorType: 'SYSTEM',
        authenticatedSessionId: 'internal:m1-2',
        permissions: ['game:internal-scheduler'],
      },
      expectedGameVersion: options.expectedGameVersion,
      commandType: 'INTERNAL_RUN_M1_SCHEDULER',
      payloadSchemaVersion: M1_0_BASELINE_VERSIONS.fixtureSchemaVersion,
      payload: {},
      ...(options.correlationId === undefined ? {} : { correlationId: options.correlationId }),
    };
  }

  private prepareScheduler(before: SetupGameState | undefined, envelope: InternalEnvelope) {
    const version = before?.version ?? 0;
    if (before === undefined) return { error: 'GAME_NOT_FOUND' as const, version };
    if (envelope.expectedGameVersion !== before.version) return { error: 'STALE_STATE_VERSION' as const, version };
    if (before.phase !== 'RESOLUTION_STAGE') return { error: 'WRONG_PHASE' as const, version };
    if (before.overlay === 'PAUSED') return { error: 'GAME_PAUSED' as const, version };
    if (before.adjudication.pendingResolution !== undefined) return { error: 'SCHEDULER_SUSPENDED' as const, version };
    if (before.adjudication.scheduler.status === 'COMPLETE') return { error: 'SCHEDULER_COMPLETE' as const, version };

    const working = structuredClone(before);
    const located = this.locateNextSlot(working);
    if (located === undefined) return { error: 'SCHEDULER_COMPLETE' as const, version };
    const { participantId, slot } = located;
    if (slot.actionType === 'ACTIVATE_CAMPAIGN' && before.diceMode !== 'DIGITAL') {
      return { error: 'INVALID_DICE_MODE' as const, version };
    }
    const preStateHash = hashAuthoritativeM1State(before);
    const reveal = this.appendEvent(working, envelope, 'ACTION_REVEALED', {
      participantId,
      sequenceIndex: slot.sequenceIndex,
      actionType: slot.actionType,
    });
    slot.revealed = true;
    working.currentRevealedAction = { participantId, sequenceIndex: slot.sequenceIndex, actionType: slot.actionType };

    if (slot.actionType === 'CONSTRUCT_CAMPAIGN') {
      const constructed = this.constructCampaign(working, participantId, slot, envelope, reveal.id);
      if ('error' in constructed) return { error: constructed.error, version };
      slot.terminalOutcome = 'RESOLVED';
      this.advanceScheduler(working);
      const resolved = this.appendEvent(working, envelope, 'ACTION_RESOLVED', {
        participantId,
        sequenceIndex: slot.sequenceIndex,
        outcome: 'RESOLVED',
      }, constructed.event.id);
      return {
        nextState: working,
        resultCode: 'ACTION_SLOT_RESOLVED',
        resultPayload: { participantId, sequenceIndex: slot.sequenceIndex, actionType: slot.actionType },
        emittedEventRefs: [reveal.id, constructed.event.id, resolved.id],
      };
    }

    const activation = this.resolveActivation(working, participantId, slot, envelope, preStateHash, [reveal.id]);
    if ('error' in activation) return { error: activation.error, version };
    if (activation.kind === 'PENDING') {
      if (activation.pending.kind === 'NARRATIVE') {
        return {
          nextState: working,
          status: 'REQUIRES_CHOICE' as const,
          resultCode: 'NARRATIVE_REQUIRED',
          resultPayload: structuredClone(activation.pending.narrativeRequest),
          emittedEventRefs: activation.eventRefs,
        };
      }
      return {
        nextState: working,
        status: 'REQUIRES_CHOICE' as const,
        resultCode: 'CHOICE_REQUIRED',
        resultPayload: structuredClone(activation.pending.choice),
        emittedEventRefs: activation.eventRefs,
      };
    }
    return {
      nextState: working,
      resultCode: activation.kind === 'FAILED_COST' ? 'COST_PAYMENT_FAILED' : 'CAMPAIGN_ACTIVATION_COMPLETED',
      emittedEventRefs: activation.eventRefs,
      ...(activation.kind === 'COMPLETE' ? { adjudicationTraceRefs: [activation.traceId] } : {}),
    };
  }

  private locateNextSlot(state: SetupGameState): LocatedSlot | undefined {
    const cursor = state.adjudication.scheduler;
    while (cursor.participantIndex < state.initiative.orderParticipantIds.length) {
      const participantId = state.initiative.orderParticipantIds[cursor.participantIndex];
      const slots = participantId === undefined ? undefined : state.actionPlanning[participantId]?.lockedSlots;
      if (participantId !== undefined && slots !== undefined && cursor.slotIndex < slots.length) {
        const slot = slots[cursor.slotIndex];
        if (slot !== undefined) return { participantId, slot };
      }
      cursor.participantIndex += 1;
      cursor.slotIndex = 0;
    }
    cursor.status = 'COMPLETE';
    delete state.currentRevealedAction;
    return undefined;
  }

  private advanceScheduler(state: SetupGameState): void {
    const cursor = state.adjudication.scheduler;
    cursor.slotIndex += 1;
    cursor.status = 'READY';
    delete state.currentRevealedAction;
    this.locateNextSlot(state);
  }

  private constructCampaign(
    state: SetupGameState,
    participantId: string,
    slot: M1ActionPlanSlot,
    envelope: InternalEnvelope,
    causationId: string,
  ): { readonly event: SetupGameEvent } | { readonly error: AnyEngineErrorCode } {
    const payload = slot.actionPayload;
    if (!('intentCardInstanceId' in payload)) return { error: 'INVALID_COMMAND_PAYLOAD' };
    const campaignId = `${state.id}:campaign:${participantId}:row-i`;
    if (state.adjudication.campaigns[campaignId] !== undefined) return { error: 'CAMPAIGN_ID_CONFLICT' };
    if (Object.values(state.adjudication.campaigns).some((campaign) => campaign.ownerParticipantId === participantId && campaign.row === 'I')) {
      return { error: 'CAMPAIGN_ROW_OCCUPIED' };
    }
    const cardIds = [payload.intentCardInstanceId, payload.methodCardInstanceId, ...(payload.amplifierCardInstanceId === undefined ? [] : [payload.amplifierCardInstanceId])];
    if (new Set(cardIds).size !== cardIds.length) return { error: 'DUPLICATE_CARD_INSTANCE' };
    const cardInstances = cardIds.map((cardId) => state.cards[cardId]);
    if (cardInstances.some((card) => card?.controllerParticipantId !== participantId)) return { error: 'CARD_NOT_CONTROLLED' };
    if (cardInstances.some((card) => card?.zone !== 'HAND')) return { error: 'CARD_WRONG_ZONE' };
    const [intent, method, amplifier] = cardInstances;
    if (intent === undefined || method === undefined) return { error: 'CAMPAIGN_INVALID_STRUCTURE' };
    const intentRule = state.adjudication.campaignCardRules[intent.definitionId];
    const methodRule = state.adjudication.campaignCardRules[method.definitionId];
    const amplifierRule = amplifier === undefined ? undefined : state.adjudication.campaignCardRules[amplifier.definitionId];
    if (intentRule?.influenceValueBySlot.INTENT === undefined || methodRule?.influenceValueBySlot.METHOD === undefined || (amplifier !== undefined && amplifierRule?.influenceValueBySlot.AMPLIFIER === undefined)) {
      return { error: 'CARD_NOT_ELIGIBLE' };
    }
    if (intentRule.alignment === 'DUAL') return { error: 'CAMPAIGN_ALIGNMENT_MISMATCH' };
    if (![methodRule, amplifierRule].filter((rule) => rule !== undefined).every((rule) => rule.alignment === 'DUAL' || rule.alignment === intentRule.alignment)) {
      return { error: 'CAMPAIGN_ALIGNMENT_MISMATCH' };
    }
    if (!intentRule.allowsAnyTargetDt || !Object.values(state.populationDemographics).some((pd) => this.pdHasDt(pd.demographicTokenIds, payload.targetDtId))) {
      return { error: 'INVALID_DT' };
    }
    const assignments: M1CampaignAssignment[] = [
      { slot: 'INTENT', cardInstanceId: intent.id, definitionId: intent.definitionId, influenceValue: intentRule.influenceValueBySlot.INTENT },
      { slot: 'METHOD', cardInstanceId: method.id, definitionId: method.definitionId, influenceValue: methodRule.influenceValueBySlot.METHOD },
      ...(amplifier === undefined || amplifierRule?.influenceValueBySlot.AMPLIFIER === undefined ? [] : [{ slot: 'AMPLIFIER' as const, cardInstanceId: amplifier.id, definitionId: amplifier.definitionId, influenceValue: amplifierRule.influenceValueBySlot.AMPLIFIER }]),
    ];
    const campaign: M1CampaignState = {
      id: campaignId,
      ownerParticipantId: participantId,
      row: 'I',
      alignment: intentRule.alignment,
      targetDtId: payload.targetDtId,
      assignments,
      activationCountThisTurn: 0,
    };
    state.adjudication.campaigns[campaignId] = campaign;
    const strategy = state.strategy[participantId];
    for (const card of cardInstances) {
      if (card === undefined) continue;
      card.zone = 'CAMPAIGN';
      if (strategy !== undefined) strategy.handCardInstanceIds = strategy.handCardInstanceIds.filter((id) => id !== card.id);
    }
    const event = this.appendEvent(state, envelope, 'CAMPAIGN_CREATED', {
      campaignId,
      participantId,
      alignment: campaign.alignment,
      targetDtId: campaign.targetDtId,
      intentCardInstanceId: intent.id,
      methodCardInstanceId: method.id,
      amplifierCardInstanceId: amplifier?.id ?? '',
    }, causationId);
    return { event };
  }

  private resolveActivation(
    state: SetupGameState,
    participantId: string,
    slot: M1ActionPlanSlot,
    envelope: InternalEnvelope,
    preStateHash: string,
    eventRefs: string[],
  ): ActivationOutcome {
    const payload = slot.actionPayload;
    if (!('campaignId' in payload)) return { error: 'INVALID_COMMAND_PAYLOAD' };
    const campaign = state.adjudication.campaigns[payload.campaignId];
    if (campaign === undefined) return { error: 'CAMPAIGN_NOT_FOUND' };
    if (campaign.ownerParticipantId !== participantId) return { error: 'CAMPAIGN_NOT_OWNED' };
    if (state.vetoBlockedParticipantIdsThisTurn?.includes(participantId) === true) return { error: 'CAMPAIGN_ALREADY_ACTIVATED' };
    if (campaign.activationCountThisTurn > 0) return { error: 'CAMPAIGN_ALREADY_ACTIVATED' };
    const targetPdId = payload.requestedTargetPdId;
    if (targetPdId === undefined) return { error: 'INVALID_TARGET_PD' };
    const target = targetPdId === undefined ? undefined : state.populationDemographics[targetPdId];
    if (target === undefined) return { error: 'INVALID_TARGET_PD' };
    if (!this.pdHasDt(target.demographicTokenIds, campaign.targetDtId)) return { error: 'INVALID_DT' };
    const countryId = countryForParticipant(state, participantId);
    if (countryId === undefined) return { error: 'INVALID_ACTOR_CONTEXT' };
    const components: AssignedCampaignComponent[] = campaign.assignments.map(({ slot: assignedSlot, influenceValue }) => ({
      slot: assignedSlot,
      influenceValueBySlot: { [assignedSlot]: influenceValue },
    }));
    const definitionIds = new Set(campaign.assignments.map(({ definitionId }) => definitionId));
    const pairKeys = new Set<string>();
    for (const definitionId of definitionIds) {
      const pair = state.adjudication.campaignCardRules[definitionId]?.pairBonusWithDefinitionId;
      if (pair !== undefined && definitionIds.has(pair)) pairKeys.add([definitionId, pair].sort().join(':'));
    }
    const value = calculateCampaignValue(components, [...pairKeys].map(() => 2));
    const country = state.countries[countryId];
    if (country.resources < value.baseCost) {
      slot.terminalOutcome = 'FAILED_COST';
      this.advanceScheduler(state);
      const failed = this.appendEvent(state, envelope, 'ACTION_RESOLVED', {
        participantId,
        sequenceIndex: slot.sequenceIndex,
        outcome: 'FAILED_COST',
        errorCode: 'COST_PAYMENT_FAILED',
      }, eventRefs.at(-1));
      return { kind: 'FAILED_COST', eventRefs: [...eventRefs, failed.id] };
    }

    const activationId = `${campaign.id}:activation:${campaign.activationCountThisTurn + 1}`;
    const started = this.appendEvent(state, envelope, 'CAMPAIGN_ACTIVATION_STARTED', {
      activationId,
      campaignId: campaign.id,
      participantId,
      targetPdId,
      preStateHash,
    }, eventRefs.at(-1));
    eventRefs.push(started.id);
    const continuation: NarrativeContinuationState = {
      kind: 'CAMPAIGN_NARRATIVE',
      targetPdId,
      countryId,
      baseCv: value.baseCv,
      effectiveCv: value.rawEffectiveCv,
      baseTier: value.baseTier,
      resolutionTier: value.resolutionTier,
      resourceCost: value.baseCost,
      preStateHash,
      eventRefsBeforeNarrative: [...eventRefs],
    };
    const narrative = state.adjudication.narrativesByCampaign[campaign.id];
    if (narrative === undefined) {
      const requestId = `${activationId}:narrative-request`;
      const requestEventId = `${state.id}:event:${state.events.length + 1}`;
      const pending: NarrativePendingResolution = {
        kind: 'NARRATIVE',
        resolutionId: activationId,
        gameId: state.id,
        participantId,
        sequenceIndex: slot.sequenceIndex,
        campaignId: campaign.id,
        correlationId: envelope.correlationId ?? envelope.commandId,
        causationId: requestEventId,
        versions: structuredClone(state.versions),
        narrativeRequest: {
          requestId,
          gameId: state.id,
          campaignId: campaign.id,
          actorParticipantId: participantId,
          status: 'OPEN',
          visibilityScope: 'OWNER_AND_FACILITATOR',
        },
        continuation,
      };
      const pendingResolutionJson = canonicalizeJson(pending);
      const requestEvent = this.appendEvent(state, envelope, 'NARRATIVE_REQUESTED', {
        requestId,
        campaignId: campaign.id,
        actorParticipantId: participantId,
        ownerParticipantId: participantId,
        pendingResolutionJson,
        pendingResolutionDigest: sha256CanonicalJson(pending),
      }, started.id, 'OWNER_AND_FACILITATOR');
      if (requestEvent.id !== requestEventId) throw new Error('Narrative request event identity drift');
      eventRefs.push(requestEvent.id);
      state.adjudication.pendingResolution = pending;
      state.adjudication.scheduler.status = 'SUSPENDED';
      return { kind: 'PENDING', pending, eventRefs };
    }
    const narrativeEvent = this.appendNarrativeEvent(state, envelope, narrative, activationId, campaign.id, started.id);
    eventRefs.push(narrativeEvent.id);
    return this.continueActivationAfterNarrative(
      state,
      participantId,
      slot,
      envelope,
      campaign,
      continuation,
      eventRefs,
    );
  }

  private continueActivationAfterNarrative(
    state: SetupGameState,
    participantId: string,
    slot: M1ActionPlanSlot,
    envelope: InternalEnvelope,
    campaign: M1CampaignState,
    narrativeContinuation: NarrativeContinuationState,
    eventRefs: string[],
  ): ActivationOutcome {
    const {
      targetPdId,
      countryId,
      baseCv,
      effectiveCv,
      baseTier,
      resolutionTier,
      resourceCost,
      preStateHash,
    } = narrativeContinuation;
    const activationId = `${campaign.id}:activation:${campaign.activationCountThisTurn + 1}`;
    for (const [type, stage] of [
      ['PRE_ROLL_REACTION_OPENED', 'OPEN'],
      ['PRE_ROLL_REACTION_EVALUATED', 'EVALUATE_ZERO_ELIGIBLE'],
      ['PRE_ROLL_REACTION_CLOSED', 'CLOSE'],
    ] as const) {
      const event = this.appendEvent(state, envelope, type, { activationId, stage, eligibleCount: 0 }, eventRefs.at(-1));
      eventRefs.push(event.id);
    }

    const country = state.countries[countryId];
    if (country.resources < resourceCost) return { error: 'COST_PAYMENT_FAILED' };
    const resourceBefore = country.resources;
    country.resources -= resourceCost;
    const resourceLedgerId = `${state.id}:resource-ledger:${state.resourceLedger.length + 1}`;
    state.resourceLedger.push({
      id: resourceLedgerId,
      participantId,
      countryId,
      reason: 'CAMPAIGN_ACTIVATION_COST',
      delta: -resourceCost,
      balanceAfter: country.resources,
      gameVersion: state.version + 1,
    });
    const costEvent = this.appendEvent(state, envelope, 'CAMPAIGN_COST_PAID', {
      activationId,
      participantId,
      countryId,
      amount: resourceCost,
      balanceAfter: country.resources,
      ledgerId: resourceLedgerId,
    }, eventRefs.at(-1));
    eventRefs.push(costEvent.id);

    let rawRoll: number;
    try {
      rawRoll = this.randomInteger(1, 10);
    } catch {
      return { error: 'RANDOM_PROVIDER_FAILURE' };
    }
    const legitimacyBefore = state.adjudication.legitimacyByPd[targetPdId] ?? null;
    const legitimacyModifier = legitimacyBefore === participantId ? 1 : 0;
    const normalized = normalizeErtRoll(rawRoll + legitimacyModifier);
    const dieRollId = `${state.id}:die-roll:${state.adjudication.dieRolls.length + 1}`;
    const rngRequestId = `${state.id}:rng:campaign:${state.adjudication.dieRolls.length + 1}`;
    state.adjudication.dieRolls.push({
      id: dieRollId,
      source: 'CAMPAIGN_ERT',
      participantId,
      rawValue: rawRoll,
      manual: false,
      rngRequestId,
      gameVersion: state.version + 1,
    });
    const dieEvent = this.appendEvent(state, envelope, 'DIE_ROLLED', {
      activationId,
      dieRollId,
      source: 'CAMPAIGN_ERT',
      participantId,
      rawValue: rawRoll,
      manual: false,
      rngRequestId,
      legitimacyModifier,
      modifiedRollRaw: normalized.modifiedRollRaw,
      ertRoll: normalized.ertRoll,
    }, eventRefs.at(-1));
    eventRefs.push(dieEvent.id);
    const ertResult = lookupErt(resolutionTier, campaign.alignment, normalized.ertRoll);
    const ertEvent = this.appendEvent(state, envelope, 'ERT_RESOLVED', {
      activationId,
      alignment: campaign.alignment,
      baseCv,
      effectiveCv,
      baseTier,
      resolutionTier,
      result: ertResult,
    }, dieEvent.id);
    eventRefs.push(ertEvent.id);

    const generatedType = ertResult >= 0 ? campaign.alignment : oppositeType(campaign.alignment);
    const generatedCount = Math.abs(ertResult);
    const opposite = oppositeType(generatedType);
    const oppositeStacks = state.adjudication.influenceStacks.filter((stack) => stack.pdId === targetPdId && stack.type === opposite && stack.count > 0);
    const resolution = resolveTwoToOne(generatedCount, oppositeStacks.reduce((sum, stack) => sum + stack.count, 0));
    const distinctAttributions = new Set(oppositeStacks.map(({ attributionCountryId }) => attributionCountryId));
    const continuationBase = {
      kind: 'CAMPAIGN_2_TO_1' as const,
      participantId,
      sequenceIndex: slot.sequenceIndex,
      campaignId: campaign.id,
      activationId,
      targetPdId,
      generatedType,
      generatedAttributionCountryId: countryId,
      generatedCount,
      removalsRequired: resolution.oppositeRemoved,
      resourceBalanceBefore: resourceBefore,
      vpBefore: state.adjudication.vpByParticipant[participantId] ?? 0,
      legitimacyBefore,
      baseCv,
      effectiveCv,
      baseTier,
      resolutionTier,
      resourceCost,
      rawRoll,
      modifiedRollRaw: normalized.modifiedRollRaw,
      ertRoll: normalized.ertRoll,
      ertResult,
      preStateHash,
      eventRefsBeforeChoice: [...eventRefs],
      ledgerRefsBeforeChoice: [resourceLedgerId],
    };
    if (resolution.oppositeRemoved > 0 && distinctAttributions.size > 1) {
      const choiceId = `${activationId}:choice:opposite-attribution`;
      const sortedAttributions = [...distinctAttributions].sort();
      const options = sortedAttributions.map((_, index) => ({
        optionId: `${choiceId}:option:${index + 1}`,
        optionType: 'OPPOSITE_ATTRIBUTION' as const,
      }));
      const optionAttributionById: Record<string, CountryId> = {};
      for (let index = 0; index < options.length; index += 1) {
        const option = options[index];
        const attribution = sortedAttributions[index];
        if (option !== undefined && attribution !== undefined) optionAttributionById[option.optionId] = attribution;
      }
      const choiceEventId = `${state.id}:event:${state.events.length + 1}`;
      const continuation: CampaignContinuationState = {
        ...continuationBase,
        optionAttributionById,
        eventRefsBeforeChoice: [...eventRefs, choiceEventId],
      };
      const choice = {
        choiceId,
        choiceVersion: 1,
        gameId: state.id,
        choiceType: 'SELECT_OPPOSITE_ATTRIBUTION_TO_REMOVE' as const,
        actorParticipantId: participantId,
        sourceResolutionId: activationId,
        visibilityScope: 'OWNER_AND_FACILITATOR' as const,
        status: 'OPEN' as const,
        selectionMode: 'ORDERED' as const,
        minSelections: resolution.oppositeRemoved,
        maxSelections: resolution.oppositeRemoved,
        options,
      };
      const pending: PendingResolution = {
        kind: 'CHOICE',
        resolutionId: activationId,
        gameId: state.id,
        participantId,
        sequenceIndex: slot.sequenceIndex,
        campaignId: campaign.id,
        correlationId: envelope.correlationId ?? envelope.commandId,
        causationId: choiceEventId,
        versions: structuredClone(state.versions),
        choice,
        continuation,
      };
      const pendingResolutionJson = canonicalizeJson(pending);
      const choiceEvent = this.appendEvent(state, envelope, 'CHOICE_REQUESTED', {
        choiceId,
        choiceVersion: 1,
        actorParticipantId: participantId,
        ownerParticipantId: participantId,
        optionCount: options.length,
        minSelections: resolution.oppositeRemoved,
        maxSelections: resolution.oppositeRemoved,
        pendingResolutionJson,
        pendingResolutionDigest: sha256CanonicalJson(pending),
      }, eventRefs.at(-1), 'OWNER_AND_FACILITATOR');
      if (choiceEvent.id !== choiceEventId) throw new Error('Choice request event identity drift');
      eventRefs.push(choiceEvent.id);
      state.adjudication.pendingResolution = pending;
      state.adjudication.scheduler.status = 'SUSPENDED';
      return { kind: 'PENDING', pending, eventRefs };
    }

    const automaticSelections = this.automaticAttributionSelections(oppositeStacks, resolution.oppositeRemoved);
    return this.completeActivation(state, slot, envelope, campaign, continuationBase, automaticSelections, eventRefs, [resourceLedgerId]);
  }

  private automaticAttributionSelections(stacks: readonly InfluenceStackState[], removals: number): CountryId[] {
    const selections: CountryId[] = [];
    for (const stack of [...stacks].sort((left, right) => left.attributionCountryId.localeCompare(right.attributionCountryId))) {
      for (let count = 0; count < stack.count && selections.length < removals; count += 1) selections.push(stack.attributionCountryId);
    }
    return selections;
  }

  private prepareNarrative(before: SetupGameState | undefined, envelope: InteractionEnvelope): PreparedResolution<SetupGameState> {
    const version = before?.version ?? 0;
    if (before === undefined) return { error: 'GAME_NOT_FOUND' as const, version };
    if (envelope.expectedGameVersion !== before.version) return { error: 'STALE_STATE_VERSION' as const, version };
    if (before.overlay === 'PAUSED') return { error: 'GAME_PAUSED' as const, version };
    if (envelope.engineContractVersion !== before.versions.engineContractVersion) return { error: 'UNSUPPORTED_CONTRACT_VERSION' as const, version };
    if (envelope.payloadSchemaVersion !== before.versions.fixtureSchemaVersion) return { error: 'UNSUPPORTED_PAYLOAD_VERSION' as const, version };
    const payload = envelope.payload as SubmitCampaignNarrativePayload;
    const pending = before.adjudication.pendingResolution;
    if (pending === undefined || pending.kind !== 'NARRATIVE' || payload.campaignId !== pending.campaignId) {
      return { error: 'NARRATIVE_NOT_AUTHORIZED' as const, version };
    }
    const actor = envelope.actorContext;
    const participant = actor.participantId === undefined ? undefined : before.participants[actor.participantId];
    const seat = actor.participantId === undefined ? undefined : before.seats[actor.participantId];
    if (
      actor.actorType !== 'PLAYER' ||
      actor.participantId !== pending.narrativeRequest.actorParticipantId ||
      participant === undefined ||
      participant.userId !== actor.actorId ||
      seat === undefined ||
      actor.playerSeatId !== seat.id ||
      actor.countryId !== seat.countryId ||
      !actor.permissions.includes('game:play')
    ) return { error: 'NARRATIVE_NOT_AUTHORIZED' as const, version };

    const working = structuredClone(before);
    const workingPending = working.adjudication.pendingResolution;
    if (workingPending === undefined || workingPending.kind !== 'NARRATIVE') {
      return { error: 'NARRATIVE_NOT_AUTHORIZED' as const, version };
    }
    const slot = working.actionPlanning[workingPending.participantId]?.lockedSlots.find(
      ({ sequenceIndex }) => sequenceIndex === workingPending.sequenceIndex,
    );
    const campaign = working.adjudication.campaigns[workingPending.campaignId];
    if (slot === undefined || campaign === undefined) return { error: 'OBJECT_NO_LONGER_VALID' as const, version };
    const provenance: CampaignNarrativeProvenance = {
      inputId: envelope.commandId,
      text: payload.narrative.trim(),
      source: 'PLAYER',
      actorId: actor.actorId,
      actorParticipantId: workingPending.participantId,
      correlationId: envelope.correlationId ?? envelope.commandId,
      causationId: workingPending.causationId,
    };
    working.adjudication.narrativesByCampaign[campaign.id] = provenance;
    const narrativeEvent = this.appendEvent(working, envelope, 'NARRATIVE_SUBMITTED', {
      activationId: workingPending.resolutionId,
      campaignId: campaign.id,
      inputId: provenance.inputId,
      source: provenance.source,
      text: provenance.text,
      ownerParticipantId: workingPending.participantId,
    }, workingPending.causationId, 'OWNER_AND_FACILITATOR');
    delete working.adjudication.pendingResolution;
    working.adjudication.scheduler.status = 'READY';
    const systemEnvelope: InternalEnvelope = {
      ...this.internalEnvelope({
        gameId: envelope.gameId,
        expectedGameVersion: envelope.expectedGameVersion,
        commandId: envelope.commandId,
        idempotencyKey: envelope.idempotencyKey,
        correlationId: workingPending.correlationId,
      }),
      causationId: narrativeEvent.id,
    };
    const eventRefs = [...workingPending.continuation.eventRefsBeforeNarrative, narrativeEvent.id];
    const outcome = this.continueActivationAfterNarrative(
      working,
      workingPending.participantId,
      slot,
      systemEnvelope,
      campaign,
      workingPending.continuation,
      eventRefs,
    );
    if ('error' in outcome) return { error: outcome.error, version };
    if (outcome.kind === 'PENDING') {
      if (outcome.pending.kind !== 'CHOICE') return { error: 'OBJECT_NO_LONGER_VALID' as const, version };
      return {
        nextState: working,
        status: 'REQUIRES_CHOICE' as const,
        resultCode: 'CHOICE_REQUIRED',
        resultPayload: structuredClone(outcome.pending.choice),
        emittedEventRefs: outcome.eventRefs,
      };
    }
    if (outcome.kind !== 'COMPLETE') return { error: 'OBJECT_NO_LONGER_VALID' as const, version };
    return {
      nextState: working,
      resultCode: 'CAMPAIGN_ACTIVATION_COMPLETED',
      resultPayload: { campaignId: campaign.id, narrativeInputId: provenance.inputId },
      emittedEventRefs: outcome.eventRefs,
      adjudicationTraceRefs: [outcome.traceId],
    };
  }

  private appendNarrativeEvent(
    state: SetupGameState,
    envelope: InternalEnvelope,
    narrative: CampaignNarrativeProvenance,
    activationId: string,
    campaignId: string,
    causationId: string,
  ): SetupGameEvent {
    if (narrative.source !== 'FIXTURE' || narrative.actorParticipantId !== null) {
      throw new Error('Pre-seeded campaign narratives require explicit FIXTURE provenance');
    }
    const fixtureEnvelope: CommandEnvelope<string, unknown> = {
      ...envelope,
      actorContext: {
        actorId: narrative.actorId,
        actorType: 'SYSTEM',
        authenticatedSessionId: 'fixture:m1-2',
        permissions: ['game:fixture'],
      },
      correlationId: narrative.correlationId,
      causationId: narrative.causationId,
    };
    return this.appendEvent(state, fixtureEnvelope, 'NARRATIVE_SUBMITTED', {
      activationId,
      campaignId,
      inputId: narrative.inputId,
      source: narrative.source,
      text: narrative.text,
      inputCausationId: narrative.causationId,
      ownerParticipantId: state.adjudication.campaigns[campaignId]?.ownerParticipantId ?? '',
    }, causationId, 'OWNER_AND_FACILITATOR');
  }

  private prepareChoice(before: SetupGameState | undefined, envelope: InteractionEnvelope): PreparedResolution<SetupGameState> {
    const version = before?.version ?? 0;
    if (before === undefined) return { error: 'GAME_NOT_FOUND' as const, version };
    if (envelope.expectedGameVersion !== before.version) return { error: 'STALE_STATE_VERSION' as const, version };
    if (before.overlay === 'PAUSED') return { error: 'GAME_PAUSED' as const, version };
    if (envelope.engineContractVersion !== before.versions.engineContractVersion) return { error: 'UNSUPPORTED_CONTRACT_VERSION' as const, version };
    if (envelope.payloadSchemaVersion !== before.versions.fixtureSchemaVersion) return { error: 'UNSUPPORTED_PAYLOAD_VERSION' as const, version };
    const payload = envelope.payload as SubmitChoicePayload;
    const pending = before.adjudication.pendingResolution;
    if (pending === undefined) {
      return { error: before.adjudication.resolvedChoiceIds.includes(payload.choiceId) ? 'CHOICE_ALREADY_RESOLVED' as const : 'INVALID_CHOICE_OPTION' as const, version };
    }
    if (pending.kind !== 'CHOICE') return { error: 'INVALID_CHOICE_OPTION' as const, version };
    const actorError = this.validateChoiceActor(before, envelope.actorContext, pending);
    if (actorError !== undefined) return { error: actorError, version };
    if (payload.choiceId !== pending.choice.choiceId) return { error: 'INVALID_CHOICE_OPTION' as const, version };
    if (payload.choiceVersion !== pending.choice.choiceVersion) return { error: 'CHOICE_VERSION_STALE' as const, version };
    if (payload.selectedOptionIds.length !== pending.continuation.removalsRequired) return { error: 'INVALID_CHOICE_OPTION' as const, version };
    const selections = payload.selectedOptionIds.map((optionId) => pending.continuation.optionAttributionById[optionId]);
    if (selections.some((selection) => selection === undefined)) return { error: 'INVALID_CHOICE_OPTION' as const, version };
    const availableByAttribution = Object.fromEntries(before.adjudication.influenceStacks
      .filter((stack) => stack.pdId === pending.continuation.targetPdId && stack.type === oppositeType(pending.continuation.generatedType))
      .map((stack) => [stack.attributionCountryId, stack.count])) as Record<string, number>;
    for (const selection of selections) {
      if (selection === undefined || (availableByAttribution[selection] ?? 0) <= 0) return { error: 'INVALID_CHOICE_OPTION' as const, version };
      availableByAttribution[selection] = (availableByAttribution[selection] ?? 0) - 1;
    }

    const working = structuredClone(before);
    const workingPending = working.adjudication.pendingResolution;
    if (workingPending === undefined || workingPending.kind !== 'CHOICE') return { error: 'CHOICE_ALREADY_RESOLVED' as const, version };
    const slot = working.actionPlanning[workingPending.participantId]?.lockedSlots.find(({ sequenceIndex }) => sequenceIndex === workingPending.sequenceIndex);
    const campaign = working.adjudication.campaigns[workingPending.campaignId];
    if (slot === undefined || campaign === undefined) return { error: 'OBJECT_NO_LONGER_VALID' as const, version };
    const choiceEvent = this.appendPlayerEvent(working, workingPending.participantId, envelope, 'CHOICE_RESOLVED', {
      choiceId: payload.choiceId,
      choiceVersion: payload.choiceVersion,
      selectionCount: payload.selectedOptionIds.length,
      selectedOptionIdsJson: JSON.stringify([...payload.selectedOptionIds]),
      ownerParticipantId: workingPending.participantId,
    }, workingPending.causationId);
    const eventRefs = [...workingPending.continuation.eventRefsBeforeChoice, choiceEvent.id];
    const ledgerRefs = [...workingPending.continuation.ledgerRefsBeforeChoice];
    working.adjudication.resolvedChoiceIds.push(payload.choiceId);
    delete working.adjudication.pendingResolution;
    working.adjudication.scheduler.status = 'READY';
    const systemEnvelope: InternalEnvelope = {
      ...this.internalEnvelope({
        gameId: envelope.gameId,
        expectedGameVersion: envelope.expectedGameVersion,
        commandId: envelope.commandId,
        idempotencyKey: envelope.idempotencyKey,
        correlationId: workingPending.correlationId,
      }),
      causationId: choiceEvent.id,
    };
    const outcome = this.completeActivation(
      working,
      slot,
      systemEnvelope,
      campaign,
      workingPending.continuation,
      selections as CountryId[],
      eventRefs,
      ledgerRefs,
    );
    if ('error' in outcome || outcome.kind !== 'COMPLETE') return { error: 'OBJECT_NO_LONGER_VALID' as const, version };
    return {
      nextState: working,
      resultCode: 'CHOICE_RESOLVED',
      resultPayload: { choiceId: payload.choiceId, resumedResolutionId: workingPending.resolutionId },
      emittedEventRefs: outcome.eventRefs,
      adjudicationTraceRefs: [outcome.traceId],
    };
  }

  private validateChoiceActor(
    state: SetupGameState,
    actor: ActorContext,
    pending: Extract<PendingResolution, { readonly kind: 'CHOICE' }>,
  ): AnyEngineErrorCode | undefined {
    if (actor.actorType !== 'PLAYER' || actor.participantId !== pending.choice.actorParticipantId) return 'CHOICE_NOT_AUTHORIZED';
    const participant = state.participants[actor.participantId];
    const seat = state.seats[actor.participantId];
    if (
      participant === undefined ||
      participant.userId !== actor.actorId ||
      seat === undefined ||
      actor.playerSeatId !== seat.id ||
      actor.countryId !== seat.countryId ||
      !actor.permissions.includes('game:play')
    ) return 'CHOICE_NOT_AUTHORIZED';
    return undefined;
  }

  private completeActivation(
    state: SetupGameState,
    slot: M1ActionPlanSlot,
    envelope: InternalEnvelope,
    campaign: M1CampaignState,
    continuation: Omit<CampaignContinuationState, 'optionAttributionById'> | CampaignContinuationState,
    selectedAttributions: readonly CountryId[],
    eventRefs: string[],
    ledgerRefs: string[],
  ): ActivationOutcome {
    const opposite = oppositeType(continuation.generatedType);
    const totalOpposite = state.adjudication.influenceStacks
      .filter((stack) => stack.pdId === continuation.targetPdId && stack.type === opposite)
      .reduce((sum, stack) => sum + stack.count, 0);
    const resolution = resolveTwoToOne(continuation.generatedCount, totalOpposite);
    if (selectedAttributions.length !== resolution.oppositeRemoved) return { error: 'INVALID_CHOICE_OPTION' };
    const removedByAttribution: Record<string, number> = {};
    for (const attribution of selectedAttributions) {
      const stack = state.adjudication.influenceStacks.find((candidate) =>
        candidate.pdId === continuation.targetPdId && candidate.type === opposite && candidate.attributionCountryId === attribution && candidate.count > 0,
      );
      if (stack === undefined) return { error: 'INVALID_CHOICE_OPTION' };
      stack.count -= 1;
      removedByAttribution[attribution] = (removedByAttribution[attribution] ?? 0) + 1;
      const ledgerId = `${state.id}:influence-ledger:${state.adjudication.influenceLedger.length + 1}`;
      state.adjudication.influenceLedger.push({
        id: ledgerId,
        pdId: continuation.targetPdId,
        type: opposite,
        attributionCountryId: attribution,
        reason: 'CANCELLED_BY_2_TO_1',
        delta: -1,
        balanceAfter: stack.count,
        gameVersion: state.version + 1,
      });
      ledgerRefs.push(ledgerId);
      const event = this.appendEvent(state, envelope, 'INFLUENCE_MUTATED', {
        activationId: continuation.activationId,
        pdId: continuation.targetPdId,
        type: opposite,
        attributionCountryId: attribution,
        reason: 'CANCELLED_BY_2_TO_1',
        delta: -1,
        balanceAfter: stack.count,
        ledgerId,
      }, eventRefs.at(-1));
      eventRefs.push(event.id);
    }
    if (resolution.placed > 0) {
      let placedStack = state.adjudication.influenceStacks.find((candidate) =>
        candidate.pdId === continuation.targetPdId && candidate.type === continuation.generatedType && candidate.attributionCountryId === continuation.generatedAttributionCountryId,
      );
      if (placedStack === undefined) {
        placedStack = {
          pdId: continuation.targetPdId,
          type: continuation.generatedType,
          attributionCountryId: continuation.generatedAttributionCountryId,
          count: 0,
        };
        state.adjudication.influenceStacks.push(placedStack);
      }
      placedStack.count += resolution.placed;
      const ledgerId = `${state.id}:influence-ledger:${state.adjudication.influenceLedger.length + 1}`;
      state.adjudication.influenceLedger.push({
        id: ledgerId,
        pdId: continuation.targetPdId,
        type: continuation.generatedType,
        attributionCountryId: continuation.generatedAttributionCountryId,
        reason: 'PLACED',
        delta: resolution.placed,
        balanceAfter: placedStack.count,
        gameVersion: state.version + 1,
      });
      ledgerRefs.push(ledgerId);
      const event = this.appendEvent(state, envelope, 'INFLUENCE_MUTATED', {
        activationId: continuation.activationId,
        pdId: continuation.targetPdId,
        type: continuation.generatedType,
        attributionCountryId: continuation.generatedAttributionCountryId,
        reason: 'PLACED',
        delta: resolution.placed,
        balanceAfter: placedStack.count,
        ledgerId,
      }, eventRefs.at(-1));
      eventRefs.push(event.id);
    }
    const influenceResolutionId = `${state.id}:influence-resolution:${state.adjudication.influenceResolutions.length + 1}`;
    const influenceResolution = {
      id: influenceResolutionId,
      targetPdId: continuation.targetPdId,
      incomingType: continuation.generatedType,
      incomingAttributionCountryId: continuation.generatedAttributionCountryId,
      generatedCount: continuation.generatedCount,
      consumedInCancellation: resolution.consumedInCancellation,
      oppositeRemovedByAttribution: removedByAttribution,
      placedCount: resolution.placed,
    };
    state.adjudication.influenceResolutions.push(influenceResolution);

    let legitimacyAfter = continuation.legitimacyBefore;
    let vp = state.adjudication.vpByParticipant[continuation.participantId] ?? 0;
    if (continuation.ertResult > 0 && resolution.placed > 0) {
      const placedVp = this.addVp(state, envelope, continuation, 'CAMPAIGN_CUBE_PLACED', resolution.placed, vp, eventRefs, ledgerRefs);
      vp = placedVp;
      if (continuation.legitimacyBefore === null) {
        legitimacyAfter = continuation.participantId;
        state.adjudication.legitimacyByPd[continuation.targetPdId] = legitimacyAfter;
        const legitimacyLedgerId = `${state.id}:legitimacy-ledger:${state.adjudication.legitimacyLedger.length + 1}`;
        state.adjudication.legitimacyLedger.push({
          id: legitimacyLedgerId,
          pdId: continuation.targetPdId,
          previousParticipantId: null,
          newParticipantId: legitimacyAfter,
          reason: 'CAMPAIGN_ESTABLISH',
          gameVersion: state.version + 1,
        });
        ledgerRefs.push(legitimacyLedgerId);
        const legitimacyEvent = this.appendEvent(state, envelope, 'LEGITIMACY_CHANGED', {
          activationId: continuation.activationId,
          pdId: continuation.targetPdId,
          previousParticipantId: '',
          newParticipantId: legitimacyAfter,
          reason: 'CAMPAIGN_ESTABLISH',
          ledgerId: legitimacyLedgerId,
        }, eventRefs.at(-1));
        eventRefs.push(legitimacyEvent.id);
        this.addVp(state, envelope, continuation, 'LEGITIMACY_ESTABLISHED', 1, vp, eventRefs, ledgerRefs);
      } else if (continuation.legitimacyBefore !== continuation.participantId) {
        legitimacyAfter = null;
        state.adjudication.legitimacyByPd[continuation.targetPdId] = null;
        const legitimacyLedgerId = `${state.id}:legitimacy-ledger:${state.adjudication.legitimacyLedger.length + 1}`;
        state.adjudication.legitimacyLedger.push({
          id: legitimacyLedgerId,
          pdId: continuation.targetPdId,
          previousParticipantId: continuation.legitimacyBefore,
          newParticipantId: null,
          reason: 'CAMPAIGN_SUBVERT',
          gameVersion: state.version + 1,
        });
        ledgerRefs.push(legitimacyLedgerId);
        const legitimacyEvent = this.appendEvent(state, envelope, 'LEGITIMACY_CHANGED', {
          activationId: continuation.activationId,
          pdId: continuation.targetPdId,
          previousParticipantId: continuation.legitimacyBefore,
          newParticipantId: '',
          reason: 'CAMPAIGN_SUBVERT',
          ledgerId: legitimacyLedgerId,
        }, eventRefs.at(-1));
        eventRefs.push(legitimacyEvent.id);
        this.addVp(state, envelope, continuation, 'LEGITIMACY_SUBVERTED', 1, vp, eventRefs, ledgerRefs);
      }
    } else if (continuation.ertResult < 0 && resolution.placed > 0) {
      const delta = -Math.min(vp, resolution.placed);
      if (delta < 0) {
        this.addVp(state, envelope, continuation, 'CAMPAIGN_BACKLASH', delta, vp, eventRefs, ledgerRefs);
      }
    }
    campaign.activationCountThisTurn += 1;
    slot.terminalOutcome = 'RESOLVED';
    this.advanceScheduler(state);
    const actionResolved = this.appendEvent(state, envelope, 'ACTION_RESOLVED', {
      participantId: continuation.participantId,
      sequenceIndex: continuation.sequenceIndex,
      outcome: 'RESOLVED',
    }, eventRefs.at(-1));
    eventRefs.push(actionResolved.id);
    const traceId = `${state.id}:trace:${state.adjudication.traces.length + 1}`;
    const completedEventId = `${state.id}:event:${state.events.length + 1}`;
    const postStateHash = hashM1GameplayState(state, state.version + 1);
    const narrative = state.adjudication.narrativesByCampaign[campaign.id];
    if (narrative === undefined) return { error: 'OBJECT_NO_LONGER_VALID' };
    const trace: AdjudicationTrace = {
      id: traceId,
      participantId: continuation.participantId,
      sequenceIndex: continuation.sequenceIndex,
      campaignId: continuation.campaignId,
      activationId: continuation.activationId,
      cards: structuredClone(campaign.assignments),
      alignment: campaign.alignment,
      targetDtId: campaign.targetDtId,
      targetPdId: continuation.targetPdId,
      baseCv: continuation.baseCv,
      effectiveCv: continuation.effectiveCv,
      baseTier: continuation.baseTier,
      resolutionTier: continuation.resolutionTier,
      resourceCost: continuation.resourceCost,
      narrative: narrative.text,
      preRollReaction: ['OPEN', 'EVALUATE_ZERO_ELIGIBLE', 'CLOSE'],
      rawRoll: continuation.rawRoll,
      modifiedRollRaw: continuation.modifiedRollRaw,
      ertRoll: continuation.ertRoll,
      ertResult: continuation.ertResult,
      generatedType: continuation.generatedType,
      generatedCount: continuation.generatedCount,
      consumedInCancellation: resolution.consumedInCancellation,
      oppositeRemovedByAttribution: removedByAttribution,
      placedCount: resolution.placed,
      legitimacyBefore: continuation.legitimacyBefore,
      legitimacyAfter,
      vpBefore: continuation.vpBefore,
      vpAfter: state.adjudication.vpByParticipant[continuation.participantId] ?? 0,
      vpDelta: (state.adjudication.vpByParticipant[continuation.participantId] ?? 0) - continuation.vpBefore,
      eventRefs: [...eventRefs, completedEventId],
      ledgerRefs: [...ledgerRefs],
      preStateHash: continuation.preStateHash,
      postStateHash,
      versions: structuredClone(state.versions),
    };
    const completed = this.appendEvent(state, envelope, 'CAMPAIGN_ACTIVATION_COMPLETED', {
      activationId: continuation.activationId,
      campaignId: continuation.campaignId,
      traceId,
      placedCount: resolution.placed,
      vpDelta: trace.vpDelta,
      influenceResolutionId,
      influenceResolutionJson: canonicalizeJson(influenceResolution),
      influenceResolutionDigest: sha256CanonicalJson(influenceResolution),
      traceDigest: sha256CanonicalJson(trace),
    }, actionResolved.id);
    if (completed.id !== completedEventId) throw new Error('Campaign completion event identity drift');
    eventRefs.push(completed.id);
    state.adjudication.traces.push(trace);
    return { kind: 'COMPLETE', traceId, eventRefs };
  }

  private addVp(
    state: SetupGameState,
    envelope: InternalEnvelope,
    continuation: CampaignContinuationState | Omit<CampaignContinuationState, 'optionAttributionById'>,
    reason: 'CAMPAIGN_CUBE_PLACED' | 'CAMPAIGN_BACKLASH' | 'LEGITIMACY_ESTABLISHED' | 'LEGITIMACY_SUBVERTED',
    delta: number,
    balanceBefore: number,
    eventRefs: string[],
    ledgerRefs: string[],
  ): number {
    const balanceAfter = balanceBefore + delta;
    state.adjudication.vpByParticipant[continuation.participantId] = balanceAfter;
    const ledgerId = `${state.id}:vp-ledger:${state.adjudication.vpLedger.length + 1}`;
    state.adjudication.vpLedger.push({
      id: ledgerId,
      participantId: continuation.participantId,
      reason,
      delta,
      balanceAfter,
      gameVersion: state.version + 1,
    });
    ledgerRefs.push(ledgerId);
    const event = this.appendEvent(state, envelope, 'VP_CHANGED', {
      activationId: continuation.activationId,
      participantId: continuation.participantId,
      reason,
      delta,
      balanceAfter,
      ledgerId,
    }, eventRefs.at(-1));
    eventRefs.push(event.id);
    return balanceAfter;
  }

  private pdHasDt(demographicTokenIds: readonly string[], targetDtId: string): boolean {
    return demographicTokenIds.includes(targetDtId) || demographicTokenIds.some((token) => token.endsWith(`:${targetDtId}`));
  }

  private randomInteger(minInclusive: number, maxInclusive: number): number {
    const value = this.random.integer(minInclusive, maxInclusive);
    if (!Number.isInteger(value) || !Number.isFinite(value) || value < minInclusive || value > maxInclusive) {
      throw new Error('Random provider returned an invalid value');
    }
    return value;
  }

  private appendPlayerEvent(
    state: SetupGameState,
    participantId: string,
    envelope: CommandEnvelope<string, unknown>,
    type: SetupGameEventType,
    payload: Readonly<Record<string, string | number | boolean>>,
    causationId?: string,
  ): SetupGameEvent {
    const participant = state.participants[participantId];
    if (participant === undefined) throw new Error('Player event requires an existing participant');
    return this.appendEvent(state, {
      ...envelope,
      actorContext: {
        actorId: participant.userId,
        actorType: 'PLAYER',
        participantId,
        authenticatedSessionId: `fixture:${participantId}`,
        permissions: ['game:play'],
      },
    }, type, payload, causationId);
  }

  private appendEvent(
    state: SetupGameState,
    envelope: CommandEnvelope<string, unknown>,
    type: SetupGameEventType,
    payload: Readonly<Record<string, string | number | boolean>>,
    causationId?: string,
    visibilityClass: 'PUBLIC' | 'OWNER_AND_FACILITATOR' = type.startsWith('CHOICE_') ? 'OWNER_AND_FACILITATOR' : 'PUBLIC',
  ): SetupGameEvent {
    const sequenceNumber = state.events.length + 1;
    const eventId = `${state.id}:event:${sequenceNumber}`;
    const actorParticipantId = envelope.actorContext.actorType === 'SYSTEM' ? null : envelope.actorContext.participantId;
    if (actorParticipantId === undefined) throw new Error('Human M1 events require a participant');
    const event: SetupGameEvent = {
      id: eventId,
      eventId,
      gameId: state.id,
      type,
      eventType: type,
      sequenceNumber,
      gameVersion: state.version + 1,
      actorType: envelope.actorContext.actorType,
      actorId: envelope.actorContext.actorId,
      actorParticipantId,
      payloadSchemaVersion: envelope.payloadSchemaVersion,
      versions: structuredClone(state.versions),
      correlationId: envelope.correlationId ?? envelope.commandId,
      causationId: causationId ?? envelope.causationId ?? null,
      visibilityClass,
      occurredAt: this.now().toISOString(),
      payload,
    };
    state.events.push(event);
    return event;
  }
}
