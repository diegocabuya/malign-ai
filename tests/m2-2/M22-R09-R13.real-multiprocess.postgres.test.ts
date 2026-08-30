import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';

import { InMemorySessionAuthority } from '../../packages/authz/src/index.js';
import { MALIGN_REALTIME_PROTOCOL, MALIGN_REALTIME_SCHEMA_VERSION, type RealtimeCursorV1 } from '../../packages/contracts/src/index.js';
import { M1_0_BASELINE_VERSIONS, type TransactionalRandomProvider } from '../../packages/domain/src/index.js';
import type { SetupCommandPayload, SetupCommandType } from '../../packages/game-engine/src/index.js';
import {
  PostgresDurableUnitOfWork,
  PostgresOutboxPublisher,
  bootstrapPostgresClusterRoles,
  configForDatabase,
  configForPrincipal,
  createDisposableDatabase,
  createEphemeralLoginPrincipal,
  createPostgresPool,
  dropDisposableDatabase,
  dropEphemeralLoginPrincipal,
  migratePostgres,
  postgresConfigFromEnvironment,
  seedApprovedRegistry,
} from '../../packages/persistence/src/index.js';
import { exportJWK, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, type RawData } from 'ws';

import { PostgresGameSessionApplication } from '../../apps/server/src/game-session-application.js';
import {
  InMemoryFanoutMetrics,
  RealtimeOutboxPump,
  type DedicatedPostgresClient,
  type DedicatedPostgresPool,
} from '../../apps/server/src/realtime-postgres.js';
import { PARTICIPANT_FIXTURE, trustedBindings } from '../m1-0/test-fixtures.js';

const TEST_ORIGIN = 'https://malign.test';
const adminConfig = postgresConfigFromEnvironment();
const databaseName = `malign_m2a_m22_${randomUUID().replaceAll('-', '').slice(0, 14)}`;
const databaseConfig = configForDatabase(adminConfig, databaseName);
const adminPool = createPostgresPool(adminConfig);
const databaseAdminPool = createPostgresPool(databaseConfig);
const principalSuffix = randomUUID().replaceAll('-', '').slice(0, 10);
const migratorPrincipal = `malign_test_migrator_${principalSuffix}`;
const appPrincipal = `malign_test_app_${principalSuffix}`;
const outboxPrincipal = `malign_test_outbox_${principalSuffix}`;
const migratorPool = createPostgresPool(configForPrincipal(databaseConfig, migratorPrincipal));
const appPool = createPostgresPool(configForPrincipal(databaseConfig, appPrincipal));
const outboxPool = createPostgresPool(configForPrincipal(databaseConfig, outboxPrincipal));

const minimumRandomFactory = (): TransactionalRandomProvider => ({
  checkpoint: () => ({ cursor: 0 }), restore: () => undefined, commit: () => undefined,
  integer: (minimum: number) => minimum,
});

const configUrl = (config: ReturnType<typeof configForPrincipal>): string => {
  if (typeof config.connectionString !== 'string') throw new Error('Integration database URL unavailable');
  return config.connectionString;
};

const appUrl = configUrl(configForPrincipal(databaseConfig, appPrincipal));
const outboxUrl = configUrl(configForPrincipal(databaseConfig, outboxPrincipal));
const adminUrl = typeof databaseConfig.connectionString === 'string' ? databaseConfig.connectionString : '';

const freePort = async (): Promise<number> => {
  const server = createNetServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (address === null || typeof address === 'string') throw new Error('Port unavailable');
  await new Promise<void>((resolve) => server.close(() => resolve())); return address.port;
};

const nextFrame = async (socket: WebSocket, timeoutMilliseconds = 5_000): Promise<Record<string, unknown>> => {
  const timer = setTimeout(() => socket.terminate(), timeoutMilliseconds);
  try {
    const data = await new Promise<RawData>((resolve, reject) => {
      socket.once('message', resolve); socket.once('error', reject);
      socket.once('close', (code) => reject(new Error(`Socket closed (${String(code)})`)));
    });
    const text = Array.isArray(data) ? Buffer.concat(data).toString('utf8')
      : data instanceof ArrayBuffer ? Buffer.from(data).toString('utf8')
        : Buffer.from(data).toString('utf8');
    return JSON.parse(text) as Record<string, unknown>;
  } finally { clearTimeout(timer); }
};

