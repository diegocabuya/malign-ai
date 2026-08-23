import type { Clock, ParticipantId, RandomProvider } from '@malign-ai/domain';

export const PARTICIPANTS = {
  P1: 'P1' as ParticipantId,
  P2: 'P2' as ParticipantId,
  P3: 'P3' as ParticipantId,
  P4: 'P4' as ParticipantId,
  P5: 'P5' as ParticipantId,
  F1: 'F1' as ParticipantId,
} as const;

export const SEMANTIC_PD_IDS = ['ARDEN_PD_1', 'PRESQUE_PD_1'] as const;

export class FixedClock implements Clock {
  constructor(private readonly instant: Date) {}

  now(): Date {
    return new Date(this.instant);
  }
}

export class SequenceRandomProvider implements RandomProvider {
  #index = 0;

  constructor(private readonly values: readonly number[]) {
    if (values.length === 0) throw new Error('At least one deterministic value is required');
  }

  integer(minInclusive: number, maxInclusive: number): number {
    const value = this.values[this.#index];
    if (value === undefined) throw new Error('Deterministic RNG sequence exhausted');
    if (value < minInclusive || value > maxInclusive) throw new RangeError('Deterministic value outside requested range');
    this.#index += 1;
    return value;
  }
}

export interface GameStateBuilder {
  withVersion(version: number): GameStateBuilder;
  build(): { readonly version: number };
}

export const gameStateBuilder = (): GameStateBuilder => {
  let version = 0;
  return {
    withVersion(nextVersion) {
      version = nextVersion;
      return this;
    },
    build: () => ({ version }),
  };
};
