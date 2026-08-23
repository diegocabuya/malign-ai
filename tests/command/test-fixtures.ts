import type { ActorContext, CommandEnvelope } from '../../packages/contracts/src/index.js';
import { CommandDispatcher, InMemoryGameStore, type GameCommandPayload, type GameCommandType, type GameState } from '../../packages/game-engine/src/index.js';

export const fixedNow = () => new Date('2026-08-23T00:00:00.000Z');
export const actor = (participantId = 'P1'): ActorContext => ({ actorId: `actor-${participantId}`, actorType: 'PLAYER', participantId, authenticatedSessionId: `session-${participantId}`, permissions: [] });

export const makeState = (): GameState => ({
  id: 'game-1', version: 0, phase: 'ACTION_STAGE_PLAN', overlay: 'ACTIVE',
  participants: {
    P1: { id: 'P1', actionPointsAvailable: 3, resources: 10, plan: [], planStatus: 'EDITING' },
    P2: { id: 'P2', actionPointsAvailable: 3, resources: 10, plan: [], planStatus: 'EDITING' },
  },
  cardDefinitions: {
    INTENT_M: { id: 'INTENT_M', alignment: 'MALIGN', influenceValueBySlot: { INTENT: 4 }, targetDtId: 'ASIAN' },
    INTENT_R: { id: 'INTENT_R', alignment: 'RESILIENCY', influenceValueBySlot: { INTENT: 4 }, targetDtId: 'ASIAN' },
    METHOD_M: { id: 'METHOD_M', alignment: 'MALIGN', influenceValueBySlot: { METHOD: 6 } },
    METHOD_R: { id: 'METHOD_R', alignment: 'RESILIENCY', influenceValueBySlot: { METHOD: 6 } },
    MULTI_M: { id: 'MULTI_M', alignment: 'MALIGN', influenceValueBySlot: { METHOD: 2, AMPLIFIER: 5 } },
    AMP_M: { id: 'AMP_M', alignment: 'MALIGN', influenceValueBySlot: { AMPLIFIER: 2 } },
    PAIR_LEFT: { id: 'PAIR_LEFT', alignment: 'MALIGN', influenceValueBySlot: { INTENT: 4 }, targetDtId: 'ASIAN', pairBonusWith: 'PAIR_RIGHT' },
    PAIR_RIGHT: { id: 'PAIR_RIGHT', alignment: 'MALIGN', influenceValueBySlot: { METHOD: 6 } },
  },
  cards: {
    intent1: { id: 'intent1', definitionId: 'INTENT_M', controllerParticipantId: 'P1', zone: 'HAND' },
    intentP2: { id: 'intentP2', definitionId: 'INTENT_M', controllerParticipantId: 'P2', zone: 'HAND' },
    method1: { id: 'method1', definitionId: 'METHOD_M', controllerParticipantId: 'P1', zone: 'HAND' },
    methodR: { id: 'methodR', definitionId: 'METHOD_R', controllerParticipantId: 'P1', zone: 'HAND' },
    multi1: { id: 'multi1', definitionId: 'MULTI_M', controllerParticipantId: 'P1', zone: 'HAND' },
    amp1: { id: 'amp1', definitionId: 'AMP_M', controllerParticipantId: 'P1', zone: 'HAND' },
    pairLeft: { id: 'pairLeft', definitionId: 'PAIR_LEFT', controllerParticipantId: 'P1', zone: 'HAND' },
    pairRight: { id: 'pairRight', definitionId: 'PAIR_RIGHT', controllerParticipantId: 'P1', zone: 'HAND' },
  },
  campaigns: {},
  populationDemographics: { pdAsian: { id: 'pdAsian', demographicTokenIds: ['ASIAN'] }, pdOther: { id: 'pdOther', demographicTokenIds: ['OTHER'] } },
  events: [],
});

export const makeCampaignState = (usePair = false): GameState => {
  const state = makeState();
  state.phase = 'RESOLUTION_STAGE';
  const intentId = usePair ? 'pairLeft' : 'intent1';
  const methodId = usePair ? 'pairRight' : 'method1';
  state.cards[intentId]!.zone = 'CAMPAIGN';
  state.cards[methodId]!.zone = 'CAMPAIGN';
  state.campaigns['campaign-1'] = { id: 'campaign-1', ownerParticipantId: 'P1', row: 'I', alignment: 'MALIGN', targetDtId: 'ASIAN', assignments: [{ slot: 'INTENT', cardInstanceId: intentId }, { slot: 'METHOD', cardInstanceId: methodId }], activatedCountThisTurn: 0 };
  return state;
};

let commandCounter = 0;
export const envelope = <T extends GameCommandPayload>(commandType: GameCommandType, payload: T, expectedGameVersion = 0, participantId = 'P1'): CommandEnvelope<GameCommandType, GameCommandPayload> => {
  commandCounter += 1;
  return { engineContractVersion: '0.1', commandId: `command-${commandCounter}`, idempotencyKey: `key-${commandCounter}`, gameId: 'game-1', actorContext: actor(participantId), expectedGameVersion, commandType, payloadSchemaVersion: '0.1', payload };
};
export const harness = (state = makeState()) => { const store = new InMemoryGameStore(state); return { store, dispatcher: new CommandDispatcher(store, fixedNow) }; };
export const constructPayload = { campaignId: 'campaign-1', intentCardInstanceId: 'intent1', methodCardInstanceId: 'method1', targetDtId: 'ASIAN' } as const;
export const constructCampaign = (dispatcher: CommandDispatcher, expectedVersion = 0) => dispatcher.dispatch(envelope('CONSTRUCT_CAMPAIGN', constructPayload, expectedVersion));
