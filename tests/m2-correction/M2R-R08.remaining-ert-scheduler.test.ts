import { describe, expect, it } from 'vitest';
import { BASE_2025_PAIR_BONUSES, calculateRegisteredPairBonus } from '../../packages/game-engine/src/index.js';
import { adjudicationHarness, FULL_CAMPAIGN, GAME_ID, runActivation, runConstruct } from '../m1-2/test-fixtures.js';

const submitCoalition = (
  testHarness: ReturnType<typeof adjudicationHarness>,
  participantId: string,
  decision: 'CONTRIBUTE' | 'DECLINE',
) => {
  const state = testHarness.store.snapshot(GAME_ID)!;
  const pending = state.adjudication.pendingResolution;
  if (pending?.kind !== 'COALITION') throw new Error('Coalition continuation missing');
  return testHarness.app.executeM1Interaction(`session-${participantId.toLowerCase()}`, {
    engineContractVersion: state.versions.engineContractVersion,
    commandId: `coalition-${decision}-${participantId}-${state.version}`,
    idempotencyKey: `coalition-${decision}-${participantId}-${state.version}`,
    gameId: state.id,
    expectedGameVersion: state.version,
    commandType: 'SUBMIT_COALITION_CONTRIBUTION',
    payloadSchemaVersion: state.versions.fixtureSchemaVersion,
    payload: { requestId: pending.request.requestId, decision },
  });
};

const coalitionHarness = () => {
  const testHarness = adjudicationHarness({
    serials: [FULL_CAMPAIGN.intent.serial, FULL_CAMPAIGN.method.serial, 42],
    resources: 10,
    die: 7,
  });
  expect(runConstruct(testHarness)).toMatchObject({ status: 'RESOLVED' });
  expect(runActivation(testHarness)).toMatchObject({
    status: 'REQUIRES_CHOICE',
    resultCode: 'COALITION_CONTRIBUTION_REQUIRED',
  });
  return testHarness;
};

