import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';

import { InMemorySessionAuthority, ProductiveSessionRegistry } from '@malign-ai/authz';
import {
  PostgresDurableUnitOfWork,
  PostgresOutboxPublisher,
  createPostgresPool,
  postgresConfigFromEnvironment,
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

const baseDatabase = postgresConfigFromEnvironment();
const appPool = createPostgresPool(process.env.MALIGN_APP_DATABASE_URL === undefined
  ? baseDatabase : { connectionString: process.env.MALIGN_APP_DATABASE_URL, max: 12 });
const outboxPool = createPostgresPool(process.env.MALIGN_OUTBOX_DATABASE_URL === undefined
  ? baseDatabase : { connectionString: process.env.MALIGN_OUTBOX_DATABASE_URL, max: 4 });
const listenerPool = createPostgresPool(process.env.MALIGN_LISTENER_DATABASE_URL === undefined
  ? baseDatabase : { connectionString: process.env.MALIGN_LISTENER_DATABASE_URL, max: 2 });

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
const realtime = new ProductiveRealtimeServer(
  process.env.MALIGN_NODE_ID ?? randomUUID(),
  application,
  authn,
  memberships,
  sessions,
  new InMemoryRealtimeMetrics(),
  new JsonLineRealtimeLogger(),
  {
    ...defaultRealtimeOperationalConfig(allowedOrigins),
    feedBatchSize: positiveInteger('MALIGN_REALTIME_FEED_BATCH_SIZE', 100),
    shutdownGraceMilliseconds: positiveInteger('MALIGN_SHUTDOWN_GRACE_MS', 10_000),
  },
);

const tlsKeyPath = process.env.MALIGN_TLS_KEY_PATH?.trim() || undefined;
const tlsCertificatePath = process.env.MALIGN_TLS_CERT_PATH?.trim() || undefined;
if ((tlsKeyPath === undefined) !== (tlsCertificatePath === undefined)) {
  throw new Error('Both MALIGN_TLS_KEY_PATH and MALIGN_TLS_CERT_PATH are required for TLS');
}
if (process.env.NODE_ENV === 'production' && tlsKeyPath === undefined) {
  throw new Error('TLS is required for the productive transport');
}
const server = createAuthoritativeHttpServer({
  application,
  authn,
  memberships,
  sessions,
  realtime,
  readiness: async () => { await appPool.query('SELECT 1'); return true; },
  ...(tlsKeyPath === undefined || tlsCertificatePath === undefined ? {} : {
    serverFactory: (listener) => createHttpsServer({
      key: readFileSync(tlsKeyPath), cert: readFileSync(tlsCertificatePath),
    }, listener),
  }),
});

const fanoutMetrics = new InMemoryFanoutMetrics();
const dedicatedListenerPool: DedicatedPostgresPool = {
  async connect(): Promise<DedicatedPostgresClient> {
    const client = await listenerPool.connect();
    const adapter: DedicatedPostgresClient = {
      query: (text, values) => client.query(text, [...(values ?? [])]),
      on(event, callback) {
        if (event === 'notification') {
          client.on('notification', callback as (notification: PostgresNotification) => void);
        } else if (event === 'error') {
          client.on('error', callback as (error: Error) => void);
        } else {
          client.on('end', callback as () => void);
        }
        return adapter;
      },
      removeAllListeners() { client.removeAllListeners(); return adapter; },
      release() { client.release(); },
    };
    return adapter;
  },
  query: (text, values) => listenerPool.query(text, [...(values ?? [])]),
};
const listener = new PostgresRealtimeWakeupListener(
  dedicatedListenerPool,
  (gameId) => gameId === undefined ? realtime.wakeAll() : realtime.wakeGame(gameId),
  fanoutMetrics,
  positiveInteger('MALIGN_REALTIME_CATCHUP_MS', 5_000),
);
const pump = new RealtimeOutboxPump(new PostgresOutboxPublisher(outboxPool), outboxPool, fanoutMetrics);
let stopping = false;

await listener.start();
const publisherTimer = setInterval(() => { void pump.publishOne().catch(() => undefined); }, 100);
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
