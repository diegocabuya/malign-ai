import type { CountryId, PinnedVersions } from './m1-setup.js';

export type InfluenceType = 'MALIGN' | 'RESILIENCY';
export type M1CampaignSlot = 'INTENT' | 'METHOD' | 'AMPLIFIER';

export interface M1CampaignCardRule {
  readonly definitionId: string;
  readonly alignment: InfluenceType | 'DUAL';
  readonly influenceValueBySlot: Readonly<Partial<Record<M1CampaignSlot, number>>>;
  readonly allowsAnyTargetDt?: boolean;
  readonly pairBonusWithDefinitionId?: string;
}

export interface M1CampaignAssignment {
  readonly slot: M1CampaignSlot;
  readonly cardInstanceId: string;
  readonly definitionId: string;
  readonly influenceValue: number;
}

export interface M1CampaignState {
  readonly id: string;
  readonly ownerParticipantId: string;
  readonly row: 'I' | 'II';
  readonly alignment: InfluenceType;
  readonly targetDtId: string;
  readonly assignments: readonly M1CampaignAssignment[];
  activationCountThisTurn: number;
}

export interface InfluenceStackState {
  readonly pdId: string;
  readonly type: InfluenceType;
  readonly attributionCountryId: CountryId;
  count: number;
}

export interface M1SchedulerCursor {
  participantIndex: number;
  slotIndex: number;
  status: 'READY' | 'SUSPENDED' | 'COMPLETE';
}

export interface ChoiceOption {
  readonly optionId: string;
  readonly optionType: 'OPPOSITE_ATTRIBUTION';
}

export interface ChoiceRequest {
  readonly choiceId: string;
  readonly choiceVersion: number;
  readonly gameId: string;
  readonly choiceType: 'SELECT_OPPOSITE_ATTRIBUTION_TO_REMOVE';
  readonly actorParticipantId: string;
  readonly sourceResolutionId: string;
  readonly visibilityScope: 'OWNER_AND_FACILITATOR';
  readonly status: 'OPEN';
  readonly selectionMode: 'ORDERED';
  readonly minSelections: number;
  readonly maxSelections: number;
  readonly options: readonly ChoiceOption[];
}

export interface CampaignNarrativeProvenance {
  readonly inputId: string;
  readonly text: string;
  readonly source: 'PLAYER' | 'FIXTURE';
  readonly actorId: string;
  readonly actorParticipantId: string | null;
  readonly correlationId: string;
  readonly causationId: string;
}

export interface NarrativeRequest {
  readonly requestId: string;
  readonly gameId: string;
  readonly campaignId: string;
  readonly actorParticipantId: string;
  readonly status: 'OPEN';
  readonly visibilityScope: 'OWNER_AND_FACILITATOR';
}

export interface NarrativeContinuationState {
  readonly kind: 'CAMPAIGN_NARRATIVE';
  readonly targetPdId: string;
  readonly countryId: CountryId;
  readonly baseCv: number;
  readonly effectiveCv: number;
  readonly baseTier: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly resolutionTier: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly resourceCost: number;
  readonly preStateHash: string;
  readonly eventRefsBeforeNarrative: readonly string[];
}

export interface CampaignContinuationState {
  readonly kind: 'CAMPAIGN_2_TO_1';
  readonly participantId: string;
  readonly sequenceIndex: number;
  readonly campaignId: string;
  readonly activationId: string;
  readonly targetPdId: string;
  readonly generatedType: InfluenceType;
  readonly generatedAttributionCountryId: CountryId;
  readonly generatedCount: number;
  readonly removalsRequired: number;
  readonly optionAttributionById: Readonly<Record<string, CountryId>>;
  readonly resourceBalanceBefore: number;
  readonly vpBefore: number;
  readonly legitimacyBefore: string | null;
  readonly baseCv: number;
  readonly effectiveCv: number;
  readonly baseTier: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly resolutionTier: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly resourceCost: number;
  readonly rawRoll: number;
  readonly modifiedRollRaw: number;
  readonly ertRoll: number;
  readonly ertResult: number;
  readonly preStateHash: string;
  readonly eventRefsBeforeChoice: readonly string[];
  readonly ledgerRefsBeforeChoice: readonly string[];
}

interface PendingResolutionBase {
  readonly resolutionId: string;
  readonly gameId: string;
  readonly participantId: string;
  readonly sequenceIndex: number;
  readonly campaignId: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly versions: PinnedVersions;
}

export interface ChoicePendingResolution extends PendingResolutionBase {
  readonly kind: 'CHOICE';
  readonly choice: ChoiceRequest;
  readonly continuation: CampaignContinuationState;
}

export interface NarrativePendingResolution extends PendingResolutionBase {
  readonly kind: 'NARRATIVE';
  readonly narrativeRequest: NarrativeRequest;
  readonly continuation: NarrativeContinuationState;
}

