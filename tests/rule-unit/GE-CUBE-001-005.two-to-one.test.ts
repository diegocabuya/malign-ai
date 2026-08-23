import { describe, expect, it } from 'vitest';
import { resolveTwoToOne } from '../../packages/rules/src/index.js';

describe('PR-1 exact 2:1 cube algorithm', () => {
  it('GE-CUBE-001 consumes an exact incoming pair to remove one opposite', () => {
    expect(resolveTwoToOne(2, 1)).toEqual({ generated: 2, consumedInCancellation: 2, oppositeRemoved: 1, placed: 0, oppositeRemaining: 0 });
  });

  it('GE-CUBE-002 consumes two of three incoming and places one', () => {
    expect(resolveTwoToOne(3, 2)).toEqual({ generated: 3, consumedInCancellation: 2, oppositeRemoved: 1, placed: 1, oppositeRemaining: 1 });
  });

  it('GE-CUBE-003 cannot remove more opposition than exists', () => {
    expect(resolveTwoToOne(6, 1)).toEqual({ generated: 6, consumedInCancellation: 2, oppositeRemoved: 1, placed: 4, oppositeRemaining: 0 });
  });

  it('GE-CUBE-005 does not perform one-to-one cancellation', () => {
    expect(resolveTwoToOne(1, 1)).toEqual({ generated: 1, consumedInCancellation: 0, oppositeRemoved: 0, placed: 1, oppositeRemaining: 1 });
  });

  it('invariant: 2:1 conservation and non-negativity hold for a broad input space', () => {
    for (let incoming = 0; incoming <= 100; incoming += 1) for (let opposite = 0; opposite <= 100; opposite += 1) {
      const result = resolveTwoToOne(incoming, opposite);
      expect(result.consumedInCancellation + result.placed).toBe(incoming);
      expect(result.consumedInCancellation).toBe(result.oppositeRemoved * 2);
      expect(result.oppositeRemaining).toBeGreaterThanOrEqual(0);
    }
  });
});
