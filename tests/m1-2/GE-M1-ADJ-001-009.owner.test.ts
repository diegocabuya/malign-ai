import { describe, expect, it } from 'vitest';
import type { CommandEnvelope } from '../../packages/contracts/src/index.js';
import {
  createM1StateSnapshot,
  createM1ReplayBundle,
  hashAuthoritativeM1State,
  replayM1Events,
  rehydrateM1StateSnapshot,
} from '../../packages/game-engine/src/index.js';
import { buildM1AdjudicationProjection } from '../../packages/projections/src/index.js';
import { canonicalizeJson, sha256CanonicalJson } from '../../packages/shared/src/index.js';
import {
  FULL_CAMPAIGN,
  GAME_ID,
  adjudicationHarness,
  choiceInput,
  playerActor,
  runActivation,
  runConstruct,
} from './test-fixtures.js';

describe('M1-2 owner gate — 9 addendum M1 v0.1 cases', () => {
  it('GE-M1-ADJ-001 reproduces the exact full-campaign-m1 golden outcome', () => {
    const testHarness = adjudicationHarness();
    runConstruct(testHarness);
    runActivation(testHarness);
    const state = testHarness.store.snapshot(GAME_ID);
    const trace = state?.adjudication.traces[0];
    const ardenMalign = state?.adjudication.influenceStacks.find((stack) =>
      stack.pdId === FULL_CAMPAIGN.target_pd && stack.type === 'MALIGN' && stack.attributionCountryId === 'ARDEN');
    const presqueResiliency = state?.adjudication.influenceStacks.find((stack) =>
      stack.pdId === FULL_CAMPAIGN.target_pd && stack.type === 'RESILIENCY' && stack.attributionCountryId === 'PRESQUE');
    expect(trace).toMatchObject({ baseCv: 12, effectiveCv: 12, baseTier: 'HIGH', resolutionTier: 'HIGH', rawRoll: 7, modifiedRollRaw: 7, ertRoll: 7, ertResult: 3, placedCount: 1, vpDelta: 2 });
    expect(ardenMalign?.count).toBe(1);
    expect(presqueResiliency?.count).toBe(0);
    expect(state?.adjudication.legitimacyByPd.PRESQUE_PD_1).toBe('P1');
    expect(state?.adjudication.vpByParticipant.P1).toBe(2);
    expect(state?.countries.ARDEN.resources).toBe(1);
  });

  it('GE-M1-ADJ-002 orders participants by initiative and each participant by sequenceIndex', () => {
    const testHarness = adjudicationHarness();
    const state = testHarness.store.snapshot(GAME_ID);
    const p2Planning = state?.actionPlanning.P2;
    const p2Strategy = state?.strategy.P2;
    if (state === undefined || p2Planning === undefined || p2Strategy === undefined) throw new Error('P2 scheduler fixture missing');
    const [intentCardId, methodCardId] = p2Strategy.handCardInstanceIds.slice(0, 2);
    const intent = intentCardId === undefined ? undefined : state.cards[intentCardId];
    const method = methodCardId === undefined ? undefined : state.cards[methodCardId];
    if (intent === undefined || method === undefined) throw new Error('P2 scheduler cards missing');
    state.adjudication.campaignCardRules[intent.definitionId] = { definitionId: intent.definitionId, alignment: 'MALIGN', influenceValueBySlot: { INTENT: 3 }, allowsAnyTargetDt: true };
    state.adjudication.campaignCardRules[method.definitionId] = { definitionId: method.definitionId, alignment: 'MALIGN', influenceValueBySlot: { METHOD: 6 } };
    p2Planning.lockedSlots = [{
      sequenceIndex: 1,
      actionType: 'CONSTRUCT_CAMPAIGN',
      actionPayload: { row: 'I', intentCardInstanceId: intent.id, methodCardInstanceId: method.id, targetDtId: 'BLACK' },
      apCost: 1,
      revealed: false,
    }];
    if (!testHarness.store.commitState(GAME_ID, state.version, state)) throw new Error('P2 scheduler fixture CAS failed');
    const results = testHarness.engine.runUntilBlocked({ gameId: GAME_ID, correlationId: 'order-gate' });
    const final = testHarness.store.snapshot(GAME_ID);
    const order = final?.events.filter(({ correlationId, type }) => correlationId === 'order-gate' && type === 'ACTION_REVEALED')
      .map(({ payload }) => `${payload.participantId}:${payload.sequenceIndex}`);
    expect(results).toHaveLength(3);
    expect(order).toEqual(['P1:1', 'P1:2', 'P2:1']);
    expect(final?.adjudication.scheduler.status).toBe('COMPLETE');
  });

  it('GE-M1-ADJ-003 rejects client access to scheduler and direct critical mutations at the authority boundary', () => {
    const testHarness = adjudicationHarness();
    const before = testHarness.store.snapshot(GAME_ID);
    if (before === undefined) throw new Error('Authority fixture missing');
    const idempotencyCountBefore = testHarness.store.idempotencyCount();
    const commandTypes = ['RESOLVE_NEXT_ACTION_SLOT', 'APPLY_ERT', 'ADD_CUBES', 'ADD_VP', 'SET_LEGITIMACY'];
    for (const commandType of commandTypes) {
      const envelope: CommandEnvelope<string, unknown> = {
        engineContractVersion: before.versions.engineContractVersion,
        commandId: `forged-${commandType}`,
        idempotencyKey: `forged-${commandType}`,
        gameId: before.id,
        actorContext: playerActor('P1'),
        expectedGameVersion: before.version,
        commandType,
        payloadSchemaVersion: before.versions.fixtureSchemaVersion,
        payload: {},
      };
      expect(testHarness.engine.dispatchInteraction(envelope).resultCode).toBe('NOT_AUTHORIZED');
    }
    expect(testHarness.store.snapshot(GAME_ID)).toEqual(before);
    expect(testHarness.random.cursor).toBe(0);
    expect(testHarness.store.idempotencyCount()).toBe(idempotencyCountBefore);
  });

  it('GE-M1-ADJ-004 serializes and rehydrates a pending 2:1 choice without a live closure', () => {
    const testHarness = adjudicationHarness({ mixedAttribution: true, die: 9 });
    runConstruct(testHarness);
    runActivation(testHarness);
    const state = testHarness.store.snapshot(GAME_ID);
    if (state === undefined) throw new Error('Pending state missing');
    const snapshot = createM1StateSnapshot(state);
    const rehydrated = rehydrateM1StateSnapshot(snapshot);
    expect(rehydrated.adjudication.pendingResolution).toEqual(state.adjudication.pendingResolution);
    expect(hashAuthoritativeM1State(rehydrated)).toBe(hashAuthoritativeM1State(state));
    expect(snapshot.canonicalStateJson).not.toContain('function');
  });

  it('GE-M1-ADJ-005 resumes once and rejects a late/double answer without duplicate effects', () => {
    const testHarness = adjudicationHarness({ mixedAttribution: true, die: 9 });
    runConstruct(testHarness);
    runActivation(testHarness);
    const pendingState = testHarness.store.snapshot(GAME_ID);
    const pending = pendingState?.adjudication.pendingResolution;
    if (pendingState === undefined || pending?.kind !== 'CHOICE') throw new Error('Pending choice missing');
    const option = Object.entries(pending.continuation.optionAttributionById).find(([, value]) => value === 'URSARIA')?.[0];
    if (option === undefined) throw new Error('Choice option missing');
    const payload = {
      choiceId: pending.choice.choiceId,
      choiceVersion: 1,
      selectedOptionIds: [option, option],
    } as const;
    const input = choiceInput(pendingState, payload, 'resume-once');
    const first = testHarness.app.executeM1Interaction('session-p1', input);
    const completed = testHarness.store.snapshot(GAME_ID);
    const retry = testHarness.app.executeM1Interaction('session-p1', input);
    const lateState = testHarness.store.snapshot(GAME_ID);
    if (lateState === undefined) throw new Error('Completed choice state missing');
    const late = testHarness.app.executeM1Interaction('session-p1', choiceInput(lateState, payload, 'late-new-key'));
    expect(first.resultCode).toBe('CHOICE_RESOLVED');
    expect(retry).toEqual(first);
    expect(late.resultCode).toBe('CHOICE_ALREADY_RESOLVED');
    expect(testHarness.store.snapshot(GAME_ID)).toEqual(completed);
    expect(completed?.adjudication.traces).toHaveLength(1);
  });

  it('GE-M1-ADJ-006 emits the approved golden campaign pipeline in exact relative order', () => {
    const testHarness = adjudicationHarness();
    runConstruct(testHarness);
    const before = testHarness.store.snapshot(GAME_ID);
    runActivation(testHarness);
    const final = testHarness.store.snapshot(GAME_ID);
    const events = final?.events.slice(before?.events.length) ?? [];
    expect(events.map(({ type }) => type)).toEqual([
      'ACTION_REVEALED', 'CAMPAIGN_ACTIVATION_STARTED', 'NARRATIVE_SUBMITTED', 'PRE_ROLL_REACTION_OPENED',
      'PRE_ROLL_REACTION_EVALUATED', 'PRE_ROLL_REACTION_CLOSED', 'CAMPAIGN_COST_PAID',
      'DIE_ROLLED', 'ERT_RESOLVED', 'INFLUENCE_MUTATED', 'INFLUENCE_MUTATED',
      'VP_CHANGED', 'LEGITIMACY_CHANGED', 'VP_CHANGED', 'ACTION_RESOLVED', 'CAMPAIGN_ACTIVATION_COMPLETED',
    ]);
    expect(events.map(({ sequenceNumber }) => sequenceNumber)).toEqual(
      Array.from({ length: events.length }, (_, index) => (before?.events.length ?? 0) + index + 1),
    );
    expect(new Set(events.map(({ gameVersion }) => gameVersion))).toEqual(new Set([final?.version]));
    expect(events.every(({ actorType }) => actorType === 'SYSTEM')).toBe(true);
    expect(events[2]).toMatchObject({
      actorId: 'M1_FIXTURE_FULL_CAMPAIGN',
      correlationId: 'fixture:full-campaign-m1',
      causationId: events[1]?.id,
    });
    for (const [index, event] of events.entries()) {
      if (index !== 2) {
        expect(event).toMatchObject({
          actorId: 'M1_INTERNAL_SCHEDULER',
          actorParticipantId: null,
          correlationId: 'm1-2-full-campaign',
        });
      }
    }
    for (let index = 1; index < events.length; index += 1) {
      if (index !== 2) expect(events[index]?.causationId).toBe(events[index - 1]?.id);
    }
  });

  it('GE-M1-ADJ-007 commits the full activation at one game version with contiguous event sequences', () => {
    const testHarness = adjudicationHarness();
    runConstruct(testHarness);
    const before = testHarness.store.snapshot(GAME_ID);
    const result = runActivation(testHarness);
    const after = testHarness.store.snapshot(GAME_ID);
    const events = after?.events.slice(before?.events.length) ?? [];
    expect(result.gameVersionAfter).toBe((before?.version ?? -1) + 1);
    expect(events.every(({ gameVersion }) => gameVersion === result.gameVersionAfter)).toBe(true);
    expect(events.map(({ sequenceNumber }) => sequenceNumber).every((sequence, index, all) => index === 0 || sequence === (all[index - 1] ?? 0) + 1)).toBe(true);
  });

  it('GE-M1-ADJ-008 uses RFC 8785/JCS ordering and SHA-256 sensitivity for state checkpoints', () => {
    expect(canonicalizeJson({ z: 1, a: { y: 2, x: 3 } })).toBe('{"a":{"x":3,"y":2},"z":1}');
    expect(canonicalizeJson({ a: { x: 3, y: 2 }, z: 1 })).toBe('{"a":{"x":3,"y":2},"z":1}');
    expect(sha256CanonicalJson({ b: 2, a: 1 })).toBe(sha256CanonicalJson({ a: 1, b: 2 }));
    expect(sha256CanonicalJson({ a: 1, b: 2 })).not.toBe(sha256CanonicalJson({ a: 1, b: 3 }));
  });

  it('GE-M1-ADJ-009 preserves invariants and replays the golden checkpoint without consuming RNG', () => {
    const testHarness = adjudicationHarness();
    const initial = testHarness.store.snapshot(GAME_ID);
    if (initial === undefined) throw new Error('Replay initial state missing');
    const initialSnapshot = createM1StateSnapshot(initial);
    const initialEventCount = initial.events.length;
    runConstruct(testHarness);
    runActivation(testHarness);
    const final = testHarness.store.snapshot(GAME_ID);
    if (final === undefined) throw new Error('Replay final state missing');
    const cursorBeforeReplay = testHarness.random.cursor;
    const replayed = replayM1Events(
      initialSnapshot,
      createM1ReplayBundle(final.events.slice(initialEventCount), final.adjudication.traces),
    );
    expect(canonicalizeJson(replayed)).toBe(canonicalizeJson(final));
    expect(buildM1AdjudicationProjection(replayed, playerActor('P1'))).toEqual(buildM1AdjudicationProjection(final, playerActor('P1')));
    expect(testHarness.random.cursor).toBe(cursorBeforeReplay);
    expect(Object.values(final.countries).every(({ resources }) => resources >= 0)).toBe(true);
    expect(Object.values(final.adjudication.vpByParticipant).every((vp) => vp >= 0)).toBe(true);
    expect(final.adjudication.influenceStacks.every(({ count }) => Number.isInteger(count) && count >= 0)).toBe(true);
    expect(Object.values(final.adjudication.legitimacyByPd).every((owner) => owner === null || typeof owner === 'string')).toBe(true);
  });
});
