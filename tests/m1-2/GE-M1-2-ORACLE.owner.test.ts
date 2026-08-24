import { describe, expect, it } from 'vitest';
import { buildM1AdjudicationProjection } from '../../packages/projections/src/index.js';
import {
  FULL_CAMPAIGN,
  GAME_ID,
  MIXED_ATTRIBUTION,
  adjudicationHarness,
  choiceInput,
  playerActor,
  runActivation,
  runConstruct,
} from './test-fixtures.js';

const finishMixedChoice = (die = 9) => {
  const testHarness = adjudicationHarness({ mixedAttribution: true, die });
  runConstruct(testHarness);
  const activation = runActivation(testHarness);
  const pendingState = testHarness.store.snapshot(GAME_ID);
  const pending = pendingState?.adjudication.pendingResolution;
  if (pendingState === undefined || pending?.kind !== 'CHOICE') throw new Error('Expected mixed-attribution choice');
  const ursariaOption = Object.entries(pending.continuation.optionAttributionById)
    .find(([, attribution]) => attribution === 'URSARIA')?.[0];
  if (ursariaOption === undefined) throw new Error('URSARIA option missing');
  const result = testHarness.app.executeM1Interaction('session-p1', choiceInput(pendingState, {
    choiceId: pending.choice.choiceId,
    choiceVersion: pending.choice.choiceVersion,
    selectedOptionIds: [ursariaOption, ursariaOption],
  }, 'valid-ursaria-twice'));
  return { testHarness, activation, pendingState, result };
};

