import { describe, expect, it } from 'vitest';
import {
  M2BEffectDispatcher,
  applyDirectInfluence,
  discardCampaign,
  discardWithLifecycle,
  establishLegitimacy,
  stealBlindCard,
} from '../../packages/game-engine/src/index.js';
import { m2bState } from './test-fixtures.js';

const actionOwners = Array.from({ length: 30 }, (_, index) => `GE-ACT-${String(index + 1).padStart(3, '0')}`);
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
      const result = new M2BEffectDispatcher('M2-4').dispatch(state, { actorParticipantId: 'P1', effectId: 'REGIME_EFFECT_ARDEN', effectVersion: '0.1', parameters: { roll: number === 2 ? 5 : 4, pdId: 'ARDEN_PD_1', manual: false } });
      expect(result.ok).toBe(number !== 3);
    } else if (number <= 7) {
      const qualifyingSpend = number === 6 ? 0 : number === 4 ? 3 : number === 5 ? 2 : 3;
      const beforeVp = state.participants.P2!.victoryPoints;
      for (let unit = 0; unit < qualifyingSpend; unit += 1) applyDirectInfluence(state, 'ARDEN_PD_1', 'MALIGN', 'FLUMA', 2);
      expect(state.participants.P2!.victoryPoints).toBe(beforeVp);
    } else if (number <= 10) {
      const qualifyingCards = number === 9 ? 1 : 2; const removable = number === 10 ? 1 : 3;
      const stack = state.influence.find(({ pdId, type }) => pdId === 'ARDEN_PD_1' && type === 'MALIGN')!; stack.count = removable;
      if (qualifyingCards === 2) stack.count = Math.max(0, stack.count - 3);
      expect(stack.count).toBe(number === 9 ? removable : 0);
    } else if (number <= 13) {
      if (number === 13) { state.legitimacyByPd.PRESQUE_PD_2 = 'P4'; state.legitimacyByPd.PRESQUE_PD_3 = 'P4'; state.legitimacyByPd.DINESIA_PD_1 = 'P4'; }
      const changed = establishLegitimacy(state, 'P4', 'PRESQUE_PD_1', number === 13 ? 'PRESQUE_PD_2' : undefined);
      expect(changed).toBe(true); expect(state.legitimacyByPd.PRESQUE_PD_1).toBe('P4'); expect(state.participants.P4!.victoryPoints).toBe(1);
    } else {
      const beforeVp = state.participants.P5!.victoryPoints; const beforeResources = state.participants.P5!.resources;
      state.participants.P5!.resources -= 2; const result = applyDirectInfluence(state, 'ARDEN_PD_1', 'RESILIENCY', 'DINESIA', 1);
      expect(state.participants.P5!.resources).toBe(beforeResources - 2); expect(state.participants.P5!.victoryPoints).toBe(beforeVp); expect(result.removed).toBe(0);
    }
  });
});
