import type { ActorContext, AnyEngineErrorCode } from '@malign-ai/contracts';
import type { GameSession, SetupGameState, TrustedSessionBinding } from '@malign-ai/domain';

export type ActorResolution =
  | { readonly ok: true; readonly actorContext: ActorContext }
  | { readonly ok: false; readonly error: AnyEngineErrorCode };

export type GameScopeResolution =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: 'INVALID_ACTOR_CONTEXT' | 'GAME_ID_MISMATCH' };

export class InMemorySessionAuthority {
  readonly #bindings = new Map<string, TrustedSessionBinding>();
  readonly #sessions = new Map<string, GameSession>();

  constructor(bindings: readonly TrustedSessionBinding[]) {
    for (const binding of bindings) {
      if (this.#bindings.has(binding.authenticatedSessionId)) {
        throw new Error('Authenticated session binding must be unique');
      }
      this.#bindings.set(binding.authenticatedSessionId, structuredClone(binding));
    }
  }

  verifyGameScope(authenticatedSessionId: string, gameId: string): GameScopeResolution {
    const binding = this.#bindings.get(authenticatedSessionId);
    if (binding === undefined) return { ok: false, error: 'INVALID_ACTOR_CONTEXT' };
    if (binding.gameId !== gameId) return { ok: false, error: 'GAME_ID_MISMATCH' };
    return { ok: true };
  }

  resolveForCreate(authenticatedSessionId: string, gameId: string): ActorResolution {
    const binding = this.#bindings.get(authenticatedSessionId);
    if (binding === undefined) return { ok: false, error: 'INVALID_ACTOR_CONTEXT' };
    if (binding.gameId !== gameId) return { ok: false, error: 'GAME_ID_MISMATCH' };
    if (binding.role !== 'FACILITATOR' || binding.participantId !== 'F1') return { ok: false, error: 'NOT_AUTHORIZED' };
    return { ok: true, actorContext: this.contextFrom(binding, ['game:create', 'game:facilitate', 'game:project']) };
  }

  resolveForJoin(authenticatedSessionId: string, gameId: string, state: SetupGameState): ActorResolution {
    const binding = this.#bindings.get(authenticatedSessionId);
    if (binding === undefined) return { ok: false, error: 'INVALID_ACTOR_CONTEXT' };
    if (binding.gameId !== gameId || state.id !== gameId) return { ok: false, error: 'GAME_ID_MISMATCH' };
    if (binding.role !== 'PLAYER') return { ok: false, error: 'NOT_AUTHORIZED' };
    return { ok: true, actorContext: this.contextFrom(binding, ['game:join']) };
  }

  resolve(authenticatedSessionId: string, gameId: string, state: SetupGameState): ActorResolution {
    const binding = this.#bindings.get(authenticatedSessionId);
    if (binding === undefined) return { ok: false, error: 'INVALID_ACTOR_CONTEXT' };
    if (binding.gameId !== gameId || state.id !== gameId) return { ok: false, error: 'GAME_ID_MISMATCH' };
    const membership = this.#sessions.get(gameId)?.memberships[binding.participantId];
    const participant = state.participants[binding.participantId];
    if (
      membership === undefined ||
      membership.connected !== true ||
      membership.authenticatedSessionId !== authenticatedSessionId ||
      participant === undefined ||
      participant.userId !== binding.userId ||
      participant.role !== binding.role
    ) return { ok: false, error: 'NOT_AUTHORIZED' };
    const seat = state.seats[binding.participantId];
    const permissions = binding.role === 'FACILITATOR'
      ? ['game:facilitate', 'game:project']
      : ['game:play', 'game:project'];
    return {
      ok: true,
      actorContext: this.contextFrom(binding, permissions, seat?.id, seat?.countryId),
    };
  }

  /** Re-establishes the application session seam from an already durable membership after restart. */
  resolvePersistedMembership(authenticatedSessionId: string, gameId: string, state: SetupGameState): ActorResolution {
    const binding = this.#bindings.get(authenticatedSessionId);
    if (binding === undefined) return { ok: false, error: 'INVALID_ACTOR_CONTEXT' };
    if (binding.gameId !== gameId || state.id !== gameId) return { ok: false, error: 'GAME_ID_MISMATCH' };
    const participant = state.participants[binding.participantId];
    if (participant === undefined || participant.userId !== binding.userId || participant.role !== binding.role) {
      return { ok: false, error: 'NOT_AUTHORIZED' };
    }
    this.materializeMembership(authenticatedSessionId, gameId, binding.participantId);
    return this.resolve(authenticatedSessionId, gameId, state);
  }

  materializeMembership(authenticatedSessionId: string, gameId: string, participantId: string): void {
    const binding = this.#bindings.get(authenticatedSessionId);
    if (binding === undefined || binding.gameId !== gameId || binding.participantId !== participantId) {
      throw new Error('Cannot materialize an unverified membership');
    }
    const session = this.#sessions.get(gameId) ?? { gameId, memberships: {} };
    session.memberships[participantId] = {
      gameId,
      participantId,
      authenticatedSessionId,
      connected: true,
    };
    this.#sessions.set(gameId, session);
  }

  sessionSnapshot(gameId: string): GameSession | undefined {
    const session = this.#sessions.get(gameId);
    return session === undefined ? undefined : structuredClone(session);
  }

  /** In-memory session lifecycle seam; it does not alter deterministic game state. */
  invalidateSession(authenticatedSessionId: string): void {
    this.#bindings.delete(authenticatedSessionId);
    for (const session of this.#sessions.values()) {
      for (const membership of Object.values(session.memberships)) {
        if (membership.authenticatedSessionId === authenticatedSessionId) membership.connected = false;
      }
    }
  }

  private contextFrom(
    binding: TrustedSessionBinding,
    permissions: readonly string[],
    playerSeatId?: string,
    countryId?: string,
  ): ActorContext {
    return {
      actorId: binding.userId,
      actorType: binding.role,
      participantId: binding.participantId,
      authenticatedSessionId: binding.authenticatedSessionId,
      permissions,
      ...(playerSeatId === undefined ? {} : { playerSeatId }),
      ...(countryId === undefined ? {} : { countryId }),
    };
  }
}
