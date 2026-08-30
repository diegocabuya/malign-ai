import { once } from 'node:events';

import { ProductiveSessionRegistry } from '../../packages/authz/src/index.js';
import { MALIGN_REALTIME_PROTOCOL, type RealtimeCursorV1 } from '../../packages/contracts/src/index.js';
import { describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import { createAuthoritativeHttpServer } from '../../apps/server/src/http-server.js';
import {
  InMemoryRealtimeMetrics,
  ProductiveRealtimeServer,
  defaultRealtimeOperationalConfig,
  validateRealtimeOperationalConfig,
  validateTlsServerMaterial,
} from '../../apps/server/src/realtime-server.js';
import {
  HttpRealtimeSessionInvalidationAdapter,
  completeServerSideLogout,
} from '../../apps/web/src/lib/realtime-session-boundary.js';
import { realtimeAdjudicationHarness } from '../m1-3/test-fixtures.js';
import { GAME_ID, runActivation, runConstruct } from '../m1-2/test-fixtures.js';
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

const delay = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

const rejectedUpgrade = (url: string, configure: { readonly headers?: Readonly<Record<string, string>> } = {}): Promise<number> =>
  new Promise((resolve) => {
    const socket = new WebSocket(url, MALIGN_REALTIME_PROTOCOL, { origin: TEST_ORIGIN, ...configure });
    socket.once('unexpected-response', (_request, response) => resolve(response.statusCode));
    socket.once('error', () => resolve(403));
  });

describe('M22-R10 productive onboarding boundary', () => {
  it('rejects CREATE_GAME and JOIN_GAME_MEMBERSHIP before membership lookup with one stable typed surface', async () => {
    const harness = realtimeAdjudicationHarness();
    const memberships = new TestMembershipAuthority();
    const resolve = vi.spyOn(memberships, 'resolveMembership');
    const sessions = new ProductiveSessionRegistry();
    const realtime = new ProductiveRealtimeServer(
      'onboarding-node', harness.app, new TestAuthnPort(), memberships, sessions,
      new InMemoryRealtimeMetrics(), new CapturingLogger(), defaultRealtimeOperationalConfig([TEST_ORIGIN], false),
    );
    const server = createAuthoritativeHttpServer({ application: harness.app, authn: new TestAuthnPort(), memberships, sessions, realtime });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('HTTP test port unavailable');
    const endpoint = `http://127.0.0.1:${String(address.port)}/v1/commands`;
    const command = (commandType: string) => fetch(endpoint, {
      method: 'POST', headers: { authorization: 'Bearer valid-P1', 'content-type': 'application/json' },
      body: JSON.stringify({ engineContractVersion: '0.1', commandId: 'c1', idempotencyKey: 'i1', gameId: GAME_ID,
        expectedGameVersion: 0, commandType, payloadSchemaVersion: '0.1', payload: {} }),
    });
    try {
      for (const type of ['CREATE_GAME', 'JOIN_GAME_MEMBERSHIP']) {
        const response = await command(type);
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: { code: 'COMMAND_NOT_AVAILABLE_ON_PRODUCTIVE_TRANSPORT' } });
      }
      expect(resolve).not.toHaveBeenCalled();
    } finally { await realtime.shutdown(); await new Promise<void>((resolveClose) => server.close(() => resolveClose())); }
  });

  it('allows a preprovisioned membership and rejects absent/cross-game membership opaquely', async () => {
    const harness = realtimeAdjudicationHarness();
    const memberships = new TestMembershipAuthority();
    const sessions = new ProductiveSessionRegistry();
    const realtime = new ProductiveRealtimeServer(
      'membership-node', harness.app, new TestAuthnPort(), memberships, sessions,
      new InMemoryRealtimeMetrics(), new CapturingLogger(), defaultRealtimeOperationalConfig([TEST_ORIGIN], false),
    );
    const server = createAuthoritativeHttpServer({ application: harness.app, authn: new TestAuthnPort(), memberships, sessions, realtime });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); if (address === null || typeof address === 'string') throw new Error('HTTP port unavailable');
    const projection = (gameId: string) => fetch(`http://127.0.0.1:${String(address.port)}/v1/projection`, {
      method: 'POST', headers: { authorization: 'Bearer valid-P1', 'content-type': 'application/json' }, body: JSON.stringify({ gameId }),
    });
    try {
      expect((await projection(GAME_ID)).status).toBe(200);
      memberships.rejectedGames.add('00000000-0000-0000-0000-000000000999');
      const absent = await projection('00000000-0000-0000-0000-000000000999');
      expect(absent.status).toBe(403);
      expect(await absent.json()).toEqual({ error: { code: 'REQUEST_REJECTED' } });
    } finally { await realtime.shutdown(); await new Promise<void>((resolveClose) => server.close(() => resolveClose())); }
  });
});

