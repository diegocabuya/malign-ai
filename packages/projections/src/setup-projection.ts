import type { ActorContext } from "@malign-ai/contracts";
import type {
  CountryId,
  InitiativeRollAudit,
  M1ActionPlanSlot,
  ParticipantRole,
  SecretVictoryObjectiveState,
  SetupGameOverlay,
  SetupGamePhase,
  SetupGameState,
} from "@malign-ai/domain";

export interface SetupParticipantProjection {
  readonly participantId: string;
  readonly role: ParticipantRole;
  readonly countryId?: CountryId;
  readonly seatIndex?: number;
  readonly clockwiseIndex?: number;
  readonly strategySubmitted: boolean;
  readonly strategyLocked: boolean;
  readonly handSize: number;
  readonly operationsDeckRemainingCount: number;
  readonly initiativePosition?: number;
  readonly maintenanceLocked?: boolean;
  readonly actionPlanStatus?: "NONE" | "DRAFT" | "LOCKED" | "PASS";
  readonly actionCount?: number;
  readonly apAvailable?: number;
}

export interface AuthorizedCardProjection {
  readonly cardInstanceId: string;
  readonly definitionId: string;
  readonly canonicalName: string;
}

export interface AuthorizedPlanProjection {
  readonly participantId: string;
  readonly locked: boolean;
  readonly slots: readonly M1ActionPlanSlot[];
}

export interface ViewerPrivateStateProjection {
  readonly hands: readonly {
    readonly participantId: string;
    readonly cards: readonly AuthorizedCardProjection[];
  }[];
  readonly actionPlans: readonly AuthorizedPlanProjection[];
  readonly secretVictoryObjectives: readonly {
    readonly participantId: string;
    readonly objectives: readonly SecretVictoryObjectiveState[];
  }[];
  readonly initiativeRollAudit?: readonly InitiativeRollAudit[];
}

export interface SetupGameProjection {
  readonly gameId: string;
  readonly gameVersion: number;
  readonly scenarioId: "BASE_2025";
  readonly phase: SetupGamePhase;
  readonly overlay: SetupGameOverlay;
  readonly turnLimit: number;
  readonly diceMode: string;
  readonly viewer: {
    readonly participantId: string;
    readonly role: ParticipantRole;
  };
  readonly participants: readonly SetupParticipantProjection[];
  readonly countries: readonly {
    readonly countryId: CountryId;
    readonly resources: number;
    readonly turnIncome: number;
  }[];
  readonly initiative?: {
    readonly status: SetupGameState["initiative"]["status"];
    readonly orderParticipantIds: readonly string[];
    readonly rolls: readonly {
      readonly participantId: string;
      readonly attempt: number;
      readonly rawValue: number;
    }[];
  };
  readonly revealedAction?: {
    readonly participantId: string;
    readonly sequenceIndex: number;
    readonly actionType: M1ActionPlanSlot["actionType"];
  };
  readonly viewerPrivateState?: ViewerPrivateStateProjection;
}

const phaseHasM1PrivateProjection = (phase: SetupGamePhase): boolean =>
  phase === "INITIATIVE_STAGE" ||
  phase === "ACTION_STAGE_PLAN" ||
  phase === "ACTION_STAGE_LOCKED" ||
  phase === "RESOLUTION_STAGE";

const planStatus = (
  planning: SetupGameState["actionPlanning"][string] | undefined,
): "NONE" | "DRAFT" | "LOCKED" | "PASS" => {
  if (planning === undefined) return "NONE";
  if (planning.locked && planning.lockedSlots.length === 0) return "PASS";
  if (planning.locked) return "LOCKED";
  return planning.draftSlots.length === 0 ? "NONE" : "DRAFT";
};

