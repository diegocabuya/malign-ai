import type { ActorContext, AnyEngineErrorCode, CommandEnvelope, EngineCommandResult } from '@malign-ai/contracts';
import {
  BASE_2025_CARD_REGISTRY,
  BASE_2025_COUNTRIES,
  BASE_2025_POPULATION_DEMOGRAPHICS,
  M1_0_BASELINE_VERSIONS,
  cardInstanceId,
  type CountryId,
  type DiceMode,
  type RandomProvider,
  type SetupCardInstance,
  type SetupGameEvent,
  type SetupGameEventType,
  type SetupGameState,
} from '@malign-ai/domain';
import { dispatchAtomicCommand, InMemoryAtomicStateStore } from './atomic-dispatch.js';

export type SetupCommandType =
  | 'CREATE_GAME'
  | 'JOIN_GAME_MEMBERSHIP'
  | 'ASSIGN_PLAYER_SEAT'
  | 'CONFIGURE_GAME_OPTION'
  | 'START_GAME'
  | 'PAUSE_GAME'
  | 'RESUME_GAME'
  | 'SUBMIT_OPERATIONS_DECK'
  | 'LOCK_STRATEGY';

export interface CreateGamePayload {
  readonly scenarioDefinitionId: 'BASE_2025';
  readonly rulesetVersion: string;
  readonly scenarioVersion: string;
  readonly cardRegistryVersion: string;
  readonly engineContractVersion: string;
  readonly fixtureSchemaVersion: string;
  readonly turnLimit: number;
  readonly preferredDiceMode: DiceMode;
}

export interface AssignPlayerSeatPayload {
  readonly playerParticipantId: string;
  readonly countryId: CountryId;
  readonly seatIndex: number;
  readonly clockwiseIndex: number;
}

export type ConfigureGameOptionPayload =
  | { readonly optionId: 'TURN_LIMIT'; readonly value: number }
  | { readonly optionId: 'DICE_MODE'; readonly value: DiceMode };

export interface SubmitOperationsDeckPayload {
  readonly cardInstanceIds: readonly string[];
}

export interface PauseGamePayload {
  readonly reasonCode: string;
  readonly reasonText?: string;
}

export interface ResumeGamePayload {
  readonly reasonCode?: string;
}

export type SetupCommandPayload =
  | CreateGamePayload
  | AssignPlayerSeatPayload
  | ConfigureGameOptionPayload
  | SubmitOperationsDeckPayload
  | PauseGamePayload
  | ResumeGamePayload
  | Record<string, never>;

type SetupEnvelope = CommandEnvelope<SetupCommandType, SetupCommandPayload>;

const canonicalPlayerTopology = {
  P1: { countryId: 'ARDEN', index: 0 },
  P2: { countryId: 'FLUMA', index: 1 },
  P3: { countryId: 'URSARIA', index: 2 },
  P4: { countryId: 'PRESQUE', index: 3 },
  P5: { countryId: 'DINESIA', index: 4 },
} as const;

const canonicalPlayerIds = Object.keys(canonicalPlayerTopology);
const facilitatorCommands = new Set<SetupCommandType>([
  'CREATE_GAME',
  'ASSIGN_PLAYER_SEAT',
  'CONFIGURE_GAME_OPTION',
  'START_GAME',
  'PAUSE_GAME',
  'RESUME_GAME',
]);
const gameplayCommands = new Set<SetupCommandType>(['SUBMIT_OPERATIONS_DECK', 'LOCK_STRATEGY']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isDiceMode = (value: unknown): value is DiceMode => value === 'DIGITAL' || value === 'MANUAL_DIE_INPUT';

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value) && value >= 1;

export class InMemorySetupGameStore extends InMemoryAtomicStateStore<SetupGameState> {
  snapshot(gameId: string): SetupGameState | undefined { return this.load(gameId); }
}

export class SetupCommandDispatcher {
  constructor(
    private readonly store: InMemorySetupGameStore,
    private readonly random: RandomProvider,
    private readonly now: () => Date,
  ) {}

