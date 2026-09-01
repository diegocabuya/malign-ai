import type { ActorContext, AnyEngineErrorCode, CommandEnvelope, EngineCommandResult } from '@malign-ai/contracts';
import {
  BASE_2025_CARD_REGISTRY,
  BASE_2025_COUNTRIES,
  BASE_2025_M1_CAMPAIGN_CARD_RULES,
  BASE_2025_POPULATION_DEMOGRAPHICS,
  M1_0_BASELINE_VERSIONS,
  cardInstanceId,
  type CountryId,
  type DiceMode,
  type M1ActionPlanSlot,
  type M1ActionType,
  type M2CoreOperation,
  type PdObjectiveMetrics,
  type ReactionTrigger,
  type TransactionalRandomProvider,
  type SetupCardInstance,
  type SetupEventVisibilityClass,
  type SetupGameEvent,
  type SetupGameEventType,
  type SetupGameState,
} from '@malign-ai/domain';
import { sha256CanonicalJson } from '@malign-ai/shared';
import { dispatchAtomicCommand, InMemoryAtomicStateStore } from './atomic-dispatch.js';
import { applyM2StateToCanonical, buildM2StateFromCanonical } from './m2-integrated-state.js';
import { cleanupCampaignAging, resetTurnFlags } from './m2b-lifecycle.js';
import { finalizeGame } from './m2b-endgame.js';
import { makeReactionContinuation, openReactionWindow, passReactionPriority, playReaction, resolveVeto } from './m2b-reaction.js';
import {
  applyBacklash,
  discardCampaign,
  discardWithLifecycle,
  establishLegitimacy,
  M2_PAIR_BONUS_EFFECT_IDS,
  M2_TARGET_DT_EFFECT_IDS,
  M2BEffectDispatcher,
  modifyCampaignCard,
  playStarter,
  stealBlindCard,
} from './m2b.js';
import { m2EffectSourceDefinition } from './m2-effect-manifest.js';

export type SetupCommandType =
  | 'CREATE_GAME'
  | 'JOIN_GAME_MEMBERSHIP'
  | 'ASSIGN_PLAYER_SEAT'
  | 'CONFIGURE_GAME_OPTION'
  | 'START_GAME'
  | 'PAUSE_GAME'
  | 'RESUME_GAME'
  | 'SUBMIT_OPERATIONS_DECK'
  | 'LOCK_STRATEGY'
  | 'REQUEST_INITIATIVE_ROLL'
  | 'SET_INITIATIVE_MAINTENANCE'
  | 'LOCK_INITIATIVE_MAINTENANCE'
  | 'SET_ACTION_PLAN'
  | 'LOCK_ACTION_PLAN'
  | 'CONSTRUCT_CAMPAIGN'
  | 'END_GAME_SCORING'
  | 'PASS_REACTION'
  | 'PLAY_REACTION'
  | 'SUBMIT_VETO_DEFENSE'
  | 'CAST_VETO_VOTE'
  | 'RESOLVE_VETO_ABUSE'
  | 'SUBMIT_M2_EFFECT_CHOICE';

export interface CreateGamePayload {
  readonly scenarioDefinitionId: 'BASE_2025';
  readonly rulesetVersion: string;
  readonly scenarioVersion: string;
  readonly cardRegistryVersion: string;
  readonly engineContractVersion: string;
  readonly fixtureSchemaVersion: string;
  readonly turnLimit: number;
  readonly preferredDiceMode: DiceMode;
}

export interface AssignPlayerSeatPayload {
  readonly playerParticipantId: string;
  readonly countryId: CountryId;
  readonly seatIndex: number;
  readonly clockwiseIndex: number;
}

export type ConfigureGameOptionPayload =
  | { readonly optionId: 'TURN_LIMIT'; readonly value: number }
  | { readonly optionId: 'DICE_MODE'; readonly value: DiceMode };

export interface SubmitOperationsDeckPayload {
  readonly cardInstanceIds: readonly string[];
}

export interface SetInitiativeMaintenancePayload {
  readonly discardCardInstanceIds: readonly string[];
}

export interface SetActionPlanSlotPayload {
  readonly sequenceIndex: number;
  readonly actionType: M1ActionType;
  readonly actionPayload: Readonly<Record<string, unknown>>;
}

export interface SetM1ActionPlanPayload {
  readonly actionSlots: readonly SetActionPlanSlotPayload[];
}

export interface PauseGamePayload {
  readonly reasonCode: string;
  readonly reasonText?: string;
}

export interface ResumeGamePayload {
  readonly reasonCode?: string;
}

export interface PlayReactionPayload {
  readonly cardId: string;
  readonly effectId: string;
  readonly reasonText?: string;
}

export interface SubmitVetoDefensePayload { readonly vetoCaseId: string; readonly defenseText: string }
export interface CastVetoVotePayload { readonly vetoCaseId: string; readonly vote: 'ACCEPTABLE' | 'UNACCEPTABLE' }
export interface ResolveVetoAbusePayload { readonly reactionWindowId: string; readonly initiatorParticipantId: string; readonly decision: 'ALLOW' | 'REJECT' }

export type SubmitM2EffectChoicePayload =
  | { readonly continuationId: string; readonly selectedCardId: string }
  | { readonly continuationId: string; readonly selections: Readonly<Record<string, readonly string[]>> };

export type SetupCommandPayload =
  | CreateGamePayload
  | AssignPlayerSeatPayload
  | ConfigureGameOptionPayload
  | SubmitOperationsDeckPayload
  | SetInitiativeMaintenancePayload
  | SetM1ActionPlanPayload
  | PauseGamePayload
  | ResumeGamePayload
  | PlayReactionPayload
  | SubmitVetoDefensePayload
  | CastVetoVotePayload
  | ResolveVetoAbusePayload
  | SubmitM2EffectChoicePayload
  | Record<string, never>;

type SetupEnvelope = CommandEnvelope<SetupCommandType, SetupCommandPayload>;

const canonicalPlayerTopology = {
  P1: { countryId: 'ARDEN', index: 0 },
  P2: { countryId: 'FLUMA', index: 1 },
  P3: { countryId: 'URSARIA', index: 2 },
  P4: { countryId: 'PRESQUE', index: 3 },
  P5: { countryId: 'DINESIA', index: 4 },
} as const;

const canonicalPlayerIds = Object.keys(canonicalPlayerTopology);
const facilitatorCommands = new Set<SetupCommandType>([
  'CREATE_GAME',
  'ASSIGN_PLAYER_SEAT',
  'CONFIGURE_GAME_OPTION',
  'START_GAME',
  'PAUSE_GAME',
  'RESUME_GAME',
  'RESOLVE_VETO_ABUSE',
]);
const pauseBlockedCommands = new Set<SetupCommandType>([
  'START_GAME',
  'SUBMIT_OPERATIONS_DECK',
  'LOCK_STRATEGY',
  'REQUEST_INITIATIVE_ROLL',
  'SET_INITIATIVE_MAINTENANCE',
  'LOCK_INITIATIVE_MAINTENANCE',
  'SET_ACTION_PLAN',
  'LOCK_ACTION_PLAN',
  'CONSTRUCT_CAMPAIGN',
  'END_GAME_SCORING',
  'PASS_REACTION',
  'PLAY_REACTION',
  'SUBMIT_VETO_DEFENSE',
  'CAST_VETO_VOTE',
  'RESOLVE_VETO_ABUSE',
  'SUBMIT_M2_EFFECT_CHOICE',
]);

const reactionDefinitionByEffect: Readonly<Record<string, string>> = {
  CARD_EFFECT_BASE_2025_E010: 'BASE_CARD_018',
  CARD_EFFECT_BASE_2025_E012: 'BASE_CARD_021',
  CARD_EFFECT_BASE_2025_E022: 'BASE_CARD_043',
  CARD_EFFECT_BASE_2025_E036: 'BASE_CARD_065',
  CARD_EFFECT_BASE_2025_E040: 'BASE_CARD_073',
  CARD_EFFECT_BASE_2025_E048: 'BASE_CARD_085',
  CARD_EFFECT_BASE_2025_E054: 'BASE_CARD_094',
};

const triggeringDefinitionByReaction: Readonly<Partial<Record<ReactionTrigger, string>>> = {
  DOUBLE_AGENT: 'BASE_CARD_012',
  CORRUPTION: 'BASE_CARD_088',
  CYBERATTACK: 'BASE_CARD_041',
  HACK_BACK: 'BASE_CARD_043',
  LEAKS_DRAWN: 'BASE_CARD_026',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isDiceMode = (value: unknown): value is DiceMode => value === 'DIGITAL' || value === 'MANUAL_DIE_INPUT';

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value) && value >= 1;

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

const isFiniteInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value);

const hasExactKeys = (
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => allowed.has(key));
};

const isCountryId = (value: unknown): value is CountryId =>
  BASE_2025_COUNTRIES.some(({ id }) => id === value);

const isConstructPlanPayload = (value: unknown): boolean =>
  hasExactKeys(
    value,
    ['row', 'intentCardInstanceId', 'methodCardInstanceId', 'targetDtId'],
    ['amplifierCardInstanceId'],
  ) &&
  value.row === 'I' &&
  isNonEmptyString(value.intentCardInstanceId) &&
  isNonEmptyString(value.methodCardInstanceId) &&
  isNonEmptyString(value.targetDtId) &&
  (!Object.hasOwn(value, 'amplifierCardInstanceId') || isNonEmptyString(value.amplifierCardInstanceId));

const isActivatePlanPayload = (value: unknown): boolean =>
  hasExactKeys(value, ['campaignId'], ['requestedTargetPdId']) &&
  isNonEmptyString(value.campaignId) &&
  (!Object.hasOwn(value, 'requestedTargetPdId') || isNonEmptyString(value.requestedTargetPdId));

const isPlayBoostPlanPayload = (value: unknown): boolean =>
  hasExactKeys(value, ['cardInstanceId', 'campaignId', 'activationSequenceIndex']) && isNonEmptyString(value.cardInstanceId) &&
  isNonEmptyString(value.campaignId) && isPositiveInteger(value.activationSequenceIndex);

const isActionPlanSlotPayload = (value: unknown): value is Record<string, unknown> => {
  if (
    !hasExactKeys(value, ['sequenceIndex', 'actionType', 'actionPayload']) ||
    !isFiniteInteger(value.sequenceIndex)
  ) return false;
  if (value.actionType === 'CONSTRUCT_CAMPAIGN') return isConstructPlanPayload(value.actionPayload);
  if (value.actionType === 'ACTIVATE_CAMPAIGN') return isActivatePlanPayload(value.actionPayload);
  if (value.actionType === 'PLAY_BOOST') return isPlayBoostPlanPayload(value.actionPayload);
  return false;
};

export const validateSetupCommandPayload = (
  commandType: SetupCommandType,
  payload: unknown,
): AnyEngineErrorCode | undefined => {
  switch (commandType) {
    case 'CREATE_GAME':
      if (
        !hasExactKeys(payload, [
          'scenarioDefinitionId',
          'rulesetVersion',
          'scenarioVersion',
          'cardRegistryVersion',
          'engineContractVersion',
          'fixtureSchemaVersion',
          'turnLimit',
          'preferredDiceMode',
        ]) ||
        payload.scenarioDefinitionId !== 'BASE_2025' ||
        !isNonEmptyString(payload.rulesetVersion) ||
        !isNonEmptyString(payload.scenarioVersion) ||
        !isNonEmptyString(payload.cardRegistryVersion) ||
        !isNonEmptyString(payload.engineContractVersion) ||
        !isNonEmptyString(payload.fixtureSchemaVersion) ||
        !isPositiveInteger(payload.turnLimit) ||
        !isDiceMode(payload.preferredDiceMode)
      ) return 'INVALID_COMMAND_PAYLOAD';
      return undefined;
    case 'JOIN_GAME_MEMBERSHIP':
    case 'START_GAME':
    case 'LOCK_STRATEGY':
    case 'REQUEST_INITIATIVE_ROLL':
    case 'LOCK_INITIATIVE_MAINTENANCE':
    case 'LOCK_ACTION_PLAN':
    case 'CONSTRUCT_CAMPAIGN':
    case 'END_GAME_SCORING':
      return hasExactKeys(payload, []) ? undefined : 'INVALID_COMMAND_PAYLOAD';
    case 'ASSIGN_PLAYER_SEAT':
      if (
        !hasExactKeys(payload, ['playerParticipantId', 'countryId', 'seatIndex', 'clockwiseIndex']) ||
        !isNonEmptyString(payload.playerParticipantId) ||
        !isCountryId(payload.countryId) ||
        !Number.isInteger(payload.seatIndex) ||
        !Number.isFinite(payload.seatIndex) ||
        (payload.seatIndex as number) < 0 ||
        (payload.seatIndex as number) > 4 ||
        !Number.isInteger(payload.clockwiseIndex) ||
        !Number.isFinite(payload.clockwiseIndex) ||
        (payload.clockwiseIndex as number) < 0 ||
        (payload.clockwiseIndex as number) > 4
      ) return 'INVALID_COMMAND_PAYLOAD';
      return undefined;
    case 'CONFIGURE_GAME_OPTION':
      if (!hasExactKeys(payload, ['optionId', 'value'])) return 'INVALID_COMMAND_PAYLOAD';
      if (payload.optionId === 'TURN_LIMIT') return isPositiveInteger(payload.value) ? undefined : 'INVALID_COMMAND_PAYLOAD';
      if (payload.optionId === 'DICE_MODE') return isDiceMode(payload.value) ? undefined : 'INVALID_COMMAND_PAYLOAD';
      return 'INVALID_COMMAND_PAYLOAD';
    case 'PAUSE_GAME':
      return hasExactKeys(payload, ['reasonCode'], ['reasonText']) &&
        isNonEmptyString(payload.reasonCode) &&
        (!Object.hasOwn(payload, 'reasonText') || typeof payload.reasonText === 'string')
        ? undefined
        : 'INVALID_COMMAND_PAYLOAD';
    case 'RESUME_GAME':
      return hasExactKeys(payload, [], ['reasonCode']) &&
        (!Object.hasOwn(payload, 'reasonCode') || isNonEmptyString(payload.reasonCode))
        ? undefined
        : 'INVALID_COMMAND_PAYLOAD';
    case 'SUBMIT_OPERATIONS_DECK':
      return hasExactKeys(payload, ['cardInstanceIds']) &&
        Array.isArray(payload.cardInstanceIds) &&
        payload.cardInstanceIds.every((id) => isNonEmptyString(id))
        ? undefined
        : 'INVALID_COMMAND_PAYLOAD';
    case 'SET_INITIATIVE_MAINTENANCE':
      return hasExactKeys(payload, ['discardCardInstanceIds']) &&
        Array.isArray(payload.discardCardInstanceIds) &&
        payload.discardCardInstanceIds.every((id) => isNonEmptyString(id))
        ? undefined
        : 'INVALID_COMMAND_PAYLOAD';
    case 'SET_ACTION_PLAN': {
      if (!hasExactKeys(payload, ['actionSlots']) || !Array.isArray(payload.actionSlots)) {
        return 'INVALID_COMMAND_PAYLOAD';
      }
      if (!payload.actionSlots.every((slot) => isActionPlanSlotPayload(slot))) return 'INVALID_COMMAND_PAYLOAD';
      const indexes = payload.actionSlots.map((slot) => slot.sequenceIndex);
      if (
        payload.actionSlots.length > 3 ||
        indexes.some((index, offset) => index !== offset + 1) ||
        new Set(indexes).size !== indexes.length
      ) return 'INVALID_ACTION_PLAN';
      return undefined;
    }
    case 'PASS_REACTION':
      return hasExactKeys(payload, []) ? undefined : 'INVALID_COMMAND_PAYLOAD';
    case 'PLAY_REACTION':
      return hasExactKeys(payload, ['cardId', 'effectId'], ['reasonText']) && isNonEmptyString(payload.cardId) && isNonEmptyString(payload.effectId) &&
        (payload.effectId !== 'CARD_EFFECT_BASE_2025_E048' || isNonEmptyString(payload.reasonText)) ? undefined : 'INVALID_COMMAND_PAYLOAD';
    case 'SUBMIT_VETO_DEFENSE':
      return hasExactKeys(payload, ['vetoCaseId', 'defenseText']) && isNonEmptyString(payload.vetoCaseId) && isNonEmptyString(payload.defenseText)
        ? undefined : 'INVALID_COMMAND_PAYLOAD';
    case 'CAST_VETO_VOTE':
      return hasExactKeys(payload, ['vetoCaseId', 'vote']) && isNonEmptyString(payload.vetoCaseId) &&
        (payload.vote === 'ACCEPTABLE' || payload.vote === 'UNACCEPTABLE') ? undefined : 'INVALID_COMMAND_PAYLOAD';
    case 'RESOLVE_VETO_ABUSE':
      return hasExactKeys(payload, ['reactionWindowId', 'initiatorParticipantId', 'decision']) && isNonEmptyString(payload.reactionWindowId) &&
        isNonEmptyString(payload.initiatorParticipantId) && (payload.decision === 'ALLOW' || payload.decision === 'REJECT')
        ? undefined : 'INVALID_COMMAND_PAYLOAD';
    case 'SUBMIT_M2_EFFECT_CHOICE': {
      if (!isRecord(payload) || !isNonEmptyString(payload.continuationId)) return 'INVALID_COMMAND_PAYLOAD';
      const choiceKeys = Object.keys(payload).sort().join('|');
      if (choiceKeys === 'continuationId|selectedCardId') return isNonEmptyString(payload.selectedCardId) ? undefined : 'INVALID_COMMAND_PAYLOAD';
      if (choiceKeys !== 'continuationId|selections' || !isRecord(payload.selections)) return 'INVALID_COMMAND_PAYLOAD';
      return Object.values(payload.selections).every((selection) => Array.isArray(selection) && selection.every((id) => isNonEmptyString(id)))
        ? undefined : 'INVALID_COMMAND_PAYLOAD';
    }
  }
  return 'INVALID_COMMAND_PAYLOAD';
};

