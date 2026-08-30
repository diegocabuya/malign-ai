import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { ProductiveSessionRegistry } from '../../packages/authz/src/index.js';
import { MALIGN_REALTIME_PROTOCOL } from '../../packages/contracts/src/index.js';
import { createAuthoritativeHttpServer } from '../../apps/server/src/http-server.js';
import {
  InMemoryRealtimeMetrics,
  ProductiveRealtimeServer,
  defaultRealtimeOperationalConfig,
} from '../../apps/server/src/realtime-server.js';
import { realtimeAdjudicationHarness } from '../m1-3/test-fixtures.js';
import { GAME_ID } from '../m1-2/test-fixtures.js';
import {
  CapturingLogger,
  TEST_ORIGIN,
  TestAuthnPort,
  TestMembershipAuthority,
  authenticate,
  clientFrame,
  connect,
  nextMessage,
  startRealtimeNode,
  subscribe,
} from './test-fixtures.js';

const closingCode = (socket: WebSocket): Promise<number> => new Promise((resolve) => socket.once('close', resolve));

describe('M2-2 HTTP/WSS and hostile transport regressions', () => {
  it('serves real health/projection HTTP and rejects extra authority fields opaquely', async () => {
    const harness = realtimeAdjudicationHarness();
    const sessions = new ProductiveSessionRegistry();
    const realtime = new ProductiveRealtimeServer(
      'http-node', harness.app, new TestAuthnPort(), new TestMembershipAuthority(), sessions,
      new InMemoryRealtimeMetrics(), new CapturingLogger(), defaultRealtimeOperationalConfig([TEST_ORIGIN], false),
    );
    const server = createAuthoritativeHttpServer({
      application: harness.app, authn: new TestAuthnPort(), memberships: new TestMembershipAuthority(), sessions, realtime,
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('HTTP port unavailable');
    const base = `http://127.0.0.1:${String(address.port)}`;
    try {
      expect(await (await fetch(`${base}/health`)).json()).toEqual({ status: 'ok' });
      const projection = await fetch(`${base}/v1/projection`, {
        method: 'POST', headers: { authorization: 'Bearer valid-P1', 'content-type': 'application/json' },
        body: JSON.stringify({ gameId: GAME_ID }),
      });
      expect(projection.status).toBe(200);
      expect(JSON.stringify(await projection.json())).not.toContain('valid-P1');
      const injected = await fetch(`${base}/v1/projection`, {
        method: 'POST', headers: { authorization: 'Bearer valid-P1', 'content-type': 'application/json' },
        body: JSON.stringify({ gameId: GAME_ID, participantId: 'P2' }),
      });
      expect(injected.status).toBe(400);
      expect(await injected.json()).toEqual({ error: { code: 'REQUEST_REJECTED' } });
    } finally {
      await realtime.shutdown();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('rejects an Origin outside the allowlist and missing/unknown subprotocol', async () => {
    const node = await startRealtimeNode(realtimeAdjudicationHarness().app);
    const rejected = (protocol: string | undefined, origin: string): Promise<number> => new Promise((resolve) => {
      const socket = protocol === undefined ? new WebSocket(node.url, { origin }) : new WebSocket(node.url, protocol, { origin });
      socket.once('unexpected-response', (_request, response) => resolve(response.statusCode));
      socket.once('error', () => resolve(403));
    });
    try {
      await expect(rejected(MALIGN_REALTIME_PROTOCOL, 'https://evil.invalid')).resolves.toBe(403);
      await expect(rejected(undefined, TEST_ORIGIN)).resolves.toBe(403);
      await expect(rejected('unknown.protocol', TEST_ORIGIN)).resolves.toBe(403);
    } finally { await node.close(); }
  });

  it('enforces AUTHENTICATE as first frame and rejects commands over WebSocket', async () => {
    const node = await startRealtimeNode(realtimeAdjudicationHarness().app);
    try {
      const preauth = await connect(node.url);
      const preauthError = nextMessage(preauth);
      const preauthClose = closingCode(preauth);
      preauth.send(clientFrame('SUBSCRIBE', { gameId: GAME_ID, payload: {} }));
      expect(await preauthError).toMatchObject({ type: 'ERROR', payload: { code: 'POLICY_REJECTED' } });
      expect(await preauthClose).toBe(1008);

      const commandSocket = await connect(node.url);
      await authenticate(commandSocket);
      const commandError = nextMessage(commandSocket);
      const commandClose = closingCode(commandSocket);
      commandSocket.send(clientFrame('CONSTRUCT_CAMPAIGN', { gameId: GAME_ID, payload: {} }));
      expect(await commandError).toMatchObject({ type: 'ERROR' });
      expect(await commandClose).toBe(1008);
    } finally { await node.close(); }
  });

  it('rejects malformed/extra-field frames and payloads above 65536 bytes without mutation', async () => {
    const harness = realtimeAdjudicationHarness();
    const before = harness.store.snapshot(GAME_ID);
    const node = await startRealtimeNode(harness.app);
    try {
      const extra = await connect(node.url);
      const extraError = nextMessage(extra);
      extra.send(clientFrame('AUTHENTICATE', { payload: { accessToken: 'valid-P1' }, authority: 'P2' }));
      expect(await extraError).toMatchObject({ type: 'ERROR' });

      const oversized = await connect(node.url);
      const oversizedClose = closingCode(oversized);
      oversized.send(Buffer.alloc(65_537, 1));
      expect(await oversizedClose).toBe(1009);
      expect(harness.store.snapshot(GAME_ID)).toEqual(before);
    } finally { await node.close(); }
  });

  it('closes every socket bound to an invalidated server session', async () => {
    const node = await startRealtimeNode(realtimeAdjudicationHarness().app);
    try {
      const socket = await connect(node.url);
      const authenticated = nextMessage(socket);
      socket.send(clientFrame('AUTHENTICATE', { payload: { accessToken: 'valid-P1' } }));
      const frame = await authenticated;
      const payload = frame.payload as { sessionId: string };
      const closed = closingCode(socket);
      node.sessions.invalidate(payload.sessionId);
      expect(await closed).toBe(1008);
    } finally { await node.close(); }
  });

  it('expires an authenticated socket instead of allowing silent continuation', async () => {
    const expiresAt = Math.floor(Date.now() / 1_000) + 2;
    const node = await startRealtimeNode(realtimeAdjudicationHarness().app, { authn: new TestAuthnPort(expiresAt) });
    try {
      const socket = await connect(node.url);
      await authenticate(socket);
      expect(await closingCode(socket)).toBe(1008);
      expect(node.metrics.snapshot()).toMatchObject({ 'token.expirations': 1 });
    } finally { await node.close(); }
  });

  it('rejects cross-game membership and subscription hijacking with the same opaque policy surface', async () => {
    const node = await startRealtimeNode(realtimeAdjudicationHarness().app);
    try {
      const first = await connect(node.url);
      await authenticate(first, 'P1');
      const owned = await subscribe(first, GAME_ID);
      const second = await connect(node.url);
      await authenticate(second, 'P2');
      const hijackError = nextMessage(second);
      second.send(clientFrame('ACK', {
        gameId: GAME_ID, subscriptionId: owned.subscriptionId, payload: { cursor: owned.cursor },
      }));
      expect(await hijackError).toMatchObject({ type: 'ERROR', payload: { code: 'POLICY_REJECTED' } });

      const crossGame = await connect(node.url);
      await authenticate(crossGame, 'P1');
      const crossError = nextMessage(crossGame);
      crossGame.send(clientFrame('SUBSCRIBE', { gameId: '00000000-0000-0000-0000-000000000999', payload: {} }));
      expect(await crossError).toMatchObject({ type: 'ERROR', payload: { code: 'POLICY_REJECTED' } });
      first.terminate(); second.terminate(); crossGame.terminate();
    } finally { await node.close(); }
  });

  it('announces a real resync request before returning the authorized catch-up feed', async () => {
    const node = await startRealtimeNode(realtimeAdjudicationHarness().app);
    try {
      const socket = await connect(node.url);
      await authenticate(socket);
      const owned = await subscribe(socket, GAME_ID);
      const gap = nextMessage(socket);
      socket.send(clientFrame('RESYNC_REQUEST', {
        gameId: GAME_ID, subscriptionId: owned.subscriptionId, payload: { afterCursor: owned.cursor },
      }));
      expect(await gap).toMatchObject({
        type: 'GAP_DETECTED', gameId: GAME_ID, subscriptionId: owned.subscriptionId,
        payload: { recovery: 'AUTHORIZED_FEED' },
      });
      socket.terminate();
    } finally { await node.close(); }
  });

  it('uses 1013 for configured overload and 1012 with DRAINING on graceful shutdown', async () => {
    const overloaded = await startRealtimeNode(realtimeAdjudicationHarness().app, {
      configure: { maximumPendingMessages: 0 },
    });
    const slow = await connect(overloaded.url);
    const slowClose = closingCode(slow);
    slow.send(clientFrame('AUTHENTICATE', { payload: { accessToken: 'valid-P1' } }));
    expect(await slowClose).toBe(1013);
    await overloaded.close();

    const draining = await startRealtimeNode(realtimeAdjudicationHarness().app);
    const socket = await connect(draining.url);
    await authenticate(socket);
    const message = nextMessage(socket);
    const closed = closingCode(socket);
    const shutdown = draining.realtime.shutdown();
    expect(await message).toMatchObject({ type: 'DRAINING' });
    expect(await closed).toBe(1012);
    await shutdown;
    await new Promise<void>((resolve) => draining.server.close(() => resolve()));
  });

  it('negotiates a real local WSS connection with a reproducible ephemeral certificate', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'malign-wss-'));
    const keyPath = join(directory, 'key.pem');
    const certificatePath = join(directory, 'certificate.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-keyout', keyPath, '-out', certificatePath], { stdio: 'ignore' });
    const harness = realtimeAdjudicationHarness();
    const realtime = new ProductiveRealtimeServer(
      'tls-node', harness.app, new TestAuthnPort(), new TestMembershipAuthority(), new ProductiveSessionRegistry(),
      new InMemoryRealtimeMetrics(), new CapturingLogger(), defaultRealtimeOperationalConfig([TEST_ORIGIN], true),
    );
    const server = createHttpsServer({ key: readFileSync(keyPath), cert: readFileSync(certificatePath) });
    realtime.attach(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('WSS port unavailable');
    const socket = new WebSocket(`wss://127.0.0.1:${String(address.port)}`, MALIGN_REALTIME_PROTOCOL, {
      origin: TEST_ORIGIN, rejectUnauthorized: false,
    });
    try {
      await once(socket, 'open');
      await authenticate(socket);
      expect(socket.protocol).toBe(MALIGN_REALTIME_PROTOCOL);
    } finally {
      socket.terminate();
      await realtime.shutdown();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
