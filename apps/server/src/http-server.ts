import { createServer, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from 'node:http';

import {
  ProductiveAuthnError,
  ProductiveSessionRegistry,
  externalIdentityDigest,
  type ProductiveAuthnPort,
  type ProductiveMembershipAuthorityPort,
} from '@malign-ai/authz';
import {
  HttpCommandRequestSchema,
  HttpFeedRequestSchema,
  HttpProjectionRequestSchema,
  type HealthResponse,
} from '@malign-ai/contracts';
import {
  isSetupCommandPayload,
  type SetupCommandType,
} from '@malign-ai/game-engine';
import type {
  GameSessionApplicationPort,
  SessionCommandInput,
  SessionM1InteractionInput,
} from './game-session-application.js';
import type { ProductiveRealtimeServer } from './realtime-server.js';

export class ProductiveTransportError extends Error {
  override readonly name = 'ProductiveTransportError';
  constructor(readonly code: 'COMMAND_NOT_AVAILABLE_ON_PRODUCTIVE_TRANSPORT') {
    super('Command is not available on the productive transport');
  }
}

export interface DistributedSessionInvalidationPort {
  invalidate(identity: { readonly issuer: string; readonly subject: string }): Promise<void>;
}

export interface AuthoritativeHttpServerOptions {
  readonly application: GameSessionApplicationPort;
  readonly authn: ProductiveAuthnPort;
  readonly memberships: ProductiveMembershipAuthorityPort;
  readonly sessions: ProductiveSessionRegistry;
  readonly realtime: ProductiveRealtimeServer;
  readonly maximumBodyBytes?: number;
  readonly readiness?: () => Promise<boolean>;
  readonly distributedSessionInvalidation?: DistributedSessionInvalidationPort;
  readonly serverFactory?: (listener: RequestListener) => Server;
}

const sendJson = (response: ServerResponse, status: number, payload: unknown): void => {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
};

const rejectOpaque = (response: ServerResponse, status = 403): void =>
  sendJson(response, status, { error: { code: 'REQUEST_REJECTED' } });

const rejectUnavailableCommand = (response: ServerResponse): void =>
  sendJson(response, 400, { error: { code: 'COMMAND_NOT_AVAILABLE_ON_PRODUCTIVE_TRANSPORT' } });

const bearerToken = (request: IncomingMessage): string | undefined => {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return undefined;
  const token = header.slice('Bearer '.length);
  return token.length > 0 && token.length <= 16_384 ? token : undefined;
};

const readJson = async (request: IncomingMessage, maximumBytes: number): Promise<unknown> => {
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') throw new Error('INVALID_CONTENT_TYPE');
  return new Promise<unknown>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    request.on('data', (chunk: unknown) => {
      if (typeof chunk !== 'string' && !(chunk instanceof Uint8Array)) {
        reject(new Error('INVALID_PAYLOAD'));
        return;
      }
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      total += bytes.byteLength;
      if (total > maximumBytes) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        request.destroy();
        return;
      }
      chunks.push(bytes);
    });
    request.on('end', () => {
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(parsed);
      } catch (error) { reject(error instanceof Error ? error : new Error('INVALID_JSON')); }
    });
    request.on('error', (error: unknown) => reject(error instanceof Error ? error : new Error('REQUEST_STREAM_FAILED')));
  });
};

const setupCommandTypes = new Set<SetupCommandType>([
  'ASSIGN_PLAYER_SEAT', 'CONFIGURE_GAME_OPTION', 'START_GAME',
  'PAUSE_GAME', 'RESUME_GAME', 'SUBMIT_OPERATIONS_DECK', 'LOCK_STRATEGY',
  'REQUEST_INITIATIVE_ROLL', 'SET_INITIATIVE_MAINTENANCE', 'LOCK_INITIATIVE_MAINTENANCE',
  'SET_ACTION_PLAN', 'LOCK_ACTION_PLAN', 'CONSTRUCT_CAMPAIGN', 'END_GAME_SCORING',
  'PASS_REACTION', 'PLAY_REACTION', 'SUBMIT_VETO_DEFENSE', 'CAST_VETO_VOTE', 'SUBMIT_M2_EFFECT_CHOICE',
  'RESOLVE_VETO_ABUSE',
]);

