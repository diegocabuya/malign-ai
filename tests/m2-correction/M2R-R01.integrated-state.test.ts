import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyM2StateToCanonical, BASE_2025_PAIR_BONUSES, buildDurableEngineTransition, buildM2StateFromCanonical, createM1ReplayBundle, createM1StateSnapshot, M2BEffectDispatcher, M2_EFFECT_MANIFEST, M2_EVENT_DRIVEN_EFFECT_IDS, M2_IMPLEMENTED_EFFECT_IDS, M2_PAIR_BONUS_EFFECT_IDS, replayM1Events } from '../../packages/game-engine/src/index.js';
import { command, completeAndStart, harness, trustedBindings } from '../m1-0/test-fixtures.js';
import { adjudicationHarness, FULL_CAMPAIGN, GAME_ID, runActivation, runConstruct } from '../m1-2/test-fixtures.js';
import { canonicalizeJson } from '../../packages/shared/src/index.js';

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
    const triggeringCard = state.cards['ARDEN-CARD-043']!;
    triggeringCard.controllerParticipantId = 'P1'; triggeringCard.zone = 'HAND';
    const reactionCard = state.cards['ARDEN-CARD-018']!;
    reactionCard.controllerParticipantId = 'P2'; reactionCard.zone = 'HAND';
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    const opened = testHarness.dispatcher.openM2Reaction({
      gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-REACTION-OPEN-1',
      idempotencyKey: 'M2-REACTION-OPEN-K1', trigger: 'HACK_BACK', triggeringParticipantId: 'P1', triggeringCardId: triggeringCard.id,
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
    const triggeringCard = state.cards['ARDEN-CARD-088']!;
    triggeringCard.controllerParticipantId = 'P1'; triggeringCard.zone = 'HAND';
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(testHarness.dispatcher.openM2Reaction({
      gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-REACTION-OPEN-2',
      idempotencyKey: 'M2-REACTION-OPEN-K2', trigger: 'CORRUPTION', triggeringParticipantId: 'P1', triggeringCardId: triggeringCard.id,
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

  it('resolves E048 through authenticated defense and a frozen strict-majority electorate', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
    state.initiative.orderParticipantIds.splice(0, state.initiative.orderParticipantIds.length, 'P1', 'P2', 'P3', 'P4', 'P5');
    const campaignCard = state.cards['ARDEN-CARD-001']!; campaignCard.controllerParticipantId = 'P1'; campaignCard.zone = 'CAMPAIGN';
    const vetoCard = state.cards['FLUMA-CARD-085']!; vetoCard.controllerParticipantId = 'P2'; vetoCard.zone = 'HAND';
    state.strategy.P2.handCardInstanceIds = [vetoCard.id];
    state.adjudication.campaigns.CAMPAIGN_E048 = {
      id: 'CAMPAIGN_E048', ownerParticipantId: 'P1', row: 'I', alignment: 'MALIGN', targetDtId: 'RELIGION:NONE',
      assignments: [{ slot: 'INTENT', cardInstanceId: campaignCard.id, definitionId: campaignCard.definitionId, influenceValue: 1 }], activationCountThisTurn: 0,
    };
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(testHarness.dispatcher.openM2Reaction({
      gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-E048-OPEN-1', idempotencyKey: 'M2-E048-OPEN-K1',
      trigger: 'NARRATIVE', triggeringParticipantId: 'P1', triggeringCampaignId: 'CAMPAIGN_E048',
    })).toMatchObject({ status: 'RESOLVED' });
    const sessions = Object.fromEntries(trustedBindings().map((binding) => [binding.participantId, binding.authenticatedSessionId]));
    let current = testHarness.store.snapshot(state.id)!;
    expect(testHarness.app.execute(sessions.P2!, command('PLAY_REACTION', state.id, current.version, {
      cardId: vetoCard.id, effectId: 'CARD_EFFECT_BASE_2025_E048', reasonText: 'La narrativa no justifica la campaña.',
    }, { commandId: 'M2-E048-PLAY-1', idempotencyKey: 'M2-E048-PLAY-K1' }))).toMatchObject({ status: 'RESOLVED' });
    current = testHarness.store.snapshot(state.id)!;
    expect(current.cards[vetoCard.id]?.zone).toBe('HAND');
    expect(testHarness.app.getGameProjection(sessions.P1!, state.id)).toMatchObject({ ok: true, projection: { veto: { maySubmitDefense: true, votesCast: 0 } } });
    expect(testHarness.app.execute(sessions.P1!, command('SUBMIT_VETO_DEFENSE', state.id, current.version, {
      vetoCaseId: current.m2Veto!.id, defenseText: 'La campaña sí se sostiene en las cartas declaradas.',
    }, { commandId: 'M2-E048-DEFENSE-1', idempotencyKey: 'M2-E048-DEFENSE-K1' }))).toMatchObject({ status: 'RESOLVED' });
    current = testHarness.store.snapshot(state.id)!;
    const votes = { P1: 'UNACCEPTABLE', P2: 'UNACCEPTABLE', P3: 'UNACCEPTABLE', P4: 'ACCEPTABLE', P5: 'ACCEPTABLE' } as const;
    for (const [index, participantId] of Object.keys(votes).entries()) {
      const result = testHarness.app.execute(sessions[participantId]!, command('CAST_VETO_VOTE', state.id, current.version, {
        vetoCaseId: current.m2Veto!.id, vote: votes[participantId as keyof typeof votes],
      }, { commandId: `M2-E048-VOTE-${index + 1}`, idempotencyKey: `M2-E048-VOTE-K${index + 1}` }));
      expect(result).toMatchObject({ status: 'RESOLVED', resultCode: index === 4 ? 'VETO_RESOLVED' : 'VETO_VOTE_CAST' });
      current = testHarness.store.snapshot(state.id)!;
    }
    expect(current.m2Veto).toBeUndefined(); expect(current.adjudication.campaigns.CAMPAIGN_E048).toBeUndefined();
    expect(current.cards[vetoCard.id]?.zone).toBe('REMOVED_FROM_GAME'); expect(current.cards[campaignCard.id]?.zone).toBe('DISCARD');
    expect(current.vetoBlockedParticipantIdsThisTurn).toEqual(['P1']);
    expect(current.events.filter(({ type }) => type === 'VETO_VOTE_CAST').map(({ payload }) => payload)).toHaveLength(5);
  });

  it('rejects an E048 abuse determination before mutating the veto card', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
    state.initiative.orderParticipantIds.splice(0, state.initiative.orderParticipantIds.length, 'P1', 'P2', 'P3', 'P4', 'P5');
    const campaignCard = state.cards['ARDEN-CARD-001']!; campaignCard.controllerParticipantId = 'P1'; campaignCard.zone = 'CAMPAIGN';
    const vetoCard = state.cards['FLUMA-CARD-085']!; vetoCard.controllerParticipantId = 'P2'; vetoCard.zone = 'HAND';
    state.adjudication.campaigns.CAMPAIGN_E048_ABUSE = {
      id: 'CAMPAIGN_E048_ABUSE', ownerParticipantId: 'P1', row: 'I', alignment: 'MALIGN', targetDtId: 'RELIGION:NONE',
      assignments: [{ slot: 'INTENT', cardInstanceId: campaignCard.id, definitionId: campaignCard.definitionId, influenceValue: 1 }], activationCountThisTurn: 0,
    };
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(testHarness.dispatcher.openM2Reaction({ gameId: state.id, expectedGameVersion: state.version,
      commandId: 'M2-E048-ABUSE-OPEN-1', idempotencyKey: 'M2-E048-ABUSE-OPEN-K1', trigger: 'NARRATIVE',
      triggeringParticipantId: 'P1', triggeringCampaignId: 'CAMPAIGN_E048_ABUSE' })).toMatchObject({ status: 'RESOLVED' });
    const sessions = Object.fromEntries(trustedBindings().map((binding) => [binding.participantId, binding.authenticatedSessionId]));
    let current = testHarness.store.snapshot(state.id)!;
    expect(testHarness.app.execute(sessions.F1!, command('RESOLVE_VETO_ABUSE', state.id, current.version, {
      reactionWindowId: current.reactionContinuation!.window.id, initiatorParticipantId: 'P2', decision: 'REJECT',
    }, { commandId: 'M2-E048-ABUSE-REVIEW-1', idempotencyKey: 'M2-E048-ABUSE-REVIEW-K1' }))).toMatchObject({ status: 'RESOLVED' });
    current = testHarness.store.snapshot(state.id)!;
    const before = structuredClone(current);
    expect(testHarness.app.execute(sessions.P2!, command('PLAY_REACTION', state.id, current.version, {
      cardId: vetoCard.id, effectId: 'CARD_EFFECT_BASE_2025_E048', reasonText: 'Intento marcado como abuso.',
    }, { commandId: 'M2-E048-ABUSE-PLAY-1', idempotencyKey: 'M2-E048-ABUSE-PLAY-K1' }))).toMatchObject({ status: 'REJECTED', error: { code: 'VETO_ABUSE' } });
    expect(testHarness.store.snapshot(state.id)).toEqual(before);
  });

  it('binds E040 to the triggering campaign and discards it only after a successful internal roll', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
    state.initiative.orderParticipantIds.splice(0, state.initiative.orderParticipantIds.length, 'P1', 'P2', 'P3', 'P4', 'P5');
    const campaignCard = state.cards['ARDEN-CARD-001']!; campaignCard.controllerParticipantId = 'P1'; campaignCard.zone = 'CAMPAIGN';
    const reactionCard = state.cards['FLUMA-CARD-073']!; reactionCard.controllerParticipantId = 'P2'; reactionCard.zone = 'HAND';
    state.adjudication.campaigns.CAMPAIGN_E040 = {
      id: 'CAMPAIGN_E040', ownerParticipantId: 'P1', row: 'I', alignment: 'MALIGN', targetDtId: 'RELIGION:NONE',
      assignments: [{ slot: 'INTENT', cardInstanceId: campaignCard.id, definitionId: campaignCard.definitionId, influenceValue: 1 }], activationCountThisTurn: 0,
    };
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(testHarness.dispatcher.openM2Reaction({
      gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-E040-OPEN-1', idempotencyKey: 'M2-E040-OPEN-K1',
      trigger: 'PRE_ROLL', triggeringParticipantId: 'P1', triggeringCampaignId: 'CAMPAIGN_E040',
    })).toMatchObject({ status: 'RESOLVED' });
    const opened = testHarness.store.snapshot(state.id)!;
    const p2Session = trustedBindings().find(({ participantId }) => participantId === 'P2')!.authenticatedSessionId;
    expect(testHarness.app.execute(p2Session, command('PLAY_REACTION', state.id, opened.version, {
      cardId: reactionCard.id, effectId: 'CARD_EFFECT_BASE_2025_E040',
    }, { commandId: 'M2-E040-PLAY-1', idempotencyKey: 'M2-E040-PLAY-K1' }))).toMatchObject({
      status: 'RESOLVED', resultPayload: { negated: true },
    });
    const committed = testHarness.store.snapshot(state.id)!;
    expect(committed.adjudication.campaigns.CAMPAIGN_E040).toBeUndefined();
    expect(committed.cards[campaignCard.id]?.zone).toBe('DISCARD');
    expect(committed.cards[reactionCard.id]?.zone).toBe('DISCARD');
    expect(testHarness.random.requests.at(-1)).toEqual({ minInclusive: 1, maxInclusive: 10 });
  });

  it('binds E054 to the drawn Filtraciones instance and discards both cards', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
    state.initiative.orderParticipantIds.splice(0, state.initiative.orderParticipantIds.length, 'P1', 'P2', 'P3', 'P4', 'P5');
    const leaks = state.cards['ARDEN-CARD-026']!; leaks.controllerParticipantId = 'P1'; leaks.zone = 'HAND';
    const reactionCard = state.cards['FLUMA-CARD-094']!; reactionCard.controllerParticipantId = 'P2'; reactionCard.zone = 'HAND';
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(testHarness.dispatcher.openM2Reaction({
      gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-E054-OPEN-1', idempotencyKey: 'M2-E054-OPEN-K1',
      trigger: 'LEAKS_DRAWN', triggeringParticipantId: 'P1', triggeringCardId: leaks.id,
    })).toMatchObject({ status: 'RESOLVED' });
    const opened = testHarness.store.snapshot(state.id)!;
    const p2Session = trustedBindings().find(({ participantId }) => participantId === 'P2')!.authenticatedSessionId;
    expect(testHarness.app.execute(p2Session, command('PLAY_REACTION', state.id, opened.version, {
      cardId: reactionCard.id, effectId: 'CARD_EFFECT_BASE_2025_E054',
    }, { commandId: 'M2-E054-PLAY-1', idempotencyKey: 'M2-E054-PLAY-K1' }))).toMatchObject({
      status: 'RESOLVED', resultPayload: { negated: true },
    });
    const committed = testHarness.store.snapshot(state.id)!;
    expect(committed.cards[leaks.id]?.zone).toBe('DISCARD');
    expect(committed.cards[reactionCard.id]?.zone).toBe('DISCARD');
  });

  it('rejects PRE_ROLL without a valid campaign subject and preserves canonical state', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    const before = testHarness.store.snapshot(state.id);
    expect(testHarness.dispatcher.openM2Reaction({
      gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-E040-INVALID-1', idempotencyKey: 'M2-E040-INVALID-K1',
      trigger: 'PRE_ROLL', triggeringParticipantId: 'P1',
    })).toMatchObject({ status: 'REJECTED', error: { code: 'INVALID_REACTION_INPUT' } });
    expect(testHarness.store.snapshot(state.id)).toEqual(before);
  });

  it('GE-ACT-001 — executes Trade Agreements atomically and persists both gains plus lifecycle', () => {
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

  it.each([
    ['GE-ACT-013',5,2],['GE-ACT-014',1,1],['GE-ACT-015',0,0],
  ] as const)('%s — Economic Sanctions transfers only the available amount up to two',(_id,targetBalance,transferred)=>{
    const testHarness=harness();const state=completeAndStart(testHarness);state.phase='RESOLUTION_STAGE';
    const source=state.cards['ARDEN-CARD-037']!;source.controllerParticipantId='P1';source.zone='HAND';
    state.countries.FLUMA.resources=targetBalance;
    const actorBefore=state.countries.ARDEN.resources;
    expect(testHarness.store.commitState(state.id,state.version,state)).toBe(true);
    expect(testHarness.dispatcher.executeM2Effect({gameId:state.id,expectedGameVersion:state.version,
      commandId:`M2-E019-${targetBalance}`,idempotencyKey:`M2-E019-K${targetBalance}`,actorParticipantId:'P1',
      sourceCardInstanceId:source.id,effectId:'CARD_EFFECT_BASE_2025_E019',effectVersion:'0.1',parameters:{targetParticipantId:'P2'},
    })).toMatchObject({status:'RESOLVED'});
    const committed=testHarness.store.snapshot(state.id)!;
    expect(committed.countries.FLUMA.resources).toBe(targetBalance-transferred);
    expect(committed.countries.ARDEN.resources).toBe(actorBefore+transferred);
    expect(committed.cards[source.id]?.zone).toBe('DISCARD');
  });

  it.each([
    ['GE-ACT-006',0,3,0,3],['GE-ACT-007',1,1,0,3],
  ] as const)('%s — Leaks applies exactly three direct MALIGN with canonical 2:1',(_id,resiliencyBefore,malignAfter,resiliencyAfter,forgedAmount)=>{
    const testHarness=harness();const state=completeAndStart(testHarness);state.phase='RESOLUTION_STAGE';
    const source=state.cards['ARDEN-CARD-026']!;source.controllerParticipantId='P1';source.zone='HAND';
    state.adjudication.influenceStacks=state.adjudication.influenceStacks.filter(({pdId})=>pdId!=='PRESQUE_PD_1');
    if(resiliencyBefore>0)state.adjudication.influenceStacks.push({pdId:'PRESQUE_PD_1',type:'RESILIENCY',attributionCountryId:'FLUMA',count:resiliencyBefore});
    const vpBefore=state.adjudication.vpByParticipant.P1;const legitimacyBefore=state.adjudication.legitimacyByPd.PRESQUE_PD_1;
    expect(testHarness.store.commitState(state.id,state.version,state)).toBe(true);
    expect(testHarness.dispatcher.executeM2Effect({gameId:state.id,expectedGameVersion:state.version,
      commandId:`M2-E014-${resiliencyBefore}`,idempotencyKey:`M2-E014-K${resiliencyBefore}`,actorParticipantId:'P1',
      sourceCardInstanceId:source.id,effectId:'CARD_EFFECT_BASE_2025_E014',effectVersion:'0.1',
      parameters:{pdId:'PRESQUE_PD_1',type:'RESILIENCY',amount:forgedAmount+20},
    })).toMatchObject({status:'RESOLVED'});
    const committed=testHarness.store.snapshot(state.id)!;
    expect(committed.adjudication.influenceStacks.find(({pdId,type,attributionCountryId})=>
      pdId==='PRESQUE_PD_1'&&type==='MALIGN'&&attributionCountryId==='ARDEN')?.count??0).toBe(malignAfter);
    expect(committed.adjudication.influenceStacks.find(({pdId,type})=>pdId==='PRESQUE_PD_1'&&type==='RESILIENCY')?.count??0).toBe(resiliencyAfter);
    expect(committed.adjudication.vpByParticipant.P1).toBe(vpBefore);expect(committed.adjudication.legitimacyByPd.PRESQUE_PD_1).toBe(legitimacyBefore);
  });

  it('GE-ACT-008 — Crisis Management pays and places the exact fixed direct-resiliency values',()=>{
    const testHarness=harness();const state=completeAndStart(testHarness);state.phase='RESOLUTION_STAGE';
    const source=state.cards['ARDEN-CARD-028']!;source.controllerParticipantId='P1';source.zone='HAND';
    state.countries.ARDEN.resources=3;state.adjudication.influenceStacks=state.adjudication.influenceStacks.filter(({pdId})=>pdId!=='PRESQUE_PD_1');
    expect(testHarness.store.commitState(state.id,state.version,state)).toBe(true);
    expect(testHarness.dispatcher.executeM2Effect({gameId:state.id,expectedGameVersion:state.version,
      commandId:'M2-E015-1',idempotencyKey:'M2-E015-K1',actorParticipantId:'P1',sourceCardInstanceId:source.id,
      effectId:'CARD_EFFECT_BASE_2025_E015',effectVersion:'0.1',parameters:{pdId:'PRESQUE_PD_1',type:'MALIGN',amount:99,cost:0},
    })).toMatchObject({status:'RESOLVED'});
    const committed=testHarness.store.snapshot(state.id)!;
    expect(committed.countries.ARDEN.resources).toBe(0);
    expect(committed.adjudication.influenceStacks.find(({pdId,type,attributionCountryId})=>
      pdId==='PRESQUE_PD_1'&&type==='RESILIENCY'&&attributionCountryId==='ARDEN')?.count).toBe(3);
    expect(committed.cards[source.id]?.zone).toBe('DISCARD');
  });

  it.each([
    ['GE-ACT-029',5,3],['GE-ACT-030',1,0],
  ] as const)('%s — Corruption applies two VP with floor zero through the atomic boundary',(_id,targetVp,expectedVp)=>{
    const testHarness=harness();const state=completeAndStart(testHarness);state.phase='RESOLUTION_STAGE';
    const source=state.cards['ARDEN-CARD-088']!;source.controllerParticipantId='P1';source.zone='HAND';
    state.adjudication.vpByParticipant.P2=targetVp;
    expect(testHarness.store.commitState(state.id,state.version,state)).toBe(true);
    expect(testHarness.dispatcher.executeM2Effect({gameId:state.id,expectedGameVersion:state.version,
      commandId:`M2-E051-${targetVp}`,idempotencyKey:`M2-E051-K${targetVp}`,actorParticipantId:'P1',
      sourceCardInstanceId:source.id,effectId:'CARD_EFFECT_BASE_2025_E051',effectVersion:'0.1',parameters:{targetParticipantId:'P2'},
    })).toMatchObject({status:'RESOLVED'});
    const committed=testHarness.store.snapshot(state.id)!;
    expect(committed.adjudication.vpByParticipant.P2).toBe(expectedVp);
    expect(committed.cards[source.id]?.zone).toBe('DISCARD');
    expect(committed.m2Audit?.at(-1)).toMatchObject({type:'VP_CHANGED',payload:{targetParticipantId:'P2'}});
  });

  it('reveals a committed regime slot before the internal effect port may resolve it', () => {
    const testHarness = adjudicationHarness({ die: 4 }); const state = testHarness.store.snapshot(GAME_ID)!;
    const resourcesBefore = state.countries.DINESIA.resources;
    state.initiative.orderParticipantIds.splice(0, state.initiative.orderParticipantIds.length, 'P5');
    state.actionPlanning.P5!.lockedSlots.splice(0, state.actionPlanning.P5!.lockedSlots.length, {
      sequenceIndex: 1, actionType: 'USE_REGIME_ABILITY', actionPayload: {}, apCost: 1, revealed: false,
    });
    state.actionPlanning.P5!.apAvailable = 2;
    state.adjudication.scheduler.participantIndex = 0; state.adjudication.scheduler.slotIndex = 0; state.adjudication.scheduler.status = 'READY';
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    const ready = testHarness.engine.runNext({ gameId: state.id, expectedGameVersion: state.version,
      commandId: 'M2-REGIME-SCHEDULER-1', idempotencyKey: 'M2-REGIME-SCHEDULER-K1' });
    expect(ready).toMatchObject({ status: 'REQUIRES_CHOICE', resultCode: 'M2_EFFECT_CHOICE_REQUESTED' });
    const revealed = testHarness.store.snapshot(state.id)!;
    expect(revealed).toMatchObject({ currentRevealedAction: { participantId: 'P5', sequenceIndex: 1, actionType: 'USE_REGIME_ABILITY' },
      adjudication: { scheduler: { status: 'SUSPENDED' } } });
    expect(testHarness.dispatcher.executeM2Effect({ gameId: state.id, expectedGameVersion: revealed.version,
      commandId: 'M2-REGIME-SCHEDULER-RESOLVE-1', idempotencyKey: 'M2-REGIME-SCHEDULER-RESOLVE-K1', actorParticipantId: 'P5',
      sourceCardInstanceId: '', effectId: 'REGIME_EFFECT_DINESIA', effectVersion: '0.1', parameters: { pdId: 'DINESIA_PD_1' } }))
      .toMatchObject({ status: 'REJECTED', error: { code: 'NOT_AUTHORIZED' } });
    const continuationId = revealed.m2EffectChoice?.id;
    if (continuationId === undefined) throw new Error('Dinesia regime choice missing');
    expect(testHarness.app.execute('session-p5', command('SUBMIT_M2_EFFECT_CHOICE', state.id, revealed.version, {
      continuationId, selections: { TARGET_PD: ['DINESIA_PD_1'] },
    }, { commandId: 'M2-REGIME-CHOICE-1', idempotencyKey: 'M2-REGIME-CHOICE-K1' })))
      .toMatchObject({ status: 'RESOLVED', resultCode: 'M2_EFFECT_CHOICE_RESOLVED' });
    const resolved = testHarness.store.snapshot(state.id)!;
    expect(resolved.actionPlanning.P5!.lockedSlots[0]).toMatchObject({ terminalOutcome: 'RESOLVED' });
    expect(resolved.countries.DINESIA.resources).toBe(resourcesBefore - 2);
    expect(resolved.resourceLedger.at(-1)).toMatchObject({ participantId: 'P5', reason: 'REGIME_ABILITY_COST', delta: -2 });
    expect(resolved.regimeAbilityUsedByParticipant?.P5).toBe(true);
    expect(resolved.currentRevealedAction).toBeUndefined();
    expect(resolved.adjudication.scheduler).toMatchObject({ status: 'COMPLETE', participantIndex: 1, slotIndex: 0 });
  });

  it('rolls Arden authoritatively and accepts the resulting private choice only from Arden', () => {
    const testHarness = adjudicationHarness({ die: 4 }); const state = testHarness.store.snapshot(GAME_ID)!;
    state.initiative.orderParticipantIds.splice(0, state.initiative.orderParticipantIds.length, 'P1');
    state.actionPlanning.P1!.lockedSlots.splice(0, state.actionPlanning.P1!.lockedSlots.length, {
      sequenceIndex: 1, actionType: 'USE_REGIME_ABILITY', actionPayload: {}, apCost: 1, revealed: false,
    });
    const stack = state.adjudication.influenceStacks.find(({ pdId, type }) => pdId === 'ARDEN_PD_1' && type === 'MALIGN');
    if (stack === undefined) state.adjudication.influenceStacks.push({ pdId: 'ARDEN_PD_1', type: 'MALIGN', attributionCountryId: 'FLUMA', count: 1 });
    else { stack.count = 1; Object.assign(stack, { attributionCountryId: 'FLUMA' }); }
    state.adjudication.scheduler.participantIndex = 0; state.adjudication.scheduler.slotIndex = 0; state.adjudication.scheduler.status = 'READY';
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(testHarness.engine.runNext({ gameId: state.id, expectedGameVersion: state.version,
      commandId: 'M2-REGIME-ARDEN-SCHEDULER-1', idempotencyKey: 'M2-REGIME-ARDEN-SCHEDULER-K1' }))
      .toMatchObject({ status: 'REQUIRES_CHOICE', resultCode: 'M2_EFFECT_CHOICE_REQUESTED' });
    const pending = testHarness.store.snapshot(state.id)!; const continuationId = pending.m2EffectChoice?.id;
    if (continuationId === undefined) throw new Error('Arden regime choice missing');
    const payload = { continuationId, selections: { REMOVE_MALIGN: ['ARDEN_PD_1|FLUMA'] } };
    const beforeForgery = structuredClone(pending);
    expect(testHarness.app.execute('session-p2', command('SUBMIT_M2_EFFECT_CHOICE', state.id, pending.version, payload,
      { commandId: 'M2-REGIME-ARDEN-FORGED-1', idempotencyKey: 'M2-REGIME-ARDEN-FORGED-K1' })))
      .toMatchObject({ status: 'REJECTED', error: { code: 'NOT_AUTHORIZED' } });
    expect(testHarness.store.snapshot(state.id)).toEqual(beforeForgery);
    expect(testHarness.app.execute('session-p1', command('SUBMIT_M2_EFFECT_CHOICE', state.id, pending.version, payload,
      { commandId: 'M2-REGIME-ARDEN-CHOICE-1', idempotencyKey: 'M2-REGIME-ARDEN-CHOICE-K1' })))
      .toMatchObject({ status: 'RESOLVED', resultCode: 'M2_EFFECT_CHOICE_RESOLVED' });
    expect(testHarness.store.snapshot(state.id)!.adjudication.influenceStacks.find(({ pdId, type }) =>
      pdId === 'ARDEN_PD_1' && type === 'MALIGN')?.count).toBe(0);
    expect(testHarness.random.cursor).toBe(1);
  });

  it('suspends Arden for an authenticated manual regime die and replays the completed continuation without RNG', () => {
    const testHarness = adjudicationHarness({ diceMode: 'MANUAL_DIE_INPUT' });
    const initial = testHarness.store.snapshot(GAME_ID)!; const initialEventCount = initial.events.length;
    const state = structuredClone(initial);
    state.initiative.orderParticipantIds.splice(0, state.initiative.orderParticipantIds.length, 'P1');
    state.actionPlanning.P1!.lockedSlots.splice(0, state.actionPlanning.P1!.lockedSlots.length, {
      sequenceIndex: 1, actionType: 'USE_REGIME_ABILITY', actionPayload: {}, apCost: 1, revealed: false,
    });
    const stack = state.adjudication.influenceStacks.find(({ pdId, type }) => pdId === 'ARDEN_PD_1' && type === 'MALIGN');
    if (stack === undefined) state.adjudication.influenceStacks.push({ pdId: 'ARDEN_PD_1', type: 'MALIGN', attributionCountryId: 'FLUMA', count: 1 });
    else { stack.count = 1; Object.assign(stack, { attributionCountryId: 'FLUMA' }); }
    state.adjudication.scheduler.participantIndex = 0; state.adjudication.scheduler.slotIndex = 0; state.adjudication.scheduler.status = 'READY';
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    const cursorBefore = testHarness.random.cursor;
    expect(testHarness.engine.runNext({ gameId: state.id, expectedGameVersion: state.version,
      commandId: 'M2-REGIME-MANUAL-1', idempotencyKey: 'M2-REGIME-MANUAL-K1' }))
      .toMatchObject({ status: 'REQUIRES_CHOICE', resultCode: 'MANUAL_DIE_REQUIRED' });
    const waiting = testHarness.store.snapshot(state.id)!; const pending = waiting.adjudication.pendingResolution;
    if (pending?.kind !== 'REGIME_MANUAL_DIE') throw new Error('Regime manual die request missing');
    const manualInput = (sessionSuffix: string, value: number) => ({
      engineContractVersion: waiting.versions.engineContractVersion, commandId: `M2-REGIME-MANUAL-${sessionSuffix}`,
      idempotencyKey: `M2-REGIME-MANUAL-${sessionSuffix}`, gameId: waiting.id, expectedGameVersion: waiting.version,
      commandType: 'SUBMIT_MANUAL_DIE' as const, payloadSchemaVersion: waiting.versions.fixtureSchemaVersion,
      payload: { requestId: pending.request.requestId, value }, correlationId: 'M2-REGIME-MANUAL',
    });
    expect(testHarness.app.executeM1Interaction('session-p2', manualInput('FORGED', 4)))
      .toMatchObject({ status: 'REJECTED', error: { code: 'CHOICE_NOT_AUTHORIZED' } });
    expect(testHarness.store.snapshot(state.id)).toEqual(waiting);
    expect(testHarness.app.executeM1Interaction('session-p1', manualInput('VALID', 4)))
      .toMatchObject({ status: 'REQUIRES_CHOICE', resultCode: 'M2_EFFECT_CHOICE_REQUESTED' });
    const choosing = testHarness.store.snapshot(state.id)!; const continuationId = choosing.m2EffectChoice?.id;
    if (continuationId === undefined) throw new Error('Regime choice missing after manual die');
    expect(testHarness.app.execute('session-p1', command('SUBMIT_M2_EFFECT_CHOICE', state.id, choosing.version, {
      continuationId, selections: { REMOVE_MALIGN: ['ARDEN_PD_1|FLUMA'] },
    }, { commandId: 'M2-REGIME-MANUAL-CHOICE', idempotencyKey: 'M2-REGIME-MANUAL-CHOICE-K' })))
      .toMatchObject({ status: 'RESOLVED', resultCode: 'M2_EFFECT_CHOICE_RESOLVED' });
    const resolved = testHarness.store.snapshot(state.id)!;
    expect(resolved.adjudication.dieRolls.at(-1)).toMatchObject({ source: 'REGIME_ABILITY', rawValue: 4, manual: true,
      submittedByParticipantId: 'P1' });
    expect(resolved.actionPlanning.P1!.lockedSlots[0]).toMatchObject({ terminalOutcome: 'RESOLVED' });
    expect(testHarness.random.cursor).toBe(cursorBefore);
    const replayBase = structuredClone(state); replayBase.events.splice(initialEventCount); replayBase.version = state.version;
    const replayed = replayM1Events(createM1StateSnapshot(replayBase), createM1ReplayBundle(
      resolved.events.slice(initialEventCount), resolved.adjudication.traces,
    ));
    expect(canonicalizeJson(replayed)).toBe(canonicalizeJson(resolved));
  });

  it('opens each later Fluma spend trigger from the internal scheduler and resolves it only through Fluma authentication', () => {
    const testHarness=adjudicationHarness(); const state=testHarness.store.snapshot(GAME_ID)!;
    state.regimeAbilityUsedByParticipant??={}; state.regimeAbilityUsedByParticipant.P2=true;
    state.flumaRegimeByParticipant??={}; state.flumaRegimeByParticipant.P2={active:true,processedSpendIds:[]};
    state.m2TurnResourceLedgerStartIndex=state.resourceLedger.length;
    state.resourceLedger.push({id:'FLUMA-FORWARD-SPEND-1',participantId:'P1',countryId:'ARDEN',reason:'CARD_COST',delta:-2,
      balanceAfter:state.countries.ARDEN.resources-2,gameVersion:state.version});
    state.countries.ARDEN.resources-=2;
    state.adjudication.scheduler.participantIndex=state.initiative.orderParticipantIds.length;
    state.adjudication.scheduler.slotIndex=0; state.adjudication.scheduler.status='COMPLETE';
    expect(testHarness.store.commitState(state.id,state.version,state)).toBe(true);
    expect(testHarness.engine.runNext({gameId:state.id,expectedGameVersion:state.version,commandId:'FLUMA-FORWARD-1',
      idempotencyKey:'FLUMA-FORWARD-K1'})).toMatchObject({status:'REQUIRES_CHOICE',resultCode:'M2_EFFECT_CHOICE_REQUESTED'});
    const choosing=testHarness.store.snapshot(state.id)!; const continuation=choosing.m2EffectChoice;
    if(continuation?.kind!=='M2_EFFECT_GROUPED_CHOICE')throw new Error('Fluma forward continuation missing');
    expect(continuation.groups.map(({groupId})=>groupId)).toEqual(['SPEND|FLUMA-FORWARD-SPEND-1|1','SPEND|FLUMA-FORWARD-SPEND-1|2']);
    const selections=Object.fromEntries(continuation.groups.map(({groupId})=>[groupId,['ARDEN_PD_1']]));
    expect(testHarness.app.execute('session-p1',command('SUBMIT_M2_EFFECT_CHOICE',state.id,choosing.version,
      {continuationId:continuation.id,selections},{commandId:'FLUMA-FORWARD-FORGED',idempotencyKey:'FLUMA-FORWARD-FORGED-K'})))
      .toMatchObject({status:'REJECTED',error:{code:'NOT_AUTHORIZED'}});
    expect(testHarness.app.execute('session-p2',command('SUBMIT_M2_EFFECT_CHOICE',state.id,choosing.version,
      {continuationId:continuation.id,selections},{commandId:'FLUMA-FORWARD-CHOICE',idempotencyKey:'FLUMA-FORWARD-CHOICE-K'})))
      .toMatchObject({status:'RESOLVED',resultCode:'M2_EFFECT_CHOICE_RESOLVED'});
    const resolved=testHarness.store.snapshot(state.id)!;
    expect(resolved.flumaRegimeByParticipant?.P2).toEqual({active:true,processedSpendIds:['FLUMA-FORWARD-SPEND-1']});
    expect(resolved.adjudication.influenceStacks.find(({pdId,type,attributionCountryId})=>pdId==='ARDEN_PD_1'&&type==='MALIGN'&&
      attributionCountryId==='FLUMA')?.count??0).toBe(0);
    expect(resolved.adjudication.influenceStacks.find(({pdId,type})=>pdId==='ARDEN_PD_1'&&type==='RESILIENCY')?.count).toBe(0);
    expect(resolved.m2Audit?.filter(({type})=>type==='FLUMA_SPEND_TRIGGER_RESOLVED')).toHaveLength(2);
    expect(resolved.adjudication.scheduler.status).toBe('COMPLETE');
    expect(testHarness.engine.runNext({gameId:state.id,expectedGameVersion:resolved.version,commandId:'FLUMA-FORWARD-2',
      idempotencyKey:'FLUMA-FORWARD-K2'})).toMatchObject({status:'REJECTED',error:{code:'SCHEDULER_COMPLETE'}});
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
    expect(M2_IMPLEMENTED_EFFECT_IDS).toHaveLength(42);
    expect(M2_EVENT_DRIVEN_EFFECT_IDS).toEqual([
      'CARD_EFFECT_BASE_2025_E033', 'CARD_EFFECT_BASE_2025_E010', 'CARD_EFFECT_BASE_2025_E012',
      'CARD_EFFECT_BASE_2025_E022', 'CARD_EFFECT_BASE_2025_E036', 'CARD_EFFECT_BASE_2025_E040',
      'CARD_EFFECT_BASE_2025_E054', 'CARD_EFFECT_BASE_2025_E016', 'CARD_EFFECT_BASE_2025_E047',
      'CARD_EFFECT_BASE_2025_E006', 'CARD_EFFECT_BASE_2025_E013',
      'CARD_EFFECT_BASE_2025_E031',
      'CARD_EFFECT_BASE_2025_E045',
      'CARD_EFFECT_BASE_2025_E035',
      'CARD_EFFECT_BASE_2025_E053',
      'CARD_EFFECT_BASE_2025_E048',
      'CARD_EFFECT_BASE_2025_E021',
      'CARD_EFFECT_BASE_2025_E050',
    ]);
    const manifestHarness = harness(); const manifestState = completeAndStart(manifestHarness);
    M2_PAIR_BONUS_EFFECT_IDS.forEach((effectId, index) => {
      const pair = BASE_2025_PAIR_BONUSES[index]!;
      const result = new M2BEffectDispatcher('M2-3').dispatch(buildM2StateFromCanonical(manifestState), {
        actorParticipantId: 'P1', effectId, effectVersion: '0.1', parameters: { definitionIds: pair },
      });
      expect(result).toMatchObject({ ok: true, emitted: [{ type: 'REGISTERED_PAIR_BONUS_CALCULATED', payload: { amount: 2 } }] });
    });
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
    const source = state.cards['ARDEN-CARD-042']!; source.controllerParticipantId = 'P1'; source.zone = 'HAND';
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    const before = testHarness.store.snapshot(state.id);
    expect(testHarness.dispatcher.executeM2Effect({
      gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-EFFECT-DISABLED-1', idempotencyKey: 'M2-EFFECT-DISABLED-K1',
      actorParticipantId: 'P1', sourceCardInstanceId: source.id, effectId: 'CARD_EFFECT_BASE_2025_E021', effectVersion: '0.1', parameters: {},
    })).toMatchObject({ status: 'REJECTED', error: { code: 'EFFECT_DISABLED' } });
    expect(testHarness.store.snapshot(state.id)).toEqual(before);
  });

  it('resolves E021 through one durable voluntary response per other active player and applies committed contributors to effective CV', () => {
    const testHarness = adjudicationHarness({ serials: [FULL_CAMPAIGN.intent.serial, FULL_CAMPAIGN.method.serial, 42] });
    runConstruct(testHarness);
    const seeded = testHarness.store.snapshot(GAME_ID)!; seeded.countries.URSARIA.resources = 0;
    expect(testHarness.store.commitState(GAME_ID, seeded.version, seeded)).toBe(true);
    const replayBase = testHarness.store.snapshot(GAME_ID)!; const replayBaseEventCount = replayBase.events.length;
    expect(runActivation(testHarness)).toMatchObject({ status: 'REQUIRES_CHOICE', resultCode: 'COALITION_CONTRIBUTION_REQUIRED' });
    let current = testHarness.store.snapshot(GAME_ID)!; const pending = current.adjudication.pendingResolution;
    expect(pending).toMatchObject({ kind: 'COALITION', request: { sourceParticipantId: 'P1', eligibleParticipantIds: ['P2', 'P3', 'P4', 'P5'] } });
    if (pending?.kind !== 'COALITION') throw new Error('E021 coalition continuation missing');
    const requestId = pending.request.requestId; const baseEffectiveCv = pending.continuation.effectiveCv;
    const resourcesBefore = Object.fromEntries(Object.entries(current.seats).filter(([id]) => id !== 'F1').map(([id, seat]) => [id, current.countries[seat.countryId].resources]));
    const submit = (participantId: string, decision: 'CONTRIBUTE' | 'DECLINE', suffix: string) => testHarness.app.executeM1Interaction(`session-${participantId.toLowerCase()}`, {
      engineContractVersion: current.versions.engineContractVersion, commandId: `E021-${suffix}`, idempotencyKey: `E021-${suffix}`,
      gameId: GAME_ID, expectedGameVersion: current.version, commandType: 'SUBMIT_COALITION_CONTRIBUTION',
      payloadSchemaVersion: current.versions.fixtureSchemaVersion, payload: { requestId, decision },
    });
    const beforeOwnerAttempt = structuredClone(current);
    expect(submit('P1', 'CONTRIBUTE', 'OWNER')).toMatchObject({ status: 'REJECTED', error: { code: 'CHOICE_NOT_AUTHORIZED' } });
    expect(testHarness.store.snapshot(GAME_ID)).toEqual(beforeOwnerAttempt);
    const first = submit('P2', 'CONTRIBUTE', 'P2'); expect(first).toMatchObject({ status: 'RESOLVED', resultCode: 'COALITION_RESPONSE_COMMITTED' });
    current = testHarness.store.snapshot(GAME_ID)!;
    expect(testHarness.app.executeM1Interaction('session-p2', {
      engineContractVersion: current.versions.engineContractVersion, commandId: 'E021-P2', idempotencyKey: 'E021-P2', gameId: GAME_ID,
      expectedGameVersion: first.gameVersionBefore, commandType: 'SUBMIT_COALITION_CONTRIBUTION', payloadSchemaVersion: current.versions.fixtureSchemaVersion,
      payload: { requestId, decision: 'CONTRIBUTE' },
    })).toEqual(first);
    const beforeDuplicate = structuredClone(current);
    expect(submit('P2', 'CONTRIBUTE', 'P2-DUPLICATE')).toMatchObject({ status: 'REJECTED', error: { code: 'CHOICE_ALREADY_RESOLVED' } });
    expect(testHarness.store.snapshot(GAME_ID)).toEqual(beforeDuplicate);
    const beforeInsufficient = structuredClone(current);
    expect(submit('P3', 'CONTRIBUTE', 'P3-INSUFFICIENT')).toMatchObject({ status: 'REJECTED', error: { code: 'COST_PAYMENT_FAILED' } });
    expect(testHarness.store.snapshot(GAME_ID)).toEqual(beforeInsufficient);
    for (const [participantId, decision] of [['P3', 'DECLINE'], ['P4', 'CONTRIBUTE'], ['P5', 'DECLINE']] as const) {
      current = testHarness.store.snapshot(GAME_ID)!;
      expect(submit(participantId, decision, participantId)).toMatchObject({ status: 'RESOLVED' });
    }
    current = testHarness.store.snapshot(GAME_ID)!; const trace = current.adjudication.traces.at(-1)!;
    expect(trace.effectiveCv).toBe(baseEffectiveCv + 2);
    expect(current.countries.FLUMA.resources).toBe(resourcesBefore.P2! - 1);
    expect(current.countries.PRESQUE.resources).toBe(resourcesBefore.P4! - 1);
    expect(current.resourceLedger.filter(({ reason }) => reason === 'COALITION_CONTRIBUTION')).toHaveLength(2);
    expect(current.adjudication.pendingResolution).toBeUndefined();
    expect(canonicalizeJson(replayM1Events(createM1StateSnapshot(replayBase), createM1ReplayBundle(
      current.events.slice(replayBaseEventCount), current.adjudication.traces,
    )))).toBe(canonicalizeJson(current));
  });

  it('GE-ACT-027 — resolves planned E050 for one AP at ON_CAMPAIGN_ROLL and preserves raw versus modified roll', () => {
    const testHarness = adjudicationHarness({ boost: true, die: 10 });
    const replayBase = testHarness.store.snapshot(GAME_ID)!; const replayBaseEventCount = replayBase.events.length;
    runConstruct(testHarness);
    expect(runActivation(testHarness)).toMatchObject({ status: 'RESOLVED', resultCode: 'BOOST_PLANNED' });
    const planned = testHarness.store.snapshot(GAME_ID)!;
    expect(planned.adjudication.plannedBoostsByParticipant?.P1).toMatchObject({ cardInstanceId: 'ARDEN-CARD-087', activationSequenceIndex: 3 });
    expect(runActivation(testHarness)).toMatchObject({ status: 'RESOLVED', resultCode: 'CAMPAIGN_ACTIVATION_COMPLETED' });
    const committed = testHarness.store.snapshot(GAME_ID)!; const trace = committed.adjudication.traces.at(-1)!;
    expect(trace).toMatchObject({ rawRoll: 10, modifiedRollRaw: 11, ertRoll: 10 });
    expect(committed.cards['ARDEN-CARD-087']?.zone).toBe('DISCARD');
    expect(committed.strategy.P1.discardCardInstanceIds).toContain('ARDEN-CARD-087');
    expect(committed.adjudication.plannedBoostsByParticipant?.P1).toBeUndefined();
    expect(committed.events.find(({ type }) => type === 'BOOST_APPLIED')?.payload).toMatchObject({ modifier: 1 });
    expect(canonicalizeJson(replayM1Events(createM1StateSnapshot(replayBase), createM1ReplayBundle(
      committed.events.slice(replayBaseEventCount), committed.adjudication.traces,
    )))).toBe(canonicalizeJson(committed));
  });

  it('executes fixed registry resource effects and honors remove-from-game lifecycle', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
    const source = state.cards['ARDEN-CARD-075']!; source.controllerParticipantId = 'P1'; source.zone = 'HAND';
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    const resourcesBefore = state.countries.ARDEN.resources;
    expect(testHarness.dispatcher.executeM2Effect({
      gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-EFFECT-GAIN-1', idempotencyKey: 'M2-EFFECT-GAIN-K1',
      actorParticipantId: 'P1', sourceCardInstanceId: source.id, effectId: 'CARD_EFFECT_BASE_2025_E042', effectVersion: '0.1', parameters: {},
    })).toMatchObject({ status: 'RESOLVED', resultCode: 'M2_EFFECT_EXECUTED' });
    expect(testHarness.store.snapshot(state.id)).toMatchObject({
      countries: { ARDEN: { resources: resourcesBefore + 4 } },
      cards: { [source.id]: { zone: 'REMOVED_FROM_GAME' } },
    });
  });

  it('GE-ACT-022 — rolls internally for every other player and transfers only on results at most four', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
    testHarness.random.enqueue(1,4,5,10); testHarness.random.requireScript();
    const source = state.cards['ARDEN-CARD-081']!; source.controllerParticipantId = 'P1'; source.zone = 'HAND';
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    const before = Object.fromEntries(Object.entries(state.countries).map(([id, country]) => [id, country.resources]));
    expect(testHarness.dispatcher.executeM2Effect({
      gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-E046-1', idempotencyKey: 'M2-E046-K1',
      actorParticipantId: 'P1', sourceCardInstanceId: source.id, effectId: 'CARD_EFFECT_BASE_2025_E046', effectVersion: '0.1',
      parameters: { rollsByParticipant: { P2: 10, P3: 10, P4: 10, P5: 10 } },
    })).toMatchObject({ status: 'RESOLVED' });
    const committed = testHarness.store.snapshot(state.id)!;
    expect(committed.countries.ARDEN.resources).toBe(before.ARDEN! + 2);
    expect(committed.countries.FLUMA.resources).toBe(before.FLUMA! - 1);
    expect(committed.countries.URSARIA.resources).toBe(before.URSARIA! - 1);
    expect(committed.countries.PRESQUE.resources).toBe(before.PRESQUE!);
    expect(committed.countries.DINESIA.resources).toBe(before.DINESIA!);
    expect(committed.cards[source.id]?.zone).toBe('DISCARD');
    expect(testHarness.random.requests.slice(-4)).toEqual(Array.from({ length: 4 }, () => ({ minInclusive: 1, maxInclusive: 10 })));
    expect(committed.m2Audit?.slice(-8).map(({ type }) => type)).toEqual([
      'DIE_ROLLED', 'DIE_ROLLED', 'DIE_ROLLED', 'DIE_ROLLED',
      'RESOURCE_TRANSFERRED', 'RESOURCE_TRANSFERRED',
    ]);
  });

  it('GE-ACT-023 — E046 records a passing roll for a zero-resource target without going negative', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
    testHarness.random.enqueue(1,5,5,5); testHarness.random.requireScript();
    const source = state.cards['ARDEN-CARD-081']!; source.controllerParticipantId = 'P1'; source.zone = 'HAND';
    state.countries.FLUMA.resources = 0;
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    const before = testHarness.store.snapshot(state.id)!;
    expect(testHarness.dispatcher.executeM2Effect({
      gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-E046-FAIL-1', idempotencyKey: 'M2-E046-FAIL-K1',
      actorParticipantId: 'P1', sourceCardInstanceId: source.id, effectId: 'CARD_EFFECT_BASE_2025_E046', effectVersion: '0.1', parameters: {},
    })).toMatchObject({ status: 'RESOLVED' });
    const committed=testHarness.store.snapshot(state.id)!;
    expect(committed.countries.FLUMA.resources).toBe(0);
    expect(committed.countries.ARDEN.resources).toBe(before.countries.ARDEN.resources);
    expect(committed.m2Audit?.filter(({type})=>type==='DIE_ROLLED')).toHaveLength(4);
    expect(committed.m2Audit?.filter(({type})=>type==='RESOURCE_TRANSFERRED')).toHaveLength(0);
    expect(testHarness.random.cursor).toBe(4);
  });

  it('GE-ACT-018 — selects E028 review cards with authoritative RNG and leaves the target hand unchanged', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
    const source = state.cards['ARDEN-CARD-056']!; source.controllerParticipantId = 'P1'; source.zone = 'HAND';
    for (const cardId of ['FLUMA-CARD-001', 'FLUMA-CARD-002', 'FLUMA-CARD-003']) {
      const card = state.cards[cardId]!; card.controllerParticipantId = 'P2'; card.zone = 'HAND';
      state.strategy.P2.handCardInstanceIds.push(cardId);
    }
    const targetHandBefore = [...state.strategy.P2.handCardInstanceIds].sort();
    expect(targetHandBefore.length).toBeGreaterThanOrEqual(3);
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(testHarness.dispatcher.executeM2Effect({
      gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-E028-1', idempotencyKey: 'M2-E028-K1',
      actorParticipantId: 'P1', sourceCardInstanceId: source.id, effectId: 'CARD_EFFECT_BASE_2025_E028', effectVersion: '0.1',
      parameters: { targetParticipantId: 'P2', selectedCardIds: ['FORGED-CARD-ID'] },
    })).toMatchObject({ status: 'RESOLVED' });
    const committed = testHarness.store.snapshot(state.id)!;
    expect(committed.strategy.P2.handCardInstanceIds.sort()).toEqual(targetHandBefore);
    expect(committed.cards[source.id]?.zone).toBe('DISCARD');
    expect(committed.m2Audit?.slice(-3).map(({ type }) => type)).toEqual(['CARD_REVEALED', 'CARD_REVEALED', 'CARD_REVEALED']);
    expect(new Set(committed.m2Audit?.slice(-3).map(({ payload }) => payload.cardId)).size).toBe(3);
    expect(testHarness.random.requests.slice(-3)).toEqual([
      { minInclusive: 0, maxInclusive: targetHandBefore.length - 1 },
      { minInclusive: 0, maxInclusive: targetHandBefore.length - 2 },
      { minInclusive: 0, maxInclusive: targetHandBefore.length - 3 },
    ]);
  });

  it('GE-ACT-009 — resolves E016 by hidden hand position without leaking card identities', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
    const source = state.cards['ARDEN-CARD-031']!; source.controllerParticipantId = 'P1'; source.zone = 'HAND';
    const selected = state.cards['FLUMA-CARD-001']!; selected.controllerParticipantId = 'P2'; selected.zone = 'HAND';
    state.strategy.P2.handCardInstanceIds.push(selected.id);
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(testHarness.dispatcher.executeM2Effect({
      gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-E016-OPEN-1', idempotencyKey: 'M2-E016-OPEN-K1',
      actorParticipantId: 'P1', sourceCardInstanceId: source.id, effectId: 'CARD_EFFECT_BASE_2025_E016', effectVersion: '0.1',
      parameters: { targetParticipantId: 'P2' },
    })).toMatchObject({ status: 'RESOLVED', resultCode: 'M2_EFFECT_CHOICE_REQUESTED' });
    const opened = testHarness.store.snapshot(state.id)!; const continuationId = opened.m2EffectChoice!.id;
    const p1 = trustedBindings().find(({ participantId }) => participantId === 'P1')!.authenticatedSessionId;
    const p3 = trustedBindings().find(({ participantId }) => participantId === 'P3')!.authenticatedSessionId;
    expect(testHarness.app.getGameProjection(p1, state.id)).toMatchObject({ ok: true, projection: { m2EffectChoice: { optionCount: 1 } } });
    expect((testHarness.app.getGameProjection(p1,state.id) as {projection:{m2EffectChoice:unknown}}).projection.m2EffectChoice).not.toHaveProperty('optionCardIds');
    expect((testHarness.app.getGameProjection(p3, state.id) as { projection: { m2EffectChoice: unknown } }).projection.m2EffectChoice).not.toHaveProperty('optionCardIds');
    expect(testHarness.app.execute(p1, command('SUBMIT_M2_EFFECT_CHOICE', state.id, opened.version, {
      continuationId, selectedPosition: 1,
    }, { commandId: 'M2-E016-RESOLVE-1', idempotencyKey: 'M2-E016-RESOLVE-K1' }))).toMatchObject({ status: 'RESOLVED' });
    const committed = testHarness.store.snapshot(state.id)!;
    expect(committed.m2EffectChoice).toBeUndefined();
    expect(committed.cards[selected.id]).toMatchObject({ zone: 'HAND', controllerParticipantId: 'P1', returnToOwnerOnDiscard: true });
    expect(committed.cards[source.id]?.zone).toBe('DISCARD');
  });

  it('GE-ACT-010 — a stolen Starter resolves for its controller and is removed from the game',()=>{
    const testHarness=harness();const state=completeAndStart(testHarness);state.phase='RESOLUTION_STAGE';
    const source=state.cards['ARDEN-CARD-031']!;source.controllerParticipantId='P1';source.zone='HAND';
    const starter=Object.values(state.cards).find(card=>card.definitionId==='BASE_CARD_075'&&card.countryOwnerId!=='ARDEN');
    if(starter===undefined)throw new Error('Increased Budget Starter fixture missing');
    const targetParticipantId=state.countries[starter.countryOwnerId].controllerParticipantId!;
    for(const card of Object.values(state.cards).filter(({controllerParticipantId,zone,id})=>controllerParticipantId===targetParticipantId&&zone==='HAND'&&id!==starter.id))card.zone='OPERATIONS_DECK';
    starter.controllerParticipantId=targetParticipantId;starter.zone='HAND';state.strategy[targetParticipantId]!.handCardInstanceIds=[starter.id];
    expect(testHarness.store.commitState(state.id,state.version,state)).toBe(true);
    expect(testHarness.dispatcher.executeM2Effect({gameId:state.id,expectedGameVersion:state.version,
      commandId:'M2-E016-STARTER-OPEN-1',idempotencyKey:'M2-E016-STARTER-OPEN-K1',actorParticipantId:'P1',
      sourceCardInstanceId:source.id,effectId:'CARD_EFFECT_BASE_2025_E016',effectVersion:'0.1',parameters:{targetParticipantId},
    })).toMatchObject({status:'RESOLVED',resultCode:'M2_EFFECT_CHOICE_REQUESTED'});
    let current=testHarness.store.snapshot(state.id)!;const p1=trustedBindings().find(({participantId})=>participantId==='P1')!.authenticatedSessionId;
    expect(testHarness.app.execute(p1,command('SUBMIT_M2_EFFECT_CHOICE',state.id,current.version,{
      continuationId:current.m2EffectChoice!.id,selectedPosition:1,
    },{commandId:'M2-E016-STARTER-STEAL-1',idempotencyKey:'M2-E016-STARTER-STEAL-K1'}))).toMatchObject({status:'RESOLVED'});
    current=testHarness.store.snapshot(state.id)!;const resourcesBefore=current.countries.ARDEN.resources;
    expect(testHarness.dispatcher.executeM2CoreOperation({gameId:state.id,expectedGameVersion:current.version,
      commandId:'M2-STARTER-PLAY-1',idempotencyKey:'M2-STARTER-PLAY-K1',operation:{kind:'PLAY_STARTER',actorParticipantId:'P1',cardId:starter.id},
    })).toMatchObject({status:'RESOLVED'});
    const committed=testHarness.store.snapshot(state.id)!;
    expect(committed.countries.ARDEN.resources).toBe(resourcesBefore+4);
    expect(committed.cards[starter.id]).toMatchObject({zone:'REMOVED_FROM_GAME',controllerParticipantId:'P1'});
  });

  it('GE-ACT-011 — discarding a stolen Starter returns it to its owner instead of removing it',()=>{
    const testHarness=harness();const state=completeAndStart(testHarness);state.phase='RESOLUTION_STAGE';
    const thief=state.cards['ARDEN-CARD-031']!;thief.controllerParticipantId='P1';thief.zone='HAND';
    const discardAction=state.cards['ARDEN-CARD-023']!;discardAction.controllerParticipantId='P1';discardAction.zone='HAND';
    const ownDiscard=state.cards['ARDEN-CARD-001']!;ownDiscard.controllerParticipantId='P1';ownDiscard.zone='HAND';
    const starter=Object.values(state.cards).find(card=>card.definitionId==='BASE_CARD_075'&&card.countryOwnerId!=='ARDEN');
    if(starter===undefined)throw new Error('Increased Budget Starter fixture missing');
    const targetParticipantId=state.countries[starter.countryOwnerId].controllerParticipantId!;
    for(const card of Object.values(state.cards).filter(({controllerParticipantId,zone,id})=>controllerParticipantId===targetParticipantId&&zone==='HAND'&&id!==starter.id))card.zone='OPERATIONS_DECK';
    starter.controllerParticipantId=targetParticipantId;starter.zone='HAND';state.strategy[targetParticipantId]!.handCardInstanceIds=[starter.id];
    state.strategy.P1.handCardInstanceIds=[thief.id,discardAction.id,ownDiscard.id];
    expect(testHarness.store.commitState(state.id,state.version,state)).toBe(true);
    expect(testHarness.dispatcher.executeM2Effect({gameId:state.id,expectedGameVersion:state.version,
      commandId:'M2-E016-RETURN-OPEN-1',idempotencyKey:'M2-E016-RETURN-OPEN-K1',actorParticipantId:'P1',
      sourceCardInstanceId:thief.id,effectId:'CARD_EFFECT_BASE_2025_E016',effectVersion:'0.1',parameters:{targetParticipantId},
    })).toMatchObject({status:'RESOLVED'});
    let current=testHarness.store.snapshot(state.id)!;const p1=trustedBindings().find(({participantId})=>participantId==='P1')!.authenticatedSessionId;
    expect(testHarness.app.execute(p1,command('SUBMIT_M2_EFFECT_CHOICE',state.id,current.version,{
      continuationId:current.m2EffectChoice!.id,selectedPosition:1,
    },{commandId:'M2-E016-RETURN-STEAL-1',idempotencyKey:'M2-E016-RETURN-STEAL-K1'}))).toMatchObject({status:'RESOLVED'});
    current=testHarness.store.snapshot(state.id)!;
    expect(testHarness.dispatcher.executeM2Effect({gameId:state.id,expectedGameVersion:current.version,
      commandId:'M2-E013-RETURN-OPEN-1',idempotencyKey:'M2-E013-RETURN-OPEN-K1',actorParticipantId:'P1',
      sourceCardInstanceId:discardAction.id,effectId:'CARD_EFFECT_BASE_2025_E013',effectVersion:'0.1',parameters:{},
    })).toMatchObject({status:'RESOLVED',resultCode:'M2_EFFECT_CHOICE_REQUESTED'});
    current=testHarness.store.snapshot(state.id)!;
    expect(testHarness.app.execute(p1,command('SUBMIT_M2_EFFECT_CHOICE',state.id,current.version,{
      continuationId:current.m2EffectChoice!.id,
      selections:{DISCARD_FROM_HAND:[starter.id,ownDiscard.id],RETRIEVE_FROM_DISCARD:[thief.id]},
    },{commandId:'M2-E013-RETURN-RESOLVE-1',idempotencyKey:'M2-E013-RETURN-RESOLVE-K1'}))).toMatchObject({status:'RESOLVED'});
    const committed=testHarness.store.snapshot(state.id)!;
    expect(committed.cards[starter.id]).toMatchObject({zone:'HAND',controllerParticipantId:targetParticipantId,returnToOwnerOnDiscard:false});
    expect(committed.strategy[targetParticipantId]?.handCardInstanceIds).toContain(starter.id);
    expect(committed.cards[thief.id]).toMatchObject({zone:'HAND',controllerParticipantId:'P1'});
  });

  it('GE-ACT-024 — uses internal E047 roll then requires the targeted player to choose the discarded action card', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
    const source = state.cards['ARDEN-CARD-082']!; source.controllerParticipantId = 'P1'; source.zone = 'HAND';
    const selected = state.cards['FLUMA-CARD-001']!; selected.controllerParticipantId = 'P2'; selected.zone = 'HAND';
    state.strategy.P2.handCardInstanceIds.push(selected.id);
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(testHarness.dispatcher.executeM2Effect({
      gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-E047-OPEN-1', idempotencyKey: 'M2-E047-OPEN-K1',
      actorParticipantId: 'P1', sourceCardInstanceId: source.id, effectId: 'CARD_EFFECT_BASE_2025_E047', effectVersion: '0.1',
      parameters: { targetParticipantId: 'P2', roll: 10 },
    })).toMatchObject({ status: 'RESOLVED', resultCode: 'M2_EFFECT_CHOICE_REQUESTED' });
    const opened = testHarness.store.snapshot(state.id)!; const continuationId = opened.m2EffectChoice!.id;
    expect(opened.m2EffectChoice?.roll).toBe(1);
    const p1 = trustedBindings().find(({ participantId }) => participantId === 'P1')!.authenticatedSessionId;
    const p2 = trustedBindings().find(({ participantId }) => participantId === 'P2')!.authenticatedSessionId;
    expect(testHarness.app.execute(p1, command('SUBMIT_M2_EFFECT_CHOICE', state.id, opened.version, {
      continuationId, selectedCardId: selected.id,
    }))).toMatchObject({ status: 'REJECTED', error: { code: 'NOT_AUTHORIZED' } });
    expect(testHarness.app.execute(p2, command('SUBMIT_M2_EFFECT_CHOICE', state.id, opened.version, {
      continuationId, selectedCardId: selected.id,
    }, { commandId: 'M2-E047-RESOLVE-1', idempotencyKey: 'M2-E047-RESOLVE-K1' }))).toMatchObject({ status: 'RESOLVED' });
    const committed = testHarness.store.snapshot(state.id)!;
    expect(committed.cards[selected.id]?.zone).toBe('DISCARD');
    expect(committed.cards[source.id]?.zone).toBe('DISCARD');
    expect(testHarness.random.requests.at(-1)).toEqual({ minInclusive: 1, maxInclusive: 10 });
  });

  it('GE-ACT-025 — E047 succeeds without a choice when the target has no Action card', () => {
    const testHarness=harness();testHarness.random.enqueue(6);testHarness.random.requireScript();
    const state=completeAndStart(testHarness);state.phase='RESOLUTION_STAGE';
    const source=state.cards['ARDEN-CARD-082']!;source.controllerParticipantId='P1';source.zone='HAND';
    for(const card of Object.values(state.cards).filter(({controllerParticipantId,zone})=>controllerParticipantId==='P2'&&zone==='HAND'))
      card.cardClass='STARTER';
    expect(testHarness.store.commitState(state.id,state.version,state)).toBe(true);
    expect(testHarness.dispatcher.executeM2Effect({gameId:state.id,expectedGameVersion:state.version,
      commandId:'M2-E047-NO-ACTION-1',idempotencyKey:'M2-E047-NO-ACTION-K1',actorParticipantId:'P1',
      sourceCardInstanceId:source.id,effectId:'CARD_EFFECT_BASE_2025_E047',effectVersion:'0.1',parameters:{targetParticipantId:'P2'},
    })).toMatchObject({status:'RESOLVED',resultCode:'M2_EFFECT_EXECUTED',resultPayload:{roll:6,choiceRequired:false}});
    const committed=testHarness.store.snapshot(state.id)!;
    expect(committed.m2EffectChoice).toBeUndefined();expect(committed.cards[source.id]?.zone).toBe('DISCARD');
    expect(committed.m2Audit?.at(-1)).toMatchObject({type:'DIE_ROLLED',payload:{rawValue:6}});
  });

  it('GE-ACT-026 — E047 failure consumes the source and never opens a choice', () => {
    const testHarness=harness();testHarness.random.enqueue(7);testHarness.random.requireScript();
    const state=completeAndStart(testHarness);state.phase='RESOLUTION_STAGE';
    const source=state.cards['ARDEN-CARD-082']!;source.controllerParticipantId='P1';source.zone='HAND';
    expect(testHarness.store.commitState(state.id,state.version,state)).toBe(true);
    expect(testHarness.dispatcher.executeM2Effect({gameId:state.id,expectedGameVersion:state.version,
      commandId:'M2-E047-FAIL-1',idempotencyKey:'M2-E047-FAIL-K1',actorParticipantId:'P1',
      sourceCardInstanceId:source.id,effectId:'CARD_EFFECT_BASE_2025_E047',effectVersion:'0.1',parameters:{targetParticipantId:'P2'},
    })).toMatchObject({status:'RESOLVED',resultCode:'M2_EFFECT_EXECUTED',resultPayload:{roll:7,choiceRequired:false}});
    const committed=testHarness.store.snapshot(state.id)!;
    expect(committed.m2EffectChoice).toBeUndefined();expect(committed.cards[source.id]?.zone).toBe('DISCARD');
    expect(committed.m2Audit?.at(-1)).toMatchObject({type:'DIE_ROLLED',payload:{rawValue:7}});
  });

  it('GE-ACT-002 — resolves E006 grouped choice with exact five-card discard and atomic resource payment', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
    const source = state.cards['ARDEN-CARD-012']!; source.controllerParticipantId = 'P1'; source.zone = 'HAND';
    const selectedIds = ['FLUMA-CARD-001', 'FLUMA-CARD-002', 'FLUMA-CARD-003', 'FLUMA-CARD-004', 'FLUMA-CARD-005'];
    for (const id of selectedIds) { const card = state.cards[id]!; card.controllerParticipantId = 'P2'; card.zone = 'HAND'; state.strategy.P2.handCardInstanceIds.push(id); }
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    const resourcesBefore = state.countries.ARDEN.resources;
    expect(testHarness.dispatcher.executeM2Effect({
      gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-E006-OPEN-1', idempotencyKey: 'M2-E006-OPEN-K1',
      actorParticipantId: 'P1', sourceCardInstanceId: source.id, effectId: 'CARD_EFFECT_BASE_2025_E006', effectVersion: '0.1',
      parameters: { targetParticipantId: 'P2' },
    })).toMatchObject({ status: 'RESOLVED', resultCode: 'M2_EFFECT_CHOICE_REQUESTED' });
    const opened = testHarness.store.snapshot(state.id)!; const p1 = trustedBindings().find(({ participantId }) => participantId === 'P1')!.authenticatedSessionId;
    expect(testHarness.app.execute(p1, command('SUBMIT_M2_EFFECT_CHOICE', state.id, opened.version, {
      continuationId: opened.m2EffectChoice!.id, selections: { DISCARD_FROM_TARGET_HAND: selectedIds },
    }, { commandId: 'M2-E006-RESOLVE-1', idempotencyKey: 'M2-E006-RESOLVE-K1' }))).toMatchObject({ status: 'RESOLVED' });
    const committed = testHarness.store.snapshot(state.id)!;
    expect(committed.countries.ARDEN.resources).toBe(resourcesBefore - 1);
    selectedIds.forEach((id) => expect(committed.cards[id]?.zone).toBe('DISCARD'));
    expect(committed.cards[source.id]?.zone).toBe('DISCARD');
  });

  it('GE-ACT-003 — E006 freezes and discards the entire target hand when fewer than five exist', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
    const source = state.cards['ARDEN-CARD-012']!; source.controllerParticipantId = 'P1'; source.zone = 'HAND';
    const selectedIds = ['FLUMA-CARD-001', 'FLUMA-CARD-002', 'FLUMA-CARD-003', 'FLUMA-CARD-004'];
    state.strategy.P2.handCardInstanceIds = [...selectedIds];
    for (const id of selectedIds) { const card = state.cards[id]!; card.controllerParticipantId = 'P2'; card.zone = 'HAND'; }
    for (const card of Object.values(state.cards).filter(({controllerParticipantId,zone,id})=>
      controllerParticipantId==='P2'&&zone==='HAND'&&!selectedIds.includes(id))) card.zone='OPERATIONS_DECK';
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(testHarness.dispatcher.executeM2Effect({
      gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-E006-FOUR-OPEN-1', idempotencyKey: 'M2-E006-FOUR-OPEN-K1',
      actorParticipantId: 'P1', sourceCardInstanceId: source.id, effectId: 'CARD_EFFECT_BASE_2025_E006', effectVersion: '0.1',
      parameters: { targetParticipantId: 'P2' },
    })).toMatchObject({ status: 'RESOLVED', resultCode: 'M2_EFFECT_CHOICE_REQUESTED' });
    const opened=testHarness.store.snapshot(state.id)!; const group=opened.m2EffectChoice?.kind==='M2_EFFECT_GROUPED_CHOICE'?opened.m2EffectChoice.groups[0]:undefined;
    expect(group).toMatchObject({minSelections:4,maxSelections:4,eligibleCardIds:selectedIds});
    const p1=trustedBindings().find(({participantId})=>participantId==='P1')!.authenticatedSessionId;
    expect(testHarness.app.execute(p1,command('SUBMIT_M2_EFFECT_CHOICE',state.id,opened.version,{
      continuationId:opened.m2EffectChoice!.id,selections:{DISCARD_FROM_TARGET_HAND:selectedIds},
    },{commandId:'M2-E006-FOUR-RESOLVE-1',idempotencyKey:'M2-E006-FOUR-RESOLVE-K1'}))).toMatchObject({status:'RESOLVED'});
    const committed=testHarness.store.snapshot(state.id)!;
    selectedIds.forEach(id=>expect(committed.cards[id]?.zone).toBe('DISCARD'));
  });

  it('GE-ACT-004 — resolves E013 grouped hand discards and retrieves only a frozen discard option', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
    const source = state.cards['ARDEN-CARD-023']!; source.controllerParticipantId = 'P1'; source.zone = 'HAND';
    const handIds = ['ARDEN-CARD-001', 'ARDEN-CARD-002'];
    for (const id of handIds) { const card = state.cards[id]!; card.controllerParticipantId = 'P1'; card.zone = 'HAND'; state.strategy.P1.handCardInstanceIds.push(id); }
    const retrieved = state.cards['ARDEN-CARD-004']!; retrieved.controllerParticipantId = 'P1'; retrieved.zone = 'DISCARD'; state.strategy.P1.discardCardInstanceIds.push(retrieved.id);
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(testHarness.dispatcher.executeM2Effect({
      gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-E013-OPEN-1', idempotencyKey: 'M2-E013-OPEN-K1',
      actorParticipantId: 'P1', sourceCardInstanceId: source.id, effectId: 'CARD_EFFECT_BASE_2025_E013', effectVersion: '0.1', parameters: {},
    })).toMatchObject({ status: 'RESOLVED', resultCode: 'M2_EFFECT_CHOICE_REQUESTED' });
    const opened = testHarness.store.snapshot(state.id)!; const p1 = trustedBindings().find(({ participantId }) => participantId === 'P1')!.authenticatedSessionId;
    expect(testHarness.app.execute(p1, command('SUBMIT_M2_EFFECT_CHOICE', state.id, opened.version, {
      continuationId: opened.m2EffectChoice!.id,
      selections: { DISCARD_FROM_HAND: handIds, RETRIEVE_FROM_DISCARD: [retrieved.id] },
    }, { commandId: 'M2-E013-RESOLVE-1', idempotencyKey: 'M2-E013-RESOLVE-K1' }))).toMatchObject({ status: 'RESOLVED' });
    const committed = testHarness.store.snapshot(state.id)!;
    handIds.forEach((id) => expect(committed.cards[id]?.zone).toBe('DISCARD'));
    expect(committed.cards[retrieved.id]?.zone).toBe('HAND');
    expect(committed.cards[source.id]?.zone).toBe('DISCARD');
  });

  it('GE-ACT-005 — E013 completes after two discards when no recovery card is eligible', () => {
    const testHarness=harness(); const state=completeAndStart(testHarness); state.phase='RESOLUTION_STAGE';
    const source=state.cards['ARDEN-CARD-023']!; source.controllerParticipantId='P1'; source.zone='HAND';
    const handIds=['ARDEN-CARD-001','ARDEN-CARD-002'];
    state.strategy.P1.handCardInstanceIds=[source.id,...handIds]; state.strategy.P1.discardCardInstanceIds=[];
    for(const card of Object.values(state.cards).filter(({controllerParticipantId,zone,id})=>
      controllerParticipantId==='P1'&&zone==='DISCARD'&&id!==source.id))card.zone='OPERATIONS_DECK';
    for(const id of handIds){state.cards[id]!.controllerParticipantId='P1';state.cards[id]!.zone='HAND';}
    expect(testHarness.store.commitState(state.id,state.version,state)).toBe(true);
    expect(testHarness.dispatcher.executeM2Effect({gameId:state.id,expectedGameVersion:state.version,
      commandId:'M2-E013-NONE-OPEN-1',idempotencyKey:'M2-E013-NONE-OPEN-K1',actorParticipantId:'P1',
      sourceCardInstanceId:source.id,effectId:'CARD_EFFECT_BASE_2025_E013',effectVersion:'0.1',parameters:{},
    })).toMatchObject({status:'RESOLVED',resultCode:'M2_EFFECT_CHOICE_REQUESTED'});
    const opened=testHarness.store.snapshot(state.id)!;
    expect(opened.m2EffectChoice?.kind==='M2_EFFECT_GROUPED_CHOICE'?opened.m2EffectChoice.groups[1]:undefined)
      .toMatchObject({minSelections:0,maxSelections:0,eligibleCardIds:[]});
    const p1=trustedBindings().find(({participantId})=>participantId==='P1')!.authenticatedSessionId;
    expect(testHarness.app.execute(p1,command('SUBMIT_M2_EFFECT_CHOICE',state.id,opened.version,{
      continuationId:opened.m2EffectChoice!.id,selections:{DISCARD_FROM_HAND:handIds,RETRIEVE_FROM_DISCARD:[]},
    },{commandId:'M2-E013-NONE-RESOLVE-1',idempotencyKey:'M2-E013-NONE-RESOLVE-K1'}))).toMatchObject({status:'RESOLVED'});
    const committed=testHarness.store.snapshot(state.id)!;
    handIds.forEach(id=>expect(committed.cards[id]?.zone).toBe('DISCARD'));
    expect(committed.cards[source.id]?.zone).toBe('DISCARD');
  });

  it('executes E031 only in Action Stage by rebuilding the deck, drawing ten and removing its source', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'ACTION_STAGE_PLAN';
    const source = state.cards['ARDEN-CARD-059']!; source.controllerParticipantId = 'P1'; source.zone = 'HAND';
    const handIds = ['ARDEN-CARD-001', 'ARDEN-CARD-002', 'ARDEN-CARD-003'];
    const discardIds = ['ARDEN-CARD-004', 'ARDEN-CARD-005', 'ARDEN-CARD-006'];
    const deckIds = Array.from({ length: 12 }, (_, index) => `ARDEN-CARD-${String(index + 7).padStart(3, '0')}`);
    state.strategy.P1.handCardInstanceIds = [source.id, ...handIds]; state.strategy.P1.discardCardInstanceIds = [...discardIds]; state.strategy.P1.operationsDeckOrder = [...deckIds];
    handIds.forEach((id) => { state.cards[id]!.controllerParticipantId = 'P1'; state.cards[id]!.zone = 'HAND'; });
    discardIds.forEach((id) => { state.cards[id]!.controllerParticipantId = 'P1'; state.cards[id]!.zone = 'DISCARD'; });
    deckIds.forEach((id, index) => { state.cards[id]!.controllerParticipantId = 'P1'; state.cards[id]!.zone = 'OPERATIONS_DECK'; state.cards[id]!.zonePosition = index; });
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(testHarness.dispatcher.executeM2Effect({
      gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-E031-1', idempotencyKey: 'M2-E031-K1',
      actorParticipantId: 'P1', sourceCardInstanceId: source.id, effectId: 'CARD_EFFECT_BASE_2025_E031', effectVersion: '0.1', parameters: {},
    })).toMatchObject({ status: 'RESOLVED', resultPayload: { discardedCount: 3, shuffledCount: 18, drawnCount: 10 } });
    const committed = testHarness.store.snapshot(state.id)!;
    expect(committed.cards[source.id]?.zone).toBe('REMOVED_FROM_GAME');
    expect(committed.strategy.P1.handCardInstanceIds).toHaveLength(10);
    expect(committed.strategy.P1.operationsDeckOrder).toHaveLength(8);
    expect(committed.strategy.P1.discardCardInstanceIds).toEqual([]);
    expect(new Set([...committed.strategy.P1.handCardInstanceIds, ...committed.strategy.P1.operationsDeckOrder]).size).toBe(18);
  });

  it('GE-ACT-020 — E045 draws exactly three without a continuation below the hand limit', () => {
    const testHarness=harness(); const state=completeAndStart(testHarness); state.phase='RESOLUTION_STAGE';
    const source=state.cards['ARDEN-CARD-080']!; source.controllerParticipantId='P1'; source.zone='HAND';
    const handIds=Array.from({length:6},(_,index)=>`ARDEN-CARD-${String(index+1).padStart(3,'0')}`);
    const deckIds=['ARDEN-CARD-011','ARDEN-CARD-012','ARDEN-CARD-013'];
    state.strategy.P1.handCardInstanceIds=[source.id,...handIds];state.strategy.P1.operationsDeckOrder=[...deckIds];state.strategy.P1.discardCardInstanceIds=[];
    handIds.forEach(id=>{state.cards[id]!.controllerParticipantId='P1';state.cards[id]!.zone='HAND';});
    deckIds.forEach((id,index)=>{state.cards[id]!.controllerParticipantId='P1';state.cards[id]!.zone='OPERATIONS_DECK';state.cards[id]!.zonePosition=index;});
    expect(testHarness.store.commitState(state.id,state.version,state)).toBe(true);
    expect(testHarness.dispatcher.executeM2Effect({gameId:state.id,expectedGameVersion:state.version,
      commandId:'M2-E045-DRAW-1',idempotencyKey:'M2-E045-DRAW-K1',actorParticipantId:'P1',sourceCardInstanceId:source.id,
      effectId:'CARD_EFFECT_BASE_2025_E045',effectVersion:'0.1',parameters:{},
    })).toMatchObject({status:'RESOLVED',resultCode:'M2_EFFECT_EXECUTED',resultPayload:{drawnCount:3,overflow:0}});
    const committed=testHarness.store.snapshot(state.id)!;
    expect(committed.strategy.P1.handCardInstanceIds).toHaveLength(9);
    expect(committed.strategy.P1.operationsDeckOrder).toEqual([]);
    expect(committed.cards[source.id]?.zone).toBe('DISCARD');
    expect(committed.m2EffectChoice).toBeUndefined();
  });

  it('GE-ACT-021 — draws three for E045 then suspends only for the exact hand-limit overflow', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
    const source = state.cards['ARDEN-CARD-080']!; source.controllerParticipantId = 'P1'; source.zone = 'HAND';
    const handIds = Array.from({ length: 9 }, (_, index) => `ARDEN-CARD-${String(index + 1).padStart(3, '0')}`);
    const deckIds = ['ARDEN-CARD-011', 'ARDEN-CARD-012', 'ARDEN-CARD-013'];
    state.strategy.P1.handCardInstanceIds = [source.id, ...handIds]; state.strategy.P1.operationsDeckOrder = [...deckIds]; state.strategy.P1.discardCardInstanceIds = [];
    handIds.forEach((id) => { state.cards[id]!.controllerParticipantId = 'P1'; state.cards[id]!.zone = 'HAND'; });
    deckIds.forEach((id, index) => { state.cards[id]!.controllerParticipantId = 'P1'; state.cards[id]!.zone = 'OPERATIONS_DECK'; state.cards[id]!.zonePosition = index; });
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(testHarness.dispatcher.executeM2Effect({
      gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-E045-OPEN-1', idempotencyKey: 'M2-E045-OPEN-K1',
      actorParticipantId: 'P1', sourceCardInstanceId: source.id, effectId: 'CARD_EFFECT_BASE_2025_E045', effectVersion: '0.1', parameters: {},
    })).toMatchObject({ status: 'RESOLVED', resultCode: 'M2_EFFECT_CHOICE_REQUESTED', resultPayload: { drawnCount: 3, overflow: 2 } });
    const opened = testHarness.store.snapshot(state.id)!;
    expect(opened.cards[source.id]?.zone).toBe('DISCARD'); expect(opened.strategy.P1.handCardInstanceIds).toHaveLength(12);
    const discardIds = opened.m2EffectChoice!.kind === 'M2_EFFECT_GROUPED_CHOICE'
      ? opened.m2EffectChoice.groups[0]!.eligibleCardIds.slice(0, 2) : [];
    const p1 = trustedBindings().find(({ participantId }) => participantId === 'P1')!.authenticatedSessionId;
    expect(testHarness.app.execute(p1, command('SUBMIT_M2_EFFECT_CHOICE', state.id, opened.version, {
      continuationId: opened.m2EffectChoice!.id, selections: { HAND_LIMIT_DISCARD: discardIds },
    }, { commandId: 'M2-E045-RESOLVE-1', idempotencyKey: 'M2-E045-RESOLVE-K1' }))).toMatchObject({ status: 'RESOLVED' });
    const committed = testHarness.store.snapshot(state.id)!;
    expect(committed.strategy.P1.handCardInstanceIds).toHaveLength(10);
    discardIds.forEach((id) => expect(committed.cards[id]?.zone).toBe('DISCARD'));
  });

  it('GE-ACT-019 — resolves E035 as paid hand/deck swap followed by authoritative shuffle', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
    const source = state.cards['ARDEN-CARD-064']!; source.controllerParticipantId = 'P1'; source.zone = 'HAND';
    const hand = state.cards['ARDEN-CARD-001']!; hand.controllerParticipantId = 'P1'; hand.zone = 'HAND';
    const deck = state.cards['ARDEN-CARD-002']!; deck.controllerParticipantId = 'P1'; deck.zone = 'OPERATIONS_DECK'; deck.zonePosition = 0;
    state.strategy.P1.handCardInstanceIds = [source.id, hand.id]; state.strategy.P1.operationsDeckOrder = [deck.id]; state.strategy.P1.discardCardInstanceIds = [];
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    const resourcesBefore = state.countries.ARDEN.resources;
    expect(testHarness.dispatcher.executeM2Effect({
      gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-E035-OPEN-1', idempotencyKey: 'M2-E035-OPEN-K1',
      actorParticipantId: 'P1', sourceCardInstanceId: source.id, effectId: 'CARD_EFFECT_BASE_2025_E035', effectVersion: '0.1', parameters: {},
    })).toMatchObject({ status: 'RESOLVED', resultCode: 'M2_EFFECT_CHOICE_REQUESTED' });
    const opened = testHarness.store.snapshot(state.id)!; const p1 = trustedBindings().find(({ participantId }) => participantId === 'P1')!.authenticatedSessionId;
    expect(testHarness.app.execute(p1, command('SUBMIT_M2_EFFECT_CHOICE', state.id, opened.version, {
      continuationId: opened.m2EffectChoice!.id, selections: { SELECT_FROM_DECK: [deck.id], SELECT_FROM_HAND: [hand.id] },
    }, { commandId: 'M2-E035-RESOLVE-1', idempotencyKey: 'M2-E035-RESOLVE-K1' }))).toMatchObject({ status: 'RESOLVED' });
    const committed = testHarness.store.snapshot(state.id)!;
    expect(committed.countries.ARDEN.resources).toBe(resourcesBefore - 1);
    expect(committed.cards[deck.id]?.zone).toBe('HAND'); expect(committed.cards[hand.id]?.zone).toBe('OPERATIONS_DECK');
    expect(committed.cards[source.id]?.zone).toBe('DISCARD');
    expect(committed.strategy.P1.handCardInstanceIds).toEqual([deck.id]);
    expect(committed.strategy.P1.operationsDeckOrder).toEqual([hand.id]);
  });

  it('resolves E053 as an authoritative two-card deck choice followed by exact hand-limit discard', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'ACTION_STAGE_PLAN';
    const source = state.cards['ARDEN-CARD-093']!; source.controllerParticipantId = 'P1'; source.zone = 'HAND';
    const handIds = Array.from({ length: 9 }, (_, index) => `ARDEN-CARD-${String(index + 1).padStart(3, '0')}`);
    const deckIds = ['ARDEN-CARD-094', 'ARDEN-CARD-095', 'ARDEN-CARD-096'];
    handIds.forEach((id) => { const card = state.cards[id]!; card.controllerParticipantId = 'P1'; card.zone = 'HAND'; });
    deckIds.forEach((id, index) => { const card = state.cards[id]!; card.controllerParticipantId = 'P1'; card.zone = 'OPERATIONS_DECK'; card.zonePosition = index; });
    state.strategy.P1.handCardInstanceIds = [source.id, ...handIds]; state.strategy.P1.operationsDeckOrder = deckIds; state.strategy.P1.discardCardInstanceIds = [];
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(testHarness.dispatcher.executeM2Effect({
      gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-E053-OPEN-1', idempotencyKey: 'M2-E053-OPEN-K1',
      actorParticipantId: 'P1', sourceCardInstanceId: source.id, effectId: 'CARD_EFFECT_BASE_2025_E053', effectVersion: '0.1', parameters: {},
    })).toMatchObject({ status: 'RESOLVED', resultCode: 'M2_EFFECT_CHOICE_REQUESTED' });
    const opened = testHarness.store.snapshot(state.id)!; const p1 = trustedBindings().find(({ participantId }) => participantId === 'P1')!.authenticatedSessionId;
    expect(testHarness.app.execute(p1, command('SUBMIT_M2_EFFECT_CHOICE', state.id, opened.version, {
      continuationId: opened.m2EffectChoice!.id, selections: { SELECT_FROM_DECK: deckIds.slice(0, 2) },
    }, { commandId: 'M2-E053-SELECT-1', idempotencyKey: 'M2-E053-SELECT-K1' }))).toMatchObject({
      status: 'RESOLVED', resultCode: 'M2_EFFECT_CHOICE_REQUESTED', resultPayload: { overflow: 1 },
    });
    const selected = testHarness.store.snapshot(state.id)!;
    expect(selected.cards[source.id]?.zone).toBe('REMOVED_FROM_GAME');
    deckIds.slice(0, 2).forEach((id) => expect(selected.cards[id]?.zone).toBe('HAND'));
    expect(selected.strategy.P1.handCardInstanceIds).toHaveLength(11);
    expect(selected.m2EffectChoice).toMatchObject({ kind: 'M2_EFFECT_GROUPED_CHOICE', effectId: 'CARD_EFFECT_BASE_2025_E053', sourceLifecycleCommitted: true });
    const discardId = selected.m2EffectChoice!.kind === 'M2_EFFECT_GROUPED_CHOICE'
      ? selected.m2EffectChoice.groups[0]!.eligibleCardIds[0]! : '';
    expect(testHarness.app.execute(p1, command('SUBMIT_M2_EFFECT_CHOICE', state.id, selected.version, {
      continuationId: selected.m2EffectChoice!.id, selections: { HAND_LIMIT_DISCARD: [discardId] },
    }, { commandId: 'M2-E053-DISCARD-1', idempotencyKey: 'M2-E053-DISCARD-K1' }))).toMatchObject({ status: 'RESOLVED' });
    const committed = testHarness.store.snapshot(state.id)!;
    expect(committed.strategy.P1.handCardInstanceIds).toHaveLength(10);
    expect(committed.cards[discardId]?.zone).toBe('DISCARD'); expect(committed.m2EffectChoice).toBeUndefined();
  });

  it('sets an approved DT through a campaign-bound registry effect', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
    const source = state.cards['ARDEN-CARD-096']!; source.controllerParticipantId = 'P1'; source.zone = 'CAMPAIGN';
    state.adjudication.campaigns.CAMPAIGN_TARGET = {
      id: 'CAMPAIGN_TARGET', ownerParticipantId: 'P1', row: 'I', alignment: 'MALIGN', targetDtId: 'RELIGION:NONE',
      assignments: [{ slot: 'INTENT', cardInstanceId: source.id, definitionId: source.definitionId, influenceValue: 1 }], activationCountThisTurn: 0,
    };
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    const options = {
      gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-EFFECT-TARGET-1', idempotencyKey: 'M2-EFFECT-TARGET-K1',
      actorParticipantId: 'P1', sourceCardInstanceId: source.id, effectId: 'CARD_EFFECT_BASE_2025_E055', effectVersion: '0.1',
      parameters: { campaignId: 'CAMPAIGN_TARGET', targetDtId: 'RELIGION:CHRISTIAN' },
    };
    expect(testHarness.dispatcher.executeM2Effect(options)).toMatchObject({ status: 'RESOLVED' });
    expect(testHarness.store.snapshot(state.id)?.adjudication.campaigns.CAMPAIGN_TARGET).toMatchObject({ targetDtId: 'RELIGION:CHRISTIAN' });
    expect(testHarness.store.snapshot(state.id)?.cards[source.id]).toMatchObject({ zone: 'CAMPAIGN' });
  });

  it('GE-ACT-012 — pays exactly one resource and discards any selected campaign through E017 atomically', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
    const source = state.cards['ARDEN-CARD-032']!; source.controllerParticipantId = 'P1'; source.zone = 'HAND';
    const target = state.cards['FLUMA-CARD-001']!; target.controllerParticipantId = 'P2'; target.zone = 'CAMPAIGN';
    state.adjudication.campaigns.CAMPAIGN_E017_TARGET = {
      id: 'CAMPAIGN_E017_TARGET', ownerParticipantId: 'P2', row: 'I', alignment: 'MALIGN', targetDtId: 'RELIGION:NONE',
      assignments: [{ slot: 'INTENT', cardInstanceId: target.id, definitionId: target.definitionId, influenceValue: 1 }], activationCountThisTurn: 0,
    };
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    const resourcesBefore = state.countries.ARDEN.resources;
    const result = testHarness.dispatcher.executeM2Effect({
      gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-EFFECT-E017-1', idempotencyKey: 'M2-EFFECT-E017-K1',
      actorParticipantId: 'P1', sourceCardInstanceId: source.id, effectId: 'CARD_EFFECT_BASE_2025_E017', effectVersion: '0.1',
      parameters: { campaignId: 'CAMPAIGN_E017_TARGET' },
    });
    expect(result).toMatchObject({ status: 'RESOLVED', resultCode: 'M2_EFFECT_EXECUTED' });
    const committed = testHarness.store.snapshot(state.id)!;
    expect(committed.countries.ARDEN.resources).toBe(resourcesBefore - 1);
    expect(committed.adjudication.campaigns.CAMPAIGN_E017_TARGET).toBeUndefined();
    expect(committed.cards[target.id]).toMatchObject({ zone: 'DISCARD', controllerParticipantId: 'P2' });
    expect(committed.cards[source.id]).toMatchObject({ zone: 'DISCARD', controllerParticipantId: 'P1' });
    expect(committed.m2Audit?.slice(-2).map(({ type }) => type)).toEqual(['RESOURCE_SPENT', 'CAMPAIGN_DISCARDED']);
  });

  it('returns registered E033 to its printed owner when its campaign is discarded', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
    const returning = state.cards['FLUMA-CARD-061']!;
    returning.controllerParticipantId = 'P1'; returning.returnToOwnerOnDiscard = false; returning.zone = 'CAMPAIGN';
    state.adjudication.campaigns.CAMPAIGN_BORROWED = {
      id: 'CAMPAIGN_BORROWED', ownerParticipantId: 'P1', row: 'I', alignment: 'MALIGN', targetDtId: 'RELIGION:NONE',
      assignments: [{ slot: 'INTENT', cardInstanceId: returning.id, definitionId: returning.definitionId, influenceValue: 1 }], activationCountThisTurn: 0,
    };
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(testHarness.dispatcher.executeM2CoreOperation({
      gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-CORE-BORROWED-1', idempotencyKey: 'M2-CORE-BORROWED-K1',
      operation: { kind: 'DISCARD_CAMPAIGN', actorParticipantId: 'P1', campaignId: 'CAMPAIGN_BORROWED' },
    })).toMatchObject({ status: 'RESOLVED' });
    const committed = testHarness.store.snapshot(state.id)!;
    expect(committed.cards[returning.id]).toMatchObject({ zone: 'HAND', controllerParticipantId: 'P2', returnToOwnerOnDiscard: false });
    expect(committed.strategy.P2.handCardInstanceIds).toContain(returning.id);
    expect(committed.strategy.P1.handCardInstanceIds).not.toContain(returning.id);
  });

  it('executes core legitimacy and backlash operations through canonical atomic state', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
    state.adjudication.vpByParticipant.P1 = 5;
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    const operations = [
      { kind: 'ESTABLISH_LEGITIMACY' as const, actorParticipantId: 'P1', pdId: 'PRESQUE_PD_1' },
      { kind: 'APPLY_BACKLASH' as const, actorParticipantId: 'P1', pdId: 'PRESQUE_PD_1', amount: 2 },
    ];
    const legitimacyOptions = {
      gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-CORE-LEG-1', idempotencyKey: 'M2-CORE-LEG-K1',
      operation: operations[0]!, schedulerPlan: { id: 'SCHEDULER-1', operations, index: 0 },
    };
    const legitimacy = testHarness.dispatcher.executeM2CoreOperation(legitimacyOptions);
    expect(legitimacy).toMatchObject({ status: 'RESOLVED', resultCode: 'M2_CORE_OPERATION_EXECUTED' });
    const afterLegitimacy = testHarness.store.snapshot(state.id)!;
    expect(afterLegitimacy.adjudication.legitimacyByPd.PRESQUE_PD_1).toBe('P1');
    expect(afterLegitimacy.m2CoreScheduler).toMatchObject({ id: 'SCHEDULER-1', nextIndex: 1, status: 'READY' });
    const beforeAlteredPlan = testHarness.store.snapshot(state.id);
    expect(testHarness.dispatcher.executeM2CoreOperation({
      gameId: state.id, expectedGameVersion: afterLegitimacy.version, commandId: 'M2-CORE-ALTERED-1', idempotencyKey: 'M2-CORE-ALTERED-K1',
      operation: operations[1]!, schedulerPlan: { id: 'SCHEDULER-1', operations: [operations[1]!, operations[1]!], index: 1 },
    })).toMatchObject({ status: 'REJECTED', error: { code: 'STALE_CONTINUATION' } });
    expect(testHarness.store.snapshot(state.id)).toEqual(beforeAlteredPlan);
    const restarted = harness({ store: testHarness.store });
    const backlash = restarted.dispatcher.executeM2CoreOperation({
      gameId: state.id, expectedGameVersion: afterLegitimacy.version, commandId: 'M2-CORE-BACKLASH-1', idempotencyKey: 'M2-CORE-BACKLASH-K1',
      operation: operations[1]!, schedulerPlan: { id: 'SCHEDULER-1', operations, index: 1 },
    });
    expect(backlash).toMatchObject({ status: 'RESOLVED', resultPayload: { operation: 'APPLY_BACKLASH' } });
    expect(testHarness.store.snapshot(state.id)?.m2CoreScheduler).toMatchObject({ nextIndex: 2, status: 'COMPLETE' });
    expect(testHarness.store.snapshot(state.id)?.m2Audit?.slice(-2).map(({ type }) => type)).toEqual(['ESTABLISH_LEGITIMACY', 'APPLY_BACKLASH']);
    expect(restarted.dispatcher.executeM2CoreOperation(legitimacyOptions)).toEqual(legitimacy);
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
