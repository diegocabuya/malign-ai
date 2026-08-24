import { readFileSync } from "node:fs";
import { InMemorySessionAuthority } from "../../packages/authz/src/index.js";
import {
  M1_0_BASELINE_VERSIONS,
  type CountryId,
  type RandomProvider,
  type SetupGameState,
  type TrustedSessionBinding,
} from "../../packages/domain/src/index.js";
import {
  InMemorySetupGameStore,
  SetupCommandDispatcher,
  type SetupCommandPayload,
  type SetupCommandType,
} from "../../packages/game-engine/src/index.js";
import {
  InMemoryGameSessionApplication,
  type SessionCommandInput,
} from "../../apps/server/src/game-session-application.js";

interface ParticipantFixture {
  readonly authenticated_session_id: string;
  readonly user_id: string;
  readonly participant_id: string;
  readonly role: "FACILITATOR" | "PLAYER";
  readonly country_id?: CountryId;
  readonly seat_index?: number;
  readonly clockwise_index?: number;
}

interface ParticipantsFixture {
  readonly fixture_schema_version: string;
  readonly game_id: string;
  readonly participants: readonly ParticipantFixture[];
}

interface StrategyFixture {
  readonly fixture_schema_version: string;
  readonly card_registry_version: string;
  readonly operations_decks: Readonly<Record<CountryId, readonly string[]>>;
}

const loadJson = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8")) as T;

export const PARTICIPANT_FIXTURE = loadJson<ParticipantsFixture>(
  "../fixtures/m1-0/participants-five-plus-facilitator.json",
);
export const STRATEGY_FIXTURE = loadJson<StrategyFixture>(
  "../fixtures/m1-0/strategy-five-players.json",
);
export const GAME_ID = PARTICIPANT_FIXTURE.game_id;
export const FIXED_INSTANT = new Date("2026-08-23T12:00:00.000Z");

export class MinimumRandomProvider implements RandomProvider {
  readonly requests: {
    readonly minInclusive: number;
    readonly maxInclusive: number;
  }[] = [];
  readonly #queued: number[] = [];
  #strict = false;

  enqueue(...values: readonly number[]): void {
    this.#queued.push(...values);
  }

  requireScript(): void {
    this.#strict = true;
  }

