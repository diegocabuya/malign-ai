import type { CountryId } from './m1-setup.js';

export interface PdObjectiveMetrics {
  readonly hostCountryId: CountryId;
  readonly traits: readonly string[];
  readonly totalMalign: number;
  readonly totalResiliency: number;
  readonly attributedMalign: Readonly<Partial<Record<CountryId, number>>>;
  readonly attributedResiliency: Readonly<Partial<Record<CountryId, number>>>;
  readonly narrativeTaggedCountries?: readonly CountryId[];
}

export interface ObjectiveEvaluation {
  readonly countryId: CountryId;
  readonly hardVp: number;
  readonly mediumVp: number;
  readonly easyVp: number;
  readonly totalVp: number;
}

export interface FinalParticipantScore {
  readonly participantId: string;
  readonly countryId: CountryId;
  readonly baseVp: number;
  readonly objectiveVp: number;
  readonly finalVp: number;
  readonly ownCountryMalign: number;
}

export interface GameOutcome {
  readonly status: 'GAME_COMPLETED';
  readonly scores: readonly FinalParticipantScore[];
  readonly winnerParticipantIds: readonly string[];
  readonly sharedVictory: boolean;
}

export interface EndGameState {
  readonly idempotencyResults: Record<string, GameOutcome>;
  readonly awardedObjectiveKeys: string[];
  outcome?: GameOutcome;
}
