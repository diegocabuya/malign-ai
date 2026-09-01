import { describe, expect, it } from 'vitest';
import type { SessionM1InteractionInput } from '../../apps/server/src/game-session-application.js';
import type { AdjudicationTrace, SetupGameEvent, SetupGameState } from '../../packages/domain/src/index.js';
import {
  createM1ReplayBundle,
  createM1StateSnapshot,
  replayM1Events,
  rehydrateM1StateSnapshot,
  type M1ReplayBundle,
} from '../../packages/game-engine/src/index.js';
import { canonicalizeJson, sha256CanonicalJson } from '../../packages/shared/src/index.js';
import {
  FULL_CAMPAIGN,
  GAME_ID,
  adjudicationHarness,
  choiceInput,
  runActivation,
  runConstruct,
} from './test-fixtures.js';

const narrativeInput = (
  state: SetupGameState,
  narrative: string,
  suffix: string,
  payload: unknown = { campaignId: FULL_CAMPAIGN.campaign_id, narrative },
): SessionM1InteractionInput => ({
  engineContractVersion: state.versions.engineContractVersion,
  commandId: `narrative-${suffix}`,
  idempotencyKey: `narrative-${suffix}`,
  gameId: state.id,
  expectedGameVersion: state.version,
  commandType: 'SUBMIT_CAMPAIGN_NARRATIVE',
  payloadSchemaVersion: state.versions.fixtureSchemaVersion,
  payload,
  correlationId: `narrative-correlation-${suffix}`,
});

const completeMixedChoice = () => {
  const testHarness = adjudicationHarness({ mixedAttribution: true, die: 7 });
  const initial = testHarness.store.snapshot(GAME_ID);
  if (initial === undefined) throw new Error('Correction replay initial state missing');
  const initialEventCount = initial.events.length;
  runConstruct(testHarness);
  runActivation(testHarness);
  const pendingState = testHarness.store.snapshot(GAME_ID);
  const pending = pendingState?.adjudication.pendingResolution;
  if (pendingState === undefined || pending?.kind !== 'CHOICE') throw new Error('Correction choice fixture missing');
  const optionId = Object.entries(pending.continuation.optionAttributionById)
    .find(([, countryId]) => countryId === 'URSARIA')?.[0];
  if (optionId === undefined) throw new Error('Correction choice option missing');
  const result = testHarness.app.executeM1Interaction('session-p1', choiceInput(pendingState, {
    choiceId: pending.choice.choiceId,
    choiceVersion: pending.choice.choiceVersion,
    selectedOptionIds: Array.from({ length: pending.continuation.removalsRequired }, () => optionId),
  }, 'correction-complete'));
  if (result.status !== 'RESOLVED') throw new Error(`Correction choice failed: ${result.resultCode}`);
  const final = testHarness.store.snapshot(GAME_ID);
  if (final === undefined) throw new Error('Correction replay final state missing');
  return { testHarness, initial, initialEventCount, final };
};

const replayBundle = (
  events: readonly SetupGameEvent[],
  traces: readonly AdjudicationTrace[],
): M1ReplayBundle => {
  const artifacts = { events, traces };
  return {
    fixtureSchemaVersion: '0.1',
    canonicalArtifactsJson: canonicalizeJson(artifacts),
    integrityDigest: sha256CanonicalJson(artifacts),
  };
};