  dispatch(envelope: SetupEnvelope): EngineCommandResult {
    return dispatchAtomicCommand({
      envelope,
      store: this.store,
      now: this.now,
      prepare: (before, candidate) => this.prepare(before, candidate),
    });
  }

  private prepare(before: SetupGameState | undefined, envelope: SetupEnvelope) {
    const beforeVersion = before?.version ?? 0;
    if (envelope.engineContractVersion !== M1_0_BASELINE_VERSIONS.engineContractVersion) {
      return { error: 'UNSUPPORTED_CONTRACT_VERSION' as const, version: beforeVersion };
    }
    if (envelope.payloadSchemaVersion !== M1_0_BASELINE_VERSIONS.fixtureSchemaVersion) {
      return { error: 'UNSUPPORTED_PAYLOAD_VERSION' as const, version: beforeVersion };
    }
    if (envelope.commandType === 'CREATE_GAME') {
      if (before !== undefined) return { error: 'GAME_ALREADY_EXISTS' as const, version: before.version };
      if (envelope.expectedGameVersion !== 0) return { error: 'STALE_STATE_VERSION' as const, version: 0 };
      const actorError = this.validateCreateActor(envelope.actorContext);
      if (actorError !== undefined) return { error: actorError, version: 0 };
      return this.createGame(envelope);
    }
    if (before === undefined) return { error: 'GAME_NOT_FOUND' as const, version: 0 };
    if (envelope.gameId !== before.id) return { error: 'GAME_ID_MISMATCH' as const, version: before.version };
    if (envelope.expectedGameVersion !== before.version) return { error: 'STALE_STATE_VERSION' as const, version: before.version };
    const actorError = this.validateActor(before, envelope);
    if (actorError !== undefined) return { error: actorError, version: before.version };
    if (before.overlay === 'PAUSED' && gameplayCommands.has(envelope.commandType)) {
      return { error: 'GAME_PAUSED' as const, version: before.version };
    }

    const working = structuredClone(before);
    const outcome = this.reduce(working, envelope);
    if ('error' in outcome) return { error: outcome.error, version: before.version };
    return {
      nextState: working,
      resultCode: outcome.resultCode,
      ...(outcome.resultPayload === undefined ? {} : { resultPayload: outcome.resultPayload }),
      emittedEventRefs: outcome.events.map(({ id }) => id),
    };
  }

  private validateCreateActor(actor: ActorContext): AnyEngineErrorCode | undefined {
    if (actor.actorType !== 'FACILITATOR' || actor.participantId !== 'F1' || !actor.permissions.includes('game:create')) {
      return 'NOT_AUTHORIZED';
    }
    return undefined;
  }

  private validateActor(state: SetupGameState, envelope: SetupEnvelope): AnyEngineErrorCode | undefined {
    const { actorContext, commandType } = envelope;
    if (commandType === 'JOIN_GAME_MEMBERSHIP') {
      if (
        actorContext.actorType !== 'PLAYER' ||
        actorContext.participantId === undefined ||
        !canonicalPlayerIds.includes(actorContext.participantId) ||
        !actorContext.permissions.includes('game:join')
      ) return 'INVALID_ACTOR_CONTEXT';
      return undefined;
    }

    const participantId = actorContext.participantId;
    const participant = participantId === undefined ? undefined : state.participants[participantId];
    if (participant === undefined || participant.userId !== actorContext.actorId || participant.role !== actorContext.actorType) {
      return 'INVALID_ACTOR_CONTEXT';
    }
    if (facilitatorCommands.has(commandType)) {
      return participant.role === 'FACILITATOR' && participant.id === 'F1' && actorContext.permissions.includes('game:facilitate')
        ? undefined
        : 'NOT_AUTHORIZED';
    }
    if (participant.role !== 'PLAYER' || !actorContext.permissions.includes('game:play')) return 'NOT_AUTHORIZED';
    const seat = state.seats[participant.id];
    if (
      seat === undefined ||
      actorContext.playerSeatId !== seat.id ||
      actorContext.countryId !== seat.countryId
    ) return 'INVALID_ACTOR_CONTEXT';
    return undefined;
  }

