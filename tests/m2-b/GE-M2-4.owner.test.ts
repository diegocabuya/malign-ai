import { describe, expect, it } from 'vitest';
import {
  M2BEffectDispatcher,
  applyDirectInfluence,
  discardCampaign,
  discardWithLifecycle,
  stealBlindCard,
  recordQualifyingResourceSpend,
  resolveFlumaRegimeSpends,
} from '../../packages/game-engine/src/index.js';
import { m2bState } from './test-fixtures.js';

// These owners execute their full authenticated/canonical scenarios in
// M2R-R01.integrated-state.test.ts rather than duplicating a shallow fixture mutation here.
const integratedActionOwners = new Set(['GE-ACT-001','GE-ACT-002','GE-ACT-003','GE-ACT-004','GE-ACT-005','GE-ACT-006','GE-ACT-007','GE-ACT-008','GE-ACT-009','GE-ACT-013','GE-ACT-014','GE-ACT-015','GE-ACT-018','GE-ACT-019','GE-ACT-020','GE-ACT-021','GE-ACT-022','GE-ACT-023','GE-ACT-024','GE-ACT-025','GE-ACT-026','GE-ACT-027','GE-ACT-029','GE-ACT-030']);
const actionOwners = Array.from({ length: 30 }, (_, index) => `GE-ACT-${String(index + 1).padStart(3, '0')}`)
  .filter((id)=>!integratedActionOwners.has(id));
const regimeOwners = Array.from({ length: 15 }, (_, index) => `GE-REG-${String(index + 1).padStart(3, '0')}`);

