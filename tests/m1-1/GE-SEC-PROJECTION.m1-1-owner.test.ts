import { describe, expect, it } from "vitest";
import {
  GAME_ID,
  PLAYER_IDS,
  activateSlot,
  constructSlot,
  harness,
  lockPlan,
  reachActionPlanning,
  savePlan,
  seedSecretObjectives,
  sessionId,
} from "./test-fixtures.js";

const projection = (
  testHarness: ReturnType<typeof harness>,
  participantId: string,
) => {
  const result = testHarness.app.getGameProjection(
    sessionId(participantId),
    GAME_ID,
  );
  if (!result.ok) throw new Error(`Projection failed for ${participantId}`);
  return result.projection;
};

const finishLocks = (testHarness: ReturnType<typeof harness>): void => {
  for (const participantId of PLAYER_IDS) {
    const state = testHarness.store.snapshot(GAME_ID);
    if (state?.actionPlanning[participantId]?.locked === true) continue;
    savePlan(testHarness, participantId, []);
    lockPlan(testHarness, participantId);
  }
};

describe("M1-1 oracle/addendum owner cases — AuthorizedProjection", () => {
  it("GE-SEC-001 exposes P1 hand identities and names only to P1 and F1", () => {
    const testHarness = harness();
    reachActionPlanning(testHarness);
    const p1 = projection(testHarness, "P1");
    const p2 = projection(testHarness, "P2");
    const f1 = projection(testHarness, "F1");
    const p1CardId = p1.viewerPrivateState?.hands[0]?.cards[0]?.cardInstanceId;

    expect(p1.viewerPrivateState?.hands).toHaveLength(1);
    const firstAuthorizedCard = p1.viewerPrivateState?.hands[0]?.cards[0];
    expect(typeof firstAuthorizedCard?.cardInstanceId).toBe("string");
    expect(typeof firstAuthorizedCard?.definitionId).toBe("string");
    expect(typeof firstAuthorizedCard?.canonicalName).toBe("string");
    expect(
      f1.viewerPrivateState?.hands.find(
        ({ participantId }) => participantId === "P1",
      )?.cards,
    ).toEqual(p1.viewerPrivateState?.hands[0]?.cards);
    expect(JSON.stringify(p2)).not.toContain(p1CardId);
  });

  it("GE-SEC-002 isolates opaque Secret VO condition, metadata and progress from P2 while F1 can inspect them", () => {
    const testHarness = harness();
    reachActionPlanning(testHarness);
    seedSecretObjectives(testHarness);

    const p2SafeFutureAiContext = projection(testHarness, "P2");
    const f1 = projection(testHarness, "F1");
    const rivalSerialized = JSON.stringify(p2SafeFutureAiContext);

    expect(rivalSerialized).not.toContain("OWNER_ONLY_P1_CONDITION");
    expect(rivalSerialized).not.toContain("OWNER_ONLY_P1_METADATA");
    expect(
      p2SafeFutureAiContext.viewerPrivateState?.secretVictoryObjectives[0]
        ?.participantId,
    ).toBe("P2");
    expect(JSON.stringify(f1)).toContain("OWNER_ONLY_P1_CONDITION");
    expect(JSON.stringify(f1)).toContain("OWNER_ONLY_P1_METADATA");
  });

  it("GE-SEC-003 never projects future Operations Deck order, top card or zone positions to player or facilitator views", () => {
    const testHarness = harness();
    reachActionPlanning(testHarness);

    for (const participantId of ["P1", "P2", "F1"]) {
      const serialized = JSON.stringify(projection(testHarness, participantId));
      expect(serialized).not.toContain("operationsDeckOrder");
      expect(serialized).not.toContain("zonePosition");
      expect(serialized).not.toContain("topCard");
    }
  });

  it("GE-SEC-004 keeps every face-down slot private before reveal and projects only current public timing afterward", () => {
    const testHarness = harness();
    const state = reachActionPlanning(testHarness);
    const slot = constructSlot(state, "P1");
    savePlan(testHarness, "P1", [slot, activateSlot(2)]);
    lockPlan(testHarness, "P1");
    const before = projection(testHarness, "P2");
    finishLocks(testHarness);
    const locked = testHarness.store.snapshot(GAME_ID);
    testHarness.dispatcher.revealCurrentAction({
      gameId: GAME_ID,
      expectedGameVersion: locked?.version ?? -1,
      commandId: "security-reveal",
      idempotencyKey: "security-reveal",
    });
    const after = projection(testHarness, "P2");

    expect(before.revealedAction).toBeUndefined();
    expect(JSON.stringify(before)).not.toContain("CONSTRUCT_CAMPAIGN");
    expect(after.revealedAction).toEqual({
      participantId: "P1",
      sequenceIndex: 1,
      actionType: "CONSTRUCT_CAMPAIGN",
    });
    expect(JSON.stringify(after)).not.toContain(
      slot.actionPayload.intentCardInstanceId,
    );
    expect(JSON.stringify(after)).not.toContain("ACTIVATE_CAMPAIGN");
  });

  it("GE-M1-IPL-001 returns the exact authoritative P1 draft to its owner without any query mutation", () => {
    const testHarness = harness();
    const state = reachActionPlanning(testHarness);
    const slots = [constructSlot(state, "P1", 1), activateSlot(2)];
    savePlan(testHarness, "P1", slots);
    const before = testHarness.store.snapshot(GAME_ID);
    const idempotencyBefore = testHarness.store.idempotencyCount();

    const owner = projection(testHarness, "P1");

    expect(owner.gameVersion).toBe(before?.version);
    expect(owner.viewerPrivateState?.actionPlans[0]).toMatchObject({
      participantId: "P1",
      locked: false,
    });
    expect(
      owner.viewerPrivateState?.actionPlans[0]?.slots.map(
        ({ sequenceIndex, actionType, actionPayload }) => ({
          sequenceIndex,
          actionType,
          actionPayload,
        }),
      ),
    ).toEqual(slots);
    expect(testHarness.store.snapshot(GAME_ID)).toEqual(before);
    expect(testHarness.store.idempotencyCount()).toBe(idempotencyBefore);
  });

  it("GE-M1-IPL-002 produces equivalent P2 views for drafts that differ only in classified cards, target or DT", () => {
    const firstHarness = harness();
    const firstState = reachActionPlanning(firstHarness);
    savePlan(firstHarness, "P1", [constructSlot(firstState, "P1")]);

    const secondHarness = harness();
    const secondState = reachActionPlanning(secondHarness);
    const p1Hand = secondState.strategy.P1?.handCardInstanceIds ?? [];
    savePlan(secondHarness, "P1", [
      {
        sequenceIndex: 1,
        actionType: "CONSTRUCT_CAMPAIGN",
        actionPayload: {
          row: "I",
          intentCardInstanceId: p1Hand[2],
          methodCardInstanceId: p1Hand[3],
          targetDtId: "RELIGION:CHRISTIAN",
        },
      },
    ]);

    expect(projection(secondHarness, "P2")).toEqual(
      projection(firstHarness, "P2"),
    );
  });

  it("GE-M1-IPL-003 lets F1 inspect all five complete drafts while withholding future deck order", () => {
    const testHarness = harness();
    const state = reachActionPlanning(testHarness);
    for (const participantId of PLAYER_IDS)
      savePlan(testHarness, participantId, [
        constructSlot(state, participantId),
      ]);

    const before = testHarness.store.snapshot(GAME_ID);
    const f1 = projection(testHarness, "F1");
    const serialized = JSON.stringify(f1);

    expect(f1.viewerPrivateState?.actionPlans).toHaveLength(5);
    expect(
      f1.viewerPrivateState?.actionPlans.every(
        ({ slots }) => slots.length === 1,
      ),
    ).toBe(true);
    expect(serialized).toContain("CONSTRUCT_CAMPAIGN");
    expect(serialized).not.toContain("operationsDeckOrder");
    expect(testHarness.store.snapshot(GAME_ID)).toEqual(before);
  });

  it("GE-M1-IPL-007 property-checks rival serialization against all classified owner values with owner/F1 positives", () => {
    for (let variant = 0; variant < 5; variant += 1) {
      const testHarness = harness();
      const state = reachActionPlanning(testHarness);
      seedSecretObjectives(testHarness);
      const hand = state.strategy.P1?.handCardInstanceIds ?? [];
      const first = hand[variant];
      const second = hand[variant + 1];
      if (first === undefined || second === undefined)
        throw new Error("Generated plan fixture exhausted hand");
      savePlan(testHarness, "P1", [
        {
          sequenceIndex: 1,
          actionType: "CONSTRUCT_CAMPAIGN",
          actionPayload: {
            row: "I",
            intentCardInstanceId: first,
            methodCardInstanceId: second,
            targetDtId: "RACE:BLACK",
          },
        },
      ]);
      const rival = JSON.stringify(projection(testHarness, "P2"));
      const owner = JSON.stringify(projection(testHarness, "P1"));
      const facilitator = JSON.stringify(projection(testHarness, "F1"));

      for (const classified of [
        first,
        second,
        "OWNER_ONLY_P1_CONDITION",
        "OWNER_ONLY_P1_METADATA",
      ]) {
        expect(rival).not.toContain(classified);
        expect(owner).toContain(classified);
        expect(facilitator).toContain(classified);
      }
      expect(rival).not.toContain("operationsDeckOrder");
    }
  });
});
