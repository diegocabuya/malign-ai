import { describe, expect, it } from 'vitest';
import type { ActorContext, CommandEnvelope } from '../../packages/contracts/src/index.js';
import {
  InMemorySetupGameStore,
  M1AdjudicationEngine,
  createM1StateSnapshot,
  hashAuthoritativeM1State,
  rehydrateM1StateSnapshot,
} from '../../packages/game-engine/src/index.js';
import { buildM1AdjudicationProjection } from '../../packages/projections/src/index.js';
import { canonicalizeJson, sha256CanonicalJson } from '../../packages/shared/src/index.js';
import { MinimumRandomProvider } from '../m1-0/test-fixtures.js';
import {
  FULL_CAMPAIGN,
  GAME_ID,
  adjudicationHarness,
  choiceEnvelope,
  playerActor,
  runActivation,
  runConstruct,
} from './test-fixtures.js';

const FIXED_NOW = () => new Date('2026-08-24T12:00:00.000Z');

class RejectingCommitStore extends InMemorySetupGameStore {
  override commitState(): boolean {
    return false;
  }
}

const openMixedChoice = () => {
  const testHarness = adjudicationHarness({ mixedAttribution: true, die: 9 });
  runConstruct(testHarness);
  runActivation(testHarness);
  const state = testHarness.store.snapshot(GAME_ID);
  const pending = state?.adjudication.pendingResolution;
  if (state === undefined || pending === undefined) throw new Error('Mixed choice fixture missing');
  const option = Object.entries(pending.continuation.optionAttributionById)
    .find(([, attribution]) => attribution === 'URSARIA')?.[0];
  if (option === undefined) throw new Error('Mixed choice option missing');
  return { testHarness, state, pending, option };
};

