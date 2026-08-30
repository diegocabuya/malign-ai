import {
  ProductiveAuthnError,
  type AuthoritativeMembership,
  type ProductiveAuthnPort,
  type ProductiveMembershipAuthorityPort,
  type ProductiveSession,
  type VerifiedExternalIdentity,
} from '@malign-ai/authz';
import { createRemoteJWKSet, errors, jwtVerify } from 'jose';

export interface Auth0JwksAuthnConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly clientId: string;
  readonly jwksUri?: string;
  readonly requiredScopes: readonly string[];
  readonly clockToleranceSeconds?: number;
  readonly jwksTimeoutMilliseconds?: number;
  readonly jwksCooldownMilliseconds?: number;
}

const normalizedIssuer = (issuer: string): string => issuer.endsWith('/') ? issuer : `${issuer}/`;

const required = (value: string | undefined): string => {
  if (value === undefined || value.trim() === '') throw new ProductiveAuthnError('AUTHN_CONFIGURATION_MISSING');
  return value;
};

export const auth0JwksConfigFromEnvironment = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Auth0JwksAuthnConfig => {
  const issuer = normalizedIssuer(required(environment.AUTH0_ISSUER_BASE_URL));
  return {
    issuer,
    audience: required(environment.AUTH0_AUDIENCE),
    clientId: required(environment.AUTH0_CLIENT_ID),
    jwksUri: environment.AUTH0_JWKS_URI ?? new URL('.well-known/jwks.json', issuer).toString(),
    requiredScopes: (environment.AUTH0_REQUIRED_SCOPES ?? 'malign:connect')
      .split(' ')
      .map((scope) => scope.trim())
      .filter((scope) => scope.length > 0),
    clockToleranceSeconds: Number.parseInt(environment.AUTH0_CLOCK_TOLERANCE_SECONDS ?? '2', 10),
    jwksTimeoutMilliseconds: Number.parseInt(environment.AUTH0_JWKS_TIMEOUT_MS ?? '3000', 10),
  };
};

/** Auth0-compatible RS256/JWKS adapter. It verifies identity only, never gameplay authority. */
export class Auth0JwksAuthnAdapter implements ProductiveAuthnPort {
  readonly #config: Required<Omit<Auth0JwksAuthnConfig, 'requiredScopes'>> & {
    readonly requiredScopes: readonly string[];
  };
  readonly #jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(config: Auth0JwksAuthnConfig) {
    const issuer = normalizedIssuer(required(config.issuer));
    const timeout = config.jwksTimeoutMilliseconds ?? 3_000;
    const cooldown = config.jwksCooldownMilliseconds ?? 1_000;
    const tolerance = config.clockToleranceSeconds ?? 2;
    if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 30_000) {
      throw new ProductiveAuthnError('AUTHN_CONFIGURATION_MISSING');
    }
    if (!Number.isSafeInteger(tolerance) || tolerance < 0 || tolerance > 5) {
      throw new ProductiveAuthnError('AUTHN_CONFIGURATION_MISSING');
    }
    if (!Number.isSafeInteger(cooldown) || cooldown < 0 || cooldown > 60_000) {
      throw new ProductiveAuthnError('AUTHN_CONFIGURATION_MISSING');
    }
    if (config.requiredScopes.length === 0 || config.requiredScopes.some((scope) => scope.trim() === '')) {
      throw new ProductiveAuthnError('AUTHN_CONFIGURATION_MISSING');
    }
    this.#config = {
      issuer,
      audience: required(config.audience),
      clientId: required(config.clientId),
      jwksUri: config.jwksUri ?? new URL('.well-known/jwks.json', issuer).toString(),
      requiredScopes: [...config.requiredScopes],
      clockToleranceSeconds: tolerance,
      jwksTimeoutMilliseconds: timeout,
      jwksCooldownMilliseconds: cooldown,
    };
    this.#jwks = createRemoteJWKSet(new URL(this.#config.jwksUri), {
      timeoutDuration: timeout,
      cooldownDuration: cooldown,
      cacheMaxAge: 10 * 60 * 1_000,
    });
  }

  async verifyAccessToken(accessToken: string): Promise<VerifiedExternalIdentity> {
    if (accessToken.length === 0 || accessToken.length > 16_384) {
      throw new ProductiveAuthnError('AUTHN_TOKEN_INVALID');
    }
    try {
      const verified = await jwtVerify(accessToken, this.#jwks, {
        issuer: this.#config.issuer,
        audience: this.#config.audience,
        algorithms: ['RS256'],
        clockTolerance: this.#config.clockToleranceSeconds,
        requiredClaims: ['sub', 'exp', 'azp'],
      });
      const { payload, protectedHeader } = verified;
      if (
        protectedHeader.alg !== 'RS256' || typeof payload.sub !== 'string' ||
        payload.sub.length === 0 || payload.sub.length > 256
      ) {
        throw new ProductiveAuthnError('AUTHN_TOKEN_INVALID');
      }
      if (payload.azp !== this.#config.clientId || typeof payload.exp !== 'number') {
        throw new ProductiveAuthnError('AUTHN_POLICY_REJECTED');
      }
      const scopes = typeof payload.scope === 'string'
        ? payload.scope.split(' ').filter((scope) => scope.length > 0)
        : [];
      if (!this.#config.requiredScopes.every((scope) => scopes.includes(scope))) {
        throw new ProductiveAuthnError('AUTHN_POLICY_REJECTED');
      }
      const audience = Array.isArray(payload.aud) ? payload.aud : payload.aud === undefined ? [] : [payload.aud];
      return {
        subject: payload.sub,
        issuer: this.#config.issuer,
        audience,
        clientBinding: this.#config.clientId,
        scopes,
        expiresAtEpochSeconds: payload.exp,
      };
    } catch (error) {
      if (error instanceof ProductiveAuthnError) throw error;
      if (error instanceof errors.JWTExpired) throw new ProductiveAuthnError('AUTHN_TOKEN_EXPIRED');
      if (error instanceof errors.JWKSTimeout || error instanceof TypeError) {
        throw new ProductiveAuthnError('AUTHN_PROVIDER_UNAVAILABLE');
      }
      throw new ProductiveAuthnError('AUTHN_TOKEN_INVALID');
    }
  }
}

