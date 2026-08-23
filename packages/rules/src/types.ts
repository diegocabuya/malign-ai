export type CampaignSlot = 'INTENT' | 'METHOD' | 'AMPLIFIER';
export type CampaignAlignment = 'MALIGN' | 'RESILIENCY';
export type CampaignTier = 'LOW' | 'MEDIUM' | 'HIGH';

export interface AssignedCampaignComponent {
  readonly slot: CampaignSlot;
  readonly influenceValueBySlot: Readonly<Partial<Record<CampaignSlot, number>>>;
}
