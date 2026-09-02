import { describe, expect, it } from 'vitest';
import type { SetupGameState } from '../../packages/domain/src/index.js';
import { command, completeAndStart, completeSetup, harness, sessionId, type M1Harness } from '../m1-0/test-fixtures.js';

const ORIGIN = 'ARDEN_PD_1';
const DESTINATION = 'FLUMA_PD_1';

const setupViral = (options: {
  readonly legitimacy?: boolean;
  readonly ownerAttributed?: boolean;
  readonly malign?: number;
  readonly resiliency?: number;
  readonly variant?: 'BASELINE' | 'SHORT';
  readonly secondOrigin?: boolean;
} = {}): { readonly testHarness: M1Harness; readonly state: SetupGameState } => {
  const testHarness = harness();
  const state = completeAndStart(testHarness);
  state.phase = 'RESOLUTION_STAGE';
  state.viralVariant = options.variant ?? 'BASELINE';
  state.initiative.orderParticipantIds.splice(0, state.initiative.orderParticipantIds.length, 'P1', 'P2', 'P3', 'P4', 'P5');
  state.adjudication.influenceStacks.splice(0, state.adjudication.influenceStacks.length,
    { pdId: ORIGIN, type: 'MALIGN', attributionCountryId: options.ownerAttributed === false ? 'FLUMA' : 'ARDEN', count: options.malign ?? 9 },
    ...(options.resiliency === undefined ? [] : [{ pdId: ORIGIN, type: 'RESILIENCY' as const, attributionCountryId: 'ARDEN' as const, count: options.resiliency }]),
    ...(options.secondOrigin ? [{ pdId: DESTINATION, type: 'MALIGN' as const, attributionCountryId: 'FLUMA' as const, count: 9 }] : []));
  state.adjudication.legitimacyByPd[ORIGIN] = options.legitimacy === false ? null : 'P1';
  if (options.secondOrigin) state.adjudication.legitimacyByPd[DESTINATION] = 'P2';
  expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
  return { testHarness, state };
};

const cleanup = (testHarness: M1Harness, state: SetupGameState, suffix: string) => testHarness.dispatcher.runM2Cleanup({
  gameId: state.id, expectedGameVersion: state.version, commandId: `viral-cleanup-${suffix}`, idempotencyKey: `viral-cleanup-key-${suffix}`,
});

const submit = (testHarness: M1Harness, participantId: string, selection: string, suffix: string) => {
  const state = testHarness.store.listSnapshots()[0]!;
  return testHarness.app.execute(sessionId(participantId), command('SUBMIT_VIRAL_CHOICE', state.id, state.version, {
    continuationId: state.viralChoice!.id, selection,
  }, { commandId: `viral-choice-${suffix}`, idempotencyKey: `viral-choice-key-${suffix}` }));
};