  private createGame(envelope: SetupEnvelope) {
    const payload: unknown = envelope.payload;
    if (!this.validCreatePayload(payload)) return { error: 'INVALID_COMMAND_PAYLOAD' as const, version: 0 };
    if (payload.scenarioDefinitionId !== 'BASE_2025') return { error: 'UNSUPPORTED_SCENARIO' as const, version: 0 };
    if (!isPositiveInteger(payload.turnLimit)) return { error: 'INVALID_TURN_LIMIT' as const, version: 0 };
    if (!isDiceMode(payload.preferredDiceMode)) return { error: 'INVALID_DICE_MODE' as const, version: 0 };
    if (
      payload.rulesetVersion !== M1_0_BASELINE_VERSIONS.rulesetVersion ||
      payload.scenarioVersion !== M1_0_BASELINE_VERSIONS.scenarioVersion ||
      payload.cardRegistryVersion !== M1_0_BASELINE_VERSIONS.cardRegistryVersion ||
      payload.engineContractVersion !== M1_0_BASELINE_VERSIONS.engineContractVersion ||
      payload.fixtureSchemaVersion !== M1_0_BASELINE_VERSIONS.fixtureSchemaVersion
    ) return { error: 'INVALID_COMMAND_PAYLOAD' as const, version: 0 };

    const participantId = envelope.actorContext.participantId;
    if (participantId === undefined) return { error: 'INVALID_ACTOR_CONTEXT' as const, version: 0 };
    const countries = Object.fromEntries(BASE_2025_COUNTRIES.map((country) => [country.id, {
      id: country.id,
      resources: country.startingResources,
      turnIncome: country.turnIncome,
    }])) as SetupGameState['countries'];
    const populationDemographics = Object.fromEntries(
      BASE_2025_POPULATION_DEMOGRAPHICS.map((pd) => [pd.id, structuredClone(pd)]),
    );
    const cardDefinitions = Object.fromEntries(BASE_2025_CARD_REGISTRY.map((definition) => [definition.id, definition]));
    const cards: Record<string, SetupCardInstance> = {};
    for (const country of BASE_2025_COUNTRIES) {
      for (const definition of BASE_2025_CARD_REGISTRY) {
        const id = cardInstanceId(country.id, definition.serialWithinCountrySet);
        cards[id] = {
          id,
          gameId: envelope.gameId,
          countryOwnerId: country.id,
          definitionId: definition.id,
          serialWithinCountrySet: definition.serialWithinCountrySet,
          zone: definition.starter ? 'STARTER_POOL' : 'OPERATIONS_POOL',
        };
      }
    }

    const state: SetupGameState = {
      id: envelope.gameId,
      version: 0,
      scenarioId: 'BASE_2025',
      phase: 'SETUP',
      overlay: 'ACTIVE',
      versions: {
        rulesetVersion: payload.rulesetVersion,
        scenarioVersion: payload.scenarioVersion,
        cardRegistryVersion: payload.cardRegistryVersion,
        engineContractVersion: payload.engineContractVersion,
        fixtureSchemaVersion: payload.fixtureSchemaVersion,
      },
      facilitatorParticipantId: participantId,
      turnLimit: payload.turnLimit,
      diceMode: payload.preferredDiceMode,
      baseApPerTurn: 3,
      strategyDeckSize: 30,
      starterCardsPerPlayer: 5,
      handLimit: 10,
      participants: {
        [participantId]: {
          id: participantId,
          gameId: envelope.gameId,
          userId: envelope.actorContext.actorId,
          role: 'FACILITATOR',
          status: 'ACTIVE',
        },
      },
      seats: {},
      countries,
      populationDemographics,
      cardDefinitions,
      cards,
      strategy: {},
      events: [],
    };
    const event = this.appendEvent(state, envelope, 'GAME_CREATED', { phase: state.phase });
    return {
      nextState: state,
      resultCode: 'GAME_CREATED',
      resultPayload: { gameId: state.id, status: state.phase, pinnedVersions: state.versions },
      emittedEventRefs: [event.id],
    };
  }