describe('M12-R01 — complete snapshot integrity and replay', () => {
  const tamperCases: readonly [string, (state: SetupGameState) => void][] = [
    ['event', (state) => Object.assign(state.events[0]!.payload, { tampered: true })],
    ['resource ledger', (state) => Object.assign(state.resourceLedger[0]!, { delta: 999 })],
    ['AP ledger', (state) => Object.assign(state.actionPointLedger[0]!, { delta: 999 })],
    ['influence ledger', (state) => Object.assign(state.adjudication.influenceLedger[0]!, { delta: 999 })],
    ['legitimacy ledger', (state) => Object.assign(state.adjudication.legitimacyLedger[0]!, { newParticipantId: 'P5' })],
    ['VP ledger', (state) => Object.assign(state.adjudication.vpLedger[0]!, { delta: 999 })],
    ['die roll', (state) => Object.assign(state.adjudication.dieRolls[0]!, { rawValue: 1 })],
    ['influence resolution', (state) => Object.assign(state.adjudication.influenceResolutions[0]!, { placedCount: 999 })],
    ['narrative', (state) => Object.assign(state.adjudication.narrativesByCampaign[FULL_CAMPAIGN.campaign_id]!, { text: 'altered' })],
    ['resolved choice', (state) => { state.adjudication.resolvedChoiceIds[0] = 'altered-choice'; }],
    ['trace', (state) => Object.assign(state.adjudication.traces[0]!, { vpAfter: 999 })],
  ];

  it.each(tamperCases)('rejects a snapshot with an altered %s', (_label, mutate) => {
    const { final } = completeMixedChoice();
    const snapshot = createM1StateSnapshot(final);
    const altered = structuredClone(final);
    mutate(altered);
    expect(() => rehydrateM1StateSnapshot({
      ...snapshot,
      canonicalStateJson: canonicalizeJson(altered),
    })).toThrow('Snapshot integrity digest mismatch');
  });

  it('reconstructs the complete normalized golden state without consuming RNG', () => {
    const { testHarness, initial, initialEventCount, final } = completeMixedChoice();
    const cursorBefore = testHarness.random.cursor;
    const replayed = replayM1Events(
      createM1StateSnapshot(initial),
      createM1ReplayBundle(final.events.slice(initialEventCount), final.adjudication.traces),
    );
    expect(canonicalizeJson(replayed)).toBe(canonicalizeJson(final));
    expect(testHarness.random.cursor).toBe(cursorBefore);
  });

  it('rejects deleted or modified replay artifacts even when the outer digest is recomputed', () => {
    const { initial, initialEventCount, final } = completeMixedChoice();
    const snapshot = createM1StateSnapshot(initial);
    const events = structuredClone(final.events.slice(initialEventCount));
    const traces = structuredClone(final.adjudication.traces);
    const modifiedEvents = structuredClone(events);
    const dieEvent = modifiedEvents.find(({ type }) => type === 'DIE_ROLLED');
    if (dieEvent === undefined) throw new Error('Replay die event missing');
    Object.assign(dieEvent.payload, { rawValue: 1 });
    expect(() => replayM1Events(snapshot, replayBundle(modifiedEvents, traces))).toThrow();
    expect(() => replayM1Events(snapshot, replayBundle(events.slice(0, -1), traces))).toThrow();
    expect(() => replayM1Events(snapshot, replayBundle(events, []))).toThrow();
  });
});