describe('M22-R11 explicit TLS topology', () => {
  it('rejects invalid direct/trusted-proxy material and topology before serving', () => {
    expect(() => validateTlsServerMaterial('direct', undefined, undefined)).toThrow('REALTIME_DIRECT_TLS_MATERIAL_REQUIRED');
    expect(() => validateTlsServerMaterial('trusted_proxy', '/tmp/key', '/tmp/cert')).toThrow('REALTIME_TLS_MATERIAL_MODE_INVALID');
    expect(() => validateRealtimeOperationalConfig({
      ...defaultRealtimeOperationalConfig([TEST_ORIGIN], 'trusted_proxy'), trustedProxyAddresses: [],
    })).toThrow('REALTIME_TRUSTED_PROXY_CONFIGURATION_INVALID');
  });

  it('direct mode rejects plaintext even with forged X-Forwarded-Proto', async () => {
    const node = await startRealtimeNode(realtimeAdjudicationHarness().app, { configure: { tlsMode: 'direct' } });
    try { await expect(rejectedUpgrade(node.url, { headers: { 'x-forwarded-proto': 'https' } })).resolves.toBe(403); }
    finally { await node.close(); }
  });

  it('trusted_proxy accepts only configured peer plus exact HTTPS evidence', async () => {
    const valid = await startRealtimeNode(realtimeAdjudicationHarness().app, {
      configure: { tlsMode: 'trusted_proxy', trustedProxyAddresses: ['127.0.0.1'] },
    });
    try {
      const socket = new WebSocket(valid.url, MALIGN_REALTIME_PROTOCOL, {
        origin: TEST_ORIGIN, headers: { 'x-forwarded-proto': 'https' },
      });
      await once(socket, 'open');
      await authenticate(socket);
      socket.terminate();
      await expect(rejectedUpgrade(valid.url)).resolves.toBe(403);
      await expect(rejectedUpgrade(valid.url, { headers: { 'x-forwarded-proto': 'http' } })).resolves.toBe(403);
    } finally { await valid.close(); }
    const untrusted = await startRealtimeNode(realtimeAdjudicationHarness().app, {
      configure: { tlsMode: 'trusted_proxy', trustedProxyAddresses: ['192.0.2.10'] },
    });
    try { await expect(rejectedUpgrade(untrusted.url, { headers: { 'x-forwarded-proto': 'https' } })).resolves.toBe(403); }
    finally { await untrusted.close(); }
  });
});

