import { InMemorySessionAuthority } from '@malign-ai/authz';
import { engineErrorFor, type AnyEngineErrorCode, type EngineCommandResult } from '@malign-ai/contracts';
import {
  M1AdjudicationEngine,
  type SetupCommandPayload,
  type SetupCommandType,
  SetupCommandDispatcher,
  InMemorySetupGameStore,
  validateSetupCommandPayload,
} from '@malign-ai/game-engine';
import {
  buildM1AdjudicationProjection,
  buildM1RealtimeCursor,
  buildM1RealtimeProjection,
  projectM1EventForViewer,
  realtimeProjectionId,
  buildSetupGameProjection,
  type M1AdjudicationProjection,
  type SetupGameProjection,
} from '@malign-ai/projections';
import type { ActorContext } from '@malign-ai/contracts';
import type { SetupGameState } from '@malign-ai/domain';
import {
  buildM1AuthorizedEventFeed,
  isM1RealtimeCursor,
  validateM1RealtimeCursor,
  type AuthorizedRealtimeSubscription,
  type M1AuthorizedEventFeed,
  type M1InitialSync,
  type M1RealtimeDelivery,
  type M1RealtimeDeliveryHandler,
  type M1RealtimeOperationResult,
  type M1RealtimePort,
} from './m1-realtime.js';

export interface SessionCommandInput {
  readonly engineContractVersion: string;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly gameId: string;
  readonly expectedGameVersion: number;
  readonly commandType: SetupCommandType;
  readonly payloadSchemaVersion: string;
  readonly payload: SetupCommandPayload;
  readonly correlationId?: string;
  readonly causationId?: string;
}

export interface SessionM1InteractionInput {
  readonly engineContractVersion: string;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly gameId: string;
  readonly expectedGameVersion: number;
  readonly commandType: 'SUBMIT_CHOICE' | 'SUBMIT_CAMPAIGN_NARRATIVE';
  readonly payloadSchemaVersion: string;
  readonly payload: unknown;
  readonly correlationId?: string;
  readonly causationId?: string;
}

export type ProjectionQueryResult =
  | { readonly ok: true; readonly projection: SetupGameProjection }
  | { readonly ok: false; readonly error: ReturnType<typeof engineErrorFor> };

export type M1ProjectionQueryResult =
  | { readonly ok: true; readonly projection: M1AdjudicationProjection }
  | { readonly ok: false; readonly error: ReturnType<typeof engineErrorFor> };

export interface M1RealtimeSubscriptionResult {
  readonly subscription: AuthorizedRealtimeSubscription;
  readonly catchup: M1AuthorizedEventFeed;
}

export interface M1ReconnectResult extends M1InitialSync {
  readonly subscription: AuthorizedRealtimeSubscription;
  readonly catchup: M1AuthorizedEventFeed;
}

const freeAuthorityFields = new Set(['actorId', 'participantId', 'permissions', 'authenticatedSessionId', 'actorContext', 'gameId']);

const payloadClaimsAuthority = (payload: unknown): boolean =>
  typeof payload === 'object' && payload !== null && Object.keys(payload).some((key) => freeAuthorityFields.has(key));

export class InMemoryGameSessionApplication {
  constructor(
    private readonly authority: InMemorySessionAuthority,
    private readonly store: InMemorySetupGameStore,
    private readonly dispatcher: SetupCommandDispatcher,
    private readonly now: () => Date,
    private readonly adjudicationEngine?: M1AdjudicationEngine,
    private readonly realtime?: M1RealtimePort,
  ) {
    if (this.realtime !== undefined) {
      this.store.onCommitted((before, after) => this.publishCommittedEvents(before, after));
    }
  }

  execute(authenticatedSessionId: string, input: SessionCommandInput): EngineCommandResult {
    const scope = this.authority.verifyGameScope(authenticatedSessionId, input.gameId);
    if (!scope.ok) return this.reject(input, 0, scope.error);
    const state = this.store.snapshot(input.gameId);
    const resolution = input.commandType === 'CREATE_GAME'
      ? this.authority.resolveForCreate(authenticatedSessionId, input.gameId)
      : input.commandType === 'JOIN_GAME_MEMBERSHIP'
        ? state === undefined
          ? { ok: false as const, error: 'GAME_NOT_FOUND' as const }
          : this.authority.resolveForJoin(authenticatedSessionId, input.gameId, state)
        : state === undefined
          ? { ok: false as const, error: 'GAME_NOT_FOUND' as const }
          : this.authority.resolve(authenticatedSessionId, input.gameId, state);
    if (!resolution.ok) return this.reject(input, state?.version ?? 0, resolution.error);
    if (payloadClaimsAuthority(input.payload)) return this.reject(input, state?.version ?? 0, 'INVALID_ACTOR_CONTEXT');
    const payloadError = validateSetupCommandPayload(input.commandType, input.payload);
    if (payloadError !== undefined) return this.reject(input, state?.version ?? 0, payloadError);
    const envelope = {
      ...input,
      actorContext: resolution.actorContext,
    };
    const result = this.dispatcher.dispatch(envelope);
    if (result.status === 'RESOLVED' && (input.commandType === 'CREATE_GAME' || input.commandType === 'JOIN_GAME_MEMBERSHIP')) {
      const participantId = resolution.actorContext.participantId;
      if (participantId !== undefined) this.authority.materializeMembership(authenticatedSessionId, input.gameId, participantId);
    }
    return result;
  }

