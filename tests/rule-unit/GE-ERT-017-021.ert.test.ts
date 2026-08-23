import { describe, expect, it } from 'vitest';
import { ERT_TABLE, lookupErt, normalizeErtRoll } from '../../packages/rules/src/index.js';

const EXPECTED_ERT = [
  { LOW: { MALIGN: -2, RESILIENCY: -1 }, MEDIUM: { MALIGN: -2, RESILIENCY: -1 }, HIGH: { MALIGN: -2, RESILIENCY: -1 } },
  { LOW: { MALIGN: -1, RESILIENCY: -1 }, MEDIUM: { MALIGN: -1, RESILIENCY: 0 }, HIGH: { MALIGN: -1, RESILIENCY: 0 } },
  { LOW: { MALIGN: -1, RESILIENCY: 0 }, MEDIUM: { MALIGN: -1, RESILIENCY: 0 }, HIGH: { MALIGN: 0, RESILIENCY: 0 } },
  { LOW: { MALIGN: 0, RESILIENCY: 0 }, MEDIUM: { MALIGN: 0, RESILIENCY: 0 }, HIGH: { MALIGN: 1, RESILIENCY: 1 } },
  { LOW: { MALIGN: 0, RESILIENCY: 0 }, MEDIUM: { MALIGN: 1, RESILIENCY: 1 }, HIGH: { MALIGN: 1, RESILIENCY: 1 } },
  { LOW: { MALIGN: 1, RESILIENCY: 1 }, MEDIUM: { MALIGN: 1, RESILIENCY: 1 }, HIGH: { MALIGN: 2, RESILIENCY: 2 } },
  { LOW: { MALIGN: 1, RESILIENCY: 1 }, MEDIUM: { MALIGN: 2, RESILIENCY: 2 }, HIGH: { MALIGN: 3, RESILIENCY: 3 } },
  { LOW: { MALIGN: 1, RESILIENCY: 1 }, MEDIUM: { MALIGN: 2, RESILIENCY: 2 }, HIGH: { MALIGN: 3, RESILIENCY: 3 } },
  { LOW: { MALIGN: 2, RESILIENCY: 2 }, MEDIUM: { MALIGN: 3, RESILIENCY: 3 }, HIGH: { MALIGN: 4, RESILIENCY: 4 } },
  { LOW: { MALIGN: 2, RESILIENCY: 2 }, MEDIUM: { MALIGN: 3, RESILIENCY: 3 }, HIGH: { MALIGN: 4, RESILIENCY: 4 } },
] as const;

describe('PR-1 versioned ERT data and lookup', () => {
  it('GE-ERT-017 preserves raw modified roll and clamps lookup roll at 10', () => {
    expect(normalizeErtRoll(10 + 1 + 1 + 1)).toEqual({ modifiedRollRaw: 13, ertRoll: 10 });
  });

  it('GE-ERT-018 returns low malign row 1 backlash', () => {
    expect(lookupErt('LOW', 'MALIGN', 1)).toBe(-2);
  });

  it('GE-ERT-019 returns medium resiliency row 2 no effect', () => {
    expect(lookupErt('MEDIUM', 'RESILIENCY', 2)).toBe(0);
  });

  it('GE-ERT-020 returns high row 10 positive four for either alignment', () => {
    expect(lookupErt('HIGH', 'MALIGN', 10)).toBe(4);
    expect(lookupErt('HIGH', 'RESILIENCY', 10)).toBe(4);
  });

  it('GE-ERT-021 matches all 30 authoritative tier cells byte-for-byte', () => {
    expect(ERT_TABLE).toEqual(EXPECTED_ERT);
  });
});
