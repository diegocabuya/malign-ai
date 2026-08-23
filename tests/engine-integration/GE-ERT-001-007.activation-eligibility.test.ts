import { describe, expect, it } from 'vitest';
import { envelope, harness, makeCampaignState } from '../command/test-fixtures.js';

const campaignState = () => {
  return harness(makeCampaignState());
};

describe('PR-2 minimal campaign activation eligibility', () => {
  it('GE-ERT-001 rejects a repeated normal activation in the same turn', () => {
    const { dispatcher, store } = campaignState(); dispatcher.dispatch(envelope('ACTIVATE_CAMPAIGN', { campaignId: 'campaign-1', requestedTargetPdId: 'pdAsian' }));
    const result = dispatcher.dispatch(envelope('ACTIVATE_CAMPAIGN', { campaignId: 'campaign-1', requestedTargetPdId: 'pdAsian' }, 1));
    expect(result.error?.code).toBe('CAMPAIGN_ALREADY_ACTIVATED'); expect(store.snapshot().campaigns['campaign-1']?.activatedCountThisTurn).toBe(1);
  });

  it('GE-ERT-002 rejects a target PD without the campaign DT before cost', () => {
    const { dispatcher, store } = campaignState(); const resources = store.snapshot().participants.P1?.resources;
    const result = dispatcher.dispatch(envelope('ACTIVATE_CAMPAIGN', { campaignId: 'campaign-1', requestedTargetPdId: 'pdOther' }));
    expect(['INVALID_TARGET_PD', 'INVALID_DT']).toContain(result.error?.code); expect(store.snapshot().participants.P1?.resources).toBe(resources); expect(store.snapshot().campaigns['campaign-1']?.activatedCountThisTurn).toBe(0);
  });

  it('GE-ERT-007 keeps base cost MEDIUM while a valid +2 pair resolves HIGH', () => {
    const { dispatcher } = harness(makeCampaignState(true));
    const result = dispatcher.dispatch(envelope('ACTIVATE_CAMPAIGN', { campaignId: 'campaign-1', requestedTargetPdId: 'pdAsian' }));
    expect(result.resultPayload).toMatchObject({ baseCv: 10, rawEffectiveCv: 12, baseTier: 'MEDIUM', resolutionTier: 'HIGH', baseCost: 2 });
  });
});
