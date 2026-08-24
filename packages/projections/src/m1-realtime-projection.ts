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
  readonly audit: M1AdjudicationProjection['audit'];
}

const playerPrivateArtifactKeys = new Set([
  'pendingResolutionJson',
  'pendingResolutionDigest',
  'influenceResolutionJson',
  'influenceResolutionDigest',
  'traceDigest',
  'preStateHash',
  'postStateHash',
]);

const futureDeckArtifactKeys = new Set([
  'operationsDeckOrder',
  'futureDeckOrder',
  'topCardId',
  'topCardIdentity',
]);

const eventOwnerParticipantId = (event: SetupGameEvent): string | null => {
  if (event.actorParticipantId !== null) return event.actorParticipantId;
  for (const key of ['actorParticipantId', 'participantId']) {
    const value = event.payload[key];
    if (typeof value === 'string') return value;
  }
  return null;
};

const projectedPayload = (
  event: SetupGameEvent,
  facilitator: boolean,
): Readonly<Record<string, string | number | boolean>> => Object.fromEntries(
  Object.entries(event.payload).filter(([key]) =>
    !futureDeckArtifactKeys.has(key) && (facilitator || !playerPrivateArtifactKeys.has(key)),
  ),
);

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
  const facilitator = viewer.actorType === 'FACILITATOR';
  if (
    event.visibilityClass === 'OWNER_AND_FACILITATOR' &&
    !facilitator &&
    eventOwnerParticipantId(event) !== participantId
  ) return undefined;

  return {
    kind: 'PROJECTED_EVENT',
    eventId: event.eventId,
    gameId: event.gameId,
    eventType: event.eventType,
    sequenceNumber: event.sequenceNumber,
    gameVersion: event.gameVersion,
    actorType: event.actorType,
    actorParticipantId: event.actorParticipantId,
    payloadSchemaVersion: event.payloadSchemaVersion,
    versions: structuredClone(event.versions),
    correlationId: event.correlationId,
    causationId: event.causationId,
    visibilityClass: event.visibilityClass,
    occurredAt: event.occurredAt,
    payload: projectedPayload(event, facilitator),
  };
};

export const buildM1RealtimeProjection = (
  state: SetupGameState,
  viewer: ActorContext,
): M1RealtimeProjection => {
  const projection = buildM1AdjudicationProjection(state, viewer);
  return {
    game: projection.game,
    ...(projection.pendingChoice === undefined
      ? {}
      : { pendingChoice: structuredClone(projection.pendingChoice) }),
    ...(projection.pendingNarrativeRequest === undefined
      ? {}
      : { pendingNarrativeRequest: structuredClone(projection.pendingNarrativeRequest) }),
    audit: structuredClone(projection.audit),
  };
};