describe('M2 integrated viral cleanup owner gate', () => {
  it('facilitator configures the frozen BASELINE/SHORT variant during setup only', () => {
    const testHarness = harness(); const setup = completeSetup(testHarness);
    expect(testHarness.app.execute(sessionId('F1'), command('CONFIGURE_GAME_OPTION', setup.id, setup.version, {
      optionId: 'VIRAL_VARIANT', value: 'SHORT',
    }))).toMatchObject({ status: 'RESOLVED', resultCode: 'GAME_OPTION_CONFIGURED' });
    expect(testHarness.store.snapshot(setup.id)!.viralVariant).toBe('SHORT');
  });

  it('GE-VIR-001 — legitimacy is required and no attempt or RNG is produced', () => {
    const { testHarness, state } = setupViral({ legitimacy: false });
    expect(cleanup(testHarness, state, '001')).toMatchObject({ status: 'RESOLVED', resultCode: 'M2_CLEANUP_COMPLETED' });
    expect(testHarness.random.cursor).toBe(0);
    expect(testHarness.store.snapshot(state.id)!.events.some(({ eventType }) => eventType === 'VIRAL_ATTEMPTED')).toBe(false);
  });

  it('GE-VIR-002 — the legitimacy owner must own attributed influence of the selected type', () => {
    const { testHarness, state } = setupViral({ ownerAttributed: false });
    expect(cleanup(testHarness, state, '002')).toMatchObject({ status: 'RESOLVED', resultCode: 'M2_CLEANUP_COMPLETED' });
    expect(testHarness.random.cursor).toBe(0);
  });

  it.each([
    ['GE-VIR-003', [6, 8], 2, 2],
    ['GE-VIR-004', [7, 3], 1, 2],
    ['GE-VIR-005', [5], 0, 1],
  ] as const)('%s — resolves the baseline dice branches transactionally', (id, rolls, generated, consumed) => {
    const { testHarness, state } = setupViral(); testHarness.random.enqueue(...rolls); testHarness.random.requireScript();
    expect(cleanup(testHarness, state, id)).toMatchObject({ status: 'REQUIRES_CHOICE', resultCode: 'VIRAL_CHOICE_REQUIRED' });
    const result = submit(testHarness, 'P1', DESTINATION, id);
    expect(result).toMatchObject({ status: 'RESOLVED', resultCode: 'VIRAL_CHOICE_RESOLVED', resultPayload: { resolution: { generated, rollsConsumed: consumed } } });
    expect(testHarness.random.cursor).toBe(consumed);
  });

  it('GE-VIR-006 — the strictly larger eligible type is selected automatically', () => {
    const { testHarness, state } = setupViral({ malign: 10, resiliency: 9 });
    expect(cleanup(testHarness, state, '006')).toMatchObject({ status: 'REQUIRES_CHOICE' });
    expect(testHarness.store.snapshot(state.id)!.cleanupContinuation!.viralOrigins[0]!.type).toBe('MALIGN');
  });

  it('GE-VIR-007 — a tie creates a private authenticated type choice before the frozen snapshot', () => {
    const { testHarness, state } = setupViral({ malign: 9, resiliency: 9 });
    expect(cleanup(testHarness, state, '007')).toMatchObject({ status: 'REQUIRES_CHOICE', resultPayload: { choiceType: 'INFLUENCE_TYPE' } });
    const p2Projection = testHarness.app.getGameProjection(sessionId('P2'), state.id) as { projection: { viralChoice: unknown } };
    expect(p2Projection.projection.viralChoice).not.toHaveProperty('options');
    expect(submit(testHarness, 'P2', 'MALIGN', '007-unauthorized')).toMatchObject({ status: 'REJECTED', error: { code: 'CHOICE_NOT_AUTHORIZED' } });
    expect(submit(testHarness, 'P1', 'RESILIENCY', '007')).toMatchObject({ status: 'RESOLVED', resultPayload: { choiceType: 'DESTINATION_PD' } });
    expect(testHarness.store.snapshot(state.id)!.cleanupContinuation!.viralOrigins[0]!.type).toBe('RESILIENCY');
  });

  it('GE-VIR-007 invariant — a tie with one owner-attributed type resolves that type without offering an invalid option', () => {
    const { testHarness, state } = setupViral({ malign: 9, resiliency: 9 });
    state.adjudication.influenceStacks.find(({ pdId, type }) => pdId === ORIGIN && type === 'RESILIENCY')!.attributionCountryId = 'FLUMA';
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(cleanup(testHarness, state, '007-single')).toMatchObject({ status: 'REQUIRES_CHOICE', resultPayload: { choiceType: 'DESTINATION_PD' } });
    expect(testHarness.store.snapshot(state.id)!.cleanupContinuation!.viralOrigins[0]!.type).toBe('MALIGN');
  });

  it('GE-VIR-008 — destination options share a demographic trait and invalid choices are atomic', () => {
    const { testHarness, state } = setupViral();
    cleanup(testHarness, state, '008'); const before = testHarness.store.snapshot(state.id)!;
    expect(before.viralChoice!.options).toContain(DESTINATION);
    const rejected = testHarness.app.execute(sessionId('P1'), command('SUBMIT_VIRAL_CHOICE', state.id, before.version, {
      continuationId: before.viralChoice!.id, selection: 'NOT_A_PD',
    }, { commandId: 'viral-choice-008-bad', idempotencyKey: 'viral-choice-key-008-bad' }));
    expect(rejected).toMatchObject({ status: 'REJECTED', error: { code: 'INVALID_CHOICE_OPTION' } });
    expect(testHarness.store.snapshot(state.id)).toEqual(before); expect(testHarness.random.cursor).toBe(0);
  });

  it('GE-VIR-009 — frozen origins are ordered by initiative and then PD id', () => {
    const { testHarness, state } = setupViral({ secondOrigin: true });
    state.initiative.orderParticipantIds.splice(0, 5, 'P2', 'P1', 'P3', 'P4', 'P5');
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    cleanup(testHarness, state, '009');
    expect(testHarness.store.snapshot(state.id)!.cleanupContinuation!.viralOrigins.map(({ ownerParticipantId }) => ownerParticipantId)).toEqual(['P2', 'P1']);
  });

  it('GE-VIR-010 — the snapshot prevents newly generated influence from cascading', () => {
    const { testHarness, state } = setupViral();
    state.adjudication.legitimacyByPd[DESTINATION] = 'P2';
    state.adjudication.influenceStacks.push({ pdId: DESTINATION, type: 'MALIGN', attributionCountryId: 'FLUMA', count: 8 });
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    testHarness.random.enqueue(6, 8); cleanup(testHarness, state, '010'); submit(testHarness, 'P1', DESTINATION, '010');
    const committed = testHarness.store.snapshot(state.id)!;
    expect(committed.phase).toBe('INITIATIVE_STAGE');
    expect(committed.events.filter(({ eventType }) => eventType === 'VIRAL_ATTEMPTED')).toHaveLength(1);
  });

  it('GE-VIR-011 — SHORT uses threshold six and consumes exactly one successful roll', () => {
    const { testHarness, state } = setupViral({ malign: 7, variant: 'SHORT' });
    testHarness.random.enqueue(6); testHarness.random.requireScript(); cleanup(testHarness, state, '011');
    expect(submit(testHarness, 'P1', DESTINATION, '011')).toMatchObject({ resultPayload: { resolution: { generated: 1, rollsConsumed: 1 } } });
    expect(testHarness.random.cursor).toBe(1);
  });

  it('GE-VIR-012 — thresholds are strict in both variants', () => {
    for (const [variant, malign] of [['BASELINE', 8], ['SHORT', 6]] as const) {
      const { testHarness, state } = setupViral({ variant, malign });
      expect(cleanup(testHarness, state, `012-${variant}`)).toMatchObject({ status: 'RESOLVED', resultCode: 'M2_CLEANUP_COMPLETED' });
      expect(testHarness.random.cursor).toBe(0);
    }
  });
});