describe('M12-R02 — truthful narrative provenance', () => {
  it('records the approved fixture narrative with SYSTEM/fixture actoria and lineage', () => {
    const testHarness = adjudicationHarness();
    runConstruct(testHarness);
    runActivation(testHarness);
    const state = testHarness.store.snapshot(GAME_ID);
    const event = state?.events.find(({ type }) => type === 'NARRATIVE_SUBMITTED');
    const provenance = state?.adjudication.narrativesByCampaign[FULL_CAMPAIGN.campaign_id];
    expect(provenance).toMatchObject({
      source: 'FIXTURE',
      actorId: 'M1_FIXTURE_FULL_CAMPAIGN',
      actorParticipantId: null,
      correlationId: 'fixture:full-campaign-m1',
    });
    expect(event).toMatchObject({
      actorType: 'SYSTEM',
      actorId: 'M1_FIXTURE_FULL_CAMPAIGN',
      actorParticipantId: null,
      correlationId: 'fixture:full-campaign-m1',
      payload: { source: 'FIXTURE', inputCausationId: provenance?.causationId },
    });
    expect(event?.causationId).toBe(state?.events[state.events.indexOf(event!) - 1]?.id);
  });

  it('suspends serializably when narrative is absent without cost, RNG, trace, or invented text', () => {
    const testHarness = adjudicationHarness({ includeNarrative: false });
    runConstruct(testHarness);
    const before = testHarness.store.snapshot(GAME_ID);
    const cursorBefore = testHarness.random.cursor;
    const result = runActivation(testHarness);
    const after = testHarness.store.snapshot(GAME_ID);
    expect(result).toMatchObject({ status: 'REQUIRES_CHOICE', resultCode: 'NARRATIVE_REQUIRED' });
    expect(after?.adjudication.pendingResolution?.kind).toBe('NARRATIVE');
    expect(after?.countries.ARDEN.resources).toBe(before?.countries.ARDEN.resources);
    expect(after?.resourceLedger).toEqual(before?.resourceLedger);
    expect(after?.adjudication.dieRolls).toEqual(before?.adjudication.dieRolls);
    expect(after?.adjudication.traces).toEqual(before?.adjudication.traces);
    expect(after?.adjudication.narrativesByCampaign[FULL_CAMPAIGN.campaign_id]).toBeUndefined();
    expect(testHarness.random.cursor).toBe(cursorBefore);
    expect(after?.events.slice(before?.events.length).map(({ type }) => type)).toEqual([
      'ACTION_REVEALED',
      'CAMPAIGN_ACTIVATION_STARTED',
      'NARRATIVE_REQUESTED',
    ]);
    expect(rehydrateM1StateSnapshot(createM1StateSnapshot(after!)).adjudication.pendingResolution)
      .toEqual(after?.adjudication.pendingResolution);
  });

  it('accepts player narrative only through the authenticated application boundary', () => {
    const testHarness = adjudicationHarness({ includeNarrative: false });
    runConstruct(testHarness);
    runActivation(testHarness);
    const pendingState = testHarness.store.snapshot(GAME_ID);
    if (pendingState?.adjudication.pendingResolution?.kind !== 'NARRATIVE') throw new Error('Narrative request missing');
    const requestEvent = pendingState.events.at(-1)!;
    const input = narrativeInput(pendingState, 'Narrativa autenticada del jugador.', 'player');
    const result = testHarness.app.executeM1Interaction('session-p1', input);
    const final = testHarness.store.snapshot(GAME_ID);
    const event = final?.events.findLast(({ type }) => type === 'NARRATIVE_SUBMITTED');
    expect(result.resultCode).toBe('CAMPAIGN_ACTIVATION_COMPLETED');
    expect(event).toMatchObject({
      actorType: 'PLAYER',
      actorId: 'user-p1',
      actorParticipantId: 'P1',
      correlationId: input.correlationId,
      causationId: requestEvent.id,
      payload: { source: 'PLAYER', inputId: input.commandId, text: 'Narrativa autenticada del jugador.' },
    });
    expect(final?.adjudication.narrativesByCampaign[FULL_CAMPAIGN.campaign_id]).toMatchObject({
      source: 'PLAYER',
      actorId: 'user-p1',
      actorParticipantId: 'P1',
      correlationId: input.correlationId,
      causationId: requestEvent.id,
    });
  });
});

