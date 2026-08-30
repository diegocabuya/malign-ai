import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';

import {
  ProductiveAuthnError,
  ProductiveSessionRegistry,
  type AuthoritativeMembership,
  type ProductiveAuthnPort,
  type ProductiveMembershipAuthorityPort,
  type ProductiveSession,
} from '@malign-ai/authz';
import {
  MALIGN_REALTIME_PROTOCOL,
  MALIGN_REALTIME_SCHEMA_VERSION,
  RealtimeClientFrameSchema,
  type RealtimeClientFrame,
  type RealtimeCursorV1,
  type RealtimeServerFrame,
  type RealtimeServerFrameType,
} from '@malign-ai/contracts';
import type { M1AuthorizedEventFeed } from './m1-realtime.js';
import type { GameSessionApplicationPort } from './game-session-application.js';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

export interface RealtimeOperationalConfig {
  readonly allowedOrigins: readonly string[];
  readonly requireTls: boolean;
  readonly authenticationTimeoutMilliseconds: number;
  readonly heartbeatMilliseconds: number;
  readonly maximumMissedPongs: number;
  readonly maximumPayloadBytes: number;
  readonly maximumPendingMessages: number;
  readonly maximumBufferedBytes: number;
  readonly maximumConnectionsPerSession: number;
  readonly maximumSubscriptionsPerConnection: number;
  readonly maximumHandshakesPerMinute: number;
  readonly feedBatchSize: number;
  readonly shutdownGraceMilliseconds: number;
}

export const defaultRealtimeOperationalConfig = (
  allowedOrigins: readonly string[],
  requireTls = process.env.NODE_ENV === 'production',
): RealtimeOperationalConfig => ({
  allowedOrigins: [...allowedOrigins],
  requireTls,
  authenticationTimeoutMilliseconds: 5_000,
  heartbeatMilliseconds: 30_000,
  maximumMissedPongs: 2,
  maximumPayloadBytes: 65_536,
  maximumPendingMessages: 256,
  maximumBufferedBytes: 1_048_576,
  maximumConnectionsPerSession: 4,
  maximumSubscriptionsPerConnection: 8,
  maximumHandshakesPerMinute: 30,
  feedBatchSize: 100,
  shutdownGraceMilliseconds: 10_000,
});

export type RealtimeMetricName =
  | 'connections.active'
  | 'connections.authenticated'
  | 'handshake.rejects'
  | 'authn.rejects'
  | 'authz.rejects'
  | 'token.expirations'
  | 'reconnects'
  | 'subscriptions.active'
  | 'gaps.detected'
  | 'gaps.recovered'
  | 'catchup.size'
  | 'buffered.bytes'
  | 'buffered.messages'
  | 'projection.failures'
  | 'close.1008'
  | 'close.1009'
  | 'close.1012'
  | 'close.1013'
  | 'sync.latency_ms'
  | 'reconnect.latency_ms';

export interface RealtimeMetricsPort {
  add(name: RealtimeMetricName, delta?: number): void;
  observe(name: RealtimeMetricName, value: number): void;
}

export class InMemoryRealtimeMetrics implements RealtimeMetricsPort {
  readonly #values = new Map<RealtimeMetricName, number>();

  add(name: RealtimeMetricName, delta = 1): void {
    this.#values.set(name, (this.#values.get(name) ?? 0) + delta);
  }

  observe(name: RealtimeMetricName, value: number): void {
    this.#values.set(name, value);
  }

