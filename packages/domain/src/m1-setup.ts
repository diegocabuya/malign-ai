export type CountryId = 'ARDEN' | 'FLUMA' | 'URSARIA' | 'PRESQUE' | 'DINESIA';
export type ParticipantRole = 'FACILITATOR' | 'PLAYER';
export type ParticipantStatus = 'ACTIVE';
export type SetupGamePhase = 'SETUP' | 'STRATEGY_STAGE' | 'INITIATIVE_STAGE';
export type SetupGameOverlay = 'ACTIVE' | 'PAUSED';
export type DiceMode = 'DIGITAL' | 'MANUAL_DIE_INPUT';
export type SetupCardZone = 'STARTER_POOL' | 'OPERATIONS_POOL' | 'OPERATIONS_DECK' | 'HAND';

export interface PinnedVersions {
  readonly rulesetVersion: string;
  readonly scenarioVersion: string;
  readonly cardRegistryVersion: string;
  readonly engineContractVersion: string;
  readonly fixtureSchemaVersion: string;
}

export interface GameParticipant {
  readonly id: string;
  readonly gameId: string;
  readonly userId: string;
  readonly role: ParticipantRole;
  readonly status: ParticipantStatus;
}

export interface PlayerSeat {
  readonly id: string;
  readonly gameId: string;
  readonly participantId: string;
  readonly seatIndex: number;
  readonly clockwiseIndex: number;
  readonly countryId: CountryId;
}

export interface GameCountry {
  readonly id: CountryId;
  controllerParticipantId?: string;
  resources: number;
  readonly turnIncome: number;
}

export interface ScenarioPopulationDemographic {
  readonly id: string;
  readonly hostCountryId: CountryId;
  readonly localIndex: number;
  readonly gamebookLabel: string;
  readonly boardLabel: string;
  readonly demographicTokenIds: readonly string[];
  readonly initialInfluence: {
    readonly type: 'MALIGN' | 'RESILIENCY';
    readonly count: number;
    readonly attributionCountryId: CountryId;
    readonly source: 'SCENARIO_SETUP';
  };
}

export interface SetupCardDefinition {
  readonly id: string;
  readonly serialWithinCountrySet: number;
  readonly canonicalName: string;
  readonly starter: boolean;
}

export interface SetupCardInstance {
  readonly id: string;
  readonly gameId: string;
  readonly countryOwnerId: CountryId;
  readonly definitionId: string;
  readonly serialWithinCountrySet: number;
  controllerParticipantId?: string;
  zone: SetupCardZone;
  zonePosition?: number;
}

export interface StrategySetupState {
  readonly participantId: string;
  submittedCardInstanceIds: string[];
  operationsDeckOrder: string[];
  handCardInstanceIds: string[];
  locked: boolean;
}

export type SetupGameEventType =
  | 'GAME_CREATED'
  | 'PARTICIPANT_JOINED'
  | 'PLAYER_SEAT_ASSIGNED'
  | 'GAME_OPTION_CONFIGURED'
  | 'GAME_STARTED'
  | 'PHASE_CHANGED'
  | 'OPERATIONS_DECK_SUBMITTED'
  | 'DECK_SHUFFLED'
  | 'CARD_DRAWN'
  | 'PLAYER_READY_CHANGED'
  | 'GAME_PAUSED'
  | 'GAME_RESUMED';

export interface SetupGameEvent {
  readonly id: string;
  readonly gameId: string;
  readonly type: SetupGameEventType;
  readonly sequenceNumber: number;
  readonly gameVersion: number;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly payload: Readonly<Record<string, string | number | boolean>>;
}

export interface SetupGameState {
  readonly id: string;
  version: number;
  readonly scenarioId: 'BASE_2025';
  phase: SetupGamePhase;
  overlay: SetupGameOverlay;
  readonly versions: PinnedVersions;
  facilitatorParticipantId?: string;
  turnLimit: number;
  diceMode: DiceMode;
  readonly baseApPerTurn: 3;
  readonly strategyDeckSize: 30;
  readonly starterCardsPerPlayer: 5;
  readonly handLimit: 10;
  readonly participants: Record<string, GameParticipant>;
  readonly seats: Record<string, PlayerSeat>;
  readonly countries: Record<CountryId, GameCountry>;
  readonly populationDemographics: Record<string, ScenarioPopulationDemographic>;
  readonly cardDefinitions: Record<string, SetupCardDefinition>;
  readonly cards: Record<string, SetupCardInstance>;
  readonly strategy: Record<string, StrategySetupState>;
  readonly events: SetupGameEvent[];
}

export interface AuthenticatedSession {
  readonly id: string;
  readonly userId: string;
}

export interface GameSessionMembership {
  readonly gameId: string;
  readonly participantId: string;
  readonly authenticatedSessionId: string;
  connected: boolean;
}

export interface GameSession {
  readonly gameId: string;
  readonly memberships: Record<string, GameSessionMembership>;
}

export interface TrustedSessionBinding {
  readonly authenticatedSessionId: string;
  readonly userId: string;
  readonly gameId: string;
  readonly participantId: string;
  readonly role: ParticipantRole;
}