export const buildSetupGameProjection = (
  state: SetupGameState,
  viewer: ActorContext,
): SetupGameProjection => {
  const viewerParticipantId = viewer.participantId;
  if (viewerParticipantId === undefined)
    throw new Error("Projection viewer must be a verified participant");
  const participant = state.participants[viewerParticipantId];
  if (participant === undefined || participant.role !== viewer.actorType)
    throw new Error("Projection viewer is not a game participant");
  const includeM1 = phaseHasM1PrivateProjection(state.phase);
  const participants = Object.values(state.participants)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((candidate): SetupParticipantProjection => {
      const seat = state.seats[candidate.id];
      const strategy = state.strategy[candidate.id];
      const planning = state.actionPlanning[candidate.id];
      const initiativePosition = state.initiative.orderParticipantIds.indexOf(
        candidate.id,
      );
      return {
        participantId: candidate.id,
        role: candidate.role,
        ...(seat === undefined
          ? {}
          : {
              countryId: seat.countryId,
              seatIndex: seat.seatIndex,
              clockwiseIndex: seat.clockwiseIndex,
            }),
        strategySubmitted:
          (strategy?.submittedCardInstanceIds.length ?? 0) === 30,
        strategyLocked: strategy?.locked ?? false,
        handSize: strategy?.handCardInstanceIds.length ?? 0,
        operationsDeckRemainingCount: strategy?.operationsDeckOrder.length ?? 0,
        ...(!includeM1 || candidate.role !== "PLAYER"
          ? {}
          : {
              ...(initiativePosition < 0
                ? {}
                : { initiativePosition: initiativePosition + 1 }),
              maintenanceLocked:
                state.initiative.maintenance[candidate.id]?.locked ?? false,
              actionPlanStatus: planStatus(planning),
              actionCount:
                planning?.locked === true
                  ? planning.lockedSlots.length
                  : (planning?.draftSlots.length ?? 0),
              apAvailable: planning?.apAvailable ?? state.baseApPerTurn,
            }),
      };
    });

  const authorizedParticipantIds =
    participant.role === "FACILITATOR"
      ? Object.values(state.participants)
          .filter(({ role }) => role === "PLAYER")
          .map(({ id }) => id)
      : [viewerParticipantId];
  const viewerPrivateState: ViewerPrivateStateProjection | undefined = includeM1
    ? {
        hands: authorizedParticipantIds.map((participantId) => ({
          participantId,
          cards: (state.strategy[participantId]?.handCardInstanceIds ?? []).map(
            (cardInstanceId) => {
              const card = state.cards[cardInstanceId];
              const definition =
                card === undefined
                  ? undefined
                  : state.cardDefinitions[card.definitionId];
              if (card === undefined || definition === undefined)
                throw new Error("Authorized hand contains an unknown card");
              return {
                cardInstanceId,
                definitionId: card.definitionId,
                canonicalName: definition.canonicalName,
              };
            },
          ),
        })),
        actionPlans: authorizedParticipantIds.map((participantId) => {
          const planning = state.actionPlanning[participantId];
          return {
            participantId,
            locked: planning?.locked ?? false,
            slots: structuredClone(
              planning?.locked === true
                ? planning.lockedSlots
                : (planning?.draftSlots ?? []),
            ),
          };
        }),
        secretVictoryObjectives: authorizedParticipantIds.map(
          (participantId) => ({
            participantId,
            objectives: structuredClone(
              state.secretVictoryObjectives[participantId] ?? [],
            ),
          }),
        ),
        ...(participant.role === "FACILITATOR"
          ? { initiativeRollAudit: structuredClone(state.initiative.rolls) }
          : {}),
      }
    : undefined;

  return {
    gameId: state.id,
    gameVersion: state.version,
    scenarioId: state.scenarioId,
    phase: state.phase,
    overlay: state.overlay,
    turnLimit: state.turnLimit,
    diceMode: state.diceMode,
    viewer: { participantId: viewerParticipantId, role: participant.role },
    participants,
    countries: Object.values(state.countries)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(({ id, resources, turnIncome }) => ({
        countryId: id,
        resources,
        turnIncome,
      })),
    ...(includeM1
      ? {
          initiative: {
            status: state.initiative.status,
            orderParticipantIds: [...state.initiative.orderParticipantIds],
            rolls: state.initiative.rolls.map(
              ({ participantId, attempt, rawValue }) => ({
                participantId,
                attempt,
                rawValue,
              }),
            ),
          },
        }
      : {}),
    ...(state.currentRevealedAction === undefined
      ? {}
      : { revealedAction: structuredClone(state.currentRevealedAction) }),
    ...(viewerPrivateState === undefined ? {} : { viewerPrivateState }),
  };
};
