import type { InfluenceType } from './m1-adjudication.js';
import type { M2BState } from './m2b.js';

export interface ViralOrigin {
  readonly pdId: string;
  readonly ownerParticipantId: string;
  readonly type: InfluenceType;
  readonly validDestinationPdIds: readonly string[];
}

export interface CleanupContinuation {
  readonly kind: 'CLEANUP';
  readonly schemaVersion: 1;
  readonly id: string;
  readonly expectedGameVersion: number;
  readonly step: 'AGING' | 'VIRAL_SNAPSHOT' | 'VIRAL_RESOLUTION' | 'RESET' | 'END_TURN' | 'COMPLETE';
  readonly viralOrigins: readonly ViralOrigin[];
  readonly nextOriginIndex: number;
  readonly variant?: 'BASELINE' | 'SHORT';
  readonly tieChoices?: Readonly<Record<string, InfluenceType>>;
}

export interface ViralChoiceContinuation {
  readonly kind: 'VIRAL_CHOICE';
  readonly schemaVersion: 1;
  readonly id: string;
  readonly gameVersion: number;
  readonly choiceType: 'INFLUENCE_TYPE' | 'DESTINATION_PD';
  readonly chooserParticipantId: string;
  readonly originPdId: string;
  readonly options: readonly string[];
  readonly status: 'OPEN';
}

export interface ViralResolution {
  readonly attempted: boolean;
  readonly success: boolean;
  readonly generated: number;
  readonly placed: number;
  readonly removed: number;
  readonly rollsConsumed: number;
}

export interface CleanupResult {
  readonly state: M2BState;
  readonly agedCampaignIds: readonly string[];
  readonly discardedCampaignIds: readonly string[];
}

export type LifecycleError = 'INVALID_TARGET_PD' | 'INVALID_VIRAL_ROLL' | 'STALE_CLEANUP_CONTINUATION' | 'INVALID_CLEANUP_STEP';
