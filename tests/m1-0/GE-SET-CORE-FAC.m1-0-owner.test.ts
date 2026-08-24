import { describe, expect, it } from 'vitest';
import type { GameCountry, SetupGameState } from '../../packages/domain/src/index.js';
import {
  GAME_ID,
  command,
  completeAndStart,
  completeSetup,
  harness,
  lockStrategy,
  seedSubmittedDeck,
  sessionId,
  startGame,
  submitDeck,
  validDeckFor,
  verifiedFacilitatorActor,
} from './test-fixtures.js';

const directStart = (state: SetupGameState) => {
  const testHarness = harness({ states: [state] });
  const input = command('START_GAME', state.id, state.version, {});
  return {
    result: testHarness.dispatcher.dispatch({ ...input, actorContext: verifiedFacilitatorActor() }),
    store: testHarness.store,
  };
};

describe('M1-0 oracle owner cases — setup, concurrency and facilitator overlay', () => {
  it('GE-SET-001 accepts the exact BASE_2025 setup and enters Strategy with pinned versions', () => {
    const testHarness = harness();
    const before = completeSetup(testHarness);

    const result = startGame(testHarness);
    const after = testHarness.app.gameSnapshot(GAME_ID);

    expect(result.status).toBe('RESOLVED');
    expect(result.resultCode).toBe('GAME_STARTED');
    expect(result.gameVersionAfter).toBe(before.version + 1);
    expect(after?.phase).toBe('STRATEGY_STAGE');
    expect(after?.events.slice(-2).map(({ type }) => type)).toEqual(['GAME_STARTED', 'PHASE_CHANGED']);
    expect(after?.versions).toEqual({
      rulesetVersion: '0.1',
      scenarioVersion: '0.1',
      cardRegistryVersion: '0.1',
      engineContractVersion: '0.1',
      fixtureSchemaVersion: '0.1',
    });
    expect(Object.keys(after?.populationDemographics ?? {})).toHaveLength(14);
    expect(Object.keys(after?.cards ?? {})).toHaveLength(540);
  });

  it('GE-SET-002 rejects start when the facilitator relationship is missing without mutation or GAME_STARTED', () => {
    const source = harness();
    const invalid = structuredClone(completeSetup(source));
    delete invalid.facilitatorParticipantId;
    const before = structuredClone(invalid);

    const { result, store } = directStart(invalid);

    expect(result.status).toBe('REJECTED');
    expect(result.resultCode).toBe('SETUP_INVALID');
    expect(result.gameVersionAfter).toBe(before.version);
    expect(store.snapshot(GAME_ID)).toEqual(before);
    expect(before.events.some(({ type }) => type === 'GAME_STARTED')).toBe(false);
  });

  it('GE-SET-003 rejects either four or six active countries without starting', () => {
    const source = harness();
    const baseline = completeSetup(source);
    for (const countryCount of [4, 6]) {
      const invalid = structuredClone(baseline);
      const countries = invalid.countries as unknown as Record<string, GameCountry>;
      if (countryCount === 4) delete countries.DINESIA;
      else countries.EXTRA = { id: 'ARDEN', resources: 2, turnIncome: 2 };

      const { result, store } = directStart(invalid);

      expect(result.resultCode).toBe('SETUP_INVALID');
      expect(store.snapshot(GAME_ID)?.phase).toBe('SETUP');
      expect(store.snapshot(GAME_ID)?.events.some(({ type }) => type === 'GAME_STARTED')).toBe(false);
    }
  });

  it('GE-SET-004 rejects null or zero turn limit at start and requires an integer >= 1', () => {
    const source = harness();
    const baseline = completeSetup(source);
    for (const turnLimit of [null, 0]) {
      const invalid = structuredClone(baseline);
      (invalid as unknown as { turnLimit: number | null }).turnLimit = turnLimit;
      const { result, store } = directStart(invalid);
      expect(result.resultCode).toBe('SETUP_INVALID');
      expect(result.gameVersionAfter).toBe(baseline.version);
      expect(store.snapshot(GAME_ID)?.events.some(({ type }) => type === 'GAME_STARTED')).toBe(false);
    }
  });

  it('GE-SET-005 rejects 29 or 31 non-Starter instances atomically without shuffle or movement', () => {
    for (const size of [29, 31]) {
      const testHarness = harness();
      completeAndStart(testHarness);
      const selected = size === 29
        ? validDeckFor('P1').slice(0, 29)
        : [...validDeckFor('P1'), 'ARDEN-CARD-031'];
      seedSubmittedDeck(testHarness, 'P1', selected);
      const before = testHarness.app.gameSnapshot(GAME_ID);

      const result = lockStrategy(testHarness, 'P1');

      expect(result.resultCode).toBe('STRATEGY_DECK_SIZE_INVALID');
      expect(testHarness.app.gameSnapshot(GAME_ID)).toEqual(before);
      expect(testHarness.random.requests).toHaveLength(0);
    }
  });

  it('GE-SET-006 rejects a 30-card selection containing a Starter as CARD_NOT_ELIGIBLE', () => {
    const testHarness = harness();
    completeAndStart(testHarness);
    const selected = [...validDeckFor('P1').slice(0, 29), 'ARDEN-CARD-059'];
    seedSubmittedDeck(testHarness, 'P1', selected);
    const before = testHarness.app.gameSnapshot(GAME_ID);

    const result = lockStrategy(testHarness, 'P1');

    expect(result.resultCode).toBe('CARD_NOT_ELIGIBLE');
    expect(testHarness.app.gameSnapshot(GAME_ID)).toEqual(before);
    expect(testHarness.random.requests).toHaveLength(0);
  });

  it('GE-SET-007 shuffles 30 unique eligible cards deterministically and leaves the inactive pool intact', () => {
    const testHarness = harness();
    completeAndStart(testHarness);
    expect(submitDeck(testHarness, 'P1').status).toBe('RESOLVED');

    const result = lockStrategy(testHarness, 'P1');
    const state = testHarness.app.gameSnapshot(GAME_ID);
    const p1Cards = Object.values(state?.cards ?? {}).filter(({ countryOwnerId }) => countryOwnerId === 'ARDEN');

    expect(result.status).toBe('RESOLVED');
    expect(result.emittedEventRefs).toHaveLength(7);
    expect(testHarness.random.requests).toHaveLength(29);
    expect(state?.strategy.P1?.operationsDeckOrder).toEqual([
      ...validDeckFor('P1').slice(6),
      validDeckFor('P1')[0],
    ]);
    expect(p1Cards.filter(({ zone }) => zone === 'OPERATIONS_DECK')).toHaveLength(25);
    expect(p1Cards.filter(({ zone }) => zone === 'OPERATIONS_POOL')).toHaveLength(73);
    expect(state?.events.findLast(({ type }) => type === 'DECK_SHUFFLED')?.payload).toMatchObject({ count: 30 });
  });

  it('GE-SET-008 creates a ten-card initial hand with five Starters and five sequential draws', () => {
    const testHarness = harness();
    completeAndStart(testHarness);
    submitDeck(testHarness, 'P1');

    lockStrategy(testHarness, 'P1');
    const state = testHarness.app.gameSnapshot(GAME_ID);
    const strategy = state?.strategy.P1;
    const hand = strategy?.handCardInstanceIds.map((id) => state?.cards[id]).filter((card) => card !== undefined) ?? [];
    const drawnEvents = state?.events.filter(({ type, payload }) => type === 'CARD_DRAWN' && payload.participantId === 'P1') ?? [];

    expect(hand).toHaveLength(10);
    expect(hand.filter((card) => state?.cardDefinitions[card.definitionId]?.starter === true)).toHaveLength(5);
    expect(hand.filter((card) => state?.cardDefinitions[card.definitionId]?.starter === false)).toHaveLength(5);
    expect(drawnEvents).toHaveLength(5);
    expect(drawnEvents.map(({ payload }) => payload.cardInstanceId)).toEqual(validDeckFor('P1').slice(1, 6));
    expect(hand.every((card) => card.zone === 'HAND')).toBe(true);
  });

  it('GE-SET-010 rejects a repeated CardInstance ID and preserves global instance uniqueness', () => {
    const testHarness = harness();
    completeAndStart(testHarness);
    const selected = [...validDeckFor('P1')];
    selected[29] = selected[0] ?? '';
    seedSubmittedDeck(testHarness, 'P1', selected);
    const before = testHarness.app.gameSnapshot(GAME_ID);

    const result = lockStrategy(testHarness, 'P1');

    expect(result.resultCode).toBe('DUPLICATE_CARD_INSTANCE');
    expect(testHarness.app.gameSnapshot(GAME_ID)).toEqual(before);
    expect(new Set(Object.keys(before?.cards ?? {})).size).toBe(540);
  });

  it('GE-CORE-002 rejects a deck containing a card controlled by another participant', () => {
    const testHarness = harness();
    completeAndStart(testHarness);
    const selected = [...validDeckFor('P1').slice(0, 29), validDeckFor('P2')[0] ?? ''];
    const before = testHarness.app.gameSnapshot(GAME_ID);

    const result = testHarness.app.execute(sessionId('P1'), command('SUBMIT_OPERATIONS_DECK', GAME_ID, before?.version ?? -1, {
      cardInstanceIds: selected,
    }));

    expect(result.resultCode).toBe('CARD_NOT_CONTROLLED');
    expect(testHarness.app.gameSnapshot(GAME_ID)).toEqual(before);
  });

  it('GE-CORE-003 rejects an obsolete expected game version with zero domain events', () => {
    const testHarness = harness();
    const state = completeAndStart(testHarness);

    const result = testHarness.app.execute(sessionId('P1'), command('SUBMIT_OPERATIONS_DECK', GAME_ID, state.version - 1, {
      cardInstanceIds: validDeckFor('P1'),
    }));

    expect(result.resultCode).toBe('STALE_STATE_VERSION');
    expect(result.emittedEventRefs).toEqual([]);
    expect(testHarness.app.gameSnapshot(GAME_ID)).toEqual(state);
  });

  it('GE-CORE-004 returns the original result for an exact idempotent retry without duplicating events or version', () => {
    const testHarness = harness();
    const state = completeAndStart(testHarness);
    const input = command('SUBMIT_OPERATIONS_DECK', GAME_ID, state.version, { cardInstanceIds: validDeckFor('P1') }, {
      commandId: 'idempotent-submit',
      idempotencyKey: 'idempotent-submit-key',
    });

    const first = testHarness.app.execute(sessionId('P1'), input);
    const afterFirst = testHarness.app.gameSnapshot(GAME_ID);
    const retry = testHarness.app.execute(sessionId('P1'), input);

    expect(retry).toEqual(first);
    expect(testHarness.app.gameSnapshot(GAME_ID)).toEqual(afterFirst);
    expect(afterFirst?.events.filter(({ type }) => type === 'OPERATIONS_DECK_SUBMITTED')).toHaveLength(1);
  });

  it('GE-CORE-006 blocks player gameplay while PAUSED and still permits facilitator resume', () => {
    const testHarness = harness();
    const started = completeAndStart(testHarness);
    const paused = testHarness.app.execute(sessionId('F1'), command('PAUSE_GAME', GAME_ID, started.version, { reasonCode: 'TEST_PAUSE' }));
    const pausedState = testHarness.app.gameSnapshot(GAME_ID);

    const blocked = testHarness.app.execute(sessionId('P1'), command('SUBMIT_OPERATIONS_DECK', GAME_ID, pausedState?.version ?? -1, {
      cardInstanceIds: validDeckFor('P1'),
    }));
    const resumed = testHarness.app.execute(sessionId('F1'), command('RESUME_GAME', GAME_ID, pausedState?.version ?? -1, { reasonCode: 'TEST_RESUME' }));

    expect(paused.resultCode).toBe('GAME_PAUSED');
    expect(blocked.resultCode).toBe('GAME_PAUSED');
    expect(blocked.gameVersionAfter).toBe(pausedState?.version);
    expect(resumed.resultCode).toBe('GAME_RESUMED');
    expect(testHarness.app.gameSnapshot(GAME_ID)?.phase).toBe('STRATEGY_STAGE');
    expect(testHarness.app.gameSnapshot(GAME_ID)?.overlay).toBe('ACTIVE');
  });

  it('GE-CORE-010 allows only one of two strategy locks at the same expected version and never mixes state', () => {
    const testHarness = harness();
    completeAndStart(testHarness);
    submitDeck(testHarness, 'P1');
    submitDeck(testHarness, 'P2');
    const version = testHarness.app.gameSnapshot(GAME_ID)?.version ?? -1;
    const lockP1 = command('LOCK_STRATEGY', GAME_ID, version, {}, { commandId: 'lock-p1-client-a', idempotencyKey: 'lock-p1-a' });
    const lockP2 = command('LOCK_STRATEGY', GAME_ID, version, {}, { commandId: 'lock-p2-client-b', idempotencyKey: 'lock-p2-b' });

    const first = testHarness.app.execute(sessionId('P1'), lockP1);
    const second = testHarness.app.execute(sessionId('P2'), lockP2);
    const state = testHarness.app.gameSnapshot(GAME_ID);

    expect(first.status).toBe('RESOLVED');
    expect(second.resultCode).toBe('STALE_STATE_VERSION');
    expect(state?.strategy.P1?.locked).toBe(true);
    expect(state?.strategy.P2?.locked).toBe(false);
    expect(state?.strategy.P2?.submittedCardInstanceIds).toEqual(validDeckFor('P2'));
    expect(state?.version).toBe(version + 1);
  });

  it('GE-FAC-001 pauses and resumes while preserving the underlying phase and auditing both decisions', () => {
    const testHarness = harness();
    const started = completeAndStart(testHarness);

    const pause = testHarness.app.execute(sessionId('F1'), command('PAUSE_GAME', GAME_ID, started.version, { reasonCode: 'FACILITATOR_REVIEW' }));
    const paused = testHarness.app.gameSnapshot(GAME_ID);
    const resume = testHarness.app.execute(sessionId('F1'), command('RESUME_GAME', GAME_ID, paused?.version ?? -1, { reasonCode: 'FACILITATOR_CONTINUE' }));
    const resumed = testHarness.app.gameSnapshot(GAME_ID);

    expect(pause.status).toBe('RESOLVED');
    expect(paused?.phase).toBe('STRATEGY_STAGE');
    expect(paused?.overlay).toBe('PAUSED');
    expect(resume.status).toBe('RESOLVED');
    expect(resumed?.phase).toBe('STRATEGY_STAGE');
    expect(resumed?.overlay).toBe('ACTIVE');
    expect(resumed?.events.slice(-2).map(({ type }) => type)).toEqual(['GAME_PAUSED', 'GAME_RESUMED']);
  });
});
