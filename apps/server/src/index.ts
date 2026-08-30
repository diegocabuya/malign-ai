import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';

import { InMemorySessionAuthority, ProductiveSessionRegistry } from '@malign-ai/authz';
import {
  PostgresDurableUnitOfWork,
  PostgresOutboxPublisher,
  assertLeastPrivilegeRuntimeIdentity,
  createPostgresPool,
} from '@malign-ai/persistence';
import { PostgresGameSessionApplication } from './game-session-application.js';
import { createAuthoritativeHttpServer } from './http-server.js';
import {
  Auth0JwksAuthnAdapter,
  PostgresMembershipAuthorityAdapter,
  auth0JwksConfigFromEnvironment,
} from './productive-authn.js';
import {
  InMemoryFanoutMetrics,
  PostgresRealtimeWakeupListener,
  PostgresSessionInvalidationFanout,
  RealtimeOutboxPump,
  type DedicatedPostgresClient,
  type DedicatedPostgresPool,
  type PostgresNotification,
} from './realtime-postgres.js';
import {
  InMemoryRealtimeMetrics,
  JsonLineRealtimeLogger,
  ProductiveRealtimeServer,
  defaultRealtimeOperationalConfig,
  validateTlsServerMaterial,
} from './realtime-server.js';
import { BufferedTransactionalRandomProvider } from './runtime-random.js';

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') throw new Error(`Missing required configuration: ${name}`);
  return value;
};

const positiveInteger = (name: string, fallback: number): number => {
  const parsed = Number.parseInt(process.env[name] ?? String(fallback), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`Invalid configuration: ${name}`);
  return parsed;
};

const appPool = createPostgresPool({ connectionString: required('MALIGN_APP_DATABASE_URL'), max: 12 });
const outboxPool = createPostgresPool({ connectionString: required('MALIGN_OUTBOX_DATABASE_URL'), max: 4 });
const listenerPool = createPostgresPool({ connectionString: required('MALIGN_LISTENER_DATABASE_URL'), max: 2 });

const sessions = new ProductiveSessionRegistry();
const authn = new Auth0JwksAuthnAdapter(auth0JwksConfigFromEnvironment());
const memberships = new PostgresMembershipAuthorityAdapter(appPool);
const application = new PostgresGameSessionApplication(
  new InMemorySessionAuthority([]),
  new PostgresDurableUnitOfWork(appPool),
  () => new BufferedTransactionalRandomProvider(),
  () => new Date(),
);
const allowedOrigins = required('MALIGN_ALLOWED_ORIGINS').split(',').map((origin) => origin.trim()).filter(Boolean);
if (allowedOrigins.length === 0) throw new Error('MALIGN_ALLOWED_ORIGINS must not be empty');
const tlsMode = required('MALIGN_TLS_MODE');
if (tlsMode !== 'direct' && tlsMode !== 'trusted_proxy' && tlsMode !== 'disabled') {
  throw new Error('MALIGN_TLS_MODE must be direct, trusted_proxy or disabled');
}
const trustedProxyAddresses = (process.env.MALIGN_TRUSTED_PROXY_ADDRESSES ?? '')
  .split(',').map((address) => address.trim()).filter(Boolean);
const realtime = new ProductiveRealtimeServer(
  process.env.MALIGN_NODE_ID ?? randomUUID(),
  application,
  authn,
  memberships,
  sessions,
  new InMemoryRealtimeMetrics(),
  new JsonLineRealtimeLogger(),
  {
    ...defaultRealtimeOperationalConfig(allowedOrigins, tlsMode),
    trustedProxyAddresses,
    feedBatchSize: positiveInteger('MALIGN_REALTIME_FEED_BATCH_SIZE', 100),
    shutdownGraceMilliseconds: positiveInteger('MALIGN_SHUTDOWN_GRACE_MS', 10_000),
  },
);

