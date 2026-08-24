import type { ActorContext } from '@malign-ai/contracts';
import type { CountryId, ParticipantRole, SetupGameOverlay, SetupGamePhase, SetupGameState } from '@malign-ai/domain';

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
}

export interface SetupGameProjection {
  readonly gameId: string;
  readonly gameVersion: number;
  readonly scenarioId: 'BASE_2025';
  readonly phase: SetupGamePhase;
  readonly overlay: SetupGameOverlay;
  readonly turnLimit: number;
  readonly diceMode: string;
  readonly viewer: { readonly participantId: string; readonly role: ParticipantRole };
  readonly participants: readonly SetupParticipantProjection[];
  readonly countries: readonly { readonly countryId: CountryId; readonly resources: number; readonly turnIncome: number }[];
}

export const buildSetupGameProjection = (state: SetupGameState, viewer: ActorContext): SetupGameProjection => {
  const viewerParticipantId = viewer.participantId;
  if (viewerParticipantId === undefined) throw new Error('Projection viewer must be a verified participant');
  const participant = state.participants[viewerParticipantId];
  if (participant === undefined || participant.role !== viewer.actorType) throw new Error('Projection viewer is not a game participant');
  const participants = Object.values(state.participants)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((candidate): SetupParticipantProjection => {
      const seat = state.seats[candidate.id];
      const strategy = state.strategy[candidate.id];
      return {
        participantId: candidate.id,
        role: candidate.role,
        ...(seat === undefined ? {} : {
          countryId: seat.countryId,
          seatIndex: seat.seatIndex,
          clockwiseIndex: seat.clockwiseIndex,
        }),
        strategySubmitted: (strategy?.submittedCardInstanceIds.length ?? 0) === 30,
        strategyLocked: strategy?.locked ?? false,
        handSize: strategy?.handCardInstanceIds.length ?? 0,
        operationsDeckRemainingCount: strategy?.operationsDeckOrder.length ?? 0,
      };
    });
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
      .map(({ id, resources, turnIncome }) => ({ countryId: id, resources, turnIncome })),
  };
};
