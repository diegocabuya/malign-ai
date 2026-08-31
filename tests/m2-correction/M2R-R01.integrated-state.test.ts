import { describe, expect, it } from 'vitest';
import { applyM2StateToCanonical, buildM2StateFromCanonical } from '../../packages/game-engine/src/index.js';
import { command, completeAndStart, harness, trustedBindings } from '../m1-0/test-fixtures.js';

describe('M2R-R01 canonical state integration seam', () => {
  it('round-trips resources, VP, influence, legitimacy and scheduler through canonical state', () => {
    const testHarness = harness();
    const state = completeAndStart(testHarness);
    const m2 = buildM2StateFromCanonical(state);
    const participant = m2.participants.P1!;
    participant.resources += 3; participant.victoryPoints += 4;
    m2.influence.push({ pdId: 'ARDEN_PD_1', type: 'RESILIENCY', attributionCountryId: 'ARDEN', count: 2 });
    m2.legitimacyByPd.ARDEN_PD_1 = 'P1'; m2.scheduler.status = 'COMPLETE';
    applyM2StateToCanonical(state, m2);
    expect(state.countries.ARDEN.resources).toBe(participant.resources);
    expect(state.adjudication.vpByParticipant.P1).toBe(participant.victoryPoints);
    expect(state.adjudication.influenceStacks.at(-1)).toMatchObject({ pdId: 'ARDEN_PD_1', type: 'RESILIENCY', count: 2 });
    expect(state.adjudication.legitimacyByPd.ARDEN_PD_1).toBe('P1');
    expect(state.adjudication.scheduler.status).toBe('COMPLETE');
  });

  it('runs Cleanup through atomic dispatcher with phase, CAS and idempotency enforcement', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    const options = { gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-CLEANUP-1', idempotencyKey: 'M2-CLEANUP-K1' };
    const first = testHarness.dispatcher.runM2Cleanup(options);
    expect(first).toMatchObject({ status: 'RESOLVED', resultCode: 'M2_CLEANUP_COMPLETED', gameVersionAfter: state.version + 1 });
    expect(testHarness.store.snapshot(state.id)).toMatchObject({ phase: 'INITIATIVE_STAGE' });
    expect(testHarness.dispatcher.runM2Cleanup(options)).toEqual(first);
    const stale = testHarness.dispatcher.runM2Cleanup({ ...options, commandId: 'M2-CLEANUP-2', idempotencyKey: 'M2-CLEANUP-K2' });
    expect(stale).toMatchObject({ status: 'REJECTED', error: { code: 'STALE_STATE_VERSION' } });
  });

  it('runs End Game through the atomic dispatcher using canonical demographic and influence state', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    const options = { gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-END-1', idempotencyKey: 'M2-END-K1' };
    const first = testHarness.dispatcher.runM2EndGame(options);
    expect(first).toMatchObject({ status: 'RESOLVED', resultCode: 'M2_GAME_COMPLETED', gameVersionAfter: state.version + 1 });
    const committed = testHarness.store.snapshot(state.id)!;
    expect(committed.endGame?.outcome).toMatchObject({ status: 'GAME_COMPLETED' });
    expect(committed.endGame?.outcome?.scores).toHaveLength(5);
    expect(committed.events.filter(({ eventType }) => eventType === 'OBJECTIVE_AWARDED')).toHaveLength(5);
    expect(committed.events.filter(({ eventType }) => eventType === 'GAME_COMPLETED')).toHaveLength(1);
    expect(testHarness.dispatcher.runM2EndGame(options)).toEqual(first);
    const stale = testHarness.dispatcher.runM2EndGame({ ...options, commandId: 'M2-END-2', idempotencyKey: 'M2-END-K2' });
    expect(stale).toMatchObject({ status: 'REJECTED', error: { code: 'STALE_STATE_VERSION' } });
  });

  it('opens and plays Reaction through internal trigger and authenticated player boundaries', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
    state.initiative.orderParticipantIds.splice(0, state.initiative.orderParticipantIds.length, 'P1', 'P2', 'P3', 'P4', 'P5');
    const reactionCard = state.cards['ARDEN-CARD-018']!;
    reactionCard.controllerParticipantId = 'P2'; reactionCard.zone = 'HAND';
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    const opened = testHarness.dispatcher.openM2Reaction({
      gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-REACTION-OPEN-1',
      idempotencyKey: 'M2-REACTION-OPEN-K1', trigger: 'HACK_BACK', triggeringParticipantId: 'P1',
    });
    expect(opened).toMatchObject({ status: 'RESOLVED', resultCode: 'REACTION_WINDOW_OPENED' });
    const afterOpen = testHarness.store.snapshot(state.id)!;
    const p2Session = trustedBindings().find(({ participantId }) => participantId === 'P2')!.authenticatedSessionId;
    const p3Session = trustedBindings().find(({ participantId }) => participantId === 'P3')!.authenticatedSessionId;
    const facilitatorSession = trustedBindings().find(({ participantId }) => participantId === 'F1')!.authenticatedSessionId;
    expect(testHarness.app.getGameProjection(p2Session, state.id)).toMatchObject({ ok: true, projection: { reaction: { options: ['PASS', 'PLAY_REACTION'] } } });
    expect(testHarness.app.getGameProjection(p3Session, state.id)).toMatchObject({ ok: true, projection: { reaction: { currentParticipantId: 'P2' } } });
    expect((testHarness.app.getGameProjection(p3Session, state.id) as { projection: { reaction: unknown } }).projection.reaction).not.toHaveProperty('options');
    expect(testHarness.app.getGameProjection(facilitatorSession, state.id)).toMatchObject({ ok: true, projection: { reaction: { options: ['PASS', 'PLAY_REACTION'] } } });
    const played = testHarness.app.execute(p2Session, command('PLAY_REACTION', state.id, afterOpen.version, {
      cardId: reactionCard.id, effectId: 'CARD_EFFECT_BASE_2025_E010',
    }, { commandId: 'M2-REACTION-PLAY-1', idempotencyKey: 'M2-REACTION-PLAY-K1' }));
    expect(played).toMatchObject({ status: 'RESOLVED', resultCode: 'REACTION_PLAYED', resultPayload: { status: 'CLOSED', negated: true } });
    const committed = testHarness.store.snapshot(state.id)!;
    expect(committed.cards[reactionCard.id]).toMatchObject({ zone: 'DISCARD' });
    expect(committed.reactionContinuation?.window.plays).toHaveLength(1);
    expect(testHarness.app.execute(p2Session, command('PLAY_REACTION', state.id, afterOpen.version, {
      cardId: reactionCard.id, effectId: 'CARD_EFFECT_BASE_2025_E010',
    }, { commandId: 'M2-REACTION-PLAY-1', idempotencyKey: 'M2-REACTION-PLAY-K1' }))).toEqual(played);
  });

  it('passes Reaction priority atomically and rejects a stale continuation command', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
    state.initiative.orderParticipantIds.splice(0, state.initiative.orderParticipantIds.length, 'P1', 'P2', 'P3', 'P4', 'P5');
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(testHarness.dispatcher.openM2Reaction({
      gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-REACTION-OPEN-2',
      idempotencyKey: 'M2-REACTION-OPEN-K2', trigger: 'PRE_ROLL', triggeringParticipantId: 'P1',
    })).toMatchObject({ status: 'RESOLVED' });
    const opened = testHarness.store.snapshot(state.id)!;
    const p2Session = trustedBindings().find(({ participantId }) => participantId === 'P2')!.authenticatedSessionId;
    const passed = testHarness.app.execute(p2Session, command('PASS_REACTION', state.id, opened.version, {}, {
      commandId: 'M2-REACTION-PASS-1', idempotencyKey: 'M2-REACTION-PASS-K1',
    }));
    expect(passed).toMatchObject({ status: 'RESOLVED', resultCode: 'REACTION_PRIORITY_PASSED', resultPayload: { status: 'WAITING_FOR_PRIORITY_PLAYER' } });
    expect(testHarness.store.snapshot(state.id)?.reactionContinuation?.window).toMatchObject({ priorityIndex: 1 });
    expect(testHarness.app.execute(p2Session, command('PASS_REACTION', state.id, opened.version, {}, {
      commandId: 'M2-REACTION-PASS-2', idempotencyKey: 'M2-REACTION-PASS-K2',
    }))).toMatchObject({ status: 'REJECTED', error: { code: 'STALE_STATE_VERSION' } });
  });
});
