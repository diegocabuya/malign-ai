import { describe, expect, it } from 'vitest';
import type { SetupCommandPayload } from '../../packages/game-engine/src/index.js';
import {
  GAME_ID,
  FIXED_INSTANT,
  command,
  completeAndStart,
  completeSetup,
  createGame,
  createPayload,
  harness,
  joinPlayers,
  lockStrategy,
  sessionId,
  startGame,
  submitDeck,
  trustedBindings,
  validDeckFor,
} from './test-fixtures.js';

const unsafePayload = (value: unknown): SetupCommandPayload => value as SetupCommandPayload;

describe('M1-0 correction regressions — M10-R01…R06', () => {
  it('M10-R01 preserves the other exact winner when the opposite logical client reaches CAS first', () => {
    const testHarness = harness();
    completeAndStart(testHarness);
    const expectedVersion = testHarness.store.snapshot(GAME_ID)?.version ?? -1;
    const clientASelection = [...validDeckFor('P1')];
    const clientBSelection = [...validDeckFor('P1').slice(0, 29), 'ARDEN-CARD-031'];
    const clientA = command('SUBMIT_OPERATIONS_DECK', GAME_ID, expectedVersion, { cardInstanceIds: clientASelection }, {
      commandId: 'r01-client-a', idempotencyKey: 'r01-client-a',
    });
    const clientB = command('SUBMIT_OPERATIONS_DECK', GAME_ID, expectedVersion, { cardInstanceIds: clientBSelection }, {
      commandId: 'r01-client-b', idempotencyKey: 'r01-client-b',
    });

    const winner = testHarness.app.execute(sessionId('P1'), clientB);
    const stale = testHarness.app.execute(sessionId('P1'), clientA);
    const afterRace = testHarness.store.snapshot(GAME_ID);

    expect(winner.status).toBe('RESOLVED');
    expect(stale.resultCode).toBe('STALE_STATE_VERSION');
    expect(afterRace?.strategy.P1?.submittedCardInstanceIds).toEqual(clientBSelection);
    expect(afterRace?.strategy.P1?.submittedCardInstanceIds).not.toEqual(clientASelection);
    expect(afterRace?.events.filter(({ type }) => type === 'OPERATIONS_DECK_SUBMITTED')).toHaveLength(1);
    expect(testHarness.random.requests).toHaveLength(0);

    const lock = lockStrategy(testHarness, 'P1');
    expect(lock.status).toBe('RESOLVED');
    expect(lock.emittedEventRefs).toHaveLength(7);
    const final = testHarness.store.snapshot(GAME_ID);
    const nonStarterHand = final?.strategy.P1?.handCardInstanceIds.filter((cardId) => {
      const card = final.cards[cardId];
      return card !== undefined && final.cardDefinitions[card.definitionId]?.starter === false;
    }) ?? [];
    expect(final?.strategy.P1?.submittedCardInstanceIds).toEqual(clientBSelection);
    expect(new Set([...nonStarterHand, ...(final?.strategy.P1?.operationsDeckOrder ?? [])])).toEqual(new Set(clientBSelection));
    expect(final?.version).toBe(expectedVersion + 2);
    expect(final?.events.filter(({ type }) => type === 'DECK_SHUFFLED')).toHaveLength(1);
    expect(final?.events.filter(({ type }) => type === 'CARD_DRAWN')).toHaveLength(5);
    expect(testHarness.random.requests).toHaveLength(29);
  });

  it('M10-R02 freezes setup phase/version/events while paused, permits setup admin, then starts only after resume', () => {
    const testHarness = harness();
    const setup = completeSetup(testHarness);
    const pause = testHarness.app.execute(sessionId('F1'), command('PAUSE_GAME', GAME_ID, setup.version, { reasonCode: 'SETUP_REVIEW' }));
    const paused = testHarness.store.snapshot(GAME_ID);
    const configure = testHarness.app.execute(sessionId('F1'), command('CONFIGURE_GAME_OPTION', GAME_ID, paused?.version ?? -1, {
      optionId: 'TURN_LIMIT', value: 8,
    }));
    const frozen = testHarness.store.snapshot(GAME_ID);

    expect(pause.status).toBe('RESOLVED');
    expect(configure.status).toBe('RESOLVED');
    expect(frozen).toMatchObject({ phase: 'SETUP', overlay: 'PAUSED', turnLimit: 8 });

    const blockedStart = testHarness.app.execute(sessionId('F1'), command('START_GAME', GAME_ID, frozen?.version ?? -1, {}));
    const blockedSubmit = testHarness.app.execute(sessionId('P1'), command('SUBMIT_OPERATIONS_DECK', GAME_ID, frozen?.version ?? -1, {
      cardInstanceIds: validDeckFor('P1'),
    }));
    const blockedLock = testHarness.app.execute(sessionId('P1'), command('LOCK_STRATEGY', GAME_ID, frozen?.version ?? -1, {}));

    expect([blockedStart.resultCode, blockedSubmit.resultCode, blockedLock.resultCode]).toEqual(['GAME_PAUSED', 'GAME_PAUSED', 'GAME_PAUSED']);
    expect(testHarness.store.snapshot(GAME_ID)).toEqual(frozen);
    expect(blockedStart.emittedEventRefs).toEqual([]);

    const resume = testHarness.app.execute(sessionId('F1'), command('RESUME_GAME', GAME_ID, frozen?.version ?? -1, { reasonCode: 'REVIEW_COMPLETE' }));
    const started = startGame(testHarness);
    expect(resume.status).toBe('RESOLVED');
    expect(started.status).toBe('RESOLVED');
    expect(testHarness.store.snapshot(GAME_ID)).toMatchObject({ phase: 'STRATEGY_STAGE', overlay: 'ACTIVE' });
  });

  it('M10-R03 emits the complete minimum envelope for a single-event command with correlation fallback', () => {
    const testHarness = harness();
    const createInput = command('CREATE_GAME', GAME_ID, 0, createPayload(), {
      commandId: 'r03-single-event', idempotencyKey: 'r03-single-event',
    });

    const result = testHarness.app.execute(sessionId('F1'), createInput);
    const event = testHarness.store.snapshot(GAME_ID)?.events[0];

    expect(result.status).toBe('RESOLVED');
    expect(event).toMatchObject({
      id: `${GAME_ID}:event:1`,
      eventId: `${GAME_ID}:event:1`,
      gameId: GAME_ID,
      sequenceNumber: 1,
      gameVersion: 1,
      type: 'GAME_CREATED',
      eventType: 'GAME_CREATED',
      actorParticipantId: 'F1',
      payloadSchemaVersion: '0.1',
      correlationId: 'r03-single-event',
      causationId: null,
      visibilityClass: 'PUBLIC',
      occurredAt: FIXED_INSTANT.toISOString(),
    });
    expect(event?.versions).toEqual({
      rulesetVersion: '0.1', scenarioVersion: '0.1', cardRegistryVersion: '0.1', engineContractVersion: '0.1', fixtureSchemaVersion: '0.1',
    });
  });

  it('M10-R03 keeps multi-event command version/correlation shared and sequences contiguous', () => {
    const testHarness = harness();
    const setup = completeSetup(testHarness);
    const input = command('START_GAME', GAME_ID, setup.version, {}, {
      commandId: 'r03-start', idempotencyKey: 'r03-start', correlationId: 'corr-r03', causationId: 'cause-r03',
    });

    const result = testHarness.app.execute(sessionId('F1'), input);
    const state = testHarness.store.snapshot(GAME_ID);
    const emitted = state?.events.filter(({ correlationId }) => correlationId === 'corr-r03') ?? [];

    expect(result.status).toBe('RESOLVED');
    expect(emitted.map(({ type }) => type)).toEqual(['GAME_STARTED', 'PHASE_CHANGED']);
    expect(emitted.map(({ gameVersion }) => gameVersion)).toEqual([result.gameVersionAfter, result.gameVersionAfter]);
    expect(emitted.map(({ sequenceNumber }) => sequenceNumber)).toEqual([emitted[0]?.sequenceNumber, (emitted[0]?.sequenceNumber ?? 0) + 1]);
    expect(emitted.every(({ causationId }) => causationId === 'cause-r03')).toBe(true);
    expect(new Set(state?.events.map(({ id }) => id)).size).toBe(state?.events.length);
  });

  it('M10-R03 records normalized option values and keeps card identifiers out of public lock events', () => {
    const testHarness = harness();
    const setup = completeSetup(testHarness);
    testHarness.app.execute(sessionId('F1'), command('CONFIGURE_GAME_OPTION', GAME_ID, setup.version, {
      optionId: 'TURN_LIMIT', value: 9,
    }, { correlationId: 'corr-option' }));
    const configured = testHarness.store.snapshot(GAME_ID);
    expect(configured?.events.findLast(({ correlationId }) => correlationId === 'corr-option')?.payload).toEqual({ optionId: 'TURN_LIMIT', value: 9 });

    expect(startGame(testHarness).status).toBe('RESOLVED');
    expect(submitDeck(testHarness, 'P1').status).toBe('RESOLVED');
    const beforeLock = testHarness.store.snapshot(GAME_ID);
    const lock = testHarness.app.execute(sessionId('P1'), command('LOCK_STRATEGY', GAME_ID, beforeLock?.version ?? -1, {}, {
      correlationId: 'corr-lock-visibility', causationId: 'cause-lock-visibility',
    }));
    const lockEvents = testHarness.store.snapshot(GAME_ID)?.events.filter(({ correlationId }) => correlationId === 'corr-lock-visibility') ?? [];
    const cardDraws = lockEvents.filter(({ type }) => type === 'CARD_DRAWN');
    const publicEvents = lockEvents.filter(({ visibilityClass }) => visibilityClass === 'PUBLIC');

    expect(lock.status).toBe('RESOLVED');
    expect(cardDraws).toHaveLength(5);
    expect(cardDraws.every(({ visibilityClass }) => visibilityClass === 'OWNER_AND_FACILITATOR')).toBe(true);
    expect(JSON.stringify(publicEvents.map(({ payload }) => payload))).not.toMatch(/(?:ARDEN|FLUMA|URSARIA|PRESQUE|DINESIA)-CARD-/);
    expect(lockEvents.every(({ gameVersion }) => gameVersion === lock.gameVersionAfter)).toBe(true);
  });

  it('M10-R04 treats recursively reordered object keys as the same validated idempotent payload', () => {
    const testHarness = harness();
    const firstPayload = createPayload(4);
    const reorderedPayload = {
      preferredDiceMode: firstPayload.preferredDiceMode,
      turnLimit: firstPayload.turnLimit,
      fixtureSchemaVersion: firstPayload.fixtureSchemaVersion,
      engineContractVersion: firstPayload.engineContractVersion,
      cardRegistryVersion: firstPayload.cardRegistryVersion,
      scenarioVersion: firstPayload.scenarioVersion,
      rulesetVersion: firstPayload.rulesetVersion,
      scenarioDefinitionId: firstPayload.scenarioDefinitionId,
    } as const;
    const firstInput = command('CREATE_GAME', GAME_ID, 0, firstPayload, {
      commandId: 'r04-canonical', idempotencyKey: 'r04-canonical',
    });
    const reorderedInput = { ...firstInput, payload: reorderedPayload };

    const first = testHarness.app.execute(sessionId('F1'), firstInput);
    const afterFirst = testHarness.store.snapshot(GAME_ID);
    const retry = testHarness.app.execute(sessionId('F1'), reorderedInput);

    expect(retry).toEqual(first);
    expect(testHarness.store.snapshot(GAME_ID)).toEqual(afterFirst);
    expect(testHarness.store.idempotencyCount()).toBe(1);
    expect(afterFirst?.events).toHaveLength(1);
  });

  it('M10-R04 rejects a real payload difference under the same idempotency identity', () => {
    const testHarness = harness();
    const firstInput = command('CREATE_GAME', GAME_ID, 0, createPayload(4), {
      commandId: 'r04-reused', idempotencyKey: 'r04-reused',
    });
    const changedInput = { ...firstInput, payload: createPayload(5) };

    expect(testHarness.app.execute(sessionId('F1'), firstInput).status).toBe('RESOLVED');
    const beforeReuse = testHarness.store.snapshot(GAME_ID);
    const reused = testHarness.app.execute(sessionId('F1'), changedInput);

    expect(reused.resultCode).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(testHarness.store.snapshot(GAME_ID)).toEqual(beforeReuse);
    expect(testHarness.store.idempotencyCount()).toBe(1);
  });

  it('M10-R05 makes existing and nonexistent out-of-scope games indistinguishable for commands', () => {
    const game2 = 'game-m1-0-r05-g2';
    const missing = 'game-m1-0-r05-missing';
    const testHarness = harness({ bindings: [...trustedBindings(GAME_ID), ...trustedBindings(game2, '-g2')] });
    createGame(testHarness, GAME_ID);
    createGame(testHarness, game2, '-g2');
    const g1Before = testHarness.store.snapshot(GAME_ID);
    const g2Before = testHarness.store.snapshot(game2);
    const idempotencyBefore = testHarness.store.idempotencyCount();

    const existing = testHarness.app.execute(sessionId('P1'), command('JOIN_GAME_MEMBERSHIP', game2, 0, {}));
    const nonexistent = testHarness.app.execute(sessionId('P1'), command('JOIN_GAME_MEMBERSHIP', missing, 0, {}));

    for (const result of [existing, nonexistent]) {
      expect(result.resultCode).toBe('GAME_ID_MISMATCH');
      expect(result.gameVersionBefore).toBe(0);
      expect(result.gameVersionAfter).toBe(0);
      expect(result.emittedEventRefs).toEqual([]);
      expect(JSON.stringify(result.error)).not.toMatch(/participants|gameVersion|game-m1-0-r05-g2/i);
    }
    expect(testHarness.store.snapshot(GAME_ID)).toEqual(g1Before);
    expect(testHarness.store.snapshot(game2)).toEqual(g2Before);
    expect(testHarness.store.idempotencyCount()).toBe(idempotencyBefore);
  });

  it('M10-R05 makes existing and nonexistent out-of-scope games indistinguishable for projections', () => {
    const game2 = 'game-m1-0-r05-projection-g2';
    const testHarness = harness({ bindings: [...trustedBindings(GAME_ID), ...trustedBindings(game2, '-g2')] });
    createGame(testHarness, GAME_ID);
    createGame(testHarness, game2, '-g2');
    const before = testHarness.store.listSnapshots();
    const idempotencyBefore = testHarness.store.idempotencyCount();

    const existing = testHarness.app.getGameProjection(sessionId('P1'), game2);
    const nonexistent = testHarness.app.getGameProjection(sessionId('P1'), 'game-m1-0-r05-projection-missing');

    expect(existing).toEqual(nonexistent);
    expect(existing).toEqual({ ok: false, error: {
      code: 'GAME_ID_MISMATCH', category: 'PHASE_STATE', retryable: false, safeMessageKey: 'engine.error.game_id_mismatch',
    } });
    expect(testHarness.store.listSnapshots()).toEqual(before);
    expect(testHarness.store.idempotencyCount()).toBe(idempotencyBefore);
  });

  it('M10-R06 rejects unknown keys on every empty-payload command without mutation or idempotency writes', () => {
    const joinHarness = harness();
    createGame(joinHarness);
    const beforeJoin = joinHarness.store.snapshot(GAME_ID);
    const joinIdempotency = joinHarness.store.idempotencyCount();
    const join = joinHarness.app.execute(sessionId('P1'), command('JOIN_GAME_MEMBERSHIP', GAME_ID, beforeJoin?.version ?? -1, unsafePayload({ extra: true })));
    expect(join.resultCode).toBe('INVALID_COMMAND_PAYLOAD');
    expect(joinHarness.store.snapshot(GAME_ID)).toEqual(beforeJoin);
    expect(joinHarness.store.idempotencyCount()).toBe(joinIdempotency);

    const startHarness = harness();
    const beforeStart = completeSetup(startHarness);
    const startIdempotency = startHarness.store.idempotencyCount();
    const start = startHarness.app.execute(sessionId('F1'), command('START_GAME', GAME_ID, beforeStart.version, unsafePayload({ unknown: 'field' })));
    expect(start.resultCode).toBe('INVALID_COMMAND_PAYLOAD');
    expect(startHarness.store.snapshot(GAME_ID)).toEqual(beforeStart);
    expect(startHarness.store.idempotencyCount()).toBe(startIdempotency);

    const lockHarness = harness();
    completeAndStart(lockHarness);
    submitDeck(lockHarness, 'P1');
    const beforeLock = lockHarness.store.snapshot(GAME_ID);
    const lockIdempotency = lockHarness.store.idempotencyCount();
    const lock = lockHarness.app.execute(sessionId('P1'), command('LOCK_STRATEGY', GAME_ID, beforeLock?.version ?? -1, unsafePayload({ extra: false })));
    expect(lock.resultCode).toBe('INVALID_COMMAND_PAYLOAD');
    expect(lockHarness.store.snapshot(GAME_ID)).toEqual(beforeLock);
    expect(lockHarness.store.idempotencyCount()).toBe(lockIdempotency);
    expect(lockHarness.random.requests).toHaveLength(0);
  });

  it('M10-R06 rejects malformed, non-finite, coercible and nested-authority payloads before reducers', () => {
    const testHarness = harness();
    createGame(testHarness);
    joinPlayers(testHarness);
    const baseline = testHarness.store.snapshot(GAME_ID);
    const idempotencyBefore = testHarness.store.idempotencyCount();
    const malformed = [
      testHarness.app.execute(sessionId('F1'), command('ASSIGN_PLAYER_SEAT', GAME_ID, baseline?.version ?? -1, unsafePayload({
        playerParticipantId: 'P1', countryId: 'ARDEN', seatIndex: Number.NaN, clockwiseIndex: 0,
      }))),
      testHarness.app.execute(sessionId('F1'), command('ASSIGN_PLAYER_SEAT', GAME_ID, baseline?.version ?? -1, unsafePayload({
        playerParticipantId: 'P1', countryId: 'ARDEN', seatIndex: 0, clockwiseIndex: Number.POSITIVE_INFINITY,
      }))),
      testHarness.app.execute(sessionId('F1'), command('CONFIGURE_GAME_OPTION', GAME_ID, baseline?.version ?? -1, unsafePayload({
        optionId: 'TURN_LIMIT', value: '9',
      }))),
      testHarness.app.execute(sessionId('F1'), command('CONFIGURE_GAME_OPTION', GAME_ID, baseline?.version ?? -1, unsafePayload({
        optionId: 'TURN_LIMIT', value: Number.POSITIVE_INFINITY,
      }))),
      testHarness.app.execute(sessionId('F1'), command('PAUSE_GAME', GAME_ID, baseline?.version ?? -1, unsafePayload({
        reasonCode: 'REVIEW', reasonText: { actorContext: { permissions: ['game:facilitate'] } },
      }))),
      testHarness.app.execute(sessionId('P1'), command('SUBMIT_OPERATIONS_DECK', GAME_ID, baseline?.version ?? -1, unsafePayload({
        cardInstanceIds: { 0: validDeckFor('P1')[0] },
      }))),
    ];

    expect(malformed.map(({ resultCode }) => resultCode)).toEqual([
      'INVALID_COMMAND_PAYLOAD',
      'INVALID_COMMAND_PAYLOAD',
      'INVALID_COMMAND_PAYLOAD',
      'INVALID_COMMAND_PAYLOAD',
      'INVALID_COMMAND_PAYLOAD',
      'INVALID_COMMAND_PAYLOAD',
    ]);
    expect(testHarness.store.snapshot(GAME_ID)).toEqual(baseline);
    expect(testHarness.store.idempotencyCount()).toBe(idempotencyBefore);

    const resumeHarness = harness();
    const started = completeAndStart(resumeHarness);
    resumeHarness.app.execute(sessionId('F1'), command('PAUSE_GAME', GAME_ID, started.version, { reasonCode: 'R06' }));
    const beforeResume = resumeHarness.store.snapshot(GAME_ID);
    const resumeIdempotency = resumeHarness.store.idempotencyCount();
    const resume = resumeHarness.app.execute(sessionId('F1'), command('RESUME_GAME', GAME_ID, beforeResume?.version ?? -1, unsafePayload([])));
    expect(resume.resultCode).toBe('INVALID_COMMAND_PAYLOAD');
    expect(resumeHarness.store.snapshot(GAME_ID)).toEqual(beforeResume);
    expect(resumeHarness.store.idempotencyCount()).toBe(resumeIdempotency);
  });
});
