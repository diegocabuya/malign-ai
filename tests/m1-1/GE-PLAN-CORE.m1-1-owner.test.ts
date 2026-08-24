import { describe, expect, it } from "vitest";
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
  savePlan,
  seedInvalidFourSlotDraft,
  sessionId,
  terminalNonExecutionFixture,
} from "./test-fixtures.js";

const lockRemainingPlayers = (
  testHarness: ReturnType<typeof harness>,
  first = "P1",
): void => {
  for (const participantId of PLAYER_IDS.filter((id) => id !== first)) {
    if (savePlan(testHarness, participantId, []).status !== "RESOLVED")
      throw new Error(`Pass save failed for ${participantId}`);
    if (lockPlan(testHarness, participantId).status !== "RESOLVED")
      throw new Error(`Pass lock failed for ${participantId}`);
  }
};

describe("M1-1 oracle/addendum owner cases — hidden planning, AP and minimal reveal", () => {
  it("GE-PLAN-001 rejects a fixture with four one-AP actions as INSUFFICIENT_AP without locking", () => {
    const testHarness = harness();
    reachActionPlanning(testHarness);
    seedInvalidFourSlotDraft(testHarness, "P1");
    const before = testHarness.store.snapshot(GAME_ID);

    const result = lockPlan(testHarness, "P1");

    expect(result.resultCode).toBe("INSUFFICIENT_AP");
    expect(testHarness.store.snapshot(GAME_ID)).toEqual(before);
    expect(before?.actionPlanning.P1?.locked).toBe(false);
  });

  it("GE-PLAN-003 keeps a locked plan payload, card IDs, target and DT hidden from rivals", () => {
    const testHarness = harness();
    const state = reachActionPlanning(testHarness);
    const slot = constructSlot(state, "P1");
    savePlan(testHarness, "P1", [slot]);
    lockPlan(testHarness, "P1");

    const rival = testHarness.app.getGameProjection(sessionId("P2"), GAME_ID);
    const serialized = JSON.stringify(rival);

    expect(
      rival.ok &&
        rival.projection.participants.find(
          ({ participantId }) => participantId === "P1",
        ),
    ).toMatchObject({
      actionPlanStatus: "LOCKED",
      actionCount: 1,
    });
    expect(serialized).not.toContain(slot.actionPayload.intentCardInstanceId);
    expect(serialized).not.toContain("CONSTRUCT_CAMPAIGN");
    expect(serialized).not.toContain("RACE:BLACK");
    expect(serialized).not.toContain("ARDEN_PD_2");
  });

  it("GE-PLAN-004 preserves zero AP after a deterministic downstream NOT_EXECUTED outcome without implementing Veto", () => {
    const testHarness = harness();
    const state = reachActionPlanning(testHarness);
    const slots = [
      constructSlot(state, "P1", 1),
      activateSlot(2),
      activateSlot(3),
    ];
    savePlan(testHarness, "P1", slots);
    lockPlan(testHarness, "P1");
    const locked = testHarness.store.snapshot(GAME_ID);
    if (locked === undefined) throw new Error("Locked state missing");

    const downstreamFixture = terminalNonExecutionFixture(locked, "P1", 1);

    expect(
      downstreamFixture.actionPlanning.P1?.lockedSlots[0]?.terminalOutcome,
    ).toBe("NOT_EXECUTED");
    expect(downstreamFixture.actionPlanning.P1?.apAvailable).toBe(0);
    expect(downstreamFixture.actionPointLedger).toEqual(
      locked.actionPointLedger,
    );
    expect(
      downstreamFixture.events.some(({ type }) => type.includes("VETO")),
    ).toBe(false);
  });

  it("GE-PLAN-005 rejects any complete draft replacement after the owner has locked", () => {
    const testHarness = harness();
    const state = reachActionPlanning(testHarness);
    savePlan(testHarness, "P1", [constructSlot(state, "P1")]);
    lockPlan(testHarness, "P1");
    const before = testHarness.store.snapshot(GAME_ID);

    const result = savePlan(testHarness, "P1", [activateSlot(1)]);

    expect(result.resultCode).toBe("ACTION_PLAN_LOCKED");
    expect(testHarness.store.snapshot(GAME_ID)).toEqual(before);
  });

  it("GE-CORE-001 rejects direct CONSTRUCT_CAMPAIGN during INITIATIVE without state, event or version change", () => {
    const testHarness = harness();
    const before = reachInitiative(testHarness);

    const result = testHarness.app.execute(
      sessionId("P1"),
      command("CONSTRUCT_CAMPAIGN", GAME_ID, before.version, {}),
    );

    expect(result.resultCode).toBe("WRONG_PHASE");
    expect(testHarness.store.snapshot(GAME_ID)).toEqual(before);
  });

  it("GE-CORE-008 rejects direct END_GAME_SCORING from ACTION_STAGE_PLAN and preserves the phase", () => {
    const testHarness = harness();
    const before = reachActionPlanning(testHarness);

    const result = testHarness.app.execute(
      sessionId("P1"),
      command("END_GAME_SCORING", GAME_ID, before.version, {}),
    );

    expect(result.resultCode).toBe("ILLEGAL_STATE_TRANSITION");
    expect(testHarness.store.snapshot(GAME_ID)).toEqual(before);
    expect(before.phase).toBe("ACTION_STAGE_PLAN");
  });

  it("GE-M1-IPL-004 emits ACTION_REVEALED only when SYSTEM starts the current slot and leaves future slots private", () => {
    const testHarness = harness();
    const state = reachActionPlanning(testHarness);
    savePlan(testHarness, "P1", [
      constructSlot(state, "P1", 1),
      activateSlot(2),
    ]);
    lockPlan(testHarness, "P1");
    lockRemainingPlayers(testHarness);
    const locked = testHarness.store.snapshot(GAME_ID);
    expect(locked?.events.some(({ type }) => type === "ACTION_REVEALED")).toBe(
      false,
    );

    const result = testHarness.dispatcher.revealCurrentAction({
      gameId: GAME_ID,
      expectedGameVersion: locked?.version ?? -1,
      commandId: "internal-reveal-current",
      idempotencyKey: "internal-reveal-current",
    });
    const revealed = testHarness.store.snapshot(GAME_ID);

    expect(result.resultCode).toBe("ACTION_REVEALED");
    expect(
      revealed?.actionPlanning.P1?.lockedSlots.map(
        ({ sequenceIndex, revealed }) => [sequenceIndex, revealed],
      ),
    ).toEqual([
      [1, true],
      [2, false],
    ]);
    expect(
      revealed?.events.filter(({ type }) => type === "ACTION_REVEALED"),
    ).toHaveLength(1);
  });

  it("GE-M1-IPL-006 makes the fifth lock one atomic version commit through ACTION_STAGE_LOCKED to RESOLUTION_STAGE", () => {
    const testHarness = harness();
    reachActionPlanning(testHarness);
    for (const participantId of PLAYER_IDS.slice(0, 4)) {
      savePlan(testHarness, participantId, []);
      lockPlan(testHarness, participantId);
    }
    savePlan(testHarness, "P5", []);
    const before = testHarness.store.snapshot(GAME_ID);
    const input = command(
      "LOCK_ACTION_PLAN",
      GAME_ID,
      before?.version ?? -1,
      {},
      {
        commandId: "fifth-plan-lock",
        idempotencyKey: "fifth-plan-lock",
        correlationId: "fifth-plan-lock-correlation",
      },
    );

    const first = testHarness.app.execute(sessionId("P5"), input);
    const after = testHarness.store.snapshot(GAME_ID);
    const retry = testHarness.app.execute(sessionId("P5"), input);
    const phaseEvents =
      after?.events.filter(
        ({ correlationId, type }) =>
          correlationId === "fifth-plan-lock-correlation" &&
          type === "PHASE_CHANGED",
      ) ?? [];

    expect(first.gameVersionAfter).toBe((before?.version ?? -1) + 1);
    expect(after?.phase).toBe("RESOLUTION_STAGE");
    expect(phaseEvents.map(({ payload }) => payload.phase)).toEqual([
      "ACTION_STAGE_LOCKED",
      "RESOLUTION_STAGE",
    ]);
    expect(phaseEvents[1]?.sequenceNumber).toBe(
      (phaseEvents[0]?.sequenceNumber ?? -1) + 1,
    );
    expect(retry).toEqual(first);
    expect(testHarness.store.snapshot(GAME_ID)).toEqual(after);
  });

  it("GE-M1-IPL-008 commits exactly one AP per slot and a later terminal failure cannot refund the ledger", () => {
    const testHarness = harness();
    const state = reachActionPlanning(testHarness);
    savePlan(testHarness, "P1", [
      constructSlot(state, "P1", 1),
      activateSlot(2),
    ]);
    lockPlan(testHarness, "P1");
    const locked = testHarness.store.snapshot(GAME_ID);
    if (locked === undefined) throw new Error("Locked state missing");

    const terminal = terminalNonExecutionFixture(locked, "P1", 1);
    const p1Ledger = terminal.actionPointLedger.filter(
      ({ participantId }) => participantId === "P1",
    );

    expect(terminal.actionPlanning.P1?.apAvailable).toBe(1);
    expect(
      p1Ledger.map(({ reason, delta, balanceAfter }) => ({
        reason,
        delta,
        balanceAfter,
      })),
    ).toEqual([
      { reason: "TURN_ALLOCATION", delta: 3, balanceAfter: 3 },
      { reason: "PLAN_COMMIT", delta: -2, balanceAfter: 1 },
    ]);
  });

  it("GE-M1-IPL-009 preserves [CONSTRUCT_CAMPAIGN, ACTIVATE_CAMPAIGN] sequence 1→2 without executing either effect", () => {
    const testHarness = harness();
    const state = reachActionPlanning(testHarness);
    const slots = [constructSlot(state, "P1", 1), activateSlot(2)];
    const plannedCardId = state.strategy.P1?.handCardInstanceIds[0];
    if (plannedCardId === undefined)
      throw new Error("Planned card fixture missing");
    const resourcesBefore = state.countries.ARDEN.resources;
    savePlan(testHarness, "P1", slots);
    lockPlan(testHarness, "P1");
    lockRemainingPlayers(testHarness);
    const locked = testHarness.store.snapshot(GAME_ID);
    testHarness.dispatcher.revealCurrentAction({
      gameId: GAME_ID,
      expectedGameVersion: locked?.version ?? -1,
      commandId: "sequence-reveal",
      idempotencyKey: "sequence-reveal",
    });
    const revealed = testHarness.store.snapshot(GAME_ID);

    expect(
      revealed?.actionPlanning.P1?.lockedSlots.map(
        ({ sequenceIndex, actionType }) => [sequenceIndex, actionType],
      ),
    ).toEqual([
      [1, "CONSTRUCT_CAMPAIGN"],
      [2, "ACTIVATE_CAMPAIGN"],
    ]);
    expect(revealed?.cards[plannedCardId]?.zone).toBe("HAND");
    expect(revealed?.countries.ARDEN.resources).toBe(resourcesBefore);
    expect(
      revealed?.events.some(({ type }) => type.startsWith("CAMPAIGN_")),
    ).toBe(false);
  });
});