describe('M2R-R08 — remaining integrated ERT and scheduler owners', () => {
  it('GE-ERT-011 fails before die/ERT after an earlier Sanctions transfer removes the exact activation funds', () => {
    const testHarness = adjudicationHarness({ resources: 2, die: 7 });
    expect(runConstruct(testHarness)).toMatchObject({ status: 'RESOLVED' });
    const prepared = testHarness.store.snapshot(GAME_ID)!;
    const sanctions = prepared.cards['FLUMA-CARD-037']!;
    sanctions.controllerParticipantId = 'P2';
    sanctions.zone = 'HAND';
    prepared.strategy.P2!.operationsDeckOrder = prepared.strategy.P2!.operationsDeckOrder.filter((id) => id !== sanctions.id);
    if (!prepared.strategy.P2!.handCardInstanceIds.includes(sanctions.id)) prepared.strategy.P2!.handCardInstanceIds.push(sanctions.id);
    expect(testHarness.store.commitState(prepared.id, prepared.version, prepared)).toBe(true);
    expect(testHarness.dispatcher.executeM2Effect({
      gameId: prepared.id,
      expectedGameVersion: prepared.version,
      commandId: 'ert-011-sanctions',
      idempotencyKey: 'ert-011-sanctions',
      actorParticipantId: 'P2',
      sourceCardInstanceId: sanctions.id,
      effectId: 'CARD_EFFECT_BASE_2025_E019',
      effectVersion: '0.1',
      parameters: { targetParticipantId: 'P1' },
    })).toMatchObject({ status: 'RESOLVED' });
    const beforeActivation = testHarness.store.snapshot(GAME_ID)!;
    expect(beforeActivation.countries.ARDEN.resources).toBe(0);
    const result = runActivation(testHarness);
    const after = testHarness.store.snapshot(GAME_ID)!;
    expect(result).toMatchObject({ status: 'RESOLVED', resultCode: 'COST_PAYMENT_FAILED' });
    expect(after.adjudication.campaigns[FULL_CAMPAIGN.campaign_id]).toBeDefined();
    expect(after.adjudication.dieRolls).toEqual(beforeActivation.adjudication.dieRolls);
    expect(after.events.slice(beforeActivation.events.length).map(({ type }) => type)).not.toContain('ERT_RESOLVED');
    expect(after.actionPlanning.P1?.apAvailable).toBe(1);
  });

  it('GE-ERT-012 resolves a complete coalition window with zero contributors and zero payments', () => {
    const testHarness = coalitionHarness();
    for (const participantId of ['P2', 'P3', 'P4', 'P5']) {
      expect(submitCoalition(testHarness, participantId, 'DECLINE')).toMatchObject({ status: 'RESOLVED' });
    }
    const state = testHarness.store.snapshot(GAME_ID)!;
    expect(state.adjudication.pendingResolution).toBeUndefined();
    expect(state.adjudication.traces.at(-1)).toMatchObject({ effectiveCv: 11 });
    expect(state.resourceLedger.filter(({ reason }) => reason === 'COALITION_CONTRIBUTION')).toHaveLength(0);
    expect(state.events.findLast(({ type }) => type === 'COALITION_RESOLVED')?.payload).toMatchObject({ contributorCount: 0 });
  });

  it('GE-ERT-013 commits four public contributions and applies coalition bonus +4', () => {
    const testHarness = coalitionHarness();
    for (const participantId of ['P2', 'P3', 'P4', 'P5']) {
      expect(submitCoalition(testHarness, participantId, 'CONTRIBUTE')).toMatchObject({ status: 'RESOLVED' });
    }
    const state = testHarness.store.snapshot(GAME_ID)!;
    expect(state.adjudication.traces.at(-1)).toMatchObject({ effectiveCv: 15 });
    expect(state.resourceLedger.filter(({ reason }) => reason === 'COALITION_CONTRIBUTION')).toHaveLength(4);
    const contributionEvents = state.events.filter(({ type, payload }) =>
      type === 'RESOURCE_CHANGED' && payload.reason === 'COALITION_CONTRIBUTION');
    expect(contributionEvents).toHaveLength(4);
    expect(contributionEvents.every(({ visibilityClass }) => visibilityClass === 'PUBLIC')).toBe(true);
  });

  it('GE-ERT-015 charges the Core modifier once, applies +1 pre-roll, and rejects a second use atomically', () => {
    const firstHarness = adjudicationHarness({ resources: 8, die: 6, coreModifier: true });
    runConstruct(firstHarness);
    expect(runActivation(firstHarness)).toMatchObject({ status: 'RESOLVED', resultCode: 'CAMPAIGN_ACTIVATION_COMPLETED' });
    const first = firstHarness.store.snapshot(GAME_ID)!;
    expect(first.coreModifierUsedByParticipant?.P1).toBe(true);
    expect(first.resourceLedger.findLast(({ reason }) => reason === 'CORE_ROLL_MODIFIER')).toMatchObject({ delta: -2 });
    expect(first.adjudication.traces.at(-1)).toMatchObject({ rawRoll: 6, modifiedRollRaw: 7, ertRoll: 7, resourceCost: 5 });

    const secondHarness = adjudicationHarness({ resources: 8, die: 6, coreModifier: true });
    runConstruct(secondHarness);
    const used = secondHarness.store.snapshot(GAME_ID)!;
    used.coreModifierUsedByParticipant = { P1: true };
    expect(secondHarness.store.commitState(used.id, used.version, used)).toBe(true);
    const before = secondHarness.store.snapshot(GAME_ID)!;
    expect(runActivation(secondHarness)).toMatchObject({ status: 'REJECTED', error: { code: 'ROLL_MODIFIER_ALREADY_USED' } });
    expect(secondHarness.store.snapshot(GAME_ID)).toEqual(before);
  });

  it('GE-ERT-023 never grants a pair bonus for one member or a merely similar non-alias identifier', () => {
    for (const [left, right] of BASE_2025_PAIR_BONUSES) {
      expect(calculateRegisteredPairBonus([left])).toBe(0);
      expect(calculateRegisteredPairBonus([right])).toBe(0);
      expect(calculateRegisteredPairBonus([left, `${right}-SIMILAR`])).toBe(0);
    }
  });

  it('GE-M2-SCH-001 resumes after, rather than re-executing, the slot that suspended', async () => {
    const { runM2BScheduler } = await import('../../packages/game-engine/src/index.js');
    const first = runM2BScheduler(['A', 'B', 'C'], (_slot, index) => index === 1 ? 'SUSPENDED' : 'RESOLVED');
    expect(first).toEqual({ nextIndex: 2, status: 'SUSPENDED', executionOrder: [0, 1] });
    expect(runM2BScheduler(['A', 'B', 'C'], () => 'RESOLVED', first.nextIndex))
      .toEqual({ nextIndex: 3, status: 'COMPLETE', executionOrder: [2] });
  });

  it('GE-PLAN-002 preserves the explicit Action → Activate → Regime intraplayer sequence in the real scheduler', () => {
    const testHarness = adjudicationHarness({ boost: true, resources: 10, die: 7 });
    runConstruct(testHarness);
    const state = testHarness.store.snapshot(GAME_ID)!;
    const planning = state.actionPlanning.P1!;
    planning.lockedSlots = [
      { sequenceIndex: 1, actionType: 'PLAY_BOOST', actionPayload: {
        cardInstanceId: 'ARDEN-CARD-087', campaignId: FULL_CAMPAIGN.campaign_id, activationSequenceIndex: 2,
      }, apCost: 1, revealed: false },
      { sequenceIndex: 2, actionType: 'ACTIVATE_CAMPAIGN', actionPayload: {
        campaignId: FULL_CAMPAIGN.campaign_id, requestedTargetPdId: FULL_CAMPAIGN.target_pd,
      }, apCost: 1, revealed: false },
      { sequenceIndex: 3, actionType: 'USE_REGIME_ABILITY', actionPayload: {}, apCost: 1, revealed: false },
    ];
    state.adjudication.scheduler = { participantIndex: 0, slotIndex: 0, status: 'READY' };
    delete state.currentRevealedAction;
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    testHarness.random.enqueue(4);
    for (let index = 0; index < 3; index += 1) {
      const current = testHarness.store.snapshot(GAME_ID)!;
      const result = testHarness.engine.runNext({ gameId: current.id, expectedGameVersion: current.version,
        commandId: `plan-002-${index}`, idempotencyKey: `plan-002-${index}` });
      expect(['RESOLVED', 'REQUIRES_CHOICE']).toContain(result.status);
    }
    const committed = testHarness.store.snapshot(GAME_ID)!;
    expect(committed.events.filter(({ type }) => type === 'ACTION_REVEALED').slice(-3).map(({ payload }) =>
      [payload.sequenceIndex, payload.actionType])).toEqual([
      [1, 'PLAY_BOOST'], [2, 'ACTIVATE_CAMPAIGN'], [3, 'USE_REGIME_ABILITY'],
    ]);
  });
});
