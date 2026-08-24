import type { ActorContext } from '@malign-ai/contracts';
import type { AdjudicationTrace, ChoiceRequest, NarrativeRequest, SetupGameEvent, SetupGameState } from '@malign-ai/domain';
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
  readonly events: readonly SetupGameEvent[];
  readonly audit: {
    readonly resourceLedgerEntries: number;
    readonly influenceLedgerEntries: number;
    readonly legitimacyLedgerEntries: number;
    readonly vpLedgerEntries: number;
    readonly traces: readonly (AdjudicationTrace | PublicAdjudicationTraceProjection)[];
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

const projectedEvents = (
  state: SetupGameState,
  participantId: string,
  facilitator: boolean,
): SetupGameEvent[] => state.events.map((event) => {
  const visible =
    event.visibilityClass === 'PUBLIC' ||
    facilitator ||
    event.actorParticipantId === participantId ||
    event.payload.actorParticipantId === participantId;
  if (visible && facilitator) return structuredClone(event);
  if (visible) {
    const privateArtifactKeys = new Set([
      'pendingResolutionJson',
      'pendingResolutionDigest',
      'influenceResolutionJson',
      'influenceResolutionDigest',
      'traceDigest',
      'preStateHash',
      'postStateHash',
    ]);
    return {
      ...structuredClone(event),
      payload: Object.fromEntries(
        Object.entries(event.payload).filter(([key]) => !privateArtifactKeys.has(key)),
      ),
    };
  }
  return {
    ...structuredClone(event),
    payload: { redacted: true },
  };
});

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
    events: projectedEvents(state, participantId, participant.role === 'FACILITATOR'),
    audit: {
      resourceLedgerEntries: state.resourceLedger.length,
      influenceLedgerEntries: state.adjudication.influenceLedger.length,
      legitimacyLedgerEntries: state.adjudication.legitimacyLedger.length,
      vpLedgerEntries: state.adjudication.vpLedger.length,
      traces: participant.role === 'FACILITATOR'
        ? structuredClone(state.adjudication.traces)
        : state.adjudication.traces.map(publicTrace),
    },
  };
};
