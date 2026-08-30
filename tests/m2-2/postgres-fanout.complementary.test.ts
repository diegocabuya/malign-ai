import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  InMemoryFanoutMetrics,
  PostgresRealtimeWakeupListener,
  type DedicatedPostgresClient,
  type DedicatedPostgresPool,
  type PostgresNotification,
} from '../../apps/server/src/realtime-postgres.js';

class FakeClient extends EventEmitter implements DedicatedPostgresClient {
  readonly queries: string[] = [];
  released = false;
  query(text: string): Promise<unknown> { this.queries.push(text); return Promise.resolve({}); }
  override on<E extends 'notification' | 'error' | 'end'>(
    event: E,
    listener: E extends 'notification'
      ? (notification: PostgresNotification) => void
      : E extends 'error' ? (error: Error) => void : () => void,
  ): this { return super.on(event, listener); }
  override removeAllListeners(): this { return super.removeAllListeners(); }
  release(): void { this.released = true; }
}

class FakePool implements DedicatedPostgresPool {
  readonly clients: FakeClient[] = [];
  failConnections = 0;
  connect(): Promise<FakeClient> {
    if (this.failConnections > 0) { this.failConnections -= 1; return Promise.reject(new Error('database unavailable')); }
    const client = new FakeClient();
    this.clients.push(client);
    return Promise.resolve(client);
  }
  query(): Promise<unknown> { return Promise.resolve({}); }
}

afterEach(() => vi.useRealTimers());

describe('M2-2 PostgreSQL LISTEN/NOTIFY durable wake-up adapter', () => {
  it('confirms LISTEN before initial durable catch-up and UNLISTENs on stop', async () => {
    const pool = new FakePool();
    const order: string[] = [];
    const listener = new PostgresRealtimeWakeupListener(pool, (gameId) => {
      order.push(gameId === undefined ? 'catchup' : gameId);
      return Promise.resolve();
    }, new InMemoryFanoutMetrics(), 10_000);
    await listener.start();
    expect(pool.clients[0]?.queries[0]).toBe('LISTEN malign_realtime_wakeup');
    expect(order).toEqual(['catchup']);
    await listener.stop();
    expect(pool.clients[0]?.queries).toContain('UNLISTEN malign_realtime_wakeup');
    expect(pool.clients[0]?.released).toBe(true);
  });

  it('deduplicates duplicate/out-of-order NOTIFY and treats payload as opaque wake-up only', async () => {
    const pool = new FakePool();
    const games: string[] = [];
    const metrics = new InMemoryFanoutMetrics();
    const listener = new PostgresRealtimeWakeupListener(pool, (gameId) => {
      if (gameId !== undefined) games.push(gameId);
      return Promise.resolve();
    }, metrics, 10_000);
    await listener.start();
    const client = pool.clients[0]!;
    client.emit('notification', { channel: 'malign_realtime_wakeup', payload: JSON.stringify({ gameId: 'g1', outboxSequence: 2 }) });
    client.emit('notification', { channel: 'malign_realtime_wakeup', payload: JSON.stringify({ gameId: 'g1', outboxSequence: 2 }) });
    client.emit('notification', { channel: 'malign_realtime_wakeup', payload: JSON.stringify({ gameId: 'g1', outboxSequence: 1 }) });
    client.emit('notification', { channel: 'malign_realtime_wakeup', payload: JSON.stringify({ gameId: 'g1', outboxSequence: 3, projection: { private: true } }) });
    await Promise.resolve();
    expect(games).toEqual(['g1']);
    expect(metrics.snapshot()).toMatchObject({ 'notify.received': 1, 'notify.invalid': 1 });
    await listener.stop();
  });

  it('repairs a lost NOTIFY through periodic durable catch-up', async () => {
    vi.useFakeTimers();
    const pool = new FakePool();
    let catchups = 0;
    const listener = new PostgresRealtimeWakeupListener(pool, () => { catchups += 1; return Promise.resolve(); }, new InMemoryFanoutMetrics(), 1_000);
    await listener.start();
    expect(catchups).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(catchups).toBe(2);
    await listener.stop();
  });

  it('reconnects a failed dedicated listener and performs catch-up on the new connection', async () => {
    vi.useFakeTimers();
    const pool = new FakePool();
    let catchups = 0;
    const metrics = new InMemoryFanoutMetrics();
    const listener = new PostgresRealtimeWakeupListener(pool, () => { catchups += 1; return Promise.resolve(); }, metrics, 10_000, 250);
    await listener.start();
    pool.clients[0]?.emit('error');
    await vi.advanceTimersByTimeAsync(250);
    expect(pool.clients).toHaveLength(2);
    expect(catchups).toBe(2);
    expect(metrics.snapshot()).toMatchObject({ 'notify.reconnects': 1 });
    await listener.stop();
  });

  it('fails closed when PostgreSQL is unavailable during initial LISTEN', async () => {
    const pool = new FakePool();
    pool.failConnections = 1;
    const listener = new PostgresRealtimeWakeupListener(pool, () => Promise.resolve(), new InMemoryFanoutMetrics());
    await expect(listener.start()).rejects.toThrow('database unavailable');
    await listener.stop();
  });
});
