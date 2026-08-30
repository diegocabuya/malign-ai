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