let frameOrdinal = 0;
const frame = (type: string, fields: Record<string, unknown> = {}): string => JSON.stringify({
  protocolVersion: MALIGN_REALTIME_PROTOCOL, schemaVersion: MALIGN_REALTIME_SCHEMA_VERSION,
  messageId: `real-${String(++frameOrdinal)}`, correlationId: `real-correlation-${String(frameOrdinal)}`, type, ...fields,
});

interface RunningProcess {
  readonly process: ChildProcess;
  readonly port: number;
  readonly logs: string[];
}

const baseProcessEnvironment = (port: number, issuer: string, nodeId: string): NodeJS.ProcessEnv => ({
  ...process.env,
  NODE_ENV: 'test', SERVER_PORT: String(port), MALIGN_NODE_ID: nodeId,
  MALIGN_APP_DATABASE_URL: appUrl, MALIGN_OUTBOX_DATABASE_URL: outboxUrl, MALIGN_LISTENER_DATABASE_URL: appUrl,
  MALIGN_ALLOWED_ORIGINS: TEST_ORIGIN, MALIGN_TLS_MODE: 'disabled', MALIGN_REALTIME_CATCHUP_MS: '250',
  MALIGN_OUTBOX_POLL_MS: '60000', AUTH0_ISSUER_BASE_URL: issuer, AUTH0_AUDIENCE: 'malign-api',
  AUTH0_CLIENT_ID: 'malign-client', AUTH0_REQUIRED_SCOPES: 'malign:connect',
  AUTH0_JWKS_URI: new URL('.well-known/jwks.json', issuer).toString(),
});

const startProcess = async (environment: NodeJS.ProcessEnv): Promise<RunningProcess> => {
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], {
    cwd: process.cwd(), env: environment, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs: string[] = [];
  child.stdout?.on('data', (data: Buffer | string) => logs.push(typeof data === 'string' ? data : data.toString('utf8')));
  child.stderr?.on('data', (data: Buffer | string) => logs.push(typeof data === 'string' ? data : data.toString('utf8')));
  const port = Number(environment.SERVER_PORT);
  await Promise.race([
    new Promise<void>((resolve, reject) => {
      const inspect = (data: Buffer) => {
        if (data.toString().includes('SERVER_STARTED')) resolve();
      };
      child.stdout?.on('data', inspect);
      child.once('exit', (code) => reject(new Error(`Node exited before readiness (${String(code)}): ${logs.join('')}`)));
    }),
    new Promise<void>((_resolve, reject) => setTimeout(() => reject(new Error(`Node start timeout: ${logs.join('')}`)), 10_000)),
  ]);
  return { process: child, port, logs };
};