describe('M12-R03 — authenticated application/session boundary', () => {
  it('rejects free authority fields and P2 spoofing without leaking or mutating state', () => {
    const testHarness = adjudicationHarness({ includeNarrative: false });
    runConstruct(testHarness);
    runActivation(testHarness);
    const before = testHarness.store.snapshot(GAME_ID)!;
    const forged = testHarness.app.executeM1Interaction('session-p2', narrativeInput(
      before,
      'forged',
      'spoof',
      {
        campaignId: FULL_CAMPAIGN.campaign_id,
        narrative: 'forged',
        actorId: 'user-p1',
        participantId: 'P1',
        permissions: ['game:play'],
      },
    ));
    const p2 = testHarness.app.executeM1Interaction('session-p2', narrativeInput(before, 'forged', 'p2'));
    expect(forged.resultCode).toBe('INVALID_ACTOR_CONTEXT');
    expect(p2.resultCode).toBe('NARRATIVE_NOT_AUTHORIZED');
    expect(JSON.stringify(p2)).not.toContain('narrative-request');
    expect(testHarness.store.snapshot(GAME_ID)).toEqual(before);
  });

  it('preserves cross-game enumeration protection for command and query', () => {
    const testHarness = adjudicationHarness();
    const state = testHarness.store.snapshot(GAME_ID)!;
    const unknownGame = 'game-not-in-session-scope';
    const command = testHarness.app.executeM1Interaction('session-p1', {
      ...narrativeInput(state, 'irrelevant', 'cross-game'),
      gameId: unknownGame,
    });
    const query = testHarness.app.getM1AdjudicationProjection('session-p1', unknownGame);
    expect(command.resultCode).toBe('GAME_ID_MISMATCH');
    if (query.ok) throw new Error('Cross-game query unexpectedly succeeded');
    expect(query.error.code).toBe('GAME_ID_MISMATCH');
    const unknown = testHarness.app.getM1AdjudicationProjection('unknown-session', unknownGame);
    if (unknown.ok) throw new Error('Unknown-session query unexpectedly succeeded');
    expect(unknown.error.code).toBe('INVALID_ACTOR_CONTEXT');
  });

  it('resolves the authenticated viewer before building the M1 projection and keeps scheduler private', () => {
    const testHarness = adjudicationHarness();
    const state = testHarness.store.snapshot(GAME_ID)!;
    const query = testHarness.app.getM1AdjudicationProjection('session-p2', GAME_ID);
    expect(query.ok && query.projection.game.viewer).toEqual({ participantId: 'P2', role: 'PLAYER' });
    const internalAttempt = testHarness.app.executeM1Interaction('session-p1', {
      ...narrativeInput(state, 'irrelevant', 'scheduler'),
      commandType: 'INTERNAL_RUN_M1_SCHEDULER',
      payload: {},
    } as unknown as SessionM1InteractionInput);
    expect(internalAttempt.resultCode).toBe('NOT_AUTHORIZED');
    expect(testHarness.store.snapshot(GAME_ID)).toEqual(state);
  });
});

describe('M12-R04 — one canonical resource ledger', () => {
  it('reconciles every country from zero with setup, income, and activation cost reasons', () => {
    const testHarness = adjudicationHarness();
    runConstruct(testHarness);
    runActivation(testHarness);
    const state = testHarness.store.snapshot(GAME_ID)!;
    expect(state.resourceLedger.filter(({ reason }) => reason === 'SCENARIO_SETUP')).toHaveLength(5);
    expect(state.resourceLedger.filter(({ reason }) => reason === 'TURN_INCOME')).toHaveLength(5);
    expect(state.resourceLedger.filter(({ reason }) => reason === 'CAMPAIGN_ACTIVATION_COST')).toHaveLength(1);
    for (const country of Object.values(state.countries)) {
      expect(state.resourceLedger.filter(({ countryId }) => countryId === country.id)
        .reduce((sum, { delta }) => sum + delta, 0)).toBe(country.resources);
    }
    expect(Object.hasOwn(state.adjudication, 'resourceLedger')).toBe(false);
  });

  it('adds no cost transaction on failure and no duplicate on idempotent retry', () => {
    const failedHarness = adjudicationHarness({ resources: 2 });
    runConstruct(failedHarness);
    const failedBefore = failedHarness.store.snapshot(GAME_ID)!;
    runActivation(failedHarness);
    expect(failedHarness.store.snapshot(GAME_ID)?.resourceLedger).toEqual(failedBefore.resourceLedger);

    const testHarness = adjudicationHarness();
    runConstruct(testHarness);
    const before = testHarness.store.snapshot(GAME_ID)!;
    const options = {
      gameId: GAME_ID,
      expectedGameVersion: before.version,
      commandId: 'resource-idempotent',
      idempotencyKey: 'resource-idempotent',
      correlationId: 'resource-idempotent',
    };
    const first = testHarness.engine.runNext(options);
    const firstState = testHarness.store.snapshot(GAME_ID)!;
    const retry = testHarness.engine.runNext(options);
    expect(retry).toEqual(first);
    expect(testHarness.store.snapshot(GAME_ID)).toEqual(firstState);
    expect(firstState.resourceLedger.filter(({ reason }) => reason === 'CAMPAIGN_ACTIVATION_COST')).toHaveLength(1);
  });
});

