import { describe, expect, it } from 'vitest';

import type { ActorContext, RealtimeCursorV1 } from '../../packages/contracts/src/index.js';
import type { ClaimedOutboxMessage } from '../../packages/persistence/src/index.js';
import {
  InMemoryProjectedEventConsumer,
  type M1RealtimeDelivery,
} from '../../apps/server/src/m1-realtime.js';
import {
  InMemoryFanoutMetrics,
  RealtimeOutboxPump,
  type OutboxPublisherPort,
} from '../../apps/server/src/realtime-postgres.js';
import { PostgresMembershipAuthorityAdapter } from '../../apps/server/src/productive-authn.js';
import { sessionId } from '../m1-0/test-fixtures.js';
import {
  GAME_ID,
  planningState,
  runActivation,
  runConstruct,
} from '../m1-2/test-fixtures.js';
import { constructSlot, savePlan } from '../m1-1/test-fixtures.js';
import {
  realtimeAdjudicationHarness,
  realtimePlanningHarness,
} from '../m1-3/test-fixtures.js';
import {
  authenticate,
  clientFrame,
  connect,
  nextMessage,
  startRealtimeNode,
  subscribe,
} from './test-fixtures.js';

const actor = (participantId: string, session = `productive-${participantId}`): ActorContext => ({
  actorId: `user-${participantId.toLowerCase()}`,
  actorType: participantId === 'F1' ? 'FACILITATOR' : 'PLAYER',
  participantId,
  authenticatedSessionId: session,
  permissions: participantId === 'F1' ? ['game:facilitate', 'game:project'] : ['game:play', 'game:project'],
});