export const isSetupCommandPayload = (
  commandType: SetupCommandType,
  payload: unknown,
): payload is SetupCommandPayload => validateSetupCommandPayload(commandType, payload) === undefined;

export class InMemorySetupGameStore extends InMemoryAtomicStateStore<SetupGameState> {
  snapshot(gameId: string): SetupGameState | undefined { return this.load(gameId); }
}

export class SetupCommandDispatcher {
  constructor(
    private readonly store: InMemorySetupGameStore,
    private readonly random: TransactionalRandomProvider,
    private readonly now: () => Date,
    private readonly randomTransactionOwner: 'ENGINE' | 'APPLICATION' = 'ENGINE',
  ) {}

  dispatch(envelope: SetupEnvelope): EngineCommandResult {
    if (this.randomTransactionOwner === 'APPLICATION') {
      return this.dispatchWithoutProviderFinalization(envelope);
    }
    const checkpoint = this.random.checkpoint();
    let notifyStableCommit: (() => void) | undefined;
    try {
      const result = this.dispatchWithoutProviderFinalization(
        envelope,
        (notify) => { notifyStableCommit = notify; },
      );
      if (result.status === 'RESOLVED') {
        this.random.commit(checkpoint);
        notifyStableCommit?.();
      } else this.random.restore(checkpoint);
      return result;
    } catch (error) {
      this.random.restore(checkpoint);
      throw error;
    }
  }

  private dispatchWithoutProviderFinalization(
    envelope: SetupEnvelope,
    deferStableNotification: (notify: () => void) => void = () => undefined,
  ): EngineCommandResult {
    return dispatchAtomicCommand({
      envelope,
      store: this.store,
      now: this.now,
      validatePayload: ({ commandType, payload }) => validateSetupCommandPayload(commandType, payload),
      prepare: (before, candidate) => this.prepare(before, candidate),
      deferStableNotification,
    });
  }

  revealCurrentAction(options: {
    readonly gameId: string;
    readonly expectedGameVersion: number;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly correlationId?: string;
  }): EngineCommandResult {
    const envelope: CommandEnvelope<'INTERNAL_REVEAL_CURRENT_ACTION', Record<string, never>> = {
      engineContractVersion: M1_0_BASELINE_VERSIONS.engineContractVersion,
      commandId: options.commandId,
      idempotencyKey: options.idempotencyKey,
      gameId: options.gameId,
      actorContext: {
        actorId: 'M1_INTERNAL_COORDINATOR',
        actorType: 'SYSTEM',
        authenticatedSessionId: 'internal:m1-1',
        permissions: ['game:internal-reveal'],
      },
      expectedGameVersion: options.expectedGameVersion,
      commandType: 'INTERNAL_REVEAL_CURRENT_ACTION',
      payloadSchemaVersion: M1_0_BASELINE_VERSIONS.fixtureSchemaVersion,
      payload: {},
      ...(options.correlationId === undefined ? {} : { correlationId: options.correlationId }),
    };
    return dispatchAtomicCommand({
      envelope,
      store: this.store,
      now: this.now,
      prepare: (before, candidate) => {
        const version = before?.version ?? 0;
        if (before === undefined) return { error: 'GAME_NOT_FOUND' as const, version };
        if (candidate.expectedGameVersion !== before.version) {
          return { error: 'STALE_STATE_VERSION' as const, version: before.version };
        }
        if (before.overlay === 'PAUSED') return { error: 'GAME_PAUSED' as const, version: before.version };
        if (before.phase !== 'RESOLUTION_STAGE') return { error: 'WRONG_PHASE' as const, version: before.version };
        const working = structuredClone(before);
        const selected = working.initiative.orderParticipantIds
          .flatMap((participantId) => working.actionPlanning[participantId]?.lockedSlots ?? [])
          .find((slot) => !slot.revealed);
        if (selected === undefined) return { error: 'NO_ACTION_TO_REVEAL' as const, version: before.version };
        const owner = working.initiative.orderParticipantIds.find((participantId) =>
          working.actionPlanning[participantId]?.lockedSlots.includes(selected),
        );
        if (owner === undefined) return { error: 'NO_ACTION_TO_REVEAL' as const, version: before.version };
        selected.revealed = true;
        working.currentRevealedAction = {
          participantId: owner,
          sequenceIndex: selected.sequenceIndex,
          actionType: selected.actionType,
        };
        const event = this.appendEvent(working, candidate, 'ACTION_REVEALED', {
          participantId: owner,
          sequenceIndex: selected.sequenceIndex,
          actionType: selected.actionType,
        });
        return {
          nextState: working,
          resultCode: 'ACTION_REVEALED',
          resultPayload: structuredClone(working.currentRevealedAction),
          emittedEventRefs: [event.id],
        };
      },
    });
  }

  runM2Cleanup(options: {
    readonly gameId: string;
    readonly expectedGameVersion: number;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly correlationId?: string;
  }): EngineCommandResult {
    const envelope: CommandEnvelope<'INTERNAL_RUN_M2_CLEANUP', Record<string, never>> = {
      engineContractVersion: M1_0_BASELINE_VERSIONS.engineContractVersion,
      commandId: options.commandId, idempotencyKey: options.idempotencyKey, gameId: options.gameId,
      actorContext: { actorId: 'M2_INTERNAL_COORDINATOR', actorType: 'SYSTEM', authenticatedSessionId: 'internal:m2', permissions: ['game:internal-cleanup'] },
      expectedGameVersion: options.expectedGameVersion, commandType: 'INTERNAL_RUN_M2_CLEANUP',
      payloadSchemaVersion: M1_0_BASELINE_VERSIONS.fixtureSchemaVersion, payload: {},
      ...(options.correlationId === undefined ? {} : { correlationId: options.correlationId }),
    };
    return dispatchAtomicCommand({
      envelope, store: this.store, now: this.now,
      prepare: (before, candidate) => {
        const version = before?.version ?? 0;
        if (before === undefined) return { error: 'GAME_NOT_FOUND' as const, version };
        if (candidate.expectedGameVersion !== before.version) return { error: 'STALE_STATE_VERSION' as const, version: before.version };
        if (before.overlay === 'PAUSED') return { error: 'GAME_PAUSED' as const, version: before.version };
        if (before.phase !== 'RESOLUTION_STAGE') return { error: 'WRONG_PHASE' as const, version: before.version };
        const working = structuredClone(before); const events: SetupGameEvent[] = [];
        events.push(this.appendEvent(working, candidate, 'CLEANUP_STARTED', {}));
        const cleanup = cleanupCampaignAging(buildM2StateFromCanonical(working));
        resetTurnFlags(cleanup.state); applyM2StateToCanonical(working, cleanup.state);
        delete working.vetoBlockedParticipantIdsThisTurn;
        delete working.vetoAbuseReviewByWindowParticipant;
        delete working.adjudication.plannedBoostsByParticipant;
        for (const campaignId of cleanup.discardedCampaignIds) events.push(this.appendEvent(working, candidate, 'CAMPAIGN_DISCARDED', { campaignId }));
        for (const campaignId of cleanup.agedCampaignIds) events.push(this.appendEvent(working, candidate, 'CAMPAIGN_AGED', { campaignId, row: 'II' }));
        events.push(this.appendEvent(working, candidate, 'TURN_FLAGS_RESET', {}));
        working.phase = 'INITIATIVE_STAGE';
        events.push(this.appendEvent(working, candidate, 'CLEANUP_COMPLETED', { nextPhase: working.phase }));
        return { nextState: working, resultCode: 'M2_CLEANUP_COMPLETED', resultPayload: { agedCampaignIds: cleanup.agedCampaignIds, discardedCampaignIds: cleanup.discardedCampaignIds, nextPhase: working.phase }, emittedEventRefs: events.map(({ id }) => id) };
      },
    });
  }

  openM2Reaction(options: {
    readonly gameId: string;
    readonly expectedGameVersion: number;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly trigger: ReactionTrigger;
    readonly triggeringParticipantId: string;
    readonly triggeringCampaignId?: string;
    readonly triggeringCardId?: string;
    readonly correlationId?: string;
  }): EngineCommandResult {
    const envelope: CommandEnvelope<'INTERNAL_OPEN_M2_REACTION', { readonly trigger: ReactionTrigger; readonly triggeringParticipantId: string; readonly triggeringCampaignId?: string; readonly triggeringCardId?: string }> = {
      engineContractVersion: M1_0_BASELINE_VERSIONS.engineContractVersion,
      commandId: options.commandId, idempotencyKey: options.idempotencyKey, gameId: options.gameId,
      actorContext: { actorId: 'M2_INTERNAL_COORDINATOR', actorType: 'SYSTEM', authenticatedSessionId: 'internal:m2', permissions: ['game:internal-reaction'] },
      expectedGameVersion: options.expectedGameVersion, commandType: 'INTERNAL_OPEN_M2_REACTION',
      payloadSchemaVersion: M1_0_BASELINE_VERSIONS.fixtureSchemaVersion,
      payload: { trigger: options.trigger, triggeringParticipantId: options.triggeringParticipantId,
        ...(options.triggeringCampaignId === undefined ? {} : { triggeringCampaignId: options.triggeringCampaignId }),
        ...(options.triggeringCardId === undefined ? {} : { triggeringCardId: options.triggeringCardId }) },
      ...(options.correlationId === undefined ? {} : { correlationId: options.correlationId }),
    };
    return dispatchAtomicCommand({
      envelope, store: this.store, now: this.now,
      prepare: (before, candidate) => {
        const version = before?.version ?? 0;
        if (before === undefined) return { error: 'GAME_NOT_FOUND' as const, version };
        if (candidate.expectedGameVersion !== before.version) return { error: 'STALE_STATE_VERSION' as const, version: before.version };
        if (before.overlay === 'PAUSED') return { error: 'GAME_PAUSED' as const, version: before.version };
        if (before.phase !== 'RESOLUTION_STAGE') return { error: 'WRONG_PHASE' as const, version: before.version };
        if (before.participants[options.triggeringParticipantId]?.role !== 'PLAYER') return { error: 'PARTICIPANT_NOT_FOUND' as const, version: before.version };
        const requiredTriggerDefinition = triggeringDefinitionByReaction[options.trigger];
        if (requiredTriggerDefinition !== undefined) {
          const triggeringCard = options.triggeringCardId === undefined ? undefined : before.cards[options.triggeringCardId];
          if (triggeringCard?.definitionId !== requiredTriggerDefinition || triggeringCard.controllerParticipantId !== options.triggeringParticipantId) {
            return { error: 'INVALID_REACTION_INPUT' as const, version: before.version };
          }
        }
        if (options.trigger === 'PRE_ROLL' || options.trigger === 'NARRATIVE') {
          const campaign = options.triggeringCampaignId === undefined ? undefined : before.adjudication.campaigns[options.triggeringCampaignId];
          if (campaign?.ownerParticipantId !== options.triggeringParticipantId) return { error: 'INVALID_REACTION_INPUT' as const, version: before.version };
        }
        if (options.trigger === 'LEAKS_DRAWN') {
          const card = options.triggeringCardId === undefined ? undefined : before.cards[options.triggeringCardId];
          if (card?.definitionId !== 'BASE_CARD_026' || card.controllerParticipantId !== options.triggeringParticipantId || card.zone !== 'HAND') {
            return { error: 'INVALID_REACTION_INPUT' as const, version: before.version };
          }
        }
        if (before.reactionContinuation?.window.status !== undefined && before.reactionContinuation.window.status !== 'CLOSED') {
          return { error: 'REACTION_WINDOW_ACTIVE' as const, version: before.version };
        }
        const working = structuredClone(before);
        const window = openReactionWindow(
          `${working.id}:reaction:${working.version + 1}`,
          options.trigger,
          options.triggeringParticipantId,
          working.initiative.orderParticipantIds,
          undefined,
          { ...(options.triggeringCampaignId === undefined ? {} : { triggeringCampaignId: options.triggeringCampaignId }),
            ...(options.triggeringCardId === undefined ? {} : { triggeringCardId: options.triggeringCardId }) },
        );
        working.reactionContinuation = makeReactionContinuation(`${window.id}:continuation`, working.version + 1, window);
        const event = this.appendEvent(working, candidate, 'REACTION_WINDOW_OPENED', {
          windowId: window.id, trigger: window.trigger, currentParticipantId: window.priorityParticipantIds[0] ?? '',
        });
        return { nextState: working, resultCode: 'REACTION_WINDOW_OPENED', resultPayload: { windowId: window.id, status: window.status }, emittedEventRefs: [event.id] };
      },
    });
  }

