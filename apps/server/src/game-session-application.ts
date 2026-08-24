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
  buildSetupGameProjection,
  type M1AdjudicationProjection,
  type SetupGameProjection,
} from '@malign-ai/projections';

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
  ) {}

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