  executeM1Interaction(authenticatedSessionId: string, input: SessionM1InteractionInput): EngineCommandResult {
    const scope = this.authority.verifyGameScope(authenticatedSessionId, input.gameId);
    if (!scope.ok) return this.reject(input, 0, scope.error);
    const state = this.store.snapshot(input.gameId);
    if (state === undefined) return this.reject(input, 0, 'GAME_NOT_FOUND');
    const resolution = this.authority.resolve(authenticatedSessionId, input.gameId, state);
    if (!resolution.ok) return this.reject(input, state.version, resolution.error);
    if (payloadClaimsAuthority(input.payload)) return this.reject(input, state.version, 'INVALID_ACTOR_CONTEXT');
    if (this.adjudicationEngine === undefined) return this.reject(input, state.version, 'NOT_AUTHORIZED');
    return this.adjudicationEngine.dispatchInteraction({ ...input, actorContext: resolution.actorContext });
  }

  getGameProjection(authenticatedSessionId: string, gameId: string): ProjectionQueryResult {
    const scope = this.authority.verifyGameScope(authenticatedSessionId, gameId);
    if (!scope.ok) return { ok: false, error: engineErrorFor(scope.error) };
    const state = this.store.snapshot(gameId);
    if (state === undefined) return { ok: false, error: engineErrorFor('GAME_NOT_FOUND') };
    const resolution = this.authority.resolve(authenticatedSessionId, gameId, state);
    if (!resolution.ok) return { ok: false, error: engineErrorFor(resolution.error) };
    return { ok: true, projection: buildSetupGameProjection(state, resolution.actorContext) };
  }

  getM1AdjudicationProjection(authenticatedSessionId: string, gameId: string): M1ProjectionQueryResult {
    const scope = this.authority.verifyGameScope(authenticatedSessionId, gameId);
    if (!scope.ok) return { ok: false, error: engineErrorFor(scope.error) };
    const state = this.store.snapshot(gameId);
    if (state === undefined) return { ok: false, error: engineErrorFor('GAME_NOT_FOUND') };
    const resolution = this.authority.resolve(authenticatedSessionId, gameId, state);
    if (!resolution.ok) return { ok: false, error: engineErrorFor(resolution.error) };
    return { ok: true, projection: buildM1AdjudicationProjection(state, resolution.actorContext) };
  }

  getM1InitialSync(
    authenticatedSessionId: string,
    gameId: string,
  ): M1RealtimeOperationResult<M1InitialSync> {
    const viewer = this.resolveRealtimeViewer(authenticatedSessionId, gameId);
    if (!viewer.ok) return viewer;
    return {
      ok: true,
      value: {
        projection: buildM1RealtimeProjection(viewer.state, viewer.actorContext),
        cursor: buildM1RealtimeCursor(viewer.state, viewer.actorContext),
      },
    };
  }

  getM1EventFeed(
    authenticatedSessionId: string,
    gameId: string,
    afterCursor: unknown,
  ): M1RealtimeOperationResult<M1AuthorizedEventFeed> {
    const viewer = this.resolveRealtimeViewer(authenticatedSessionId, gameId);
    if (!viewer.ok) return viewer;
    const cursorError = validateM1RealtimeCursor(viewer.state, viewer.actorContext, afterCursor);
    if (cursorError !== undefined || !isM1RealtimeCursor(afterCursor)) {
      return { ok: false, error: engineErrorFor(cursorError ?? 'REALTIME_CURSOR_INVALID') };
    }
    return {
      ok: true,
      value: buildM1AuthorizedEventFeed(viewer.state, viewer.actorContext, afterCursor),
    };
  }