const stopProcess = async (running: RunningProcess): Promise<void> => {
  if (running.process.exitCode !== null) return;
  running.process.kill('SIGTERM');
  await Promise.race([once(running.process, 'exit'), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (running.process.exitCode === null) running.process.kill('SIGKILL');
};

const connectAndAuthenticate = async (running: RunningProcess, token: string): Promise<WebSocket> => {
  const socket = new WebSocket(`ws://127.0.0.1:${String(running.port)}`, MALIGN_REALTIME_PROTOCOL, { origin: TEST_ORIGIN });
  await once(socket, 'open'); const response = nextFrame(socket); socket.send(frame('AUTHENTICATE', { payload: { accessToken: token } }));
  expect(await response).toMatchObject({ type: 'AUTHENTICATED' }); return socket;
};

const subscribe = async (socket: WebSocket, gameId: string, afterCursor?: RealtimeCursorV1) => {
  const response = nextFrame(socket); socket.send(frame('SUBSCRIBE', { gameId, payload: afterCursor === undefined ? {} : { afterCursor } }));
  const sync = await response; expect(sync).toMatchObject({ type: 'SYNC', gameId });
  const payload = sync.payload as { cursor: RealtimeCursorV1 }; return { subscriptionId: String(sync.subscriptionId), cursor: payload.cursor };
};

const dedicatedPool = (pool: typeof outboxPool): DedicatedPostgresPool => ({
  query: (text, values) => pool.query(text, [...(values ?? [])]),
  connect: async () => {
    const client = await pool.connect();
    const adapter: DedicatedPostgresClient = {
      query: (text, values) => client.query(text, [...(values ?? [])]),
      on(event, callback) { client.on(event, callback as never); return adapter; },
      removeAllListeners() { client.removeAllListeners(); return adapter; }, release() { client.release(); },
    };
    return adapter;
  },
});

let jwksServer: Server;
let issuer = '';
let privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'];
let keyId = '';
let gameId = '';
let version = 0;
let nodeA: RunningProcess;
let nodeB: RunningProcess;
let application: PostgresGameSessionApplication;
let pump: RealtimeOutboxPump;

const tokenFor = async (subject: string): Promise<string> => new SignJWT({ scope: 'malign:connect', azp: 'malign-client' })
  .setProtectedHeader({ alg: 'RS256', kid: keyId }).setSubject(subject).setIssuer(issuer).setAudience('malign-api')
  .setIssuedAt().setExpirationTime('5m').sign(privateKey);

const executeAdministrative = async (sessionId: string, commandType: SetupCommandType, payload: SetupCommandPayload) => {
  const result = await application.execute(sessionId, {
    engineContractVersion: M1_0_BASELINE_VERSIONS.engineContractVersion, commandId: randomUUID(),
    idempotencyKey: `m22:${commandType}:${randomUUID()}`, gameId, expectedGameVersion: version, commandType,
    payloadSchemaVersion: M1_0_BASELINE_VERSIONS.fixtureSchemaVersion, payload,
  });
  if (result.status !== 'RESOLVED') throw new Error(`${commandType} rejected: ${result.resultCode}`);
  version = result.gameVersionAfter; return result;
};

beforeAll(async () => {
  await createDisposableDatabase(adminPool, databaseName);
  await bootstrapPostgresClusterRoles(databaseAdminPool);
  await createEphemeralLoginPrincipal(adminPool, migratorPrincipal, 'malign_migration_owner', databaseName);
  await createEphemeralLoginPrincipal(adminPool, appPrincipal, 'malign_app_runtime', databaseName);
  await createEphemeralLoginPrincipal(adminPool, outboxPrincipal, 'malign_outbox_publisher', databaseName);
  await migratePostgres(migratorPool, { applicationBuild: 'm22-r09-r14', administrativePool: databaseAdminPool });
  await seedApprovedRegistry(migratorPool);

  const provisional = `provisional:${randomUUID()}`;
  const authority = new InMemorySessionAuthority(trustedBindings(provisional));
  application = new PostgresGameSessionApplication(authority, new PostgresDurableUnitOfWork(appPool), minimumRandomFactory, () => new Date());
  const created = await application.createGame('session-f1', {
    engineContractVersion: M1_0_BASELINE_VERSIONS.engineContractVersion, commandId: randomUUID(),
    idempotencyKey: `m22:create:${randomUUID()}`, expectedGameVersion: 0,
    payloadSchemaVersion: M1_0_BASELINE_VERSIONS.fixtureSchemaVersion,
    payload: { scenarioDefinitionId: 'BASE_2025', ...M1_0_BASELINE_VERSIONS, turnLimit: 10, preferredDiceMode: 'DIGITAL' },
  });
  if (created.result.status !== 'RESOLVED') throw new Error(`CREATE_GAME rejected: ${created.result.resultCode}`);
  gameId = created.gameId; version = created.result.gameVersionAfter;
  for (const player of PARTICIPANT_FIXTURE.participants.filter(({ role }) => role === 'PLAYER').slice(0, 2)) {
    await executeAdministrative(player.authenticated_session_id, 'JOIN_GAME_MEMBERSHIP', {});
  }

  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 }); privateKey = pair.privateKey;
  const publicJwk = await exportJWK(pair.publicKey); keyId = `m22-${randomUUID()}`;
  jwksServer = createServer((request, response) => {
    if (request.url !== '/.well-known/jwks.json') { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ keys: [{ ...publicJwk, kid: keyId, alg: 'RS256', use: 'sig' }] }));
  });
  jwksServer.listen(0, '127.0.0.1'); await once(jwksServer, 'listening');
  const jwksAddress = jwksServer.address(); if (jwksAddress === null || typeof jwksAddress === 'string') throw new Error('JWKS port unavailable');
  issuer = `http://127.0.0.1:${String(jwksAddress.port)}/`;

  nodeA = await startProcess(baseProcessEnvironment(await freePort(), issuer, 'm22-node-a'));
  nodeB = await startProcess(baseProcessEnvironment(await freePort(), issuer, 'm22-node-b'));
  pump = new RealtimeOutboxPump(new PostgresOutboxPublisher(outboxPool), dedicatedPool(outboxPool), new InMemoryFanoutMetrics());
  while (await pump.publishOne()) { /* drain setup outbox before the measured gate */ }
}, 180_000);

