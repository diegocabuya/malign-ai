import { describe, expect, it } from 'vitest';
import {
  advanceCleanupContinuation,
  cleanupCampaignAging,
  makeCleanupContinuation,
  resetTurnFlags,
  resolveViralOrigin,
  snapshotViralOrigins,
} from '../../packages/game-engine/src/index.js';
import { m2bState } from '../m2-b/test-fixtures.js';

const owners = ['GE-CORE-007', 'GE-CAM-011', 'GE-CAM-012', 'GE-CLN-001', 'GE-CLN-002', ...Array.from({ length: 12 }, (_, index) => `GE-VIR-${String(index + 1).padStart(3, '0')}`), 'GE-M2-LC-001'] as const;
const traits = { ARDEN_PD_1: ['MEDIA'], ARDEN_PD_2: ['ELITE'], FLUMA_PD_1: ['MEDIA'], PRESQUE_PD_1: ['RELIGION'] } as const;

const viralState = () => {
  const state = m2bState(); state.legitimacyByPd.ARDEN_PD_1 = 'P1';
  state.influence = [{ pdId: 'ARDEN_PD_1', type: 'MALIGN', attributionCountryId: 'ARDEN', count: 9 }];
  return state;
};

describe('M2-6 owner gate — Cleanup, Viralization and End Turn', () => {
  it.each(owners)('%s', (id) => {
    if (id.startsWith('GE-VIR-')) {
      const number = Number(id.slice(-3)); const state = viralState();
      if (number === 1) state.legitimacyByPd.ARDEN_PD_1 = null;
      if (number === 2) state.influence[0]!.attributionCountryId = 'FLUMA';
      if (number === 6 || number === 7) state.influence.push({ pdId: 'ARDEN_PD_1', type: 'RESILIENCY', attributionCountryId: 'ARDEN', count: number === 6 ? 9 : 9 });
      if (number === 6) state.influence[0]!.count = 10;
      if (number === 12) state.influence[0]!.count = 8;
      if (number === 11) state.influence[0]!.count = 7;
      const snapshot = snapshotViralOrigins(state, ['P1', 'P2', 'P3', 'P4', 'P5'], traits, number === 11 ? 'SHORT' : 'BASELINE', { ARDEN_PD_1: 'RESILIENCY' });
      if (number <= 2 || number === 12) expect(snapshot).toHaveLength(0);
      else if (number === 8) expect(resolveViralOrigin(state, snapshot[0]!, 'PRESQUE_PD_1', [6, 8], 'BASELINE')).toBe('INVALID_TARGET_PD');
      else if (number === 9) {
        state.legitimacyByPd.FLUMA_PD_1 = 'P2'; state.influence.push({ pdId: 'FLUMA_PD_1', type: 'MALIGN', attributionCountryId: 'FLUMA', count: 9 });
        expect(snapshotViralOrigins(state, ['P2', 'P1'], traits, 'BASELINE').map(({ ownerParticipantId }) => ownerParticipantId)).toEqual(['P2', 'P1']);
      } else {
        expect(snapshot).toHaveLength(1); const origin = snapshot[0]!;
        if (number === 6) expect(origin.type).toBe('MALIGN');
        if (number === 7) expect(origin.type).toBe('RESILIENCY');
        const rolls = number === 5 ? [5] : number === 4 ? [7, 3] : number === 11 ? [6] : [6, 8];
        const result = resolveViralOrigin(state, origin, 'FLUMA_PD_1', rolls, number === 11 ? 'SHORT' : 'BASELINE');
        expect(typeof result).toBe('object');
        if (typeof result === 'object') {
          if (number === 5) expect(result).toMatchObject({ success: false, rollsConsumed: 1 });
          else expect(result.generated).toBe(number === 4 || number === 11 ? 1 : 2);
        }
        if (number === 10) expect(snapshot).toHaveLength(1);
      }
    } else if (id === 'GE-M2-LC-001') {
      let continuation = makeCleanupContinuation('LC1', 10);
      const restored = structuredClone(continuation); expect(restored).toEqual(continuation);
      const next = advanceCleanupContinuation(restored, 10); expect(typeof next).toBe('object');
      if (typeof next === 'object') { continuation = next; expect(advanceCleanupContinuation(continuation, 10)).toBe('STALE_CLEANUP_CONTINUATION'); }
    } else {
      const state = m2bState();
      if (id === 'GE-CAM-012' || id === 'GE-CLN-001') {
        state.campaigns.CAM2 = { id: 'CAM2', ownerParticipantId: 'P2', row: 'II', cardIds: ['P2A'], activationCountThisTurn: 1 };
        state.cards.P2A!.zone = 'CAMPAIGN';
      }
      if (id === 'GE-CAM-012') state.campaigns.CAM1!.row = 'II';
      const result = cleanupCampaignAging(state);
      if (id === 'GE-CAM-011' || id === 'GE-CLN-001') expect(result.state.campaigns.CAM1!.row).toBe('II');
      if (id === 'GE-CAM-012') expect(result.state.campaigns.CAM1).toBeUndefined();
      if (id === 'GE-CLN-001') expect(result.state.campaigns.CAM2).toBeUndefined();
      resetTurnFlags(result.state);
      if (id === 'GE-CLN-002') expect(result.state.participants.P1).toMatchObject({ regimeAbilityUsed: false, coreModifierUsed: false });
      if (id === 'GE-CORE-007') expect(result.state.scheduler.status).toBe('READY');
    }
  });
});