  executeM2Effect(options: {
    readonly gameId: string;
    readonly expectedGameVersion: number;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly actorParticipantId: string;
    readonly sourceCardInstanceId: string;
    readonly effectId: string;
    readonly effectVersion: string;
    readonly parameters: Readonly<Record<string, unknown>>;
    readonly correlationId?: string;
  }): EngineCommandResult {
    const envelope: CommandEnvelope<'INTERNAL_EXECUTE_M2_EFFECT', Record<string, unknown>> = {
      engineContractVersion: M1_0_BASELINE_VERSIONS.engineContractVersion,
      commandId: options.commandId, idempotencyKey: options.idempotencyKey, gameId: options.gameId,
      actorContext: { actorId: 'M2_INTERNAL_COORDINATOR', actorType: 'SYSTEM', authenticatedSessionId: 'internal:m2', permissions: ['game:internal-effect'] },
      expectedGameVersion: options.expectedGameVersion, commandType: 'INTERNAL_EXECUTE_M2_EFFECT',
      payloadSchemaVersion: M1_0_BASELINE_VERSIONS.fixtureSchemaVersion,
      payload: {}, ...(options.correlationId === undefined ? {} : { correlationId: options.correlationId }),
    };
    return dispatchAtomicCommand({
      envelope, store: this.store, now: this.now,
      prepare: (before, candidate) => {
        const version = before?.version ?? 0;
        if (before === undefined) return { error: 'GAME_NOT_FOUND' as const, version };
        if (candidate.expectedGameVersion !== before.version) return { error: 'STALE_STATE_VERSION' as const, version: before.version };
        if (before.overlay === 'PAUSED') return { error: 'GAME_PAUSED' as const, version: before.version };
        const actionStageEffect = options.effectId === 'CARD_EFFECT_BASE_2025_E031' || options.effectId === 'CARD_EFFECT_BASE_2025_E053';
        if (before.phase !== (actionStageEffect ? 'ACTION_STAGE_PLAN' : 'RESOLUTION_STAGE')) return { error: 'WRONG_PHASE' as const, version: before.version };
        if (before.participants[options.actorParticipantId]?.role !== 'PLAYER') return { error: 'PARTICIPANT_NOT_FOUND' as const, version: before.version };
        const source = before.cards[options.sourceCardInstanceId];
        const registryDefinitionId = m2EffectSourceDefinition(options.effectId);
        const serial = registryDefinitionId?.match(/D(\d{3})$/u)?.[1];
        const expectedDefinitionId = serial === undefined ? undefined : `BASE_CARD_${serial}`;
        const pairBonusEffect = (M2_PAIR_BONUS_EFFECT_IDS as readonly string[]).includes(options.effectId);
        const targetDtEffect = (M2_TARGET_DT_EFFECT_IDS as readonly string[]).includes(options.effectId);
        const expectedZone = pairBonusEffect || targetDtEffect ? 'CAMPAIGN' : 'HAND';
        if (source === undefined || source.controllerParticipantId !== options.actorParticipantId || source.definitionId !== expectedDefinitionId || source.zone !== expectedZone) {
          return { error: 'CARD_NOT_ELIGIBLE' as const, version: before.version };
        }
        const working = structuredClone(before);
        if (options.effectId === 'CARD_EFFECT_BASE_2025_E031') {
          const strategy = working.strategy[options.actorParticipantId];
          if (strategy === undefined) return { error: 'PARTICIPANT_NOT_FOUND' as const, version: before.version };
          const sourceCardId = options.sourceCardInstanceId;
          const handToDiscard = strategy.handCardInstanceIds.filter((id) => id !== sourceCardId);
          const pool = [...strategy.operationsDeckOrder, ...strategy.discardCardInstanceIds, ...handToDiscard];
          if (new Set(pool).size !== pool.length) return { error: 'INVALID_EFFECT_INPUT' as const, version: before.version };
          const shuffled = this.shuffle(pool);
          const drawn = shuffled.slice(0, 10); const remaining = shuffled.slice(10);
          strategy.handCardInstanceIds = [...drawn]; strategy.discardCardInstanceIds = []; strategy.operationsDeckOrder = [...remaining];
          for (const cardId of pool) {
            const card = working.cards[cardId]; if (card === undefined) return { error: 'CARD_NOT_ELIGIBLE' as const, version: before.version };
            card.zone = drawn.includes(cardId) ? 'HAND' : 'OPERATIONS_DECK';
            if (card.zone === 'OPERATIONS_DECK') card.zonePosition = remaining.indexOf(cardId); else delete card.zonePosition;
          }
          const sourceCard = working.cards[sourceCardId]!; sourceCard.zone = 'REMOVED_FROM_GAME'; delete sourceCard.zonePosition;
          const event = this.appendEvent(working, candidate, 'M2_EFFECT_EXECUTED', { effectId: options.effectId,
            actorParticipantId: options.actorParticipantId, sourceCardInstanceId: sourceCardId, auditCount: 0 });
          return { nextState: working, resultCode: 'M2_EFFECT_EXECUTED', resultPayload: { effectId: options.effectId,
            discardedCount: handToDiscard.length, shuffledCount: pool.length, drawnCount: drawn.length }, emittedEventRefs: [event.id] };
        }
        if (options.effectId === 'CARD_EFFECT_BASE_2025_E045') {
          const strategy = working.strategy[options.actorParticipantId];
          if (strategy === undefined) return { error: 'PARTICIPANT_NOT_FOUND' as const, version: before.version };
          strategy.handCardInstanceIds = strategy.handCardInstanceIds.filter((id) => id !== options.sourceCardInstanceId);
          strategy.discardCardInstanceIds.push(options.sourceCardInstanceId);
          working.cards[options.sourceCardInstanceId]!.zone = 'DISCARD';
          const drawn: string[] = [];
          while (drawn.length < 3 && strategy.operationsDeckOrder.length > 0) {
            const cardId = strategy.operationsDeckOrder.shift()!; drawn.push(cardId); strategy.handCardInstanceIds.push(cardId);
            const card = working.cards[cardId]; if (card === undefined) return { error: 'CARD_NOT_ELIGIBLE' as const, version: before.version };
            card.zone = 'HAND'; delete card.zonePosition;
          }
          strategy.operationsDeckOrder.forEach((id, index) => { const card = working.cards[id]; if (card !== undefined) card.zonePosition = index; });
          const overflow = Math.max(0, strategy.handCardInstanceIds.length - working.handLimit);
          if (overflow > 0) {
            const continuationId = `${working.id}:m2-effect-choice:${working.version + 1}`;
            working.m2EffectChoice = {
              kind: 'M2_EFFECT_GROUPED_CHOICE', schemaVersion: 1, id: continuationId, gameVersion: working.version + 1,
              effectId: 'CARD_EFFECT_BASE_2025_E045', actorParticipantId: options.actorParticipantId,
              chooserParticipantId: options.actorParticipantId, targetParticipantId: options.actorParticipantId,
              sourceCardInstanceId: options.sourceCardInstanceId,
              groups: [{ groupId: 'HAND_LIMIT_DISCARD', minSelections: overflow, maxSelections: overflow,
                eligibleCardIds: [...strategy.handCardInstanceIds].sort() }], resourceCost: 0, sourceLifecycleCommitted: true, status: 'OPEN',
            };
            const event = this.appendEvent(working, candidate, 'CHOICE_REQUESTED', { continuationId, effectId: options.effectId,
              chooserParticipantId: options.actorParticipantId, optionCount: strategy.handCardInstanceIds.length }, 'OWNER_AND_FACILITATOR');
            return { nextState: working, resultCode: 'M2_EFFECT_CHOICE_REQUESTED', resultPayload: { continuationId,
              chooserParticipantId: options.actorParticipantId, drawnCount: drawn.length, overflow }, emittedEventRefs: [event.id] };
          }
          const event = this.appendEvent(working, candidate, 'M2_EFFECT_EXECUTED', { effectId: options.effectId,
            actorParticipantId: options.actorParticipantId, sourceCardInstanceId: options.sourceCardInstanceId, auditCount: 0 });
          return { nextState: working, resultCode: 'M2_EFFECT_EXECUTED', resultPayload: { effectId: options.effectId,
            drawnCount: drawn.length, overflow: 0 }, emittedEventRefs: [event.id] };
        }
        if (options.effectId === 'CARD_EFFECT_BASE_2025_E053') {
          const strategy = working.strategy[options.actorParticipantId];
          if (strategy === undefined || strategy.operationsDeckOrder.length < 2) return { error: 'CARD_NOT_ELIGIBLE' as const, version: before.version };
          if (working.m2EffectChoice !== undefined) return { error: 'SCHEDULER_SUSPENDED' as const, version: before.version };
          const continuationId = `${working.id}:m2-effect-choice:${working.version + 1}`;
          working.m2EffectChoice = {
            kind: 'M2_EFFECT_GROUPED_CHOICE', schemaVersion: 1, id: continuationId, gameVersion: working.version + 1,
            effectId: 'CARD_EFFECT_BASE_2025_E053', actorParticipantId: options.actorParticipantId,
            chooserParticipantId: options.actorParticipantId, targetParticipantId: options.actorParticipantId,
            sourceCardInstanceId: options.sourceCardInstanceId,
            groups: [{ groupId: 'SELECT_FROM_DECK', minSelections: 2, maxSelections: 2,
              eligibleCardIds: [...strategy.operationsDeckOrder].sort() }], resourceCost: 0, status: 'OPEN',
          };
          const event = this.appendEvent(working, candidate, 'CHOICE_REQUESTED', { continuationId, effectId: options.effectId,
            chooserParticipantId: options.actorParticipantId, optionCount: strategy.operationsDeckOrder.length }, 'OWNER_AND_FACILITATOR');
          return { nextState: working, resultCode: 'M2_EFFECT_CHOICE_REQUESTED', resultPayload: { continuationId,
            chooserParticipantId: options.actorParticipantId }, emittedEventRefs: [event.id] };
        }
        const m2 = buildM2StateFromCanonical(working);
        if (['CARD_EFFECT_BASE_2025_E006', 'CARD_EFFECT_BASE_2025_E013', 'CARD_EFFECT_BASE_2025_E016', 'CARD_EFFECT_BASE_2025_E035', 'CARD_EFFECT_BASE_2025_E047'].includes(options.effectId)) {
          if (working.m2EffectChoice !== undefined) return { error: 'SCHEDULER_SUSPENDED' as const, version: before.version };
          const targetParticipantId = options.effectId === 'CARD_EFFECT_BASE_2025_E013' || options.effectId === 'CARD_EFFECT_BASE_2025_E035' ? options.actorParticipantId
            : typeof options.parameters.targetParticipantId === 'string' ? options.parameters.targetParticipantId : undefined;
          if (targetParticipantId === undefined || m2.participants[targetParticipantId] === undefined) return { error: 'INVALID_EFFECT_INPUT' as const, version: before.version };
          if (options.effectId === 'CARD_EFFECT_BASE_2025_E006' && targetParticipantId === options.actorParticipantId) return { error: 'INVALID_EFFECT_INPUT' as const, version: before.version };
          let choiceRoll: number | undefined;
          if (options.effectId === 'CARD_EFFECT_BASE_2025_E047') {
            const roll = this.random.integer(1, 10); choiceRoll = roll;
            m2.audit.push({ type: 'DIE_ROLLED', actorParticipantId: options.actorParticipantId,
              payload: { rollerParticipantId: targetParticipantId, rawValue: roll, manual: false } });
            if (roll > 6) {
              discardWithLifecycle(m2, options.sourceCardInstanceId); applyM2StateToCanonical(working, m2);
              const event = this.appendEvent(working, candidate, 'M2_EFFECT_EXECUTED', { effectId: options.effectId,
                actorParticipantId: options.actorParticipantId, sourceCardInstanceId: options.sourceCardInstanceId, auditCount: 1 });
              return { nextState: working, resultCode: 'M2_EFFECT_EXECUTED', resultPayload: { effectId: options.effectId, roll, choiceRequired: false }, emittedEventRefs: [event.id] };
            }
          }
          const eligibleCardIds = Object.values(m2.cards).filter((card) => card.controllerParticipantId === targetParticipantId && card.zone === 'HAND' &&
            card.id !== options.sourceCardInstanceId && (options.effectId !== 'CARD_EFFECT_BASE_2025_E047' || card.cardClass === 'ACTION'))
            .map(({ id }) => id).sort();
          if (eligibleCardIds.length === 0) return { error: 'CARD_NOT_ELIGIBLE' as const, version: before.version };
          const continuationId = `${working.id}:m2-effect-choice:${working.version + 1}`;
          if (options.effectId === 'CARD_EFFECT_BASE_2025_E006' || options.effectId === 'CARD_EFFECT_BASE_2025_E013' || options.effectId === 'CARD_EFFECT_BASE_2025_E035') {
            const discardEligible = options.effectId === 'CARD_EFFECT_BASE_2025_E006' ? eligibleCardIds
              : eligibleCardIds.filter((id) => id !== options.sourceCardInstanceId);
            const retrieveEligible = options.effectId === 'CARD_EFFECT_BASE_2025_E013'
              ? Object.values(m2.cards).filter((card) => card.controllerParticipantId === options.actorParticipantId && card.zone === 'DISCARD').map(({ id }) => id).sort()
              : [];
            const deckEligible = options.effectId === 'CARD_EFFECT_BASE_2025_E035'
              ? [...(working.strategy[options.actorParticipantId]?.operationsDeckOrder ?? [])].sort() : [];
            const requiredHandSelections = options.effectId === 'CARD_EFFECT_BASE_2025_E006' ? 5 : options.effectId === 'CARD_EFFECT_BASE_2025_E013' ? 2 : 1;
            if (discardEligible.length < requiredHandSelections ||
                (options.effectId === 'CARD_EFFECT_BASE_2025_E013' && retrieveEligible.length === 0) ||
                (options.effectId === 'CARD_EFFECT_BASE_2025_E035' && (discardEligible.length === 0 || deckEligible.length === 0))) return { error: 'CARD_NOT_ELIGIBLE' as const, version: before.version };
            working.m2EffectChoice = {
              kind: 'M2_EFFECT_GROUPED_CHOICE', schemaVersion: 1, id: continuationId, gameVersion: working.version + 1,
              effectId: options.effectId, actorParticipantId: options.actorParticipantId, chooserParticipantId: options.actorParticipantId,
              targetParticipantId, sourceCardInstanceId: options.sourceCardInstanceId,
              groups: options.effectId === 'CARD_EFFECT_BASE_2025_E006'
                ? [{ groupId: 'DISCARD_FROM_TARGET_HAND', minSelections: 5, maxSelections: 5, eligibleCardIds: discardEligible }]
                : options.effectId === 'CARD_EFFECT_BASE_2025_E013'
                  ? [{ groupId: 'DISCARD_FROM_HAND', minSelections: 2, maxSelections: 2, eligibleCardIds: discardEligible },
                    { groupId: 'RETRIEVE_FROM_DISCARD', minSelections: 1, maxSelections: 1, eligibleCardIds: retrieveEligible }]
                  : [{ groupId: 'SELECT_FROM_DECK', minSelections: 1, maxSelections: 1, eligibleCardIds: deckEligible },
                    { groupId: 'SELECT_FROM_HAND', minSelections: 1, maxSelections: 1, eligibleCardIds: discardEligible }],
              resourceCost: options.effectId === 'CARD_EFFECT_BASE_2025_E006' || options.effectId === 'CARD_EFFECT_BASE_2025_E035' ? 1 : 0, status: 'OPEN',
            };
          } else {
            const simpleEffectId = options.effectId === 'CARD_EFFECT_BASE_2025_E016'
              ? 'CARD_EFFECT_BASE_2025_E016' as const : 'CARD_EFFECT_BASE_2025_E047' as const;
            working.m2EffectChoice = {
              kind: 'M2_EFFECT_CARD_CHOICE', schemaVersion: 1, id: continuationId, gameVersion: working.version + 1,
              effectId: simpleEffectId, actorParticipantId: options.actorParticipantId,
              chooserParticipantId: options.effectId === 'CARD_EFFECT_BASE_2025_E047' ? targetParticipantId : options.actorParticipantId,
              targetParticipantId, sourceCardInstanceId: options.sourceCardInstanceId, eligibleCardIds,
              ...(choiceRoll === undefined ? {} : { roll: choiceRoll }), status: 'OPEN',
            };
          }
          const choice = working.m2EffectChoice;
          const event = this.appendEvent(working, candidate, 'CHOICE_REQUESTED', { continuationId, effectId: options.effectId,
            chooserParticipantId: choice.chooserParticipantId,
            optionCount: choice.kind === 'M2_EFFECT_CARD_CHOICE' ? choice.eligibleCardIds.length
              : choice.groups.reduce((total, group) => total + group.eligibleCardIds.length, 0) }, 'OWNER_AND_FACILITATOR');
          return { nextState: working, resultCode: 'M2_EFFECT_CHOICE_REQUESTED', resultPayload: { continuationId, chooserParticipantId: choice.chooserParticipantId }, emittedEventRefs: [event.id] };
        }
        if (targetDtEffect) {
          const targetDtId = options.parameters.targetDtId;
          const validTarget = typeof targetDtId === 'string' && Object.values(working.populationDemographics)
            .some(({ demographicTokenIds }) => demographicTokenIds.includes(targetDtId));
          if (!validTarget) return { error: 'INVALID_DT' as const, version: before.version };
        }
        let authoritativeParameters: Readonly<Record<string, unknown>> = options.parameters;
        if (options.effectId === 'CARD_EFFECT_BASE_2025_E046') {
          authoritativeParameters = { ...options.parameters, rollsByParticipant: Object.fromEntries(Object.keys(m2.participants)
            .filter((participantId) => participantId !== options.actorParticipantId).sort()
            .map((participantId) => [participantId, this.random.integer(1, 10)])) };
        } else if (options.effectId === 'CARD_EFFECT_BASE_2025_E028') {
          const targetParticipantId = typeof options.parameters.targetParticipantId === 'string' ? options.parameters.targetParticipantId : undefined;
          if (targetParticipantId === undefined || m2.participants[targetParticipantId] === undefined) return { error: 'INVALID_EFFECT_INPUT' as const, version: before.version };
          const pool = Object.values(m2.cards).filter(({ controllerParticipantId, zone }) => controllerParticipantId === targetParticipantId && zone === 'HAND')
            .map(({ id }) => id).sort();
          const selectedCardIds: string[] = [];
          while (selectedCardIds.length < 3 && pool.length > 0) selectedCardIds.push(pool.splice(this.random.integer(0, pool.length - 1), 1)[0]!);
          authoritativeParameters = { ...options.parameters, selectedCardIds };
        }
        const result = new M2BEffectDispatcher('M2-4').dispatch(m2, {
          actorParticipantId: options.actorParticipantId, effectId: options.effectId,
          effectVersion: options.effectVersion,
          parameters: { ...authoritativeParameters, sourceCardInstanceId: options.sourceCardInstanceId },
        });
        if (!result.ok) return { error: result.error, version: before.version };
        if (options.effectId === 'CARD_EFFECT_BASE_2025_E042' || options.effectId === 'CARD_EFFECT_BASE_2025_E034') result.state.cards[options.sourceCardInstanceId]!.zone = 'REMOVED_FROM_GAME';
        else if (!pairBonusEffect && !targetDtEffect) discardWithLifecycle(result.state, options.sourceCardInstanceId);
        applyM2StateToCanonical(working, result.state);
        const event = this.appendEvent(working, candidate, 'M2_EFFECT_EXECUTED', {
          effectId: options.effectId, actorParticipantId: options.actorParticipantId,
          sourceCardInstanceId: options.sourceCardInstanceId, auditCount: result.emitted.length,
        });
        return {
          nextState: working, resultCode: 'M2_EFFECT_EXECUTED',
          resultPayload: { effectId: options.effectId, audit: result.emitted }, emittedEventRefs: [event.id],
        };
      },
    });
  }

