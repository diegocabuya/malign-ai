import { describe, expect, it } from 'vitest';
import type { SetupGameState } from '../../packages/domain/src/index.js';
import { command, completeAndStart, harness, lockStrategy, sessionId } from '../m1-0/test-fixtures.js';
import { lockMaintenance, reachInitiative, requestInitiative, setMaintenance } from '../m1-1/test-fixtures.js';

const definitionCard = (state: SetupGameState, participantId: string, definitionId: string) => {
  const card = Object.values(state.cards).find((candidate) =>
    candidate.controllerParticipantId === participantId && candidate.definitionId === definitionId,
  );
  if (card === undefined) throw new Error(`Missing ${definitionId} fixture for ${participantId}`);
  return card;
};

const isolateStrategyCards = (state: SetupGameState, participantId: string, handIds: string[], deckIds: string[]) => {
  const strategy = state.strategy[participantId]!;
  strategy.handCardInstanceIds = [...handIds];
  strategy.operationsDeckOrder = [...deckIds];
  strategy.discardCardInstanceIds = [];
  handIds.forEach((id) => { state.cards[id]!.zone = 'HAND'; delete state.cards[id]!.zonePosition; });
  deckIds.forEach((id, index) => { state.cards[id]!.zone = 'OPERATIONS_DECK'; state.cards[id]!.zonePosition = index; });
};

describe('M2 integrated Protocolos de Seguridad draw gate', () => {
  it('GE-SET-009 — the exact initial five counts Filtraciones and discards both cards in event order', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness);
    const protocol = definitionCard(state, 'P1', 'BASE_CARD_094');
    const leaks = definitionCard(state, 'P1', 'BASE_CARD_026');
    const otherEligible = Object.values(state.cards).filter((card) => card.controllerParticipantId === 'P1'
      && state.cardDefinitions[card.definitionId]?.starter === false && card.id !== protocol.id && card.id !== leaks.id);
    const ordered = [protocol.id, leaks.id, ...otherEligible.slice(0, 28).map((card) => card.id)];
    expect(testHarness.app.execute(sessionId('P1'), command('SUBMIT_OPERATIONS_DECK', state.id, state.version, { cardInstanceIds: ordered })))
      .toMatchObject({ status: 'RESOLVED' });
    testHarness.random.enqueue(...Array.from({ length: 29 }, (_, index) => 29 - index));
    expect(lockStrategy(testHarness, 'P1')).toMatchObject({ status: 'RESOLVED' });
    const committed = testHarness.store.snapshot(state.id)!; const strategy = committed.strategy.P1!;
    expect(strategy.handCardInstanceIds).toHaveLength(8);
    expect(strategy.handCardInstanceIds).not.toContain(protocol.id); expect(strategy.handCardInstanceIds).not.toContain(leaks.id);
    expect(strategy.discardCardInstanceIds).toEqual([protocol.id, leaks.id]);
    const relevant = committed.events.filter((event) => event.correlationId === committed.events.at(-1)?.correlationId);
    expect(relevant.filter((event) => event.type === 'CARD_DRAWN')).toHaveLength(5);
    expect(relevant.map((event) => event.type)).toEqual([
      'DECK_SHUFFLED', 'CARD_DRAWN', 'CARD_DRAWN', 'CARD_MOVED', 'CARD_MOVED', 'CARD_DRAWN', 'CARD_DRAWN', 'CARD_DRAWN', 'PLAYER_READY_CHANGED',
    ]);
  });

  it('GE-INI-007 — maintenance fill continues after the intercepted draw until hand limit', () => {
    const testHarness = harness(); reachInitiative(testHarness); requestInitiative(testHarness, [10, 8, 6, 4, 2]);
    const state = testHarness.store.listSnapshots()[0]!;
    const protocol = definitionCard(state, 'P1', 'BASE_CARD_094'); const leaks = definitionCard(state, 'P1', 'BASE_CARD_026');
    const normals = Object.values(state.cards).filter((card) => card.controllerParticipantId === 'P1' && ![protocol.id, leaks.id].includes(card.id)).slice(0, 10);
    isolateStrategyCards(state, 'P1', [protocol.id, ...normals.slice(0, 8).map((card) => card.id)], [leaks.id, normals[8]!.id, normals[9]!.id]);
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(setMaintenance(testHarness, 'P1', [])).toMatchObject({ status: 'RESOLVED' });
    const eventCountBefore = state.events.length;
    expect(lockMaintenance(testHarness, 'P1')).toMatchObject({ status: 'RESOLVED' });
    const committed = testHarness.store.snapshot(state.id)!; const strategy = committed.strategy.P1!;
    expect(strategy.handCardInstanceIds).toHaveLength(10); expect(strategy.discardCardInstanceIds).toEqual([protocol.id, leaks.id]);
    expect(committed.events.slice(eventCountBefore).filter((event) => event.type === 'CARD_DRAWN')).toHaveLength(3);
  });

  it('GE-INI-008 — an exact-three effect consumes exactly three draws and never compensates', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
    const source = definitionCard(state, 'P1', 'BASE_CARD_080'); const protocol = definitionCard(state, 'P1', 'BASE_CARD_094');
    const leaks = definitionCard(state, 'P1', 'BASE_CARD_026');
    const normals = Object.values(state.cards).filter((card) => card.controllerParticipantId === 'P1' && ![source.id, protocol.id, leaks.id].includes(card.id)).slice(0, 3);
    isolateStrategyCards(state, 'P1', [source.id, protocol.id], [leaks.id, normals[0]!.id, normals[1]!.id, normals[2]!.id]);
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(testHarness.dispatcher.executeM2Effect({ gameId: state.id, expectedGameVersion: state.version,
      commandId: 'GE-INI-008-command', idempotencyKey: 'GE-INI-008-key', actorParticipantId: 'P1', sourceCardInstanceId: source.id,
      effectId: 'CARD_EFFECT_BASE_2025_E045', effectVersion: '0.1', parameters: {},
    })).toMatchObject({ status: 'RESOLVED', resultPayload: { drawnCount: 3 } });
    const committed = testHarness.store.snapshot(state.id)!; const strategy = committed.strategy.P1!;
    expect(strategy.operationsDeckOrder).toEqual([normals[2]!.id]);
    expect(strategy.handCardInstanceIds).toEqual([normals[0]!.id, normals[1]!.id]);
    expect(strategy.discardCardInstanceIds).toEqual([source.id, protocol.id, leaks.id]);
    expect(committed.events.filter((event) => event.correlationId === 'GE-INI-008-command' && event.type === 'CARD_DRAWN')).toHaveLength(3);
  });
});
