import { describe, expect, it } from 'vitest';
import {
  createM1StateSnapshot,
  hashM1GameplayState,
  rehydrateM1StateSnapshot,
} from '../../packages/game-engine/src/index.js';
import {
  InMemoryProjectedEventConsumer,
  type M1RealtimeDelivery,
} from '../../apps/server/src/m1-realtime.js';
import {
  GAME_ID,
  FULL_CAMPAIGN,
  runActivation,
  runConstruct,
} from '../m1-2/test-fixtures.js';
import { sessionId } from '../m1-0/test-fixtures.js';
import {
  connectConsumer,
  RECONNECT_FIXTURE,
  realtimeAdjudicationHarness,
  rehydratedRealtimeHarness,
} from './test-fixtures.js';

const lastDelivery = (
  deliveries: readonly M1RealtimeDelivery[],
): M1RealtimeDelivery => {
  const delivery = deliveries.at(-1);
  if (delivery === undefined) throw new Error('Expected a realtime delivery');
  return delivery;
};

describe('M1-3 canonical realtime and reconnect gate', () => {
  it('GE-M1-RT-001 performs race-free initial sync and applies the intervening commit exactly once', () => {
    const testHarness = realtimeAdjudicationHarness();
    const initial = testHarness.app.getM1InitialSync(sessionId('P1'), GAME_ID);
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;

    const concurrent = runConstruct(testHarness);
    expect(concurrent.status).toBe('RESOLVED');

    const consumer = new InMemoryProjectedEventConsumer();
    consumer.initialize(initial.value);
    const subscribed = testHarness.app.subscribeM1Realtime(
      sessionId('P1'),
      GAME_ID,
      initial.value.cursor,
      consumer.receive,
    );
    expect(subscribed.ok).toBe(true);
    if (!subscribed.ok) return;
    const campaignCreated = subscribed.value.catchup.events.filter(({ eventType }) =>
      eventType === RECONNECT_FIXTURE.initial_sync.concurrent_commit,
    );
    expect(campaignCreated).toHaveLength(RECONNECT_FIXTURE.initial_sync.expected_application_count);
    expect(new Set(campaignCreated.map(({ eventId }) => eventId)).size).toBe(1);
    expect(consumer.cursor).toEqual(subscribed.value.catchup.cursor);
    expect(consumer.projection).toEqual(subscribed.value.catchup.projection);
  });

  it('GE-M1-RT-002 broadcasts the same public meaning with canonical identity to every viewer', () => {
    const testHarness = realtimeAdjudicationHarness();
    const p1 = connectConsumer(testHarness, 'P1');
    const p2 = connectConsumer(testHarness, 'P2');
    const f1 = connectConsumer(testHarness, 'F1');
    expect(runConstruct(testHarness).status).toBe('RESOLVED');

    const deliveries = [p1, p2, f1].map(({ subscriptionId }) =>
      lastDelivery(testHarness.realtime.deliveriesFor(subscriptionId)),
    );
    const publicIdentity = deliveries.map(({ events }) =>
      events.map(({ eventId, eventType, sequenceNumber, gameVersion }) => ({
        eventId,
        eventType,
        sequenceNumber,
        gameVersion,
      })),
    );
    expect(publicIdentity[1]).toEqual(publicIdentity[0]);
    expect(publicIdentity[2]).toEqual(publicIdentity[0]);
    expect(deliveries.map(({ events }) => events.find(({ eventType }) =>
      eventType === 'CAMPAIGN_CREATED')?.payload.campaignId)).toEqual([
      FULL_CAMPAIGN.campaign_id,
      FULL_CAMPAIGN.campaign_id,
      FULL_CAMPAIGN.campaign_id,
    ]);
  });

  it('GE-M1-RT-003 sends a private pending event only to its owner and F1', () => {
    const testHarness = realtimeAdjudicationHarness({ includeNarrative: false });
    const p1 = connectConsumer(testHarness, 'P1');
    const p2 = connectConsumer(testHarness, 'P2');
    const f1 = connectConsumer(testHarness, 'F1');
    expect(runConstruct(testHarness).status).toBe('RESOLVED');
    expect(runActivation(testHarness).status).toBe('REQUIRES_CHOICE');

    const ownerEvents = lastDelivery(testHarness.realtime.deliveriesFor(p1.subscriptionId)).events;
    const rivalEvents = lastDelivery(testHarness.realtime.deliveriesFor(p2.subscriptionId)).events;
    const facilitatorEvents = lastDelivery(testHarness.realtime.deliveriesFor(f1.subscriptionId)).events;
    expect(ownerEvents.some(({ eventType }) => eventType === 'NARRATIVE_REQUESTED')).toBe(true);
    expect(facilitatorEvents.some(({ eventType }) => eventType === 'NARRATIVE_REQUESTED')).toBe(true);
    expect(rivalEvents.some(({ eventType }) => eventType === 'NARRATIVE_REQUESTED')).toBe(false);
    expect(JSON.stringify(rivalEvents)).not.toContain('narrative-request');
    expect(JSON.stringify(rivalEvents)).not.toContain('pendingResolution');
  });

  it('GE-M1-RT-004 gives F1 the audited allowed stream without future deck order', () => {
    const testHarness = realtimeAdjudicationHarness({ includeNarrative: false });
    const f1 = connectConsumer(testHarness, 'F1');
    expect(runConstruct(testHarness).status).toBe('RESOLVED');
    expect(runActivation(testHarness).status).toBe('REQUIRES_CHOICE');
    const delivery = lastDelivery(testHarness.realtime.deliveriesFor(f1.subscriptionId));
    const serialized = JSON.stringify(delivery);
    expect(delivery.events.find(({ eventType }) => eventType === 'NARRATIVE_REQUESTED')?.payload)
      .toHaveProperty('pendingResolutionDigest');
    expect(serialized).not.toContain('operationsDeckOrder');
    expect(serialized).not.toContain('futureDeckOrder');
    expect(serialized).not.toContain('topCardIdentity');
  });

  it('GE-M1-RT-005 never places the actor raw CommandResult on a rival channel', () => {
    const testHarness = realtimeAdjudicationHarness();
    const p2 = connectConsumer(testHarness, 'P2');
    const rawResult = runConstruct(testHarness);
    expect(rawResult.status).toBe('RESOLVED');
    const serialized = JSON.stringify(testHarness.realtime.deliveriesFor(p2.subscriptionId));
    expect(serialized).not.toContain('resultCode');
    expect(serialized).not.toContain('emittedEventRefs');
    expect(serialized).not.toContain('adjudicationTraceRefs');
    expect(serialized).not.toContain(rawResult.commandId);
    expect(testHarness.realtime.deliveriesFor(p2.subscriptionId).flatMap(({ events }) => events)
      .every(({ kind }) => kind === 'PROJECTED_EVENT')).toBe(true);
  });

  it('GE-M1-RT-006 publishes nothing for rejected commands or rolled-back transactions', () => {
    const rejectedHarness = realtimeAdjudicationHarness();
    const rejectedSubscriber = connectConsumer(rejectedHarness, 'P1');
    const rejectedBefore = rejectedHarness.store.snapshot(GAME_ID)!;
    const stale = rejectedHarness.engine.runNext({
      gameId: GAME_ID,
      expectedGameVersion: rejectedBefore.version - 1,
      commandId: 'm1-rt-rejected-stale',
      idempotencyKey: 'm1-rt-rejected-stale',
    });
    expect(stale.resultCode).toBe('STALE_STATE_VERSION');
    expect(rejectedHarness.realtime.deliveriesFor(rejectedSubscriber.subscriptionId)).toHaveLength(0);

    const rollbackHarness = realtimeAdjudicationHarness({ die: 11 });
    const rollbackSubscriber = connectConsumer(rollbackHarness, 'P1');
    expect(runConstruct(rollbackHarness).status).toBe('RESOLVED');
    const deliveryCount = rollbackHarness.realtime.deliveriesFor(rollbackSubscriber.subscriptionId).length;
    const before = rollbackHarness.store.snapshot(GAME_ID)!;
    expect(runActivation(rollbackHarness).resultCode).toBe('RANDOM_PROVIDER_FAILURE');
    const after = rollbackHarness.store.snapshot(GAME_ID)!;
    expect(after.version).toBe(before.version);
    expect(after.events).toEqual(before.events);
    expect(after.resourceLedger).toEqual(before.resourceLedger);
    expect(rollbackHarness.realtime.deliveriesFor(rollbackSubscriber.subscriptionId)).toHaveLength(deliveryCount);
    expect(rollbackHarness.random.cursor).toBe(0);
  });

  it('GE-M1-RT-007 deduplicates duplicate delivery by canonical event identity and sequence', () => {
    const testHarness = realtimeAdjudicationHarness();
    const p1 = connectConsumer(testHarness, 'P1');
    expect(runConstruct(testHarness).status).toBe('RESOLVED');
    const appliedOnce = p1.consumer.appliedEventCount;
    testHarness.realtime.redeliver(p1.subscriptionId, 0);
    expect(p1.consumer.appliedEventCount).toBe(appliedOnce);
    expect(p1.consumer.lastResult).toMatchObject({
      status: 'DEDUPLICATED',
      appliedEvents: 0,
      duplicateEvents: appliedOnce,
    });
  });

  it('GE-M1-RT-008 detects a delivery gap and recovers to the latest authorized projection', () => {
    const testHarness = realtimeAdjudicationHarness();
    const p1 = connectConsumer(testHarness, 'P1');
    testHarness.realtime.dropNextDelivery(p1.subscriptionId);
    expect(runConstruct(testHarness).status).toBe('RESOLVED');
    expect(testHarness.realtime.droppedDeliveriesFor(p1.subscriptionId)).toHaveLength(
      RECONNECT_FIXTURE.known_gap.drop_delivery,
    );
    expect(runActivation(testHarness).status).toBe('RESOLVED');
    expect(p1.consumer.lastResult?.status).toBe('GAP_DETECTED');
    const cursorBeforeRecovery = p1.consumer.cursor;
    expect(cursorBeforeRecovery).toBeDefined();
    const feed = testHarness.app.getM1EventFeed(sessionId('P1'), GAME_ID, cursorBeforeRecovery);
    expect(feed.ok).toBe(true);
    if (!feed.ok) return;
    p1.consumer.recover(feed.value);
    const latest = testHarness.app.getM1InitialSync(sessionId('P1'), GAME_ID);
    expect(latest.ok).toBe(true);
    if (!latest.ok) return;
    expect(p1.consumer.cursor).toEqual(latest.value.cursor);
    expect(p1.consumer.projection).toEqual(latest.value.projection);
    expect(testHarness.app.getM1EventFeed(sessionId('P1'), GAME_ID, {
      ...latest.value.cursor,
      viewerParticipantId: 'P2',
      projectionId: 'PLAYER:P2',
    })).toMatchObject({ ok: false, error: { code: 'REALTIME_CURSOR_SCOPE_MISMATCH' } });
    expect(testHarness.app.getM1EventFeed(sessionId('P1'), GAME_ID, {
      ...latest.value.cursor,
      lastSequenceNumber: latest.value.cursor.lastSequenceNumber + 1,
    })).toMatchObject({ ok: false, error: { code: 'REALTIME_CURSOR_INVALID' } });
    expect(testHarness.app.getM1EventFeed(sessionId('P1'), 'other-game', latest.value.cursor))
      .toMatchObject({ ok: false, error: { code: 'GAME_ID_MISMATCH' } });
  });

  it('GE-M1-RT-009 reconnects the designated actor with pending interaction and no mutation or RNG', () => {
    const source = realtimeAdjudicationHarness({ includeNarrative: false });
    expect(runConstruct(source).status).toBe('RESOLVED');
    expect(runActivation(source).status).toBe('REQUIRES_CHOICE');
    const pendingState = source.store.snapshot(GAME_ID)!;
    const snapshot = createM1StateSnapshot(pendingState);
    expect(typeof snapshot.canonicalStateJson).toBe('string');
    const restoredState = rehydrateM1StateSnapshot(snapshot);
    const restored = rehydratedRealtimeHarness(restoredState);
    const before = restored.store.snapshot(GAME_ID)!;
    const beforeRandomCursor = restored.random.cursor;
    const reconnect = restored.app.reconnectM1(sessionId('P1'), GAME_ID, () => undefined);
    expect(reconnect.ok).toBe(true);
    if (!reconnect.ok) return;
    expect(reconnect.value.projection.pendingNarrativeRequest?.actorParticipantId).toBe('P1');
    expect(reconnect.value.cursor.gameVersion).toBe(before.version);
    const after = restored.store.snapshot(GAME_ID)!;
    expect(hashM1GameplayState(after)).toBe(hashM1GameplayState(before));
    expect(after).toEqual(before);
    expect(restored.random.cursor).toBe(beforeRandomCursor);
    expect(after.adjudication.pendingResolution?.kind).toBe(RECONNECT_FIXTURE.pending_resolution.kind);
  });

  it('GE-M1-RT-010 reconnects a rival with the same fully redacted authorized projection', () => {
    const source = realtimeAdjudicationHarness({ includeNarrative: false });
    expect(runConstruct(source).status).toBe('RESOLVED');
    expect(runActivation(source).status).toBe('REQUIRES_CHOICE');
    const pendingState = source.store.snapshot(GAME_ID)!;
    const p1HandCard = pendingState.strategy.P1?.handCardInstanceIds[0];
    const futureDeckCard = pendingState.strategy.P1?.operationsDeckOrder[0];
    const restored = rehydratedRealtimeHarness(
      rehydrateM1StateSnapshot(createM1StateSnapshot(pendingState)),
    );
    const normal = restored.app.getM1InitialSync(sessionId('P2'), GAME_ID);
    const reconnect = restored.app.reconnectM1(sessionId('P2'), GAME_ID, () => undefined);
    expect(normal.ok).toBe(true);
    expect(reconnect.ok).toBe(true);
    if (!normal.ok || !reconnect.ok) return;
    expect(reconnect.value.projection).toEqual(normal.value.projection);
    expect(reconnect.value.projection.pendingNarrativeRequest).toBeUndefined();
    expect(reconnect.value.projection.pendingChoice).toBeUndefined();
    const fromOrigin = {
      ...normal.value.cursor,
      gameVersion: 0,
      lastSequenceNumber: 0,
    };
    const feed = restored.app.getM1EventFeed(sessionId('P2'), GAME_ID, fromOrigin);
    expect(feed.ok).toBe(true);
    const serialized = JSON.stringify({ reconnect: reconnect.value, feed });
    if (p1HandCard !== undefined) expect(serialized).not.toContain(p1HandCard);
    if (futureDeckCard !== undefined) expect(serialized).not.toContain(futureDeckCard);
    expect(serialized).not.toContain('pendingResolutionJson');
    expect(serialized).not.toContain('operationsDeckOrder');
    expect(serialized).not.toContain('optionAttributionById');
  });
});
