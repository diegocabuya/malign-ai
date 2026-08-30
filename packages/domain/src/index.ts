import type { Brand } from '@malign-ai/shared';

export type GameId = Brand<string, 'GameId'>;
export type ParticipantId = Brand<string, 'ParticipantId'>;

export interface RandomProvider {
  integer(minInclusive: number, maxInclusive: number): number;
}

export interface RandomProviderCheckpoint {
  readonly cursor: number;
}

export interface TransactionalRandomProvider extends RandomProvider {
  checkpoint(): RandomProviderCheckpoint;
  restore(checkpoint: RandomProviderCheckpoint): void;
  commit(checkpoint: RandomProviderCheckpoint): void;
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

export * from './m1-setup.js';
export * from './base-2025.js';
export * from './m1-adjudication.js';
export * from './durable-transition.js';
export * from './m2b.js';
