import type { AssignedCampaignComponent, CampaignAlignment, CampaignSlot } from '@malign-ai/rules';

export type GamePhase = 'INITIATIVE_STAGE' | 'ACTION_STAGE_PLAN' | 'RESOLUTION_STAGE';
export type GameOverlay = 'ACTIVE' | 'PAUSED';
export type CardZone = 'HAND' | 'PLANNED_ACTION' | 'CAMPAIGN' | 'DISCARD';

export interface CardDefinition {
  readonly id: string;
  readonly alignment: CampaignAlignment | 'DUAL';
  readonly influenceValueBySlot: AssignedCampaignComponent['influenceValueBySlot'];
  readonly targetDtId?: string;
  readonly pairBonusWith?: string;
}
export interface CardInstance { readonly id: string; readonly definitionId: string; controllerParticipantId: string; zone: CardZone; }
export interface PlanSlot { readonly sequenceIndex: number; readonly actionType: 'CONSTRUCT_CAMPAIGN' | 'MODIFY_CAMPAIGN' | 'ACTIVATE_CAMPAIGN'; readonly apCost: number; }
export interface ParticipantState { readonly id: string; actionPointsAvailable: number; resources: number; plan: PlanSlot[]; planStatus: 'EDITING' | 'LOCKED'; }
export interface CampaignAssignment { readonly slot: CampaignSlot; readonly cardInstanceId: string; }
export interface CampaignState {
  readonly id: string;
  readonly ownerParticipantId: string;
  readonly row: 'I' | 'II';
  readonly alignment: CampaignAlignment;
  readonly targetDtId: string;
  assignments: CampaignAssignment[];
  activatedCountThisTurn: number;
}
export interface PopulationDemographicState { readonly id: string; readonly demographicTokenIds: readonly string[]; }
export interface GameEvent { readonly id: string; readonly type: 'ACTION_PLAN_LOCKED' | 'AP_COMMITTED' | 'CAMPAIGN_CREATED' | 'CAMPAIGN_MODIFIED' | 'CAMPAIGN_ACTIVATED'; }
export interface GameState {
  readonly id: string;
  version: number;
  phase: GamePhase;
  overlay: GameOverlay;
  participants: Record<string, ParticipantState>;
  cardDefinitions: Record<string, CardDefinition>;
  cards: Record<string, CardInstance>;
  campaigns: Record<string, CampaignState>;
  populationDemographics: Record<string, PopulationDemographicState>;
  events: GameEvent[];
}

export type GameCommandType = 'SET_ACTION_PLAN' | 'LOCK_ACTION_PLAN' | 'CONSTRUCT_CAMPAIGN' | 'MODIFY_CAMPAIGN' | 'ACTIVATE_CAMPAIGN' | 'END_GAME_SCORING';
export interface SetActionPlanPayload { readonly actionSlots: readonly PlanSlot[]; }
export interface ConstructCampaignPayload { readonly campaignId: string; readonly intentCardInstanceId: string; readonly methodCardInstanceId?: string; readonly amplifierCardInstanceId?: string; readonly targetDtId: string; }
export interface ModifyCampaignPayload { readonly campaignId: string; readonly slot: CampaignSlot; readonly replacementCardInstanceId: string; }
export interface ActivateCampaignPayload { readonly campaignId: string; readonly requestedTargetPdId: string; readonly extraActivation?: boolean; }
export type GameCommandPayload = SetActionPlanPayload | Record<string, never> | ConstructCampaignPayload | ModifyCampaignPayload | ActivateCampaignPayload;