const tlsKeyPath = process.env.MALIGN_TLS_KEY_PATH?.trim() || undefined;
const tlsCertificatePath = process.env.MALIGN_TLS_CERT_PATH?.trim() || undefined;
validateTlsServerMaterial(tlsMode, tlsKeyPath, tlsCertificatePath);
const sessionInvalidation = new PostgresSessionInvalidationFanout({
  connect: async () => adaptClient(await listenerPool.connect()),
  query: (text, values) => listenerPool.query(text, [...(values ?? [])]),
});
const server = createAuthoritativeHttpServer({
  application,
  authn,
  memberships,
  sessions,
  realtime,
  distributedSessionInvalidation: sessionInvalidation,
  readiness: async () => { await appPool.query('SELECT 1'); return true; },
  ...(tlsMode !== 'direct' || tlsKeyPath === undefined || tlsCertificatePath === undefined ? {} : {
    serverFactory: (listener) => createHttpsServer({
      key: readFileSync(tlsKeyPath), cert: readFileSync(tlsCertificatePath),
    }, listener),
  }),
});

const fanoutMetrics = new InMemoryFanoutMetrics();
function adaptClient(candidate: unknown): DedicatedPostgresClient {
  if (typeof candidate !== 'object' || candidate === null) throw new Error('POSTGRES_CLIENT_INVALID');
  const query = Reflect.get(candidate, 'query') as (text: string, values?: readonly unknown[]) => Promise<unknown>;
  const on = Reflect.get(candidate, 'on') as (event: string, callback: unknown) => unknown;
  const removeAllListeners = Reflect.get(candidate, 'removeAllListeners') as () => unknown;
  const release = Reflect.get(candidate, 'release') as () => void;
  const adapter: DedicatedPostgresClient = {
    query: (text, values) => query.call(candidate, text, [...(values ?? [])]),
    on(event, callback) {
      if (event === 'notification') on.call(candidate, 'notification', callback as (notification: PostgresNotification) => void);
      else if (event === 'error') on.call(candidate, 'error', callback as (error: Error) => void);
      else on.call(candidate, 'end', callback as () => void);
      return adapter;
    },
    removeAllListeners() { removeAllListeners.call(candidate); return adapter; },
    release() { release.call(candidate); },
  };
  return adapter;
}
const dedicatedListenerPool: DedicatedPostgresPool = {
  async connect(): Promise<DedicatedPostgresClient> {
    return adaptClient(await listenerPool.connect());
  },
  query: (text, values) => listenerPool.query(text, [...(values ?? [])]),
};
const dedicatedOutboxPool: DedicatedPostgresPool = {
  connect: async () => adaptClient(await outboxPool.connect()),
  query: (text, values) => outboxPool.query(text, [...(values ?? [])]),
};
const listener = new PostgresRealtimeWakeupListener(
  dedicatedListenerPool,
  (gameId) => gameId === undefined ? realtime.wakeAll() : realtime.wakeGame(gameId),
  fanoutMetrics,
  positiveInteger('MALIGN_REALTIME_CATCHUP_MS', 5_000),
  250,
  (digest) => { sessions.invalidateExternalIdentityDigest(digest); return Promise.resolve(); },
);
const pump = new RealtimeOutboxPump(new PostgresOutboxPublisher(outboxPool), dedicatedOutboxPool, fanoutMetrics);
let stopping = false;

const preflightPool = async (
  pool: typeof appPool,
  role: 'malign_app_runtime' | 'malign_outbox_publisher',
): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    await assertLeastPrivilegeRuntimeIdentity(client, role);
    await client.query('ROLLBACK');
  } finally { client.release(); }
};

await preflightPool(appPool, 'malign_app_runtime');
await preflightPool(outboxPool, 'malign_outbox_publisher');
await preflightPool(listenerPool, 'malign_app_runtime');
await listener.start();
const publisherTimer = setInterval(
  () => { void pump.publishOne().catch(() => undefined); },
  positiveInteger('MALIGN_OUTBOX_POLL_MS', 100),
);
publisherTimer.unref();

const shutdown = async (): Promise<void> => {
  if (stopping) return;
  stopping = true;
  clearInterval(publisherTimer);
  await pump.drainAndStop();
  await listener.stop();
  await realtime.shutdown();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await Promise.all([appPool.end(), outboxPool.end(), listenerPool.end()]);
};

process.once('SIGTERM', () => { void shutdown().finally(() => process.exit(0)); });
process.once('SIGINT', () => { void shutdown().finally(() => process.exit(0)); });

const port = positiveInteger('SERVER_PORT', 3001);
server.listen(port, () => {
  process.stdout.write(`${JSON.stringify({ level: 'INFO', messageType: 'SERVER_STARTED', port })}\n`);
});