  executeM2CoreOperation(options: {
    readonly gameId: string;
    readonly expectedGameVersion: number;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly operation: M2CoreOperation;
    readonly schedulerPlan?: { readonly id: string; readonly operations: readonly M2CoreOperation[]; readonly index: number };
    readonly correlationId?: string;
  }): EngineCommandResult {
    if (this.randomTransactionOwner === 'APPLICATION') return this.executeM2CoreOperationAtomic(options);
    const checkpoint = this.random.checkpoint();
    try {
      const result = this.executeM2CoreOperationAtomic(options);
      if (result.status === 'RESOLVED') this.random.commit(checkpoint);
      else this.random.restore(checkpoint);
      return result;
    } catch (error) {
      this.random.restore(checkpoint);
      throw error;
    }
  }

  private executeM2CoreOperationAtomic(options: {
    readonly gameId: string;
    readonly expectedGameVersion: number;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly operation: M2CoreOperation;
    readonly schedulerPlan?: { readonly id: string; readonly operations: readonly M2CoreOperation[]; readonly index: number };
    readonly correlationId?: string;
  }): EngineCommandResult {
    const envelope: CommandEnvelope<'INTERNAL_EXECUTE_M2_CORE_OPERATION', Record<string, never>> = {
      engineContractVersion: M1_0_BASELINE_VERSIONS.engineContractVersion,
      commandId: options.commandId, idempotencyKey: options.idempotencyKey, gameId: options.gameId,
      actorContext: { actorId: 'M2_INTERNAL_COORDINATOR', actorType: 'SYSTEM', authenticatedSessionId: 'internal:m2', permissions: ['game:internal-core-operation'] },
      expectedGameVersion: options.expectedGameVersion, commandType: 'INTERNAL_EXECUTE_M2_CORE_OPERATION',
      payloadSchemaVersion: M1_0_BASELINE_VERSIONS.fixtureSchemaVersion, payload: {},
      ...(options.correlationId === undefined ? {} : { correlationId: options.correlationId }),
    };
    return dispatchAtomicCommand({
      envelope, store: this.store, now: this.now,
      prepare: (before, candidate) => {
        const version = before?.version ?? 0;
        if (before === undefined) return { error: 'GAME_NOT_FOUND' as const, version };
        if (candidate.expectedGameVersion !== before.version) return { error: 'STALE_STATE_VERSION' as const, version: before.version };
        if (before.overlay === 'PAUSED') return { error: 'GAME_PAUSED' as const, version: before.version };
        if (before.phase !== 'RESOLUTION_STAGE') return { error: 'WRONG_PHASE' as const, version: before.version };
        const operation = options.operation;
        if (before.participants[operation.actorParticipantId]?.role !== 'PLAYER') return { error: 'PARTICIPANT_NOT_FOUND' as const, version: before.version };
        const schedulerPlan = options.schedulerPlan;
        const planSha256 = schedulerPlan === undefined ? undefined : sha256CanonicalJson(schedulerPlan.operations);
        if (schedulerPlan !== undefined) {
          const continuation = before.m2CoreScheduler;
          const activeContinuation = continuation?.status === 'COMPLETE' ? undefined : continuation;
          if (schedulerPlan.operations.length === 0 || schedulerPlan.operations[schedulerPlan.index] === undefined ||
              sha256CanonicalJson(schedulerPlan.operations[schedulerPlan.index]) !== sha256CanonicalJson(operation)) {
            return { error: 'INVALID_EFFECT_INPUT' as const, version: before.version };
          }
          if (activeContinuation !== undefined && (activeContinuation.id !== schedulerPlan.id || activeContinuation.operationPlanSha256 !== planSha256 || activeContinuation.operationCount !== schedulerPlan.operations.length)) {
            return { error: 'STALE_CONTINUATION' as const, version: before.version };
          }
          if ((activeContinuation?.nextIndex ?? 0) !== schedulerPlan.index) {
            return { error: 'STALE_CONTINUATION' as const, version: before.version };
          }
        }
        const working = structuredClone(before); const m2 = buildM2StateFromCanonical(working);
        let error: AnyEngineErrorCode | undefined; let subjectId = ''; let detail: Readonly<Record<string, unknown>> = {};
        if (operation.kind === 'APPLY_BACKLASH') {
          if (working.populationDemographics[operation.pdId] === undefined || !Number.isInteger(operation.amount) || operation.amount < 0) error = 'INVALID_EFFECT_INPUT';
          else { const placed = applyBacklash(m2, operation.actorParticipantId, operation.pdId, operation.amount); subjectId = operation.pdId; detail = { placed }; }
        } else if (operation.kind === 'ESTABLISH_LEGITIMACY') {
          if (working.populationDemographics[operation.pdId] === undefined || (operation.replacePdId !== undefined && working.populationDemographics[operation.replacePdId] === undefined)) error = 'INVALID_EFFECT_INPUT';
          else if (!establishLegitimacy(m2, operation.actorParticipantId, operation.pdId, operation.replacePdId)) error = 'INVALID_EFFECT_INPUT';
          else subjectId = operation.pdId;
        } else if (operation.kind === 'MODIFY_CAMPAIGN') {
          const campaign = m2.campaigns[operation.campaignId]; const replacement = m2.cards[operation.replacementCardId];
          if (campaign?.ownerParticipantId !== operation.actorParticipantId) error = 'CAMPAIGN_NOT_OWNED';
          else if (replacement?.controllerParticipantId !== operation.actorParticipantId) error = 'CARD_NOT_CONTROLLED';
          else { error = modifyCampaignCard(m2, operation.campaignId, operation.oldCardId, operation.replacementCardId); subjectId = operation.campaignId; }
        } else if (operation.kind === 'DISCARD_CAMPAIGN') {
          if (m2.campaigns[operation.campaignId]?.ownerParticipantId !== operation.actorParticipantId) error = 'CAMPAIGN_NOT_OWNED';
          else { error = discardCampaign(m2, operation.campaignId); subjectId = operation.campaignId; }
        } else if (operation.kind === 'PLAY_STARTER') {
          const card = m2.cards[operation.cardId];
          if (card?.controllerParticipantId !== operation.actorParticipantId) error = 'CARD_NOT_CONTROLLED';
          else { error = playStarter(m2, operation.cardId, operation.actorParticipantId); subjectId = operation.cardId; }
        } else {
          if (m2.participants[operation.targetParticipantId] === undefined || operation.targetParticipantId === operation.actorParticipantId) error = 'INVALID_EFFECT_INPUT';
          else {
            const eligible = Object.values(m2.cards).filter(({ controllerParticipantId, zone }) => controllerParticipantId === operation.targetParticipantId && zone === 'HAND').length;
            if (eligible === 0) error = 'CARD_NOT_ELIGIBLE';
            else {
              const stolenCardId = stealBlindCard(m2, operation.actorParticipantId, operation.targetParticipantId, this.random.integer(0, eligible - 1));
              if (stolenCardId === undefined) error = 'CARD_NOT_ELIGIBLE';
              else { subjectId = stolenCardId; detail = { stolenCardId }; }
            }
          }
        }
        if (error !== undefined) return { error, version: before.version };
        m2.audit.push({ type: operation.kind, actorParticipantId: operation.actorParticipantId, payload: { subjectId } });
        applyM2StateToCanonical(working, m2);
        if (schedulerPlan !== undefined && planSha256 !== undefined) {
          const nextIndex = schedulerPlan.index + 1;
          working.m2CoreScheduler = {
            id: schedulerPlan.id, schemaVersion: 1, operationPlanSha256: planSha256,
            operationCount: schedulerPlan.operations.length, nextIndex,
            status: nextIndex === schedulerPlan.operations.length ? 'COMPLETE' : 'READY',
          };
        }
        const event = this.appendEvent(working, candidate, 'M2_CORE_OPERATION_EXECUTED', {
          operation: operation.kind, actorParticipantId: operation.actorParticipantId, subjectId,
          ...(operation.kind === 'STEAL_BLIND_CARD' ? { ownerParticipantId: operation.actorParticipantId } : {}),
        }, operation.kind === 'STEAL_BLIND_CARD' ? 'OWNER_AND_FACILITATOR' : undefined);
        return { nextState: working, resultCode: 'M2_CORE_OPERATION_EXECUTED', resultPayload: { operation: operation.kind, subjectId, ...detail }, emittedEventRefs: [event.id] };
      },
    });
  }

  runM2EndGame(options: {
    readonly gameId: string;
    readonly expectedGameVersion: number;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly correlationId?: string;
  }): EngineCommandResult {
    const envelope: CommandEnvelope<'INTERNAL_RUN_M2_END_GAME', Record<string, never>> = {
      engineContractVersion: M1_0_BASELINE_VERSIONS.engineContractVersion,
      commandId: options.commandId,
      idempotencyKey: options.idempotencyKey,
      gameId: options.gameId,
      actorContext: {
        actorId: 'M2_INTERNAL_COORDINATOR',
        actorType: 'SYSTEM',
        authenticatedSessionId: 'internal:m2',
        permissions: ['game:internal-end-game'],
      },
      expectedGameVersion: options.expectedGameVersion,
      commandType: 'INTERNAL_RUN_M2_END_GAME',
      payloadSchemaVersion: M1_0_BASELINE_VERSIONS.fixtureSchemaVersion,
      payload: {},
      ...(options.correlationId === undefined ? {} : { correlationId: options.correlationId }),
    };
    return dispatchAtomicCommand({
      envelope,
      store: this.store,
      now: this.now,
      prepare: (before, candidate) => {
        const version = before?.version ?? 0;
        if (before === undefined) return { error: 'GAME_NOT_FOUND' as const, version };
        if (candidate.expectedGameVersion !== before.version) {
          return { error: 'STALE_STATE_VERSION' as const, version: before.version };
        }
        if (before.overlay === 'PAUSED') return { error: 'GAME_PAUSED' as const, version: before.version };
        if (before.phase !== 'RESOLUTION_STAGE') return { error: 'WRONG_PHASE' as const, version: before.version };

        const working = structuredClone(before);
        working.endGame ??= { idempotencyResults: {}, awardedObjectiveKeys: [] };
        const metrics: Record<string, PdObjectiveMetrics> = {};
        for (const pd of Object.values(working.populationDemographics)) {
          const attributedMalign: Partial<Record<CountryId, number>> = {};
          const attributedResiliency: Partial<Record<CountryId, number>> = {};
          let totalMalign = 0;
          let totalResiliency = 0;
          for (const stack of working.adjudication.influenceStacks.filter(({ pdId }) => pdId === pd.id)) {
            const target = stack.type === 'MALIGN' ? attributedMalign : attributedResiliency;
            target[stack.attributionCountryId] = (target[stack.attributionCountryId] ?? 0) + stack.count;
            if (stack.type === 'MALIGN') totalMalign += stack.count;
            else totalResiliency += stack.count;
          }
          metrics[pd.id] = {
            hostCountryId: pd.hostCountryId,
            traits: pd.demographicTokenIds.map((token) => token.slice(token.indexOf(':') + 1)),
            totalMalign,
            totalResiliency,
            attributedMalign,
            attributedResiliency,
          };
        }

        const outcome = finalizeGame(
          working.endGame,
          buildM2StateFromCanonical(working),
          metrics,
          candidate.idempotencyKey,
        );
        const events = outcome.scores.map((score) => {
          working.adjudication.vpByParticipant[score.participantId] = score.finalVp;
          return this.appendEvent(working, candidate, 'OBJECTIVE_AWARDED', {
            participantId: score.participantId,
            countryId: score.countryId,
            baseVp: score.baseVp,
            objectiveVp: score.objectiveVp,
            finalVp: score.finalVp,
          });
        });
        events.push(this.appendEvent(working, candidate, 'GAME_COMPLETED', {
          winnerParticipantIds: outcome.winnerParticipantIds.join(','),
          sharedVictory: outcome.sharedVictory,
        }));
        return {
          nextState: working,
          resultCode: 'M2_GAME_COMPLETED',
          resultPayload: structuredClone(outcome),
          emittedEventRefs: events.map(({ id }) => id),
        };
      },
    });
  }

  private prepare(before: SetupGameState | undefined, envelope: SetupEnvelope) {
    const beforeVersion = before?.version ?? 0;
    if (envelope.engineContractVersion !== M1_0_BASELINE_VERSIONS.engineContractVersion) {
      return { error: 'UNSUPPORTED_CONTRACT_VERSION' as const, version: beforeVersion };
    }
    if (envelope.payloadSchemaVersion !== M1_0_BASELINE_VERSIONS.fixtureSchemaVersion) {
      return { error: 'UNSUPPORTED_PAYLOAD_VERSION' as const, version: beforeVersion };
    }
    if (envelope.commandType === 'CREATE_GAME') {
      if (before !== undefined) return { error: 'GAME_ALREADY_EXISTS' as const, version: before.version };
      if (envelope.expectedGameVersion !== 0) return { error: 'STALE_STATE_VERSION' as const, version: 0 };
      const actorError = this.validateCreateActor(envelope.actorContext);
      if (actorError !== undefined) return { error: actorError, version: 0 };
      return this.createGame(envelope);
    }
    if (before === undefined) return { error: 'GAME_NOT_FOUND' as const, version: 0 };
    if (envelope.gameId !== before.id) return { error: 'GAME_ID_MISMATCH' as const, version: before.version };
    if (envelope.expectedGameVersion !== before.version) return { error: 'STALE_STATE_VERSION' as const, version: before.version };
    const actorError = this.validateActor(before, envelope);
    if (actorError !== undefined) return { error: actorError, version: before.version };
    if (before.overlay === 'PAUSED' && pauseBlockedCommands.has(envelope.commandType)) {
      return { error: 'GAME_PAUSED' as const, version: before.version };
    }

    const working = structuredClone(before);
    const outcome = this.reduce(working, envelope);
    if ('error' in outcome) return { error: outcome.error, version: before.version };
    return {
      nextState: working,
      resultCode: outcome.resultCode,
      ...(outcome.resultPayload === undefined ? {} : { resultPayload: outcome.resultPayload }),
      emittedEventRefs: outcome.events.map(({ id }) => id),
    };
  }

