import { describe, expect, it } from 'vitest';
import type { SetupGameState } from '../../packages/domain/src/index.js';
import { command, harness, sessionId } from '../m1-0/test-fixtures.js';
import { reachActionPlanning } from '../m1-1/test-fixtures.js';

const cardByDefinition = (state: SetupGameState, participantId: string, definitionId: string) => {
  const card = Object.values(state.cards).find((candidate) => candidate.controllerParticipantId === participantId && candidate.definitionId === definitionId);
  if (card === undefined) throw new Error(`Missing ${definitionId}`);
  return card;
};

const planningState = () => {
  const testHarness = harness(); const state = reachActionPlanning(testHarness);
  return { testHarness, state };
};

describe('M2 integrated Starter free-play gate', () => {
  it('GE-PLAN-006 — Increased Budget costs zero AP, grants four resources and emits its lifecycle', () => {
    const { testHarness, state } = planningState(); const starter = cardByDefinition(state, 'P1', 'BASE_CARD_075');
    state.strategy.P1!.handCardInstanceIds = [starter.id]; starter.zone = 'HAND'; const before = state.countries.ARDEN.resources;
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(testHarness.dispatcher.executeM2Effect({ gameId: state.id, expectedGameVersion: state.version,
      commandId: 'GE-PLAN-006-command', idempotencyKey: 'GE-PLAN-006-key', actorParticipantId: 'P1', sourceCardInstanceId: starter.id,
      effectId: 'CARD_EFFECT_BASE_2025_E042', effectVersion: '0.1', parameters: {},
    })).toMatchObject({ status: 'RESOLVED' });
    const committed = testHarness.store.snapshot(state.id)!;
    expect(committed.countries.ARDEN.resources).toBe(before + 4); expect(committed.cards[starter.id]!.zone).toBe('REMOVED_FROM_GAME');
    expect(committed.actionPlanning.P1!.apAvailable).toBe(3);
    expect(committed.events.filter(({ correlationId }) => correlationId === 'GE-PLAN-006-command').map(({ type }) => type))
      .toEqual(['STARTER_PLAYED', 'RESOURCE_GAINED', 'STARTER_REMOVED', 'M2_EFFECT_EXECUTED']);
  });

  it('GE-PLAN-007 — Priority Policy privately selects two cards, shuffles the remainder and removes itself', () => {
    const { testHarness, state } = planningState(); const starter = cardByDefinition(state, 'P1', 'BASE_CARD_093');
    const deck = Object.values(state.cards).filter((card) => card.controllerParticipantId === 'P1' && state.cardDefinitions[card.definitionId]?.starter === false).slice(0, 6);
    Object.values(state.cards).filter((card) => card.controllerParticipantId === 'P1').forEach((card) => { card.zone = 'OPERATIONS_POOL'; delete card.zonePosition; });
    state.strategy.P1!.handCardInstanceIds = [starter.id, ...Object.values(state.cards).filter((card) => card.controllerParticipantId === 'P1' && card.id !== starter.id).slice(0, 6).map(({ id }) => id)];
    state.strategy.P1!.operationsDeckOrder = deck.map(({ id }) => id); starter.zone = 'HAND'; deck.forEach((card, index) => { card.zone = 'OPERATIONS_DECK'; card.zonePosition = index; });
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(testHarness.dispatcher.executeM2Effect({ gameId: state.id, expectedGameVersion: state.version,
      commandId: 'GE-PLAN-007-open', idempotencyKey: 'GE-PLAN-007-open-key', actorParticipantId: 'P1', sourceCardInstanceId: starter.id,
      effectId: 'CARD_EFFECT_BASE_2025_E053', effectVersion: '0.1', parameters: {},
    })).toMatchObject({ status: 'RESOLVED', resultCode: 'M2_EFFECT_CHOICE_REQUESTED' });
    const opened = testHarness.store.snapshot(state.id)!;
    expect(testHarness.app.execute(sessionId('P1'), command('SUBMIT_M2_EFFECT_CHOICE', state.id, opened.version, {
      continuationId: opened.m2EffectChoice!.id, selections: { SELECT_FROM_DECK: [deck[1]!.id, deck[4]!.id] },
    }, { commandId: 'GE-PLAN-007-resolve', idempotencyKey: 'GE-PLAN-007-resolve-key' }))).toMatchObject({ status: 'RESOLVED' });
    const committed = testHarness.store.snapshot(state.id)!;
    expect(committed.strategy.P1!.handCardInstanceIds).toEqual(expect.arrayContaining([deck[1]!.id, deck[4]!.id]));
    expect(committed.strategy.P1!.handCardInstanceIds).toHaveLength(8); expect(committed.cards[starter.id]!.zone).toBe('REMOVED_FROM_GAME');
    expect(committed.strategy.P1!.operationsDeckOrder).toHaveLength(4);
  });

  it('GE-PLAN-008 — Priority Policy opens a private hand-limit choice and never stabilizes above ten', () => {
    const { testHarness, state } = planningState(); const starter = cardByDefinition(state, 'P1', 'BASE_CARD_093');
    const pool = Object.values(state.cards).filter((card) => card.controllerParticipantId === 'P1' && card.id !== starter.id);
    Object.values(state.cards).filter((card) => card.controllerParticipantId === 'P1').forEach((card) => { card.zone = 'OPERATIONS_POOL'; delete card.zonePosition; });
    const deck = pool.slice(10, 14); const initialHand = [starter.id, ...pool.slice(0, 9).map(({ id }) => id)];
    state.strategy.P1!.handCardInstanceIds = initialHand; state.strategy.P1!.operationsDeckOrder = deck.map(({ id }) => id);
    initialHand.forEach((id) => { state.cards[id]!.zone = 'HAND'; }); deck.forEach((card, index) => { card.zone = 'OPERATIONS_DECK'; card.zonePosition = index; });
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(testHarness.dispatcher.executeM2Effect({ gameId: state.id, expectedGameVersion: state.version,
      commandId: 'GE-PLAN-008-open', idempotencyKey: 'GE-PLAN-008-open-key', actorParticipantId: 'P1', sourceCardInstanceId: starter.id,
      effectId: 'CARD_EFFECT_BASE_2025_E053', effectVersion: '0.1', parameters: {},
    })).toMatchObject({ status: 'RESOLVED' });
    let current = testHarness.store.snapshot(state.id)!;
    expect(testHarness.app.execute(sessionId('P1'), command('SUBMIT_M2_EFFECT_CHOICE', state.id, current.version, {
      continuationId: current.m2EffectChoice!.id, selections: { SELECT_FROM_DECK: [deck[0]!.id, deck[1]!.id] },
    }))).toMatchObject({ status: 'RESOLVED', resultCode: 'M2_EFFECT_CHOICE_REQUESTED' });
    current = testHarness.store.snapshot(state.id)!; expect(current.strategy.P1!.handCardInstanceIds).toHaveLength(11);
    expect(current.m2EffectChoice).toMatchObject({ groups: [{ groupId: 'HAND_LIMIT_DISCARD', minSelections: 1, maxSelections: 1 }] });
    const discardId = current.strategy.P1!.handCardInstanceIds[0]!;
    expect(testHarness.app.execute(sessionId('P1'), command('SUBMIT_M2_EFFECT_CHOICE', state.id, current.version, {
      continuationId: current.m2EffectChoice!.id, selections: { HAND_LIMIT_DISCARD: [discardId] },
    }))).toMatchObject({ status: 'RESOLVED' });
    expect(testHarness.store.snapshot(state.id)!.strategy.P1!.handCardInstanceIds).toHaveLength(10);
  });

  it('GE-PLAN-009 — Policy Pivot applies complete lifecycle, shuffles the eligible pool and fills to ten', () => {
    const { testHarness, state } = planningState(); const pivot = cardByDefinition(state, 'P1', 'BASE_CARD_059');
    const ownStarter = cardByDefinition(state, 'P1', 'BASE_CARD_075'); const normal = Object.values(state.cards).find((card) => card.controllerParticipantId === 'P1' && state.cardDefinitions[card.definitionId]?.starter === false)!;
    const borrowed = Object.values(state.cards).find((card) => card.countryOwnerId === 'FLUMA' && state.cardDefinitions[card.definitionId]?.starter === false)!;
    borrowed.controllerParticipantId = 'P1'; borrowed.returnToOwnerOnDiscard = true;
    const deck = Object.values(state.cards).filter((card) => card.controllerParticipantId === 'P1' && ![pivot.id, ownStarter.id, normal.id, borrowed.id].includes(card.id) && state.cardDefinitions[card.definitionId]?.starter === false).slice(0, 12);
    Object.values(state.cards).filter((card) => card.controllerParticipantId === 'P1').forEach((card) => { card.zone = 'OPERATIONS_POOL'; delete card.zonePosition; });
    state.strategy.P1!.handCardInstanceIds = [pivot.id, normal.id, ownStarter.id, borrowed.id]; state.strategy.P1!.discardCardInstanceIds = []; state.strategy.P1!.operationsDeckOrder = deck.map(({ id }) => id);
    for (const id of state.strategy.P1!.handCardInstanceIds) state.cards[id]!.zone = 'HAND'; deck.forEach((card, index) => { card.zone = 'OPERATIONS_DECK'; card.zonePosition = index; });
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(testHarness.dispatcher.executeM2Effect({ gameId: state.id, expectedGameVersion: state.version,
      commandId: 'GE-PLAN-009-command', idempotencyKey: 'GE-PLAN-009-key', actorParticipantId: 'P1', sourceCardInstanceId: pivot.id,
      effectId: 'CARD_EFFECT_BASE_2025_E031', effectVersion: '0.1', parameters: {},
    })).toMatchObject({ status: 'RESOLVED' });
    const committed = testHarness.store.snapshot(state.id)!;
    expect(committed.cards[pivot.id]!.zone).toBe('REMOVED_FROM_GAME'); expect(committed.cards[ownStarter.id]!.zone).toBe('REMOVED_FROM_GAME');
    expect(committed.cards[borrowed.id]).toMatchObject({ controllerParticipantId: 'P2', zone: 'HAND', returnToOwnerOnDiscard: false });
    expect(committed.strategy.P2!.handCardInstanceIds).toContain(borrowed.id); expect(committed.strategy.P1!.handCardInstanceIds).toHaveLength(10);
    expect(committed.cards[normal.id]!.zone).not.toBe('REMOVED_FROM_GAME');
  });
});
