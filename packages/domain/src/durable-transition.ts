import { sha256CanonicalJson } from '@malign-ai/shared';

import type {
  ActionPointLedgerEntry,
  ResourceLedgerEntry,
  SetupGameEvent,
  SetupGameState,
} from './m1-setup.js';
import type {
  AdjudicationTrace,
  DieRollRecord,
  InfluenceLedgerEntry,
  LegitimacyLedgerEntry,
  PendingResolution,
  VpLedgerEntry,
} from './m1-adjudication.js';

export const DURABLE_TRANSITION_SCHEMA_ID = 'malign.durable-engine-transition' as const;
export const DURABLE_TRANSITION_SCHEMA_VERSION = '1.0' as const;

export const DURABLE_NORMALIZED_FAMILIES = [
  'SESSION_LIFECYCLE',
  'PARTICIPANTS_SEATS',
  'PHASE_INITIATIVE',
  'AP_RESOURCES',
  'CARDS_ZONES_DECK',
  'PLANS',
  'CAMPAIGNS',
  'PD_INFLUENCE_LEGITIMACY',
  'ADJUDICATION_CHOICES_NARRATIVE',
  'DIE_ROLLS',
  'CONTINUATIONS',
  'EVENTS_TRACES',
] as const;

export type DurableNormalizedFamily = (typeof DURABLE_NORMALIZED_FAMILIES)[number];

export interface DurableFamilyMutation {
  readonly family: DurableNormalizedFamily;
  readonly beforeSha256: string;
  readonly afterSha256: string;
  readonly beforeImage: unknown;
  readonly afterImage: unknown;
}

export interface DurableAcceptedEngineResult {
  readonly commandId: string;
  readonly gameId: string;
  readonly status: 'RESOLVED' | 'REQUIRES_CHOICE';
  readonly gameVersionBefore: number;
  readonly gameVersionAfter: number;
  readonly resultCode: string;
  readonly emittedEventRefs: readonly string[];
  readonly adjudicationTraceRefs: readonly string[];
  readonly resolvedAt: string;
}

export interface DurableTransitionActor {
  readonly actorId: string;
  readonly actorType: 'PLAYER' | 'FACILITATOR' | 'SYSTEM';
  readonly participantId: string | null;
  readonly authenticatedSessionId: string;
}

export interface DurableLedgerDelta {
  readonly actionPoints: readonly ActionPointLedgerEntry[];
  readonly resources: readonly ResourceLedgerEntry[];
  readonly victoryPoints: readonly VpLedgerEntry[];
  readonly influence: readonly InfluenceLedgerEntry[];
  readonly legitimacy: readonly LegitimacyLedgerEntry[];
  readonly dieRolls: readonly DieRollRecord[];
}

export type DurableContinuationMutation =
  | { readonly operation: 'NONE'; readonly before: null; readonly after: null }
  | { readonly operation: 'CREATE'; readonly before: null; readonly after: PendingResolution }
  | { readonly operation: 'UPDATE'; readonly before: PendingResolution; readonly after: PendingResolution }
  | { readonly operation: 'CLOSE'; readonly before: PendingResolution; readonly after: null };

/**
 * PostgreSQL-free, versioned Engine → application persistence contract.
 * It is deliberately a complete after-image plus independently checked family mutations:
 * neither a caller nor a test may provide a detached list of database effects.
 */
export interface DurableEngineTransitionV1 {
  readonly schemaId: typeof DURABLE_TRANSITION_SCHEMA_ID;
  readonly schemaVersion: typeof DURABLE_TRANSITION_SCHEMA_VERSION;
  readonly gameId: string;
  readonly commandType: string;
  readonly idempotencyKey: string;
  readonly fingerprintSha256: string;
  readonly actor: DurableTransitionActor;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly beforeState: SetupGameState | null;
  readonly afterState: SetupGameState;
  readonly engineResult: DurableAcceptedEngineResult;
  readonly events: readonly SetupGameEvent[];
  readonly traces: readonly AdjudicationTrace[];
  readonly normalizedMutations: readonly DurableFamilyMutation[];
  readonly ledgers: DurableLedgerDelta;
  readonly continuation: DurableContinuationMutation;
  readonly captureSnapshot: boolean;
}

