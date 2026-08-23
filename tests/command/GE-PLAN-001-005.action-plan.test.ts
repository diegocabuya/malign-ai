import { describe, expect, it } from 'vitest';
import { envelope, harness, makeState } from './test-fixtures.js';

describe('PR-2 action plan locking', () => {
  it('GE-PLAN-001 rejects locking more than three AP actions atomically', () => {
    const slots = [1, 2, 3, 4].map((sequenceIndex) => ({ sequenceIndex, actionType: 'ACTIVATE_CAMPAIGN' as const, apCost: 1 }));
    const state = makeState(); state.participants.P1!.plan = slots; const { dispatcher, store } = harness(state);
    const result = dispatcher.dispatch(envelope('LOCK_ACTION_PLAN', {}));
    expect(result.error?.code).toBe('INSUFFICIENT_AP'); expect(store.snapshot().participants.P1).toMatchObject({ actionPointsAvailable: 3, planStatus: 'EDITING' });
  });

  it('GE-PLAN-005 rejects player edits after lock', () => {
    const { dispatcher, store } = harness();
    dispatcher.dispatch(envelope('SET_ACTION_PLAN', { actionSlots: [{ sequenceIndex: 1, actionType: 'CONSTRUCT_CAMPAIGN', apCost: 1 }] }));
    dispatcher.dispatch(envelope('LOCK_ACTION_PLAN', {}, 1));
    const locked = store.snapshot().participants.P1?.plan;
    const result = dispatcher.dispatch(envelope('SET_ACTION_PLAN', { actionSlots: [] }, 2));
    expect(result.error?.code).toBe('ACTION_PLAN_LOCKED'); expect(store.snapshot().participants.P1?.plan).toEqual(locked);
  });
});
