import { describe, expect, it } from 'vitest';
import type { ActorContext } from '../../packages/contracts/src/index.js';
import type { GameCommandPayload } from '../../packages/game-engine/src/index.js';
import { actor, constructPayload, envelope, harness, makeCampaignState, makeState } from './test-fixtures.js';

describe('PR2-R01 phase enforcement regressions', () => {
  it('PR2-R01 rejects planning commands outside ACTION_STAGE_PLAN atomically', () => {
    const state = makeState(); state.phase = 'RESOLUTION_STAGE'; const { dispatcher, store } = harness(state);
    const result = dispatcher.dispatch(envelope('SET_ACTION_PLAN', { actionSlots: [] }));
    expect(result.error?.code).toBe('WRONG_PHASE'); expect(store.snapshot()).toEqual(state);
  });
  it('PR2-R01 rejects activation outside RESOLUTION_STAGE atomically', () => {
    const state = makeCampaignState(); state.phase = 'ACTION_STAGE_PLAN'; const { dispatcher, store } = harness(state);
    const result = dispatcher.dispatch(envelope('ACTIVATE_CAMPAIGN', { campaignId: 'campaign-1', requestedTargetPdId: 'pdAsian' }));
    expect(result.error?.code).toBe('WRONG_PHASE'); expect(store.snapshot()).toEqual(state);
  });
});

describe('PR2-R02 extra activation authority regression', () => {
  it('PR2-R02 caller boolean cannot bypass repeat activation protection', () => {
    const state = makeCampaignState(); state.campaigns['campaign-1']!.activatedCountThisTurn = 1; const { dispatcher, store } = harness(state);
    const payload = { campaignId: 'campaign-1', requestedTargetPdId: 'pdAsian', extraActivation: true } as unknown as GameCommandPayload;
    const result = dispatcher.dispatch(envelope('ACTIVATE_CAMPAIGN', payload));
    expect(result.error?.code).toBe('EXTRA_ACTIVATION_NOT_AUTHORIZED'); expect(store.snapshot()).toEqual(state);
  });
});

describe('PR2-R03 action-plan payload invariant regressions', () => {
  const invalidPlan = (apCost: number, sequenceIndex = 1) => {
    const { dispatcher, store } = harness(); const before = store.snapshot();
    const result = dispatcher.dispatch(envelope('SET_ACTION_PLAN', { actionSlots: [{ sequenceIndex, actionType: 'CONSTRUCT_CAMPAIGN', apCost }] }));
    expect(result.error?.code).toBe('INVALID_ACTION_PLAN'); expect(store.snapshot()).toEqual(before);
  };
  it('PR2-R03 rejects negative AP cost', () => invalidPlan(-1));
  it('PR2-R03 rejects fractional AP cost', () => invalidPlan(0.5));
  it('PR2-R03 rejects non-finite AP cost', () => invalidPlan(Number.NaN));
  it('PR2-R03 rejects duplicate sequence indexes', () => {
    const { dispatcher, store } = harness(); const before = store.snapshot();
    const result = dispatcher.dispatch(envelope('SET_ACTION_PLAN', { actionSlots: [{ sequenceIndex: 1, actionType: 'CONSTRUCT_CAMPAIGN', apCost: 1 }, { sequenceIndex: 1, actionType: 'MODIFY_CAMPAIGN', apCost: 1 }] }));
    expect(result.error?.code).toBe('INVALID_ACTION_PLAN'); expect(store.snapshot()).toEqual(before);
  });
});

describe('PR2-R04 slot compatibility regressions', () => {
  it('PR2-R04 rejects a card lacking the IV for its construction slot', () => {
    const { dispatcher, store } = harness(); const before = store.snapshot();
    const result = dispatcher.dispatch(envelope('CONSTRUCT_CAMPAIGN', { ...constructPayload, methodCardInstanceId: 'amp1' }));
    expect(result.error?.code).toBe('CARD_NOT_ELIGIBLE'); expect(store.snapshot()).toEqual(before);
  });
  it('PR2-R04 rejects a replacement lacking the IV for the requested slot', () => {
    const state = makeCampaignState(); state.phase = 'ACTION_STAGE_PLAN'; state.cards.amp1!.zone = 'HAND'; const { dispatcher, store } = harness(state); const before = store.snapshot();
    const result = dispatcher.dispatch(envelope('MODIFY_CAMPAIGN', { campaignId: 'campaign-1', slot: 'METHOD', replacementCardInstanceId: 'amp1' }));
    expect(result.error?.code).toBe('CARD_NOT_ELIGIBLE'); expect(store.snapshot()).toEqual(before);
  });
});

describe('PR2-R05 campaign and card identity regressions', () => {
  it('PR2-R05 rejects duplicate CardInstance IDs without moving the card', () => {
    const { dispatcher, store } = harness(); const before = store.snapshot();
    const result = dispatcher.dispatch(envelope('CONSTRUCT_CAMPAIGN', { ...constructPayload, methodCardInstanceId: 'intent1' }));
    expect(result.error?.code).toBe('DUPLICATE_CARD_INSTANCE'); expect(store.snapshot()).toEqual(before);
  });
  it('PR2-R05 rejects an existing campaignId globally without overwrite', () => {
    const state = makeState(); state.campaigns['campaign-1'] = { id: 'campaign-1', ownerParticipantId: 'P2', row: 'II', alignment: 'MALIGN', targetDtId: 'ASIAN', assignments: [], activatedCountThisTurn: 0 }; const { dispatcher, store } = harness(state); const before = store.snapshot();
    const result = dispatcher.dispatch(envelope('CONSTRUCT_CAMPAIGN', constructPayload));
    expect(result.error?.code).toBe('CAMPAIGN_ID_CONFLICT'); expect(store.snapshot()).toEqual(before);
  });
});

describe('PR2-R06 game and actor boundary regressions', () => {
  it('PR2-R06 rejects envelope gameId mismatch before mutation', () => {
    const { dispatcher, store } = harness(); const before = store.snapshot(); const command = { ...envelope('SET_ACTION_PLAN', { actionSlots: [] }), gameId: 'other-game' };
    expect(dispatcher.dispatch(command).error?.code).toBe('GAME_ID_MISMATCH'); expect(store.snapshot()).toEqual(before);
  });
  it('PR2-R06 rejects non-player ActorContext for player commands', () => {
    const { dispatcher, store } = harness(); const before = store.snapshot(); const facilitator: ActorContext = { ...actor('P1'), actorType: 'FACILITATOR' }; const command = { ...envelope('SET_ACTION_PLAN', { actionSlots: [] }), actorContext: facilitator };
    expect(dispatcher.dispatch(command).error?.code).toBe('INVALID_ACTOR_CONTEXT'); expect(store.snapshot()).toEqual(before);
  });
  it('PR2-R06 rejects ActorContext with an unknown participant', () => {
    const { dispatcher, store } = harness(); const before = store.snapshot();
    expect(dispatcher.dispatch(envelope('SET_ACTION_PLAN', { actionSlots: [] }, 0, 'P9')).error?.code).toBe('INVALID_ACTOR_CONTEXT'); expect(store.snapshot()).toEqual(before);
  });
});