const familyImage = (state: SetupGameState | null, family: DurableNormalizedFamily): unknown => {
  if (state === null) return null;
  switch (family) {
    case 'SESSION_LIFECYCLE':
      return {
        id: state.id,
        scenarioId: state.scenarioId,
        versions: state.versions,
        phase: state.phase,
        overlay: state.overlay,
        facilitatorParticipantId: state.facilitatorParticipantId ?? null,
        turnLimit: state.turnLimit,
        diceMode: state.diceMode,
        endGame: state.endGame ?? null,
      };
    case 'PARTICIPANTS_SEATS': return { participants: state.participants, seats: state.seats };
    case 'PHASE_INITIATIVE': return { phase: state.phase, initiative: state.initiative, currentRevealedAction: state.currentRevealedAction ?? null };
    case 'AP_RESOURCES': return {
      actionPlanning: state.actionPlanning,
      countries: state.countries,
      actionPointLedger: state.actionPointLedger,
      resourceLedger: state.resourceLedger,
      vpByParticipant: state.adjudication.vpByParticipant,
      vpLedger: state.adjudication.vpLedger,
    };
    case 'CARDS_ZONES_DECK': return { cards: state.cards, strategy: state.strategy };
    case 'PLANS': return { actionPlanning: state.actionPlanning, currentRevealedAction: state.currentRevealedAction ?? null };
    case 'CAMPAIGNS': return state.adjudication.campaigns;
    case 'PD_INFLUENCE_LEGITIMACY': return {
      populationDemographics: state.populationDemographics,
      influenceStacks: state.adjudication.influenceStacks,
      influenceLedger: state.adjudication.influenceLedger,
      influenceResolutions: state.adjudication.influenceResolutions,
      legitimacyByPd: state.adjudication.legitimacyByPd,
      legitimacyLedger: state.adjudication.legitimacyLedger,
    };
    case 'ADJUDICATION_CHOICES_NARRATIVE': return {
      scheduler: state.adjudication.scheduler,
      pendingResolution: state.adjudication.pendingResolution ?? null,
      resolvedChoiceIds: state.adjudication.resolvedChoiceIds,
      narrativesByCampaign: state.adjudication.narrativesByCampaign,
    };
    case 'DIE_ROLLS': return state.adjudication.dieRolls;
    case 'CONTINUATIONS': return {
      pendingResolution: state.adjudication.pendingResolution ?? null,
      reactionContinuation: state.reactionContinuation ?? null,
      m2Veto: state.m2Veto ?? null,
      vetoAbuseReviewByWindowParticipant: state.vetoAbuseReviewByWindowParticipant ?? null,
      m2CoreScheduler: state.m2CoreScheduler ?? null,
      m2EffectChoice: state.m2EffectChoice ?? null,
    };
    case 'EVENTS_TRACES': return { events: state.events, traces: state.adjudication.traces, m2Audit: state.m2Audit ?? [] };
  }
};

const addedById = <T extends { readonly id: string }>(before: readonly T[], after: readonly T[]): readonly T[] => {
  const previous = new Set(before.map(({ id }) => id));
  return after.filter(({ id }) => !previous.has(id)).map((entry) => structuredClone(entry));
};

const continuationMutation = (
  before: PendingResolution | undefined,
  after: PendingResolution | undefined,
): DurableContinuationMutation => {
  if (before === undefined && after === undefined) return { operation: 'NONE', before: null, after: null };
  if (before === undefined && after !== undefined) return { operation: 'CREATE', before: null, after: structuredClone(after) };
  if (before !== undefined && after === undefined) return { operation: 'CLOSE', before: structuredClone(before), after: null };
  return { operation: 'UPDATE', before: structuredClone(before!), after: structuredClone(after!) };
};

export interface BuildDurableEngineTransitionInput {
  readonly gameId: string;
  readonly commandType: string;
  readonly idempotencyKey: string;
  readonly fingerprintSha256: string;
  readonly actor: DurableTransitionActor;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly beforeState: SetupGameState | null;
  readonly afterState: SetupGameState;
  readonly engineResult: DurableAcceptedEngineResult;
  readonly captureSnapshot?: boolean;
}