  private validateCreateActor(actor: ActorContext): AnyEngineErrorCode | undefined {
    if (actor.actorType !== 'FACILITATOR' || actor.participantId !== 'F1' || !actor.permissions.includes('game:create')) {
      return 'NOT_AUTHORIZED';
    }
    return undefined;
  }

  private validateActor(state: SetupGameState, envelope: SetupEnvelope): AnyEngineErrorCode | undefined {
    const { actorContext, commandType } = envelope;
    if (commandType === 'JOIN_GAME_MEMBERSHIP') {
      if (
        actorContext.actorType !== 'PLAYER' ||
        actorContext.participantId === undefined ||
        !canonicalPlayerIds.includes(actorContext.participantId) ||
        !actorContext.permissions.includes('game:join')
      ) return 'INVALID_ACTOR_CONTEXT';
      return undefined;
    }

    const participantId = actorContext.participantId;
    const participant = participantId === undefined ? undefined : state.participants[participantId];
    if (participant === undefined || participant.userId !== actorContext.actorId || participant.role !== actorContext.actorType) {
      return 'INVALID_ACTOR_CONTEXT';
    }
    if (facilitatorCommands.has(commandType)) {
      return participant.role === 'FACILITATOR' && participant.id === 'F1' && actorContext.permissions.includes('game:facilitate')
        ? undefined
        : 'NOT_AUTHORIZED';
    }
    if (participant.role !== 'PLAYER' || !actorContext.permissions.includes('game:play')) return 'NOT_AUTHORIZED';
    const seat = state.seats[participant.id];
    if (
      seat === undefined ||
      actorContext.playerSeatId !== seat.id ||
      actorContext.countryId !== seat.countryId
    ) return 'INVALID_ACTOR_CONTEXT';
    return undefined;
  }

  private createGame(envelope: SetupEnvelope) {
    const payload = envelope.payload as CreateGamePayload;
    if (payload.scenarioDefinitionId !== 'BASE_2025') return { error: 'UNSUPPORTED_SCENARIO' as const, version: 0 };
    if (!isPositiveInteger(payload.turnLimit)) return { error: 'INVALID_TURN_LIMIT' as const, version: 0 };
    if (!isDiceMode(payload.preferredDiceMode)) return { error: 'INVALID_DICE_MODE' as const, version: 0 };
    if (
      payload.rulesetVersion !== M1_0_BASELINE_VERSIONS.rulesetVersion ||
      payload.scenarioVersion !== M1_0_BASELINE_VERSIONS.scenarioVersion ||
      payload.cardRegistryVersion !== M1_0_BASELINE_VERSIONS.cardRegistryVersion ||
      payload.engineContractVersion !== M1_0_BASELINE_VERSIONS.engineContractVersion ||
      payload.fixtureSchemaVersion !== M1_0_BASELINE_VERSIONS.fixtureSchemaVersion
    ) return { error: 'INVALID_COMMAND_PAYLOAD' as const, version: 0 };

    const participantId = envelope.actorContext.participantId;
    if (participantId === undefined) return { error: 'INVALID_ACTOR_CONTEXT' as const, version: 0 };
    const countries = Object.fromEntries(BASE_2025_COUNTRIES.map((country) => [country.id, {
      id: country.id,
      resources: country.startingResources,
      turnIncome: country.turnIncome,
    }])) as SetupGameState['countries'];
    const populationDemographics = Object.fromEntries(
      BASE_2025_POPULATION_DEMOGRAPHICS.map((pd) => [pd.id, structuredClone(pd)]),
    );
    const cardDefinitions = Object.fromEntries(BASE_2025_CARD_REGISTRY.map((definition) => [definition.id, definition]));
    const cards: Record<string, SetupCardInstance> = {};
    for (const country of BASE_2025_COUNTRIES) {
      for (const definition of BASE_2025_CARD_REGISTRY) {
        const id = cardInstanceId(country.id, definition.serialWithinCountrySet);
        cards[id] = {
          id,
          gameId: envelope.gameId,
          countryOwnerId: country.id,
          definitionId: definition.id,
          serialWithinCountrySet: definition.serialWithinCountrySet,
          zone: definition.starter ? 'STARTER_POOL' : 'OPERATIONS_POOL',
        };
      }
    }

    const state: SetupGameState = {
      id: envelope.gameId,
      version: 0,
      scenarioId: 'BASE_2025',
      phase: 'SETUP',
      overlay: 'ACTIVE',
      versions: {
        rulesetVersion: payload.rulesetVersion,
        scenarioVersion: payload.scenarioVersion,
        cardRegistryVersion: payload.cardRegistryVersion,
        engineContractVersion: payload.engineContractVersion,
        fixtureSchemaVersion: payload.fixtureSchemaVersion,
      },
      facilitatorParticipantId: participantId,
      turnLimit: payload.turnLimit,
      diceMode: payload.preferredDiceMode,
      baseApPerTurn: 3,
      strategyDeckSize: 30,
      starterCardsPerPlayer: 5,
      handLimit: 10,
      participants: {
        [participantId]: {
          id: participantId,
          gameId: envelope.gameId,
          userId: envelope.actorContext.actorId,
          role: 'FACILITATOR',
          status: 'ACTIVE',
        },
      },
      seats: {},
      countries,
      populationDemographics,
      cardDefinitions,
      cards,
      strategy: {},
      initiative: {
        status: 'PENDING_ROLL',
        rolls: [],
        orderParticipantIds: [],
        maintenance: {},
      },
      actionPlanning: {},
      resourceLedger: BASE_2025_COUNTRIES.map((country, index) => ({
        id: `${envelope.gameId}:resource-ledger:${index + 1}`,
        participantId: null,
        countryId: country.id,
        reason: 'SCENARIO_SETUP',
        delta: country.startingResources,
        balanceAfter: country.startingResources,
        gameVersion: 1,
      })),
      actionPointLedger: [],
      secretVictoryObjectives: {},
      adjudication: {
        campaignCardRules: structuredClone(BASE_2025_M1_CAMPAIGN_CARD_RULES),
        campaigns: {},
        influenceStacks: BASE_2025_POPULATION_DEMOGRAPHICS.map((pd) => ({
          pdId: pd.id,
          type: pd.initialInfluence.type,
          attributionCountryId: pd.initialInfluence.attributionCountryId,
          count: pd.initialInfluence.count,
        })),
        legitimacyByPd: Object.fromEntries(BASE_2025_POPULATION_DEMOGRAPHICS.map(({ id }) => [id, null])),
        vpByParticipant: {},
        narrativesByCampaign: {},
        scheduler: { participantIndex: 0, slotIndex: 0, status: 'READY' },
        resolvedChoiceIds: [],
        dieRolls: [],
        influenceLedger: [],
        legitimacyLedger: [],
        vpLedger: [],
        influenceResolutions: [],
        traces: [],
      },
      events: [],
    };
    const event = this.appendEvent(state, envelope, 'GAME_CREATED', { phase: state.phase });
    return {
      nextState: state,
      resultCode: 'GAME_CREATED',
      resultPayload: { gameId: state.id, status: state.phase, pinnedVersions: state.versions },
      emittedEventRefs: [event.id],
    };
  }

  private reduce(state: SetupGameState, envelope: SetupEnvelope):
    | { readonly resultCode: string; readonly resultPayload?: unknown; readonly events: SetupGameEvent[] }
    | { readonly error: AnyEngineErrorCode } {
    switch (envelope.commandType) {
      case 'JOIN_GAME_MEMBERSHIP': return this.join(state, envelope);
      case 'ASSIGN_PLAYER_SEAT': return this.assignSeat(state, envelope);
      case 'CONFIGURE_GAME_OPTION': return this.configureOption(state, envelope);
      case 'START_GAME': return this.startGame(state, envelope);
      case 'PAUSE_GAME': return this.pause(state, envelope);
      case 'RESUME_GAME': return this.resume(state, envelope);
      case 'SUBMIT_OPERATIONS_DECK': return this.submitDeck(state, envelope);
      case 'LOCK_STRATEGY': return this.lockStrategy(state, envelope);
      case 'REQUEST_INITIATIVE_ROLL': return this.resolveInitiative(state, envelope);
      case 'SET_INITIATIVE_MAINTENANCE': return this.setInitiativeMaintenance(state, envelope);
      case 'LOCK_INITIATIVE_MAINTENANCE': return this.lockInitiativeMaintenance(state, envelope);
      case 'SET_ACTION_PLAN': return this.setActionPlan(state, envelope);
      case 'LOCK_ACTION_PLAN': return this.lockActionPlan(state, envelope);
      case 'CONSTRUCT_CAMPAIGN':
        return { error: 'WRONG_PHASE' };
      case 'END_GAME_SCORING':
        return { error: 'ILLEGAL_STATE_TRANSITION' };
      case 'PASS_REACTION': return this.passReaction(state, envelope);
      case 'PLAY_REACTION': return this.playReaction(state, envelope);
      case 'SUBMIT_VETO_DEFENSE': return this.submitVetoDefense(state, envelope);
      case 'CAST_VETO_VOTE': return this.castVetoVote(state, envelope);
      case 'RESOLVE_VETO_ABUSE': return this.resolveVetoAbuse(state, envelope);
      case 'SUBMIT_M2_EFFECT_CHOICE': return this.submitM2EffectChoice(state, envelope);
      case 'CREATE_GAME': return { error: 'GAME_ALREADY_EXISTS' };
    }
  }

  private passReaction(state: SetupGameState, envelope: SetupEnvelope) {
    if (state.phase !== 'RESOLUTION_STAGE') return { error: 'WRONG_PHASE' as const };
    const participantId = envelope.actorContext.participantId;
    if (participantId === undefined) return { error: 'INVALID_ACTOR_CONTEXT' as const };
    const continuation = state.reactionContinuation;
    if (continuation === undefined) return { error: 'REACTION_WINDOW_CLOSED' as const };
    const error = passReactionPriority(continuation.window, participantId);
    if (error !== undefined) return { error };
    const events = [this.appendEvent(state, envelope, 'REACTION_PRIORITY_PASSED', {
      windowId: continuation.window.id, participantId,
    })];
    if (continuation.window.status === 'CLOSED') events.push(this.appendEvent(state, envelope, 'REACTION_WINDOW_CLOSED', { windowId: continuation.window.id }));
    return { resultCode: 'REACTION_PRIORITY_PASSED', resultPayload: { windowId: continuation.window.id, status: continuation.window.status }, events };
  }

  private playReaction(state: SetupGameState, envelope: SetupEnvelope) {
    if (state.phase !== 'RESOLUTION_STAGE') return { error: 'WRONG_PHASE' as const };
    const participantId = envelope.actorContext.participantId;
    if (participantId === undefined) return { error: 'INVALID_ACTOR_CONTEXT' as const };
    const continuation = state.reactionContinuation;
    if (continuation === undefined) return { error: 'REACTION_WINDOW_CLOSED' as const };
    const payload = envelope.payload as PlayReactionPayload;
    const card = state.cards[payload.cardId];
    if (card === undefined || card.definitionId !== reactionDefinitionByEffect[payload.effectId]) return { error: 'REACTION_NOT_ELIGIBLE' as const };
    if (payload.effectId === 'CARD_EFFECT_BASE_2025_E048' &&
        state.vetoAbuseReviewByWindowParticipant?.[`${continuation.window.id}:${participantId}`] === 'REJECT') return { error: 'VETO_ABUSE' as const };
    const m2 = buildM2StateFromCanonical(state);
    const needsRoll = payload.effectId === 'CARD_EFFECT_BASE_2025_E036' || payload.effectId === 'CARD_EFFECT_BASE_2025_E040';
    const result = playReaction(m2, continuation.window, {
      participantId, cardId: payload.cardId, effectId: payload.effectId,
      ...(needsRoll ? { roll: this.random.integer(1, 10) } : {}),
    });
    if (result.error !== undefined) return { error: result.error };
    applyM2StateToCanonical(state, m2);
    if (payload.effectId === 'CARD_EFFECT_BASE_2025_E048') {
      const campaignId = continuation.window.triggeringCampaignId;
      if (campaignId === undefined || state.adjudication.campaigns[campaignId] === undefined || state.m2Veto !== undefined) {
        return { error: 'INVALID_REACTION_INPUT' as const };
      }
      const electorateParticipantIds = state.initiative.orderParticipantIds.filter((id) => state.participants[id]?.role === 'PLAYER');
      state.m2Veto = {
        kind: 'M2_VETO', schemaVersion: 1, id: `${continuation.window.id}:veto`, gameVersion: state.version + 1,
        campaignId, vetoCardInstanceId: payload.cardId, initiatorParticipantId: participantId,
        offendingParticipantId: continuation.window.triggeringParticipantId, reasonText: payload.reasonText!,
        electorateParticipantIds, votes: {}, status: 'AWAITING_DEFENSE',
      };
    }
    if (result.child !== undefined) {
      state.reactionContinuation = makeReactionContinuation(`${result.child.id}:continuation`, state.version + 1, result.child, continuation);
    }
    const active = state.reactionContinuation!;
    const events = [this.appendEvent(state, envelope, 'REACTION_PLAYED', {
      windowId: continuation.window.id, participantId, cardId: payload.cardId, effectId: payload.effectId, negated: result.negated ?? false,
    })];
    if (state.m2Veto !== undefined && payload.effectId === 'CARD_EFFECT_BASE_2025_E048') events.push(this.appendEvent(state, envelope, 'VETO_STARTED', {
      vetoCaseId: state.m2Veto.id, campaignId: state.m2Veto.campaignId, initiatorParticipantId: participantId,
      offendingParticipantId: state.m2Veto.offendingParticipantId,
    }));
    if (active.window.status === 'CLOSED') events.push(this.appendEvent(state, envelope, 'REACTION_WINDOW_CLOSED', { windowId: active.window.id }));
    return { resultCode: 'REACTION_PLAYED', resultPayload: { windowId: active.window.id, status: active.window.status, negated: result.negated ?? false }, events };
  }

  private submitVetoDefense(state: SetupGameState, envelope: SetupEnvelope) {
    if (state.phase !== 'RESOLUTION_STAGE') return { error: 'WRONG_PHASE' as const };
    const participantId = envelope.actorContext.participantId; const payload = envelope.payload as SubmitVetoDefensePayload;
    const veto = state.m2Veto;
    if (participantId === undefined) return { error: 'INVALID_ACTOR_CONTEXT' as const };
    if (veto === undefined || veto.id !== payload.vetoCaseId) return { error: 'STALE_CONTINUATION' as const };
    if (veto.status !== 'AWAITING_DEFENSE' || veto.offendingParticipantId !== participantId) return { error: 'NOT_AUTHORIZED' as const };
    veto.defenseText = payload.defenseText; veto.status = 'VOTING';
    const event = this.appendEvent(state, envelope, 'VETO_DEFENSE_SUBMITTED', { vetoCaseId: veto.id, participantId });
    return { resultCode: 'VETO_DEFENSE_SUBMITTED', resultPayload: { vetoCaseId: veto.id, status: veto.status }, events: [event] };
  }

  private resolveVetoAbuse(state: SetupGameState, envelope: SetupEnvelope) {
    if (state.phase !== 'RESOLUTION_STAGE') return { error: 'WRONG_PHASE' as const };
    const payload = envelope.payload as ResolveVetoAbusePayload; const continuation = state.reactionContinuation;
    if (continuation === undefined || continuation.window.id !== payload.reactionWindowId || continuation.window.trigger !== 'NARRATIVE' ||
        continuation.window.priorityParticipantIds[continuation.window.priorityIndex] !== payload.initiatorParticipantId) return { error: 'STALE_CONTINUATION' as const };
    state.vetoAbuseReviewByWindowParticipant ??= {};
    state.vetoAbuseReviewByWindowParticipant[`${payload.reactionWindowId}:${payload.initiatorParticipantId}`] = payload.decision;
    const event = this.appendEvent(state, envelope, 'VETO_ABUSE_REVIEWED', { windowId: payload.reactionWindowId,
      participantId: payload.initiatorParticipantId, decision: payload.decision });
    return { resultCode: 'VETO_ABUSE_REVIEWED', resultPayload: { reactionWindowId: payload.reactionWindowId, decision: payload.decision }, events: [event] };
  }