  private validCreatePayload(payload: unknown): payload is CreateGamePayload {
    return isRecord(payload) &&
      typeof payload.scenarioDefinitionId === 'string' &&
      typeof payload.rulesetVersion === 'string' &&
      typeof payload.scenarioVersion === 'string' &&
      typeof payload.cardRegistryVersion === 'string' &&
      typeof payload.engineContractVersion === 'string' &&
      typeof payload.fixtureSchemaVersion === 'string' &&
      typeof payload.turnLimit === 'number' &&
      typeof payload.preferredDiceMode === 'string';
  }

  private reduce(state: SetupGameState, envelope: SetupEnvelope):
    | { readonly resultCode: string; readonly resultPayload?: unknown; readonly events: SetupGameEvent[] }
    | { readonly error: AnyEngineErrorCode } {
    switch (envelope.commandType) {
      case 'JOIN_GAME_MEMBERSHIP': return this.join(state, envelope);
      case 'ASSIGN_PLAYER_SEAT': return this.assignSeat(state, envelope);
      case 'CONFIGURE_GAME_OPTION': return this.configureOption(state, envelope);
      case 'START_GAME': return this.startGame(state, envelope);
      case 'PAUSE_GAME': return this.pause(state, envelope);
      case 'RESUME_GAME': return this.resume(state, envelope);
      case 'SUBMIT_OPERATIONS_DECK': return this.submitDeck(state, envelope);
      case 'LOCK_STRATEGY': return this.lockStrategy(state, envelope);
      case 'CREATE_GAME': return { error: 'GAME_ALREADY_EXISTS' };
    }
  }

  private join(state: SetupGameState, envelope: SetupEnvelope) {
    if (state.phase !== 'SETUP') return { error: 'WRONG_PHASE' as const };
    const participantId = envelope.actorContext.participantId;
    if (participantId === undefined) return { error: 'INVALID_ACTOR_CONTEXT' as const };
    if (state.participants[participantId] !== undefined) return { error: 'PARTICIPANT_ALREADY_EXISTS' as const };
    state.participants[participantId] = {
      id: participantId,
      gameId: state.id,
      userId: envelope.actorContext.actorId,
      role: 'PLAYER',
      status: 'ACTIVE',
    };
    const event = this.appendEvent(state, envelope, 'PARTICIPANT_JOINED', { participantId });
    return { resultCode: 'PARTICIPANT_JOINED', resultPayload: { participantId }, events: [event] };
  }

  private assignSeat(state: SetupGameState, envelope: SetupEnvelope) {
    if (state.phase !== 'SETUP') return { error: 'SEAT_ASSIGNMENT_LOCKED' as const };
    const payload: unknown = envelope.payload;
    if (!this.validSeatPayload(payload)) return { error: 'INVALID_COMMAND_PAYLOAD' as const };
    const participant = state.participants[payload.playerParticipantId];
    if (participant === undefined || participant.role !== 'PLAYER') return { error: 'PARTICIPANT_NOT_FOUND' as const };
    if (state.seats[payload.playerParticipantId] !== undefined) return { error: 'PARTICIPANT_ALREADY_SEATED' as const };
    if (Object.values(state.seats).some(({ countryId }) => countryId === payload.countryId)) return { error: 'COUNTRY_ALREADY_ASSIGNED' as const };
    if (Object.values(state.seats).some(({ seatIndex }) => seatIndex === payload.seatIndex)) return { error: 'SEAT_INDEX_ALREADY_ASSIGNED' as const };
    if (Object.values(state.seats).some(({ clockwiseIndex }) => clockwiseIndex === payload.clockwiseIndex)) return { error: 'CLOCKWISE_INDEX_ALREADY_ASSIGNED' as const };
    const seat = {
      id: `${state.id}:SEAT:${payload.seatIndex}`,
      gameId: state.id,
      participantId: payload.playerParticipantId,
      seatIndex: payload.seatIndex,
      clockwiseIndex: payload.clockwiseIndex,
      countryId: payload.countryId,
    };
    state.seats[payload.playerParticipantId] = seat;
    state.countries[payload.countryId].controllerParticipantId = payload.playerParticipantId;
    for (const card of Object.values(state.cards)) {
      if (card.countryOwnerId === payload.countryId) card.controllerParticipantId = payload.playerParticipantId;
    }
    state.strategy[payload.playerParticipantId] = {
      participantId: payload.playerParticipantId,
      submittedCardInstanceIds: [],
      operationsDeckOrder: [],
      handCardInstanceIds: [],
      locked: false,
    };
    const event = this.appendEvent(state, envelope, 'PLAYER_SEAT_ASSIGNED', {
      participantId: payload.playerParticipantId,
      countryId: payload.countryId,
      seatIndex: payload.seatIndex,
      clockwiseIndex: payload.clockwiseIndex,
    });
    return { resultCode: 'PLAYER_SEAT_ASSIGNED', resultPayload: seat, events: [event] };
  }

