import { describe, expect, it } from 'vitest';

const M0_ORACLE_IDS = [
  'GE-ERT-003','GE-ERT-004','GE-ERT-005','GE-ERT-006','GE-ERT-008','GE-ERT-017','GE-ERT-018','GE-ERT-019','GE-ERT-020','GE-ERT-021','GE-CUBE-001','GE-CUBE-002','GE-CUBE-003','GE-CUBE-005','GE-CORE-012',
  'GE-CORE-001','GE-CORE-002','GE-CORE-003','GE-CORE-004','GE-CORE-005','GE-CORE-006','GE-CORE-008','GE-CORE-010','GE-PLAN-001','GE-PLAN-005',
  'GE-CAM-001','GE-CAM-002','GE-CAM-003','GE-CAM-004','GE-CAM-005','GE-CAM-008','GE-CAM-009','GE-ERT-001','GE-ERT-002','GE-ERT-007',
] as const;

describe('PR-0 M0 oracle inventory', () => {
  it('preserves exactly 35 unique approved test IDs without implementing PR-1 rules', () => {
    expect(M0_ORACLE_IDS).toHaveLength(35);
    expect(new Set(M0_ORACLE_IDS).size).toBe(35);
  });
});
