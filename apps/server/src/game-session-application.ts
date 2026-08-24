import { InMemorySessionAuthority } from '@malign-ai/authz';
import { engineErrorFor, type AnyEngineErrorCode, type EngineCommandResult } from '@malign-ai/contracts';
import type { SetupGameState } from '@malign-ai/domain';
import {
  type SetupCommandPayload,
  type SetupCommandType,
  SetupCommandDispatcher,
  InMemorySetupGameStore,
} from '@malign-ai/game-engine';
import { buildSetupGameProjection, type SetupGameProjection } from '@malign-ai/projections';

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
}

export type ProjectionQueryResult =
  | { readonly ok: true; readonly projection: SetupGameProjection }
  | { readonly ok: false; readonly error: ReturnType<typeof engineErrorFor> };

const freeAuthorityFields = new Set(['actorId', 'participantId', 'permissions', 'authenticatedSessionId', 'actorContext', 'gameId']);

const payloadClaimsAuthority = (payload: SetupCommandPayload): boolean =>
  typeof payload === 'object' && payload !== null && Object.keys(payload).some((key) => freeAuthorityFields.has(key));

export class InMemoryGameSessionApplication {
  constructor(
    private readonly authority: InMemorySessionAuthority,
    private readonly store: InMemorySetupGameStore,
    private readonly dispatcher: SetupCommandDispatcher,
    private readonly now: () => Date,
  ) {}

  execute(authenticatedSessionId: string, input: SessionCommandInput): EngineCommandResult {
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

  getGameProjection(authenticatedSessionId: string, gameId: string): ProjectionQueryResult {
    const state = this.store.snapshot(gameId);
    if (state === undefined) return { ok: false, error: engineErrorFor('GAME_NOT_FOUND') };
    const resolution = this.authority.resolve(authenticatedSessionId, gameId, state);
    if (!resolution.ok) return { ok: false, error: engineErrorFor(resolution.error) };
    return { ok: true, projection: buildSetupGameProjection(state, resolution.actorContext) };
  }

  gameSnapshot(gameId: string): SetupGameState | undefined {
    return this.store.snapshot(gameId);
  }

  private reject(input: SessionCommandInput, version: number, code: AnyEngineErrorCode): EngineCommandResult {
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