  private validSeatPayload(payload: unknown): payload is AssignPlayerSeatPayload {
    return isRecord(payload) &&
      typeof payload.playerParticipantId === 'string' &&
      BASE_2025_COUNTRIES.some(({ id }) => id === payload.countryId) &&
      typeof payload.seatIndex === 'number' && Number.isInteger(payload.seatIndex) && payload.seatIndex >= 0 && payload.seatIndex <= 4 &&
      typeof payload.clockwiseIndex === 'number' && Number.isInteger(payload.clockwiseIndex) && payload.clockwiseIndex >= 0 && payload.clockwiseIndex <= 4;
  }

  private configureOption(state: SetupGameState, envelope: SetupEnvelope) {
    if (state.phase !== 'SETUP') return { error: 'WRONG_PHASE' as const };
    const payload: unknown = envelope.payload;
    if (!isRecord(payload) || (payload.optionId !== 'TURN_LIMIT' && payload.optionId !== 'DICE_MODE')) {
      return { error: 'INVALID_COMMAND_PAYLOAD' as const };
    }
    if (payload.optionId === 'TURN_LIMIT') {
      if (!isPositiveInteger(payload.value)) return { error: 'INVALID_TURN_LIMIT' as const };
      state.turnLimit = payload.value;
    } else {
      if (!isDiceMode(payload.value)) return { error: 'INVALID_DICE_MODE' as const };
      state.diceMode = payload.value;
    }
    const event = this.appendEvent(state, envelope, 'GAME_OPTION_CONFIGURED', { optionId: payload.optionId });
    return { resultCode: 'GAME_OPTION_CONFIGURED', events: [event] };
  }

  private startGame(state: SetupGameState, envelope: SetupEnvelope) {
    if (state.phase !== 'SETUP') return { error: 'WRONG_PHASE' as const };
    if (!this.validStartState(state)) return { error: 'SETUP_INVALID' as const };
    state.phase = 'STRATEGY_STAGE';
    const started = this.appendEvent(state, envelope, 'GAME_STARTED', { phase: state.phase });
    const phaseChanged = this.appendEvent(state, envelope, 'PHASE_CHANGED', { phase: state.phase });
    return { resultCode: 'GAME_STARTED', events: [started, phaseChanged] };
  }

  private validStartState(state: SetupGameState): boolean {
    if (!isPositiveInteger(state.turnLimit)) return false;
    const participants = Object.values(state.participants);
    if (
      participants.filter(({ role }) => role === 'FACILITATOR').length !== 1 ||
      state.participants.F1?.role !== 'FACILITATOR' ||
      state.facilitatorParticipantId !== 'F1'
    ) return false;
    if (participants.filter(({ role }) => role === 'PLAYER').length !== 5 || Object.keys(state.seats).length !== 5) return false;
    if (Object.keys(state.countries).length !== 5 || Object.keys(state.populationDemographics).length !== 14) return false;
    for (const participantId of canonicalPlayerIds) {
      const expected = canonicalPlayerTopology[participantId as keyof typeof canonicalPlayerTopology];
      const participant = state.participants[participantId];
      const seat = state.seats[participantId];
      if (
        participant?.role !== 'PLAYER' ||
        seat?.countryId !== expected.countryId ||
        seat.seatIndex !== expected.index ||
        seat.clockwiseIndex !== expected.index
      ) return false;
    }
    const cardIds = new Set(Object.keys(state.cards));
    if (cardIds.size !== 540) return false;
    return BASE_2025_COUNTRIES.every((country) => {
      const countryCards = Object.values(state.cards).filter(({ countryOwnerId }) => countryOwnerId === country.id);
      return countryCards.length === 108 &&
        countryCards.filter((card) => state.cardDefinitions[card.definitionId]?.starter === true).length === 5 &&
        countryCards.every(({ controllerParticipantId }) => controllerParticipantId === state.countries[country.id].controllerParticipantId);
    });
  }