describe('M1-2 complementary transactional and security invariants', () => {
  it('rolls back state and the RNG cursor when the campaign random provider is exhausted', () => {
    const testHarness = adjudicationHarness();
    runConstruct(testHarness);
    const before = testHarness.store.snapshot(GAME_ID);
    if (before === undefined) throw new Error('RNG rollback fixture missing');
    const random = new MinimumRandomProvider();
    random.requireScript();
    const engine = new M1AdjudicationEngine(testHarness.store, random, FIXED_NOW);

    const result = engine.runNext({
      gameId: GAME_ID,
      expectedGameVersion: before.version,
      commandId: 'rng-exhausted',
      idempotencyKey: 'rng-exhausted',
    });

    expect(result.resultCode).toBe('RANDOM_PROVIDER_FAILURE');
    expect(testHarness.store.snapshot(GAME_ID)).toEqual(before);
    expect(random.cursor).toBe(0);
  });

  it('rolls back the RNG cursor and candidate mutations when compare-and-swap fails', () => {
    const source = adjudicationHarness();
    runConstruct(source);
    const before = source.store.snapshot(GAME_ID);
    if (before === undefined) throw new Error('CAS rollback fixture missing');
    const store = new RejectingCommitStore([before]);
    const random = new MinimumRandomProvider();
    random.enqueue(7);
    random.requireScript();
    const engine = new M1AdjudicationEngine(store, random, FIXED_NOW);

    const result = engine.runNext({
      gameId: GAME_ID,
      expectedGameVersion: before.version,
      commandId: 'cas-rejected',
      idempotencyKey: 'cas-rejected',
    });

    expect(result.resultCode).toBe('STALE_STATE_VERSION');
    expect(store.snapshot(GAME_ID)).toEqual(before);
    expect(store.idempotencyCount()).toBe(0);
    expect(random.cursor).toBe(0);
  });

  it('rejects forged SYSTEM authority through the interaction boundary without side effects', () => {
    const testHarness = adjudicationHarness();
    const before = testHarness.store.snapshot(GAME_ID);
    if (before === undefined) throw new Error('SYSTEM boundary fixture missing');
    const idempotencyBefore = testHarness.store.idempotencyCount();
    const forged: CommandEnvelope<string, unknown> = {
      engineContractVersion: before.versions.engineContractVersion,
      commandId: 'forged-system-scheduler',
      idempotencyKey: 'forged-system-scheduler',
      gameId: GAME_ID,
      actorContext: {
        actorId: 'M1_INTERNAL_SCHEDULER',
        actorType: 'SYSTEM',
        authenticatedSessionId: 'client-controlled',
        permissions: ['game:internal-scheduler'],
      },
      expectedGameVersion: before.version,
      commandType: 'INTERNAL_RUN_M1_SCHEDULER',
      payloadSchemaVersion: before.versions.fixtureSchemaVersion,
      payload: {},
    };

    expect(testHarness.engine.dispatchInteraction(forged).resultCode).toBe('NOT_AUTHORIZED');
    expect(testHarness.store.snapshot(GAME_ID)).toEqual(before);
    expect(testHarness.store.idempotencyCount()).toBe(idempotencyBefore);
    expect(testHarness.random.cursor).toBe(0);
  });

  it('keeps the scheduler suspended and state immutable while a choice is open', () => {
    const { testHarness, state } = openMixedChoice();
    const cursorBefore = testHarness.random.cursor;
    const result = testHarness.engine.runNext({
      gameId: GAME_ID,
      expectedGameVersion: state.version,
      commandId: 'blocked-by-choice',
      idempotencyKey: 'blocked-by-choice',
    });

    expect(result.resultCode).toBe('SCHEDULER_SUSPENDED');
    expect(testHarness.store.snapshot(GAME_ID)).toEqual(state);
    expect(testHarness.random.cursor).toBe(cursorBefore);
  });

  it('rehydrates a pending continuation and resolves it in a new engine without closures', () => {
    const { state, pending, option } = openMixedChoice();
    const snapshot = createM1StateSnapshot(state);
    const rehydrated = rehydrateM1StateSnapshot(snapshot);
    const store = new InMemorySetupGameStore([rehydrated]);
    const random = new MinimumRandomProvider();
    random.requireScript();
    const engine = new M1AdjudicationEngine(store, random, FIXED_NOW);

    const result = engine.dispatchInteraction(choiceEnvelope(rehydrated, 'P1', {
      choiceId: pending.choice.choiceId,
      choiceVersion: pending.choice.choiceVersion,
      selectedOptionIds: [option, option],
    }, 'rehydrated-continuation'));

    expect(result.resultCode).toBe('CHOICE_RESOLVED');
    expect(store.snapshot(GAME_ID)?.adjudication.pendingResolution).toBeUndefined();
    expect(store.snapshot(GAME_ID)?.adjudication.traces).toHaveLength(1);
    expect(random.cursor).toBe(0);
  });

  it('uses one version per stable commit and contiguous event sequence numbers', () => {
    const testHarness = adjudicationHarness();
    const beforeConstruct = testHarness.store.snapshot(GAME_ID);
    const constructed = runConstruct(testHarness);
    const beforeActivation = testHarness.store.snapshot(GAME_ID);
    const activated = runActivation(testHarness);
    const after = testHarness.store.snapshot(GAME_ID);
    if (beforeConstruct === undefined || beforeActivation === undefined || after === undefined) throw new Error('Version fixture missing');

    expect(constructed.gameVersionAfter).toBe(beforeConstruct.version + 1);
    expect(activated.gameVersionAfter).toBe(beforeActivation.version + 1);
    const activationEvents = after.events.slice(beforeActivation.events.length);
    expect(new Set(activationEvents.map(({ gameVersion }) => gameVersion))).toEqual(new Set([activated.gameVersionAfter]));
    expect(activationEvents.map(({ sequenceNumber }) => sequenceNumber)).toEqual(
      Array.from({ length: activationEvents.length }, (_, index) => beforeActivation.events.length + index + 1),
    );
  });

  it('does not duplicate effects for an idempotent retry or a late second choice submit', () => {
    const { testHarness, state, pending, option } = openMixedChoice();
    const payload = {
      choiceId: pending.choice.choiceId,
      choiceVersion: pending.choice.choiceVersion,
      selectedOptionIds: [option, option],
    } as const;
    const envelope = choiceEnvelope(state, 'P1', payload, 'retry-check');
    const first = testHarness.engine.dispatchInteraction(envelope);
    const completed = testHarness.store.snapshot(GAME_ID);
    const retry = testHarness.engine.dispatchInteraction(envelope);
    if (completed === undefined) throw new Error('Retry fixture missing');
    const late = testHarness.engine.dispatchInteraction(choiceEnvelope(completed, 'P1', payload, 'late-check'));

    expect(retry).toEqual(first);
    expect(late.resultCode).toBe('CHOICE_ALREADY_RESOLVED');
    expect(testHarness.store.snapshot(GAME_ID)).toEqual(completed);
    expect(completed.adjudication.traces).toHaveLength(1);
    expect(completed.adjudication.vpByParticipant.P1).toBe(0);
  });

  it('reconciles AP, Resources, Influence, Legitimacy, and VP ledgers with final state', () => {
    const testHarness = adjudicationHarness();
    runConstruct(testHarness);
    runActivation(testHarness);
    const state = testHarness.store.snapshot(GAME_ID);
    if (state === undefined) throw new Error('Ledger fixture missing');

    const p1ApDelta = state.actionPointLedger.filter(({ participantId }) => participantId === 'P1')
      .reduce((sum, { delta }) => sum + delta, 0);
    const ardenResourceDelta = state.resourceLedger.filter(({ countryId }) => countryId === 'ARDEN')
      .reduce((sum, { delta }) => sum + delta, 0) + state.adjudication.resourceLedger
      .filter(({ countryId }) => countryId === 'ARDEN').reduce((sum, { delta }) => sum + delta, 0);
    const targetResiliencyDelta = state.adjudication.influenceLedger
      .filter(({ pdId, type }) => pdId === FULL_CAMPAIGN.target_pd && type === 'RESILIENCY')
      .reduce((sum, { delta }) => sum + delta, 0);
    const targetMalignDelta = state.adjudication.influenceLedger
      .filter(({ pdId, type }) => pdId === FULL_CAMPAIGN.target_pd && type === 'MALIGN')
      .reduce((sum, { delta }) => sum + delta, 0);
    const targetResiliency = state.adjudication.influenceStacks
      .filter(({ pdId, type }) => pdId === FULL_CAMPAIGN.target_pd && type === 'RESILIENCY')
      .reduce((sum, { count }) => sum + count, 0);
    const targetMalign = state.adjudication.influenceStacks
      .filter(({ pdId, type }) => pdId === FULL_CAMPAIGN.target_pd && type === 'MALIGN')
      .reduce((sum, { count }) => sum + count, 0);

    expect(p1ApDelta).toBe(state.actionPlanning.P1?.apAvailable);
    expect(2 + ardenResourceDelta).toBe(state.countries.ARDEN.resources);
    expect(1 + targetResiliencyDelta).toBe(targetResiliency);
    expect(targetMalignDelta).toBe(targetMalign);
    expect(state.adjudication.legitimacyLedger.at(-1)?.newParticipantId).toBe(state.adjudication.legitimacyByPd[FULL_CAMPAIGN.target_pd]);
    expect(state.adjudication.vpLedger.reduce((sum, { delta }) => sum + delta, 0)).toBe(state.adjudication.vpByParticipant.P1);
  });

  it('has no silent critical mutation in the golden activation', () => {
    const testHarness = adjudicationHarness();
    runConstruct(testHarness);
    const before = testHarness.store.snapshot(GAME_ID);
    runActivation(testHarness);
    const after = testHarness.store.snapshot(GAME_ID);
    const trace = after?.adjudication.traces[0];
    if (before === undefined || after === undefined || trace === undefined) throw new Error('Audit fixture missing');
    const events = after.events.slice(before.events.length);
    const referencedEvents = new Set(trace.eventRefs);
    const eventLedgerIds = new Set(events.flatMap(({ payload }) => typeof payload.ledgerId === 'string' ? [payload.ledgerId] : []));
    const activationLedgers = [
      ...after.adjudication.resourceLedger,
      ...after.adjudication.influenceLedger,
      ...after.adjudication.legitimacyLedger,
      ...after.adjudication.vpLedger,
    ];

    expect(events.every(({ id }) => referencedEvents.has(id))).toBe(true);
    expect(activationLedgers.every(({ id }) => trace.ledgerRefs.includes(id) && eventLedgerIds.has(id))).toBe(true);
    expect(events.some(({ type, payload }) => type === 'DIE_ROLLED' && payload.dieRollId === after.adjudication.dieRolls[0]?.id)).toBe(true);
    expect(events.some(({ type, payload }) => type === 'CAMPAIGN_ACTIVATION_COMPLETED' && payload.traceId === trace.id)).toBe(true);
    expect(trace.preStateHash).toBe(hashAuthoritativeM1State(before));
    expect(trace.postStateHash).toBe(hashAuthoritativeM1State(after));
  });

  it('matches RFC 8785 number serialization and an independent SHA-256 known answer', () => {
    expect(canonicalizeJson({ numbers: [Number('333333333.33333329'), 1E30, 4.50, 2e-3, 1e-27] })).toBe(
      '{"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27]}',
    );
    expect(sha256CanonicalJson({ b: 2, a: 1 })).toBe(
      '43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777',
    );
    expect(() => canonicalizeJson({ invalid: Number.NaN })).toThrow(TypeError);
    expect(() => canonicalizeJson('\ud800')).toThrow(TypeError);
  });

  it('redacts private choice events and options from rivals while preserving event identity', () => {
    const { state, pending } = openMixedChoice();
    const owner = buildM1AdjudicationProjection(state, playerActor('P1'));
    const rival = buildM1AdjudicationProjection(state, playerActor('P2'));
    const facilitator: ActorContext = {
      actorId: 'user-f1',
      actorType: 'FACILITATOR',
      participantId: 'F1',
      authenticatedSessionId: 'session-f1',
      permissions: ['game:facilitate', 'game:project'],
    };
    const audit = buildM1AdjudicationProjection(state, facilitator);
    const sourceEvent = state.events.find(({ type }) => type === 'CHOICE_REQUESTED');
    const rivalEvent = rival.events.find(({ type }) => type === 'CHOICE_REQUESTED');

    expect(owner.pendingChoice).toEqual(pending.choice);
    expect(audit.pendingChoice).toEqual(pending.choice);
    expect(rival.pendingChoice).toBeUndefined();
    expect(rivalEvent).toMatchObject({
      id: sourceEvent?.id,
      sequenceNumber: sourceEvent?.sequenceNumber,
      gameVersion: sourceEvent?.gameVersion,
      payload: { redacted: true },
    });
    expect(JSON.stringify(rival)).not.toContain(pending.choice.choiceId);
    for (const option of pending.choice.options) expect(JSON.stringify(rival)).not.toContain(option.optionId);
  });

  it('records backlash VP loss through a ledger and event while preserving the zero floor', () => {
    const testHarness = adjudicationHarness({ die: 1, vp: 1 });
    runConstruct(testHarness);
    runActivation(testHarness);
    const state = testHarness.store.snapshot(GAME_ID);
    const trace = state?.adjudication.traces[0];

    expect(trace).toMatchObject({ ertResult: -2, generatedType: 'RESILIENCY', placedCount: 2, vpBefore: 1, vpAfter: 0, vpDelta: -1 });
    expect(state?.adjudication.vpLedger.at(-1)).toMatchObject({ reason: 'CAMPAIGN_BACKLASH', delta: -1, balanceAfter: 0 });
    expect(state?.events.some(({ type, payload }) => type === 'VP_CHANGED' && payload.reason === 'CAMPAIGN_BACKLASH')).toBe(true);
    expect(state?.adjudication.vpByParticipant.P1).toBe(0);
  });
});