afterAll(async () => {
  await Promise.all([nodeA === undefined ? Promise.resolve() : stopProcess(nodeA), nodeB === undefined ? Promise.resolve() : stopProcess(nodeB)]);
  if (jwksServer !== undefined) await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
  await Promise.all([migratorPool.end(), appPool.end(), outboxPool.end(), databaseAdminPool.end()]);
  await dropDisposableDatabase(adminPool, databaseName);
  await dropEphemeralLoginPrincipal(adminPool, migratorPrincipal);
  await dropEphemeralLoginPrincipal(adminPool, appPrincipal);
  await dropEphemeralLoginPrincipal(adminPool, outboxPrincipal);
  await adminPool.end();
});

describe('M22-R09 real PostgreSQL 18.6, processes and network gate', () => {
  it('fans out a post-commit outbox event from node A and reconnects on independent node B', async () => {
    const p1 = await tokenFor('user-p1'); const f1 = await tokenFor('user-f1');
    const socketA = await connectAndAuthenticate(nodeA, p1); const first = await subscribe(socketA, gameId);
    const eventPromise = nextFrame(socketA, 10_000);
    const response = await fetch(`http://127.0.0.1:${String(nodeA.port)}/v1/commands`, {
      method: 'POST', headers: { authorization: `Bearer ${f1}`, 'content-type': 'application/json' },
      body: JSON.stringify({ engineContractVersion: M1_0_BASELINE_VERSIONS.engineContractVersion,
        commandId: randomUUID(), idempotencyKey: `m22:http:${randomUUID()}`, gameId, expectedGameVersion: version,
        commandType: 'CONFIGURE_GAME_OPTION', payloadSchemaVersion: M1_0_BASELINE_VERSIONS.fixtureSchemaVersion,
        payload: { optionId: 'TURN_LIMIT', value: 9 } }),
    });
    expect(response.status).toBe(200); const result = await response.json() as { gameVersionAfter: number }; version = result.gameVersionAfter;
    expect(await pump.publishOne(gameId)).toBe(true);
    const delivered = await eventPromise; expect(delivered).toMatchObject({ type: 'EVENT_BATCH', gameId });
    const cursor = (delivered.payload as { cursor: RealtimeCursorV1 }).cursor;
    socketA.terminate();
    const socketB = await connectAndAuthenticate(nodeB, p1); const reconnected = await subscribe(socketB, gameId, cursor);
    expect(reconnected.cursor.lastSequenceNumber).toBeGreaterThanOrEqual(cursor.lastSequenceNumber);
    expect(reconnected.cursor.viewerParticipantId).toBe('P1');
    socketB.terminate();
    expect(nodeA.process.pid).not.toBe(nodeB.process.pid);
    expect(first.cursor.gameId).toBe(gameId);
  }, 30_000);

  it('recovers a deliberately unnotified commit through periodic authoritative catch-up without duplicates', async () => {
    const socket = await connectAndAuthenticate(nodeB, await tokenFor('user-p1')); await subscribe(socket, gameId);
    const messages: Record<string, unknown>[] = []; socket.on('message', (data) => messages.push(JSON.parse(Buffer.from(data as Buffer).toString('utf8')) as Record<string, unknown>));
    await executeAdministrative('session-f1', 'CONFIGURE_GAME_OPTION', { optionId: 'TURN_LIMIT', value: 8 });
    await new Promise((resolve) => setTimeout(resolve, 700));
    const batches = messages.filter(({ type }) => type === 'EVENT_BATCH');
    expect(batches).toHaveLength(1);
    const sequence = ((batches[0]?.payload as { cursor: RealtimeCursorV1 }).cursor).lastSequenceNumber;
    const notifyClient = await outboxPool.connect();
    try {
      await notifyClient.query('BEGIN'); await notifyClient.query('SET LOCAL ROLE malign_outbox_publisher');
      const payload = JSON.stringify({ gameId, outboxSequence: 999_999 });
      await notifyClient.query('SELECT pg_notify($1,$2)', ['malign_realtime_wakeup', payload]);
      await notifyClient.query('SELECT pg_notify($1,$2)', ['malign_realtime_wakeup', payload]);
      await notifyClient.query('SELECT pg_notify($1,$2)', ['malign_realtime_wakeup', JSON.stringify({ gameId, outboxSequence: 999_998 })]);
      await notifyClient.query('COMMIT');
    } finally { notifyClient.release(); }
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(messages.filter(({ type }) => type === 'EVENT_BATCH')).toHaveLength(1);
    expect(sequence).toBeGreaterThan(0); socket.terminate();
  }, 30_000);

  it('closes the real subscribe/catch-up/live activation race without loss or duplicate application', async () => {
    const socket = await connectAndAuthenticate(nodeA, await tokenFor('user-p2'));
    const observed: Record<string, unknown>[] = [];
    socket.on('message', (data) => observed.push(JSON.parse(Buffer.from(data as Buffer).toString('utf8')) as Record<string, unknown>));
    socket.send(frame('SUBSCRIBE', { gameId, payload: {} }));
    const response = await fetch(`http://127.0.0.1:${String(nodeB.port)}/v1/commands`, {
      method: 'POST', headers: { authorization: `Bearer ${await tokenFor('user-f1')}`, 'content-type': 'application/json' },
      body: JSON.stringify({ engineContractVersion: M1_0_BASELINE_VERSIONS.engineContractVersion,
        commandId: randomUUID(), idempotencyKey: `m22:race:${randomUUID()}`, gameId, expectedGameVersion: version,
        commandType: 'CONFIGURE_GAME_OPTION', payloadSchemaVersion: M1_0_BASELINE_VERSIONS.fixtureSchemaVersion,
        payload: { optionId: 'TURN_LIMIT', value: 7 } }),
    });
    expect(response.status).toBe(200); version = ((await response.json()) as { gameVersionAfter: number }).gameVersionAfter;
    await pump.publishOne(gameId); await new Promise((resolve) => setTimeout(resolve, 700));
    const sync = observed.find(({ type }) => type === 'SYNC'); expect(sync).toBeDefined();
    const eventFrames = observed.filter(({ type }) => type === 'EVENT_BATCH');
    const eventIds = eventFrames.flatMap(({ payload }) => ((payload as { events: { eventId: string }[] }).events).map(({ eventId }) => eventId));
    expect(new Set(eventIds).size).toBe(eventIds.length);
    const cursors = observed.filter(({ type }) => type === 'SYNC' || type === 'EVENT_BATCH')
      .map(({ payload }) => (payload as { cursor: RealtimeCursorV1 }).cursor);
    const persisted = await appPool.query<{ event_sequence_head: string }>('SELECT event_sequence_head::text FROM malign.games WHERE id=$1', [gameId]);
    expect(Math.max(...cursors.map(({ lastSequenceNumber }) => lastSequenceNumber))).toBe(Number(persisted.rows[0]?.event_sequence_head));
    expect(cursors.every(({ viewerParticipantId }) => viewerParticipantId === 'P2')).toBe(true);
    socket.terminate();

    const crossGame = await connectAndAuthenticate(nodeB, await tokenFor('user-p1')); const rejected = nextFrame(crossGame);
    crossGame.send(frame('SUBSCRIBE', { gameId: '00000000-0000-0000-0000-000000000999', payload: {} }));
    expect(await rejected).toMatchObject({ type: 'ERROR', payload: { code: 'POLICY_REJECTED' } });
  }, 30_000);
});

