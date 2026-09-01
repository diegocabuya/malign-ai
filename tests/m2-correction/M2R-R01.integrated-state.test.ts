import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyM2StateToCanonical, BASE_2025_PAIR_BONUSES, buildDurableEngineTransition, buildM2StateFromCanonical, M2BEffectDispatcher, M2_EFFECT_MANIFEST, M2_EVENT_DRIVEN_EFFECT_IDS, M2_IMPLEMENTED_EFFECT_IDS, M2_PAIR_BONUS_EFFECT_IDS } from '../../packages/game-engine/src/index.js';
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
    expect(M2_IMPLEMENTED_EFFECT_IDS).toHaveLength(42);
    expect(M2_EVENT_DRIVEN_EFFECT_IDS).toEqual([
      'CARD_EFFECT_BASE_2025_E033', 'CARD_EFFECT_BASE_2025_E010', 'CARD_EFFECT_BASE_2025_E012',
      'CARD_EFFECT_BASE_2025_E022', 'CARD_EFFECT_BASE_2025_E036', 'CARD_EFFECT_BASE_2025_E040',
      'CARD_EFFECT_BASE_2025_E054', 'CARD_EFFECT_BASE_2025_E016', 'CARD_EFFECT_BASE_2025_E047',
      'CARD_EFFECT_BASE_2025_E006', 'CARD_EFFECT_BASE_2025_E013',
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

  it('rolls internally for every other player and resolves E046 transfers atomically', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
    const source = state.cards['ARDEN-CARD-081']!; source.controllerParticipantId = 'P1'; source.zone = 'HAND';
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    const before = Object.fromEntries(Object.entries(state.countries).map(([id, country]) => [id, country.resources]));
    expect(testHarness.dispatcher.executeM2Effect({
      gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-E046-1', idempotencyKey: 'M2-E046-K1',
      actorParticipantId: 'P1', sourceCardInstanceId: source.id, effectId: 'CARD_EFFECT_BASE_2025_E046', effectVersion: '0.1',
      parameters: { rollsByParticipant: { P2: 10, P3: 10, P4: 10, P5: 10 } },
    })).toMatchObject({ status: 'RESOLVED' });
    const committed = testHarness.store.snapshot(state.id)!;
    expect(committed.countries.ARDEN.resources).toBe(before.ARDEN! + 4);
    expect(committed.countries.FLUMA.resources).toBe(before.FLUMA! - 1);
    expect(committed.countries.URSARIA.resources).toBe(before.URSARIA! - 1);
    expect(committed.countries.PRESQUE.resources).toBe(before.PRESQUE! - 1);
    expect(committed.countries.DINESIA.resources).toBe(before.DINESIA! - 1);
    expect(committed.cards[source.id]?.zone).toBe('DISCARD');
    expect(testHarness.random.requests.slice(-4)).toEqual(Array.from({ length: 4 }, () => ({ minInclusive: 1, maxInclusive: 10 })));
    expect(committed.m2Audit?.slice(-8).map(({ type }) => type)).toEqual([
      'DIE_ROLLED', 'DIE_ROLLED', 'DIE_ROLLED', 'DIE_ROLLED',
      'RESOURCE_TRANSFERRED', 'RESOURCE_TRANSFERRED', 'RESOURCE_TRANSFERRED', 'RESOURCE_TRANSFERRED',
    ]);
  });

  it('rejects E046 without partial transfer when any passing player cannot pay', () => {
    const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
    const source = state.cards['ARDEN-CARD-081']!; source.controllerParticipantId = 'P1'; source.zone = 'HAND';
    state.countries.FLUMA.resources = 0;
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    const before = testHarness.store.snapshot(state.id);
    expect(testHarness.dispatcher.executeM2Effect({
      gameId: state.id, expectedGameVersion: state.version, commandId: 'M2-E046-FAIL-1', idempotencyKey: 'M2-E046-FAIL-K1',
      actorParticipantId: 'P1', sourceCardInstanceId: source.id, effectId: 'CARD_EFFECT_BASE_2025_E046', effectVersion: '0.1', parameters: {},
    })).toMatchObject({ status: 'REJECTED', error: { code: 'INSUFFICIENT_RESOURCES' } });
    expect(testHarness.store.snapshot(state.id)).toEqual(before);
    expect(testHarness.random.cursor).toBe(0);
  });

  it('selects E028 review cards with authoritative RNG and leaves the target hand unchanged', () => {
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

  it('opens and resolves authenticated E016 card choice without leaking rival options', () => {
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
    expect(testHarness.app.getGameProjection(p1, state.id)).toMatchObject({ ok: true, projection: { m2EffectChoice: { optionCardIds: [selected.id] } } });
    expect((testHarness.app.getGameProjection(p3, state.id) as { projection: { m2EffectChoice: unknown } }).projection.m2EffectChoice).not.toHaveProperty('optionCardIds');
    expect(testHarness.app.execute(p1, command('SUBMIT_M2_EFFECT_CHOICE', state.id, opened.version, {
      continuationId, selectedCardId: selected.id,
    }, { commandId: 'M2-E016-RESOLVE-1', idempotencyKey: 'M2-E016-RESOLVE-K1' }))).toMatchObject({ status: 'RESOLVED' });
    const committed = testHarness.store.snapshot(state.id)!;
    expect(committed.m2EffectChoice).toBeUndefined();
    expect(committed.cards[selected.id]).toMatchObject({ zone: 'HAND', controllerParticipantId: 'P1', returnToOwnerOnDiscard: true });
    expect(committed.cards[source.id]?.zone).toBe('DISCARD');
  });

  it('uses internal E047 roll then requires the targeted player to choose the discarded action card', () => {
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

  it('resolves E006 grouped choice with exact five-card discard and atomic resource payment', () => {
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

  it('resolves E013 grouped hand discards and retrieves only a frozen discard option', () => {
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

  it('pays exactly one resource and discards a selected campaign through E017 atomically', () => {
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