export const buildDurableEngineTransition = (
  input: BuildDurableEngineTransitionInput,
): DurableEngineTransitionV1 => {
  const before = input.beforeState;
  const after = input.afterState;
  const normalizedMutations = DURABLE_NORMALIZED_FAMILIES.flatMap((family): DurableFamilyMutation[] => {
    const beforeImage = familyImage(before, family);
    const afterImage = familyImage(after, family);
    const beforeSha256 = sha256CanonicalJson(beforeImage);
    const afterSha256 = sha256CanonicalJson(afterImage);
    return beforeSha256 === afterSha256 ? [] : [{ family, beforeSha256, afterSha256, beforeImage, afterImage }];
  });
  const beforeAdjudication = before?.adjudication;
  return {
    schemaId: DURABLE_TRANSITION_SCHEMA_ID,
    schemaVersion: DURABLE_TRANSITION_SCHEMA_VERSION,
    gameId: input.gameId,
    commandType: input.commandType,
    idempotencyKey: input.idempotencyKey,
    fingerprintSha256: input.fingerprintSha256,
    actor: structuredClone(input.actor),
    correlationId: input.correlationId ?? input.engineResult.commandId,
    causationId: input.causationId ?? null,
    beforeState: before === null ? null : structuredClone(before),
    afterState: structuredClone(after),
    engineResult: structuredClone(input.engineResult),
    events: addedById(before?.events ?? [], after.events),
    traces: addedById(beforeAdjudication?.traces ?? [], after.adjudication.traces),
    normalizedMutations,
    ledgers: {
      actionPoints: addedById(before?.actionPointLedger ?? [], after.actionPointLedger),
      resources: addedById(before?.resourceLedger ?? [], after.resourceLedger),
      victoryPoints: addedById(beforeAdjudication?.vpLedger ?? [], after.adjudication.vpLedger),
      influence: addedById(beforeAdjudication?.influenceLedger ?? [], after.adjudication.influenceLedger),
      legitimacy: addedById(beforeAdjudication?.legitimacyLedger ?? [], after.adjudication.legitimacyLedger),
      dieRolls: addedById(beforeAdjudication?.dieRolls ?? [], after.adjudication.dieRolls),
    },
    continuation: continuationMutation(beforeAdjudication?.pendingResolution, after.adjudication.pendingResolution),
    captureSnapshot: input.captureSnapshot ?? input.commandType === 'CREATE_GAME',
  };
};

const equal = (left: unknown, right: unknown): boolean => sha256CanonicalJson(left) === sha256CanonicalJson(right);

/** Throws before I/O when any caller-provided portion is absent or detached from before/after. */
export const durableTransitionCompletenessFailures = (transition: DurableEngineTransitionV1): readonly string[] => {
  const failures: string[] = [];
  if (transition.schemaId !== DURABLE_TRANSITION_SCHEMA_ID || transition.schemaVersion !== DURABLE_TRANSITION_SCHEMA_VERSION) failures.push('schema');
  if (transition.gameId !== transition.afterState.id || transition.beforeState?.id !== transition.gameId && transition.beforeState !== null) failures.push('game');
  if (!/^[a-f0-9]{64}$/.test(transition.fingerprintSha256)) failures.push('fingerprint');
  const result = transition.engineResult;
  if ((result.status !== 'RESOLVED' && result.status !== 'REQUIRES_CHOICE') || result.gameId !== transition.gameId || result.gameVersionAfter !== result.gameVersionBefore + 1 || result.commandId.length === 0) failures.push('result');
  if (transition.afterState.version !== result.gameVersionAfter || (transition.beforeState?.version ?? 0) !== result.gameVersionBefore) failures.push('versions');
  const expected = buildDurableEngineTransition({
    gameId: transition.gameId,
    commandType: transition.commandType,
    idempotencyKey: transition.idempotencyKey,
    fingerprintSha256: transition.fingerprintSha256,
    actor: transition.actor,
    correlationId: transition.correlationId,
    ...(transition.causationId === null ? {} : { causationId: transition.causationId }),
    beforeState: transition.beforeState,
    afterState: transition.afterState,
    engineResult: transition.engineResult,
    captureSnapshot: transition.captureSnapshot,
  });
  if (!equal(transition.normalizedMutations, expected.normalizedMutations)) failures.push('normalizedMutations');
  if (!equal(transition.ledgers, expected.ledgers)) failures.push('ledgers');
  if (!equal(transition.events, expected.events)) failures.push('events');
  if (!equal(transition.traces, expected.traces)) failures.push('traces');
  if (!equal(transition.continuation, expected.continuation)) failures.push('continuation');
  const knownEventIds=new Set([...(transition.beforeState?.events??[]),...transition.events].map(({id})=>id));
  if(transition.events.some(({id})=>!result.emittedEventRefs.includes(id))||
      result.emittedEventRefs.some(id=>!knownEventIds.has(id)))failures.push('eventRefs');
  const knownTraceIds=new Set([...(transition.beforeState?.adjudication.traces??[]),...transition.traces].map(({id})=>id));
  if(transition.traces.some(({id})=>!result.adjudicationTraceRefs.includes(id))||
      result.adjudicationTraceRefs.some(id=>!knownTraceIds.has(id)))failures.push('traceRefs');
  return failures;
};
