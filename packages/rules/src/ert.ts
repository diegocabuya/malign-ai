import { ERT_TABLE } from './ert-data.js';
import type { CampaignAlignment, CampaignTier } from './types.js';

export interface NormalizedErtRoll { readonly modifiedRollRaw: number; readonly ertRoll: number; }

export const normalizeErtRoll = (modifiedRollRaw: number): NormalizedErtRoll => {
  if (!Number.isInteger(modifiedRollRaw)) throw new RangeError('modifiedRollRaw must be an integer');
  return { modifiedRollRaw, ertRoll: Math.min(10, Math.max(1, modifiedRollRaw)) };
};

export const lookupErt = (tier: CampaignTier, alignment: CampaignAlignment, ertRoll: number): number => {
  if (!Number.isInteger(ertRoll) || ertRoll < 1 || ertRoll > 10) throw new RangeError('ertRoll must be between 1 and 10');
  const row = ERT_TABLE[ertRoll - 1];
  if (row === undefined) throw new RangeError('ERT row does not exist');
  return row[tier][alignment];
};