  subscribeM1Realtime(
    authenticatedSessionId: string,
    gameId: string,
    afterCursor: unknown,
    handler: M1RealtimeDeliveryHandler,
  ): M1RealtimeOperationResult<M1RealtimeSubscriptionResult> {
    if (this.realtime === undefined) return { ok: false, error: engineErrorFor('NOT_AUTHORIZED') };
    const initialViewer = this.resolveRealtimeViewer(authenticatedSessionId, gameId);
    if (!initialViewer.ok) return initialViewer;
    const cursorError = validateM1RealtimeCursor(initialViewer.state, initialViewer.actorContext, afterCursor);
    if (cursorError !== undefined || !isM1RealtimeCursor(afterCursor)) {
      return { ok: false, error: engineErrorFor(cursorError ?? 'REALTIME_CURSOR_INVALID') };
    }
    const participantId = initialViewer.actorContext.participantId;
    if (participantId === undefined || initialViewer.actorContext.actorType === 'SYSTEM') {
      return { ok: false, error: engineErrorFor('INVALID_ACTOR_CONTEXT') };
    }
    const subscription = this.realtime.subscribe({
      authenticatedSessionId,
      gameId,
      viewerParticipantId: participantId,
      viewerRole: initialViewer.actorContext.actorType,
      projectionId: realtimeProjectionId(initialViewer.actorContext),
    }, handler);

    // Register first, then catch up. A commit between these two operations can
    // arrive live and in this feed; the consumer deduplicates canonical IDs.
    const catchupViewer = this.resolveRealtimeViewer(authenticatedSessionId, gameId);
    if (!catchupViewer.ok) {
      this.realtime.unsubscribe(subscription.subscriptionId);
      return catchupViewer;
    }
    const catchup = buildM1AuthorizedEventFeed(catchupViewer.state, catchupViewer.actorContext, afterCursor);
    if (catchup.cursor.lastSequenceNumber > afterCursor.lastSequenceNumber) {
      this.realtime.publish(subscription.subscriptionId, {
        ...catchup,
        deliveryId: `${gameId}:recovery:${afterCursor.lastSequenceNumber}:${catchup.cursor.lastSequenceNumber}:${subscription.subscriptionId}`,
        deliveryKind: 'RECOVERY',
      });
    }
    return { ok: true, value: { subscription, catchup } };
  }

  reconnectM1(
    authenticatedSessionId: string,
    gameId: string,
    handler: M1RealtimeDeliveryHandler,
  ): M1RealtimeOperationResult<M1ReconnectResult> {
    const initial = this.getM1InitialSync(authenticatedSessionId, gameId);
    if (!initial.ok) return initial;
    const subscribed = this.subscribeM1Realtime(authenticatedSessionId, gameId, initial.value.cursor, handler);
    if (!subscribed.ok) return subscribed;
    return {
      ok: true,
      value: {
        ...initial.value,
        subscription: subscribed.value.subscription,
        catchup: subscribed.value.catchup,
      },
    };
  }

  unsubscribeM1Realtime(subscriptionId: string): void {
    this.realtime?.unsubscribe(subscriptionId);
  }

  private resolveRealtimeViewer(
    authenticatedSessionId: string,
    gameId: string,
  ):
    | { readonly ok: true; readonly state: SetupGameState; readonly actorContext: ActorContext }
    | { readonly ok: false; readonly error: ReturnType<typeof engineErrorFor> } {
    const scope = this.authority.verifyGameScope(authenticatedSessionId, gameId);
    if (!scope.ok) return { ok: false, error: engineErrorFor(scope.error) };
    const state = this.store.snapshot(gameId);
    if (state === undefined) return { ok: false, error: engineErrorFor('GAME_NOT_FOUND') };
    const resolution = this.authority.resolve(authenticatedSessionId, gameId, state);
    if (!resolution.ok) return { ok: false, error: engineErrorFor(resolution.error) };
    return { ok: true, state, actorContext: resolution.actorContext };
  }

  private publishCommittedEvents(before: SetupGameState | undefined, after: SetupGameState): void {
    if (this.realtime === undefined) return;
    const previousSequenceNumber = before?.events.at(-1)?.sequenceNumber ?? 0;
    const committedEvents = after.events.filter(({ sequenceNumber }) => sequenceNumber > previousSequenceNumber);
    if (committedEvents.length === 0) return;
    for (const subscription of this.realtime.subscriptionsForGame(after.id)) {
      const resolution = this.authority.resolve(
        subscription.authenticatedSessionId,
        after.id,
        after,
      );
      if (!resolution.ok) continue;
      const actor = resolution.actorContext;
      if (
        actor.participantId !== subscription.viewerParticipantId ||
        actor.actorType !== subscription.viewerRole ||
        realtimeProjectionId(actor) !== subscription.projectionId
      ) continue;
      const projectedEvents = committedEvents
        .map((event) => projectM1EventForViewer(event, actor))
        .filter((event): event is NonNullable<typeof event> => event !== undefined);
      if (projectedEvents.length === 0) continue;
      const cursor = buildM1RealtimeCursor(after, actor);
      const delivery: M1RealtimeDelivery = {
        deliveryId: `${after.id}:live:${after.version}:${subscription.subscriptionId}`,
        deliveryKind: 'LIVE',
        projection: buildM1RealtimeProjection(after, actor),
        cursor,
        events: projectedEvents,
      };
      this.realtime.publish(subscription.subscriptionId, delivery);
    }
  }

  private reject(
    input: Pick<SessionCommandInput, 'commandId' | 'gameId'> | Pick<SessionM1InteractionInput, 'commandId' | 'gameId'>,
    version: number,
    code: AnyEngineErrorCode,
  ): EngineCommandResult {
    return {
      commandId: input.commandId,
      gameId: input.gameId,
      status: 'REJECTED',
      gameVersionBefore: version,
      gameVersionAfter: version,
      resultCode: code,
      emittedEventRefs: [],
      adjudicationTraceRefs: [],
      error: engineErrorFor(code),
      resolvedAt: this.now().toISOString(),
    };
  }
}