  private pause(state: SetupGameState, envelope: SetupEnvelope) {
    if (state.overlay === 'PAUSED') return { error: 'GAME_PAUSED' as const };
    state.overlay = 'PAUSED';
    const rawPayload: unknown = envelope.payload;
    const payload = isRecord(rawPayload) && typeof rawPayload.reasonCode === 'string'
      ? { reasonCode: rawPayload.reasonCode }
      : { reasonCode: 'FACILITATOR_PAUSE' };
    const event = this.appendEvent(state, envelope, 'GAME_PAUSED', payload);
    return { resultCode: 'GAME_PAUSED', events: [event] };
  }

  private resume(state: SetupGameState, envelope: SetupEnvelope) {
    if (state.overlay !== 'PAUSED') return { error: 'ILLEGAL_STATE_TRANSITION' as const };
    state.overlay = 'ACTIVE';
    const event = this.appendEvent(state, envelope, 'GAME_RESUMED', {});
    return { resultCode: 'GAME_RESUMED', events: [event] };
  }

  private submitDeck(state: SetupGameState, envelope: SetupEnvelope) {
    if (state.phase !== 'STRATEGY_STAGE') return { error: 'WRONG_PHASE' as const };
    const participantId = envelope.actorContext.participantId;
    if (participantId === undefined) return { error: 'INVALID_ACTOR_CONTEXT' as const };
    const strategy = state.strategy[participantId];
    if (strategy === undefined) return { error: 'NOT_AUTHORIZED' as const };
    if (strategy.locked) return { error: 'STRATEGY_ALREADY_LOCKED' as const };
    const payload: unknown = envelope.payload;
    if (!isRecord(payload) || !Array.isArray(payload.cardInstanceIds) || !payload.cardInstanceIds.every((id) => typeof id === 'string')) {
      return { error: 'INVALID_COMMAND_PAYLOAD' as const };
    }
    const selected = payload.cardInstanceIds;
    const eligibilityError = this.deckEligibilityError(state, participantId, selected);
    if (eligibilityError !== undefined) return { error: eligibilityError };
    strategy.submittedCardInstanceIds = [...selected];
    const event = this.appendEvent(state, envelope, 'OPERATIONS_DECK_SUBMITTED', { participantId, count: selected.length });
    return { resultCode: 'OPERATIONS_DECK_SUBMITTED', events: [event] };
  }

