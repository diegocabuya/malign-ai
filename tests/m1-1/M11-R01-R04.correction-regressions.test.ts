import { describe, expect, it } from "vitest";
import type { SessionCommandInput } from "../../apps/server/src/game-session-application.js";
import type { SetupGameState } from "../../packages/domain/src/index.js";
import { InMemorySetupGameStore } from "../../packages/game-engine/src/index.js";
import {
  GAME_ID,
  PLAYER_IDS,
  activateSlot,
  command,
  constructSlot,
  harness,
  lockPlan,
  reachActionPlanning,
  reachInitiative,
  requestInitiative,
  savePlan,
  sessionId,
  setMaintenance,
  type M1Harness,
} from "./test-fixtures.js";

const projection = (testHarness: M1Harness, participantId: string) => {
  const result = testHarness.app.getGameProjection(
    sessionId(participantId),
    GAME_ID,
  );
  if (!result.ok) throw new Error(`Projection failed for ${participantId}`);
  return result.projection;
};

const finishPlanLocks = (testHarness: M1Harness): void => {
  for (const participantId of PLAYER_IDS) {
    const state = testHarness.store.snapshot(GAME_ID);
    if (state?.actionPlanning[participantId]?.locked === true) continue;
    if (savePlan(testHarness, participantId, []).status !== "RESOLVED")
      throw new Error(`Pass save failed for ${participantId}`);
    if (lockPlan(testHarness, participantId).status !== "RESOLVED")
      throw new Error(`Pass lock failed for ${participantId}`);
  }
};

const seedMaintenanceReshuffle = (testHarness: M1Harness): void => {
  const seeded = testHarness.store.snapshot(GAME_ID);
  const strategy = seeded?.strategy.P1;
  if (seeded === undefined || strategy === undefined)
    throw new Error("P1 strategy missing");
  const hand = strategy.handCardInstanceIds.slice(0, 5);
  const source = [
    ...strategy.operationsDeckOrder,
    ...strategy.handCardInstanceIds.slice(5),
  ];
  const deck = source.slice(0, 2);
  const discard = source.slice(2, 6);
  strategy.handCardInstanceIds = hand;
  strategy.operationsDeckOrder = deck;
  strategy.discardCardInstanceIds = discard;
  for (const card of Object.values(seeded.cards).filter(
    ({ controllerParticipantId }) => controllerParticipantId === "P1",
  )) {
    if (hand.includes(card.id)) card.zone = "HAND";
    else if (deck.includes(card.id)) card.zone = "OPERATIONS_DECK";
    else if (discard.includes(card.id)) card.zone = "DISCARD";
    else if (card.zone === "HAND" || card.zone === "OPERATIONS_DECK")
      card.zone = "OPERATIONS_POOL";
  }
  if (!testHarness.store.commitState(GAME_ID, seeded.version, seeded))
    throw new Error("Maintenance seed failed");
};

const prepareMaintenance = (testHarness: M1Harness): SetupGameState => {
  reachInitiative(testHarness);
  if (requestInitiative(testHarness, [10, 8, 6, 4, 2]).status !== "RESOLVED")
    throw new Error("Initiative resolution failed");
  seedMaintenanceReshuffle(testHarness);
  if (setMaintenance(testHarness, "P1", []).status !== "RESOLVED")
    throw new Error("Maintenance set failed");
  const state = testHarness.store.snapshot(GAME_ID);
  if (state === undefined) throw new Error("Maintenance state missing");
  return state;
};

class FailOnceSetupGameStore extends InMemorySetupGameStore {
  #failNext = false;

  failNextCommit(): void {
    this.#failNext = true;
  }

  override commitState(
    gameId: string,
    expectedVersion: number,
    next: SetupGameState,
  ): boolean {
    if (this.#failNext) {
      this.#failNext = false;
      return false;
    }
    return super.commitState(gameId, expectedVersion, next);
  }
}

