import type {
  DiceMode,
  M1ActionPlanSlot,
  SetupGameState,
} from "../../packages/domain/src/index.js";
import type { SetM1ActionPlanPayload } from "../../packages/game-engine/src/index.js";
import {
  GAME_ID,
  command,
  completeAndStart,
  lockStrategy,
  sessionId,
  submitDeck,
  type M1Harness,
} from "../m1-0/test-fixtures.js";

export { GAME_ID, command, harness, sessionId } from "../m1-0/test-fixtures.js";
export type { M1Harness } from "../m1-0/test-fixtures.js";

export const PLAYER_IDS = ["P1", "P2", "P3", "P4", "P5"] as const;

export const reachInitiative = (testHarness: M1Harness, diceMode: DiceMode = 'DIGITAL'): SetupGameState => {
  completeAndStart(testHarness, GAME_ID, '', diceMode);
  for (const participantId of PLAYER_IDS) {
    if (submitDeck(testHarness, participantId).status !== "RESOLVED")
      throw new Error(`Submit failed for ${participantId}`);
    if (lockStrategy(testHarness, participantId).status !== "RESOLVED")
      throw new Error(`Strategy lock failed for ${participantId}`);
  }
  const state = testHarness.store.snapshot(GAME_ID);
  if (state?.phase !== "INITIATIVE_STAGE")
    throw new Error("Initiative fixture did not reach INITIATIVE_STAGE");
  return state;
};

export const requestInitiative = (
  testHarness: M1Harness,
  values: readonly number[],
) => {
  testHarness.random.enqueue(...values);
  const state = testHarness.store.snapshot(GAME_ID);
  if (state === undefined) throw new Error("Game missing");
  return testHarness.app.execute(
    sessionId("P1"),
    command("REQUEST_INITIATIVE_ROLL", GAME_ID, state.version, {}),
  );
};

export const setMaintenance = (
  testHarness: M1Harness,
  participantId: string,
  discardCardInstanceIds: readonly string[],
) => {
  const state = testHarness.store.snapshot(GAME_ID);
  if (state === undefined) throw new Error("Game missing");
  return testHarness.app.execute(
    sessionId(participantId),
    command("SET_INITIATIVE_MAINTENANCE", GAME_ID, state.version, {
      discardCardInstanceIds,
    }),
  );
};

export const lockMaintenance = (
  testHarness: M1Harness,
  participantId: string,
) => {
  const state = testHarness.store.snapshot(GAME_ID);
  if (state === undefined) throw new Error("Game missing");
  return testHarness.app.execute(
    sessionId(participantId),
    command("LOCK_INITIATIVE_MAINTENANCE", GAME_ID, state.version, {}),
  );
};

export const reachActionPlanning = (testHarness: M1Harness, diceMode: DiceMode = 'DIGITAL'): SetupGameState => {
  reachInitiative(testHarness, diceMode);
  const initiative = requestInitiative(testHarness, [10, 8, 6, 4, 2]);
  if (initiative.status !== "RESOLVED")
    throw new Error("Initiative resolution failed");
  for (const participantId of PLAYER_IDS) {
    if (setMaintenance(testHarness, participantId, []).status !== "RESOLVED")
      throw new Error(`Maintenance set failed for ${participantId}`);
    if (lockMaintenance(testHarness, participantId).status !== "RESOLVED")
      throw new Error(`Maintenance lock failed for ${participantId}`);
  }
  const state = testHarness.store.snapshot(GAME_ID);
  if (state?.phase !== "ACTION_STAGE_PLAN")
    throw new Error("Planning fixture did not reach ACTION_STAGE_PLAN");
  return state;
};

export const constructSlot = (
  state: SetupGameState,
  participantId: string,
  sequenceIndex = 1,
): SetM1ActionPlanPayload["actionSlots"][number] => {
  const hand = state.strategy[participantId]?.handCardInstanceIds ?? [];
  const intentCardInstanceId = hand[0];
  const methodCardInstanceId = hand[1];
  if (intentCardInstanceId === undefined || methodCardInstanceId === undefined)
    throw new Error("Plan fixture hand is incomplete");
  return {
    sequenceIndex,
    actionType: "CONSTRUCT_CAMPAIGN",
    actionPayload: {
      row: "I",
      intentCardInstanceId,
      methodCardInstanceId,
      targetDtId: "RACE:BLACK",
    },
  };
};

export const activateSlot = (
  sequenceIndex = 2,
  participantId = "P1",
): SetM1ActionPlanPayload["actionSlots"][number] => ({
  sequenceIndex,
  actionType: "ACTIVATE_CAMPAIGN",
  actionPayload: {
    campaignId: `${GAME_ID}:campaign:${participantId}:row-i`,
    requestedTargetPdId: "ARDEN_PD_2",
  },
});

export const savePlan = (
  testHarness: M1Harness,
  participantId: string,
  actionSlots: SetM1ActionPlanPayload["actionSlots"],
) => {
  const state = testHarness.store.snapshot(GAME_ID);
  if (state === undefined) throw new Error("Game missing");
  return testHarness.app.execute(
    sessionId(participantId),
    command("SET_ACTION_PLAN", GAME_ID, state.version, { actionSlots }),
  );
};

export const lockPlan = (testHarness: M1Harness, participantId: string) => {
  const state = testHarness.store.snapshot(GAME_ID);
  if (state === undefined) throw new Error("Game missing");
  return testHarness.app.execute(
    sessionId(participantId),
    command("LOCK_ACTION_PLAN", GAME_ID, state.version, {}),
  );
};

export const seedSecretObjectives = (testHarness: M1Harness): void => {
  const state = testHarness.store.snapshot(GAME_ID);
  if (state === undefined) throw new Error("Game missing");
  for (const participantId of PLAYER_IDS) {
    state.secretVictoryObjectives[participantId] = [
      {
        id: `VO-${participantId}`,
        condition: `OWNER_ONLY_${participantId}_CONDITION`,
        metadata: { classifiedMarker: `OWNER_ONLY_${participantId}_METADATA` },
        progress: Number(participantId.slice(1)),
      },
    ];
  }
  if (!testHarness.store.commitState(GAME_ID, state.version, state))
    throw new Error("Secret fixture CAS failed");
};

export const seedInvalidFourSlotDraft = (
  testHarness: M1Harness,
  participantId: string,
): void => {
  const state = testHarness.store.snapshot(GAME_ID);
  const planning = state?.actionPlanning[participantId];
  if (state === undefined || planning === undefined)
    throw new Error("Planning fixture missing");
  const base = constructSlot(state, participantId);
  planning.draftSlots = [1, 2, 3, 4].map((sequenceIndex): M1ActionPlanSlot => ({
    sequenceIndex,
    actionType: base.actionType,
    actionPayload: structuredClone(
      base.actionPayload,
    ) as M1ActionPlanSlot["actionPayload"],
    apCost: 1,
    revealed: false,
  }));
  if (!testHarness.store.commitState(GAME_ID, state.version, state))
    throw new Error("Invalid plan fixture CAS failed");
};
