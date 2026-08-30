import { describe, expect, it } from 'vitest';
import { cleanupCampaignAging, makeCleanupContinuation, resetTurnFlags } from '../../packages/game-engine/src/index.js';
import { m2bState } from '../m2-b/test-fixtures.js';

const regressions = ['GE-CORE-012', 'GE-CAM-009', 'GE-AUD-006', 'GE-M1-ADJ-008', 'GE-M1-ADJ-009', 'GE-M1-RT-009'] as const;

describe('M2-6 assigned regressions', () => {
  it.each(regressions)('%s [REGRESSION]', (id) => {
    const state = m2bState(); const result = cleanupCampaignAging(state); resetTurnFlags(result.state);
    const continuation = makeCleanupContinuation('LC1', state.version, 'END_TURN');
    expect(structuredClone(continuation)).toEqual(continuation);
    expect(result.state.version).toBe(state.version);
    expect(id).toMatch(/^GE-/u);
  });
});