  private lockStrategy(state: SetupGameState, envelope: SetupEnvelope) {
    if (state.phase !== 'STRATEGY_STAGE') return { error: 'WRONG_PHASE' as const };
    const participantId = envelope.actorContext.participantId;
    if (participantId === undefined) return { error: 'INVALID_ACTOR_CONTEXT' as const };
    const strategy = state.strategy[participantId];
    if (strategy === undefined) return { error: 'NOT_AUTHORIZED' as const };
    if (strategy.locked) return { error: 'STRATEGY_ALREADY_LOCKED' as const };
    if (strategy.submittedCardInstanceIds.length === 0) return { error: 'STRATEGY_DECK_NOT_SUBMITTED' as const };
    const eligibilityError = this.deckEligibilityError(state, participantId, strategy.submittedCardInstanceIds);
    if (eligibilityError !== undefined) return { error: eligibilityError };

    const starterIds = Object.values(state.cards)
      .filter((card) => card.controllerParticipantId === participantId && state.cardDefinitions[card.definitionId]?.starter === true)
      .sort((a, b) => a.serialWithinCountrySet - b.serialWithinCountrySet)
      .map(({ id }) => id);
    if (starterIds.length !== 5) return { error: 'SETUP_INVALID' as const };
    let shuffled: string[];
    try {
      shuffled = this.shuffle(strategy.submittedCardInstanceIds);
    } catch {
      return { error: 'RANDOM_PROVIDER_FAILURE' as const };
    }

    for (const cardId of strategy.submittedCardInstanceIds) {
      const card = state.cards[cardId];
      if (card === undefined) return { error: 'CARD_NOT_CONTROLLED' as const };
      card.zone = 'OPERATIONS_DECK';
      delete card.zonePosition;
    }
    for (const cardId of starterIds) {
      const card = state.cards[cardId];
      if (card === undefined) return { error: 'CARD_NOT_CONTROLLED' as const };
      card.zone = 'HAND';
      delete card.zonePosition;
    }
    const drawn = shuffled.slice(0, 5);
    const remaining = shuffled.slice(5);
    for (const cardId of drawn) {
      const card = state.cards[cardId];
      if (card === undefined) return { error: 'CARD_NOT_CONTROLLED' as const };
      card.zone = 'HAND';
      delete card.zonePosition;
    }
    remaining.forEach((cardId, index) => {
      const card = state.cards[cardId];
      if (card !== undefined) card.zonePosition = index;
    });
    strategy.operationsDeckOrder = remaining;
    strategy.handCardInstanceIds = [...starterIds, ...drawn];
    strategy.locked = true;

    const events: SetupGameEvent[] = [
      this.appendEvent(state, envelope, 'DECK_SHUFFLED', { participantId, count: shuffled.length }),
      ...drawn.map((cardId, index) => this.appendEvent(state, envelope, 'CARD_DRAWN', { participantId, cardInstanceId: cardId, drawIndex: index + 1 })),
      this.appendEvent(state, envelope, 'PLAYER_READY_CHANGED', { participantId, strategyLocked: true }),
    ];
    if (canonicalPlayerIds.every((id) => state.strategy[id]?.locked === true)) {
      state.phase = 'INITIATIVE_STAGE';
      events.push(this.appendEvent(state, envelope, 'PHASE_CHANGED', { phase: state.phase }));
    }
    return { resultCode: 'STRATEGY_LOCKED', events };
  }

  private deckEligibilityError(state: SetupGameState, participantId: string, selected: readonly string[]): AnyEngineErrorCode | undefined {
    if (selected.length !== 30) return 'STRATEGY_DECK_SIZE_INVALID';
    if (new Set(selected).size !== selected.length) return 'DUPLICATE_CARD_INSTANCE';
    for (const cardId of selected) {
      const card = state.cards[cardId];
      if (card === undefined || card.controllerParticipantId !== participantId) return 'CARD_NOT_CONTROLLED';
      if (state.cardDefinitions[card.definitionId]?.starter !== false) return 'CARD_NOT_ELIGIBLE';
      if (card.zone !== 'OPERATIONS_POOL') return 'CARD_WRONG_ZONE';
    }
    return undefined;
  }

  private shuffle(input: readonly string[]): string[] {
    const output = [...input];
    for (let index = output.length - 1; index > 0; index -= 1) {
      const swapIndex = this.random.integer(0, index);
      const current = output[index];
      const swap = output[swapIndex];
      if (current === undefined || swap === undefined) throw new Error('Invalid shuffle index');
      output[index] = swap;
      output[swapIndex] = current;
    }
    return output;
  }

  private appendEvent(
    state: SetupGameState,
    envelope: SetupEnvelope,
    type: SetupGameEventType,
    payload: Readonly<Record<string, string | number | boolean>>,
  ): SetupGameEvent {
    const sequenceNumber = state.events.length + 1;
    const event: SetupGameEvent = {
      id: `${envelope.commandId}:${type.toLowerCase()}:${sequenceNumber}`,
      gameId: state.id,
      type,
      sequenceNumber,
      gameVersion: state.version + 1,
      actorId: envelope.actorContext.actorId,
      occurredAt: this.now().toISOString(),
      payload,
    };
    state.events.push(event);
    return event;
  }
}