describe('M22-R12 real distributed ephemeral invalidation', () => {
  it('node A invalidation closes only the same subject on node B with digest-only NOTIFY', async () => {
    const p1Token = await tokenFor('user-p1'); const p2Token = await tokenFor('user-p2');
    const p1Socket = await connectAndAuthenticate(nodeB, p1Token); const p2Socket = await connectAndAuthenticate(nodeB, p2Token);
    const p1Closed = new Promise<number>((resolve) => p1Socket.once('close', resolve));
    const auditClient = await appPool.connect(); const notifications: string[] = [];
    auditClient.on('notification', ({ channel, payload }) => { if (channel === 'malign_session_invalidation' && payload !== undefined) notifications.push(payload); });
    await auditClient.query('LISTEN malign_session_invalidation');
    try {
      const response = await fetch(`http://127.0.0.1:${String(nodeA.port)}/v1/session/invalidate`, {
        method: 'POST', headers: { authorization: `Bearer ${p1Token}` },
      });
      expect(response.status).toBe(204); expect(await p1Closed).toBe(1008);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(p2Socket.readyState).toBe(WebSocket.OPEN);
      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toMatch(/^[a-f0-9]{64}$/);
      expect(notifications[0]).not.toContain('user-p1'); expect(notifications[0]).not.toContain(p1Token);
      await auditClient.query('SELECT pg_notify($1,$2)', ['malign_session_invalidation', notifications[0]]);
      await new Promise((resolve) => setTimeout(resolve, 50)); expect(p2Socket.readyState).toBe(WebSocket.OPEN);
    } finally { p2Socket.terminate(); await auditClient.query('UNLISTEN *'); auditClient.release(); }
  }, 30_000);
});

