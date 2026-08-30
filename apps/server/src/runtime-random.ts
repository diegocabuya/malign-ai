import { randomInt } from 'node:crypto';

import type { RandomProviderCheckpoint, TransactionalRandomProvider } from '@malign-ai/domain';

/** Cryptographic application RNG with transactional replay after rollback/CAS failure. */
export class BufferedTransactionalRandomProvider implements TransactionalRandomProvider {
  readonly #values: number[] = [];
  #cursor = 0;

  checkpoint(): RandomProviderCheckpoint { return { cursor: this.#cursor }; }

  restore(checkpoint: RandomProviderCheckpoint): void {
    if (!Number.isSafeInteger(checkpoint.cursor) || checkpoint.cursor < 0 || checkpoint.cursor > this.#values.length) {
      throw new Error('Invalid random checkpoint');
    }
    this.#cursor = checkpoint.cursor;
  }

  commit(checkpoint: RandomProviderCheckpoint): void {
    if (!Number.isSafeInteger(checkpoint.cursor) || checkpoint.cursor < 0 || checkpoint.cursor > this.#cursor) {
      throw new Error('Invalid random checkpoint');
    }
  }

  integer(minInclusive: number, maxInclusive: number): number {
    if (!Number.isSafeInteger(minInclusive) || !Number.isSafeInteger(maxInclusive) || minInclusive > maxInclusive) {
      throw new Error('Invalid random range');
    }
    const existing = this.#values[this.#cursor];
    if (existing !== undefined) {
      if (existing < minInclusive || existing > maxInclusive) throw new Error('Random replay range mismatch');
      this.#cursor += 1;
      return existing;
    }
    const generated = randomInt(minInclusive, maxInclusive + 1);
    this.#values.push(generated);
    this.#cursor += 1;
    return generated;
  }
}