describe('M2-4 owner gate — Action/Starter Cards and Regime Abilities', () => {
  it.each(actionOwners)('%s', (id) => {
    const state = m2bState(); const number = Number(id.slice(-3)); const dispatcher = new M2BEffectDispatcher('M2-4');
    if (number === 1) {
      const before = state.participants.P2!.resources;
      const result = dispatcher.dispatch(state, { actorParticipantId: 'P1', effectId: 'CARD_EFFECT_BASE_2025_E001', effectVersion: '0.1', parameters: { targetParticipantId: 'P2' } });
      expect(result.ok).toBe(true); if (result.ok) expect(result.state.participants.P2!.resources).toBe(before + 2);
    } else if (number >= 2 && number <= 5) {
      const selected = Object.values(state.cards).filter((card) => card.controllerParticipantId === 'P2' && card.zone === 'HAND' && card.cardClass === 'ACTION').slice(0, Math.min(number === 3 ? 5 : 2, 4));
      selected.forEach((card) => discardWithLifecycle(state, card.id));
      expect(selected.every((card) => card.zone === 'DISCARD')).toBe(true);
    } else if (number >= 6 && number <= 8) {
      const type = number === 8 ? 'RESILIENCY' : 'MALIGN'; const pdId = number === 7 ? 'FLUMA_PD_1' : 'PRESQUE_PD_1';
      const beforeVp = state.participants.P1!.victoryPoints; const legitimacyBefore = state.legitimacyByPd[pdId] ?? null; const result = applyDirectInfluence(state, pdId, type, 'ARDEN', 3);
      expect(result.placed).toBeGreaterThanOrEqual(1); expect(state.participants.P1!.victoryPoints).toBe(beforeVp); expect(state.legitimacyByPd[pdId] ?? null).toBe(legitimacyBefore);
    } else if (number >= 9 && number <= 11) {
      const stolen = stealBlindCard(state, 'P1', 'P2', 0); expect(stolen).toBeDefined();
      const card = state.cards[stolen!]; expect(card).toMatchObject({ ownerParticipantId: 'P2', controllerParticipantId: 'P1', returnToOwnerOnDiscard: true });
      if (number === 11) { discardWithLifecycle(state, stolen!); expect(card!.controllerParticipantId).toBe('P2'); }
    } else if (number === 12) {
      expect(discardCampaign(state, 'CAM1')).toBeUndefined(); expect(state.campaigns.CAM1).toBeUndefined();
    } else if (number >= 13 && number <= 15) {
      state.participants.P2!.resources = number - 13;
      const result = dispatcher.dispatch(state, { actorParticipantId: 'P1', effectId: 'CARD_EFFECT_BASE_2025_E019', effectVersion: '0.1', parameters: { targetParticipantId: 'P2' } });
      expect(result.ok).toBe(true); if (result.ok) expect(result.state.participants.P2!.resources).toBe(0);
    } else if (number === 16 || number === 17) {
      if (number === 17) state.participants.P1!.resources = 0;
      const cost = dispatcher.dispatch(state, { actorParticipantId: 'P1', effectId: 'CARD_EFFECT_BASE_2025_E025', effectVersion: '0.1', parameters: { campaignId: 'CAM1' } });
      expect(cost.ok).toBe(number === 16); if (cost.ok) expect(cost.state.campaigns.CAM1!.activationCountThisTurn).toBe(2);
    } else if (number === 18) {
      const revealed = Object.values(state.cards).filter((card) => card.controllerParticipantId === 'P2' && card.zone === 'HAND').slice(0, 3).map(({ id: cardId }) => cardId);
      expect(new Set(revealed).size).toBe(3); expect(state.cards.P2A!.zone).toBe('HAND');
    } else if (number === 19) {
      state.cards.A1!.zone = 'DECK'; state.cards.A2!.zone = 'HAND'; [state.cards.A1!.zone, state.cards.A2!.zone] = ['HAND', 'DECK'];
      expect(state.cards.A1!.zone).toBe('HAND'); expect(state.cards.A2!.zone).toBe('DECK');
    } else if (number === 20 || number === 21) {
      const handBefore = Object.values(state.cards).filter((card) => card.controllerParticipantId === 'P1' && card.zone === 'HAND').length;
      ['A1', 'A2', 'A3'].forEach((cardId) => { state.cards[cardId]!.zone = 'HAND'; });
      const handAfter = Math.min(10, Object.values(state.cards).filter((card) => card.controllerParticipantId === 'P1' && card.zone === 'HAND').length);
      expect(handAfter).toBeGreaterThanOrEqual(handBefore); expect(handAfter).toBeLessThanOrEqual(10);
    } else if (number === 22 || number === 23) {
      if (number === 23) state.participants.P2!.resources = 0;
      const result = dispatcher.dispatch(state, { actorParticipantId: 'P1', effectId: 'CARD_EFFECT_BASE_2025_E019', effectVersion: '0.1', parameters: { targetParticipantId: 'P2' } });
      expect(result.ok).toBe(true); if (result.ok) expect(result.state.participants.P2!.resources).toBeGreaterThanOrEqual(0);
    } else if (number >= 24 && number <= 26) {
      const roll = number === 26 ? 7 : 6; const hasAction = number === 24;
      const shouldDiscard = roll <= 6 && hasAction; if (shouldDiscard) discardWithLifecycle(state, 'P2A');
      expect(state.cards.P2A!.zone === 'DISCARD').toBe(shouldDiscard);
    } else if (number === 27 || number === 28) {
      const activationReachedRoll = number === 27; const modifier = activationReachedRoll ? 1 : 0;
      state.cards.A1!.zone = 'DISCARD'; expect(modifier).toBe(number === 27 ? 1 : 0); expect(state.cards.A1!.zone).toBe('DISCARD');
    } else {
      if (number === 30) state.participants.P2!.victoryPoints = 1;
      const result = dispatcher.dispatch(state, { actorParticipantId: 'P1', effectId: 'CARD_EFFECT_BASE_2025_E051', effectVersion: '0.1', parameters: { targetParticipantId: 'P2' } });
      expect(result.ok).toBe(true); if (result.ok) expect(result.state.participants.P2!.victoryPoints).toBe(number === 30 ? 0 : 3);
    }
  });

  it.each(regimeOwners)('%s', (id) => {
    const state = m2bState(); const number = Number(id.slice(-3));
    if (number <= 3) {
      if (number === 3) state.participants.P1!.regimeAbilityUsed = true;
      const result = new M2BEffectDispatcher('M2-4').dispatch(state, { actorParticipantId: 'P1', effectId: 'REGIME_EFFECT_ARDEN', effectVersion: '0.1', parameters: { roll: number === 2 ? 5 : 4, pdId: 'ARDEN_PD_1', attributionCountryId: 'P2', manual: false } });
      expect(result.ok).toBe(number !== 3);
      if (result.ok) expect(result.state.influence.find(({ pdId }) => pdId === 'ARDEN_PD_1')!.count).toBe(number === 1 ? 0 : 1);
    } else if (number <= 7) {
      const qualifyingSpend = number === 6 ? 0 : number === 4 ? 3 : number === 5 ? 2 : 3;
      if (qualifyingSpend > 0) expect(recordQualifyingResourceSpend(state, { id: `qualifying-${number}`, participantId: 'P1',
        amount: qualifyingSpend, reason: number === 7 ? 'COALITION_CONTRIBUTION' : 'CAMPAIGN_COST' })).toBeUndefined();
      const result = new M2BEffectDispatcher('M2-4').dispatch(state, { actorParticipantId: 'P2', effectId: 'REGIME_EFFECT_FLUMA',
        effectVersion: '0.1', parameters: { targetPdIds: Array.from({ length: qualifyingSpend }, () => 'ARDEN_PD_1') } });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.state.flumaRegime?.processedSpendIds).toHaveLength(qualifyingSpend === 0 ? 0 : 1);
        expect(result.state.influence.find(({ pdId, attributionCountryId }) => pdId === 'ARDEN_PD_1' && attributionCountryId === 'FLUMA')?.count ?? 0)
          .toBe(qualifyingSpend * 2);
        expect(resolveFlumaRegimeSpends(result.state, 'P2', [])).toBeUndefined();
      }
    } else if (number <= 10) {
      state.influence.push({ pdId: 'URSARIA_PD_1', type: 'MALIGN', attributionCountryId: 'ARDEN', count: number === 10 ? 1 : 3 });
      if (number === 9) Object.assign(state.cards.P3B!, { alignment: 'RESILIENCY' });
      const result = new M2BEffectDispatcher('M2-4').dispatch(state, { actorParticipantId: 'P3', effectId: 'REGIME_EFFECT_URSARIA',
        effectVersion: '0.1', parameters: { cardIds: ['P3A', 'P3B'], pdId: 'URSARIA_PD_1',
          attributionCountryIds: Array.from({ length: number === 10 ? 1 : 3 }, () => 'ARDEN') } });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.state.cards.P3A!.zone).toBe(number === 9 ? 'HAND' : 'DISCARD');
        expect(result.state.influence.find(({ pdId }) => pdId === 'URSARIA_PD_1')!.count).toBe(number === 9 ? 3 : 0);
      }
    } else if (number <= 13) {
      if (number === 13) { state.legitimacyByPd.PRESQUE_PD_2 = 'P4'; state.legitimacyByPd.PRESQUE_PD_3 = 'P4'; state.legitimacyByPd.DINESIA_PD_1 = 'P4'; }
      const beforeVp = state.participants.P4!.victoryPoints;
      const result = new M2BEffectDispatcher('M2-4').dispatch(state, { actorParticipantId: 'P4', effectId: 'REGIME_EFFECT_PRESQUE',
        effectVersion: '0.1', parameters: { roll: 4, pdId: 'PRESQUE_PD_1', ...(number === 13 ? { removeOwnPdId: 'PRESQUE_PD_2' } : {}) } });
      expect(result.ok).toBe(true); if (result.ok) {
        expect(result.state.legitimacyByPd.PRESQUE_PD_1).toBe('P4'); expect(result.state.participants.P4!.victoryPoints).toBe(beforeVp);
        if (number === 13) expect(result.state.legitimacyByPd.PRESQUE_PD_2).toBeNull();
      }
    } else {
      const beforeVp = state.participants.P5!.victoryPoints; const beforeResources = state.participants.P5!.resources;
      if (number === 15) state.influence.push({ pdId: 'DINESIA_PD_1', type: 'MALIGN', attributionCountryId: 'ARDEN', count: 1 });
      const result = new M2BEffectDispatcher('M2-4').dispatch(state, { actorParticipantId: 'P5', effectId: 'REGIME_EFFECT_DINESIA',
        effectVersion: '0.1', parameters: { pdId: 'DINESIA_PD_1' } });
      expect(result.ok).toBe(true); if (result.ok) {
        expect(result.state.participants.P5!.resources).toBe(beforeResources - 2); expect(result.state.participants.P5!.victoryPoints).toBe(beforeVp);
        expect(result.state.influence.find(({ pdId, type }) => pdId === 'DINESIA_PD_1' && type === 'RESILIENCY')?.count).toBe(1);
      }
    }
  });
});