export interface CoalitionContributionRequest {
  readonly requestId: string;
  readonly gameId: string;
  readonly campaignId: string;
  readonly sourceParticipantId: string;
  readonly eligibleParticipantIds: readonly string[];
  readonly respondedParticipantIds: readonly string[];
  readonly status: 'OPEN';
}

export interface CoalitionPendingResolution extends PendingResolutionBase {
  readonly kind: 'COALITION';
  readonly request: CoalitionContributionRequest;
  readonly decisions: Readonly<Record<string, 'CONTRIBUTE' | 'DECLINE'>>;
  readonly continuation: NarrativeContinuationState;
  readonly eventRefs: readonly string[];
  readonly ledgerRefs: readonly string[];
}

export type PendingResolution = ChoicePendingResolution | NarrativePendingResolution | CoalitionPendingResolution;

export interface DieRollRecord {
  readonly id: string;
  readonly source: 'CAMPAIGN_ERT';
  readonly participantId: string;
  readonly rawValue: number;
  readonly manual: false;
  readonly rngRequestId: string;
  readonly gameVersion: number;
}

export interface InfluenceLedgerEntry {
  readonly id: string;
  readonly pdId: string;
  readonly type: InfluenceType;
  readonly attributionCountryId: CountryId;
  readonly reason: 'CANCELLED_BY_2_TO_1' | 'PLACED';
  readonly delta: number;
  readonly balanceAfter: number;
  readonly gameVersion: number;
}

export interface LegitimacyLedgerEntry {
  readonly id: string;
  readonly pdId: string;
  readonly previousParticipantId: string | null;
  readonly newParticipantId: string | null;
  readonly reason: 'CAMPAIGN_ESTABLISH' | 'CAMPAIGN_SUBVERT';
  readonly gameVersion: number;
}

export interface VpLedgerEntry {
  readonly id: string;
  readonly participantId: string;
  readonly reason: 'CAMPAIGN_CUBE_PLACED' | 'CAMPAIGN_BACKLASH' | 'LEGITIMACY_ESTABLISHED' | 'LEGITIMACY_SUBVERTED';
  readonly delta: number;
  readonly balanceAfter: number;
  readonly gameVersion: number;
}

export interface InfluenceResolutionRecord {
  readonly id: string;
  readonly targetPdId: string;
  readonly incomingType: InfluenceType;
  readonly incomingAttributionCountryId: CountryId;
  readonly generatedCount: number;
  readonly consumedInCancellation: number;
  readonly oppositeRemovedByAttribution: Readonly<Record<string, number>>;
  readonly placedCount: number;
}

export interface AdjudicationTrace {
  readonly id: string;
  readonly participantId: string;
  readonly sequenceIndex: number;
  readonly campaignId: string;
  readonly activationId: string;
  readonly cards: readonly M1CampaignAssignment[];
  readonly alignment: InfluenceType;
  readonly targetDtId: string;
  readonly targetPdId: string;
  readonly baseCv: number;
  readonly effectiveCv: number;
  readonly baseTier: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly resolutionTier: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly resourceCost: number;
  readonly narrative: string;
  readonly preRollReaction: readonly ['OPEN', 'EVALUATE_ZERO_ELIGIBLE', 'CLOSE'];
  readonly rawRoll: number;
  readonly modifiedRollRaw: number;
  readonly ertRoll: number;
  readonly ertResult: number;
  readonly generatedType: InfluenceType;
  readonly generatedCount: number;
  readonly consumedInCancellation: number;
  readonly oppositeRemovedByAttribution: Readonly<Record<string, number>>;
  readonly placedCount: number;
  readonly legitimacyBefore: string | null;
  readonly legitimacyAfter: string | null;
  readonly vpBefore: number;
  readonly vpAfter: number;
  readonly vpDelta: number;
  readonly eventRefs: readonly string[];
  readonly ledgerRefs: readonly string[];
  readonly preStateHash: string;
  readonly postStateHash: string;
  readonly versions: PinnedVersions;
}

export interface M1AdjudicationState {
  readonly campaignCardRules: Record<string, M1CampaignCardRule>;
  readonly campaigns: Record<string, M1CampaignState>;
  readonly influenceStacks: InfluenceStackState[];
  readonly legitimacyByPd: Record<string, string | null>;
  readonly vpByParticipant: Record<string, number>;
  readonly narrativesByCampaign: Record<string, CampaignNarrativeProvenance>;
  readonly scheduler: M1SchedulerCursor;
  pendingResolution?: PendingResolution;
  plannedBoostsByParticipant?: Record<string, { readonly cardInstanceId: string; readonly campaignId: string; readonly activationSequenceIndex: number }>;
  readonly resolvedChoiceIds: string[];
  readonly dieRolls: DieRollRecord[];
  readonly influenceLedger: InfluenceLedgerEntry[];
  readonly legitimacyLedger: LegitimacyLedgerEntry[];
  readonly vpLedger: VpLedgerEntry[];
  readonly influenceResolutions: InfluenceResolutionRecord[];
  readonly traces: AdjudicationTrace[];
}
