import { describe, expect, it } from 'vitest';
import type { SetupCommandPayload } from '../../packages/game-engine/src/index.js';
import {
  GAME_ID,
  command,
  completeAndStart,
  createGame,
  createPayload,
  harness,
  joinPlayers,
  lockStrategy,
  sessionId,
  submitDeck,
  trustedBindings,
  validDeckFor,
} from './test-fixtures.js';

describe('M1-0 addendum owner cases — verified GameSession boundary', () => {
  it('GE-M1-SES-001 creates SETUP from verified F1 with explicit versions, dice mode and turn limit', () => {
    const testHarness = harness();
    const input = command('CREATE_GAME', GAME_ID, 0, createPayload(7), {
      commandId: 'create-game-ses-001',
      idempotencyKey: 'create-game-ses-001',
    });

    const result = testHarness.app.execute(sessionId('F1'), input);
    const state = testHarness.app.gameSnapshot(GAME_ID);
    const session = testHarness.authority.sessionSnapshot(GAME_ID);

    expect(result.status).toBe('RESOLVED');
    expect(result.resultCode).toBe('GAME_CREATED');
    expect(result.gameVersionBefore).toBe(0);
    expect(result.gameVersionAfter).toBe(1);
    expect(state).toMatchObject({ phase: 'SETUP', overlay: 'ACTIVE', turnLimit: 7, diceMode: 'DIGITAL' });
    expect(state?.participants).toEqual({
      F1: { id: 'F1', gameId: GAME_ID, userId: 'user-f1', role: 'FACILITATOR', status: 'ACTIVE' },
    });
    expect(state?.events.map(({ type }) => type)).toEqual(['GAME_CREATED']);
    expect(session?.memberships.F1).toMatchObject({ participantId: 'F1', authenticatedSessionId: 'session-f1', connected: true });
  });

  it('GE-M1-SES-002 rejects PLAYER create and seat assignment with zero state, event or version mutation', () => {
    const testHarness = harness();

    const playerCreate = testHarness.app.execute(sessionId('P1'), command('CREATE_GAME', GAME_ID, 0, createPayload()));
    expect(playerCreate.resultCode).toBe('NOT_AUTHORIZED');
    expect(testHarness.app.gameSnapshot(GAME_ID)).toBeUndefined();

    createGame(testHarness);
    joinPlayers(testHarness);
    const before = testHarness.app.gameSnapshot(GAME_ID);
    const playerSeat = testHarness.app.execute(sessionId('P1'), command('ASSIGN_PLAYER_SEAT', GAME_ID, before?.version ?? -1, {
      playerParticipantId: 'P1', countryId: 'ARDEN', seatIndex: 0, clockwiseIndex: 0,
    }));

    expect(playerSeat.resultCode).toBe('NOT_AUTHORIZED');
    expect(testHarness.app.gameSnapshot(GAME_ID)).toEqual(before);
  });

  it('GE-M1-SES-003 materializes authenticated P1 membership and an active GameParticipant without payload authority', () => {
    const testHarness = harness();
    createGame(testHarness);
    const before = testHarness.app.gameSnapshot(GAME_ID);

    const result = testHarness.app.execute(sessionId('P1'), command('JOIN_GAME_MEMBERSHIP', GAME_ID, before?.version ?? -1, {}));
    const state = testHarness.app.gameSnapshot(GAME_ID);
    const membership = testHarness.authority.sessionSnapshot(GAME_ID)?.memberships.P1;
    const p1Projection = testHarness.app.getGameProjection(sessionId('P1'), GAME_ID);
    const f1Projection = testHarness.app.getGameProjection(sessionId('F1'), GAME_ID);

    expect(result.resultCode).toBe('PARTICIPANT_JOINED');
    expect(state?.participants.P1).toEqual({ id: 'P1', gameId: GAME_ID, userId: 'user-p1', role: 'PLAYER', status: 'ACTIVE' });
    expect(membership).toMatchObject({ participantId: 'P1', authenticatedSessionId: 'session-p1', connected: true });
    expect(p1Projection.ok && p1Projection.projection.viewer).toEqual({ participantId: 'P1', role: 'PLAYER' });
    expect(f1Projection.ok && f1Projection.projection.participants.map(({ participantId }) => participantId)).toEqual(['F1', 'P1']);
  });

  it('GE-M1-SES-004 rejects free-form actor/participant spoofing at the application boundary', () => {
    const testHarness = harness();
    completeAndStart(testHarness);
    const before = testHarness.app.gameSnapshot(GAME_ID);
    const spoofedPayload = {
      cardInstanceIds: validDeckFor('P1'),
      actorId: 'user-p2',
      participantId: 'P2',
      permissions: ['game:facilitate'],
    } as unknown as SetupCommandPayload;

    const result = testHarness.app.execute(sessionId('P1'), command('SUBMIT_OPERATIONS_DECK', GAME_ID, before?.version ?? -1, spoofedPayload));

    expect(result.resultCode).toBe('INVALID_ACTOR_CONTEXT');
    expect(result.error).toEqual({
      code: 'INVALID_ACTOR_CONTEXT',
      category: 'AUTHORIZATION',
      retryable: false,
      safeMessageKey: 'engine.error.invalid_actor_context',
    });
    expect(testHarness.app.gameSnapshot(GAME_ID)).toEqual(before);
  });

  it('GE-M1-SES-005 rejects a second seat for P1 atomically', () => {
    const testHarness = harness();
    createGame(testHarness);
    joinPlayers(testHarness);
    const initial = testHarness.app.gameSnapshot(GAME_ID);
    const first = testHarness.app.execute(sessionId('F1'), command('ASSIGN_PLAYER_SEAT', GAME_ID, initial?.version ?? -1, {
      playerParticipantId: 'P1', countryId: 'ARDEN', seatIndex: 0, clockwiseIndex: 0,
    }));
    const beforeSecond = testHarness.app.gameSnapshot(GAME_ID);

    const second = testHarness.app.execute(sessionId('F1'), command('ASSIGN_PLAYER_SEAT', GAME_ID, beforeSecond?.version ?? -1, {
      playerParticipantId: 'P1', countryId: 'FLUMA', seatIndex: 1, clockwiseIndex: 1,
    }));

    expect(first.status).toBe('RESOLVED');
    expect(second.resultCode).toBe('PARTICIPANT_ALREADY_SEATED');
    expect(testHarness.app.gameSnapshot(GAME_ID)).toEqual(beforeSecond);
  });

  it('GE-M1-SES-006 rejects assigning ARDEN to a second participant and preserves country ownership', () => {
    const testHarness = harness();
    createGame(testHarness);
    joinPlayers(testHarness);
    let state = testHarness.app.gameSnapshot(GAME_ID);
    testHarness.app.execute(sessionId('F1'), command('ASSIGN_PLAYER_SEAT', GAME_ID, state?.version ?? -1, {
      playerParticipantId: 'P1', countryId: 'ARDEN', seatIndex: 0, clockwiseIndex: 0,
    }));
    state = testHarness.app.gameSnapshot(GAME_ID);

    const result = testHarness.app.execute(sessionId('F1'), command('ASSIGN_PLAYER_SEAT', GAME_ID, state?.version ?? -1, {
      playerParticipantId: 'P2', countryId: 'ARDEN', seatIndex: 1, clockwiseIndex: 1,
    }));

    expect(result.resultCode).toBe('COUNTRY_ALREADY_ASSIGNED');
    expect(testHarness.app.gameSnapshot(GAME_ID)).toEqual(state);
    expect(state?.countries.ARDEN.controllerParticipantId).toBe('P1');
  });

  it('GE-M1-SES-007 rejects duplicate seat_index and clockwise_index without altering existing seats', () => {
    const testHarness = harness();
    createGame(testHarness);
    joinPlayers(testHarness);
    let state = testHarness.app.gameSnapshot(GAME_ID);
    testHarness.app.execute(sessionId('F1'), command('ASSIGN_PLAYER_SEAT', GAME_ID, state?.version ?? -1, {
      playerParticipantId: 'P1', countryId: 'ARDEN', seatIndex: 0, clockwiseIndex: 0,
    }));
    state = testHarness.app.gameSnapshot(GAME_ID);

    const duplicateSeat = testHarness.app.execute(sessionId('F1'), command('ASSIGN_PLAYER_SEAT', GAME_ID, state?.version ?? -1, {
      playerParticipantId: 'P2', countryId: 'FLUMA', seatIndex: 0, clockwiseIndex: 1,
    }));
    const duplicateClockwise = testHarness.app.execute(sessionId('F1'), command('ASSIGN_PLAYER_SEAT', GAME_ID, state?.version ?? -1, {
      playerParticipantId: 'P2', countryId: 'FLUMA', seatIndex: 1, clockwiseIndex: 0,
    }));

    expect(duplicateSeat.resultCode).toBe('SEAT_INDEX_ALREADY_ASSIGNED');
    expect(duplicateClockwise.resultCode).toBe('CLOCKWISE_INDEX_ALREADY_ASSIGNED');
    expect(testHarness.app.gameSnapshot(GAME_ID)).toEqual(state);
  });

  it('GE-M1-SES-008 rejects a G1 member using a G2 envelope and leaves both games unchanged', () => {
    const game2 = 'game-m1-0-g2';
    const bindings = [...trustedBindings(GAME_ID), ...trustedBindings(game2, '-g2')];
    const testHarness = harness({ bindings });
    createGame(testHarness, GAME_ID);
    createGame(testHarness, game2, '-g2');
    const g1Before = testHarness.app.gameSnapshot(GAME_ID);
    const g2Before = testHarness.app.gameSnapshot(game2);

    const result = testHarness.app.execute(sessionId('P1'), command('JOIN_GAME_MEMBERSHIP', game2, g2Before?.version ?? -1, {}));

    expect(result.resultCode).toBe('GAME_ID_MISMATCH');
    expect(result.error?.safeMessageKey).toBe('engine.error.game_id_mismatch');
    expect(testHarness.app.gameSnapshot(GAME_ID)).toEqual(g1Before);
    expect(testHarness.app.gameSnapshot(game2)).toEqual(g2Before);
  });

  it('GE-M1-SES-009 serves authorized minimal projections without mutating state, events, version or idempotency', () => {
    const testHarness = harness();
    completeAndStart(testHarness);
    submitDeck(testHarness, 'P1');
    lockStrategy(testHarness, 'P1');
    const before = testHarness.app.gameSnapshot(GAME_ID);
    const idempotencyBefore = testHarness.store.idempotencyCount();

    const owner = testHarness.app.getGameProjection(sessionId('P1'), GAME_ID);
    const rival = testHarness.app.getGameProjection(sessionId('P2'), GAME_ID);
    const facilitator = testHarness.app.getGameProjection(sessionId('F1'), GAME_ID);
    const serialized = JSON.stringify([owner, rival, facilitator]);

    expect(owner.ok && owner.projection.viewer).toEqual({ participantId: 'P1', role: 'PLAYER' });
    expect(rival.ok && rival.projection.participants.find(({ participantId }) => participantId === 'P1')).toMatchObject({ handSize: 10, operationsDeckRemainingCount: 25 });
    expect(facilitator.ok && facilitator.projection.viewer.role).toBe('FACILITATOR');
    expect(serialized).not.toMatch(/(?:ARDEN|FLUMA|URSARIA|PRESQUE|DINESIA)-CARD-/);
    expect(serialized).not.toContain('operationsDeckOrder');
    expect(serialized).not.toContain('handCardInstanceIds');
    expect(serialized).not.toContain('permissions');
    expect(serialized).not.toContain('events');
    expect(testHarness.app.gameSnapshot(GAME_ID)).toEqual(before);
    expect(testHarness.store.idempotencyCount()).toBe(idempotencyBefore);
  });

  it('GE-M1-SES-010 returns the same create and seat results on exact retries without duplication', () => {
    const testHarness = harness();
    const createInput = command('CREATE_GAME', GAME_ID, 0, createPayload(), {
      commandId: 'retry-create', idempotencyKey: 'retry-create-key',
    });
    const created = testHarness.app.execute(sessionId('F1'), createInput);
    const createRetry = testHarness.app.execute(sessionId('F1'), createInput);
    expect(createRetry).toEqual(created);
    expect(testHarness.app.gameSnapshot(GAME_ID)?.events.filter(({ type }) => type === 'GAME_CREATED')).toHaveLength(1);

    joinPlayers(testHarness);
    const state = testHarness.app.gameSnapshot(GAME_ID);
    const seatInput = command('ASSIGN_PLAYER_SEAT', GAME_ID, state?.version ?? -1, {
      playerParticipantId: 'P1', countryId: 'ARDEN', seatIndex: 0, clockwiseIndex: 0,
    }, { commandId: 'retry-seat', idempotencyKey: 'retry-seat-key' });
    const seated = testHarness.app.execute(sessionId('F1'), seatInput);
    const afterSeat = testHarness.app.gameSnapshot(GAME_ID);
    const seatRetry = testHarness.app.execute(sessionId('F1'), seatInput);

    expect(seatRetry).toEqual(seated);
    expect(testHarness.app.gameSnapshot(GAME_ID)).toEqual(afterSeat);
    expect(Object.keys(afterSeat?.seats ?? {})).toEqual(['P1']);
    expect(afterSeat?.events.filter(({ type }) => type === 'PLAYER_SEAT_ASSIGNED')).toHaveLength(1);
  });
});
