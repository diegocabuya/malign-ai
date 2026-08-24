import { describe, expect, it } from 'vitest';
import type { SetupGameEvent } from '../../packages/domain/src/index.js';
import {
  createM1StateSnapshot,
  rehydrateM1StateSnapshot,
} from '../../packages/game-engine/src/index.js';
import {
  InMemoryProjectedEventConsumer,
  type M1RealtimeDelivery,
  type ProjectedM1Event,
} from '../../apps/server/src/m1-realtime.js';
import {
  GAME_ID,
  planningState,
  runActivation,
  runConstruct,
} from '../m1-2/test-fixtures.js';
import { command, sessionId } from '../m1-0/test-fixtures.js';
import { constructSlot, savePlan, seedSecretObjectives } from '../m1-1/test-fixtures.js';
import {
  connectConsumer,
  realtimeAdjudicationHarness,
  realtimePlanningHarness,
  rehydratedRealtimeHarness,
} from './test-fixtures.js';

const originCursor = <T extends { readonly gameVersion: number; readonly lastSequenceNumber: number }>(cursor: T): T => ({
  ...cursor,
  gameVersion: 0,
  lastSequenceNumber: 0,
});

const projectedShape = (event: SetupGameEvent): ProjectedM1Event => ({
  kind: 'PROJECTED_EVENT',
  eventId: event.eventId,
  gameId: event.gameId,
  eventType: event.eventType,
  sequenceNumber: event.sequenceNumber,
  gameVersion: event.gameVersion,
  actorType: event.actorType,
  actorParticipantId: event.actorParticipantId,
  payloadSchemaVersion: event.payloadSchemaVersion,
  versions: structuredClone(event.versions),
  correlationId: event.correlationId,
  causationId: event.causationId,
  visibilityClass: event.visibilityClass,
  occurredAt: event.occurredAt,
  payload: structuredClone(event.payload),
});

const latestDelivery = (deliveries: readonly M1RealtimeDelivery[]): M1RealtimeDelivery => {
  const delivery = deliveries.at(-1);
  if (delivery === undefined) throw new Error('Expected a realtime delivery');
  return delivery;
};

