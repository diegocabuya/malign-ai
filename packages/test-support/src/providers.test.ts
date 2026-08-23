import { describe, expect, it } from 'vitest';
import { FixedClock, SequenceRandomProvider } from './index.js';

describe('PR-0 deterministic test providers', () => {
  it('returns a defensive copy of fixed time', () => {
    const clock = new FixedClock(new Date('2026-08-22T00:00:00.000Z'));
    expect(clock.now().toISOString()).toBe('2026-08-22T00:00:00.000Z');
  });

  it('consumes explicit random values in order', () => {
    const random = new SequenceRandomProvider([2, 10]);
    expect(random.integer(1, 10)).toBe(2);
    expect(random.integer(1, 10)).toBe(10);
  });
});
