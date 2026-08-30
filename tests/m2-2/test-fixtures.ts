import { createServer, type Server } from 'node:http';
import { once } from 'node:events';

import {
  ProductiveAuthnError,
  ProductiveSessionRegistry,
  type AuthoritativeMembership,
  type ProductiveAuthnPort,
  type ProductiveMembershipAuthorityPort,
  type ProductiveSession,
  type VerifiedExternalIdentity,
} from '../../packages/authz/src/index.js';
import {
  MALIGN_REALTIME_PROTOCOL,
  MALIGN_REALTIME_SCHEMA_VERSION,
  type RealtimeCursorV1,
} from '../../packages/contracts/src/index.js';
import type { ActorContext } from '../../packages/contracts/src/index.js';
import {
  InMemoryRealtimeMetrics,
  ProductiveRealtimeServer,
  defaultRealtimeOperationalConfig,
  type RealtimeLogEntry,
  type RealtimeLoggerPort,
} from '../../apps/server/src/realtime-server.js';
import type { GameSessionApplicationPort } from '../../apps/server/src/game-session-application.js';
import { WebSocket, type RawData } from 'ws';

export const TEST_ORIGIN = 'https://malign.test';

export class CapturingLogger implements RealtimeLoggerPort {
  readonly entries: RealtimeLogEntry[] = [];
  write(entry: RealtimeLogEntry): void { this.entries.push(structuredClone(entry)); }
}

export class TestAuthnPort implements ProductiveAuthnPort {
  constructor(private readonly expiresAtEpochSeconds = Math.floor(Date.now() / 1_000) + 300) {}

  verifyAccessToken(accessToken: string): Promise<VerifiedExternalIdentity> {
    const match = /^valid-(P[1-5]|F1)$/.exec(accessToken);
    if (match?.[1] === undefined) return Promise.reject(new ProductiveAuthnError('AUTHN_TOKEN_INVALID'));
    return Promise.resolve({
      subject: `user-${match[1].toLowerCase()}`,
      issuer: 'https://issuer.test/',
      audience: ['malign-api'],
      clientBinding: 'malign-client',
      scopes: ['malign:connect'],
      expiresAtEpochSeconds: this.expiresAtEpochSeconds,
    });
  }
}

export class TestMembershipAuthority implements ProductiveMembershipAuthorityPort {
  readonly rejectedGames = new Set<string>();

  resolveMembership(session: ProductiveSession, gameId: string): Promise<AuthoritativeMembership> {
    if (this.rejectedGames.has(gameId)) return Promise.reject(new ProductiveAuthnError('AUTHZ_MEMBERSHIP_REJECTED'));
    const suffix = /^user-(p[1-5]|f1)$/.exec(session.identity.subject)?.[1];
    if (suffix === undefined) return Promise.reject(new ProductiveAuthnError('AUTHZ_MEMBERSHIP_REJECTED'));
    const participantId = suffix.toUpperCase();
    const actorType = participantId === 'F1' ? 'FACILITATOR' as const : 'PLAYER' as const;
    const actorContext: ActorContext = {
      actorId: session.identity.subject,
      actorType,
      participantId,
      authenticatedSessionId: session.sessionId,
      permissions: actorType === 'FACILITATOR' ? ['game:facilitate', 'game:project'] : ['game:play', 'game:project'],
    };
    return Promise.resolve({
      authenticatedSessionId: session.sessionId,
      externalSubject: session.identity.subject,
      gameId,
      participantId,
      actorContext,
    });
  }
}

export interface RunningRealtimeNode {
  readonly server: Server;
  readonly realtime: ProductiveRealtimeServer;
  readonly url: string;
  readonly sessions: ProductiveSessionRegistry;
  readonly metrics: InMemoryRealtimeMetrics;
  readonly logger: CapturingLogger;
  close(): Promise<void>;
}

