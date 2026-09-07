import { describe, expect, it } from 'vitest';
import type { M1CampaignSlot, SetupGameState } from '../../packages/domain/src/index.js';
import { completeAndStart, harness } from '../m1-0/test-fixtures.js';
import { lockMaintenance, reachInitiative, requestInitiative, setMaintenance } from '../m1-1/test-fixtures.js';

const canonical = (): { readonly testHarness: ReturnType<typeof harness>; readonly state: SetupGameState } => {
  const testHarness = harness(); const state = completeAndStart(testHarness); state.phase = 'RESOLUTION_STAGE';
  return { testHarness, state };
};

const compatibleCards = (state: SetupGameState, slot: M1CampaignSlot, owner = 'P1') => Object.values(state.cards)
  .filter((card) => state.adjudication.campaignCardRules[card.definitionId]?.influenceValueBySlot[slot] !== undefined)
  .filter((card) => state.countries[card.countryOwnerId].controllerParticipantId === owner);

const seedCampaign = (state: SetupGameState, row: 'I' | 'II' = 'I') => {
  const [oldCard, replacementCard] = compatibleCards(state, 'METHOD');
  if (oldCard === undefined || replacementCard === undefined) throw new Error('Compatible Method fixtures missing');
  oldCard.controllerParticipantId = 'P1'; oldCard.zone = 'CAMPAIGN';
  replacementCard.controllerParticipantId = 'P1'; replacementCard.zone = 'HAND';
  state.strategy.P1!.handCardInstanceIds.push(replacementCard.id);
  const oldRule = state.adjudication.campaignCardRules[oldCard.definitionId]!;
  state.adjudication.campaigns.CORE_CAMPAIGN = {
    id: 'CORE_CAMPAIGN', ownerParticipantId: 'P1', row, alignment: 'MALIGN', targetDtId: 'RELIGION:NONE',
    assignments: [{ slot: 'METHOD', cardInstanceId: oldCard.id, definitionId: oldCard.definitionId,
      influenceValue: oldRule.influenceValueBySlot.METHOD! }], activationCountThisTurn: 0,
  };
  return { oldCard, replacementCard };
};