  snapshot(): Readonly<Record<string, number>> {
    return Object.fromEntries(this.#values);
  }
}

export interface RealtimeLogEntry {
  readonly level: 'INFO' | 'WARN' | 'ERROR';
  readonly correlationId: string;
  readonly messageType: string;
  readonly resultCode: string;
  readonly durationMilliseconds: number;
  readonly nodeId: string;
}

export interface RealtimeLoggerPort {
  write(entry: RealtimeLogEntry): void;
}

export class JsonLineRealtimeLogger implements RealtimeLoggerPort {
  write(entry: RealtimeLogEntry): void {
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  }
}

interface ProductiveSubscription {
  readonly subscriptionId: string;
  readonly gameId: string;
  readonly membership: AuthoritativeMembership;
  active: boolean;
  lastIssuedCursor: RealtimeCursorV1;
  lastAcknowledgedCursor: RealtimeCursorV1;
}

interface ConnectionState {
  readonly connectionId: string;
  readonly socket: WebSocket;
  readonly openedAt: number;
  session?: ProductiveSession;
  authenticationTimer?: NodeJS.Timeout;
  expirationTimer?: NodeJS.Timeout;
  missedPongs: number;
  pongObserved: boolean;
  pendingMessages: number;
  readonly subscriptions: Map<string, ProductiveSubscription>;
  tail: Promise<void>;
}

const sameCursorScope = (left: RealtimeCursorV1, right: RealtimeCursorV1): boolean =>
  left.gameId === right.gameId &&
  left.viewerParticipantId === right.viewerParticipantId &&
  left.viewerRole === right.viewerRole &&
  left.projectionId === right.projectionId;

const cursorAtOrBefore = (left: RealtimeCursorV1, right: RealtimeCursorV1): boolean =>
  left.lastSequenceNumber < right.lastSequenceNumber ||
  (left.lastSequenceNumber === right.lastSequenceNumber && left.gameVersion <= right.gameVersion);

const sameCursorPosition = (left: RealtimeCursorV1, right: RealtimeCursorV1): boolean =>
  sameCursorScope(left, right) &&
  left.lastSequenceNumber === right.lastSequenceNumber &&
  left.gameVersion === right.gameVersion;

const rawDataLength = (data: RawData): number => {
  if (typeof data === 'string') return Buffer.byteLength(data);
  if (Array.isArray(data)) return data.reduce((total, value) => total + value.byteLength, 0);
  return data.byteLength;
};

const rawDataText = (data: RawData): string => {
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data)).toString('utf8');
  return Buffer.from(data).toString('utf8');
};

const isTlsRequest = (request: IncomingMessage): boolean => Reflect.get(request.socket, 'encrypted') === true;

export class ProductiveRealtimeServer {
  readonly #webSockets: WebSocketServer;
  readonly #connections = new Map<string, ConnectionState>();
  readonly #handshakesByAddress = new Map<string, number[]>();
  readonly #unsubscribeSessionInvalidation: () => void;
  #heartbeat?: NodeJS.Timeout;
  #draining = false;