export const startRealtimeNode = async (
  application: GameSessionApplicationPort,
  options: {
    readonly nodeId?: string;
    readonly authn?: ProductiveAuthnPort;
    readonly memberships?: ProductiveMembershipAuthorityPort;
    readonly configure?: Partial<ReturnType<typeof defaultRealtimeOperationalConfig>>;
  } = {},
): Promise<RunningRealtimeNode> => {
  const sessions = new ProductiveSessionRegistry();
  const metrics = new InMemoryRealtimeMetrics();
  const logger = new CapturingLogger();
  const config = {
    ...defaultRealtimeOperationalConfig([TEST_ORIGIN], false),
    heartbeatMilliseconds: 50,
    shutdownGraceMilliseconds: 100,
    ...options.configure,
  };
  const realtime = new ProductiveRealtimeServer(
    options.nodeId ?? 'test-node',
    application,
    options.authn ?? new TestAuthnPort(),
    options.memberships ?? new TestMembershipAuthority(),
    sessions,
    metrics,
    logger,
    config,
  );
  const server = createServer();
  realtime.attach(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Ephemeral server address unavailable');
  return {
    server,
    realtime,
    url: `ws://127.0.0.1:${String(address.port)}`,
    sessions,
    metrics,
    logger,
    async close() {
      await realtime.shutdown();
      await Promise.race([
        new Promise<void>((resolve) => server.close(() => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 100)),
      ]);
      server.closeAllConnections();
    },
  };
};

export const connect = async (url: string, origin = TEST_ORIGIN): Promise<WebSocket> => {
  const socket = new WebSocket(url, MALIGN_REALTIME_PROTOCOL, { origin });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return socket;
};

let messageCounter = 0;
export const clientFrame = (type: string, fields: Readonly<Record<string, unknown>> = {}): string => {
  messageCounter += 1;
  return JSON.stringify({
    protocolVersion: MALIGN_REALTIME_PROTOCOL,
    schemaVersion: MALIGN_REALTIME_SCHEMA_VERSION,
    messageId: `client-message-${String(messageCounter)}`,
    correlationId: `correlation-${String(messageCounter)}`,
    type,
    ...fields,
  });
};

export const nextMessage = async (socket: WebSocket): Promise<Readonly<Record<string, unknown>>> => {
  const timeout = setTimeout(() => socket.terminate(), 2_000);
  try {
    const data = await new Promise<RawData>((resolve, reject) => {
      socket.once('message', resolve);
      socket.once('error', reject);
      socket.once('close', (code) => reject(new Error(`Socket closed before message (${String(code)})`)));
    });
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : Array.isArray(data) ? Buffer.concat(data) : data;
    const parsed: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) throw new Error('Expected object frame');
    return parsed as Readonly<Record<string, unknown>>;
  } finally { clearTimeout(timeout); }
};

export const authenticate = async (socket: WebSocket, participantId = 'P1'): Promise<void> => {
  const response = nextMessage(socket);
  socket.send(clientFrame('AUTHENTICATE', { payload: { accessToken: `valid-${participantId}` } }));
  const frame = await response;
  if (frame.type !== 'AUTHENTICATED') throw new Error('Authentication failed');
};

export const subscribe = async (
  socket: WebSocket,
  gameId: string,
  afterCursor?: RealtimeCursorV1,
): Promise<{ readonly subscriptionId: string; readonly cursor: RealtimeCursorV1 }> => {
  const response = nextMessage(socket);
  socket.send(clientFrame('SUBSCRIBE', {
    gameId,
    payload: { ...(afterCursor === undefined ? {} : { afterCursor }) },
  }));
  const sync = await response;
  if (sync.type !== 'SYNC' || typeof sync.subscriptionId !== 'string') throw new Error('Sync failed');
  const payload = sync.payload;
  if (typeof payload !== 'object' || payload === null) throw new Error('Sync payload missing');
  const cursor: unknown = Reflect.get(payload, 'cursor');
  if (typeof cursor !== 'object' || cursor === null) throw new Error('Sync cursor missing');
  return { subscriptionId: sync.subscriptionId, cursor: cursor as RealtimeCursorV1 };
};