describe('M1-3 corrections — M13-R01…R06', () => {
  it('M13-R01 publishes only after state, idempotency and RNG are stable', () => {
    const testHarness = realtimeAdjudicationHarness();
    expect(runConstruct(testHarness).status).toBe('RESOLVED');
    const p1 = connectConsumer(testHarness, 'P1');
    const idempotencyBefore = testHarness.store.idempotencyCount();
    let observed: { readonly idempotency: number; readonly rng: number; readonly traces: number } | undefined;
    testHarness.store.onCommitted((_before, after) => {
      observed = {
        idempotency: testHarness.store.idempotencyCount(),
        rng: testHarness.random.cursor,
        traces: after.adjudication.traces.length,
      };
    });

    const result = runActivation(testHarness);

    expect(result.status).toBe('RESOLVED');
    expect(observed).toEqual({ idempotency: idempotencyBefore + 1, rng: 1, traces: 1 });
    expect(testHarness.realtime.deliveriesFor(p1.subscriptionId)).toHaveLength(1);
  });

  it('M13-R01 returns the original result to a synchronous observer retry without duplicates', () => {
    const testHarness = realtimeAdjudicationHarness();
    const p1 = connectConsumer(testHarness, 'P1');
    const before = testHarness.store.snapshot(GAME_ID)!;
    const idempotencyBefore = testHarness.store.idempotencyCount();
    const options = {
      gameId: GAME_ID,
      expectedGameVersion: before.version,
      commandId: 'm13-r01-sync-retry',
      idempotencyKey: 'm13-r01-sync-retry',
      correlationId: 'm13-r01-sync-retry',
    } as const;
    let retry: ReturnType<typeof testHarness.engine.runNext> | undefined;
    testHarness.store.onCommitted(() => { retry = testHarness.engine.runNext(options); });

    const first = testHarness.engine.runNext(options);
    const after = testHarness.store.snapshot(GAME_ID)!;

    expect(retry).toEqual(first);
    expect(after.version).toBe(before.version + 1);
    expect(after.events.length - before.events.length).toBe(first.emittedEventRefs.length);
    expect(testHarness.store.idempotencyCount()).toBe(idempotencyBefore + 1);
    expect(testHarness.realtime.deliveriesFor(p1.subscriptionId)).toHaveLength(1);
  });

  it('M13-R01/R02 isolates failing observers and handlers from every other subscriber', () => {
    const testHarness = realtimeAdjudicationHarness();
    const broken = connectConsumer(testHarness, 'P1', () => { throw new Error('broken subscriber'); });
    const p2 = connectConsumer(testHarness, 'P2');
    const f1 = connectConsumer(testHarness, 'F1');
    let healthyObserverCalled = false;
    testHarness.store.onCommitted(() => { throw new Error('broken observer'); });
    testHarness.store.onCommitted(() => { healthyObserverCalled = true; });

    expect(runConstruct(testHarness).status).toBe('RESOLVED');

    expect(testHarness.realtime.handlerErrorsFor(broken.subscriptionId)).toHaveLength(1);
    expect(testHarness.realtime.deliveriesFor(p2.subscriptionId)).toHaveLength(1);
    expect(testHarness.realtime.deliveriesFor(f1.subscriptionId)).toHaveLength(1);
    expect(p2.consumer.appliedEventCount).toBeGreaterThan(0);
    expect(f1.consumer.appliedEventCount).toBeGreaterThan(0);
    expect(healthyObserverCalled).toBe(true);
    expect(testHarness.store.commitListenerErrors()).toHaveLength(1);
    const recovery = testHarness.app.getM1EventFeed(
      sessionId('P1'),
      GAME_ID,
      broken.consumer.cursor,
    );
    expect(recovery.ok).toBe(true);
    if (recovery.ok) expect(recovery.value.events.length).toBeGreaterThan(0);
  });

  it('M13-R02 reconnect initializes a real consumer before activating buffered delivery', () => {
    const source = realtimeAdjudicationHarness({ includeNarrative: false });
    expect(runConstruct(source).status).toBe('RESOLVED');
    expect(runActivation(source).status).toBe('REQUIRES_CHOICE');
    const restored = rehydratedRealtimeHarness(
      rehydrateM1StateSnapshot(createM1StateSnapshot(source.store.snapshot(GAME_ID)!)),
    );
    const before = restored.store.snapshot(GAME_ID)!;
    const randomBefore = restored.random.cursor;

    const reconnect = restored.app.reconnectM1(sessionId('P1'), GAME_ID);
    expect(reconnect.ok).toBe(true);
    if (!reconnect.ok) return;
    expect(restored.realtime.deliveriesFor(reconnect.value.subscription.subscriptionId)).toHaveLength(0);
    const consumer = new InMemoryProjectedEventConsumer();
    consumer.initialize(reconnect.value);
    const activated = restored.app.activateM1Realtime(
      sessionId('P1'),
      GAME_ID,
      reconnect.value.subscription,
      consumer.receive,
    );

    expect(activated.ok).toBe(true);
    expect(consumer.projection?.pendingNarrativeRequest?.actorParticipantId).toBe('P1');
    expect(restored.store.snapshot(GAME_ID)).toEqual(before);
    expect(restored.random.cursor).toBe(randomBefore);
  });

  it('M13-R02 buffers a commit after registration and before catch-up activation', () => {
    const testHarness = realtimeAdjudicationHarness();
    const initial = testHarness.app.getM1InitialSync(sessionId('P1'), GAME_ID);
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    const subscription = testHarness.app.subscribeM1Realtime(sessionId('P1'), GAME_ID, initial.value.cursor);
    expect(subscription.ok).toBe(true);
    if (!subscription.ok) return;

    expect(runConstruct(testHarness).status).toBe('RESOLVED');
    expect(testHarness.realtime.deliveriesFor(subscription.value.subscription.subscriptionId)).toHaveLength(0);
    const consumer = new InMemoryProjectedEventConsumer();
    consumer.initialize(initial.value);
    const activated = testHarness.app.activateM1Realtime(
      sessionId('P1'),
      GAME_ID,
      subscription.value.subscription,
      consumer.receive,
    );

    expect(activated.ok).toBe(true);
    if (!activated.ok) return;
    expect(consumer.cursor).toEqual(activated.value.catchup.cursor);
    expect(consumer.projection).toEqual(activated.value.catchup.projection);
  });

  it('M13-R02/R04 converges overlapping live and catch-up delivery exactly once', () => {
    const testHarness = realtimeAdjudicationHarness();
    const initial = testHarness.app.getM1InitialSync(sessionId('P1'), GAME_ID);
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    const subscription = testHarness.app.subscribeM1Realtime(sessionId('P1'), GAME_ID, initial.value.cursor);
    expect(subscription.ok).toBe(true);
    if (!subscription.ok) return;
    expect(runConstruct(testHarness).status).toBe('RESOLVED');
    const consumer = new InMemoryProjectedEventConsumer();
    consumer.initialize(initial.value);

    const activated = testHarness.app.activateM1Realtime(
      sessionId('P1'),
      GAME_ID,
      subscription.value.subscription,
      consumer.receive,
    );

    expect(activated.ok).toBe(true);
    if (!activated.ok) return;
    expect(testHarness.realtime.deliveriesFor(subscription.value.subscription.subscriptionId)).toHaveLength(2);
    expect(consumer.appliedEventCount).toBe(activated.value.catchup.events.length);
    expect(consumer.lastResult?.status).toBe('DEDUPLICATED');
  });

  it('M13-R03 authenticates a successful owner unsubscribe without mutating gameplay', () => {
    const testHarness = realtimeAdjudicationHarness();
    const p1 = connectConsumer(testHarness, 'P1');
    const before = testHarness.store.snapshot(GAME_ID)!;

    const result = testHarness.app.unsubscribeM1Realtime(
      sessionId('P1'),
      GAME_ID,
      { subscriptionId: p1.subscriptionId },
    );

    expect(result).toEqual({ ok: true, value: { unsubscribed: true } });
    expect(testHarness.realtime.subscriptionsForGame(GAME_ID)
      .some(({ subscriptionId }) => subscriptionId === p1.subscriptionId)).toBe(false);
    expect(testHarness.store.snapshot(GAME_ID)).toEqual(before);
  });

  it('M13-R03 rejects foreign and cross-game unsubscribe without enumeration and removes invalid sessions operationally', () => {
    const testHarness = realtimeAdjudicationHarness();
    const p1 = connectConsumer(testHarness, 'P1');
    const foreign = testHarness.app.unsubscribeM1Realtime(
      sessionId('P2'),
      GAME_ID,
      { subscriptionId: p1.subscriptionId },
    );
    const unknown = testHarness.app.unsubscribeM1Realtime(
      sessionId('P2'),
      GAME_ID,
      { subscriptionId: 'nonexistent-subscription' },
    );
    const crossGame = testHarness.app.unsubscribeM1Realtime(
      sessionId('P1'),
      'other-game',
      { subscriptionId: p1.subscriptionId },
    );

    expect(foreign).toEqual(unknown);
    expect(foreign).toMatchObject({ ok: false, error: { code: 'NOT_AUTHORIZED' } });
    expect(crossGame).toMatchObject({ ok: false, error: { code: 'GAME_ID_MISMATCH' } });
    testHarness.authority.invalidateSession(sessionId('P1'));
    expect(runConstruct(testHarness).status).toBe('RESOLVED');
    expect(testHarness.realtime.subscriptionsForGame(GAME_ID)
      .some(({ subscriptionId }) => subscriptionId === p1.subscriptionId)).toBe(false);
  });

  it('M13-R03 keeps authenticatedSessionId and internal authority out of public handles and responses', () => {
    const testHarness = realtimeAdjudicationHarness();
    const initial = testHarness.app.getM1InitialSync(sessionId('P1'), GAME_ID);
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    const subscription = testHarness.app.subscribeM1Realtime(sessionId('P1'), GAME_ID, initial.value.cursor);
    const reconnect = testHarness.app.reconnectM1(sessionId('P2'), GAME_ID);
    const serialized = JSON.stringify({ subscription, reconnect });

    expect(serialized).not.toContain('authenticatedSessionId');
    expect(serialized).not.toContain(sessionId('P1'));
    expect(serialized).not.toContain(sessionId('P2'));
    expect(subscription.ok).toBe(true);
    if (subscription.ok) expect(typeof subscription.value.subscription.subscriptionId).toBe('string');
  });

  it('M13-R04 treats an authorized private omission followed by a public event as a contiguous transport range', () => {
    const state = planningState();
    const testHarness = realtimePlanningHarness(state);
    const p2 = connectConsumer(testHarness, 'P2');
    const countBeforePrivate = testHarness.realtime.deliveriesFor(p2.subscriptionId).length;
    const privatePayload = constructSlot(state, 'P1');

    expect(savePlan(testHarness, 'P1', [privatePayload]).status).toBe('RESOLVED');
    expect(testHarness.realtime.deliveriesFor(p2.subscriptionId)).toHaveLength(countBeforePrivate);
    const beforeLock = testHarness.store.snapshot(GAME_ID)!;
    expect(testHarness.app.execute(
      sessionId('P1'),
      command('LOCK_ACTION_PLAN', GAME_ID, beforeLock.version, {}),
    ).status).toBe('RESOLVED');

    expect(p2.consumer.lastResult?.status).toBe('APPLIED');
    const delivery = latestDelivery(testHarness.realtime.deliveriesFor(p2.subscriptionId));
    expect(delivery.events.some(({ eventType }) => eventType === 'ACTION_PLAN_SAVED')).toBe(false);
    expect(JSON.stringify(delivery)).not.toContain(privatePayload.actionPayload.intentCardInstanceId);
    const feed = testHarness.app.getM1EventFeed(
      sessionId('P2'),
      GAME_ID,
      originCursor(delivery.cursor),
    );
    const reconnect = testHarness.app.reconnectM1(sessionId('P2'), GAME_ID);
    expect(JSON.stringify({ feed, reconnect })).not.toContain('ACTION_PLAN_SAVED');
    expect(JSON.stringify({ feed, reconnect })).not.toContain(privatePayload.actionPayload.intentCardInstanceId);
  });

  it('M13-R04 detects a real transport loss and recovers to the latest authorized projection', () => {
    const testHarness = realtimeAdjudicationHarness();
    const p1 = connectConsumer(testHarness, 'P1');
    testHarness.realtime.dropNextDelivery(p1.subscriptionId);
    expect(runConstruct(testHarness).status).toBe('RESOLVED');
    expect(runActivation(testHarness).status).toBe('RESOLVED');
    expect(p1.consumer.lastResult?.status).toBe('GAP_DETECTED');
    const cursor = p1.consumer.cursor;
    expect(cursor).toBeDefined();
    const feed = testHarness.app.getM1EventFeed(sessionId('P1'), GAME_ID, cursor);
    expect(feed.ok).toBe(true);
    if (!feed.ok) return;
    p1.consumer.recover(feed.value);
    const latest = testHarness.app.getM1InitialSync(sessionId('P1'), GAME_ID);
    expect(latest.ok).toBe(true);
    if (!latest.ok) return;
    expect(p1.consumer.cursor).toEqual(latest.value.cursor);
    expect(p1.consumer.projection).toEqual(latest.value.projection);
  });

  it('M13-R05/R06 applies one canonical projection policy to query, feed, initial sync and realtime', () => {
    const state = planningState();
    const testHarness = realtimePlanningHarness(state);
    seedSecretObjectives(testHarness);
    const slot = constructSlot(testHarness.store.snapshot(GAME_ID)!, 'P1');
    expect(savePlan(testHarness, 'P1', [slot]).status).toBe('RESOLVED');
    const connections = ['P1', 'P2', 'F1'].map((participantId) => ({
      participantId,
      ...connectConsumer(testHarness, participantId),
    }));
    const beforeLock = testHarness.store.snapshot(GAME_ID)!;
    expect(testHarness.app.execute(
      sessionId('P1'),
      command('LOCK_ACTION_PLAN', GAME_ID, beforeLock.version, {}),
    ).status).toBe('RESOLVED');

    for (const connection of connections) {
      const query = testHarness.app.getM1AdjudicationProjection(sessionId(connection.participantId), GAME_ID);
      const initial = testHarness.app.getM1InitialSync(sessionId(connection.participantId), GAME_ID);
      expect(query.ok).toBe(true);
      expect(initial.ok).toBe(true);
      if (!query.ok || !initial.ok) continue;
      const feed = testHarness.app.getM1EventFeed(
        sessionId(connection.participantId),
        GAME_ID,
        originCursor(initial.value.cursor),
      );
      expect(feed.ok).toBe(true);
      if (!feed.ok) continue;
      const visibleQueryEvents = query.projection.events
        .filter(({ payload }) => payload.redacted !== true)
        .map(projectedShape);
      expect(initial.value.projection.game).toEqual(query.projection.game);
      expect(initial.value.projection.audit).toEqual(query.projection.audit);
      expect(initial.value.projection.events).toEqual(visibleQueryEvents);
      expect(feed.value.events).toEqual(visibleQueryEvents);
      const delivery = latestDelivery(testHarness.realtime.deliveriesFor(connection.subscriptionId));
      expect(delivery.events).toEqual(visibleQueryEvents.filter(({ sequenceNumber }) =>
        sequenceNumber > delivery.fromCursor.lastSequenceNumber &&
        sequenceNumber <= delivery.cursor.lastSequenceNumber,
      ));
      expect(JSON.stringify({ query, initial, feed, delivery })).not.toContain('pendingResolutionJson');
      expect(JSON.stringify({ initial, feed, delivery })).not.toContain('operationsDeckOrder');
    }
  });
});
