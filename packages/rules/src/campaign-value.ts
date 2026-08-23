import type { AssignedCampaignComponent, CampaignTier } from './types.js';

export interface CampaignValueResult {
  readonly baseCv: number;
  readonly rawEffectiveCv: number;
  readonly baseTier: CampaignTier;
  readonly resolutionTier: CampaignTier;
  readonly baseCost: 1 | 2 | 3;
}

const requireInteger = (value: number, field: string): number => {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${field} must be a non-negative integer`);
  return value;
};

export const tierForCampaignValue = (campaignValue: number): CampaignTier => {
  requireInteger(campaignValue, 'campaignValue');
  if (campaignValue <= 6) return 'LOW';
  if (campaignValue <= 11) return 'MEDIUM';
  return 'HIGH';
};

export const costForBaseCampaignValue = (baseCv: number): 1 | 2 | 3 => {
  const tier = tierForCampaignValue(baseCv);
  if (tier === 'LOW') return 1;
  if (tier === 'MEDIUM') return 2;
  return 3;
};

export const calculateBaseCampaignValue = (components: readonly AssignedCampaignComponent[]): number =>
  components.reduce((sum, component) => {
    const influenceValue = component.influenceValueBySlot[component.slot];
    if (influenceValue === undefined) throw new Error(`Missing influence value for occupied ${component.slot} slot`);
    return sum + requireInteger(influenceValue, 'influenceValue');
  }, 0);

export const calculateCampaignValue = (
  components: readonly AssignedCampaignComponent[],
  explicitCvModifiers: readonly number[] = [],
): CampaignValueResult => {
  const baseCv = calculateBaseCampaignValue(components);
  const rawEffectiveCv = explicitCvModifiers.reduce(
    (value, modifier) => value + requireInteger(modifier, 'explicitCvModifier'),
    baseCv,
  );
  return { baseCv, rawEffectiveCv, baseTier: tierForCampaignValue(baseCv), resolutionTier: tierForCampaignValue(rawEffectiveCv), baseCost: costForBaseCampaignValue(baseCv) };
};