  private castVetoVote(state: SetupGameState, envelope: SetupEnvelope) {
    if (state.phase !== 'RESOLUTION_STAGE') return { error: 'WRONG_PHASE' as const };
    const participantId = envelope.actorContext.participantId; const payload = envelope.payload as CastVetoVotePayload;
    const veto = state.m2Veto;
    if (participantId === undefined) return { error: 'INVALID_ACTOR_CONTEXT' as const };
    if (veto === undefined || veto.id !== payload.vetoCaseId) return { error: 'STALE_CONTINUATION' as const };
    if (veto.status !== 'VOTING' || !veto.electorateParticipantIds.includes(participantId) || veto.votes[participantId] !== undefined) {
      return { error: 'INVALID_REACTION_INPUT' as const };
    }
    veto.votes[participantId] = payload.vote;
    const events = [this.appendEvent(state, envelope, 'VETO_VOTE_CAST', { vetoCaseId: veto.id, participantId, vote: payload.vote })];
    if (Object.keys(veto.votes).length < veto.electorateParticipantIds.length) {
      return { resultCode: 'VETO_VOTE_CAST', resultPayload: { vetoCaseId: veto.id, votesCast: Object.keys(veto.votes).length }, events };
    }
    const result = resolveVeto(veto.votes);
    const m2 = buildM2StateFromCanonical(state);
    const vetoCard = m2.cards[veto.vetoCardInstanceId];
    if (vetoCard?.zone !== 'HAND') return { error: 'REACTION_NOT_ELIGIBLE' as const };
    discardWithLifecycle(m2, veto.vetoCardInstanceId); vetoCard.zone = 'REMOVED_FROM_GAME';
    if (result.rejectedCampaign) {
      const error = discardCampaign(m2, veto.campaignId); if (error !== undefined) return { error };
      state.vetoBlockedParticipantIdsThisTurn ??= [];
      if (!state.vetoBlockedParticipantIdsThisTurn.includes(veto.offendingParticipantId)) state.vetoBlockedParticipantIdsThisTurn.push(veto.offendingParticipantId);
    }
    applyM2StateToCanonical(state, m2);
    const resolvedId = veto.id; const campaignId = veto.campaignId; const offendingParticipantId = veto.offendingParticipantId;
    delete state.m2Veto;
    if (result.rejectedCampaign) delete state.reactionContinuation;
    else {
      const window = openReactionWindow(`${state.id}:reaction:${state.version + 1}:post-veto`, 'NARRATIVE', offendingParticipantId,
        state.initiative.orderParticipantIds, undefined, { triggeringCampaignId: campaignId });
      state.reactionContinuation = makeReactionContinuation(`${window.id}:continuation`, state.version + 1, window);
    }
    events.push(this.appendEvent(state, envelope, 'VETO_RESOLVED', { vetoCaseId: resolvedId, campaignId,
      rejectedCampaign: result.rejectedCampaign, unacceptable: result.unacceptable, activePlayers: result.activePlayers }));
    return { resultCode: 'VETO_RESOLVED', resultPayload: { vetoCaseId: resolvedId, ...result }, events };
  }

  private submitM2EffectChoice(state: SetupGameState, envelope: SetupEnvelope) {
    const participantId = envelope.actorContext.participantId;
    const payload = envelope.payload as SubmitM2EffectChoicePayload;
    const continuation = state.m2EffectChoice;
    const expectedPhase = continuation?.effectId === 'CARD_EFFECT_BASE_2025_E053' ? 'ACTION_STAGE_PLAN' : 'RESOLUTION_STAGE';
    if (state.phase !== expectedPhase) return { error: 'WRONG_PHASE' as const };
    if (participantId === undefined) return { error: 'INVALID_ACTOR_CONTEXT' as const };
    if (continuation === undefined || continuation.id !== payload.continuationId) return { error: 'STALE_CONTINUATION' as const };
    if (continuation.chooserParticipantId !== participantId) return { error: 'NOT_AUTHORIZED' as const };
    if (continuation.kind === 'M2_EFFECT_GROUPED_CHOICE' && continuation.effectId === 'CARD_EFFECT_BASE_2025_E053' &&
        continuation.groups.some(({ groupId }) => groupId === 'SELECT_FROM_DECK')) {
      if (!('selections' in payload) || Object.keys(payload.selections).join('|') !== 'SELECT_FROM_DECK') return { error: 'INVALID_EFFECT_INPUT' as const };
      const selectedIds = payload.selections.SELECT_FROM_DECK ?? []; const group = continuation.groups[0];
      const strategy = state.strategy[participantId];
      if (selectedIds.length !== 2 || new Set(selectedIds).size !== 2 || selectedIds.some((id) => !group?.eligibleCardIds.includes(id)) ||
          strategy === undefined || selectedIds.some((id) => !strategy.operationsDeckOrder.includes(id)) ||
          !strategy.handCardInstanceIds.includes(continuation.sourceCardInstanceId)) return { error: 'STALE_CONTINUATION' as const };
      strategy.operationsDeckOrder = this.shuffle(strategy.operationsDeckOrder.filter((id) => !selectedIds.includes(id)));
      strategy.handCardInstanceIds = strategy.handCardInstanceIds.filter((id) => id !== continuation.sourceCardInstanceId);
      strategy.handCardInstanceIds.push(...selectedIds);
      for (const id of selectedIds) { state.cards[id]!.zone = 'HAND'; delete state.cards[id]!.zonePosition; }
      state.cards[continuation.sourceCardInstanceId]!.zone = 'REMOVED_FROM_GAME';
      strategy.operationsDeckOrder.forEach((id, index) => { const card = state.cards[id]; if (card !== undefined) card.zonePosition = index; });
      const overflow = Math.max(0, strategy.handCardInstanceIds.length - state.handLimit);
      const resolvedEvent = this.appendEvent(state, envelope, 'CHOICE_RESOLVED', { continuationId: continuation.id, effectId: continuation.effectId }, 'OWNER_AND_FACILITATOR');
      if (overflow > 0) {
        const nextId = `${continuation.id}:hand-limit`;
        state.m2EffectChoice = {
          kind: 'M2_EFFECT_GROUPED_CHOICE', schemaVersion: 1, id: nextId, gameVersion: state.version + 1,
          effectId: 'CARD_EFFECT_BASE_2025_E053', actorParticipantId: participantId, chooserParticipantId: participantId,
          targetParticipantId: participantId, sourceCardInstanceId: continuation.sourceCardInstanceId,
          groups: [{ groupId: 'HAND_LIMIT_DISCARD', minSelections: overflow, maxSelections: overflow,
            eligibleCardIds: [...strategy.handCardInstanceIds].sort() }], resourceCost: 0, sourceLifecycleCommitted: true, status: 'OPEN',
        };
        const requested = this.appendEvent(state, envelope, 'CHOICE_REQUESTED', { continuationId: nextId, effectId: continuation.effectId,
          chooserParticipantId: participantId, optionCount: strategy.handCardInstanceIds.length }, 'OWNER_AND_FACILITATOR');
        return { resultCode: 'M2_EFFECT_CHOICE_REQUESTED', resultPayload: { continuationId: nextId, chooserParticipantId: participantId,
          selectedCardIds: selectedIds, overflow }, events: [resolvedEvent, requested] };
      }
      delete state.m2EffectChoice;
      const executed = this.appendEvent(state, envelope, 'M2_EFFECT_EXECUTED', { effectId: continuation.effectId,
        actorParticipantId: participantId, sourceCardInstanceId: continuation.sourceCardInstanceId, auditCount: 0 });
      return { resultCode: 'M2_EFFECT_CHOICE_RESOLVED', resultPayload: { effectId: continuation.effectId, selectedCardIds: selectedIds },
        events: [resolvedEvent, executed] };
    }
    if (continuation.kind === 'M2_EFFECT_GROUPED_CHOICE' && continuation.effectId === 'CARD_EFFECT_BASE_2025_E035') {
      if (!('selections' in payload) || Object.keys(payload.selections).sort().join('|') !== 'SELECT_FROM_DECK|SELECT_FROM_HAND') return { error: 'INVALID_EFFECT_INPUT' as const };
      const deckId = payload.selections.SELECT_FROM_DECK?.[0]; const handId = payload.selections.SELECT_FROM_HAND?.[0];
      const deckGroup = continuation.groups.find(({ groupId }) => groupId === 'SELECT_FROM_DECK');
      const handGroup = continuation.groups.find(({ groupId }) => groupId === 'SELECT_FROM_HAND');
      const strategy = state.strategy[continuation.actorParticipantId]; const seat = state.seats[continuation.actorParticipantId];
      if (deckId === undefined || handId === undefined || payload.selections.SELECT_FROM_DECK?.length !== 1 || payload.selections.SELECT_FROM_HAND?.length !== 1 ||
          !deckGroup?.eligibleCardIds.includes(deckId) || !handGroup?.eligibleCardIds.includes(handId) || strategy === undefined || seat === undefined ||
          !strategy.operationsDeckOrder.includes(deckId) || !strategy.handCardInstanceIds.includes(handId) ||
          !strategy.handCardInstanceIds.includes(continuation.sourceCardInstanceId)) return { error: 'STALE_CONTINUATION' as const };
      const country = state.countries[seat.countryId]; if (country.resources < continuation.resourceCost) return { error: 'INSUFFICIENT_RESOURCES' as const };
      country.resources -= continuation.resourceCost;
      strategy.handCardInstanceIds = strategy.handCardInstanceIds.filter((id) => id !== handId && id !== continuation.sourceCardInstanceId);
      strategy.handCardInstanceIds.push(deckId); strategy.discardCardInstanceIds.push(continuation.sourceCardInstanceId);
      strategy.operationsDeckOrder = this.shuffle([...strategy.operationsDeckOrder.filter((id) => id !== deckId), handId]);
      state.cards[deckId]!.zone = 'HAND'; delete state.cards[deckId]!.zonePosition;
      state.cards[handId]!.zone = 'OPERATIONS_DECK';
      state.cards[continuation.sourceCardInstanceId]!.zone = 'DISCARD';
      strategy.operationsDeckOrder.forEach((id, index) => { const card = state.cards[id]; if (card !== undefined) card.zonePosition = index; });
      state.m2Audit ??= []; state.m2Audit.push({ type: 'M2_EFFECT_CHOICE_RESOLVED', actorParticipantId: participantId,
        payload: { effectId: continuation.effectId, selectionCount: 2, targetParticipantId: participantId } });
      delete state.m2EffectChoice;
      const events = [
        this.appendEvent(state, envelope, 'CHOICE_RESOLVED', { continuationId: continuation.id, effectId: continuation.effectId }, 'OWNER_AND_FACILITATOR'),
        this.appendEvent(state, envelope, 'M2_EFFECT_EXECUTED', { effectId: continuation.effectId, actorParticipantId: continuation.actorParticipantId,
          sourceCardInstanceId: continuation.sourceCardInstanceId, auditCount: 1 }),
      ];
      return { resultCode: 'M2_EFFECT_CHOICE_RESOLVED', resultPayload: { effectId: continuation.effectId, selectedCardIds: [deckId, handId] }, events };
    }
    const m2 = buildM2StateFromCanonical(state);
    const source = m2.cards[continuation.sourceCardInstanceId];
    const sourceAlreadyCommitted = continuation.kind === 'M2_EFFECT_GROUPED_CHOICE' && continuation.sourceLifecycleCommitted === true;
    if (!sourceAlreadyCommitted && (source?.zone !== 'HAND' || source.controllerParticipantId !== continuation.actorParticipantId)) return { error: 'STALE_CONTINUATION' as const };
    let selectedCardIds: readonly string[];
    if (continuation.kind === 'M2_EFFECT_CARD_CHOICE') {
      if (!('selectedCardId' in payload) || !continuation.eligibleCardIds.includes(payload.selectedCardId)) return { error: 'INVALID_EFFECT_INPUT' as const };
      const selected = m2.cards[payload.selectedCardId];
      if (selected?.zone !== 'HAND' || selected.controllerParticipantId !== continuation.targetParticipantId) return { error: 'STALE_CONTINUATION' as const };
      if (continuation.effectId === 'CARD_EFFECT_BASE_2025_E016') {
        selected.controllerParticipantId = continuation.actorParticipantId;
        selected.returnToOwnerOnDiscard = selected.ownerParticipantId !== continuation.actorParticipantId;
      } else {
        const error = discardWithLifecycle(m2, selected.id); if (error !== undefined) return { error };
      }
      selectedCardIds = [selected.id];
    } else {
      if (!('selections' in payload) || Object.keys(payload.selections).sort().join('|') !== continuation.groups.map(({ groupId }) => groupId).sort().join('|')) {
        return { error: 'INVALID_EFFECT_INPUT' as const };
      }
      const selections = continuation.groups.map((group) => ({ group, ids: payload.selections[group.groupId] ?? [] }));
      if (selections.some(({ group, ids }) => ids.length < group.minSelections || ids.length > group.maxSelections ||
          new Set(ids).size !== ids.length || ids.some((id) => !group.eligibleCardIds.includes(id)))) return { error: 'INVALID_EFFECT_INPUT' as const };
      const allIds = selections.flatMap(({ ids }) => ids);
      if (new Set(allIds).size !== allIds.length) return { error: 'INVALID_EFFECT_INPUT' as const };
      if (continuation.effectId === 'CARD_EFFECT_BASE_2025_E006') {
        const actorState = m2.participants[continuation.actorParticipantId]!;
        if (actorState.resources < continuation.resourceCost) return { error: 'INSUFFICIENT_RESOURCES' as const };
        if (allIds.some((id) => m2.cards[id]?.zone !== 'HAND' || m2.cards[id]?.controllerParticipantId !== continuation.targetParticipantId)) return { error: 'STALE_CONTINUATION' as const };
        actorState.resources -= continuation.resourceCost;
        for (const id of allIds) discardWithLifecycle(m2, id);
      } else if (continuation.effectId === 'CARD_EFFECT_BASE_2025_E013') {
        const handIds = payload.selections.DISCARD_FROM_HAND ?? []; const retrieveIds = payload.selections.RETRIEVE_FROM_DISCARD ?? [];
        if (handIds.some((id) => m2.cards[id]?.zone !== 'HAND' || m2.cards[id]?.controllerParticipantId !== continuation.actorParticipantId) ||
            retrieveIds.some((id) => m2.cards[id]?.zone !== 'DISCARD' || m2.cards[id]?.controllerParticipantId !== continuation.actorParticipantId)) return { error: 'STALE_CONTINUATION' as const };
        for (const id of handIds) discardWithLifecycle(m2, id);
        const retrieved = m2.cards[retrieveIds[0]!]!; retrieved.zone = 'HAND';
      } else {
        if (allIds.some((id) => m2.cards[id]?.zone !== 'HAND' || m2.cards[id]?.controllerParticipantId !== continuation.actorParticipantId)) return { error: 'STALE_CONTINUATION' as const };
        for (const id of allIds) discardWithLifecycle(m2, id);
      }
      selectedCardIds = allIds;
    }
    if (!sourceAlreadyCommitted && source !== undefined) discardWithLifecycle(m2, source.id);
    m2.audit.push({ type: 'M2_EFFECT_CHOICE_RESOLVED', actorParticipantId: participantId,
      payload: { effectId: continuation.effectId, selectionCount: selectedCardIds.length, targetParticipantId: continuation.targetParticipantId } });
    applyM2StateToCanonical(state, m2);
    delete state.m2EffectChoice;
    const events = [
      this.appendEvent(state, envelope, 'CHOICE_RESOLVED', { continuationId: continuation.id, effectId: continuation.effectId }, 'OWNER_AND_FACILITATOR'),
      this.appendEvent(state, envelope, 'M2_EFFECT_EXECUTED', { effectId: continuation.effectId, actorParticipantId: continuation.actorParticipantId,
        sourceCardInstanceId: continuation.sourceCardInstanceId, auditCount: 1 }),
    ];
    return { resultCode: 'M2_EFFECT_CHOICE_RESOLVED', resultPayload: { effectId: continuation.effectId, selectedCardIds }, events };
  }

