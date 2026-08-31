import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyM2StateToCanonical, buildDurableEngineTransition, buildM2StateFromCanonical, M2_EFFECT_MANIFEST, M2_IMPLEMENTED_EFFECT_IDS } from '../../packages/game-engine/src/index.js';
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
    const p1Session = trustedBindings().find(({ participantId }) => participantId === 'P1')!.authenticatedSessionId;
    expect(testHarness.app.getGameProjection(p1Session, state.id)).toMatchObject({ ok: true, projection: { outcome: { status: 'GAME_COMPLETED' } } });
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

  it('executes a registry-bound M2 effect atomically and persists lifecycle plus audit', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
    const source = state.cards['ARDEN-CARD-001']!; source.controllerParticipantId = 'P1'; source.zone = 'HAND';
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    const p1Before = state.countries.ARDEN.resources; const p2Before = state.countries.FLUMA.resources;
    const options = {
      gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-EFFECT-1', idempotencyKey: 'M2-EFFECT-K1',
      actorParticipantId: 'P1', sourceCardInstanceId: source.id, effectId: 'CARD_EFFECT_BASE_2025_E001',
      effectVersion: '0.1', parameters: { targetParticipantId: 'P2' },
    };
    const first = testHarness.dispatcher.executeM2Effect(options);
    expect(first).toMatchObject({ status: 'RESOLVED', resultCode: 'M2_EFFECT_EXECUTED' });
    const committed = testHarness.store.snapshot(state.id)!;
    expect(committed.countries.ARDEN.resources).toBe(p1Before + 2);
    expect(committed.countries.FLUMA.resources).toBe(p2Before + 2);
    expect(committed.cards[source.id]?.zone).toBe('DISCARD');
    expect(committed.m2Audit?.at(-1)).toMatchObject({ type: 'RESOURCE_GAINED', actorParticipantId: 'P1' });
    expect(testHarness.dispatcher.executeM2Effect(options)).toEqual(first);
  });

  it('inventories exactly 59 registry effects and fails closed for known unimplemented handlers', () => {
    expect(M2_EFFECT_MANIFEST).toHaveLength(59);
    expect(new Set(M2_EFFECT_MANIFEST.map(({ effectId }) => effectId)).size).toBe(59);
    const registry = JSON.parse(readFileSync(new URL('../../docs/normative/MALIGN_AI_CARD_REGISTRY_SNAPSHOT_v0.1.json', import.meta.url), 'utf8')) as {
      readonly effect_definitions: readonly { readonly effect_id: string; readonly source_definition_id: string }[];
    };
    expect(M2_EFFECT_MANIFEST).toEqual(registry.effect_definitions.map(({ effect_id, source_definition_id }) => ({
      effectId: effect_id, sourceDefinitionId: source_definition_id,
    })));
    expect(M2_IMPLEMENTED_EFFECT_IDS).toHaveLength(8);
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
    const source = state.cards['ARDEN-CARD-008']!; source.controllerParticipantId = 'P1'; source.zone = 'HAND';
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    const before = testHarness.store.snapshot(state.id);
    expect(testHarness.dispatcher.executeM2Effect({
      gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-EFFECT-DISABLED-1', idempotencyKey: 'M2-EFFECT-DISABLED-K1',
      actorParticipantId: 'P1', sourceCardInstanceId: source.id, effectId: 'CARD_EFFECT_BASE_2025_E003', effectVersion: '0.1', parameters: {},
    })).toMatchObject({ status: 'REJECTED', error: { code: 'EFFECT_DISABLED' } });
    expect(testHarness.store.snapshot(state.id)).toEqual(before);
  });

  it('executes core legitimacy and backlash operations through canonical atomic state', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
    state.adjudication.vpByParticipant.P1 = 5;
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    const legitimacy = testHarness.dispatcher.executeM2CoreOperation({
      gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-CORE-LEG-1', idempotencyKey: 'M2-CORE-LEG-K1',
      operation: { kind: 'ESTABLISH_LEGITIMACY', actorParticipantId: 'P1', pdId: 'PRESQUE_PD_1' },
    });
    expect(legitimacy).toMatchObject({ status: 'RESOLVED', resultCode: 'M2_CORE_OPERATION_EXECUTED' });
    const afterLegitimacy = testHarness.store.snapshot(state.id)!;
    expect(afterLegitimacy.adjudication.legitimacyByPd.PRESQUE_PD_1).toBe('P1');
    const backlash = testHarness.dispatcher.executeM2CoreOperation({
      gameId: state.id, expectedGameVersion: afterLegitimacy.version, commandId: 'M2-CORE-BACKLASH-1', idempotencyKey: 'M2-CORE-BACKLASH-K1',
      operation: { kind: 'APPLY_BACKLASH', actorParticipantId: 'P1', pdId: 'PRESQUE_PD_1', amount: 2 },
    });
    expect(backlash).toMatchObject({ status: 'RESOLVED', resultPayload: { operation: 'APPLY_BACKLASH' } });
    expect(testHarness.store.snapshot(state.id)?.m2Audit?.slice(-2).map(({ type }) => type)).toEqual(['ESTABLISH_LEGITIMACY', 'APPLY_BACKLASH']);
  });

  it('uses transactional RNG for blind steal and preserves its idempotent result', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
    const targetCard = state.cards['FLUMA-CARD-001']!; targetCard.controllerParticipantId = 'P2'; targetCard.zone = 'HAND';
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    const options = {
      gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-CORE-STEAL-1', idempotencyKey: 'M2-CORE-STEAL-K1',
      operation: { kind: 'STEAL_BLIND_CARD' as const, actorParticipantId: 'P1', targetParticipantId: 'P2' },
    };
    const first = testHarness.dispatcher.executeM2CoreOperation(options);
    expect(first).toMatchObject({ status: 'RESOLVED', resultPayload: { operation: 'STEAL_BLIND_CARD', stolenCardId: targetCard.id } });
    expect(testHarness.store.snapshot(state.id)?.cards[targetCard.id]).toMatchObject({ controllerParticipantId: 'P1', returnToOwnerOnDiscard: true });
    const p1Session = trustedBindings().find(({ participantId }) => participantId === 'P1')!.authenticatedSessionId;
    const p2Session = trustedBindings().find(({ participantId }) => participantId === 'P2')!.authenticatedSessionId;
    const facilitatorSession = trustedBindings().find(({ participantId }) => participantId === 'F1')!.authenticatedSessionId;
    const ownerProjection = testHarness.app.getM1AdjudicationProjection(p1Session, state.id);
    const rivalProjection = testHarness.app.getM1AdjudicationProjection(p2Session, state.id);
    const facilitatorProjection = testHarness.app.getM1AdjudicationProjection(facilitatorSession, state.id);
    expect(ownerProjection).toMatchObject({ ok: true, projection: { audit: { m2AuditEntries: 1 } } });
    expect((ownerProjection as { projection: { audit: unknown } }).projection.audit).not.toHaveProperty('m2Audit');
    expect(facilitatorProjection).toMatchObject({ ok: true, projection: { audit: { m2AuditEntries: 1, m2Audit: [{ type: 'STEAL_BLIND_CARD' }] } } });
    expect((ownerProjection as { projection: { events: { payload: unknown }[] } }).projection.events.at(-1)?.payload).toMatchObject({ subjectId: targetCard.id });
    expect((rivalProjection as { projection: { events: { payload: unknown }[] } }).projection.events.at(-1)?.payload).toEqual({ redacted: true });
    expect(testHarness.dispatcher.executeM2CoreOperation(options)).toEqual(first);
  });

  it('captures Reaction, End Game and M2 audit in durable normalized family hashes', () => {
    const testHarness = harness(); const before = completeAndStart(testHarness); const after = structuredClone(before);
    after.version += 1;
    after.reactionContinuation = {
      kind: 'REACTION', schemaVersion: 1, id: 'RX-CONT-1', gameVersion: after.version,
      window: { id: 'RX-1', version: 1, trigger: 'PRE_ROLL', triggeringParticipantId: 'P1', priorityParticipantIds: ['P2'], priorityIndex: 0, status: 'WAITING_FOR_PRIORITY_PLAYER', expiresAt: null, passes: [], plays: [] },
    };
    after.endGame = { idempotencyResults: {}, awardedObjectiveKeys: [] };
    after.m2Audit = [{ type: 'TEST', actorParticipantId: 'P1', payload: { value: 1 } }];
    const transition = buildDurableEngineTransition({
      gameId: after.id, commandType: 'TEST_M2_DURABILITY', idempotencyKey: 'TEST-M2-DURABILITY-K1', fingerprintSha256: '0'.repeat(64),
      actor: { actorId: 'SYSTEM', actorType: 'SYSTEM', participantId: null, authenticatedSessionId: 'internal:test' },
      beforeState: before, afterState: after,
      engineResult: { commandId: 'TEST-M2-DURABILITY-1', gameId: after.id, status: 'RESOLVED', gameVersionBefore: before.version, gameVersionAfter: after.version, resultCode: 'TEST', emittedEventRefs: [], adjudicationTraceRefs: [], resolvedAt: '2026-08-31T00:00:00.000Z' },
    });
    expect(transition.normalizedMutations.map(({ family }) => family).sort()).toEqual(['CONTINUATIONS', 'EVENTS_TRACES', 'SESSION_LIFECYCLE']);
  });
});
