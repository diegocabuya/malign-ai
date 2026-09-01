export type CountryId = 'ARDEN' | 'FLUMA' | 'URSARIA' | 'PRESQUE' | 'DINESIA';
export type ParticipantRole = 'FACILITATOR' | 'PLAYER';
export type ParticipantStatus = 'ACTIVE';
export type SetupGamePhase =
  | 'SETUP'
  | 'STRATEGY_STAGE'
  | 'INITIATIVE_STAGE'
  | 'ACTION_STAGE_PLAN'
  | 'ACTION_STAGE_LOCKED'
  | 'RESOLUTION_STAGE';
export type SetupGameOverlay = 'ACTIVE' | 'PAUSED';
export type DiceMode = 'DIGITAL' | 'MANUAL_DIE_INPUT';
import type { M1AdjudicationState } from './m1-adjudication.js';
import type { EndGameState } from './m2b-endgame.js';
import type { M2VetoContinuation, ReactionContinuation } from './m2b-reaction.js';
import type { M2BAuditRecord, M2CoreSchedulerContinuation, M2EffectChoiceContinuation } from './m2b.js';

export type SetupCardZone = 'STARTER_POOL' | 'OPERATIONS_POOL' | 'OPERATIONS_DECK' | 'HAND' | 'DISCARD' | 'CAMPAIGN' | 'REMOVED_FROM_GAME';

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
  returnToOwnerOnDiscard?: boolean;
  zone: SetupCardZone;
  zonePosition?: number;
}

export interface StrategySetupState {
  readonly participantId: string;
  submittedCardInstanceIds: string[];
  operationsDeckOrder: string[];
  handCardInstanceIds: string[];
  discardCardInstanceIds: string[];
  locked: boolean;
}

export interface InitiativeRollAudit {
  readonly rngRequestId: string;
  readonly source: 'INITIATIVE';
  readonly attempt: number;
  readonly participantId: string;
  readonly rawValue: number;
  readonly consumptionOrder: number;
}

export interface InitiativeMaintenanceState {
  readonly participantId: string;
  discardCardInstanceIds: string[];
  submitted: boolean;
  locked: boolean;
  incomeApplied: boolean;
}

export interface InitiativeState {
  status: 'PENDING_ROLL' | 'MAINTENANCE' | 'COMPLETE';
  rolls: InitiativeRollAudit[];
  orderParticipantIds: string[];
  winnerParticipantId?: string;
  readonly maintenance: Record<string, InitiativeMaintenanceState>;
}

export type M1ActionType = 'CONSTRUCT_CAMPAIGN' | 'ACTIVATE_CAMPAIGN' | 'PLAY_BOOST';

export interface ConstructCampaignPlanPayload {
  readonly row: 'I';
  readonly intentCardInstanceId: string;
  readonly methodCardInstanceId: string;
  readonly amplifierCardInstanceId?: string;
  readonly targetDtId: string;
}

export interface ActivateCampaignPlanPayload {
  readonly campaignId: string;
  readonly requestedTargetPdId?: string;
}

export interface PlayBoostPlanPayload {
  readonly cardInstanceId: string;
  readonly campaignId: string;
  readonly activationSequenceIndex: number;
}

export type M1ActionPayload = ConstructCampaignPlanPayload | ActivateCampaignPlanPayload | PlayBoostPlanPayload;

export interface M1ActionPlanSlot {
  readonly sequenceIndex: number;
  readonly actionType: M1ActionType;
  readonly actionPayload: M1ActionPayload;
  readonly apCost: 1;
  revealed: boolean;
  terminalOutcome?: 'NOT_EXECUTED' | 'RESOLVED' | 'FAILED_COST';
}

export interface M1ActionPlanningParticipantState {
  readonly participantId: string;
  readonly apAllocated: 3;
  apAvailable: number;
  draftSlots: M1ActionPlanSlot[];
  lockedSlots: M1ActionPlanSlot[];
  locked: boolean;
}

export interface RevealedActionState {
  readonly participantId: string;
  readonly sequenceIndex: number;
  readonly actionType: M1ActionType;
}

export interface ResourceLedgerEntry {
  readonly id: string;
  readonly participantId: string | null;
  readonly countryId: CountryId;
  readonly reason: 'SCENARIO_SETUP' | 'TURN_INCOME' | 'CAMPAIGN_ACTIVATION_COST' | 'COALITION_CONTRIBUTION';
  readonly delta: number;
  readonly balanceAfter: number;
  readonly gameVersion: number;
}

