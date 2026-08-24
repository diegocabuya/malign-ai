import { readFileSync } from 'node:fs';
import type { ActorContext, CommandEnvelope } from '../../packages/contracts/src/index.js';
import {
  cardInstanceId,
  type CountryId,
  type InfluenceStackState,
  type SetupGameState,
} from '../../packages/domain/src/index.js';
import {
  M1AdjudicationEngine,
  type SubmitChoicePayload,
} from '../../packages/game-engine/src/index.js';
import {
  PLAYER_IDS,
  lockPlan,
  reachActionPlanning,
  savePlan,
} from '../m1-1/test-fixtures.js';
import {
  GAME_ID,
  harness,
  trustedBindings,
  type M1Harness,
} from '../m1-0/test-fixtures.js';

export { GAME_ID };

interface FullCampaignFixture {
  readonly fixture_schema_version: string;
  readonly game_id: string;
  readonly actor_participant_id: string;
  readonly actor_country_id: CountryId;
  readonly resources_before_activation: number;
  readonly campaign_id: string;
  readonly intent: { readonly serial: number; readonly name: string; readonly slot: 'INTENT'; readonly iv: number };
  readonly method: { readonly serial: number; readonly name: string; readonly slot: 'METHOD'; readonly iv: number };
  readonly amplifier: { readonly serial: number; readonly name: string; readonly slot: 'AMPLIFIER'; readonly iv: number };
  readonly alignment: 'MALIGN';
  readonly target_dt: string;
  readonly target_pd: string;
  readonly narrative: string;
  readonly die: number;
  readonly expected: Readonly<Record<string, string | number>>;
}

interface MixedAttributionFixture {
  readonly pd_id: string;
  readonly opposite_type: 'RESILIENCY';
  readonly stacks: readonly { readonly participant_id: string; readonly country_id: CountryId; readonly count: number }[];
  readonly incoming: { readonly type: 'MALIGN'; readonly country_id: CountryId; readonly count: number };
  readonly selection: readonly string[];
  readonly expected: { readonly consumed: number; readonly removed: Readonly<Record<string, number>>; readonly placed: number };
}

const loadJson = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8')) as T;

export const FULL_CAMPAIGN = loadJson<FullCampaignFixture>('../fixtures/m1-2/full-campaign-m1.json');
export const MIXED_ATTRIBUTION = loadJson<MixedAttributionFixture>('../fixtures/m1-2/pd-mixed-attribution.json');

let cachedPlanningState: SetupGameState | undefined;

export const planningState = (): SetupGameState => {
  if (cachedPlanningState === undefined) {
    const base = harness();
    cachedPlanningState = reachActionPlanning(base);
  }
  return structuredClone(cachedPlanningState);
};

const placeRequiredCardsInHand = (
  state: SetupGameState,
  participantId: string,
  serials: readonly number[],
): void => {
  const strategy = state.strategy[participantId];
  const countryId = state.seats[participantId]?.countryId;
  if (strategy === undefined || countryId === undefined) throw new Error('M1-2 fixture participant is incomplete');
  const requiredIds = serials.map((serial) => cardInstanceId(countryId, serial));
  for (const requiredId of requiredIds) {
    if (strategy.handCardInstanceIds.includes(requiredId)) continue;
    const displacedId = strategy.handCardInstanceIds.find((cardId) => {
      const card = state.cards[cardId];
      return card !== undefined && !requiredIds.includes(cardId) && state.cardDefinitions[card.definitionId]?.starter === false;
    });
    if (displacedId === undefined) throw new Error('M1-2 fixture has no replaceable hand card');
    strategy.handCardInstanceIds = strategy.handCardInstanceIds.filter((id) => id !== displacedId);
    strategy.operationsDeckOrder = strategy.operationsDeckOrder.filter((id) => id !== requiredId);
    const displaced = state.cards[displacedId];
    const required = state.cards[requiredId];
    if (displaced === undefined || required === undefined) throw new Error('M1-2 fixture card missing');
    displaced.zone = 'OPERATIONS_DECK';
    required.zone = 'HAND';
    delete required.zonePosition;
    strategy.operationsDeckOrder.push(displacedId);
    strategy.handCardInstanceIds.push(requiredId);
  }
  strategy.operationsDeckOrder.forEach((cardId, index) => {
    const card = state.cards[cardId];
    if (card !== undefined) card.zonePosition = index;
  });
};

export interface AdjudicationHarness extends M1Harness {
  readonly engine: M1AdjudicationEngine;
}