describe('M22-R13 real least-privilege preflight', () => {
  it('uses three independent pools and rejects swapped/admin/missing credentials before opening a port', async () => {
    const identities = await adminPool.query<{ rolname: string; memberships: string[] }>(`SELECT r.rolname,
      ARRAY(SELECT granted.rolname::text FROM pg_auth_members m JOIN pg_roles granted ON granted.oid=m.roleid
        WHERE m.member=r.oid ORDER BY granted.rolname)::text[] memberships
      FROM pg_roles r WHERE r.rolname=ANY($1::text[]) ORDER BY r.rolname`, [[appPrincipal, outboxPrincipal]]);
    expect(identities.rows).toEqual([
      { rolname: appPrincipal, memberships: ['malign_app_runtime'] },
      { rolname: outboxPrincipal, memberships: ['malign_outbox_publisher'] },
    ]);
    const expectFailure = async (overrides: NodeJS.ProcessEnv) => {
      const port = await freePort(); const environment = { ...baseProcessEnvironment(port, issuer, `invalid-${randomUUID()}`), ...overrides };
      const child = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], { cwd: process.cwd(), env: environment, stdio: 'ignore' });
      const code = await Promise.race([
        new Promise<number | null>((resolve) => child.once('exit', resolve)),
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('Invalid server opened or hung')), 8_000)),
      ]);
      expect(code).not.toBe(0);
      await expect(fetch(`http://127.0.0.1:${String(port)}/health`)).rejects.toBeDefined();
    };
    await expectFailure({ MALIGN_APP_DATABASE_URL: outboxUrl, MALIGN_OUTBOX_DATABASE_URL: appUrl });
    await expectFailure({ MALIGN_APP_DATABASE_URL: adminUrl });
    await expectFailure({ MALIGN_APP_DATABASE_URL: '' });
  }, 40_000);
});

afterAll(() => {
  const clearText = `${nodeA?.logs.join('') ?? ''}${nodeB?.logs.join('') ?? ''}`;
  expect(clearText).not.toContain('user-p1');
  expect(clearText).not.toContain('user-p2');
  expect(clearText).not.toContain('eyJ');
  expect(createHash('sha256').update(clearText).digest('hex')).toMatch(/^[a-f0-9]{64}$/);
});
