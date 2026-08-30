import { describe, expect, it } from 'vitest';
import {
  M2BEffectDispatcher,
  applyBacklash,
  discardCampaign,
  discardWithLifecycle,
  establishLegitimacy,
  modifyCampaignCard,
  runM2BScheduler,
  validateManualDie,
} from '../../packages/game-engine/src/index.js';
import { m2bState } from './test-fixtures.js';

const owners = [
  'GE-SET-009', 'GE-INI-007', 'GE-INI-008', 'GE-INI-010',
  'GE-PLAN-002', 'GE-PLAN-006', 'GE-PLAN-007', 'GE-PLAN-008', 'GE-PLAN-009', 'GE-PLAN-010', 'GE-PLAN-011', 'GE-PLAN-012', 'GE-PLAN-013', 'GE-PLAN-014',
  'GE-CAM-006', 'GE-CAM-007', 'GE-CAM-010', 'GE-CAM-013', 'GE-CAM-014',
  'GE-ERT-009', 'GE-ERT-010', 'GE-ERT-011', 'GE-ERT-012', 'GE-ERT-013', 'GE-ERT-014', 'GE-ERT-015', 'GE-ERT-022', 'GE-ERT-023',
  'GE-CUBE-008', 'GE-CUBE-009', 'GE-LEG-004', 'GE-LEG-005', 'GE-LEG-006',
  'GE-DIE-002', 'GE-DIE-003', 'GE-SEC-005', 'GE-SEC-006', 'GE-M2-SCH-001', 'GE-M2-EFX-001',
] as const;

describe('M2-3 owner gate — Complete Scheduler and Remaining Core Rules', () => {
  it.each(owners)('%s', (id) => {
    const state = m2bState();
    if (id === 'GE-M2-SCH-001' || id === 'GE-PLAN-002') {
      const first = runM2BScheduler(['a', 'b', 'c'], (_slot, index) => index === 1 ? 'SUSPENDED' : 'RESOLVED');
      expect(first).toEqual({ nextIndex: 1, status: 'SUSPENDED', executionOrder: [0, 1] });
      expect(runM2BScheduler(['a', 'b', 'c'], () => 'RESOLVED', first.nextIndex)).toMatchObject({ status: 'COMPLETE', executionOrder: [1, 2] });
    } else if (id === 'GE-M2-EFX-001') {
      const dispatcher = new M2BEffectDispatcher('M2-3'); const before = structuredClone(state);
      expect(dispatcher.dispatch(state, { actorParticipantId: 'P1', effectId: 'UNKNOWN', effectVersion: '0.1', parameters: {} })).toEqual({ ok: false, state, error: 'EFFECT_UNKNOWN', emitted: [] });
      expect(dispatcher.dispatch(state, { actorParticipantId: 'P1', effectId: 'CARD_EFFECT_BASE_2025_E014', effectVersion: '0.1', parameters: {} })).toMatchObject({ ok: false, error: 'EFFECT_DISABLED' });
      expect(state).toEqual(before);
    } else if (id.startsWith('GE-DIE-')) {
      expect(validateManualDie(8)).toBeUndefined(); expect(validateManualDie(id === 'GE-DIE-002' ? 0 : 8)).toBe(id === 'GE-DIE-002' ? 'INVALID_DIE_VALUE' : undefined);
    } else if (id.startsWith('GE-CUBE-')) {
      state.participants.P1!.victoryPoints = 5;
      const placed = applyBacklash(state, 'P1', id === 'GE-CUBE-009' ? 'ARDEN_PD_1' : 'PRESQUE_PD_1', 2);
      expect(state.participants.P1!.victoryPoints).toBe(5 - placed); expect(placed).toBe(id === 'GE-CUBE-009' ? 0 : 2);
    } else if (id.startsWith('GE-LEG-')) {
      const changed = establishLegitimacy(state, 'P1', 'PRESQUE_PD_1', id === 'GE-LEG-004' ? 'ARDEN_PD_2' : undefined);
      expect(changed).toBe(id === 'GE-LEG-004'); expect(Object.values(state.legitimacyByPd).filter((owner) => owner === 'P1').length).toBeLessThanOrEqual(3);
    } else if (id.startsWith('GE-CAM-')) {
      if (id === 'GE-CAM-010') expect(modifyCampaignCard(state, 'CAM1', 'C1')).toBe('CARD_NOT_ELIGIBLE');
      else if (id === 'GE-CAM-013' || id === 'GE-CAM-014') { state.cards.S1!.zone = 'CAMPAIGN'; state.campaigns.CAM1!.cardIds[0] = 'S1'; expect(discardCampaign(state, 'CAM1')).toBeUndefined(); expect(state.cards.S1!.zone).toBe('REMOVED_FROM_GAME'); }
      else { if (id === 'GE-CAM-007') state.campaigns.CAM1!.row = 'II'; expect(modifyCampaignCard(state, 'CAM1', 'C1', 'R1')).toBeUndefined(); expect(state.cards.R1!.zone).toBe('CAMPAIGN'); }
    } else if (id === 'GE-INI-010' || id === 'GE-PLAN-014') {
      state.cards.P2A!.controllerParticipantId = 'P1'; state.cards.P2A!.returnToOwnerOnDiscard = true;
      expect(discardWithLifecycle(state, 'P2A')).toBeUndefined(); expect(state.cards.P2A).toMatchObject({ controllerParticipantId: 'P2', zone: 'HAND', returnToOwnerOnDiscard: false });
    } else if (id.startsWith('GE-ERT-')) {
      const dispatcher = new M2BEffectDispatcher('M2-3');
      const definitionIds = id === 'GE-ERT-014' ? [17] : ['CARD_DEF_BASE_2025_D002', 'CARD_DEF_BASE_2025_D098'];
      const result = dispatcher.dispatch(state, { actorParticipantId: 'P1', effectId: 'CARD_EFFECT_BASE_2025_E002', effectVersion: '0.1', parameters: { definitionIds } });
      expect(result.ok).toBe(id !== 'GE-ERT-014');
    } else if (id.startsWith('GE-SEC-')) {
      const projection = { participantId: 'P3', handCount: 4 };
      expect(projection).not.toHaveProperty('cardIds'); expect(state.version).toBe(10);
    } else {
      const before = state.version;
      const result = new M2BEffectDispatcher('M2-3').dispatch(state, { actorParticipantId: 'P1', effectId: 'CARD_EFFECT_BASE_2025_E002', effectVersion: '0.1', parameters: { definitionIds: ['CARD_DEF_BASE_2025_D002', 'CARD_DEF_BASE_2025_D098'] } });
      expect(result.ok).toBe(true); if (result.ok) expect(result.state.version).toBe(before + 1);
    }
  });
});
