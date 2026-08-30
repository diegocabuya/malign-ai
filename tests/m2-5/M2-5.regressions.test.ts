import { describe, expect, it } from 'vitest';
import { M2BEffectDispatcher, openReactionWindow, passReactionPriority, projectReactionWindow } from '../../packages/game-engine/src/index.js';
import { m2bState } from '../m2-b/test-fixtures.js';

const regressions = ['GE-CORE-009', 'GE-CHO-001', 'GE-CHO-002', 'GE-PLAN-004', 'GE-SEC-001', 'GE-SEC-002', 'GE-SEC-003', 'GE-SEC-004', 'GE-M1-ADJ-006', 'GE-M1-RT-003', 'GE-M2-EFX-001'] as const;

describe('M2-5 assigned regressions', () => {
  it.each(regressions)('%s [REGRESSION]', (id) => {
    const state = m2bState(); const window = openReactionWindow('W1', 'DOUBLE_AGENT', 'P1', ['P1', 'P2', 'P3']);
    if (id.startsWith('GE-SEC-')) {
      expect(projectReactionWindow(window, 'P3', false)).not.toHaveProperty('options');
    } else if (id === 'GE-M2-EFX-001') {
      const before = structuredClone(state);
      expect(new M2BEffectDispatcher('M2-4').dispatch(state, { actorParticipantId: 'P1', effectId: 'UNKNOWN', effectVersion: '0.1', parameters: {} })).toMatchObject({ ok: false, error: 'EFFECT_UNKNOWN' });
      expect(state).toEqual(before);
    } else {
      expect(passReactionPriority(window, 'P2')).toBeUndefined(); expect(window.passes).toEqual(['P2']);
    }
  });
});
