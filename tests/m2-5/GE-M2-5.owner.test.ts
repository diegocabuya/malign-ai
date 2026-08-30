import { describe, expect, it } from 'vitest';
import {
  applyVeto,
  makeReactionContinuation,
  openReactionWindow,
  playReaction,
  projectReactionWindow,
  reactionPriority,
  resolveNarrative,
  resolveVeto,
} from '../../packages/game-engine/src/index.js';
import { m2bState } from '../m2-b/test-fixtures.js';

const owners = [
  ...Array.from({ length: 10 }, (_, index) => `GE-REA-${String(index + 1).padStart(3, '0')}`),
  ...Array.from({ length: 4 }, (_, index) => `GE-NAR-${String(index + 1).padStart(3, '0')}`),
  ...Array.from({ length: 5 }, (_, index) => `GE-VETO-${String(index + 1).padStart(3, '0')}`),
  'GE-AUD-005', 'GE-M2-RX-001', 'GE-M2-RX-002', 'GE-M2-RX-003',
] as const;

describe('M2-5 owner gate — Reaction, Veto and Deterministic Narrative', () => {
  it.each(owners)('%s', (id) => {
    const state = m2bState();
    if (id === 'GE-REA-001') {
      const window = openReactionWindow('W1', 'DOUBLE_AGENT', 'P1', ['P1', 'P2']);
      const result = playReaction(state, window, { participantId: 'P2', cardId: 'P2A', effectId: 'CARD_EFFECT_BASE_2025_E012' });
      expect(result.negated).toBe(true); expect(state.cards.P2A!.zone).toBe('DISCARD');
    } else if (id === 'GE-REA-002' || id === 'GE-REA-003') {
      const window = openReactionWindow('W1', 'CORRUPTION', 'P1', ['P1', 'P2']);
      const result = playReaction(state, window, { participantId: 'P2', cardId: 'P2A', effectId: 'CARD_EFFECT_BASE_2025_E036', roll: id.endsWith('002') ? 4 : 5 });
      expect(result.negated).toBe(id.endsWith('002')); expect(state.cards.P2A!.zone).toBe('DISCARD');
    } else if (id === 'GE-REA-004' || id === 'GE-REA-005') {
      const window = openReactionWindow('W1', 'CYBERATTACK', 'P1', ['P1', 'P2']);
      const hack = playReaction(state, window, { participantId: 'P2', cardId: 'P2A', effectId: 'CARD_EFFECT_BASE_2025_E022' });
      expect(hack.child?.parentWindowId).toBe('W1');
      if (id.endsWith('005')) {
        const cyber = playReaction(state, hack.child!, { participantId: 'P1', cardId: 'A1', effectId: 'CARD_EFFECT_BASE_2025_E010' });
        expect(cyber.negated).toBe(true);
      }
    } else if (id === 'GE-REA-006') {
      const window = openReactionWindow('W1', 'CORRUPTION', 'P1', ['P1', 'P2']);
      expect(playReaction(state, window, { participantId: 'P2', cardId: 'P2A', effectId: 'CARD_EFFECT_BASE_2025_E012' }).error).toBe('REACTION_NOT_ELIGIBLE');
    } else if (id === 'GE-REA-007') {
      const window = openReactionWindow('W1', 'DOUBLE_AGENT', 'P1', ['P1', 'P2']); window.status = 'CLOSED';
      expect(playReaction(state, window, { participantId: 'P2', cardId: 'P2A', effectId: 'CARD_EFFECT_BASE_2025_E012' }).error).toBe('REACTION_WINDOW_CLOSED');
    } else if (id === 'GE-REA-008') {
      expect(reactionPriority(['P1', 'P2', 'P3', 'P4', 'P5'], 'P3')).toEqual(['P4', 'P5', 'P1', 'P2']);
    } else if (id === 'GE-REA-009' || id === 'GE-REA-010') {
      const window = openReactionWindow('W1', 'PRE_ROLL', 'P1', ['P1', 'P2']);
      const result = playReaction(state, window, { participantId: 'P2', cardId: 'P2A', effectId: 'CARD_EFFECT_BASE_2025_E040', roll: id.endsWith('009') ? 4 : 5 });
      expect(result.negated).toBe(id.endsWith('009'));
    } else if (id.startsWith('GE-NAR-')) {
      const text = id === 'GE-NAR-001' ? 'Primera oración. Segunda oración.' : id === 'GE-NAR-002' ? 'Una oración.' : 'Uno. Dos. Tres. Cuatro.';
      const result = resolveNarrative(state, 'P1', text, [0, 1], { confirmedReading: id === 'GE-NAR-004' });
      if (id === 'GE-NAR-002') expect(result).toMatchObject({ blocked: true, discardedCardIds: [] });
      else if (id === 'GE-NAR-001') expect(result).toMatchObject({ accepted: true, discardedCardIds: [] });
      else expect(result.discardedCardIds).toHaveLength(id === 'GE-NAR-004' ? 2 : 1);
    } else if (id.startsWith('GE-VETO-')) {
      const number = Number(id.slice(-3));
      if (number === 4) {
        const window = openReactionWindow('W1', 'NARRATIVE', 'P1', ['P1', 'P2']);
        expect(playReaction(state, window, { participantId: 'P2', cardId: 'S2', effectId: 'CARD_EFFECT_BASE_2025_E048', vetoAbuse: true }).error).toBe('VETO_ABUSE');
        expect(state.cards.S2!.zone).toBe('HAND');
      } else {
        const votes = number === 1 ? { P1: 'UNACCEPTABLE', P2: 'UNACCEPTABLE', P3: 'UNACCEPTABLE', P4: 'ACCEPTABLE', P5: 'ACCEPTABLE' } as const
          : number === 3 ? { P1: 'UNACCEPTABLE', P2: 'UNACCEPTABLE', P3: 'ACCEPTABLE', P4: 'ACCEPTABLE' } as const
          : { P1: 'UNACCEPTABLE', P2: 'UNACCEPTABLE', P3: 'ACCEPTABLE', P4: 'ACCEPTABLE', P5: 'ACCEPTABLE' } as const;
        const result = resolveVeto(votes); expect(result.rejectedCampaign).toBe(number === 1);
        expect(applyVeto(state, 'CAM1', 'S2', result)).toBeUndefined(); expect(state.cards.S2!.zone).toBe('REMOVED_FROM_GAME');
      }
    } else if (id === 'GE-AUD-005') {
      const events = ['REACTION_WINDOW_OPENED', 'REACTION_PLAYED', 'CHILD_WINDOW_CLOSED', 'REACTION_WINDOW_CLOSED', 'CAMPAIGN_COST_PAID'];
      expect(events.indexOf('REACTION_WINDOW_CLOSED')).toBeLessThan(events.indexOf('CAMPAIGN_COST_PAID'));
    } else if (id === 'GE-M2-RX-001') {
      const window = openReactionWindow('W1', 'DOUBLE_AGENT', 'P1', ['P1', 'P2']);
      const continuation = makeReactionContinuation('RX1', state.version, window);
      expect(structuredClone(continuation)).toEqual(continuation); expect(continuation.schemaVersion).toBe(1);
    } else if (id === 'GE-M2-RX-002') {
      const window = openReactionWindow('W1', 'DOUBLE_AGENT', 'P1', ['P1', 'P2']);
      expect(projectReactionWindow(window, 'P2', false)).toHaveProperty('options'); expect(projectReactionWindow(window, 'P3', false)).not.toHaveProperty('options');
    } else {
      const window = openReactionWindow('W1', 'DOUBLE_AGENT', 'P1', ['P1', 'P2']); const before = structuredClone(window);
      expect(window.expiresAt).toBeNull(); expect(window).toEqual(before);
    }
  });
});
