import { describe, expect, it } from 'vitest';
import {
  advanceCleanupContinuation,
  cleanupCampaignAging,
  makeCleanupContinuation,
  resetTurnFlags,
} from '../../packages/game-engine/src/index.js';
import { m2bState } from '../m2-b/test-fixtures.js';

const owners = ['GE-M2-LC-001'] as const;

describe('M2-6 owner gate — Cleanup, Viralization and End Turn', () => {
  it.each(owners)('%s', (id) => {
    if (id === 'GE-M2-LC-001') {
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