describe('M2 integrated core/lifecycle owner gate', () => {
  it.each([['GE-CAM-006', 'I'], ['GE-CAM-007', 'II']] as const)('%s — replaces a compatible Method atomically in Row %s', (id, row) => {
    const { testHarness, state } = canonical(); const { oldCard, replacementCard } = seedCampaign(state, row);
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(testHarness.dispatcher.executeM2CoreOperation({ gameId: state.id, expectedGameVersion: state.version,
      commandId: `${id}-command`, idempotencyKey: `${id}-key`,
      operation: { kind: 'MODIFY_CAMPAIGN', actorParticipantId: 'P1', campaignId: 'CORE_CAMPAIGN',
        oldCardId: oldCard.id, replacementCardId: replacementCard.id },
    })).toMatchObject({ status: 'RESOLVED', resultPayload: { operation: 'MODIFY_CAMPAIGN' } });
    const committed = testHarness.store.snapshot(state.id)!; const assignment = committed.adjudication.campaigns.CORE_CAMPAIGN!.assignments[0]!;
    expect(committed.adjudication.campaigns.CORE_CAMPAIGN!.row).toBe(row);
    expect(assignment).toMatchObject({ slot: 'METHOD', cardInstanceId: replacementCard.id, definitionId: replacementCard.definitionId });
    expect(committed.cards[oldCard.id]!.zone).toBe('DISCARD'); expect(committed.cards[replacementCard.id]!.zone).toBe('CAMPAIGN');
  });

  it('GE-CAM-010 — rejects deletion/no substitute with no mutation', () => {
    const { testHarness, state } = canonical(); const { oldCard } = seedCampaign(state);
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true); const before = testHarness.store.snapshot(state.id)!;
    expect(testHarness.dispatcher.executeM2CoreOperation({ gameId: state.id, expectedGameVersion: state.version,
      commandId: 'GE-CAM-010-command', idempotencyKey: 'GE-CAM-010-key',
      operation: { kind: 'MODIFY_CAMPAIGN', actorParticipantId: 'P1', campaignId: 'CORE_CAMPAIGN', oldCardId: oldCard.id, replacementCardId: '' },
    })).toMatchObject({ status: 'REJECTED' });
    expect(testHarness.store.snapshot(state.id)).toEqual(before);
  });

  it.each(['GE-PLAN-010', 'GE-CAM-013'] as const)('%s — Wild Intent remains in campaign and is removed when the campaign leaves the mat', () => {
    const { testHarness, state } = canonical(); const wild = state.cards['ARDEN-CARD-063']!;
    const rule = state.adjudication.campaignCardRules[wild.definitionId];
    if (rule?.influenceValueBySlot.INTENT === undefined) throw new Error('Wild Intent rule missing');
    wild.controllerParticipantId = 'P1'; wild.zone = 'CAMPAIGN';
    state.adjudication.campaigns.WILD_CAMPAIGN = { id: 'WILD_CAMPAIGN', ownerParticipantId: 'P1', row: 'I', alignment: 'MALIGN',
      targetDtId: 'RELIGION:NONE', assignments: [{ slot: 'INTENT', cardInstanceId: wild.id, definitionId: wild.definitionId,
        influenceValue: rule.influenceValueBySlot.INTENT }], activationCountThisTurn: 0 };
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(testHarness.store.snapshot(state.id)!.cards[wild.id]!.zone).toBe('CAMPAIGN');
    expect(testHarness.dispatcher.executeM2CoreOperation({ gameId: state.id, expectedGameVersion: state.version,
      commandId: 'GE-CAM-013-command', idempotencyKey: 'GE-CAM-013-key',
      operation: { kind: 'DISCARD_CAMPAIGN', actorParticipantId: 'P1', campaignId: 'WILD_CAMPAIGN' },
    })).toMatchObject({ status: 'RESOLVED' });
    const committed = testHarness.store.snapshot(state.id)!;
    expect(committed.adjudication.campaigns.WILD_CAMPAIGN).toBeUndefined(); expect(committed.cards[wild.id]!.zone).toBe('REMOVED_FROM_GAME');
  });

  it('GE-CAM-014 — a borrowed campaign card returns to its printed owner', () => {
    const { testHarness, state } = canonical(); const borrowed = compatibleCards(state, 'INTENT', 'P2')[0]!;
    const rule = state.adjudication.campaignCardRules[borrowed.definitionId]!;
    borrowed.controllerParticipantId = 'P1'; borrowed.returnToOwnerOnDiscard = true; borrowed.zone = 'CAMPAIGN';
    state.adjudication.campaigns.BORROWED_CAMPAIGN = { id: 'BORROWED_CAMPAIGN', ownerParticipantId: 'P1', row: 'I', alignment: 'MALIGN',
      targetDtId: 'RELIGION:NONE', assignments: [{ slot: 'INTENT', cardInstanceId: borrowed.id, definitionId: borrowed.definitionId,
        influenceValue: rule.influenceValueBySlot.INTENT! }], activationCountThisTurn: 0 };
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(testHarness.dispatcher.executeM2CoreOperation({ gameId: state.id, expectedGameVersion: state.version,
      commandId: 'GE-CAM-014-command', idempotencyKey: 'GE-CAM-014-key',
      operation: { kind: 'DISCARD_CAMPAIGN', actorParticipantId: 'P1', campaignId: 'BORROWED_CAMPAIGN' },
    })).toMatchObject({ status: 'RESOLVED' });
    expect(testHarness.store.snapshot(state.id)!.cards[borrowed.id]).toMatchObject({ zone: 'HAND', controllerParticipantId: 'P2', returnToOwnerOnDiscard: false });
  });

  it.each([['GE-CUBE-008', 0, 2, 3], ['GE-CUBE-009', 1, 0, 5]] as const)('%s — backlash penalizes only cubes that remain placed', (id, opposite, placed, expectedVp) => {
    const { testHarness, state } = canonical(); state.adjudication.vpByParticipant.P1 = 5;
    state.adjudication.legitimacyByPd.PRESQUE_PD_1 = null;
    state.adjudication.influenceStacks.splice(0, state.adjudication.influenceStacks.length,
      ...(opposite === 0 ? [] : [{ pdId: 'PRESQUE_PD_1', type: 'MALIGN' as const, attributionCountryId: 'FLUMA' as const, count: opposite }]));
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(testHarness.dispatcher.executeM2CoreOperation({ gameId: state.id, expectedGameVersion: state.version,
      commandId: `${id}-command`, idempotencyKey: `${id}-key`,
      operation: { kind: 'APPLY_BACKLASH', actorParticipantId: 'P1', pdId: 'PRESQUE_PD_1', amount: 2 },
    })).toMatchObject({ status: 'RESOLVED', resultPayload: { placed } });
    const committed = testHarness.store.snapshot(state.id)!;
    expect(committed.adjudication.vpByParticipant.P1).toBe(expectedVp); expect(committed.adjudication.legitimacyByPd.PRESQUE_PD_1).toBeNull();
  });

  it('GE-LEG-004 — fourth marker replaces one owned marker and awards establishment VP', () => {
    const { testHarness, state } = canonical(); state.adjudication.vpByParticipant.P1 = 4;
    Object.assign(state.adjudication.legitimacyByPd, { ARDEN_PD_1: 'P1', ARDEN_PD_2: 'P1', ARDEN_PD_3: 'P1', PRESQUE_PD_1: null });
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(testHarness.dispatcher.executeM2CoreOperation({ gameId: state.id, expectedGameVersion: state.version,
      commandId: 'GE-LEG-004-command', idempotencyKey: 'GE-LEG-004-key',
      operation: { kind: 'ESTABLISH_LEGITIMACY', actorParticipantId: 'P1', pdId: 'PRESQUE_PD_1', replacePdId: 'ARDEN_PD_1' },
    })).toMatchObject({ status: 'RESOLVED', resultPayload: { established: true, replacedPdId: 'ARDEN_PD_1' } });
    const committed = testHarness.store.snapshot(state.id)!;
    expect(committed.adjudication.legitimacyByPd).toMatchObject({ ARDEN_PD_1: null, PRESQUE_PD_1: 'P1' });
    expect(Object.values(committed.adjudication.legitimacyByPd).filter((owner) => owner === 'P1')).toHaveLength(3);
    expect(committed.adjudication.vpByParticipant.P1).toBe(5);
  });

  it('GE-LEG-005 — fourth marker may be renounced without marker or bonus', () => {
    const { testHarness, state } = canonical(); state.adjudication.vpByParticipant.P1 = 4;
    Object.assign(state.adjudication.legitimacyByPd, { ARDEN_PD_1: 'P1', ARDEN_PD_2: 'P1', ARDEN_PD_3: 'P1', PRESQUE_PD_1: null });
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(testHarness.dispatcher.executeM2CoreOperation({ gameId: state.id, expectedGameVersion: state.version,
      commandId: 'GE-LEG-005-command', idempotencyKey: 'GE-LEG-005-key',
      operation: { kind: 'ESTABLISH_LEGITIMACY', actorParticipantId: 'P1', pdId: 'PRESQUE_PD_1', renounce: true },
    })).toMatchObject({ status: 'RESOLVED', resultPayload: { established: false, renounced: true } });
    const committed = testHarness.store.snapshot(state.id)!;
    expect(committed.adjudication.legitimacyByPd.PRESQUE_PD_1).toBeNull(); expect(committed.adjudication.vpByParticipant.P1).toBe(4);
  });

  it('GE-LEG-006 — direct cube card effects never award VP or alter legitimacy', () => {
    const { testHarness, state } = canonical(); const source = state.cards['ARDEN-CARD-026']!;
    source.controllerParticipantId = 'P1'; source.zone = 'HAND'; state.adjudication.vpByParticipant.P1 = 4;
    state.adjudication.legitimacyByPd.PRESQUE_PD_1 = null;
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(testHarness.dispatcher.executeM2Effect({ gameId: state.id, expectedGameVersion: state.version,
      commandId: 'GE-LEG-006-command', idempotencyKey: 'GE-LEG-006-key', actorParticipantId: 'P1', sourceCardInstanceId: source.id,
      effectId: 'CARD_EFFECT_BASE_2025_E014', effectVersion: '0.1', parameters: { pdId: 'PRESQUE_PD_1' },
    })).toMatchObject({ status: 'RESOLVED' });
    const committed = testHarness.store.snapshot(state.id)!;
    expect(committed.adjudication.vpByParticipant.P1).toBe(4); expect(committed.adjudication.legitimacyByPd.PRESQUE_PD_1).toBeNull();
  });

  it('GE-INI-010 — maintenance discard of a stolen card returns it to its owner with provenance intact', () => {
    const testHarness = harness(); reachInitiative(testHarness); requestInitiative(testHarness, [10, 8, 6, 4, 2]);
    const state = testHarness.store.listSnapshots()[0]!; const stolen = state.cards['FLUMA-CARD-001']!;
    for (const strategy of Object.values(state.strategy)) {
      strategy.handCardInstanceIds = strategy.handCardInstanceIds.filter((id) => id !== stolen.id);
      strategy.operationsDeckOrder = strategy.operationsDeckOrder.filter((id) => id !== stolen.id);
      strategy.discardCardInstanceIds = strategy.discardCardInstanceIds.filter((id) => id !== stolen.id);
    }
    stolen.controllerParticipantId = 'P1'; stolen.returnToOwnerOnDiscard = true; stolen.zone = 'HAND'; state.strategy.P1!.handCardInstanceIds.push(stolen.id);
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(setMaintenance(testHarness, 'P1', [stolen.id])).toMatchObject({ status: 'RESOLVED' });
    expect(lockMaintenance(testHarness, 'P1')).toMatchObject({ status: 'RESOLVED' });
    const committed = testHarness.store.snapshot(state.id)!;
    expect(committed.cards[stolen.id]).toMatchObject({ zone: 'HAND', controllerParticipantId: 'P2', countryOwnerId: 'FLUMA', returnToOwnerOnDiscard: false });
    expect(committed.strategy.P2!.handCardInstanceIds).toContain(stolen.id); expect(committed.strategy.P1!.discardCardInstanceIds).not.toContain(stolen.id);
  });
});