export interface SqlQueryResult {
  readonly rows: readonly unknown[];
}

export interface SqlQueryPort {
  query(text: string, values?: readonly unknown[]): Promise<SqlQueryResult>;
}

const property = (value: object, key: string): unknown => Reflect.get(value, key);

/** PostgreSQL authority lookup; all role, participant, seat and permission data is server-derived. */
export class PostgresMembershipAuthorityAdapter implements ProductiveMembershipAuthorityPort {
  constructor(private readonly database: SqlQueryPort) {}

  async resolveMembership(session: ProductiveSession, gameId: string): Promise<AuthoritativeMembership> {
    const result = await this.database.query(
      `SELECT p.id::text participant_id,p.external_user_ref,p.role,
              seat.id::text seat_id,country.logical_id country_id
         FROM malign.game_participants p
         JOIN malign.game_sessions game_session ON game_session.game_id=p.game_id
         JOIN malign.game_memberships membership
           ON membership.game_session_id=game_session.id AND membership.participant_id=p.id
         LEFT JOIN malign.player_seats seat ON seat.game_id=p.game_id AND seat.participant_id=p.id
         LEFT JOIN malign.country_definitions country ON country.id=seat.country_definition_id
        WHERE p.game_id=$1::uuid AND p.external_user_ref=$2 AND p.status='ACTIVE'
          AND game_session.state<>'CLOSED'`,
      [gameId, session.identity.subject],
    );
    if (result.rows.length !== 1) throw new ProductiveAuthnError('AUTHZ_MEMBERSHIP_REJECTED');
    const row = result.rows[0];
    if (typeof row !== 'object' || row === null) throw new ProductiveAuthnError('AUTHZ_MEMBERSHIP_REJECTED');
    const participantId = property(row, 'participant_id');
    const externalUserRef = property(row, 'external_user_ref');
    const role = property(row, 'role');
    const seatId = property(row, 'seat_id');
    const countryId = property(row, 'country_id');
    if (
      typeof participantId !== 'string' || externalUserRef !== session.identity.subject ||
      (role !== 'PLAYER' && role !== 'FACILITATOR')
    ) throw new ProductiveAuthnError('AUTHZ_MEMBERSHIP_REJECTED');
    const permissions = role === 'FACILITATOR'
      ? ['game:facilitate', 'game:project']
      : ['game:play', 'game:project'];
    return {
      authenticatedSessionId: session.sessionId,
      externalSubject: session.identity.subject,
      gameId,
      participantId,
      actorContext: {
        actorId: session.identity.subject,
        actorType: role,
        participantId,
        authenticatedSessionId: session.sessionId,
        permissions,
        ...(typeof seatId === 'string' ? { playerSeatId: seatId } : {}),
        ...(typeof countryId === 'string' ? { countryId } : {}),
      },
    };
  }
}