  constructor(
    private readonly nodeId: string,
    private readonly application: GameSessionApplicationPort,
    private readonly authn: ProductiveAuthnPort,
    private readonly memberships: ProductiveMembershipAuthorityPort,
    private readonly sessions: ProductiveSessionRegistry,
    private readonly metrics: RealtimeMetricsPort,
    private readonly logger: RealtimeLoggerPort,
    private readonly config: RealtimeOperationalConfig,
    private readonly now: () => number = Date.now,
  ) {
    this.#webSockets = new WebSocketServer({
      noServer: true,
      clientTracking: false,
      perMessageDeflate: false,
      maxPayload: config.maximumPayloadBytes,
      handleProtocols: (protocols) => protocols.size === 1 && protocols.has(MALIGN_REALTIME_PROTOCOL)
        ? MALIGN_REALTIME_PROTOCOL
        : false,
    });
    this.#unsubscribeSessionInvalidation = sessions.onInvalidated((sessionId) => {
      for (const connection of this.#connections.values()) {
        if (connection.session?.sessionId === sessionId) this.close(connection, 1008);
      }
    });
  }

  attach(server: HttpServer): void {
    server.on('upgrade', this.handleUpgrade);
    this.#heartbeat = setInterval(() => this.heartbeat(), this.config.heartbeatMilliseconds);
    this.#heartbeat.unref();
  }

  readonly handleUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : '';
    const protocols = typeof request.headers['sec-websocket-protocol'] === 'string'
      ? request.headers['sec-websocket-protocol'].split(',').map((item) => item.trim())
      : [];
    const address = request.socket.remoteAddress ?? 'unknown';
    const now = this.now();
    const attempts = (this.#handshakesByAddress.get(address) ?? []).filter((at) => at > now - 60_000);
    attempts.push(now);
    this.#handshakesByAddress.set(address, attempts);
    const requestUrl = new URL(request.url ?? '/', 'http://local.invalid');
    const tokenInUrl = [...requestUrl.searchParams.keys()].some((key) => /token|credential|session/i.test(key));
    const rejected = this.#draining ||
      !this.config.allowedOrigins.includes(origin) ||
      protocols.length !== 1 || protocols[0] !== MALIGN_REALTIME_PROTOCOL ||
      (this.config.requireTls && !isTlsRequest(request)) || tokenInUrl ||
      attempts.length > this.config.maximumHandshakesPerMinute;
    if (rejected) {
      this.metrics.add('handshake.rejects');
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    this.#webSockets.handleUpgrade(request, socket, head, (webSocket) => this.open(webSocket));
  };

  async wakeGame(gameId: string): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const connection of this.#connections.values()) {
      for (const subscription of connection.subscriptions.values()) {
        if (subscription.gameId === gameId && subscription.active) {
          tasks.push(this.deliverCatchup(connection, subscription, subscription.lastIssuedCursor, 'EVENT_BATCH'));
        }
      }
    }
    await Promise.allSettled(tasks);
  }

  async wakeAll(): Promise<void> {
    const gameIds = new Set<string>();
    for (const connection of this.#connections.values()) {
      for (const subscription of connection.subscriptions.values()) {
        if (subscription.active) gameIds.add(subscription.gameId);
      }
    }
    await Promise.allSettled([...gameIds].map((gameId) => this.wakeGame(gameId)));
  }

  async shutdown(): Promise<void> {
    this.#draining = true;
    if (this.#heartbeat !== undefined) clearInterval(this.#heartbeat);
    const connections = [...this.#connections.values()];
    for (const connection of connections) {
      this.send(connection, 'DRAINING', randomUUID(), { retry: true });
    }
    await Promise.allSettled(connections.map((connection) => connection.tail));
    const closed = connections.map(({ socket }) => socket.readyState === WebSocket.CLOSED
      ? Promise.resolve()
      : new Promise<void>((resolve) => socket.once('close', () => resolve())));
    for (const connection of connections) {
      this.close(connection, 1012);
    }
    await Promise.race([
      Promise.all(closed),
      new Promise<void>((resolve) => setTimeout(resolve, this.config.shutdownGraceMilliseconds)),
    ]);
    for (const { socket } of connections) {
      if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
    }
    this.#unsubscribeSessionInvalidation();
    this.#webSockets.close();
  }

  connectionCount(): number { return this.#connections.size; }

  private open(socket: WebSocket): void {
    const connection: ConnectionState = {
      connectionId: randomUUID(),
      socket,
      openedAt: this.now(),
      missedPongs: 0,
      pongObserved: true,
      pendingMessages: 0,
      subscriptions: new Map(),
      tail: Promise.resolve(),
    };
    this.#connections.set(connection.connectionId, connection);
    this.metrics.add('connections.active');
    connection.authenticationTimer = setTimeout(
      () => this.rejectPolicy(connection, 'AUTHENTICATION_TIMEOUT'),
      this.config.authenticationTimeoutMilliseconds,
    );
    socket.on('pong', () => { connection.pongObserved = true; connection.missedPongs = 0; });
    socket.on('message', (data, isBinary) => {
      connection.tail = connection.tail
        .then(() => this.handleMessage(connection, data, isBinary))
        .catch(() => this.rejectPolicy(connection, 'MESSAGE_PROCESSING_FAILED'));
    });
    socket.on('error', () => this.cleanup(connection));
    socket.on('close', () => this.cleanup(connection));
  }

  private async handleMessage(connection: ConnectionState, data: RawData, isBinary: boolean): Promise<void> {
    if (isBinary || rawDataLength(data) > this.config.maximumPayloadBytes) {
      this.close(connection, 1009);
      return;
    }
    let frame: RealtimeClientFrame;
    try {
      const parsed: unknown = JSON.parse(rawDataText(data));
      frame = RealtimeClientFrameSchema.parse(parsed);
    } catch {
      this.rejectPolicy(connection, 'INVALID_FRAME');
      return;
    }
    const started = this.now();
    try {
      if (connection.session === undefined && frame.type !== 'AUTHENTICATE') {
        this.rejectPolicy(connection, 'AUTHENTICATION_REQUIRED');
        return;
      }
      switch (frame.type) {
        case 'AUTHENTICATE': await this.authenticate(connection, frame); break;
        case 'SUBSCRIBE': await this.subscribe(connection, frame); break;
        case 'ACK': this.acknowledge(connection, frame); break;
        case 'RESYNC_REQUEST': await this.resync(connection, frame); break;
        case 'UNSUBSCRIBE': this.unsubscribe(connection, frame.subscriptionId, frame.gameId); break;
      }
      this.log('INFO', frame.correlationId, frame.type, 'OK', started);
    } catch (error) {
      const authnFailure = error instanceof ProductiveAuthnError;
      this.metrics.add(authnFailure ? 'authn.rejects' : 'authz.rejects');
      this.log('WARN', frame.correlationId, frame.type, 'POLICY_REJECTED', started);
      this.rejectPolicy(connection, 'POLICY_REJECTED');
    }
  }

  private async authenticate(
    connection: ConnectionState,
    frame: Extract<RealtimeClientFrame, { readonly type: 'AUTHENTICATE' }>,
  ): Promise<void> {
    if (connection.session !== undefined) throw new ProductiveAuthnError('AUTHN_POLICY_REJECTED');
    const identity = await this.authn.verifyAccessToken(frame.payload.accessToken);
    const activeForSubject = [...this.#connections.values()]
      .filter((candidate) => candidate.session?.identity.subject === identity.subject).length;
    if (activeForSubject >= this.config.maximumConnectionsPerSession) {
      throw new ProductiveAuthnError('AUTHN_POLICY_REJECTED');
    }
    connection.session = this.sessions.create(identity, this.now());
    if (connection.authenticationTimer !== undefined) clearTimeout(connection.authenticationTimer);
    this.scheduleExpiration(connection);
    this.metrics.add('connections.authenticated');
    this.send(connection, 'AUTHENTICATED', frame.correlationId, {
      sessionId: connection.session.sessionId,
      expiresAtEpochSeconds: identity.expiresAtEpochSeconds,
    });
  }

  private async subscribe(
    connection: ConnectionState,
    frame: Extract<RealtimeClientFrame, { readonly type: 'SUBSCRIBE' }>,
  ): Promise<void> {
    if (connection.subscriptions.size >= this.config.maximumSubscriptionsPerConnection) {
      throw new ProductiveAuthnError('AUTHN_POLICY_REJECTED');
    }
    const session = this.requireSession(connection);
    const membership = await this.memberships.resolveMembership(session, frame.gameId);
    const initial = await this.application.getM1InitialSyncForActor(membership.actorContext, frame.gameId);
    if (!initial.ok) throw new ProductiveAuthnError('AUTHZ_MEMBERSHIP_REJECTED');
    const subscriptionId = randomUUID();
    const startCursor = frame.payload.afterCursor ?? initial.value.cursor;
    if (!sameCursorScope(startCursor, initial.value.cursor) || !cursorAtOrBefore(startCursor, initial.value.cursor)) {
      throw new ProductiveAuthnError('AUTHN_POLICY_REJECTED');
    }
    const subscription: ProductiveSubscription = {
      subscriptionId,
      gameId: frame.gameId,
      membership,
      active: false,
      lastIssuedCursor: structuredClone(startCursor),
      lastAcknowledgedCursor: structuredClone(startCursor),
    };
    connection.subscriptions.set(subscriptionId, subscription);
    this.metrics.add('subscriptions.active');
    if (frame.payload.afterCursor !== undefined) this.metrics.add('reconnects');
    const started = this.now();
    this.send(connection, 'SYNC', frame.correlationId, {
      subscriptionId,
      projection: initial.value.projection,
      cursor: initial.value.cursor,
    }, frame.gameId, subscriptionId);
    subscription.active = true;
    await this.deliverCatchup(connection, subscription, startCursor, 'EVENT_BATCH', frame.correlationId);
    this.metrics.observe('sync.latency_ms', this.now() - started);
  }

  private acknowledge(
    connection: ConnectionState,
    frame: Extract<RealtimeClientFrame, { readonly type: 'ACK' }>,
  ): void {
    const subscription = this.ownedSubscription(connection, frame.subscriptionId, frame.gameId);
    const cursor = frame.payload.cursor;
    if (!sameCursorScope(cursor, subscription.lastIssuedCursor) || !cursorAtOrBefore(cursor, subscription.lastIssuedCursor)) {
      throw new ProductiveAuthnError('AUTHN_POLICY_REJECTED');
    }
    if (cursorAtOrBefore(cursor, subscription.lastAcknowledgedCursor)) return;
    if (!sameCursorPosition(cursor, subscription.lastIssuedCursor)) {
      throw new ProductiveAuthnError('AUTHN_POLICY_REJECTED');
    }
    subscription.lastAcknowledgedCursor = structuredClone(cursor);
  }

  private async resync(
    connection: ConnectionState,
    frame: Extract<RealtimeClientFrame, { readonly type: 'RESYNC_REQUEST' }>,
  ): Promise<void> {
    const subscription = this.ownedSubscription(connection, frame.subscriptionId, frame.gameId);
    if (!sameCursorScope(frame.payload.afterCursor, subscription.lastIssuedCursor)) {
      throw new ProductiveAuthnError('AUTHN_POLICY_REJECTED');
    }
    this.metrics.add('gaps.detected');
    this.send(connection, 'GAP_DETECTED', frame.correlationId, {
      afterCursor: frame.payload.afterCursor,
      recovery: 'AUTHORIZED_FEED',
    }, subscription.gameId, subscription.subscriptionId);
    await this.deliverCatchup(connection, subscription, frame.payload.afterCursor, 'EVENT_BATCH', frame.correlationId);
    this.metrics.add('gaps.recovered');
  }

  private unsubscribe(connection: ConnectionState, subscriptionId: string, gameId: string): void {
    this.ownedSubscription(connection, subscriptionId, gameId);
    connection.subscriptions.delete(subscriptionId);
    this.metrics.add('subscriptions.active', -1);
  }

  private async deliverCatchup(
    connection: ConnectionState,
    subscription: ProductiveSubscription,
    fromCursor: RealtimeCursorV1,
    frameType: 'EVENT_BATCH',
    correlationId: string = randomUUID(),
  ): Promise<void> {
    const session = this.requireSession(connection);
    const membership = await this.memberships.resolveMembership(session, subscription.gameId);
    if (membership.participantId !== subscription.membership.participantId) {
      throw new ProductiveAuthnError('AUTHZ_MEMBERSHIP_REJECTED');
    }
    const feed = await this.application.getM1EventFeedForActor(
      membership.actorContext,
      subscription.gameId,
      fromCursor,
    );
    if (!feed.ok) throw new ProductiveAuthnError('AUTHZ_MEMBERSHIP_REJECTED');
    this.sendFeed(connection, subscription, feed.value, frameType, correlationId);
  }

  private sendFeed(
    connection: ConnectionState,
    subscription: ProductiveSubscription,
    feed: M1AuthorizedEventFeed,
    frameType: 'EVENT_BATCH',
    correlationId: string,
  ): void {
    const batches: typeof feed.events[] = [];
    for (let index = 0; index < feed.events.length; index += this.config.feedBatchSize) {
      batches.push(feed.events.slice(index, index + this.config.feedBatchSize));
    }
    if (batches.length === 0 && cursorAtOrBefore(feed.cursor, subscription.lastIssuedCursor)) return;
    const effectiveBatches = batches.length === 0 ? [[]] : batches;
    let batchStart = structuredClone(feed.fromCursor);
    effectiveBatches.forEach((events, index) => {
      const lastEvent = events.at(-1);
      const batchCursor = index === effectiveBatches.length - 1 || lastEvent === undefined
        ? feed.cursor
        : {
            ...feed.cursor,
            gameVersion: lastEvent.gameVersion,
            lastSequenceNumber: lastEvent.sequenceNumber,
          };
      this.send(connection, frameType, correlationId, {
        fromCursor: batchStart,
        cursor: batchCursor,
        events,
        projection: feed.projection,
        delivery: 'AT_LEAST_ONCE',
      }, subscription.gameId, subscription.subscriptionId);
      batchStart = structuredClone(batchCursor);
    });
    subscription.lastIssuedCursor = structuredClone(feed.cursor);
    this.metrics.observe('catchup.size', feed.events.length);
  }

  private ownedSubscription(connection: ConnectionState, subscriptionId: string, gameId: string): ProductiveSubscription {
    const subscription = connection.subscriptions.get(subscriptionId);
    if (subscription === undefined || subscription.gameId !== gameId) {
      throw new ProductiveAuthnError('AUTHZ_MEMBERSHIP_REJECTED');
    }
    return subscription;
  }

  private requireSession(connection: ConnectionState): ProductiveSession {
    if (connection.session === undefined) throw new ProductiveAuthnError('AUTHN_SESSION_INVALID');
    return this.sessions.resolve(connection.session.sessionId, this.now());
  }

  private send(
    connection: ConnectionState,
    type: RealtimeServerFrameType,
    correlationId: string,
    payload: unknown,
    gameId?: string,
    subscriptionId?: string,
  ): void {
    if (connection.socket.readyState !== WebSocket.OPEN) return;
    if (
      connection.pendingMessages >= this.config.maximumPendingMessages ||
      connection.socket.bufferedAmount >= this.config.maximumBufferedBytes
    ) {
      this.close(connection, 1013);
      return;
    }
    const frame: RealtimeServerFrame = {
      protocolVersion: MALIGN_REALTIME_PROTOCOL,
      schemaVersion: MALIGN_REALTIME_SCHEMA_VERSION,
      messageId: randomUUID(),
      correlationId,
      type,
      ...(gameId === undefined ? {} : { gameId }),
      ...(subscriptionId === undefined ? {} : { subscriptionId }),
      payload,
    };
    const serialized = JSON.stringify(frame);
    connection.pendingMessages += 1;
    this.metrics.observe('buffered.messages', connection.pendingMessages);
    this.metrics.observe('buffered.bytes', connection.socket.bufferedAmount + Buffer.byteLength(serialized));
    connection.socket.send(serialized, (error) => {
      connection.pendingMessages = Math.max(0, connection.pendingMessages - 1);
      if (error) this.close(connection, 1013);
    });
  }

  private heartbeat(): void {
    for (const connection of this.#connections.values()) {
      if (!connection.pongObserved) connection.missedPongs += 1;
      if (connection.missedPongs >= this.config.maximumMissedPongs) {
        connection.socket.terminate();
        continue;
      }
      connection.pongObserved = false;
      try { connection.socket.ping(); } catch { connection.socket.terminate(); }
    }
  }

  private scheduleExpiration(connection: ConnectionState): void {
    const expiresAt = connection.session?.identity.expiresAtEpochSeconds;
    if (expiresAt === undefined) return;
    const remaining = expiresAt * 1_000 - this.now();
    if (remaining <= 0) {
      this.metrics.add('token.expirations');
      this.sessions.invalidate(connection.session?.sessionId ?? '');
      return;
    }
    connection.expirationTimer = setTimeout(
      () => this.scheduleExpiration(connection),
      Math.min(remaining, 2_147_000_000),
    );
    connection.expirationTimer.unref();
  }

  private rejectPolicy(connection: ConnectionState, resultCode: string): void {
    this.send(connection, 'ERROR', randomUUID(), { code: 'POLICY_REJECTED' });
    this.log('WARN', randomUUID(), 'POLICY', resultCode, this.now());
    this.close(connection, 1008);
  }

  private close(connection: ConnectionState, code: 1008 | 1009 | 1012 | 1013): void {
    this.metrics.add(`close.${String(code)}` as RealtimeMetricName);
    try { connection.socket.close(code); } catch { connection.socket.terminate(); }
  }

  private cleanup(connection: ConnectionState): void {
    if (!this.#connections.delete(connection.connectionId)) return;
    if (connection.authenticationTimer !== undefined) clearTimeout(connection.authenticationTimer);
    if (connection.expirationTimer !== undefined) clearTimeout(connection.expirationTimer);
    this.metrics.add('connections.active', -1);
    if (connection.session !== undefined) this.metrics.add('connections.authenticated', -1);
    this.metrics.add('subscriptions.active', -connection.subscriptions.size);
    connection.subscriptions.clear();
  }

  private log(
    level: RealtimeLogEntry['level'],
    correlationId: string,
    messageType: string,
    resultCode: string,
    started: number,
  ): void {
    this.logger.write({
      level,
      correlationId,
      messageType,
      resultCode,
      durationMilliseconds: Math.max(0, this.now() - started),
      nodeId: this.nodeId,
    });
  }
}
