import { describe, expect, it } from 'vitest';
import { M2BEffectDispatcher } from '../../packages/game-engine/src/index.js';
import { m2bState } from './test-fixtures.js';

const regressions = [
  'GE-CORE-002', 'GE-CORE-005', 'GE-CORE-009', 'GE-CORE-012', 'GE-PLAN-003', 'GE-PLAN-004',
  'GE-CAM-001', 'GE-CAM-005', 'GE-CAM-008', 'GE-ERT-007', 'GE-ERT-008', 'GE-M2-EFX-001',
] as const;

describe('M2-4 assigned regressions', () => {
  it.each(regressions)('%s [REGRESSION]', () => {
    const state = m2bState(); const result = new M2BEffectDispatcher('M2-4').dispatch(state, {
      actorParticipantId: 'P1', effectId: 'CARD_EFFECT_BASE_2025_E014', effectVersion: '0.1',
      parameters: { pdId: 'PRESQUE_PD_1', type: 'MALIGN', amount: 1 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.state.version).toBe(11); expect(result.emitted).toHaveLength(1); }
  });
});
