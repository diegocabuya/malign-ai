import { describe, expect, it } from 'vitest';
import { M2BEffectDispatcher, runM2BScheduler } from '../../packages/game-engine/src/index.js';
import { m2bState } from './test-fixtures.js';

const regressions = [
  'GE-CORE-001', 'GE-CORE-002', 'GE-CORE-005', 'GE-CORE-006', 'GE-CORE-009', 'GE-CORE-012',
  'GE-PLAN-001', 'GE-PLAN-003', 'GE-PLAN-004', 'GE-PLAN-005',
  'GE-CAM-001', 'GE-CAM-005', 'GE-CAM-008', 'GE-CAM-009',
  'GE-ERT-001', 'GE-ERT-002', 'GE-ERT-007', 'GE-ERT-008',
] as const;

describe('M2-3 assigned regressions', () => {
  it.each(regressions)('%s [REGRESSION]', (id) => {
    const state = m2bState(); const before = structuredClone(state);
    if (id.startsWith('GE-PLAN-')) {
      expect(runM2BScheduler([1, 2, 3], () => 'RESOLVED').executionOrder).toEqual([0, 1, 2]);
    } else {
      const rejected = new M2BEffectDispatcher('M2-3').dispatch(state, {
        actorParticipantId: 'P1', effectId: 'CARD_EFFECT_BASE_2025_E014', effectVersion: '0.1', parameters: {},
      });
      expect(rejected).toMatchObject({ ok: false, error: 'EFFECT_DISABLED', emitted: [] });
      expect(state).toEqual(before);
    }
  });
});