  private join(state: SetupGameState, envelope: SetupEnvelope) {
    if (state.phase !== 'SETUP') return { error: 'WRONG_PHASE' as const };
    const participantId = envelope.actorContext.participantId;
    if (participantId === undefined) return { error: 'INVALID_ACTOR_CONTEXT' as const };
    if (state.participants[participantId] !== undefined) return { error: 'PARTICIPANT_ALREADY_EXISTS' as const };
    state.participants[participantId] = {
      id: participantId,
      gameId: state.id,
      userId: envelope.actorContext.actorId,
      role: 'PLAYER',
      status: 'ACTIVE',
    };
    state.adjudication.vpByParticipant[participantId] = 0;
    const event = this.appendEvent(state, envelope, 'PARTICIPANT_JOINED', { participantId });
    return { resultCode: 'PARTICIPANT_JOINED', resultPayload: { participantId }, events: [event] };
  }

  private assignSeat(state: SetupGameState, envelope: SetupEnvelope) {
    if (state.phase !== 'SETUP') return { error: 'SEAT_ASSIGNMENT_LOCKED' as const };
    const payload = envelope.payload as AssignPlayerSeatPayload;
    const participant = state.participants[payload.playerParticipantId];
    if (participant === undefined || participant.role !== 'PLAYER') return { error: 'PARTICIPANT_NOT_FOUND' as const };
    if (state.seats[payload.playerParticipantId] !== undefined) return { error: 'PARTICIPANT_ALREADY_SEATED' as const };
    if (Object.values(state.seats).some(({ countryId }) => countryId === payload.countryId)) return { error: 'COUNTRY_ALREADY_ASSIGNED' as const };
    if (Object.values(state.seats).some(({ seatIndex }) => seatIndex === payload.seatIndex)) return { error: 'SEAT_INDEX_ALREADY_ASSIGNED' as const };
    if (Object.values(state.seats).some(({ clockwiseIndex }) => clockwiseIndex === payload.clockwiseIndex)) return { error: 'CLOCKWISE_INDEX_ALREADY_ASSIGNED' as const };
    const seat = {
      id: `${state.id}:SEAT:${payload.seatIndex}`,
      gameId: state.id,
      participantId: payload.playerParticipantId,
      seatIndex: payload.seatIndex,
      clockwiseIndex: payload.clockwiseIndex,
      countryId: payload.countryId,
    };
    state.seats[payload.playerParticipantId] = seat;
    state.countries[payload.countryId].controllerParticipantId = payload.playerParticipantId;
    for (const card of Object.values(state.cards)) {
      if (card.countryOwnerId === payload.countryId) card.controllerParticipantId = payload.playerParticipantId;
    }
    state.strategy[payload.playerParticipantId] = {
      participantId: payload.playerParticipantId,
      submittedCardInstanceIds: [],
      operationsDeckOrder: [],
      handCardInstanceIds: [],
      discardCardInstanceIds: [],
      locked: false,
    };
    state.initiative.maintenance[payload.playerParticipantId] = {
      participantId: payload.playerParticipantId,
      discardCardInstanceIds: [],
      submitted: false,
      locked: false,
      incomeApplied: false,
    };
    const event = this.appendEvent(state, envelope, 'PLAYER_SEAT_ASSIGNED', {
      participantId: payload.playerParticipantId,
      countryId: payload.countryId,
      seatIndex: payload.seatIndex,
      clockwiseIndex: payload.clockwiseIndex,
    });
    return { resultCode: 'PLAYER_SEAT_ASSIGNED', resultPayload: seat, events: [event] };
  }

  private configureOption(state: SetupGameState, envelope: SetupEnvelope) {
    if (state.phase !== 'SETUP') return { error: 'WRONG_PHASE' as const };
    const payload = envelope.payload as ConfigureGameOptionPayload;
    if (payload.optionId === 'TURN_LIMIT') {
      if (!isPositiveInteger(payload.value)) return { error: 'INVALID_TURN_LIMIT' as const };
      state.turnLimit = payload.value;
    } else {
      if (!isDiceMode(payload.value)) return { error: 'INVALID_DICE_MODE' as const };
      state.diceMode = payload.value;
    }
    const appliedValue = payload.optionId === 'TURN_LIMIT' ? state.turnLimit : state.diceMode;
    const event = this.appendEvent(state, envelope, 'GAME_OPTION_CONFIGURED', { optionId: payload.optionId, value: appliedValue });
    return { resultCode: 'GAME_OPTION_CONFIGURED', events: [event] };
  }

  private startGame(state: SetupGameState, envelope: SetupEnvelope) {
    if (state.phase !== 'SETUP') return { error: 'WRONG_PHASE' as const };
    if (!this.validStartState(state)) return { error: 'SETUP_INVALID' as const };
    state.phase = 'STRATEGY_STAGE';
    const started = this.appendEvent(state, envelope, 'GAME_STARTED', { phase: state.phase });
    const phaseChanged = this.appendEvent(state, envelope, 'PHASE_CHANGED', { phase: state.phase });
    return { resultCode: 'GAME_STARTED', events: [started, phaseChanged] };
  }

  private validStartState(state: SetupGameState): boolean {
    if (!isPositiveInteger(state.turnLimit)) return false;
    const participants = Object.values(state.participants);
    if (
      participants.filter(({ role }) => role === 'FACILITATOR').length !== 1 ||
      state.participants.F1?.role !== 'FACILITATOR' ||
      state.facilitatorParticipantId !== 'F1'
    ) return false;
    if (participants.filter(({ role }) => role === 'PLAYER').length !== 5 || Object.keys(state.seats).length !== 5) return false;
    if (Object.keys(state.countries).length !== 5 || Object.keys(state.populationDemographics).length !== 14) return false;
    for (const participantId of canonicalPlayerIds) {
      const expected = canonicalPlayerTopology[participantId as keyof typeof canonicalPlayerTopology];
      const participant = state.participants[participantId];
      const seat = state.seats[participantId];
      if (
        participant?.role !== 'PLAYER' ||
        seat?.countryId !== expected.countryId ||
        seat.seatIndex !== expected.index ||
        seat.clockwiseIndex !== expected.index
      ) return false;
    }
    const cardIds = new Set(Object.keys(state.cards));
    if (cardIds.size !== 540) return false;
    return BASE_2025_COUNTRIES.every((country) => {
      const countryCards = Object.values(state.cards).filter(({ countryOwnerId }) => countryOwnerId === country.id);
      return countryCards.length === 108 &&
        countryCards.filter((card) => state.cardDefinitions[card.definitionId]?.starter === true).length === 5 &&
        countryCards.every(({ controllerParticipantId }) => controllerParticipantId === state.countries[country.id].controllerParticipantId);
    });
  }

  private pause(state: SetupGameState, envelope: SetupEnvelope) {
    if (state.overlay === 'PAUSED') return { error: 'GAME_PAUSED' as const };
    state.overlay = 'PAUSED';
    const rawPayload = envelope.payload as PauseGamePayload;
    const payload = {
      reasonCode: rawPayload.reasonCode,
      ...(rawPayload.reasonText === undefined ? {} : { reasonText: rawPayload.reasonText }),
    };
    const event = this.appendEvent(state, envelope, 'GAME_PAUSED', payload);
    return { resultCode: 'GAME_PAUSED', events: [event] };
  }

  private resume(state: SetupGameState, envelope: SetupEnvelope) {
    if (state.overlay !== 'PAUSED') return { error: 'ILLEGAL_STATE_TRANSITION' as const };
    state.overlay = 'ACTIVE';
    const rawPayload = envelope.payload as ResumeGamePayload;
    const event = this.appendEvent(state, envelope, 'GAME_RESUMED', rawPayload.reasonCode === undefined ? {} : { reasonCode: rawPayload.reasonCode });
    return { resultCode: 'GAME_RESUMED', events: [event] };
  }

  private submitDeck(state: SetupGameState, envelope: SetupEnvelope) {
    if (state.phase !== 'STRATEGY_STAGE') return { error: 'WRONG_PHASE' as const };
    const participantId = envelope.actorContext.participantId;
    if (participantId === undefined) return { error: 'INVALID_ACTOR_CONTEXT' as const };
    const strategy = state.strategy[participantId];
    if (strategy === undefined) return { error: 'NOT_AUTHORIZED' as const };
    if (strategy.locked) return { error: 'STRATEGY_ALREADY_LOCKED' as const };
    const payload = envelope.payload as SubmitOperationsDeckPayload;
    const selected = payload.cardInstanceIds;
    const eligibilityError = this.deckEligibilityError(state, participantId, selected);
    if (eligibilityError !== undefined) return { error: eligibilityError };
    strategy.submittedCardInstanceIds = [...selected];
    const event = this.appendEvent(state, envelope, 'OPERATIONS_DECK_SUBMITTED', { participantId, count: selected.length });
    return { resultCode: 'OPERATIONS_DECK_SUBMITTED', events: [event] };
  }

  private lockStrategy(state: SetupGameState, envelope: SetupEnvelope) {
    if (state.phase !== 'STRATEGY_STAGE') return { error: 'WRONG_PHASE' as const };
    const participantId = envelope.actorContext.participantId;
    if (participantId === undefined) return { error: 'INVALID_ACTOR_CONTEXT' as const };
    const strategy = state.strategy[participantId];
    if (strategy === undefined) return { error: 'NOT_AUTHORIZED' as const };
    if (strategy.locked) return { error: 'STRATEGY_ALREADY_LOCKED' as const };
    if (strategy.submittedCardInstanceIds.length === 0) return { error: 'STRATEGY_DECK_NOT_SUBMITTED' as const };
    const eligibilityError = this.deckEligibilityError(state, participantId, strategy.submittedCardInstanceIds);
    if (eligibilityError !== undefined) return { error: eligibilityError };

    const starterIds = Object.values(state.cards)
      .filter((card) => card.controllerParticipantId === participantId && state.cardDefinitions[card.definitionId]?.starter === true)
      .sort((a, b) => a.serialWithinCountrySet - b.serialWithinCountrySet)
      .map(({ id }) => id);
    if (starterIds.length !== 5) return { error: 'SETUP_INVALID' as const };
    let shuffled: string[];
    try {
      shuffled = this.shuffle(strategy.submittedCardInstanceIds);
    } catch {
      return { error: 'RANDOM_PROVIDER_FAILURE' as const };
    }

    for (const cardId of strategy.submittedCardInstanceIds) {
      const card = state.cards[cardId];
      if (card === undefined) return { error: 'CARD_NOT_CONTROLLED' as const };
      card.zone = 'OPERATIONS_DECK';
      delete card.zonePosition;
    }
    for (const cardId of starterIds) {
      const card = state.cards[cardId];
      if (card === undefined) return { error: 'CARD_NOT_CONTROLLED' as const };
      card.zone = 'HAND';
      delete card.zonePosition;
    }
    const drawn = shuffled.slice(0, 5);
    const remaining = shuffled.slice(5);
    for (const cardId of drawn) {
      const card = state.cards[cardId];
      if (card === undefined) return { error: 'CARD_NOT_CONTROLLED' as const };
      card.zone = 'HAND';
      delete card.zonePosition;
    }
    remaining.forEach((cardId, index) => {
      const card = state.cards[cardId];
      if (card !== undefined) card.zonePosition = index;
    });
    strategy.operationsDeckOrder = remaining;
    strategy.handCardInstanceIds = [...starterIds, ...drawn];
    strategy.locked = true;

    const events: SetupGameEvent[] = [
      this.appendEvent(state, envelope, 'DECK_SHUFFLED', { participantId, count: shuffled.length }),
      ...drawn.map((cardId, index) => this.appendEvent(state, envelope, 'CARD_DRAWN', { participantId, cardInstanceId: cardId, drawIndex: index + 1 })),
      this.appendEvent(state, envelope, 'PLAYER_READY_CHANGED', { participantId, strategyLocked: true }),
    ];
    if (canonicalPlayerIds.every((id) => state.strategy[id]?.locked === true)) {
      state.phase = 'INITIATIVE_STAGE';
      events.push(this.appendEvent(state, envelope, 'PHASE_CHANGED', { phase: state.phase }));
    }
    return { resultCode: 'STRATEGY_LOCKED', events };
  }

  private resolveInitiative(state: SetupGameState, envelope: SetupEnvelope) {
    if (state.phase !== "INITIATIVE_STAGE")
      return { error: "WRONG_PHASE" as const };
    if (state.initiative.status !== "PENDING_ROLL")
      return { error: "INITIATIVE_ALREADY_RESOLVED" as const };
    const requester = envelope.actorContext.participantId;
    const seatOrder = Object.values(state.seats).sort(
      (left, right) => left.seatIndex - right.seatIndex,
    );
    if (requester !== seatOrder[0]?.participantId)
      return { error: "NOT_AUTHORIZED" as const };

    const rolls: SetupGameState["initiative"]["rolls"] = [];
    let contenders = seatOrder.map(({ participantId }) => participantId);
    let attempt = 1;
    let consumptionOrder = 0;
    try {
      while (true) {
        const round = contenders.map((participantId) => {
          consumptionOrder += 1;
          const rawValue = this.randomInteger(1, 10);
          return {
            rngRequestId: `${state.id}:rng:initiative:${consumptionOrder}`,
            source: "INITIATIVE" as const,
            attempt,
            participantId,
            rawValue,
            consumptionOrder,
          };
        });
        rolls.push(...round);
        const highest = Math.max(...round.map(({ rawValue }) => rawValue));
        const tiedHighest = round
          .filter(({ rawValue }) => rawValue === highest)
          .map(({ participantId }) => participantId);
        if (tiedHighest.length === 1) {
          const winner = tiedHighest[0];
          if (winner === undefined)
            return { error: "RANDOM_PROVIDER_FAILURE" as const };
          const winnerIndex = seatOrder.findIndex(
            ({ participantId }) => participantId === winner,
          );
          const orderedSeats = [
            ...seatOrder.slice(winnerIndex),
            ...seatOrder.slice(0, winnerIndex),
          ];
          state.initiative.rolls = rolls;
          state.initiative.winnerParticipantId = winner;
          state.initiative.orderParticipantIds = orderedSeats.map(
            ({ participantId }) => participantId,
          );
          state.initiative.status = "MAINTENANCE";
          const events: SetupGameEvent[] = rolls.map((roll) =>
            this.appendEvent(state, envelope, "INITIATIVE_ROLLED", {
              rngRequestId: roll.rngRequestId,
              source: roll.source,
              attempt: roll.attempt,
              participantId: roll.participantId,
              rawValue: roll.rawValue,
              consumptionOrder: roll.consumptionOrder,
            }),
          );
          events.push(
            this.appendEvent(state, envelope, "INITIATIVE_ORDER_SET", {
              winnerParticipantId: winner,
              order: state.initiative.orderParticipantIds.join(","),
            }),
          );
          events.push(
            this.appendEvent(state, envelope, "PLAYER_READY_CHANGED", {
              initiativeResolved: true,
            }),
          );
          return {
            resultCode: "INITIATIVE_ORDER_SET",
            resultPayload: {
              winnerParticipantId: winner,
              orderParticipantIds: [...state.initiative.orderParticipantIds],
              rolls: structuredClone(rolls),
            },
            events,
          };
        }
        contenders = tiedHighest;
        attempt += 1;
      }
    } catch {
      return { error: "RANDOM_PROVIDER_FAILURE" as const };
    }
  }