describe("M1-1 correction regressions — M11-R01…R04", () => {
  it("M11-R01 makes rival views indistinguishable for empty, one-slot and three-slot drafts while owner and F1 retain access", () => {
    const rivalViews = [];
    for (const slotCount of [0, 1, 3]) {
      const testHarness = harness();
      const state = reachActionPlanning(testHarness);
      const slots =
        slotCount === 0
          ? []
          : slotCount === 1
            ? [constructSlot(state, "P1", 1)]
            : [constructSlot(state, "P1", 1), activateSlot(2), activateSlot(3)];
      expect(savePlan(testHarness, "P1", slots).status).toBe("RESOLVED");

      const rival = projection(testHarness, "P2");
      const owner = projection(testHarness, "P1");
      const facilitator = projection(testHarness, "F1");
      const rivalP1 = rival.participants.find(
        ({ participantId }) => participantId === "P1",
      );
      expect(rivalP1).not.toHaveProperty("actionPlanStatus");
      expect(rivalP1).not.toHaveProperty("actionCount");
      expect(rivalP1).not.toHaveProperty("apAvailable");
      expect(owner.viewerPrivateState?.actionPlans[0]?.slots).toHaveLength(
        slotCount,
      );
      expect(
        facilitator.viewerPrivateState?.actionPlans.find(
          ({ participantId }) => participantId === "P1",
        )?.slots,
      ).toHaveLength(slotCount);
      expect(
        owner.participants.find(({ participantId }) => participantId === "P1"),
      ).toMatchObject({ actionCount: slotCount });
      expect(
        facilitator.participants.find(
          ({ participantId }) => participantId === "P1",
        ),
      ).toMatchObject({ actionCount: slotCount });
      rivalViews.push(rival);
    }

    expect(rivalViews[1]).toEqual(rivalViews[0]);
    expect(rivalViews[2]).toEqual(rivalViews[0]);
  });

  it("M11-R02 attributes internal reveal to SYSTEM without facilitator impersonation and rejects client invocation", () => {
    const testHarness = harness();
    const planning = reachActionPlanning(testHarness);
    savePlan(testHarness, "P1", [constructSlot(planning, "P1")]);
    lockPlan(testHarness, "P1");
    const humanEvent = testHarness.store
      .snapshot(GAME_ID)
      ?.events.findLast(({ type }) => type === "ACTION_PLAN_LOCKED");
    expect(humanEvent).toMatchObject({
      actorType: "PLAYER",
      actorId: "user-p1",
      actorParticipantId: "P1",
    });
    finishPlanLocks(testHarness);
    const locked = testHarness.store.snapshot(GAME_ID);
    if (locked === undefined) throw new Error("Locked state missing");

    const reveal = testHarness.dispatcher.revealCurrentAction({
      gameId: GAME_ID,
      expectedGameVersion: locked.version,
      commandId: "m11-r02-system-reveal",
      idempotencyKey: "m11-r02-system-reveal",
    });
    const revealed = testHarness.store.snapshot(GAME_ID);
    const systemEvent = revealed?.events.findLast(
      ({ type }) => type === "ACTION_REVEALED",
    );

    expect(reveal.status).toBe("RESOLVED");
    expect(systemEvent).toMatchObject({
      actorType: "SYSTEM",
      actorId: "M1_INTERNAL_COORDINATOR",
      actorParticipantId: null,
      payload: { participantId: "P1", sequenceIndex: 1 },
    });
    expect(systemEvent?.actorParticipantId).not.toBe("F1");

    const beforeClientAttempt = testHarness.store.snapshot(GAME_ID);
    const idempotencyBefore = testHarness.store.idempotencyCount();
    const clientInput = {
      ...command(
        "LOCK_ACTION_PLAN",
        GAME_ID,
        beforeClientAttempt?.version ?? -1,
        {},
        {
          commandId: "m11-r02-client-internal",
          idempotencyKey: "m11-r02-client-internal",
        },
      ),
      commandType: "INTERNAL_REVEAL_CURRENT_ACTION",
    } as unknown as SessionCommandInput;
    const clientAttempt = testHarness.app.execute(sessionId("P1"), clientInput);

    expect(clientAttempt.resultCode).toBe("INVALID_COMMAND_PAYLOAD");
    expect(testHarness.store.snapshot(GAME_ID)).toEqual(beforeClientAttempt);
    expect(testHarness.store.idempotencyCount()).toBe(idempotencyBefore);
  });

  it("M11-R04-INITIATIVE restores RNG after exhaustion and CAS rejection, then exact retry matches a clean execution", () => {
    const testHarness = harness();
    reachInitiative(testHarness);
    const before = testHarness.store.snapshot(GAME_ID);
    const cursorBefore = testHarness.random.cursor;
    const idempotencyBefore = testHarness.store.idempotencyCount();
    const input = command(
      "REQUEST_INITIATIVE_ROLL",
      GAME_ID,
      before?.version ?? -1,
      {},
      {
        commandId: "m11-r04-initiative",
        idempotencyKey: "m11-r04-initiative",
        correlationId: "m11-r04-initiative",
      },
    );
    testHarness.random.enqueue(8, 4);
    testHarness.random.requireScript();

    const failed = testHarness.app.execute(sessionId("P1"), input);

    expect(failed.resultCode).toBe("RANDOM_PROVIDER_FAILURE");
    expect(testHarness.store.snapshot(GAME_ID)).toEqual(before);
    expect(testHarness.store.idempotencyCount()).toBe(idempotencyBefore);
    expect(testHarness.random.cursor).toBe(cursorBefore);

    testHarness.random.enqueue(10, 9, 2);
    const retried = testHarness.app.execute(sessionId("P1"), input);
    const retriedState = testHarness.store.snapshot(GAME_ID);

    const cleanHarness = harness();
    reachInitiative(cleanHarness);
    cleanHarness.random.enqueue(8, 4, 10, 9, 2);
    cleanHarness.random.requireScript();
    const clean = cleanHarness.app.execute(sessionId("P1"), input);
    const cleanState = cleanHarness.store.snapshot(GAME_ID);

    expect(retried).toEqual(clean);
    expect(retriedState?.initiative).toEqual(cleanState?.initiative);
    expect(
      retriedState?.events.filter(
        ({ correlationId }) => correlationId === "m11-r04-initiative",
      ),
    ).toEqual(
      cleanState?.events.filter(
        ({ correlationId }) => correlationId === "m11-r04-initiative",
      ),
    );
    expect(testHarness.random.cursor).toBe(cleanHarness.random.cursor);
    expect(testHarness.random.cursor - cursorBefore).toBe(5);

    const failOnceStore = new FailOnceSetupGameStore();
    const casHarness = harness({ store: failOnceStore });
    reachInitiative(casHarness);
    const beforeCas = casHarness.store.snapshot(GAME_ID);
    const casCursorBefore = casHarness.random.cursor;
    const casIdempotencyBefore = casHarness.store.idempotencyCount();
    casHarness.random.enqueue(8, 4, 10, 9, 2);
    casHarness.random.requireScript();
    failOnceStore.failNextCommit();
    const casRejected = casHarness.app.execute(sessionId("P1"), {
      ...input,
      commandId: "m11-r04-initiative-cas",
      idempotencyKey: "m11-r04-initiative-cas",
    });
    expect(casRejected.resultCode).toBe("STALE_STATE_VERSION");
    expect(casHarness.store.snapshot(GAME_ID)).toEqual(beforeCas);
    expect(casHarness.store.idempotencyCount()).toBe(casIdempotencyBefore);
    expect(casHarness.random.cursor).toBe(casCursorBefore);
  });

  it("M11-R04-MAINTENANCE restores RNG and all aggregate state after partial reshuffle, then retry matches clean order", () => {
    const testHarness = harness();
    const before = prepareMaintenance(testHarness);
    const cursorBefore = testHarness.random.cursor;
    const idempotencyBefore = testHarness.store.idempotencyCount();
    const input = command(
      "LOCK_INITIATIVE_MAINTENANCE",
      GAME_ID,
      before.version,
      {},
      {
        commandId: "m11-r04-maintenance",
        idempotencyKey: "m11-r04-maintenance",
        correlationId: "m11-r04-maintenance",
      },
    );
    testHarness.random.enqueue(0);
    testHarness.random.requireScript();

    const failed = testHarness.app.execute(sessionId("P1"), input);

    expect(failed.resultCode).toBe("RANDOM_PROVIDER_FAILURE");
    expect(testHarness.store.snapshot(GAME_ID)).toEqual(before);
    expect(testHarness.store.idempotencyCount()).toBe(idempotencyBefore);
    expect(testHarness.random.cursor).toBe(cursorBefore);

    testHarness.random.enqueue(0, 0);
    const retried = testHarness.app.execute(sessionId("P1"), input);
    const retriedState = testHarness.store.snapshot(GAME_ID);

    const cleanHarness = harness();
    const cleanBefore = prepareMaintenance(cleanHarness);
    expect(cleanBefore.version).toBe(before.version);
    cleanHarness.random.enqueue(0, 0, 0);
    cleanHarness.random.requireScript();
    const clean = cleanHarness.app.execute(sessionId("P1"), input);
    const cleanState = cleanHarness.store.snapshot(GAME_ID);

    expect(retried).toEqual(clean);
    expect(retriedState?.version).toBe(cleanState?.version);
    expect(retriedState?.strategy.P1).toEqual(cleanState?.strategy.P1);
    expect(retriedState?.cards).toEqual(cleanState?.cards);
    expect(retriedState?.countries).toEqual(cleanState?.countries);
    expect(retriedState?.resourceLedger).toEqual(cleanState?.resourceLedger);
    expect(retriedState?.actionPointLedger).toEqual(
      cleanState?.actionPointLedger,
    );
    expect(
      retriedState?.events.filter(
        ({ correlationId }) => correlationId === "m11-r04-maintenance",
      ),
    ).toEqual(
      cleanState?.events.filter(
        ({ correlationId }) => correlationId === "m11-r04-maintenance",
      ),
    );
    expect(testHarness.random.cursor).toBe(cleanHarness.random.cursor);
    expect(testHarness.random.cursor - cursorBefore).toBe(3);
  });
});
