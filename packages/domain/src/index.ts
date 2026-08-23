import type { Brand } from '@malign-ai/shared';

export type GameId = Brand<string, 'GameId'>;
export type ParticipantId = Brand<string, 'ParticipantId'>;

export interface RandomProvider {
  integer(minInclusive: number, maxInclusive: number): number;
}

export interface Clock {
  now(): Date;
}

export const VERSION_BASELINE = {
  rulesetVersion: '0.1',
  scenarioVersion: '0.1',
  cardRegistryVersion: '0.1',
  engineContractVersion: '0.1',
} as const;