describe('M22-R12 server-side logout ordering', () => {
  it('invalidates realtime before completing local logout and never exposes the token', async () => {
    const order: string[] = [];
    const invalidation = { invalidateCurrentSession: (token: string) => { expect(token).toBe('server-only-token'); order.push('invalidate'); return Promise.resolve(); } };
    await completeServerSideLogout({
      getAccessToken: () => Promise.resolve('server-only-token'), invalidateRealtime: invalidation,
      completeLocalLogout: () => { order.push('logout'); return Promise.resolve(); },
    });
    expect(order).toEqual(['invalidate', 'logout']);
  });

  it('HTTP invalidation adapter is idempotent across repeated server-side calls', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    try {
      const adapter = new HttpRealtimeSessionInvalidationAdapter('https://authoritative.test');
      await adapter.invalidateCurrentSession('opaque-token');
      await adapter.invalidateCurrentSession('opaque-token');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('subject');
    } finally { fetchMock.mockRestore(); }
  });
});

describe('M22-R14 serialized subscription cursors', () => {
  it('serializes concurrent wakeups, emits projection only on final batch and accepts emitted intermediate ACKs', async () => {
    const harness = realtimeAdjudicationHarness();
    const node = await startRealtimeNode(harness.app, { configure: { feedBatchSize: 1 } });
    try {
      const socket = await connect(node.url); await authenticate(socket); const owned = await subscribe(socket, GAME_ID);
      expect(runConstruct(harness).status).toBe('RESOLVED');
      expect(runActivation(harness).status).toBe('RESOLVED');
      const received: Record<string, unknown>[] = [];
      socket.on('message', (data) => { received.push(JSON.parse(Buffer.from(data as Buffer).toString('utf8')) as Record<string, unknown>); });
      await Promise.all([node.realtime.wakeGame(GAME_ID), node.realtime.wakeGame(GAME_ID)]);
      await delay(30);
      const batches = received.filter((frame) => frame.type === 'EVENT_BATCH');
      expect(batches.length).toBeGreaterThan(1);
      const payloads = batches.map((frame) => frame.payload as Record<string, unknown>);
      expect(payloads.slice(0, -1).every((payload) => payload.final === false && !('projection' in payload))).toBe(true);
      expect(payloads.at(-1)).toMatchObject({ final: true });
      expect(payloads.at(-1)).toHaveProperty('projection');
      for (const payload of payloads) {
        socket.send(clientFrame('ACK', { gameId: GAME_ID, subscriptionId: owned.subscriptionId, payload: { cursor: payload.cursor } }));
      }
      socket.send(clientFrame('ACK', { gameId: GAME_ID, subscriptionId: owned.subscriptionId, payload: { cursor: payloads[0]?.cursor } }));
      await delay(20);
      expect(socket.readyState).toBe(WebSocket.OPEN);
      socket.terminate();
    } finally { await node.close(); }
  });

  it('rejects invented/future/foreign cursors and arbitrary resync cursors', async () => {
    const node = await startRealtimeNode(realtimeAdjudicationHarness().app);
    try {
      const socket = await connect(node.url); await authenticate(socket); const owned = await subscribe(socket, GAME_ID);
      const error = nextMessage(socket);
      const invented: RealtimeCursorV1 = { ...owned.cursor, lastSequenceNumber: owned.cursor.lastSequenceNumber + 1_000,
        gameVersion: owned.cursor.gameVersion + 1_000 };
      socket.send(clientFrame('ACK', { gameId: GAME_ID, subscriptionId: owned.subscriptionId, payload: { cursor: invented } }));
      expect(await error).toMatchObject({ type: 'ERROR', payload: { code: 'POLICY_REJECTED' } });
    } finally { await node.close(); }

    const resyncNode = await startRealtimeNode(realtimeAdjudicationHarness().app);
    try {
      const socket = await connect(resyncNode.url); await authenticate(socket); const owned = await subscribe(socket, GAME_ID);
      const error = nextMessage(socket);
      socket.send(clientFrame('RESYNC_REQUEST', { gameId: GAME_ID, subscriptionId: owned.subscriptionId,
        payload: { afterCursor: { ...owned.cursor, lastSequenceNumber: owned.cursor.lastSequenceNumber + 1 } } }));
      expect(await error).toMatchObject({ type: 'ERROR' });
    } finally { await resyncNode.close(); }
  });
});
