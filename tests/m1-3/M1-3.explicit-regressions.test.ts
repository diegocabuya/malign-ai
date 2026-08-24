import { describe, expect, it } from 'vitest';
import {
  GAME_ID,
  planningState,
} from '../m1-2/test-fixtures.js';
import {
  command,
  sessionId,
} from '../m1-0/test-fixtures.js';
import {
  constructSlot,
  savePlan,
  seedSecretObjectives,
} from '../m1-1/test-fixtures.js';
import {
  connectConsumer,
  realtimeAdjudicationHarness,
  realtimePlanningHarness,
} from './test-fixtures.js';

describe('M1-3 explicit cross-boundary regressions', () => {
  it('[REGRESSION] GE-CORE-003 rejects stale expected version without broadcast', () => {
    const testHarness = realtimeAdjudicationHarness();
    const p1 = connectConsumer(testHarness, 'P1');
    const before = testHarness.store.snapshot(GAME_ID)!;
    const result = testHarness.engine.runNext({
      gameId: GAME_ID,
      expectedGameVersion: before.version - 1,
      commandId: 'm1-3-regression-stale',
      idempotencyKey: 'm1-3-regression-stale',
    });
    const after = testHarness.store.snapshot(GAME_ID)!;
    expect(result.resultCode).toBe('STALE_STATE_VERSION');
    expect(after).toEqual(before);
    expect(testHarness.realtime.deliveriesFor(p1.subscriptionId)).toHaveLength(0);
  });

  it('[REGRESSION] GE-CORE-004 retries a lost response without duplicate publish, event, ledger or trace', () => {
    const testHarness = realtimeAdjudicationHarness();
    const p1 = connectConsumer(testHarness, 'P1');
    const before = testHarness.store.snapshot(GAME_ID)!;
    const options = {
      gameId: GAME_ID,
      expectedGameVersion: before.version,
      commandId: 'm1-3-regression-idempotent',
      idempotencyKey: 'm1-3-regression-idempotent',
      correlationId: 'm1-3-regression-idempotent',
    } as const;
    const first = testHarness.engine.runNext(options);
    const committed = testHarness.store.snapshot(GAME_ID)!;
    const deliveriesAfterFirst = testHarness.realtime.deliveriesFor(p1.subscriptionId);
    const retry = testHarness.engine.runNext(options);
    const afterRetry = testHarness.store.snapshot(GAME_ID)!;
    expect(first.status).toBe('RESOLVED');
    expect(retry).toEqual(first);
    expect(afterRetry).toEqual(committed);
    expect(afterRetry.events.length).toBe(committed.events.length);
    expect(afterRetry.resourceLedger.length).toBe(committed.resourceLedger.length);
    expect(afterRetry.adjudication.traces.length).toBe(committed.adjudication.traces.length);
    expect(testHarness.realtime.deliveriesFor(p1.subscriptionId)).toEqual(deliveriesAfterFirst);
  });

  it('[REGRESSION] GE-CORE-010 keeps two logical clients of one player on a single committed lock', () => {
    const state = planningState();
    const testHarness = realtimePlanningHarness(state);
    const slot = constructSlot(state, 'P1');
    expect(savePlan(testHarness, 'P1', [slot]).status).toBe('RESOLVED');
    const clientA = connectConsumer(testHarness, 'P1');
    const clientB = connectConsumer(testHarness, 'P1');
    const beforeLock = testHarness.store.snapshot(GAME_ID)!;
    const firstInput = command('LOCK_ACTION_PLAN', GAME_ID, beforeLock.version, {}, {
      commandId: 'm1-3-client-a-lock',
      idempotencyKey: 'm1-3-client-a-lock',
    });
    const secondInput = command('LOCK_ACTION_PLAN', GAME_ID, beforeLock.version, {}, {
      commandId: 'm1-3-client-b-lock',
      idempotencyKey: 'm1-3-client-b-lock',
    });
    const first = testHarness.app.execute(sessionId('P1'), firstInput);
    const second = testHarness.app.execute(sessionId('P1'), secondInput);
    const after = testHarness.store.snapshot(GAME_ID)!;
    expect(first.status).toBe('RESOLVED');
    expect(second.resultCode).toBe('STALE_STATE_VERSION');
    expect(after.actionPlanning.P1?.lockedSlots).toEqual([
      expect.objectContaining({ sequenceIndex: 1, actionPayload: slot.actionPayload }),
    ]);
    expect(after.events.filter(({ type }) => type === 'ACTION_PLAN_LOCKED')).toHaveLength(1);
    expect(testHarness.realtime.deliveriesFor(clientA.subscriptionId)).toHaveLength(1);
    expect(testHarness.realtime.deliveriesFor(clientB.subscriptionId)).toHaveLength(1);
  });

  it('[REGRESSION] GE-SEC-001 keeps P1 HAND contents out of rival channel and reconnect', () => {
    const state = planningState();
    const knownP1HandCard = state.strategy.P1?.handCardInstanceIds[0];
    expect(knownP1HandCard).toBeDefined();
    const testHarness = realtimePlanningHarness(state);
    const slot = constructSlot(state, 'P1');
    expect(savePlan(testHarness, 'P1', [slot]).status).toBe('RESOLVED');
    const p2 = connectConsumer(testHarness, 'P2');
    const beforeLock = testHarness.store.snapshot(GAME_ID)!;
    expect(testHarness.app.execute(
      sessionId('P1'),
      command('LOCK_ACTION_PLAN', GAME_ID, beforeLock.version, {}),
    ).status).toBe('RESOLVED');
    const reconnect = testHarness.app.reconnectM1(sessionId('P2'), GAME_ID, () => undefined);
    expect(reconnect.ok).toBe(true);
    const serialized = JSON.stringify({
      channel: testHarness.realtime.deliveriesFor(p2.subscriptionId),
      reconnect,
    });
    if (knownP1HandCard !== undefined) expect(serialized).not.toContain(knownP1HandCard);
    expect(serialized).not.toContain('OWNER_ONLY_P1_HAND');
  });

  it('[REGRESSION] GE-SEC-002 keeps Secret VO condition and progress out of rival channel and reconnect', () => {
    const state = planningState();
    const testHarness = realtimePlanningHarness(state);
    seedSecretObjectives(testHarness);
    const secret = testHarness.store.snapshot(GAME_ID)!.secretVictoryObjectives.P1?.[0];
    expect(secret).toBeDefined();
    const planning = testHarness.store.snapshot(GAME_ID)!;
    expect(savePlan(testHarness, 'P1', [constructSlot(planning, 'P1')]).status).toBe('RESOLVED');
    const p2 = connectConsumer(testHarness, 'P2');
    const beforeLock = testHarness.store.snapshot(GAME_ID)!;
    expect(testHarness.app.execute(
      sessionId('P1'),
      command('LOCK_ACTION_PLAN', GAME_ID, beforeLock.version, {}),
    ).status).toBe('RESOLVED');
    const reconnect = testHarness.app.reconnectM1(sessionId('P2'), GAME_ID, () => undefined);
    const serialized = JSON.stringify({
      channel: testHarness.realtime.deliveriesFor(p2.subscriptionId),
      reconnect,
    });
    if (secret !== undefined) {
      expect(serialized).not.toContain(secret.condition);
      expect(serialized).not.toContain(String(secret.metadata.classifiedMarker));
      expect(serialized).not.toContain(`"progress":${secret.progress}`);
    }
  });

  it('[REGRESSION] GE-SEC-003 excludes future deck order from messages and recovery, including F1 normal view', () => {
    const state = planningState();
    const futureP1Card = state.strategy.P1?.operationsDeckOrder[0];
    expect(futureP1Card).toBeDefined();
    const testHarness = realtimePlanningHarness(state);
    const p2 = connectConsumer(testHarness, 'P2');
    const f1 = connectConsumer(testHarness, 'F1');
    expect(savePlan(testHarness, 'P1', [constructSlot(state, 'P1')]).status).toBe('RESOLVED');
    const beforeLock = testHarness.store.snapshot(GAME_ID)!;
    expect(testHarness.app.execute(
      sessionId('P1'),
      command('LOCK_ACTION_PLAN', GAME_ID, beforeLock.version, {}),
    ).status).toBe('RESOLVED');
    const p2Recovery = testHarness.app.reconnectM1(sessionId('P2'), GAME_ID, () => undefined);
    const f1Recovery = testHarness.app.reconnectM1(sessionId('F1'), GAME_ID, () => undefined);
    const serialized = JSON.stringify({
      p2Channel: testHarness.realtime.deliveriesFor(p2.subscriptionId),
      f1Channel: testHarness.realtime.deliveriesFor(f1.subscriptionId),
      p2Recovery,
      f1Recovery,
    });
    if (futureP1Card !== undefined) expect(serialized).not.toContain(futureP1Card);
    expect(serialized).not.toContain('operationsDeckOrder');
    expect(serialized).not.toContain('topCardIdentity');
  });

  it('[REGRESSION] GE-SEC-004 keeps a face-down plan redacted in rival feed and reconnect before reveal', () => {
    const state = planningState();
    const slot = constructSlot(state, 'P1');
    const intentCardId = slot.actionPayload.intentCardInstanceId;
    const methodCardId = slot.actionPayload.methodCardInstanceId;
    const testHarness = realtimePlanningHarness(state);
    expect(savePlan(testHarness, 'P1', [slot]).status).toBe('RESOLVED');
    const p2 = connectConsumer(testHarness, 'P2');
    const beforeLock = testHarness.store.snapshot(GAME_ID)!;
    expect(testHarness.app.execute(
      sessionId('P1'),
      command('LOCK_ACTION_PLAN', GAME_ID, beforeLock.version, {}),
    ).status).toBe('RESOLVED');
    const reconnect = testHarness.app.reconnectM1(sessionId('P2'), GAME_ID, () => undefined);
    const serialized = JSON.stringify({
      channel: testHarness.realtime.deliveriesFor(p2.subscriptionId),
      reconnect,
    });
    expect(serialized).not.toContain(intentCardId);
    expect(serialized).not.toContain(methodCardId);
    expect(serialized).not.toContain('actionPayload');
    expect(serialized).not.toContain(slot.actionPayload.targetDtId);
  });
});