describe('M2-2 Productive Transport and Reconnect owner gate', () => {
  it('GE-M2-RT-001 verifies identity application-side and binds PostgreSQL-style membership without Engine AuthN', async () => {
    const harness = realtimeAdjudicationHarness();
    const memberships = new PostgresMembershipAuthorityAdapter({
      query: (text, values) => {
        expect(text).toContain('malign.game_memberships');
        expect(values).toEqual([GAME_ID, 'user-p1']);
        return Promise.resolve({ rows: [{
          participant_id: 'P1', external_user_ref: 'user-p1', role: 'PLAYER',
          seat_id: 'seat-p1', country_id: 'ARDEN',
        }] });
      },
    });
    const node = await startRealtimeNode(harness.app, { memberships });
    try {
      const socket = await connect(node.url);
      await authenticate(socket, 'P1');
      const subscribed = await subscribe(socket, GAME_ID);
      expect(subscribed.subscriptionId).toMatch(/^[0-9a-f-]{36}$/);
      expect(subscribed.cursor).toMatchObject({ gameId: GAME_ID, viewerParticipantId: 'P1', viewerRole: 'PLAYER' });
      expect(JSON.stringify(node.logger.entries)).not.toContain('valid-P1');
      socket.terminate();

      const rejected = await connect(node.url);
      const rejectedClose = new Promise<number>((resolve) => rejected.once('close', resolve));
      const rejectedResponse = nextMessage(rejected);
      rejected.send(clientFrame('AUTHENTICATE', { payload: { accessToken: 'invalid-token' } }));
      const error = await rejectedResponse;
      expect(error).toMatchObject({ type: 'ERROR', payload: { code: 'POLICY_REJECTED' } });
      const code = await rejectedClose;
      expect(code).toBe(1008);
    } finally { await node.close(); }
  });

  it('GE-M2-RT-002 reconnects on a different stateless node from a viewer-bound durable cursor', async () => {
    const harness = realtimeAdjudicationHarness();
    const nodeA = await startRealtimeNode(harness.app, { nodeId: 'node-a' });
    const nodeB = await startRealtimeNode(harness.app, { nodeId: 'node-b' });
    try {
      const first = await connect(nodeA.url);
      await authenticate(first);
      await subscribe(first, GAME_ID);
      expect(runConstruct(harness).status).toBe('RESOLVED');
      await nodeA.realtime.wakeGame(GAME_ID);
      const firstBatch = await nextMessage(first);
      const firstPayload = firstBatch.payload as { cursor: RealtimeCursorV1 };
      first.terminate();

      const second = await connect(nodeB.url);
      await authenticate(second);
      const reconnected = await subscribe(second, GAME_ID, firstPayload.cursor);
      expect(reconnected.cursor.lastSequenceNumber).toBeGreaterThanOrEqual(firstPayload.cursor.lastSequenceNumber);
      expect(reconnected.cursor.projectionId).toBe('PLAYER:P1');
      const foreign = { ...firstPayload.cursor, viewerParticipantId: 'P2', projectionId: 'PLAYER:P2' };
      const foreignResponse = nextMessage(second);
      second.send(clientFrame('SUBSCRIBE', { gameId: GAME_ID, payload: { afterCursor: foreign } }));
      expect(await foreignResponse).toMatchObject({ type: 'ERROR' });
      second.terminate();
    } finally { await nodeA.close(); await nodeB.close(); }
  });

  it('GE-M2-RT-003 detects n+2, recovers n+1/n+2 authoritatively and deduplicates repeated n+1', () => {
    const harness = realtimeAdjudicationHarness();
    const initial = harness.app.getM1InitialSync(sessionId('P1'), GAME_ID);
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    expect(runConstruct(harness).status).toBe('RESOLVED');
    expect(runActivation(harness).status).toBe('RESOLVED');
    const feed = harness.app.getM1EventFeed(sessionId('P1'), GAME_ID, initial.value.cursor);
    expect(feed.ok).toBe(true);
    if (!feed.ok) return;
    const [n1, n2] = feed.value.events;
    expect(n1).toBeDefined();
    expect(n2).toBeDefined();
    if (n1 === undefined || n2 === undefined) return;
    const cursorN1 = { ...initial.value.cursor, gameVersion: n1.gameVersion, lastSequenceNumber: n1.sequenceNumber };
    const cursorN2 = { ...initial.value.cursor, gameVersion: n2.gameVersion, lastSequenceNumber: n2.sequenceNumber };
    const consumer = new InMemoryProjectedEventConsumer();
    consumer.initialize(initial.value);
    consumer.receive({
      deliveryId: 'n+2', deliveryKind: 'LIVE', projection: feed.value.projection,
      fromCursor: cursorN1, cursor: cursorN2, events: [n2],
    });
    expect(consumer.lastResult?.status).toBe('GAP_DETECTED');
    expect(consumer.recover(feed.value).status).toBe('APPLIED');
    const duplicateN1: M1RealtimeDelivery = {
      deliveryId: 'n+1-repeat', deliveryKind: 'LIVE', projection: feed.value.projection,
      fromCursor: initial.value.cursor, cursor: cursorN1, events: [n1],
    };
    consumer.receive(duplicateN1);
    expect(consumer.lastResult).toMatchObject({ status: 'DEDUPLICATED', duplicateEvents: 1 });
    expect(consumer.cursor).toEqual(feed.value.cursor);
  });

  it('GE-M2-RT-004 recovers an explicit lost range to the latest authorized projection and rejects foreign cursors', () => {
    const harness = realtimeAdjudicationHarness();
    const initial = harness.app.getM1InitialSyncForActor(actor('P1'), GAME_ID);
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    expect(runConstruct(harness).status).toBe('RESOLVED');
    const feed = harness.app.getM1EventFeedForActor(actor('P1'), GAME_ID, initial.value.cursor);
    expect(feed.ok).toBe(true);
    if (!feed.ok) return;
    expect(feed.value.fromCursor).toEqual(initial.value.cursor);
    expect(feed.value.cursor.lastSequenceNumber).toBeGreaterThan(initial.value.cursor.lastSequenceNumber);
    expect(feed.value.projection).toEqual(harness.app.getM1InitialSyncForActor(actor('P1'), GAME_ID).ok
      ? (harness.app.getM1InitialSyncForActor(actor('P1'), GAME_ID) as { ok: true; value: typeof initial.value }).value.projection
      : undefined);
    expect(harness.app.getM1EventFeedForActor(actor('P1'), GAME_ID, {
      ...initial.value.cursor,
      viewerParticipantId: 'P2',
      projectionId: 'PLAYER:P2',
    })).toMatchObject({ ok: false, error: { code: 'REALTIME_CURSOR_SCOPE_MISMATCH' } });
  });

  it('GE-M2-RT-005 closes the initial-sync activation race with one catch-up delivery', () => {
    const harness = realtimeAdjudicationHarness();
    const initial = harness.app.getM1InitialSyncForActor(actor('P1'), GAME_ID);
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    expect(runConstruct(harness).status).toBe('RESOLVED');
    const catchup = harness.app.getM1EventFeedForActor(actor('P1'), GAME_ID, initial.value.cursor);
    expect(catchup.ok).toBe(true);
    if (!catchup.ok) return;
    const campaignEvents = catchup.value.events.filter(({ eventType }) => eventType === 'CAMPAIGN_CREATED');
    expect(campaignEvents).toHaveLength(1);
    expect(new Set(campaignEvents.map(({ eventId }) => eventId)).size).toBe(1);
  });

  it('GE-M2-RT-006 restores a pending continuation read-only for actor/F1 and redacts it for rival', () => {
    const harness = realtimeAdjudicationHarness({ includeNarrative: false });
    expect(runConstruct(harness).status).toBe('RESOLVED');
    expect(runActivation(harness).status).toBe('REQUIRES_CHOICE');
    const before = harness.store.snapshot(GAME_ID)!;
    const owner = harness.app.getM1InitialSyncForActor(actor('P1'), GAME_ID);
    const rival = harness.app.getM1InitialSyncForActor(actor('P2'), GAME_ID);
    const facilitator = harness.app.getM1InitialSyncForActor(actor('F1'), GAME_ID);
    expect(owner.ok && owner.value.projection.pendingNarrativeRequest?.actorParticipantId).toBe('P1');
    expect(facilitator.ok && facilitator.value.projection.pendingNarrativeRequest?.actorParticipantId).toBe('P1');
    expect(rival.ok && rival.value.projection.pendingNarrativeRequest).toBeUndefined();
    expect(harness.store.snapshot(GAME_ID)).toEqual(before);
    expect(harness.random.cursor).toBe(0);
  });

  it('GE-M2-RT-007 advances authorized cursor across a private omission without leaking or producing a false gap', () => {
    const state = planningState();
    const harness = realtimePlanningHarness(state);
    const initial = harness.app.getM1InitialSyncForActor(actor('P2'), GAME_ID);
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    const privateSlot = constructSlot(state, 'P1');
    expect(savePlan(harness, 'P1', [privateSlot]).status).toBe('RESOLVED');
    const feed = harness.app.getM1EventFeedForActor(actor('P2'), GAME_ID, initial.value.cursor);
    expect(feed.ok).toBe(true);
    if (!feed.ok) return;
    expect(feed.value.cursor.lastSequenceNumber).toBeGreaterThan(initial.value.cursor.lastSequenceNumber);
    expect(feed.value.events.some(({ eventType }) => eventType === 'ACTION_PLAN_SAVED')).toBe(false);
    expect(feed.value.projection.game.viewerPrivateState?.actionPlans.map(({ participantId }) => participantId)).toEqual(['P2']);
    expect(JSON.stringify(feed.value.events)).not.toContain(privateSlot.cardInstanceId);
  });

  it('GE-M2-RT-008 keeps gameplay commit independent from socket failure and converges outbox retry by dedup key', async () => {
    const message: ClaimedOutboxMessage = {
      id: 'outbox-1', gameId: GAME_ID, outboxSequence: 1, payload: {},
      deduplicationKey: 'event-1:PLAYER:P1', claimToken: 'claim-test-only', attemptOrdinal: 1,
    };
    let claims = 0;
    let sends = 0;
    let acknowledgements = 0;
    const publisher: OutboxPublisherPort = {
      claimOne: () => { claims += 1; return Promise.resolve(claims <= 2 ? message : undefined); },
      deliver: async (claimed, sender) => { sends += 1; if (sends === 1) throw new Error('socket down'); await sender(claimed); },
      acknowledge: () => { acknowledgements += 1; return Promise.resolve(); },
    };
    const notifications: unknown[][] = [];
    const pump = new RealtimeOutboxPump(publisher, {
      query: (_text, values) => { notifications.push([...(values ?? [])]); return Promise.resolve({}); },
    }, new InMemoryFanoutMetrics());
    await expect(pump.publishOne(GAME_ID)).rejects.toThrow('socket down');
    expect(await pump.publishOne(GAME_ID)).toBe(true);
    expect(sends).toBe(2);
    expect(acknowledgements).toBe(1);
    expect(notifications).toHaveLength(1);
    expect(JSON.stringify(notifications[0])).toContain('outboxSequence');
  });
});