export interface ActionPointLedgerEntry {
  readonly id: string;
  readonly participantId: string;
  readonly reason: 'TURN_ALLOCATION' | 'PLAN_COMMIT';
  readonly delta: number;
  readonly balanceAfter: number;
  readonly gameVersion: number;
}

export interface SecretVictoryObjectiveState {
  readonly id: string;
  readonly condition: string;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
  readonly progress: number;
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
  | 'GAME_RESUMED'
  | 'INITIATIVE_ROLLED'
  | 'INITIATIVE_ORDER_SET'
  | 'RESOURCE_CHANGED'
  | 'CARD_MOVED'
  | 'ACTION_PLAN_SAVED'
  | 'AP_COMMITTED'
  | 'ACTION_PLAN_LOCKED'
  | 'ACTION_REVEALED'
  | 'ACTION_RESOLVED'
  | 'CAMPAIGN_CREATED'
  | 'CAMPAIGN_ACTIVATION_STARTED'
  | 'NARRATIVE_REQUESTED'
  | 'NARRATIVE_SUBMITTED'
  | 'COALITION_REQUESTED'
  | 'COALITION_RESPONSE_COMMITTED'
  | 'COALITION_RESOLVED'
  | 'BOOST_PLANNED'
  | 'BOOST_APPLIED'
  | 'DIE_REQUESTED'
  | 'PRE_ROLL_REACTION_OPENED'
  | 'PRE_ROLL_REACTION_EVALUATED'
  | 'PRE_ROLL_REACTION_CLOSED'
  | 'CAMPAIGN_COST_PAID'
  | 'DIE_ROLLED'
  | 'ERT_RESOLVED'
  | 'CHOICE_REQUESTED'
  | 'CHOICE_RESOLVED'
  | 'INFLUENCE_MUTATED'
  | 'LEGITIMACY_CHANGED'
  | 'VP_CHANGED'
  | 'CAMPAIGN_ACTIVATION_COMPLETED'
  | 'CLEANUP_STARTED'
  | 'CAMPAIGN_AGED'
  | 'CAMPAIGN_DISCARDED'
  | 'TURN_FLAGS_RESET'
  | 'CLEANUP_COMPLETED'
  | 'OBJECTIVE_AWARDED'
  | 'GAME_COMPLETED'
  | 'REACTION_WINDOW_OPENED'
  | 'REACTION_PRIORITY_PASSED'
  | 'REACTION_PLAYED'
  | 'REACTION_WINDOW_CLOSED'
  | 'VETO_STARTED'
  | 'VETO_DEFENSE_SUBMITTED'
  | 'VETO_VOTE_CAST'
  | 'VETO_RESOLVED'
  | 'VETO_ABUSE_REVIEWED'
  | 'M2_EFFECT_EXECUTED'
  | 'M2_CORE_OPERATION_EXECUTED';


export type SetupEventVisibilityClass = 'PUBLIC' | 'OWNER_AND_FACILITATOR';
export type SetupEventActorType = ParticipantRole | 'SYSTEM';

export interface SetupGameEvent {
  readonly id: string;
  readonly eventId: string;
  readonly gameId: string;
  readonly type: SetupGameEventType;
  readonly eventType: SetupGameEventType;
  readonly sequenceNumber: number;
  readonly gameVersion: number;
  readonly actorType: SetupEventActorType;
  readonly actorId: string;
  readonly actorParticipantId: string | null;
  readonly payloadSchemaVersion: string;
  readonly versions: PinnedVersions;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly visibilityClass: SetupEventVisibilityClass;
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
  readonly initiative: InitiativeState;
  readonly actionPlanning: Record<string, M1ActionPlanningParticipantState>;
  readonly resourceLedger: ResourceLedgerEntry[];
  readonly actionPointLedger: ActionPointLedgerEntry[];
  readonly secretVictoryObjectives: Record<string, SecretVictoryObjectiveState[]>;
  readonly adjudication: M1AdjudicationState;
  endGame?: EndGameState;
  reactionContinuation?: ReactionContinuation;
  m2Veto?: M2VetoContinuation;
  vetoBlockedParticipantIdsThisTurn?: string[];
  vetoAbuseReviewByWindowParticipant?: Record<string, 'ALLOW' | 'REJECT'>;
  m2Audit?: M2BAuditRecord[];
  m2CoreScheduler?: M2CoreSchedulerContinuation;
  m2EffectChoice?: M2EffectChoiceContinuation;
  currentRevealedAction?: RevealedActionState;
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
