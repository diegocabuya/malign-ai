import type { CampaignAlignment, CampaignTier } from './types.js';

export const ERT_DATA_VERSION = '0.1' as const;
type ErtCell = Readonly<Record<CampaignAlignment, number>>;
type ErtRow = Readonly<Record<CampaignTier, ErtCell>>;

export const ERT_TABLE: readonly ErtRow[] = [
  { LOW: { MALIGN: -2, RESILIENCY: -1 }, MEDIUM: { MALIGN: -2, RESILIENCY: -1 }, HIGH: { MALIGN: -2, RESILIENCY: -1 } },
  { LOW: { MALIGN: -1, RESILIENCY: -1 }, MEDIUM: { MALIGN: -1, RESILIENCY: 0 }, HIGH: { MALIGN: -1, RESILIENCY: 0 } },
  { LOW: { MALIGN: -1, RESILIENCY: 0 }, MEDIUM: { MALIGN: -1, RESILIENCY: 0 }, HIGH: { MALIGN: 0, RESILIENCY: 0 } },
  { LOW: { MALIGN: 0, RESILIENCY: 0 }, MEDIUM: { MALIGN: 0, RESILIENCY: 0 }, HIGH: { MALIGN: 1, RESILIENCY: 1 } },
  { LOW: { MALIGN: 0, RESILIENCY: 0 }, MEDIUM: { MALIGN: 1, RESILIENCY: 1 }, HIGH: { MALIGN: 1, RESILIENCY: 1 } },
  { LOW: { MALIGN: 1, RESILIENCY: 1 }, MEDIUM: { MALIGN: 1, RESILIENCY: 1 }, HIGH: { MALIGN: 2, RESILIENCY: 2 } },
  { LOW: { MALIGN: 1, RESILIENCY: 1 }, MEDIUM: { MALIGN: 2, RESILIENCY: 2 }, HIGH: { MALIGN: 3, RESILIENCY: 3 } },
  { LOW: { MALIGN: 1, RESILIENCY: 1 }, MEDIUM: { MALIGN: 2, RESILIENCY: 2 }, HIGH: { MALIGN: 3, RESILIENCY: 3 } },
  { LOW: { MALIGN: 2, RESILIENCY: 2 }, MEDIUM: { MALIGN: 3, RESILIENCY: 3 }, HIGH: { MALIGN: 4, RESILIENCY: 4 } },
  { LOW: { MALIGN: 2, RESILIENCY: 2 }, MEDIUM: { MALIGN: 3, RESILIENCY: 3 }, HIGH: { MALIGN: 4, RESILIENCY: 4 } },
] as const;
