import { createHash } from 'node:crypto';
import { InMemorySessionAuthority } from '@malign-ai/authz';
import { engineErrorFor, type AnyEngineErrorCode, type EngineCommandResult } from '@malign-ai/contracts';
import {
  M1AdjudicationEngine,
  type SetupCommandPayload,
  type SetupCommandType,
  SetupCommandDispatcher,
  InMemorySetupGameStore,
  buildDurableEngineTransition,
  deterministicJsonSerialize,
  validateSetupCommandPayload,
} from '@malign-ai/game-engine';
import { PostgresDurableUnitOfWork } from '@malign-ai/persistence';
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
import type {
  DurableAcceptedEngineResult,
  SetupGameState,
  TransactionalRandomProvider,
} from '@malign-ai/domain';
import {
  buildM1AuthorizedEventFeed,
  isM1RealtimeCursor,
  validateM1RealtimeCursor,
  type InternalRealtimeSubscription,
  type M1AuthorizedEventFeed,
  type M1InitialSync,
  type M1RealtimeDelivery,
  type M1RealtimeDeliveryHandler,
  type M1RealtimeOperationResult,
  type M1RealtimePort,
  type M1RealtimeSubscriptionHandle,
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

export type PostgresCreateGameInput = Omit<SessionCommandInput, 'gameId' | 'commandType'> & {
  readonly commandType?: never;
};

/** Server-internal scheduler request; it has no session, payload or actor fields. */
export interface InternalM1SchedulerInput {
  readonly gameId: string;
  readonly expectedGameVersion: number;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly correlationId?: string;
}

/** Server-only scheduler port; no browser session, ActorContext or caller authority crosses it. */
export interface InternalM1SchedulerPort {
  runM1SchedulerNext(input: InternalM1SchedulerInput): Promise<EngineCommandResult>;
  runM1SchedulerUntilBlocked(gameId: string): Promise<readonly EngineCommandResult[]>;
}

export type InternalM2CleanupInput = DurableOperationInput;

/** Server-only Cleanup port; caller cannot supply ActorContext or permissions. */
export interface InternalM2CleanupPort {
  runM2Cleanup(input: InternalM2CleanupInput): Promise<EngineCommandResult>;
}

export type InternalM2EndGameInput = DurableOperationInput;

/** Server-only End Game port; caller cannot supply ActorContext, metrics or permissions. */
export interface InternalM2EndGamePort {
  runM2EndGame(input: InternalM2EndGameInput): Promise<EngineCommandResult>;
}

export interface TransactionalApplicationClock {
  checkpoint(): number;
  now(): Date;
  restore(checkpoint: number): void;
  commit(checkpoint: number): void;
}

export type ProjectionQueryResult =
  | { readonly ok: true; readonly projection: SetupGameProjection }
  | { readonly ok: false; readonly error: ReturnType<typeof engineErrorFor> };

export type M1ProjectionQueryResult =
  | { readonly ok: true; readonly projection: M1AdjudicationProjection }
  | { readonly ok: false; readonly error: ReturnType<typeof engineErrorFor> };

export interface M1RealtimeSubscriptionResult {
  readonly subscription: M1RealtimeSubscriptionHandle;
}

type MaybePromise<T> = T | Promise<T>;

/** Composition-root port shared by the in-memory and PostgreSQL authoritative adapters. */
export interface GameSessionApplicationPort {
  execute(authenticatedSessionId: string, input: SessionCommandInput): MaybePromise<EngineCommandResult>;
  executeM1Interaction(authenticatedSessionId: string, input: SessionM1InteractionInput): MaybePromise<EngineCommandResult>;
  executeForActor(actorContext: ActorContext, input: SessionCommandInput): MaybePromise<EngineCommandResult>;
  executeM1InteractionForActor(actorContext: ActorContext, input: SessionM1InteractionInput): MaybePromise<EngineCommandResult>;
  getGameProjection(authenticatedSessionId: string, gameId: string): MaybePromise<ProjectionQueryResult>;
  getM1AdjudicationProjection(authenticatedSessionId: string, gameId: string): MaybePromise<M1ProjectionQueryResult>;
  getM1InitialSync(authenticatedSessionId: string, gameId: string): MaybePromise<M1RealtimeOperationResult<M1InitialSync>>;
  getM1EventFeed(authenticatedSessionId: string, gameId: string, afterCursor: unknown): MaybePromise<M1RealtimeOperationResult<M1AuthorizedEventFeed>>;
  getM1InitialSyncForActor(actorContext: ActorContext, gameId: string): MaybePromise<M1RealtimeOperationResult<M1InitialSync>>;
  getM1EventFeedForActor(actorContext: ActorContext, gameId: string, afterCursor: unknown): MaybePromise<M1RealtimeOperationResult<M1AuthorizedEventFeed>>;
}

export interface M1ReconnectResult extends M1InitialSync {
  readonly subscription: M1RealtimeSubscriptionHandle;
}

export interface M1RealtimeActivationResult {
  readonly catchup: M1AuthorizedEventFeed;
}

export interface M1RealtimeUnsubscribeResult {
  readonly unsubscribed: true;
}

const freeAuthorityFields = new Set(['actorId', 'participantId', 'permissions', 'authenticatedSessionId', 'actorContext', 'gameId']);

const payloadClaimsAuthority = (payload: unknown): boolean =>
  typeof payload === 'object' && payload !== null && Object.keys(payload).some((key) => freeAuthorityFields.has(key));

export class InMemoryGameSessionApplication implements GameSessionApplicationPort {
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

  executeForActor(actorContext: ActorContext, input: SessionCommandInput): EngineCommandResult {
    const state = this.store.snapshot(input.gameId);
    if (state === undefined || !this.actorMatchesState(actorContext, state)) return this.reject(input, state?.version ?? 0, 'NOT_AUTHORIZED');
    if (payloadClaimsAuthority(input.payload)) return this.reject(input, state.version, 'INVALID_ACTOR_CONTEXT');
    const payloadError = validateSetupCommandPayload(input.commandType, input.payload);
    if (payloadError !== undefined) return this.reject(input, state.version, payloadError);
    return this.dispatcher.dispatch({ ...input, actorContext });
  }

  executeM1InteractionForActor(actorContext: ActorContext, input: SessionM1InteractionInput): EngineCommandResult {
    const state = this.store.snapshot(input.gameId);
    if (state === undefined || !this.actorMatchesState(actorContext, state)) return this.reject(input, state?.version ?? 0, 'NOT_AUTHORIZED');
    if (payloadClaimsAuthority(input.payload)) return this.reject(input, state.version, 'INVALID_ACTOR_CONTEXT');
    if (this.adjudicationEngine === undefined) return this.reject(input, state.version, 'NOT_AUTHORIZED');
    return this.adjudicationEngine.dispatchInteraction({ ...input, actorContext });
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

  getM1InitialSyncForActor(actorContext: ActorContext, gameId: string): M1RealtimeOperationResult<M1InitialSync> {
    const state = this.store.snapshot(gameId);
    if (state === undefined || !this.actorMatchesState(actorContext, state)) {
      return { ok: false, error: engineErrorFor('NOT_AUTHORIZED') };
    }
    return { ok: true, value: {
      projection: buildM1RealtimeProjection(state, actorContext),
      cursor: buildM1RealtimeCursor(state, actorContext),
    } };
  }

  getM1EventFeedForActor(
    actorContext: ActorContext,
    gameId: string,
    afterCursor: unknown,
  ): M1RealtimeOperationResult<M1AuthorizedEventFeed> {
    const state = this.store.snapshot(gameId);
    if (state === undefined || !this.actorMatchesState(actorContext, state)) {
      return { ok: false, error: engineErrorFor('NOT_AUTHORIZED') };
    }
    const cursorError = validateM1RealtimeCursor(state, actorContext, afterCursor);
    if (cursorError !== undefined || !isM1RealtimeCursor(afterCursor)) {
      return { ok: false, error: engineErrorFor(cursorError ?? 'REALTIME_CURSOR_INVALID') };
    }
    return { ok: true, value: buildM1AuthorizedEventFeed(state, actorContext, afterCursor) };
  }

  subscribeM1Realtime(
    authenticatedSessionId: string,
    gameId: string,
    afterCursor: unknown,
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
    const subscription = this.realtime.register({
      authenticatedSessionId,
      gameId,
      viewerParticipantId: participantId,
      viewerRole: initialViewer.actorContext.actorType,
      projectionId: realtimeProjectionId(initialViewer.actorContext),
      startCursor: structuredClone(afterCursor),
    });
    return { ok: true, value: { subscription } };
  }

  reconnectM1(
    authenticatedSessionId: string,
    gameId: string,
  ): M1RealtimeOperationResult<M1ReconnectResult> {
    if (this.realtime === undefined) return { ok: false, error: engineErrorFor('NOT_AUTHORIZED') };
    const viewer = this.resolveRealtimeViewer(authenticatedSessionId, gameId);
    if (!viewer.ok) return viewer;
    const participantId = viewer.actorContext.participantId;
    if (participantId === undefined || viewer.actorContext.actorType === 'SYSTEM') {
      return { ok: false, error: engineErrorFor('INVALID_ACTOR_CONTEXT') };
    }
    const initial: M1InitialSync = {
      projection: buildM1RealtimeProjection(viewer.state, viewer.actorContext),
      cursor: buildM1RealtimeCursor(viewer.state, viewer.actorContext),
    };
    const subscription = this.realtime.register({
      authenticatedSessionId,
      gameId,
      viewerParticipantId: participantId,
      viewerRole: viewer.actorContext.actorType,
      projectionId: realtimeProjectionId(viewer.actorContext),
      startCursor: initial.cursor,
    });
    return {
      ok: true,
      value: {
        ...initial,
        subscription,
      },
    };
  }

  activateM1Realtime(
    authenticatedSessionId: string,
    gameId: string,
    handle: M1RealtimeSubscriptionHandle,
    handler: M1RealtimeDeliveryHandler,
  ): M1RealtimeOperationResult<M1RealtimeActivationResult> {
    if (this.realtime === undefined) return { ok: false, error: engineErrorFor('NOT_AUTHORIZED') };
    const viewer = this.resolveRealtimeViewer(authenticatedSessionId, gameId);
    if (!viewer.ok) return viewer;
    const subscription = this.ownedSubscription(authenticatedSessionId, gameId, handle, viewer.actorContext);
    if (subscription === undefined) return { ok: false, error: engineErrorFor('NOT_AUTHORIZED') };
    const cursorError = validateM1RealtimeCursor(viewer.state, viewer.actorContext, subscription.startCursor);
    if (cursorError !== undefined) return { ok: false, error: engineErrorFor(cursorError) };
    const catchup = buildM1AuthorizedEventFeed(viewer.state, viewer.actorContext, subscription.startCursor);
    const delivery = catchup.cursor.lastSequenceNumber > catchup.fromCursor.lastSequenceNumber ||
      catchup.cursor.gameVersion > catchup.fromCursor.gameVersion
      ? {
          ...catchup,
          deliveryId: `${gameId}:recovery:${catchup.fromCursor.lastSequenceNumber}:${catchup.cursor.lastSequenceNumber}:${handle.subscriptionId}`,
          deliveryKind: 'RECOVERY' as const,
        }
      : undefined;
    this.realtime.activate(handle.subscriptionId, handler, delivery);
    return { ok: true, value: { catchup } };
  }

  unsubscribeM1Realtime(
    authenticatedSessionId: string,
    gameId: string,
    handle: M1RealtimeSubscriptionHandle,
  ): M1RealtimeOperationResult<M1RealtimeUnsubscribeResult> {
    if (this.realtime === undefined) return { ok: false, error: engineErrorFor('NOT_AUTHORIZED') };
    const viewer = this.resolveRealtimeViewer(authenticatedSessionId, gameId);
    if (!viewer.ok) return viewer;
    const subscription = this.ownedSubscription(authenticatedSessionId, gameId, handle, viewer.actorContext);
    if (subscription === undefined) return { ok: false, error: engineErrorFor('NOT_AUTHORIZED') };
    this.realtime.unsubscribe(subscription.subscriptionId);
    return { ok: true, value: { unsubscribed: true } };
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
      if (!resolution.ok) {
        this.realtime.unsubscribe(subscription.subscriptionId);
        continue;
      }
      const actor = resolution.actorContext;
      if (
        actor.participantId !== subscription.viewerParticipantId ||
        actor.actorType !== subscription.viewerRole ||
        realtimeProjectionId(actor) !== subscription.projectionId
      ) {
        this.realtime.unsubscribe(subscription.subscriptionId);
        continue;
      }
      const projectedEvents = committedEvents
        .map((event) => projectM1EventForViewer(event, actor))
        .filter((event): event is NonNullable<typeof event> => event !== undefined);
      if (projectedEvents.length === 0) continue;
      const cursor = buildM1RealtimeCursor(after, actor);
      const delivery: M1RealtimeDelivery = {
        deliveryId: `${after.id}:live:${after.version}:${subscription.subscriptionId}`,
        deliveryKind: 'LIVE',
        projection: buildM1RealtimeProjection(after, actor),
        fromCursor: structuredClone(subscription.lastIssuedCursor),
        cursor,
        events: projectedEvents,
      };
      this.realtime.publish(subscription.subscriptionId, delivery);
    }
  }

  private actorMatchesState(actorContext: ActorContext, state: SetupGameState): boolean {
    const participantId = actorContext.participantId;
    const participant = participantId === undefined ? undefined : state.participants[participantId];
    return participant !== undefined && participant.userId === actorContext.actorId && participant.role === actorContext.actorType;
  }

  private ownedSubscription(
    authenticatedSessionId: string,
    gameId: string,
    handle: M1RealtimeSubscriptionHandle,
    actorContext: ActorContext,
  ): InternalRealtimeSubscription | undefined {
    const participantId = actorContext.participantId;
    if (participantId === undefined || actorContext.actorType === 'SYSTEM') return undefined;
    const target = {
      authenticatedSessionId,
      gameId,
      viewerParticipantId: participantId,
      viewerRole: actorContext.actorType,
      projectionId: realtimeProjectionId(actorContext),
    };
    if (!this.realtime?.matches(handle.subscriptionId, target)) return undefined;
    return this.realtime.subscriptionsForGame(gameId)
      .find(({ subscriptionId }) => subscriptionId === handle.subscriptionId);
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

interface PreparedDurableOperation {
  readonly ready: true;
  readonly actor: {
    readonly actorId: string;
    readonly actorType: ActorContext['actorType'];
    readonly participantId: string | null;
    readonly authenticatedSessionId: string;
  };
  readonly commandType: string;
  readonly beforeState: SetupGameState | null;
  readonly execute: (
    random: TransactionalRandomProvider,
    now: () => Date,
  ) => { readonly result: EngineCommandResult; readonly afterState?: SetupGameState };
  readonly afterCommit?: () => void;
}

type DurableOperationPreparation =
  | PreparedDurableOperation
  | { readonly ready: false; readonly result: EngineCommandResult };

interface DurableOperationInput {
  readonly commandId: string;
  readonly gameId: string;
  readonly idempotencyKey: string;
  readonly expectedGameVersion: number;
  readonly correlationId?: string;
  readonly causationId?: string;
}

/** Durable composition adapter: authenticated boundary → authoritative Engine → PostgreSQL. */
export class PostgresGameSessionApplication implements GameSessionApplicationPort, InternalM1SchedulerPort, InternalM2CleanupPort, InternalM2EndGamePort {
  private readonly randomByGame = new Map<string, TransactionalRandomProvider>();
  private readonly clockByGame = new Map<string, TransactionalApplicationClock>();
  private readonly writerTailByGame = new Map<string, Promise<void>>();

  constructor(
    private readonly authority: InMemorySessionAuthority,
    private readonly persistence: PostgresDurableUnitOfWork,
    private readonly randomFactory: (gameId: string) => TransactionalRandomProvider,
    private readonly now: () => Date,
    private readonly clockFactory?: (gameId: string) => TransactionalApplicationClock,
  ) {}

  async execute(authenticatedSessionId: string, input: SessionCommandInput): Promise<EngineCommandResult> {
    if(input.commandType==='CREATE_GAME')return this.reject(input,0,'NOT_AUTHORIZED');
    return this.executeCommand(authenticatedSessionId,input,false);
  }

  async createGame(
    authenticatedSessionId:string,
    input:PostgresCreateGameInput,
  ):Promise<{readonly gameId:string;readonly result:EngineCommandResult}> {
    const authorization=this.authority.authorizeAllocatedGameCreation(authenticatedSessionId);
    if(!authorization.ok)return {gameId:'',result:this.reject({commandId:input.commandId,gameId:''},0,authorization.error)};
    const gameId=await this.persistence.allocateGameId();
    const resolution=this.authority.bindAllocatedGameForCreate(authenticatedSessionId,gameId);
    if(!resolution.ok)return {gameId,result:this.reject({commandId:input.commandId,gameId},0,resolution.error)};
    const result=await this.executeCommand(authenticatedSessionId,{...input,gameId,commandType:'CREATE_GAME'},true);
    return {gameId,result};
  }

  private async executeCommand(
    authenticatedSessionId:string,input:SessionCommandInput,allowAllocatedCreate:boolean,
  ):Promise<EngineCommandResult> {
    if(input.commandType==='CREATE_GAME'&&!allowAllocatedCreate)return this.reject(input,0,'NOT_AUTHORIZED');
    const boundActor = this.authority.resolveBoundActorId(authenticatedSessionId, input.gameId);
    if (!boundActor.ok) return this.reject(input, 0, boundActor.error);
    const fingerprintSha256 = this.fingerprint(input);
    return this.coordinateDurableOperation({
      input,
      actorId:boundActor.actorId,
      fingerprintSha256,
      prepare:(state):DurableOperationPreparation=>{
        if(input.commandType!=='CREATE_GAME'&&state===undefined)
          return {ready:false,result:this.reject(input,0,'GAME_NOT_FOUND')};
        const resolution=input.commandType==='CREATE_GAME'
          ?this.authority.resolveForCreate(authenticatedSessionId,input.gameId)
          :input.commandType==='JOIN_GAME_MEMBERSHIP'
            ?this.authority.resolveForJoin(authenticatedSessionId,input.gameId,state!)
            :this.resolveDurableViewer(authenticatedSessionId,input.gameId,state!);
        if(!resolution.ok)return {ready:false,result:this.reject(input,state?.version??0,resolution.error)};
        if(payloadClaimsAuthority(input.payload))
          return {ready:false,result:this.reject(input,state?.version??0,'INVALID_ACTOR_CONTEXT')};
        const payloadError=validateSetupCommandPayload(input.commandType,input.payload);
        if(payloadError!==undefined)return {ready:false,result:this.reject(input,state?.version??0,payloadError)};
        return {
          ready:true,
          actor:this.durableActor(resolution.actorContext),
          commandType:input.commandType,
          beforeState:state??null,
          execute:(random,now)=>{
            const store=new InMemorySetupGameStore(state===undefined?[]:[state]);
            const result=new SetupCommandDispatcher(store,random,now,'APPLICATION')
              .dispatch({...input,actorContext:resolution.actorContext});
            const afterState=store.snapshot(input.gameId);
            return {result,...(afterState===undefined?{}:{afterState})};
          },
          afterCommit:()=>{
            if(input.commandType==='CREATE_GAME'||input.commandType==='JOIN_GAME_MEMBERSHIP'){
              const participantId=resolution.actorContext.participantId;
              if(participantId!==undefined)
                this.authority.materializeMembership(authenticatedSessionId,input.gameId,participantId);
            }
          },
        };
      },
    });
  }

  async executeM1Interaction(authenticatedSessionId: string, input: SessionM1InteractionInput): Promise<EngineCommandResult> {
    const boundActor=this.authority.resolveBoundActorId(authenticatedSessionId,input.gameId);
    if(!boundActor.ok)return this.reject(input,0,boundActor.error);
    const fingerprintSha256 = this.fingerprint(input);
    return this.coordinateDurableOperation({
      input,actorId:boundActor.actorId,fingerprintSha256,
      prepare:(state):DurableOperationPreparation=>{
        if(state===undefined)return {ready:false,result:this.reject(input,0,'GAME_NOT_FOUND')};
        const resolution=this.resolveDurableViewer(authenticatedSessionId,input.gameId,state);
        if(!resolution.ok)return {ready:false,result:this.reject(input,state.version,resolution.error)};
        if(payloadClaimsAuthority(input.payload))
          return {ready:false,result:this.reject(input,state.version,'INVALID_ACTOR_CONTEXT')};
        return {ready:true,actor:this.durableActor(resolution.actorContext),commandType:input.commandType,
          beforeState:state,execute:(random,now)=>{
            const store=new InMemorySetupGameStore([state]);
            const result=new M1AdjudicationEngine(store,random,now,'APPLICATION')
              .dispatchInteraction({...input,actorContext:resolution.actorContext});
            const afterState=store.snapshot(input.gameId);
            return {result,...(afterState===undefined?{}:{afterState})};
          }};
      },
    });
  }

  async executeForActor(actorContext: ActorContext, input: SessionCommandInput): Promise<EngineCommandResult> {
    if (input.commandType === 'CREATE_GAME') return this.reject(input, 0, 'NOT_AUTHORIZED');
    const fingerprintSha256 = this.fingerprint(input);
    return this.coordinateDurableOperation({
      input,
      actorId: actorContext.actorId,
      fingerprintSha256,
      prepare: (state): DurableOperationPreparation => {
        if (state === undefined) return { ready: false, result: this.reject(input, 0, 'GAME_NOT_FOUND') };
        if (!this.actorMatchesRecoveredState(actorContext, state)) return { ready: false, result: this.reject(input, state.version, 'NOT_AUTHORIZED') };
        if (payloadClaimsAuthority(input.payload)) return { ready: false, result: this.reject(input, state.version, 'INVALID_ACTOR_CONTEXT') };
        const payloadError = validateSetupCommandPayload(input.commandType, input.payload);
        if (payloadError !== undefined) return { ready: false, result: this.reject(input, state.version, payloadError) };
        return {
          ready: true,
          actor: this.durableActor(actorContext),
          commandType: input.commandType,
          beforeState: state,
          execute: (random, now) => {
            const store = new InMemorySetupGameStore([state]);
            const result = new SetupCommandDispatcher(store, random, now, 'APPLICATION')
              .dispatch({ ...input, actorContext });
            const afterState = store.snapshot(input.gameId);
            return { result, ...(afterState === undefined ? {} : { afterState }) };
          },
        };
      },
    });
  }

  async executeM1InteractionForActor(actorContext: ActorContext, input: SessionM1InteractionInput): Promise<EngineCommandResult> {
    const fingerprintSha256 = this.fingerprint(input);
    return this.coordinateDurableOperation({
      input,
      actorId: actorContext.actorId,
      fingerprintSha256,
      prepare: (state): DurableOperationPreparation => {
        if (state === undefined) return { ready: false, result: this.reject(input, 0, 'GAME_NOT_FOUND') };
        if (!this.actorMatchesRecoveredState(actorContext, state)) return { ready: false, result: this.reject(input, state.version, 'NOT_AUTHORIZED') };
        if (payloadClaimsAuthority(input.payload)) return { ready: false, result: this.reject(input, state.version, 'INVALID_ACTOR_CONTEXT') };
        return {
          ready: true,
          actor: this.durableActor(actorContext),
          commandType: input.commandType,
          beforeState: state,
          execute: (random, now) => {
            const store = new InMemorySetupGameStore([state]);
            const result = new M1AdjudicationEngine(store, random, now, 'APPLICATION')
              .dispatchInteraction({ ...input, actorContext });
            const afterState = store.snapshot(input.gameId);
            return { result, ...(afterState === undefined ? {} : { afterState }) };
          },
        };
      },
    });
  }

  /** Productive internal scheduler: recovery → Engine → durable CAS → RNG commit. */
  async runM1SchedulerNext(input:InternalM1SchedulerInput):Promise<EngineCommandResult> {
    const fingerprintSha256=createHash('sha256').update(deterministicJsonSerialize({
      commandType:'INTERNAL_RUN_M1_SCHEDULER',beforeVersion:input.expectedGameVersion,
    })).digest('hex');
    return this.coordinateDurableOperation({
      input,actorId:'M1_INTERNAL_SCHEDULER',fingerprintSha256,
      prepare:(state):DurableOperationPreparation=>{
        if(state===undefined)return {ready:false,result:this.reject(input,0,'GAME_NOT_FOUND')};
        return {ready:true,commandType:'INTERNAL_RUN_M1_SCHEDULER',beforeState:state,
          actor:{actorId:'M1_INTERNAL_SCHEDULER',actorType:'SYSTEM',participantId:null,
            authenticatedSessionId:'internal:m1-2'},
          execute:(random,now)=>{
            const store=new InMemorySetupGameStore([state]);
            const result=new M1AdjudicationEngine(store,random,now,'APPLICATION').runNext(input);
            const afterState=store.snapshot(input.gameId);
            return {result,...(afterState===undefined?{}:{afterState})};
          }};
      },
    });
  }

  async runM1SchedulerUntilBlocked(gameId:string):Promise<readonly EngineCommandResult[]> {
    const results:EngineCommandResult[]=[];
    for(let guard=0;guard<100;guard+=1) {
      const state=await this.recoverState(gameId);
      if(state===undefined||state.adjudication.scheduler.status==='COMPLETE'||
          state.adjudication.pendingResolution!==undefined)return results;
      const suffix=`${state.version}:${state.adjudication.scheduler.participantIndex}:${state.adjudication.scheduler.slotIndex}`;
      const result=await this.runM1SchedulerNext({gameId,expectedGameVersion:state.version,
        commandId:`m1-scheduler:${suffix}`,idempotencyKey:`m1-scheduler:${suffix}`});
      results.push(result);
      if(result.status!=='RESOLVED')return results;
    }
    throw new Error('M1 scheduler exceeded its deterministic guard');
  }

  async runM2Cleanup(input: InternalM2CleanupInput): Promise<EngineCommandResult> {
    const fingerprintSha256=createHash('sha256').update(deterministicJsonSerialize({
      commandType:'INTERNAL_RUN_M2_CLEANUP',beforeVersion:input.expectedGameVersion,
    })).digest('hex');
    return this.coordinateDurableOperation({
      input, actorId:'M2_INTERNAL_COORDINATOR', fingerprintSha256,
      prepare:(state):DurableOperationPreparation=>{
        if(state===undefined)return {ready:false,result:this.reject(input,0,'GAME_NOT_FOUND')};
        return {ready:true,commandType:'INTERNAL_RUN_M2_CLEANUP',beforeState:state,
          actor:{actorId:'M2_INTERNAL_COORDINATOR',actorType:'SYSTEM',participantId:null,authenticatedSessionId:'internal:m2'},
          execute:(random,now)=>{
            const store=new InMemorySetupGameStore([state]);
            const result=new SetupCommandDispatcher(store,random,now,'APPLICATION').runM2Cleanup(input);
            const afterState=store.snapshot(input.gameId);
            return {result,...(afterState===undefined?{}:{afterState})};
          }};
      },
    });
  }

  async runM2EndGame(input: InternalM2EndGameInput): Promise<EngineCommandResult> {
    const fingerprintSha256=createHash('sha256').update(deterministicJsonSerialize({
      commandType:'INTERNAL_RUN_M2_END_GAME',beforeVersion:input.expectedGameVersion,
    })).digest('hex');
    return this.coordinateDurableOperation({
      input, actorId:'M2_INTERNAL_COORDINATOR', fingerprintSha256,
      prepare:(state):DurableOperationPreparation=>{
        if(state===undefined)return {ready:false,result:this.reject(input,0,'GAME_NOT_FOUND')};
        return {ready:true,commandType:'INTERNAL_RUN_M2_END_GAME',beforeState:state,
          actor:{actorId:'M2_INTERNAL_COORDINATOR',actorType:'SYSTEM',participantId:null,authenticatedSessionId:'internal:m2'},
          execute:(random,now)=>{
            const store=new InMemorySetupGameStore([state]);
            const result=new SetupCommandDispatcher(store,random,now,'APPLICATION').runM2EndGame(input);
            const afterState=store.snapshot(input.gameId);
            return {result,...(afterState===undefined?{}:{afterState})};
          }};
      },
    });
  }

  private async coordinateDurableOperation(options: {
    readonly input: DurableOperationInput;
    readonly actorId: string;
    readonly fingerprintSha256: string;
    readonly prepare: (state: SetupGameState | undefined) => DurableOperationPreparation;
  }): Promise<EngineCommandResult> {
    const {input}=options;
    return this.withGameWriter(input.gameId,async()=>{
      try {
        const committed=await this.persistence.loadCommittedEngineResult({
          gameId:input.gameId,actorId:options.actorId,idempotencyKey:input.idempotencyKey,
          fingerprintSha256:options.fingerprintSha256,
        });
        if(committed)return committed;
      } catch(error) {
        if((error as {code?:string}).code==='IDEMPOTENCY_CONFLICT')
          return this.reject(input,input.expectedGameVersion,'IDEMPOTENCY_KEY_REUSED');
        throw error;
      }

      const state=await this.recoverState(input.gameId);
      const preparation=options.prepare(state);
      if(!preparation.ready)return preparation.result;

      const random=this.randomForGame(input.gameId);
      const clock=this.clockForGame(input.gameId);
      const randomCheckpoint=random.checkpoint();
      const clockCheckpoint=clock?.checkpoint();
      let finalized=false;
      let durableCommitted=false;
      const restore=():void=>{
        if(finalized)return;
        random.restore(randomCheckpoint);
        if(clock!==undefined&&clockCheckpoint!==undefined)clock.restore(clockCheckpoint);
        finalized=true;
      };
      const commit=():void=>{
        if(finalized)throw new Error('Application provider transaction was already finalized');
        random.commit(randomCheckpoint);
        if(clock!==undefined&&clockCheckpoint!==undefined)clock.commit(clockCheckpoint);
        finalized=true;
      };

      try {
        const execution=preparation.execute(random,clock===undefined?this.now:()=>clock.now());
        if(execution.result.status==='REJECTED'){
          restore();
          return execution.result;
        }
        if(execution.afterState===undefined){
          restore();
          return this.reject(input,preparation.beforeState?.version??0,'GAME_NOT_FOUND');
        }
        const durableResult=await this.persistence.persistAcceptedTransition(buildDurableEngineTransition({
          gameId:input.gameId,commandType:preparation.commandType,idempotencyKey:input.idempotencyKey,
          fingerprintSha256:options.fingerprintSha256,actor:preparation.actor,
          ...(input.correlationId===undefined?{}:{correlationId:input.correlationId}),
          ...(input.causationId===undefined?{}:{causationId:input.causationId}),
          beforeState:preparation.beforeState,afterState:execution.afterState,
          engineResult:execution.result as DurableAcceptedEngineResult,
        }),{deferPostCommitObserver:true});
        if(durableResult.replayed){
          restore();
          return durableResult.engineResult;
        }
        durableCommitted=true;
        commit();
        await this.persistence.publishCommittedTransition(durableResult);
        preparation.afterCommit?.();
        return execution.result;
      } catch(error) {
        if(!durableCommitted)restore();
        const code=(error as {code?:string}).code;
        if(code==='GAME_VERSION_CONFLICT')
          return this.reject(input,preparation.beforeState?.version??0,'STALE_STATE_VERSION');
        if(code==='CROSS_GAME_REFERENCE')
          return this.reject(input,preparation.beforeState?.version??0,'NOT_AUTHORIZED');
        throw error;
      }
    });
  }

  private randomForGame(gameId:string):TransactionalRandomProvider {
    const existing=this.randomByGame.get(gameId);
    if(existing!==undefined)return existing;
    const created=this.randomFactory(gameId);
    this.randomByGame.set(gameId,created);
    return created;
  }

  private clockForGame(gameId:string):TransactionalApplicationClock|undefined {
    const existing=this.clockByGame.get(gameId);
    if(existing!==undefined)return existing;
    const created=this.clockFactory?.(gameId);
    if(created!==undefined)this.clockByGame.set(gameId,created);
    return created;
  }

  private async withGameWriter<T>(gameId:string,operation:()=>Promise<T>):Promise<T> {
    const previous=this.writerTailByGame.get(gameId)??Promise.resolve();
    let release!:()=>void;
    const current=new Promise<void>((resolve)=>{release=resolve;});
    this.writerTailByGame.set(gameId,current);
    await previous;
    try{return await operation();}
    finally{
      release();
      if(this.writerTailByGame.get(gameId)===current)this.writerTailByGame.delete(gameId);
    }
  }

  async getGameProjection(authenticatedSessionId: string, gameId: string): Promise<ProjectionQueryResult> {
    const scope = this.authority.verifyGameScope(authenticatedSessionId, gameId);
    if (!scope.ok) return { ok: false, error: engineErrorFor(scope.error) };
    const state = await this.recoverState(gameId);
    if (state === undefined) return { ok: false, error: engineErrorFor('GAME_NOT_FOUND') };
    const resolution = this.resolveDurableViewer(authenticatedSessionId, gameId, state);
    if (!resolution.ok) return { ok: false, error: engineErrorFor(resolution.error) };
    return { ok: true, projection: buildSetupGameProjection(state, resolution.actorContext) };
  }

  async getM1AdjudicationProjection(authenticatedSessionId: string, gameId: string): Promise<M1ProjectionQueryResult> {
    const viewer = await this.resolveViewer(authenticatedSessionId, gameId);
    if (!viewer.ok) return viewer;
    return { ok: true, projection: buildM1AdjudicationProjection(viewer.state, viewer.actorContext) };
  }

  async getM1InitialSync(authenticatedSessionId: string, gameId: string): Promise<M1RealtimeOperationResult<M1InitialSync>> {
    const viewer = await this.resolveViewer(authenticatedSessionId, gameId);
    if (!viewer.ok) return viewer;
    return { ok: true, value: {
      projection: buildM1RealtimeProjection(viewer.state, viewer.actorContext),
      cursor: buildM1RealtimeCursor(viewer.state, viewer.actorContext),
    } };
  }

  async getM1EventFeed(authenticatedSessionId: string, gameId: string, afterCursor: unknown): Promise<M1RealtimeOperationResult<M1AuthorizedEventFeed>> {
    const viewer = await this.resolveViewer(authenticatedSessionId, gameId);
    if (!viewer.ok) return viewer;
    const cursorError = validateM1RealtimeCursor(viewer.state, viewer.actorContext, afterCursor);
    if (cursorError !== undefined || !isM1RealtimeCursor(afterCursor)) {
      return { ok: false, error: engineErrorFor(cursorError ?? 'REALTIME_CURSOR_INVALID') };
    }
    return { ok: true, value: buildM1AuthorizedEventFeed(viewer.state, viewer.actorContext, afterCursor) };
  }

  async getM1InitialSyncForActor(actorContext: ActorContext, gameId: string): Promise<M1RealtimeOperationResult<M1InitialSync>> {
    const state = await this.recoverState(gameId);
    if (state === undefined || !this.actorMatchesRecoveredState(actorContext, state)) {
      return { ok: false, error: engineErrorFor('NOT_AUTHORIZED') };
    }
    return { ok: true, value: {
      projection: buildM1RealtimeProjection(state, actorContext),
      cursor: buildM1RealtimeCursor(state, actorContext),
    } };
  }

  async getM1EventFeedForActor(
    actorContext: ActorContext,
    gameId: string,
    afterCursor: unknown,
  ): Promise<M1RealtimeOperationResult<M1AuthorizedEventFeed>> {
    const state = await this.recoverState(gameId);
    if (state === undefined || !this.actorMatchesRecoveredState(actorContext, state)) {
      return { ok: false, error: engineErrorFor('NOT_AUTHORIZED') };
    }
    const cursorError = validateM1RealtimeCursor(state, actorContext, afterCursor);
    if (cursorError !== undefined || !isM1RealtimeCursor(afterCursor)) {
      return { ok: false, error: engineErrorFor(cursorError ?? 'REALTIME_CURSOR_INVALID') };
    }
    return { ok: true, value: buildM1AuthorizedEventFeed(state, actorContext, afterCursor) };
  }

  private async resolveViewer(
    authenticatedSessionId: string,
    gameId: string,
  ): Promise<{ readonly ok: true; readonly state: SetupGameState; readonly actorContext: ActorContext } |
    { readonly ok: false; readonly error: ReturnType<typeof engineErrorFor> }> {
    const scope = this.authority.verifyGameScope(authenticatedSessionId, gameId);
    if (!scope.ok) return { ok: false, error: engineErrorFor(scope.error) };
    const state = await this.recoverState(gameId);
    if (state === undefined) return { ok: false, error: engineErrorFor('GAME_NOT_FOUND') };
    const resolution = this.resolveDurableViewer(authenticatedSessionId, gameId, state);
    if (!resolution.ok) return { ok: false, error: engineErrorFor(resolution.error) };
    return { ok: true, state, actorContext: resolution.actorContext };
  }

  private resolveDurableViewer(authenticatedSessionId: string, gameId: string, state: SetupGameState) {
    const active = this.authority.resolve(authenticatedSessionId, gameId, state);
    return active.ok ? active : this.authority.resolvePersistedMembership(authenticatedSessionId, gameId, state);
  }

  private actorMatchesRecoveredState(actorContext: ActorContext, state: SetupGameState): boolean {
    const participantId = actorContext.participantId;
    const participant = participantId === undefined ? undefined : state.participants[participantId];
    return participant !== undefined && participant.userId === actorContext.actorId && participant.role === actorContext.actorType;
  }

  private async recoverState(gameId: string): Promise<SetupGameState | undefined> {
    try { return (await this.persistence.recover(gameId)).state as unknown as SetupGameState; }
    catch (error) {
      if ((error as { code?: string }).code === 'GAME_NOT_FOUND') return undefined;
      throw error;
    }
  }

  private fingerprint(input: SessionCommandInput | SessionM1InteractionInput): string {
    return createHash('sha256').update(deterministicJsonSerialize({
      commandType: input.commandType,
      payloadSchemaVersion: input.payloadSchemaVersion,
      payload: input.payload,
    })).digest('hex');
  }

  private durableActor(actor: ActorContext) {
    return {
      actorId: actor.actorId,
      actorType: actor.actorType,
      participantId: actor.participantId ?? null,
      authenticatedSessionId: actor.authenticatedSessionId,
    } as const;
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