  integer(minInclusive: number, maxInclusive: number): number {
    this.requests.push({ minInclusive, maxInclusive });
    const scripted = this.#queued.shift();
    if (scripted !== undefined) return scripted;
    if (this.#strict) throw new Error("Deterministic random script exhausted");
    return minInclusive;
  }
}

export interface M1Harness {
  readonly store: InMemorySetupGameStore;
  readonly random: MinimumRandomProvider;
  readonly authority: InMemorySessionAuthority;
  readonly dispatcher: SetupCommandDispatcher;
  readonly app: InMemoryGameSessionApplication;
}

let commandSequence = 0;

export const trustedBindings = (
  gameId = GAME_ID,
  sessionSuffix = "",
): TrustedSessionBinding[] =>
  PARTICIPANT_FIXTURE.participants.map((participant) => ({
    authenticatedSessionId: `${participant.authenticated_session_id}${sessionSuffix}`,
    userId: `${participant.user_id}${sessionSuffix}`,
    gameId,
    participantId: participant.participant_id,
    role: participant.role,
  }));

export const harness = (
  options: {
    readonly bindings?: readonly TrustedSessionBinding[];
    readonly states?: readonly SetupGameState[];
  } = {},
): M1Harness => {
  const store = new InMemorySetupGameStore(options.states ?? []);
  const random = new MinimumRandomProvider();
  const authority = new InMemorySessionAuthority(
    options.bindings ?? trustedBindings(),
  );
  const dispatcher = new SetupCommandDispatcher(
    store,
    random,
    () => new Date(FIXED_INSTANT),
  );
  const app = new InMemoryGameSessionApplication(
    authority,
    store,
    dispatcher,
    () => new Date(FIXED_INSTANT),
  );
  return { store, random, authority, dispatcher, app };
};

export const command = (
  commandType: SetupCommandType,
  gameId: string,
  expectedGameVersion: number,
  payload: SetupCommandPayload,
  options: {
    readonly commandId?: string;
    readonly idempotencyKey?: string;
    readonly correlationId?: string;
    readonly causationId?: string;
  } = {},
): SessionCommandInput => {
  commandSequence += 1;
  return {
    engineContractVersion: M1_0_BASELINE_VERSIONS.engineContractVersion,
    commandId: options.commandId ?? `m1-command-${commandSequence}`,
    idempotencyKey: options.idempotencyKey ?? `m1-key-${commandSequence}`,
    gameId,
    expectedGameVersion,
    commandType,
    payloadSchemaVersion: M1_0_BASELINE_VERSIONS.fixtureSchemaVersion,
    payload,
    ...(options.correlationId === undefined
      ? {}
      : { correlationId: options.correlationId }),
    ...(options.causationId === undefined
      ? {}
      : { causationId: options.causationId }),
  };
};

export const createPayload = (turnLimit = 1) =>
  ({
    scenarioDefinitionId: "BASE_2025",
    ...M1_0_BASELINE_VERSIONS,
    turnLimit,
    preferredDiceMode: "DIGITAL",
  }) as const;

export const sessionId = (participantId: string, suffix = ""): string =>
  `session-${participantId.toLowerCase()}${suffix}`;

export const createGame = (
  testHarness: M1Harness,
  gameId = GAME_ID,
  suffix = "",
) =>
  testHarness.app.execute(
    sessionId("F1", suffix),
    command("CREATE_GAME", gameId, 0, createPayload()),
  );

export const joinPlayers = (
  testHarness: M1Harness,
  gameId = GAME_ID,
  suffix = "",
): void => {
  for (const participantId of ["P1", "P2", "P3", "P4", "P5"]) {
    const state = testHarness.store.snapshot(gameId);
    if (state === undefined) throw new Error("Game must exist before join");
    const result = testHarness.app.execute(
      sessionId(participantId, suffix),
      command("JOIN_GAME_MEMBERSHIP", gameId, state.version, {}),
    );
    if (result.status !== "RESOLVED")
      throw new Error(`Join failed for ${participantId}`);
  }
};

export const assignCanonicalSeats = (
  testHarness: M1Harness,
  gameId = GAME_ID,
  suffix = "",
): void => {
  const players = PARTICIPANT_FIXTURE.participants.filter(
    (participant) => participant.role === "PLAYER",
  );
  for (const player of players) {
    const state = testHarness.store.snapshot(gameId);
    if (
      state === undefined ||
      player.country_id === undefined ||
      player.seat_index === undefined ||
      player.clockwise_index === undefined
    )
      throw new Error("Canonical seat fixture is incomplete");
    const result = testHarness.app.execute(
      sessionId("F1", suffix),
      command("ASSIGN_PLAYER_SEAT", gameId, state.version, {
        playerParticipantId: player.participant_id,
        countryId: player.country_id,
        seatIndex: player.seat_index,
        clockwiseIndex: player.clockwise_index,
      }),
    );
    if (result.status !== "RESOLVED")
      throw new Error(`Seat assignment failed for ${player.participant_id}`);
  }
};

export const completeSetup = (
  testHarness: M1Harness,
  gameId = GAME_ID,
  suffix = "",
): SetupGameState => {
  const created = createGame(testHarness, gameId, suffix);
  if (created.status !== "RESOLVED") throw new Error("Game creation failed");
  joinPlayers(testHarness, gameId, suffix);
  assignCanonicalSeats(testHarness, gameId, suffix);
  const state = testHarness.store.snapshot(gameId);
  if (state === undefined) throw new Error("Completed setup state missing");
  return state;
};

export const startGame = (
  testHarness: M1Harness,
  gameId = GAME_ID,
  suffix = "",
) => {
  const state = testHarness.store.snapshot(gameId);
  if (state === undefined) throw new Error("Game missing");
  return testHarness.app.execute(
    sessionId("F1", suffix),
    command("START_GAME", gameId, state.version, {}),
  );
};

export const completeAndStart = (
  testHarness: M1Harness,
  gameId = GAME_ID,
  suffix = "",
): SetupGameState => {
  completeSetup(testHarness, gameId, suffix);
  const result = startGame(testHarness, gameId, suffix);
  if (result.status !== "RESOLVED") throw new Error("Game start failed");
  const state = testHarness.store.snapshot(gameId);
  if (state === undefined) throw new Error("Started state missing");
  return state;
};

export const countryForParticipant = (participantId: string): CountryId => {
  const player = PARTICIPANT_FIXTURE.participants.find(
    (candidate) => candidate.participant_id === participantId,
  );
  if (player?.country_id === undefined)
    throw new Error("Participant has no canonical country");
  return player.country_id;
};

export const validDeckFor = (participantId: string): readonly string[] =>
  STRATEGY_FIXTURE.operations_decks[countryForParticipant(participantId)];

export const submitDeck = (
  testHarness: M1Harness,
  participantId: string,
  gameId = GAME_ID,
  suffix = "",
) => {
  const state = testHarness.store.snapshot(gameId);
  if (state === undefined) throw new Error("Game missing");
  return testHarness.app.execute(
    sessionId(participantId, suffix),
    command("SUBMIT_OPERATIONS_DECK", gameId, state.version, {
      cardInstanceIds: validDeckFor(participantId),
    }),
  );
};

export const lockStrategy = (
  testHarness: M1Harness,
  participantId: string,
  gameId = GAME_ID,
  suffix = "",
) => {
  const state = testHarness.store.snapshot(gameId);
  if (state === undefined) throw new Error("Game missing");
  return testHarness.app.execute(
    sessionId(participantId, suffix),
    command("LOCK_STRATEGY", gameId, state.version, {}),
  );
};

export const seedSubmittedDeck = (
  testHarness: M1Harness,
  participantId: string,
  cardInstanceIds: readonly string[],
  gameId = GAME_ID,
): void => {
  const state = testHarness.store.snapshot(gameId);
  const strategy = state?.strategy[participantId];
  if (state === undefined || strategy === undefined)
    throw new Error("Strategy state missing");
  strategy.submittedCardInstanceIds = [...cardInstanceIds];
  if (!testHarness.store.commitState(gameId, state.version, state))
    throw new Error("Fixture seed CAS failed");
};

export const verifiedFacilitatorActor = (suffix = "") => ({
  actorId: `user-f1${suffix}`,
  actorType: "FACILITATOR" as const,
  participantId: "F1",
  authenticatedSessionId: `session-f1${suffix}`,
  permissions: ["game:facilitate", "game:project"],
});