describe('M12-R05 — player projection redaction', () => {
  it('keeps authoritative hashes and other players secrets out of P1 and P2 projections', () => {
    const testHarness = adjudicationHarness();
    const planning = testHarness.store.snapshot(GAME_ID)!;
    const futureSlot = planning.actionPlanning.P1!.lockedSlots[0]!;
    if (futureSlot.actionType !== 'CONSTRUCT_CAMPAIGN' || !('intentCardInstanceId' in futureSlot.actionPayload)) {
      throw new Error('Future P1 construct slot missing');
    }
    const futureP1Card = futureSlot.actionPayload.intentCardInstanceId;
    const p2PlanningQuery = testHarness.app.getM1AdjudicationProjection('session-p2', GAME_ID);
    if (!p2PlanningQuery.ok) throw new Error('P2 planning projection missing');
    expect(JSON.stringify(p2PlanningQuery.projection)).not.toContain(futureP1Card);
    runConstruct(testHarness);
    runActivation(testHarness);
    const state = testHarness.store.snapshot(GAME_ID)!;
    const f1 = testHarness.app.getM1AdjudicationProjection('session-f1', GAME_ID);
    const p1 = testHarness.app.getM1AdjudicationProjection('session-p1', GAME_ID);
    const p2 = testHarness.app.getM1AdjudicationProjection('session-p2', GAME_ID);
    if (!f1.ok || !p1.ok || !p2.ok) throw new Error('Authorized projection missing');
    const trace = state.adjudication.traces[0]!;
    expect(f1.projection.audit.traces[0]).toEqual(trace);
    for (const projection of [p1.projection, p2.projection]) {
      const serialized = JSON.stringify(projection);
      expect(serialized).not.toContain('preStateHash');
      expect(serialized).not.toContain('postStateHash');
      expect(serialized).not.toContain(trace.preStateHash);
      expect(serialized).not.toContain(trace.postStateHash);
      expect(serialized).not.toContain('operationsDeckOrder');
      expect(serialized).not.toContain('optionAttributionById');
    }
    expect(JSON.stringify(p1.projection)).not.toContain(state.strategy.P2!.handCardInstanceIds[0]);
    expect(JSON.stringify(p2.projection)).not.toContain(state.strategy.P1!.handCardInstanceIds[0]);
  });

  it('redacts P1 private choice options from P2 while preserving event identity and versions', () => {
    const testHarness = adjudicationHarness({ mixedAttribution: true, die: 9 });
    runConstruct(testHarness);
    runActivation(testHarness);
    const state = testHarness.store.snapshot(GAME_ID)!;
    if (state.adjudication.pendingResolution?.kind !== 'CHOICE') throw new Error('Private choice missing');
    const query = testHarness.app.getM1AdjudicationProjection('session-p2', GAME_ID);
    if (!query.ok) throw new Error('P2 projection missing');
    const source = state.events.find(({ type }) => type === 'CHOICE_REQUESTED')!;
    const projected = query.projection.events.find(({ id }) => id === source.id)!;
    expect(projected).toMatchObject({ id: source.id, sequenceNumber: source.sequenceNumber, gameVersion: source.gameVersion });
    expect(projected.payload).toEqual({ redacted: true });
    for (const option of state.adjudication.pendingResolution.choice.options) {
      expect(JSON.stringify(query.projection)).not.toContain(option.optionId);
    }
  });
});

