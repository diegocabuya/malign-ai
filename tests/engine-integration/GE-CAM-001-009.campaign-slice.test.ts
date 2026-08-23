import { describe, expect, it } from 'vitest';
import { envelope, harness, constructCampaign, constructPayload } from '../command/test-fixtures.js';

describe('PR-2 campaign construction and modification slice', () => {
  it('GE-CAM-001 builds a valid Intent and Method campaign in Row I', () => {
    const { dispatcher, store } = harness(); const result = constructCampaign(dispatcher);
    expect(result.resultCode).toBe('CAMPAIGN_CREATED'); expect(store.snapshot().campaigns['campaign-1']).toMatchObject({ row: 'I', targetDtId: 'ASIAN', assignments: [{ slot: 'INTENT', cardInstanceId: 'intent1' }, { slot: 'METHOD', cardInstanceId: 'method1' }] });
  });

  it('GE-CAM-002 rejects build without Method and leaves cards untouched', () => {
    const { dispatcher, store } = harness(); const result = dispatcher.dispatch(envelope('CONSTRUCT_CAMPAIGN', { campaignId: 'campaign-1', intentCardInstanceId: 'intent1', targetDtId: 'ASIAN' }));
    expect(result.error?.code).toBe('CAMPAIGN_INVALID_STRUCTURE'); expect(store.snapshot().cards.intent1?.zone).toBe('HAND'); expect(store.snapshot().campaigns).toEqual({});
  });

  it('GE-CAM-003 rejects incompatible campaign alignments', () => {
    const { dispatcher, store } = harness(); const result = dispatcher.dispatch(envelope('CONSTRUCT_CAMPAIGN', { ...constructPayload, methodCardInstanceId: 'methodR' }));
    expect(result.error?.code).toBe('CAMPAIGN_ALIGNMENT_MISMATCH'); expect(store.snapshot().campaigns).toEqual({});
  });

  it('GE-CAM-004 rejects construction when Row I is occupied', () => {
    const { dispatcher, store } = harness(); constructCampaign(dispatcher);
    const result = dispatcher.dispatch(envelope('CONSTRUCT_CAMPAIGN', { ...constructPayload, campaignId: 'campaign-2' }, 1));
    expect(result.error?.code).toBe('CAMPAIGN_ROW_OCCUPIED'); expect(Object.keys(store.snapshot().campaigns)).toEqual(['campaign-1']);
  });

  it('GE-CAM-005 retains selected slot and uses its slot-specific IV', () => {
    const { dispatcher, store } = harness();
    dispatcher.dispatch(envelope('CONSTRUCT_CAMPAIGN', { ...constructPayload, methodCardInstanceId: 'multi1' }));
    const result = dispatcher.dispatch(envelope('ACTIVATE_CAMPAIGN', { campaignId: 'campaign-1', requestedTargetPdId: 'pdAsian' }, 1));
    expect(store.snapshot().campaigns['campaign-1']?.assignments[1]).toEqual({ slot: 'METHOD', cardInstanceId: 'multi1' }); expect(result.resultPayload).toMatchObject({ baseCv: 6 });
  });

  it('GE-CAM-008 fills an empty Amplifier without discarding another card', () => {
    const { dispatcher, store } = harness(); constructCampaign(dispatcher);
    const result = dispatcher.dispatch(envelope('MODIFY_CAMPAIGN', { campaignId: 'campaign-1', slot: 'AMPLIFIER', replacementCardInstanceId: 'amp1' }, 1));
    expect(result.resultCode).toBe('CAMPAIGN_MODIFIED'); expect(store.snapshot().campaigns['campaign-1']?.assignments).toContainEqual({ slot: 'AMPLIFIER', cardInstanceId: 'amp1' }); expect(Object.values(store.snapshot().cards).filter(({ zone }) => zone === 'DISCARD')).toHaveLength(0);
  });

  it('GE-CAM-009 rejects attempts to modify Intent', () => {
    const { dispatcher, store } = harness(); constructCampaign(dispatcher); const before = store.snapshot().campaigns['campaign-1'];
    const result = dispatcher.dispatch(envelope('MODIFY_CAMPAIGN', { campaignId: 'campaign-1', slot: 'INTENT', replacementCardInstanceId: 'amp1' }, 1));
    expect(result.error?.code).toBe('INVALID_SLOT'); expect(store.snapshot().campaigns['campaign-1']).toEqual(before);
  });
});
