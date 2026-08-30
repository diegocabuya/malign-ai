import { randomUUID } from 'node:crypto';

import type { ActorContext } from '@malign-ai/contracts';

export type ProductiveAuthnErrorCode =
  | 'AUTHN_CONFIGURATION_MISSING'
  | 'AUTHN_TOKEN_INVALID'
  | 'AUTHN_TOKEN_EXPIRED'
  | 'AUTHN_POLICY_REJECTED'
  | 'AUTHN_PROVIDER_UNAVAILABLE'
  | 'AUTHN_SESSION_INVALID'
  | 'AUTHZ_MEMBERSHIP_REJECTED';

export class ProductiveAuthnError extends Error {
  override readonly name = 'ProductiveAuthnError';

  constructor(readonly code: ProductiveAuthnErrorCode) {
    super('Authentication or authorization failed');
  }
}

export interface VerifiedExternalIdentity {
  readonly subject: string;
  readonly issuer: string;
  readonly audience: readonly string[];
  readonly clientBinding: string;
  readonly scopes: readonly string[];
  readonly expiresAtEpochSeconds: number;
}

/** Application-layer identity port. It deliberately returns no gameplay authority. */
export interface ProductiveAuthnPort {
  verifyAccessToken(accessToken: string): Promise<VerifiedExternalIdentity>;
}

export interface ProductiveSession {
  readonly sessionId: string;
  readonly identity: VerifiedExternalIdentity;
  readonly createdAtEpochMilliseconds: number;
}

export type SessionInvalidationObserver = (sessionId: string) => void;

/** Server-side session lifecycle. Tokens never leave the identity adapter. */
export class ProductiveSessionRegistry {
  readonly #sessions = new Map<string, ProductiveSession>();
  readonly #observers = new Set<SessionInvalidationObserver>();

  create(identity: VerifiedExternalIdentity, now = Date.now()): ProductiveSession {
    const session: ProductiveSession = {
      sessionId: randomUUID(),
      identity: structuredClone(identity),
      createdAtEpochMilliseconds: now,
    };
    this.#sessions.set(session.sessionId, session);
    return structuredClone(session);
  }

  resolve(sessionId: string, now = Date.now()): ProductiveSession {
    const session = this.#sessions.get(sessionId);
    if (session === undefined || session.identity.expiresAtEpochSeconds * 1_000 <= now) {
      if (session !== undefined) this.invalidate(sessionId);
      throw new ProductiveAuthnError(session === undefined ? 'AUTHN_SESSION_INVALID' : 'AUTHN_TOKEN_EXPIRED');
    }
    return structuredClone(session);
  }

  invalidate(sessionId: string): void {
    if (!this.#sessions.delete(sessionId)) return;
    for (const observer of this.#observers) {
      try { observer(sessionId); } catch { /* observer isolation is intentional */ }
    }
  }

  invalidateExternalSubject(subject: string): void {
    const matching = [...this.#sessions.values()]
      .filter((session) => session.identity.subject === subject)
      .map((session) => session.sessionId);
    for (const sessionId of matching) this.invalidate(sessionId);
  }

  onInvalidated(observer: SessionInvalidationObserver): () => void {
    this.#observers.add(observer);
    return () => this.#observers.delete(observer);
  }
}

export interface AuthoritativeMembership {
  readonly authenticatedSessionId: string;
  readonly externalSubject: string;
  readonly gameId: string;
  readonly participantId: string;
  readonly actorContext: ActorContext;
}

/** Resolves gameplay authority from the authoritative store after token verification. */
export interface ProductiveMembershipAuthorityPort {
  resolveMembership(session: ProductiveSession, gameId: string): Promise<AuthoritativeMembership>;
}
