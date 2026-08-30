import type { ClaimedOutboxMessage } from '@malign-ai/persistence';

export interface PostgresNotification {
  readonly channel: string;
  readonly payload?: string | undefined;
}

export interface DedicatedPostgresClient {
  query(text: string, values?: readonly unknown[]): Promise<unknown>;
  on<E extends 'notification' | 'error' | 'end'>(
    event: E,
    listener: E extends 'notification'
      ? (notification: PostgresNotification) => void
      : E extends 'error' ? (error: Error) => void : () => void,
  ): this;
  removeAllListeners(): this;
  release(): void;
}

export interface DedicatedPostgresPool {
  connect(): Promise<DedicatedPostgresClient>;
  query(text: string, values?: readonly unknown[]): Promise<unknown>;
}

export interface FanoutMetricsPort {
  add(name: 'notify.received' | 'notify.reconnects' | 'notify.invalid' | 'catchup.runs' | 'publisher.sent', delta?: number): void;
  observe(name: 'notify.lag_ms' | 'outbox.lag_ms' | 'catchup.size', value: number): void;
}

export class InMemoryFanoutMetrics implements FanoutMetricsPort {
  readonly #values = new Map<string, number>();
  add(name: string, delta = 1): void { this.#values.set(name, (this.#values.get(name) ?? 0) + delta); }
  observe(name: string, value: number): void { this.#values.set(name, value); }
  snapshot(): Readonly<Record<string, number>> { return Object.fromEntries(this.#values); }
}

const decodeWakeup = (payload: string | undefined): { readonly gameId: string; readonly outboxSequence?: number } | undefined => {
  if (payload === undefined || Buffer.byteLength(payload) > 512) return undefined;
  try {
    const parsed: unknown = JSON.parse(payload);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const keys = Object.keys(parsed);
    if (keys.some((key) => key !== 'gameId' && key !== 'outboxSequence')) return undefined;
    const gameId: unknown = Reflect.get(parsed, 'gameId');
    const outboxSequence: unknown = Reflect.get(parsed, 'outboxSequence');
    if (typeof gameId !== 'string' || gameId.length === 0 || gameId.length > 160) return undefined;
    if (outboxSequence !== undefined && (!Number.isSafeInteger(outboxSequence) || Number(outboxSequence) < 0)) return undefined;
    return { gameId, ...(typeof outboxSequence === 'number' ? { outboxSequence } : {}) };
  } catch { return undefined; }
};

/** Dedicated LISTEN connection. NOTIFY is only a wake-up; every callback rereads durable state. */
export class PostgresRealtimeWakeupListener {
  #client: DedicatedPostgresClient | undefined;
  #catchupTimer: NodeJS.Timeout | undefined;
  #reconnectTimer: NodeJS.Timeout | undefined;
  #stopping = false;
  readonly #lastOutboxByGame = new Map<string, number>();

  constructor(
    private readonly pool: DedicatedPostgresPool,
    private readonly onDurableWakeup: (gameId?: string) => Promise<void>,
    private readonly metrics: FanoutMetricsPort,
    private readonly catchupIntervalMilliseconds = 5_000,
    private readonly reconnectDelayMilliseconds = 250,
  ) {}

  async start(): Promise<void> {
    this.#stopping = false;
    await this.connectAndCatchup();
    this.#catchupTimer = setInterval(() => {
      void this.catchup();
    }, this.catchupIntervalMilliseconds);
    this.#catchupTimer.unref();
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    if (this.#catchupTimer !== undefined) clearInterval(this.#catchupTimer);
    if (this.#reconnectTimer !== undefined) clearTimeout(this.#reconnectTimer);
    const client = this.#client;
    this.#client = undefined;
    if (client !== undefined) {
      try { await client.query('UNLISTEN malign_realtime_wakeup'); } finally {
        client.removeAllListeners();
        client.release();
      }
    }
  }

  private async connectAndCatchup(): Promise<void> {
    if (this.#stopping) return;
    const client = await this.pool.connect();
    this.#client = client;
    client.on('notification', (notification) => { void this.notification(notification); });
    client.on('error', () => this.disconnected());
    client.on('end', () => this.disconnected());
    await client.query('LISTEN malign_realtime_wakeup');
    await this.catchup();
  }

  private async notification(notification: PostgresNotification): Promise<void> {
    const started = performance.now();
    if (notification.channel !== 'malign_realtime_wakeup') return;
    const wakeup = decodeWakeup(notification.payload);
    if (wakeup === undefined) { this.metrics.add('notify.invalid'); return; }
    const previous = this.#lastOutboxByGame.get(wakeup.gameId) ?? 0;
    if (wakeup.outboxSequence !== undefined && wakeup.outboxSequence <= previous) return;
    if (wakeup.outboxSequence !== undefined) this.#lastOutboxByGame.set(wakeup.gameId, wakeup.outboxSequence);
    this.metrics.add('notify.received');
    await this.onDurableWakeup(wakeup.gameId);
    this.metrics.observe('notify.lag_ms', performance.now() - started);
  }

  private async catchup(): Promise<void> {
    if (this.#stopping) return;
    this.metrics.add('catchup.runs');
    await this.onDurableWakeup();
  }

  private disconnected(): void {
    if (this.#stopping || this.#reconnectTimer !== undefined) return;
    this.#client?.removeAllListeners();
    this.#client?.release();
    this.#client = undefined;
    this.metrics.add('notify.reconnects');
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined;
      void this.connectAndCatchup().catch(() => this.disconnected());
    }, this.reconnectDelayMilliseconds);
    this.#reconnectTimer.unref();
  }
}

/** Durable outbox claim/send/ack loop. Browser ACK remains a separate realtime concern. */
export class RealtimeOutboxPump {
  #acceptingClaims = true;
  #active: Promise<boolean> | undefined;

  constructor(
    private readonly publisher: OutboxPublisherPort,
    private readonly database: Pick<DedicatedPostgresPool, 'query'>,
    private readonly metrics: FanoutMetricsPort,
  ) {}

  async publishOne(gameId?: string): Promise<boolean> {
    if (!this.#acceptingClaims || this.#active !== undefined) return false;
    this.#active = this.publishClaim(gameId);
    try { return await this.#active; } finally { this.#active = undefined; }
  }

  async drainAndStop(): Promise<void> {
    this.#acceptingClaims = false;
    if (this.#active !== undefined) await this.#active;
  }

  private async publishClaim(gameId?: string): Promise<boolean> {
    const started = performance.now();
    const message = await this.publisher.claimOne(30_000, gameId);
    if (message === undefined) return false;
    await this.publisher.deliver(message, async (claimed) => this.notifyAfterCommit(claimed));
    await this.publisher.acknowledge(message);
    this.metrics.add('publisher.sent');
    this.metrics.observe('outbox.lag_ms', performance.now() - started);
    return true;
  }

  private async notifyAfterCommit(message: ClaimedOutboxMessage): Promise<string> {
    const payload = JSON.stringify({ gameId: message.gameId, outboxSequence: message.outboxSequence });
    await this.database.query('SELECT pg_notify($1,$2)', ['malign_realtime_wakeup', payload]);
    return message.deduplicationKey;
  }
}

export interface OutboxPublisherPort {
  claimOne(leaseMilliseconds?: number, gameId?: string): Promise<ClaimedOutboxMessage | undefined>;
  deliver(
    message: ClaimedOutboxMessage,
    sender: (message: ClaimedOutboxMessage) => Promise<string | undefined>,
  ): Promise<void>;
  acknowledge(message: ClaimedOutboxMessage): Promise<void>;
}