export const createAuthoritativeHttpServer = (options: AuthoritativeHttpServerOptions): Server => {
  const maximumBodyBytes = options.maximumBodyBytes ?? 65_536;
  const handleRequest = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method === 'GET' && request.url === '/health') {
      const body: HealthResponse = { status: 'ok' };
      sendJson(response, 200, body);
      return;
    }
    if (request.method === 'GET' && request.url === '/ready') {
      const ready = await (options.readiness?.() ?? Promise.resolve(true)).catch(() => false);
      sendJson(response, ready ? 200 : 503, { status: ready ? 'ready' : 'unavailable' });
      return;
    }
    if (request.method !== 'POST' || !['/v1/commands', '/v1/projection', '/v1/feed', '/v1/session/invalidate'].includes(request.url ?? '')) {
      rejectOpaque(response, 404);
      return;
    }
    const accessToken = bearerToken(request);
    if (accessToken === undefined) { rejectOpaque(response, 401); return; }
    let sessionId: string | undefined;
    try {
      const identity = await options.authn.verifyAccessToken(accessToken);
      const session = options.sessions.create(identity);
      sessionId = session.sessionId;
      if (request.url === '/v1/session/invalidate') {
        options.sessions.invalidateExternalIdentityDigest(externalIdentityDigest(identity.issuer, identity.subject));
        await options.distributedSessionInvalidation?.invalidate(identity);
        response.writeHead(204, { 'cache-control': 'no-store' });
        response.end();
        return;
      }
      const raw = await readJson(request, maximumBodyBytes);
      if (request.url === '/v1/projection') {
        const input = HttpProjectionRequestSchema.parse(raw);
        const membership = await options.memberships.resolveMembership(session, input.gameId);
        const result = await options.application.getM1InitialSyncForActor(membership.actorContext, input.gameId);
        if (!result.ok) { rejectOpaque(response); return; }
        sendJson(response, 200, result.value);
        return;
      }
      if (request.url === '/v1/feed') {
        const input = HttpFeedRequestSchema.parse(raw);
        const membership = await options.memberships.resolveMembership(session, input.gameId);
        const result = await options.application.getM1EventFeedForActor(membership.actorContext, input.gameId, input.afterCursor);
        if (!result.ok) { rejectOpaque(response); return; }
        sendJson(response, 200, result.value);
        return;
      }
      if (typeof raw === 'object' && raw !== null &&
          (Reflect.get(raw, 'commandType') === 'CREATE_GAME' || Reflect.get(raw, 'commandType') === 'JOIN_GAME_MEMBERSHIP')) {
        throw new ProductiveTransportError('COMMAND_NOT_AVAILABLE_ON_PRODUCTIVE_TRANSPORT');
      }
      const input = HttpCommandRequestSchema.parse(raw);
      const membership = await options.memberships.resolveMembership(session, input.gameId);
      if (input.commandType === 'SUBMIT_CHOICE' || input.commandType === 'SUBMIT_CAMPAIGN_NARRATIVE' || input.commandType === 'SUBMIT_COALITION_CONTRIBUTION') {
        const command: SessionM1InteractionInput = {
          engineContractVersion: input.engineContractVersion,
          commandId: input.commandId,
          idempotencyKey: input.idempotencyKey,
          gameId: input.gameId,
          expectedGameVersion: input.expectedGameVersion,
          commandType: input.commandType,
          payloadSchemaVersion: input.payloadSchemaVersion,
          payload: input.payload,
          ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
          ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        };
        const result = await options.application.executeM1InteractionForActor(membership.actorContext, command);
        sendJson(response, result.status === 'REJECTED' ? 409 : 200, result);
        return;
      }
      if (!setupCommandTypes.has(input.commandType)) { rejectOpaque(response, 400); return; }
      const commandType = input.commandType;
      if (!isSetupCommandPayload(commandType, input.payload)) { rejectOpaque(response, 400); return; }
      const command: SessionCommandInput = {
        engineContractVersion: input.engineContractVersion,
        commandId: input.commandId,
        idempotencyKey: input.idempotencyKey,
        gameId: input.gameId,
        expectedGameVersion: input.expectedGameVersion,
        commandType,
        payloadSchemaVersion: input.payloadSchemaVersion,
        payload: input.payload,
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
      };
      const result = await options.application.executeForActor(membership.actorContext, command);
      sendJson(response, result.status === 'REJECTED' ? 409 : 200, result);
    } catch (error) {
      if (error instanceof ProductiveTransportError) rejectUnavailableCommand(response);
      else rejectOpaque(response, error instanceof ProductiveAuthnError ? 403 : 400);
    } finally {
      if (sessionId !== undefined) options.sessions.invalidate(sessionId);
    }
  };
  const server = (options.serverFactory ?? createServer)((request, response) => {
    void handleRequest(request, response).catch(() => rejectOpaque(response, 500));
  });
  options.realtime.attach(server);
  return server;
};
