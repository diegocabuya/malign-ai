import type { ActorContext } from '@malign-ai/contracts';
import type {
  ParticipantRole,
  PinnedVersions,
  SetupEventActorType,
  SetupEventVisibilityClass,
  SetupGameEvent,
  SetupGameEventType,
  SetupGameState,
} from '@malign-ai/domain';
import {
  buildM1AdjudicationProjection,
  projectCanonicalM1Event,
  type M1AdjudicationProjection,
} from './m1-adjudication-projection.js';

export interface M1RealtimeCursor {
  readonly gameId: string;
  readonly viewerParticipantId: string;
  readonly viewerRole: ParticipantRole;
  readonly projectionId: string;
  readonly gameVersion: number;
  readonly lastSequenceNumber: number;
}

export interface ProjectedM1Event {
  readonly kind: 'PROJECTED_EVENT';
  readonly eventId: string;
  readonly gameId: string;
  readonly eventType: SetupGameEventType;
  readonly sequenceNumber: number;
  readonly gameVersion: number;
  readonly actorType: SetupEventActorType;
  readonly actorParticipantId: string | null;
  readonly payloadSchemaVersion: string;
  readonly versions: PinnedVersions;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly visibilityClass: SetupEventVisibilityClass;
  readonly occurredAt: string;
  readonly payload: Readonly<Record<string, string | number | boolean>>;
}

export interface M1RealtimeProjection {
  readonly game: M1AdjudicationProjection['game'];
  readonly pendingChoice?: M1AdjudicationProjection['pendingChoice'];
  readonly pendingNarrativeRequest?: M1AdjudicationProjection['pendingNarrativeRequest'];
  readonly events: readonly ProjectedM1Event[];
  readonly audit: M1AdjudicationProjection['audit'];
}

export const realtimeProjectionId = (viewer: ActorContext): string => {
  if (viewer.participantId === undefined || viewer.actorType === 'SYSTEM') {
    throw new Error('Realtime projection requires a verified human participant');
  }
  return `${viewer.actorType}:${viewer.participantId}`;
};

export const buildM1RealtimeCursor = (
  state: SetupGameState,
  viewer: ActorContext,
): M1RealtimeCursor => {
  if (viewer.participantId === undefined || viewer.actorType === 'SYSTEM') {
    throw new Error('Realtime cursor requires a verified human participant');
  }
  return {
    gameId: state.id,
    viewerParticipantId: viewer.participantId,
    viewerRole: viewer.actorType,
    projectionId: realtimeProjectionId(viewer),
    gameVersion: state.version,
    lastSequenceNumber: state.events.at(-1)?.sequenceNumber ?? 0,
  };
};

export const projectM1EventForViewer = (
  event: SetupGameEvent,
  viewer: ActorContext,
): ProjectedM1Event | undefined => {
  const participantId = viewer.participantId;
  if (participantId === undefined || viewer.actorType === 'SYSTEM') {
    throw new Error('Projected realtime events require a verified human participant');
  }
  const canonical = projectCanonicalM1Event(event, viewer);
  if (!canonical.authorized) return undefined;
  const projected = canonical.event;

  return {
    kind: 'PROJECTED_EVENT',
    eventId: projected.eventId,
    gameId: projected.gameId,
    eventType: projected.eventType,
    sequenceNumber: projected.sequenceNumber,
    gameVersion: projected.gameVersion,
    actorType: projected.actorType,
    actorParticipantId: projected.actorParticipantId,
    payloadSchemaVersion: projected.payloadSchemaVersion,
    versions: structuredClone(projected.versions),
    correlationId: projected.correlationId,
    causationId: projected.causationId,
    visibilityClass: projected.visibilityClass,
    occurredAt: projected.occurredAt,
    payload: structuredClone(projected.payload),
  };
};

export const buildM1RealtimeProjection = (
  state: SetupGameState,
  viewer: ActorContext,
): M1RealtimeProjection => {
  const projection = buildM1AdjudicationProjection(state, viewer);
  return {
    game: structuredClone(projection.game),
    ...(projection.pendingChoice === undefined ? {} : { pendingChoice: structuredClone(projection.pendingChoice) }),
    ...(projection.pendingNarrativeRequest === undefined
      ? {}
      : { pendingNarrativeRequest: structuredClone(projection.pendingNarrativeRequest) }),
    events: state.events
      .map((event) => projectM1EventForViewer(event, viewer))
      .filter((event): event is ProjectedM1Event => event !== undefined),
    audit: structuredClone(projection.audit),
  };
};
