import type { CountryId } from './m1-setup.js';
import type { InfluenceType } from './m1-adjudication.js';

export type M2BCardZone = 'DECK' | 'HAND' | 'DISCARD' | 'CAMPAIGN' | 'PLANNED_ACTION' | 'REMOVED_FROM_GAME';
export type M2BEffectVersion = '0.1';

export interface M2BCard {
  readonly id: string;
  readonly definitionId: string;
  readonly ownerParticipantId: string;
  controllerParticipantId: string;
  readonly cardClass: 'ACTION' | 'STARTER' | 'CAMPAIGN';
  readonly alignment: InfluenceType | 'DUAL';
  zone: M2BCardZone;
  returnToOwnerOnDiscard: boolean;
}

export interface M2BCampaign {
  readonly id: string;
  readonly ownerParticipantId: string;
  row: 'I' | 'II';
  readonly cardIds: string[];
  activationCountThisTurn: number;
  targetDtId?: string;
}

export interface M2BInfluenceStack {
  readonly pdId: string;
  readonly type: InfluenceType;
  readonly attributionCountryId: CountryId;
  count: number;
}

export interface M2BParticipant {
  readonly id: string;
  readonly countryId: CountryId;
  resources: number;
  victoryPoints: number;
  readonly cardIds: string[];
  regimeAbilityUsed: boolean;
  coreModifierUsed: boolean;
}

export interface M2BAuditRecord {
  readonly type: string;
  readonly actorParticipantId: string;
  readonly payload: Readonly<Record<string, string | number | boolean>>;
}

export interface M2BState {
  version: number;
  readonly registryVersion: M2BEffectVersion;
  readonly participants: Record<string, M2BParticipant>;
  readonly cards: Record<string, M2BCard>;
  readonly campaigns: Record<string, M2BCampaign>;
  readonly influence: M2BInfluenceStack[];
  readonly legitimacyByPd: Record<string, string | null>;
  readonly scheduler: {
    participantIndex: number;
    slotIndex: number;
    status: 'READY' | 'SUSPENDED' | 'COMPLETE';
  };
  readonly audit: M2BAuditRecord[];
}

export interface M2BEffectContext {
  readonly actorParticipantId: string;
  readonly effectId: string;
  readonly effectVersion: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface M2EffectCardChoiceContinuation {
  readonly kind: 'M2_EFFECT_CARD_CHOICE';
  readonly schemaVersion: 1;
  readonly id: string;
  readonly gameVersion: number;
  readonly effectId: 'CARD_EFFECT_BASE_2025_E016' | 'CARD_EFFECT_BASE_2025_E047';
  readonly actorParticipantId: string;
  readonly chooserParticipantId: string;
  readonly targetParticipantId: string;
  readonly sourceCardInstanceId: string;
  readonly eligibleCardIds: readonly string[];
  readonly roll?: number;
  readonly status: 'OPEN';
}

export interface M2EffectChoiceGroup {
  readonly groupId: string;
  readonly minSelections: number;
  readonly maxSelections: number;
  readonly eligibleCardIds: readonly string[];
}

export interface M2EffectGroupedChoiceContinuation {
  readonly kind: 'M2_EFFECT_GROUPED_CHOICE';
  readonly schemaVersion: 1;
  readonly id: string;
  readonly gameVersion: number;
  readonly effectId: 'CARD_EFFECT_BASE_2025_E006' | 'CARD_EFFECT_BASE_2025_E013' | 'CARD_EFFECT_BASE_2025_E035' | 'CARD_EFFECT_BASE_2025_E045' | 'CARD_EFFECT_BASE_2025_E053';
  readonly actorParticipantId: string;
  readonly chooserParticipantId: string;
  readonly targetParticipantId: string;
  readonly sourceCardInstanceId: string;
  readonly groups: readonly M2EffectChoiceGroup[];
  readonly resourceCost: number;
  readonly sourceLifecycleCommitted?: boolean;
  readonly status: 'OPEN';
}

export type M2EffectChoiceContinuation = M2EffectCardChoiceContinuation | M2EffectGroupedChoiceContinuation;

export type M2CoreOperation =
  | { readonly kind: 'APPLY_BACKLASH'; readonly actorParticipantId: string; readonly pdId: string; readonly amount: number }
  | { readonly kind: 'ESTABLISH_LEGITIMACY'; readonly actorParticipantId: string; readonly pdId: string; readonly replacePdId?: string }
  | { readonly kind: 'MODIFY_CAMPAIGN'; readonly actorParticipantId: string; readonly campaignId: string; readonly oldCardId: string; readonly replacementCardId: string }
  | { readonly kind: 'DISCARD_CAMPAIGN'; readonly actorParticipantId: string; readonly campaignId: string }
  | { readonly kind: 'PLAY_STARTER'; readonly actorParticipantId: string; readonly cardId: string }
  | { readonly kind: 'STEAL_BLIND_CARD'; readonly actorParticipantId: string; readonly targetParticipantId: string };

export interface M2CoreSchedulerContinuation {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly operationPlanSha256: string;
  readonly operationCount: number;
  nextIndex: number;
  status: 'READY' | 'COMPLETE';
}

export type M2BEffectError =
  | 'EFFECT_UNKNOWN'
  | 'EFFECT_DISABLED'
  | 'EFFECT_VERSION_MISMATCH'
  | 'INVALID_EFFECT_INPUT'
  | 'INSUFFICIENT_RESOURCES'
  | 'CARD_NOT_ELIGIBLE'
  | 'CARD_WRONG_ZONE'
  | 'REGIME_ABILITY_ALREADY_USED'
  | 'ROLL_MODIFIER_ALREADY_USED'
  | 'INVALID_DIE_VALUE';

export type M2BEffectResult =
  | { readonly ok: true; readonly state: M2BState; readonly emitted: readonly M2BAuditRecord[] }
  | { readonly ok: false; readonly state: M2BState; readonly error: M2BEffectError; readonly emitted: readonly [] };