describe('M1-2 owner gate — 17 oracle v0.1 cases', () => {
  it('GE-CORE-005 keeps the campaign cost atomic and preserves committed AP on failure', () => {
    const testHarness = adjudicationHarness({ resources: 2 });
    runConstruct(testHarness);
    const before = testHarness.store.snapshot(GAME_ID);
    const result = runActivation(testHarness);
    const after = testHarness.store.snapshot(GAME_ID);

    expect(result.resultCode).toBe('COST_PAYMENT_FAILED');
    expect(after?.countries.ARDEN.resources).toBe(2);
    expect(after?.actionPlanning.P1?.apAvailable).toBe(1);
    expect(after?.resourceLedger.filter(({ reason }) => reason === 'CAMPAIGN_ACTIVATION_COST')).toHaveLength(0);
    expect(after?.adjudication.dieRolls).toHaveLength(0);
    expect(after?.adjudication.traces).toHaveLength(0);
    expect(after?.events.length).toBe((before?.events.length ?? 0) + 2);
  });

  it('GE-CORE-009 suspends the scheduler while P1 owns an open ChoiceRequest', () => {
    const testHarness = adjudicationHarness({ mixedAttribution: true, die: 9 });
    runConstruct(testHarness);
    expect(runActivation(testHarness).status).toBe('REQUIRES_CHOICE');
    const before = testHarness.store.snapshot(GAME_ID);
    const forced = testHarness.engine.runNext({
      gameId: GAME_ID,
      expectedGameVersion: before?.version ?? -1,
      commandId: 'scheduler-while-pending',
      idempotencyKey: 'scheduler-while-pending',
    });
    if (before?.adjudication.pendingResolution?.kind !== 'CHOICE') throw new Error('Choice fixture missing');
    const p2Submit = testHarness.app.executeM1Interaction('session-p2', choiceInput(before, {
      choiceId: before.adjudication.pendingResolution.choice.choiceId,
      choiceVersion: before.adjudication.pendingResolution.choice.choiceVersion,
      selectedOptionIds: [before.adjudication.pendingResolution.choice.options[0]!.optionId],
    }, 'core-009-p2'));
    expect(forced.resultCode).toBe('SCHEDULER_SUSPENDED');
    expect(p2Submit.resultCode).toBe('CHOICE_NOT_AUTHORIZED');
    expect(testHarness.store.snapshot(GAME_ID)).toEqual(before);
  });

  it('GE-CAM-001 constructs a valid Row I Intent+Method campaign through the scheduler', () => {
    const testHarness = adjudicationHarness();
    const result = runConstruct(testHarness);
    const campaign = testHarness.store.snapshot(GAME_ID)?.adjudication.campaigns[FULL_CAMPAIGN.campaign_id];
    expect(result.resultCode).toBe('ACTION_SLOT_RESOLVED');
    expect(campaign).toMatchObject({ row: 'I', alignment: 'MALIGN', targetDtId: 'BLACK' });
    expect(campaign?.assignments.map(({ slot }) => slot)).toEqual(['INTENT', 'METHOD', 'AMPLIFIER']);
  });

  it('GE-CAM-005 uses the IV belonging to the occupied Method slot', () => {
    const testHarness = adjudicationHarness({ serials: [102, 3], die: 7 });
    runConstruct(testHarness);
    runActivation(testHarness);
    const trace = testHarness.store.snapshot(GAME_ID)?.adjudication.traces[0];
    expect(trace?.cards).toEqual(expect.arrayContaining([
      expect.objectContaining({ definitionId: 'BASE_CARD_003', slot: 'METHOD', influenceValue: 3 }),
    ]));
    expect(trace?.baseCv).toBe(6);
  });

  it('GE-ERT-007 keeps cost at MEDIUM for base CV10 while pair bonus resolves HIGH at effective CV12', () => {
    const testHarness = adjudicationHarness({ serials: [99, 45, 86], die: 7 });
    runConstruct(testHarness);
    runActivation(testHarness);
    const state = testHarness.store.snapshot(GAME_ID);
    const trace = state?.adjudication.traces[0];
    expect(trace).toMatchObject({ baseCv: 10, effectiveCv: 12, baseTier: 'MEDIUM', resolutionTier: 'HIGH', resourceCost: 2 });
    expect(state?.countries.ARDEN.resources).toBe(2);
  });

  it('GE-ERT-016 applies the target legitimacy modifier and preserves raw/modified/normalized rolls', () => {
    const testHarness = adjudicationHarness({ legitimacyOwner: 'P1', die: 6 });
    runConstruct(testHarness);
    runActivation(testHarness);
    expect(testHarness.store.snapshot(GAME_ID)?.adjudication.traces[0]).toMatchObject({
      rawRoll: 6,
      modifiedRollRaw: 7,
      ertRoll: 7,
      ertResult: 3,
    });
  });

  it('GE-DIE-001 records the deterministic digital d10 and RNG request identity', () => {
    const testHarness = adjudicationHarness({ die: 7 });
    runConstruct(testHarness);
    runActivation(testHarness);
    expect(testHarness.store.snapshot(GAME_ID)?.adjudication.dieRolls).toEqual([
      expect.objectContaining({ source: 'CAMPAIGN_ERT', rawValue: 7, manual: false, rngRequestId: `${GAME_ID}:rng:campaign:1` }),
    ]);
  });

  it('GE-CUBE-004 consumes four incoming and removes the P3/URSARIA attribution twice', () => {
    const { testHarness, result } = finishMixedChoice();
    const state = testHarness.store.snapshot(GAME_ID);
    const resolution = state?.adjudication.influenceResolutions[0];
    const fluma = state?.adjudication.influenceStacks.find((stack) => stack.pdId === MIXED_ATTRIBUTION.pd_id && stack.attributionCountryId === 'FLUMA');
    const ursaria = state?.adjudication.influenceStacks.find((stack) => stack.pdId === MIXED_ATTRIBUTION.pd_id && stack.attributionCountryId === 'URSARIA');
    expect(result.resultCode).toBe('CHOICE_RESOLVED');
    expect(resolution).toMatchObject({ generatedCount: 4, consumedInCancellation: 4, placedCount: 0, oppositeRemovedByAttribution: { URSARIA: 2 } });
    expect(fluma?.count).toBe(1);
    expect(ursaria?.count).toBe(0);
  });

  it('GE-CUBE-006 scores no VP and changes no legitimacy when positive +2 is fully consumed', () => {
    const testHarness = adjudicationHarness({ die: 6 });
    runConstruct(testHarness);
    runActivation(testHarness);
    const state = testHarness.store.snapshot(GAME_ID);
    expect(state?.adjudication.influenceResolutions[0]).toMatchObject({ generatedCount: 2, consumedInCancellation: 2, placedCount: 0 });
    expect(state?.adjudication.vpByParticipant.P1).toBe(0);
    expect(state?.adjudication.legitimacyByPd.PRESQUE_PD_1).toBeNull();
  });

  it('GE-CUBE-007 places the +3 remainder after 2:1 and enters scoring/legitimacy flow', () => {
    const testHarness = adjudicationHarness();
    runConstruct(testHarness);
    runActivation(testHarness);
    expect(testHarness.store.snapshot(GAME_ID)?.adjudication.influenceResolutions[0]).toMatchObject({
      generatedCount: 3,
      consumedInCancellation: 2,
      placedCount: 1,
    });
  });

  it('GE-LEG-001 establishes Arden legitimacy and awards cube plus establishment VP', () => {
    const testHarness = adjudicationHarness();
    runConstruct(testHarness);
    runActivation(testHarness);
    const state = testHarness.store.snapshot(GAME_ID);
    expect(state?.adjudication.legitimacyByPd.PRESQUE_PD_1).toBe('P1');
    expect(state?.adjudication.vpByParticipant.P1).toBe(2);
  });

  it('GE-LEG-002 preserves own legitimacy and awards only the placed-cube VP', () => {
    const testHarness = adjudicationHarness({ legitimacyOwner: 'P1', die: 6 });
    runConstruct(testHarness);
    runActivation(testHarness);
    const state = testHarness.store.snapshot(GAME_ID);
    expect(state?.adjudication.legitimacyByPd.PRESQUE_PD_1).toBe('P1');
    expect(state?.adjudication.vpByParticipant.P1).toBe(1);
    expect(state?.adjudication.legitimacyLedger).toHaveLength(0);
  });

  it('GE-LEG-003 removes foreign legitimacy, awards subversion VP, and does not place Arden marker', () => {
    const testHarness = adjudicationHarness({ legitimacyOwner: 'P2' });
    runConstruct(testHarness);
    runActivation(testHarness);
    const state = testHarness.store.snapshot(GAME_ID);
    expect(state?.adjudication.legitimacyByPd.PRESQUE_PD_1).toBeNull();
    expect(state?.adjudication.vpByParticipant.P1).toBe(2);
    expect(state?.adjudication.legitimacyLedger[0]?.reason).toBe('CAMPAIGN_SUBVERT');
  });

  it('GE-CHO-001 rejects a non-issued option without state advance', () => {
    const testHarness = adjudicationHarness({ mixedAttribution: true, die: 9 });
    runConstruct(testHarness);
    runActivation(testHarness);
    const before = testHarness.store.snapshot(GAME_ID);
    const pending = before?.adjudication.pendingResolution;
    if (before === undefined || pending?.kind !== 'CHOICE') throw new Error('Choice fixture missing');
    const result = testHarness.app.executeM1Interaction('session-p1', choiceInput(before, {
      choiceId: pending.choice.choiceId,
      choiceVersion: pending.choice.choiceVersion,
      selectedOptionIds: ['forged-option', 'forged-option'],
    }, 'invalid-option'));
    expect(result.resultCode).toBe('INVALID_CHOICE_OPTION');
    expect(testHarness.store.snapshot(GAME_ID)).toEqual(before);
  });

  it('GE-CHO-002 rejects P2 without leaking the P1 option set', () => {
    const testHarness = adjudicationHarness({ mixedAttribution: true, die: 9 });
    runConstruct(testHarness);
    runActivation(testHarness);
    const before = testHarness.store.snapshot(GAME_ID);
    const pending = before?.adjudication.pendingResolution;
    if (before === undefined || pending?.kind !== 'CHOICE') throw new Error('Choice fixture missing');
    const firstOption = pending.choice.options[0]?.optionId;
    if (firstOption === undefined) throw new Error('Choice option missing');
    const result = testHarness.app.executeM1Interaction('session-p2', choiceInput(before, {
      choiceId: pending.choice.choiceId,
      choiceVersion: pending.choice.choiceVersion,
      selectedOptionIds: [firstOption, firstOption],
    }, 'wrong-actor'));
    expect(result.resultCode).toBe('CHOICE_NOT_AUTHORIZED');
    expect(JSON.stringify(result)).not.toContain(firstOption);
    expect(testHarness.store.snapshot(GAME_ID)).toEqual(before);
  });

  it('GE-AUD-001 emits a complete campaign trace with state hashes and artifact references', () => {
    const testHarness = adjudicationHarness();
    runConstruct(testHarness);
    runActivation(testHarness);
    const state = testHarness.store.snapshot(GAME_ID);
    const trace = state?.adjudication.traces[0];
    expect(trace).toMatchObject({
      id: `${GAME_ID}:trace:1`, participantId: 'P1', sequenceIndex: 2,
      campaignId: FULL_CAMPAIGN.campaign_id, activationId: `${FULL_CAMPAIGN.campaign_id}:activation:1`,
      cards: state?.adjudication.campaigns[FULL_CAMPAIGN.campaign_id]?.assignments,
      alignment: 'MALIGN', targetDtId: FULL_CAMPAIGN.target_dt, targetPdId: FULL_CAMPAIGN.target_pd,
      baseCv: 12, effectiveCv: 12, baseTier: 'HIGH', resolutionTier: 'HIGH', resourceCost: 3,
      narrative: FULL_CAMPAIGN.narrative, preRollReaction: ['OPEN', 'EVALUATE_ZERO_ELIGIBLE', 'CLOSE'],
      rawRoll: 7, modifiedRollRaw: 7, ertRoll: 7, ertResult: 3,
      generatedType: 'MALIGN', generatedCount: 3, consumedInCancellation: 2,
      oppositeRemovedByAttribution: { PRESQUE: 1 }, placedCount: 1,
      legitimacyBefore: null, legitimacyAfter: 'P1', vpBefore: 0, vpAfter: 2, vpDelta: 2,
      versions: {
        rulesetVersion: '0.1',
        scenarioVersion: '0.1',
        cardRegistryVersion: '0.1',
        engineContractVersion: '0.1',
        fixtureSchemaVersion: '0.1',
      },
    });
    expect(Object.keys(trace ?? {}).sort()).toEqual([
      'activationId', 'alignment', 'baseCv', 'baseTier', 'campaignId', 'cards',
      'consumedInCancellation', 'effectiveCv', 'ertResult', 'ertRoll', 'eventRefs',
      'generatedCount', 'generatedType', 'id', 'ledgerRefs', 'legitimacyAfter',
      'legitimacyBefore', 'modifiedRollRaw', 'narrative', 'oppositeRemovedByAttribution',
      'participantId', 'placedCount', 'postStateHash', 'preRollReaction', 'preStateHash',
      'rawRoll', 'resolutionTier', 'resourceCost', 'sequenceIndex', 'targetDtId',
      'targetPdId', 'versions', 'vpAfter', 'vpBefore', 'vpDelta',
    ].sort());
    expect(trace?.preStateHash).toMatch(/^[a-f0-9]{64}$/);
    expect(trace?.postStateHash).toMatch(/^[a-f0-9]{64}$/);
    expect(trace?.eventRefs.length).toBeGreaterThan(10);
    expect(trace?.ledgerRefs).toHaveLength(6);
  });

  it('GE-AUD-006 explains every critical golden mutation with events, ledgers, and a filtered projection', () => {
    const testHarness = adjudicationHarness();
    runConstruct(testHarness);
    const before = testHarness.store.snapshot(GAME_ID);
    runActivation(testHarness);
    const state = testHarness.store.snapshot(GAME_ID);
    if (before === undefined || state === undefined) throw new Error('Golden state missing');
    const types = new Set(state.events.map(({ type }) => type));
    for (const type of [
      'CAMPAIGN_COST_PAID',
      'DIE_ROLLED',
      'ERT_RESOLVED',
      'INFLUENCE_MUTATED',
      'LEGITIMACY_CHANGED',
      'VP_CHANGED',
      'CAMPAIGN_ACTIVATION_COMPLETED',
    ]) {
      expect(types.has(type)).toBe(true);
    }
    for (const participantId of ['P1', 'P2', 'P3', 'P4', 'P5']) {
      expect(state.actionPointLedger.filter((entry) => entry.participantId === participantId)
        .reduce((sum, entry) => sum + entry.delta, 0)).toBe(state.actionPlanning[participantId]?.apAvailable);
    }
    for (const country of Object.values(state.countries)) {
      expect(state.resourceLedger.filter(({ countryId }) => countryId === country.id)
        .reduce((sum, entry) => sum + entry.delta, 0)).toBe(country.resources);
    }
    const influenceKeys = new Set([
      ...before.adjudication.influenceStacks,
      ...state.adjudication.influenceStacks,
    ].map(({ pdId, type, attributionCountryId }) => `${pdId}:${type}:${attributionCountryId}`));
    for (const key of influenceKeys) {
      const [pdId, type, attributionCountryId] = key.split(':');
      const beforeCount = before.adjudication.influenceStacks.find((stack) =>
        stack.pdId === pdId && stack.type === type && stack.attributionCountryId === attributionCountryId)?.count ?? 0;
      const delta = state.adjudication.influenceLedger.filter((entry) =>
        entry.pdId === pdId && entry.type === type && entry.attributionCountryId === attributionCountryId)
        .reduce((sum, entry) => sum + entry.delta, 0);
      const afterCount = state.adjudication.influenceStacks.find((stack) =>
        stack.pdId === pdId && stack.type === type && stack.attributionCountryId === attributionCountryId)?.count ?? 0;
      expect(beforeCount + delta).toBe(afterCount);
    }
    expect(state.adjudication.legitimacyLedger.at(-1)?.newParticipantId)
      .toBe(state.adjudication.legitimacyByPd[FULL_CAMPAIGN.target_pd]);
    expect(state.adjudication.vpLedger.reduce((sum, entry) => sum + entry.delta, 0))
      .toBe(state.adjudication.vpByParticipant.P1);
    const trace = state.adjudication.traces[0]!;
    const activationEvents = state.events.slice(before.events.length);
    expect(activationEvents.every(({ id }) => trace.eventRefs.includes(id))).toBe(true);
    const eventLedgerIds = new Set(activationEvents.flatMap(({ payload }) =>
      typeof payload.ledgerId === 'string' ? [payload.ledgerId] : []));
    expect(trace.ledgerRefs.every((id) => eventLedgerIds.has(id))).toBe(true);
    expect(state.events.some(({ type, payload }) =>
      type === 'DIE_ROLLED' && payload.dieRollId === state.adjudication.dieRolls[0]?.id)).toBe(true);
    expect(state.events.some(({ type, payload }) =>
      type === 'CAMPAIGN_ACTIVATION_COMPLETED' && payload.influenceResolutionId === state.adjudication.influenceResolutions[0]?.id)).toBe(true);
    const rival = buildM1AdjudicationProjection(state, playerActor('P2'));
    expect(rival.audit.traces).toHaveLength(1);
  });
});
