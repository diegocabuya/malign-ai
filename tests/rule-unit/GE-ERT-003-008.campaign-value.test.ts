import { describe, expect, it } from 'vitest';
import { calculateBaseCampaignValue, calculateCampaignValue, costForBaseCampaignValue, tierForCampaignValue, type AssignedCampaignComponent } from '../../packages/rules/src/index.js';

const component = (slot: AssignedCampaignComponent['slot'], value: number, other?: Partial<Record<AssignedCampaignComponent['slot'], number>>): AssignedCampaignComponent => ({ slot, influenceValueBySlot: { ...other, [slot]: value } });

describe('PR-1 campaign value Rule Kernel', () => {
  it('GE-ERT-003 base CV low boundary', () => {
    for (const baseCv of [3, 6]) {
      expect(tierForCampaignValue(baseCv)).toBe('LOW');
      expect(costForBaseCampaignValue(baseCv)).toBe(1);
    }
  });

  it('GE-ERT-004 base CV medium boundaries', () => {
    for (const baseCv of [7, 11]) {
      expect(tierForCampaignValue(baseCv)).toBe('MEDIUM');
      expect(costForBaseCampaignValue(baseCv)).toBe(2);
    }
  });

  it('GE-ERT-005 base CV high boundaries', () => {
    for (const baseCv of [12, 15]) {
      expect(tierForCampaignValue(baseCv)).toBe('HIGH');
      expect(costForBaseCampaignValue(baseCv)).toBe(3);
    }
  });

  it('GE-ERT-006 uses the IV for the occupied slot', () => {
    const multiSlot = component('METHOD', 2, { AMPLIFIER: 5 });
    expect(calculateBaseCampaignValue([multiSlot])).toBe(2);
  });

  it('GE-ERT-008 retains effective CV above 15 and resolves HIGH', () => {
    const result = calculateCampaignValue([component('INTENT', 5), component('METHOD', 5), component('AMPLIFIER', 5)], [2, 4]);
    expect(result).toMatchObject({ baseCv: 15, rawEffectiveCv: 21, baseTier: 'HIGH', resolutionTier: 'HIGH', baseCost: 3 });
  });
});