export const adjudicationHarness = (options: {
  readonly serials?: readonly number[];
  readonly targetDt?: string;
  readonly targetPd?: string;
  readonly die?: number;
  readonly mixedAttribution?: boolean;
  readonly legitimacyOwner?: string | null;
  readonly resources?: number;
  readonly vp?: number;
} = {}): AdjudicationHarness => {
  const testHarness = harness({ states: [planningState()], bindings: trustedBindings() });
  for (const participantId of ['F1', ...PLAYER_IDS]) {
    testHarness.authority.materializeMembership(`session-${participantId.toLowerCase()}`, GAME_ID, participantId);
  }
  const state = testHarness.store.snapshot(GAME_ID);
  if (state === undefined) throw new Error('M1-2 planning state missing');
  const serials = options.serials ?? [FULL_CAMPAIGN.intent.serial, FULL_CAMPAIGN.method.serial, FULL_CAMPAIGN.amplifier.serial];
  placeRequiredCardsInHand(state, 'P1', serials);
  const targetDt = options.targetDt ?? FULL_CAMPAIGN.target_dt;
  const targetPd = options.targetPd ?? FULL_CAMPAIGN.target_pd;
  state.countries.ARDEN.resources = options.resources ?? FULL_CAMPAIGN.resources_before_activation;
  state.adjudication.vpByParticipant.P1 = options.vp ?? 0;
  state.adjudication.narrativesByCampaign[FULL_CAMPAIGN.campaign_id] = FULL_CAMPAIGN.narrative;
  state.adjudication.legitimacyByPd[targetPd] = options.legitimacyOwner ?? null;
  if (options.mixedAttribution === true) {
    const retained = state.adjudication.influenceStacks.filter(({ pdId }) => pdId !== MIXED_ATTRIBUTION.pd_id);
    state.adjudication.influenceStacks.splice(0, state.adjudication.influenceStacks.length, ...retained);
    state.adjudication.influenceStacks.push(...MIXED_ATTRIBUTION.stacks.map((stack): InfluenceStackState => ({
      pdId: MIXED_ATTRIBUTION.pd_id,
      type: MIXED_ATTRIBUTION.opposite_type,
      attributionCountryId: stack.country_id,
      count: stack.count,
    })));
  }
  if (!testHarness.store.commitState(GAME_ID, state.version, state)) throw new Error('M1-2 fixture seed CAS failed');
  const [intentSerial, methodSerial, amplifierSerial] = serials;
  if (intentSerial === undefined || methodSerial === undefined) throw new Error('M1-2 fixture needs Intent and Method');
  const slots = [
    {
      sequenceIndex: 1,
      actionType: 'CONSTRUCT_CAMPAIGN' as const,
      actionPayload: {
        row: 'I' as const,
        intentCardInstanceId: cardInstanceId('ARDEN', intentSerial),
        methodCardInstanceId: cardInstanceId('ARDEN', methodSerial),
        ...(amplifierSerial === undefined ? {} : { amplifierCardInstanceId: cardInstanceId('ARDEN', amplifierSerial) }),
        targetDtId: targetDt,
      },
    },
    {
      sequenceIndex: 2,
      actionType: 'ACTIVATE_CAMPAIGN' as const,
      actionPayload: { campaignId: FULL_CAMPAIGN.campaign_id, requestedTargetPdId: targetPd },
    },
  ];
  const p1Plan = savePlan(testHarness, 'P1', slots);
  if (p1Plan.status !== 'RESOLVED') throw new Error(`M1-2 P1 plan save failed: ${p1Plan.resultCode}`);
  if (lockPlan(testHarness, 'P1').status !== 'RESOLVED') throw new Error('M1-2 P1 plan lock failed');
  for (const participantId of PLAYER_IDS.slice(1)) {
    if (savePlan(testHarness, participantId, []).status !== 'RESOLVED') throw new Error(`M1-2 ${participantId} pass save failed`);
    if (lockPlan(testHarness, participantId).status !== 'RESOLVED') throw new Error(`M1-2 ${participantId} pass lock failed`);
  }
  testHarness.random.enqueue(options.die ?? FULL_CAMPAIGN.die);
  testHarness.random.requireScript();
  return {
    ...testHarness,
    engine: new M1AdjudicationEngine(testHarness.store, testHarness.random, () => new Date('2026-08-24T12:00:00.000Z')),
  };
};

export const runConstruct = (testHarness: AdjudicationHarness) => {
  const state = testHarness.store.snapshot(GAME_ID);
  if (state === undefined) throw new Error('M1-2 state missing');
  return testHarness.engine.runNext({
    gameId: GAME_ID,
    expectedGameVersion: state.version,
    commandId: `scheduler-construct-${state.version}`,
    idempotencyKey: `scheduler-construct-${state.version}`,
    correlationId: 'm1-2-full-campaign',
  });
};

export const runActivation = (testHarness: AdjudicationHarness) => {
  const state = testHarness.store.snapshot(GAME_ID);
  if (state === undefined) throw new Error('M1-2 state missing');
  return testHarness.engine.runNext({
    gameId: GAME_ID,
    expectedGameVersion: state.version,
    commandId: `scheduler-activate-${state.version}`,
    idempotencyKey: `scheduler-activate-${state.version}`,
    correlationId: 'm1-2-full-campaign',
  });
};

export const playerActor = (participantId: string): ActorContext => {
  const state = planningState();
  const participant = state.participants[participantId];
  const seat = state.seats[participantId];
  if (participant === undefined || seat === undefined) throw new Error('Actor fixture missing');
  return {
    actorId: participant.userId,
    actorType: 'PLAYER',
    participantId,
    playerSeatId: seat.id,
    countryId: seat.countryId,
    authenticatedSessionId: `session-${participantId.toLowerCase()}`,
    permissions: ['game:play'],
  };
};

export const choiceEnvelope = (
  state: SetupGameState,
  participantId: string,
  payload: SubmitChoicePayload,
  suffix: string,
): CommandEnvelope<string, unknown> => ({
  engineContractVersion: state.versions.engineContractVersion,
  commandId: `choice-${suffix}`,
  idempotencyKey: `choice-${suffix}`,
  gameId: state.id,
  actorContext: playerActor(participantId),
  expectedGameVersion: state.version,
  commandType: 'SUBMIT_CHOICE',
  payloadSchemaVersion: state.versions.fixtureSchemaVersion,
  payload,
  correlationId: 'm1-2-full-campaign',
});