  private setInitiativeMaintenance(
    state: SetupGameState,
    envelope: SetupEnvelope,
  ) {
    if (state.phase !== "INITIATIVE_STAGE")
      return { error: "WRONG_PHASE" as const };
    if (state.initiative.status !== "MAINTENANCE")
      return { error: "INITIATIVE_NOT_RESOLVED" as const };
    const participantId = envelope.actorContext.participantId;
    if (participantId === undefined)
      return { error: "INVALID_ACTOR_CONTEXT" as const };
    const maintenance = state.initiative.maintenance[participantId];
    if (maintenance === undefined) return { error: "NOT_AUTHORIZED" as const };
    const currentParticipantId = state.initiative.orderParticipantIds.find(
      (id) => state.initiative.maintenance[id]?.locked !== true,
    );
    if (participantId !== currentParticipantId)
      return { error: "NOT_AUTHORIZED" as const };
    if (maintenance.locked)
      return { error: "INITIATIVE_MAINTENANCE_ALREADY_LOCKED" as const };
    const selected = (envelope.payload as SetInitiativeMaintenancePayload)
      .discardCardInstanceIds;
    if (new Set(selected).size !== selected.length)
      return { error: "INVALID_MAINTENANCE_SELECTION" as const };
    const strategy = state.strategy[participantId];
    if (strategy === undefined) return { error: "NOT_AUTHORIZED" as const };
    for (const cardId of selected) {
      const card = state.cards[cardId];
      if (
        card === undefined ||
        card.controllerParticipantId !== participantId ||
        card.zone !== "HAND" ||
        !strategy.handCardInstanceIds.includes(cardId)
      )
        return { error: "INVALID_MAINTENANCE_SELECTION" as const };
    }
    maintenance.discardCardInstanceIds = [...selected];
    maintenance.submitted = true;
    const event = this.appendEvent(state, envelope, "PLAYER_READY_CHANGED", {
      participantId,
      initiativeMaintenanceSubmitted: true,
    });
    return { resultCode: "INITIATIVE_MAINTENANCE_SET", events: [event] };
  }

  private lockInitiativeMaintenance(
    state: SetupGameState,
    envelope: SetupEnvelope,
  ) {
    if (state.phase !== "INITIATIVE_STAGE")
      return { error: "WRONG_PHASE" as const };
    if (state.initiative.status !== "MAINTENANCE")
      return { error: "INITIATIVE_NOT_RESOLVED" as const };
    const participantId = envelope.actorContext.participantId;
    if (participantId === undefined)
      return { error: "INVALID_ACTOR_CONTEXT" as const };
    const maintenance = state.initiative.maintenance[participantId];
    const strategy = state.strategy[participantId];
    const seat = state.seats[participantId];
    if (
      maintenance === undefined ||
      strategy === undefined ||
      seat === undefined
    )
      return { error: "NOT_AUTHORIZED" as const };
    const currentParticipantId = state.initiative.orderParticipantIds.find(
      (id) => state.initiative.maintenance[id]?.locked !== true,
    );
    if (participantId !== currentParticipantId)
      return { error: "NOT_AUTHORIZED" as const };
    if (maintenance.locked)
      return { error: "INITIATIVE_MAINTENANCE_ALREADY_LOCKED" as const };
    if (!maintenance.submitted)
      return { error: "INITIATIVE_MAINTENANCE_NOT_SET" as const };

    const events: SetupGameEvent[] = [];
    for (const cardId of maintenance.discardCardInstanceIds) {
      const card = state.cards[cardId];
      if (
        card === undefined ||
        card.controllerParticipantId !== participantId ||
        card.zone !== "HAND" ||
        !strategy.handCardInstanceIds.includes(cardId)
      )
        return { error: "INVALID_MAINTENANCE_SELECTION" as const };
      strategy.handCardInstanceIds = strategy.handCardInstanceIds.filter(
        (id) => id !== cardId,
      );
      strategy.discardCardInstanceIds.push(cardId);
      card.zone = "DISCARD";
      delete card.zonePosition;
      events.push(
        this.appendEvent(state, envelope, "CARD_MOVED", {
          participantId,
          cardInstanceId: cardId,
          fromZone: "HAND",
          toZone: "DISCARD",
        }),
      );
    }

    try {
      while (strategy.handCardInstanceIds.length < state.handLimit) {
        if (strategy.operationsDeckOrder.length === 0) {
          if (strategy.discardCardInstanceIds.length === 0) break;
          const reshuffled = this.shuffle(strategy.discardCardInstanceIds);
          strategy.discardCardInstanceIds = [];
          strategy.operationsDeckOrder = reshuffled;
          reshuffled.forEach((cardId, index) => {
            const card = state.cards[cardId];
            if (card !== undefined) {
              card.zone = "OPERATIONS_DECK";
              card.zonePosition = index;
            }
          });
          events.push(
            this.appendEvent(state, envelope, "DECK_SHUFFLED", {
              participantId,
              count: reshuffled.length,
              source: "DISCARD_RESHUFFLE",
            }),
          );
        }
        const cardId = strategy.operationsDeckOrder.shift();
        if (cardId === undefined) break;
        const card = state.cards[cardId];
        if (card === undefined)
          return { error: "CARD_NOT_CONTROLLED" as const };
        card.zone = "HAND";
        delete card.zonePosition;
        strategy.operationsDeckOrder.forEach((remainingId, index) => {
          const remaining = state.cards[remainingId];
          if (remaining !== undefined) remaining.zonePosition = index;
        });
        strategy.handCardInstanceIds.push(cardId);
        events.push(
          this.appendEvent(state, envelope, "CARD_DRAWN", {
            participantId,
            cardInstanceId: cardId,
            handSizeAfter: strategy.handCardInstanceIds.length,
          }),
        );
      }
    } catch {
      return { error: "RANDOM_PROVIDER_FAILURE" as const };
    }

    const country = state.countries[seat.countryId];
    country.resources += country.turnIncome;
    maintenance.incomeApplied = true;
    maintenance.locked = true;
    state.resourceLedger.push({
      id: `${state.id}:resource-ledger:${state.resourceLedger.length + 1}`,
      participantId,
      countryId: seat.countryId,
      reason: "TURN_INCOME",
      delta: country.turnIncome,
      balanceAfter: country.resources,
      gameVersion: state.version + 1,
    });
    events.push(
      this.appendEvent(state, envelope, "RESOURCE_CHANGED", {
        participantId,
        countryId: seat.countryId,
        reason: "TURN_INCOME",
        delta: country.turnIncome,
        balanceAfter: country.resources,
      }),
    );
    events.push(
      this.appendEvent(state, envelope, "PLAYER_READY_CHANGED", {
        participantId,
        initiativeMaintenanceLocked: true,
      }),
    );

    if (
      canonicalPlayerIds.every(
        (id) => state.initiative.maintenance[id]?.locked === true,
      )
    ) {
      state.initiative.status = "COMPLETE";
      for (const id of canonicalPlayerIds) {
        state.actionPlanning[id] = {
          participantId: id,
          apAllocated: 3,
          apAvailable: 3,
          draftSlots: [],
          lockedSlots: [],
          locked: false,
        };
        state.actionPointLedger.push({
          id: `${state.id}:ap-ledger:${state.actionPointLedger.length + 1}`,
          participantId: id,
          reason: "TURN_ALLOCATION",
          delta: 3,
          balanceAfter: 3,
          gameVersion: state.version + 1,
        });
      }
      state.phase = "ACTION_STAGE_PLAN";
      events.push(
        this.appendEvent(state, envelope, "PHASE_CHANGED", {
          phase: state.phase,
        }),
      );
    }
    return { resultCode: "INITIATIVE_MAINTENANCE_LOCKED", events };
  }

  private setActionPlan(state: SetupGameState, envelope: SetupEnvelope) {
    if (state.phase !== "ACTION_STAGE_PLAN")
      return { error: "WRONG_PHASE" as const };
    const participantId = envelope.actorContext.participantId;
    if (participantId === undefined)
      return { error: "INVALID_ACTOR_CONTEXT" as const };
    const planning = state.actionPlanning[participantId];
    if (planning === undefined) return { error: "NOT_AUTHORIZED" as const };
    if (planning.locked) return { error: "ACTION_PLAN_LOCKED" as const };
    const rawSlots = (envelope.payload as SetM1ActionPlanPayload).actionSlots;
    const referenceError = this.validateActionPlanReferences(
      state,
      participantId,
      rawSlots,
    );
    if (referenceError !== undefined) return { error: referenceError };
    planning.draftSlots = rawSlots.map((slot): M1ActionPlanSlot => ({
      sequenceIndex: slot.sequenceIndex,
      actionType: slot.actionType,
      actionPayload: structuredClone(
        slot.actionPayload,
      ) as unknown as M1ActionPlanSlot["actionPayload"],
      apCost: 1,
      revealed: false,
    }));
    const event = this.appendEvent(state, envelope, "ACTION_PLAN_SAVED", {
      participantId,
      actionCount: planning.draftSlots.length,
    });
    return { resultCode: "ACTION_PLAN_SAVED", events: [event] };
  }

  private lockActionPlan(state: SetupGameState, envelope: SetupEnvelope) {
    if (state.phase !== "ACTION_STAGE_PLAN")
      return { error: "WRONG_PHASE" as const };
    const participantId = envelope.actorContext.participantId;
    if (participantId === undefined)
      return { error: "INVALID_ACTOR_CONTEXT" as const };
    const planning = state.actionPlanning[participantId];
    if (planning === undefined)
      return { error: "ACTION_PLAN_NOT_FOUND" as const };
    if (planning.locked) return { error: "ACTION_PLAN_LOCKED" as const };
    const cost = planning.draftSlots.reduce(
      (sum, slot) => sum + slot.apCost,
      0,
    );
    if (planning.draftSlots.length > 3 || cost > planning.apAvailable)
      return { error: "INSUFFICIENT_AP" as const };
    planning.apAvailable -= cost;
    planning.lockedSlots = structuredClone(planning.draftSlots);
    planning.locked = true;
    state.actionPointLedger.push({
      id: `${state.id}:ap-ledger:${state.actionPointLedger.length + 1}`,
      participantId,
      reason: "PLAN_COMMIT",
      delta: -cost,
      balanceAfter: planning.apAvailable,
      gameVersion: state.version + 1,
    });
    const events: SetupGameEvent[] = [
      this.appendEvent(state, envelope, "AP_COMMITTED", {
        participantId,
        amount: cost,
        balanceAfter: planning.apAvailable,
      }),
      this.appendEvent(state, envelope, "ACTION_PLAN_LOCKED", {
        participantId,
        actionCount: planning.lockedSlots.length,
      }),
      this.appendEvent(state, envelope, "PLAYER_READY_CHANGED", {
        participantId,
        actionPlanLocked: true,
      }),
    ];
    if (
      canonicalPlayerIds.every(
        (id) => state.actionPlanning[id]?.locked === true,
      )
    ) {
      state.phase = "ACTION_STAGE_LOCKED";
      events.push(
        this.appendEvent(state, envelope, "PHASE_CHANGED", {
          phase: state.phase,
        }),
      );
      state.phase = "RESOLUTION_STAGE";
      events.push(
        this.appendEvent(state, envelope, "PHASE_CHANGED", {
          phase: state.phase,
        }),
      );
    }
    return { resultCode: "ACTION_PLAN_LOCKED", events };
  }

  private validateActionPlanReferences(
    state: SetupGameState,
    participantId: string,
    slots: readonly SetActionPlanSlotPayload[],
  ): AnyEngineErrorCode | undefined {
    const allCommittedCardIds: string[] = [];
    for (const slot of slots) {
      if (slot.actionType === "CONSTRUCT_CAMPAIGN") {
        const payload = slot.actionPayload as unknown as {
          readonly intentCardInstanceId: string;
          readonly methodCardInstanceId: string;
          readonly amplifierCardInstanceId?: string;
          readonly targetDtId: string;
        };
        const cardIds = [
          payload.intentCardInstanceId,
          payload.methodCardInstanceId,
          ...(payload.amplifierCardInstanceId === undefined
            ? []
            : [payload.amplifierCardInstanceId]),
        ];
        allCommittedCardIds.push(...cardIds);
        if (new Set(cardIds).size !== cardIds.length)
          return "DUPLICATE_CARD_INSTANCE";
        for (const cardId of cardIds) {
          const card = state.cards[cardId];
          if (
            card === undefined ||
            card.controllerParticipantId !== participantId
          )
            return "CARD_NOT_CONTROLLED";
          if (card.zone !== "HAND") return "CARD_WRONG_ZONE";
        }
        if (
          !Object.values(state.populationDemographics).some(
            ({ demographicTokenIds }) =>
              demographicTokenIds.includes(payload.targetDtId) ||
              demographicTokenIds.some((token) => token.endsWith(`:${payload.targetDtId}`)),
          )
        )
          return "INVALID_DT";
      } else if (slot.actionType === 'ACTIVATE_CAMPAIGN') {
        const payload = slot.actionPayload as unknown as {
          readonly campaignId: string;
          readonly requestedTargetPdId?: string;
        };
        if (
          payload.requestedTargetPdId !== undefined &&
          state.populationDemographics[payload.requestedTargetPdId] ===
            undefined
        ) {
          return "INVALID_TARGET_PD";
        }
      } else {
        const payload = slot.actionPayload as unknown as { readonly cardInstanceId: string; readonly campaignId: string; readonly activationSequenceIndex: number };
        const card = state.cards[payload.cardInstanceId];
        if (card === undefined || card.controllerParticipantId !== participantId) return 'CARD_NOT_CONTROLLED';
        if (card.zone !== 'HAND' || card.definitionId !== 'BASE_CARD_087') return 'CARD_NOT_ELIGIBLE';
        allCommittedCardIds.push(card.id);
        const activation = slots.find((candidate) => candidate.sequenceIndex === payload.activationSequenceIndex && candidate.actionType === 'ACTIVATE_CAMPAIGN');
        if (activation === undefined || activation.sequenceIndex <= slot.sequenceIndex ||
            (activation.actionPayload as unknown as { readonly campaignId: string }).campaignId !== payload.campaignId) return 'INVALID_ACTION_PLAN';
      }
    }
    if (new Set(allCommittedCardIds).size !== allCommittedCardIds.length)
      return "DUPLICATE_CARD_INSTANCE";
    return undefined;
  }


  private deckEligibilityError(state: SetupGameState, participantId: string, selected: readonly string[]): AnyEngineErrorCode | undefined {
    if (selected.length !== 30) return 'STRATEGY_DECK_SIZE_INVALID';
    if (new Set(selected).size !== selected.length) return 'DUPLICATE_CARD_INSTANCE';
    for (const cardId of selected) {
      const card = state.cards[cardId];
      if (card === undefined || card.controllerParticipantId !== participantId) return 'CARD_NOT_CONTROLLED';
      if (state.cardDefinitions[card.definitionId]?.starter !== false) return 'CARD_NOT_ELIGIBLE';
      if (card.zone !== 'OPERATIONS_POOL') return 'CARD_WRONG_ZONE';
    }
    return undefined;
  }

  private shuffle(input: readonly string[]): string[] {
    const output = [...input];
    for (let index = output.length - 1; index > 0; index -= 1) {
      const swapIndex = this.randomInteger(0, index);
      const current = output[index];
      const swap = output[swapIndex];
      if (current === undefined || swap === undefined) throw new Error('Invalid shuffle index');
      output[index] = swap;
      output[swapIndex] = current;
    }
    return output;
  }

  private randomInteger(minInclusive: number, maxInclusive: number): number {
    const value = this.random.integer(minInclusive, maxInclusive);
    if (!Number.isInteger(value) || !Number.isFinite(value) || value < minInclusive || value > maxInclusive) {
      throw new Error('Random provider returned an invalid value');
    }
    return value;
  }

  private appendEvent(
    state: SetupGameState,
    envelope: CommandEnvelope<string, unknown>,
    type: SetupGameEventType,
    payload: Readonly<Record<string, string | number | boolean>>,
    visibilityOverride?: SetupEventVisibilityClass,
  ): SetupGameEvent {
    const sequenceNumber = state.events.length + 1;
    const eventId = `${state.id}:event:${sequenceNumber}`;
    const actorParticipantId = envelope.actorContext.actorType === 'SYSTEM'
      ? null
      : envelope.actorContext.participantId;
    if (actorParticipantId === undefined) throw new Error('Human setup events require a verified participant actor');
    const visibilityClass: SetupEventVisibilityClass = visibilityOverride ?? ([
      'CARD_DRAWN',
      'CARD_MOVED',
      'DECK_SHUFFLED',
      'ACTION_PLAN_SAVED',
      'ACTION_PLAN_LOCKED',
    ].includes(type)
      ? 'OWNER_AND_FACILITATOR'
      : 'PUBLIC');
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
      causationId: envelope.causationId ?? null,
      visibilityClass,
      occurredAt: this.now().toISOString(),
      payload,
    };
    state.events.push(event);
    return event;
  }
}