describe('M12-R06 — manual die continuation', () => {
  const manualInput = (state: SetupGameState, requestId: string, value: number, suffix: string): SessionM1InteractionInput => ({
    engineContractVersion: state.versions.engineContractVersion,
    commandId: `manual-die-${suffix}`,
    idempotencyKey: `manual-die-${suffix}`,
    gameId: state.id,
    expectedGameVersion: state.version,
    commandType: 'SUBMIT_MANUAL_DIE',
    payloadSchemaVersion: state.versions.fixtureSchemaVersion,
    payload: { requestId, value },
    correlationId: 'm1-2-full-campaign',
  });

  it('suspends for a private manual D10 request without consuming RNG, then resumes exactly once', () => {
    const testHarness = adjudicationHarness({ diceMode: 'MANUAL_DIE_INPUT' });
    const initial = testHarness.store.snapshot(GAME_ID)!;
    const initialEventCount = initial.events.length;
    runConstruct(testHarness);
    const cursorBefore = testHarness.random.cursor;
    const requested = runActivation(testHarness);
    expect(requested).toMatchObject({ status: 'REQUIRES_CHOICE', resultCode: 'MANUAL_DIE_REQUIRED' });
    expect(testHarness.random.cursor).toBe(cursorBefore);
    const pendingState = testHarness.store.snapshot(GAME_ID)!;
    const pending = pendingState.adjudication.pendingResolution;
    if (pending?.kind !== 'MANUAL_DIE') throw new Error('Manual die request missing');
    expect(testHarness.app.getM1AdjudicationProjection('session-p1', GAME_ID)).toMatchObject({
      ok: true, projection: { pendingManualDieRequest: { requestId: pending.request.requestId, maySubmit: true } },
    });
    const completed = testHarness.app.executeM1Interaction('session-p1', manualInput(pendingState, pending.request.requestId, 8, 'valid'));
    expect(completed).toMatchObject({ status: 'RESOLVED', resultCode: 'CAMPAIGN_ACTIVATION_COMPLETED' });
    const after = testHarness.store.snapshot(GAME_ID)!;
    expect(after.adjudication.pendingResolution).toBeUndefined();
    expect(after.adjudication.dieRolls.at(-1)).toMatchObject({ rawValue: 8, manual: true, submittedByParticipantId: 'P1' });
    expect(after.events.filter(({ type }) => type === 'DIE_REQUESTED')).toHaveLength(1);
    expect(after.events.filter(({ type }) => type === 'DIE_ROLLED').at(-1)?.payload).toMatchObject({
      rawValue: 8, manual: true, submittedByParticipantId: 'P1',
    });
    const replayed = replayM1Events(createM1StateSnapshot(initial), createM1ReplayBundle(
      after.events.slice(initialEventCount), after.adjudication.traces,
    ));
    expect(canonicalizeJson(replayed)).toBe(canonicalizeJson(after));
    expect(testHarness.random.cursor).toBe(cursorBefore);
  });

  it.each([0, 1.5, 11, Number.POSITIVE_INFINITY])('rejects invalid manual value %s atomically', (value) => {
    const testHarness = adjudicationHarness({ diceMode: 'MANUAL_DIE_INPUT' });
    runConstruct(testHarness); runActivation(testHarness);
    const before = testHarness.store.snapshot(GAME_ID)!;
    const pending = before.adjudication.pendingResolution;
    if (pending?.kind !== 'MANUAL_DIE') throw new Error('Manual die request missing');
    const cursorBefore = testHarness.random.cursor;
    const rejected = testHarness.app.executeM1Interaction('session-p1', manualInput(before, pending.request.requestId, value, `invalid-${String(value)}`));
    expect(rejected).toMatchObject({ status: 'REJECTED', resultCode: 'INVALID_DIE_VALUE' });
    expect(testHarness.store.snapshot(GAME_ID)).toEqual(before);
    expect(testHarness.random.cursor).toBe(cursorBefore);
  });
});
