import { describe, expect, it } from 'vitest';
import { constructPayload, envelope, harness, makeState } from './test-fixtures.js';

describe('PR-2 command safety and atomic in-memory boundary', () => {
  it('GE-CORE-001 rejects a command in the wrong phase without mutation', () => {
    const state = makeState(); state.phase = 'INITIATIVE_STAGE'; const { dispatcher, store } = harness(state);
    const result = dispatcher.dispatch(envelope('CONSTRUCT_CAMPAIGN', constructPayload));
    expect(result.error?.code).toBe('WRONG_PHASE'); expect(store.snapshot()).toEqual(state);
  });

  it('GE-CORE-002 rejects an actor using a card controlled by another participant', () => {
    const { dispatcher, store } = harness();
    const result = dispatcher.dispatch(envelope('CONSTRUCT_CAMPAIGN', { ...constructPayload, intentCardInstanceId: 'intentP2' }));
    expect(result.error?.code).toBe('CARD_NOT_CONTROLLED'); expect(store.snapshot().cards.intentP2?.controllerParticipantId).toBe('P2');
  });

  it('GE-CORE-003 rejects a stale version with no domain events', () => {
    const state = makeState(); state.version = 20; const { dispatcher, store } = harness(state);
    const result = dispatcher.dispatch(envelope('SET_ACTION_PLAN', { actionSlots: [] }, 19));
    expect(result.error?.code).toBe('STALE_STATE_VERSION'); expect(result.emittedEventRefs).toEqual([]); expect(store.snapshot().version).toBe(20);
  });

  it('GE-CORE-004 returns the original result for an idempotent retry', () => {
    const { dispatcher, store } = harness(); const command = envelope('SET_ACTION_PLAN', { actionSlots: [] });
    const first = dispatcher.dispatch(command); const retry = dispatcher.dispatch(command);
    expect(retry).toEqual(first); expect(store.snapshot().version).toBe(1); expect(store.snapshot().events).toHaveLength(0);
  });

  it('GE-CORE-005 fails resource cost atomically while committed AP remains spent', () => {
    const state = makeState(); state.participants.P1!.resources = 2; const { dispatcher, store } = harness(state);
    dispatcher.dispatch(envelope('SET_ACTION_PLAN', { actionSlots: [{ sequenceIndex: 1, actionType: 'ACTIVATE_CAMPAIGN', apCost: 1 }] }));
    dispatcher.dispatch(envelope('LOCK_ACTION_PLAN', {}, 1));
    const current = store.snapshot(); current.phase = 'RESOLUTION_STAGE'; current.cards.intent1!.zone = 'CAMPAIGN'; current.cards.method1!.zone = 'CAMPAIGN'; current.cards.amp1!.zone = 'CAMPAIGN'; current.campaigns['campaign-1'] = { id: 'campaign-1', ownerParticipantId: 'P1', row: 'I', alignment: 'MALIGN', targetDtId: 'ASIAN', assignments: [{ slot: 'INTENT', cardInstanceId: 'intent1' }, { slot: 'METHOD', cardInstanceId: 'method1' }, { slot: 'AMPLIFIER', cardInstanceId: 'amp1' }], activatedCountThisTurn: 0 };
    const costHarness = harness(current); const result = costHarness.dispatcher.dispatch(envelope('ACTIVATE_CAMPAIGN', { campaignId: 'campaign-1', requestedTargetPdId: 'pdAsian' }, 2));
    expect(result.error?.code).toBe('INSUFFICIENT_RESOURCES'); expect(costHarness.store.snapshot().participants.P1).toMatchObject({ resources: 2, actionPointsAvailable: 2 }); expect(costHarness.store.snapshot().campaigns['campaign-1']?.activatedCountThisTurn).toBe(0);
  });

  it('GE-CORE-006 blocks normal gameplay while paused', () => {
    const state = makeState(); state.overlay = 'PAUSED'; const { dispatcher, store } = harness(state);
    expect(dispatcher.dispatch(envelope('SET_ACTION_PLAN', { actionSlots: [] })).error?.code).toBe('GAME_PAUSED'); expect(store.snapshot()).toEqual(state);
  });

  it('GE-CORE-008 rejects an illegal transition without changing phase', () => {
    const { dispatcher, store } = harness(); const result = dispatcher.dispatch(envelope('END_GAME_SCORING', {}));
    expect(result.error?.code).toBe('ILLEGAL_STATE_TRANSITION'); expect(store.snapshot().phase).toBe('ACTION_STAGE_PLAN');
  });

  it('GE-CORE-010 permits only one of two locks built on the same version', () => {
    const { dispatcher, store } = harness(); dispatcher.dispatch(envelope('SET_ACTION_PLAN', { actionSlots: [] }));
    const first = dispatcher.dispatch(envelope('LOCK_ACTION_PLAN', {}, 1)); const second = dispatcher.dispatch(envelope('LOCK_ACTION_PLAN', {}, 1));
    expect(first.status).toBe('RESOLVED'); expect(second.error?.code).toBe('STALE_STATE_VERSION'); expect(store.snapshot().version).toBe(2); expect(store.snapshot().participants.P1?.planStatus).toBe('LOCKED');
  });
});
