import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GAME_ID,
  PLAYER_IDS,
  harness,
  lockMaintenance,
  reachInitiative,
  requestInitiative,
  setMaintenance,
} from "./test-fixtures.js";

const fixture = JSON.parse(
  readFileSync(
    new URL("../fixtures/m1-1/initiative-and-secrets.json", import.meta.url),
    "utf8",
  ),
) as {
  readonly initiative_sequences: Readonly<Record<string, readonly number[]>>;
};

const sequence = (name: string): readonly number[] => {
  const value = fixture.initiative_sequences[name];
  if (value === undefined)
    throw new Error(`Missing initiative fixture ${name}`);
  return value;
};

describe("M1-1 oracle/addendum owner cases — deterministic initiative and minimum maintenance", () => {
  it("GE-INI-001 resolves a unique highest roll then rotates exact clockwise initiative order", () => {
    const testHarness = harness();
    reachInitiative(testHarness);

    const result = requestInitiative(testHarness, sequence("unique_highest"));
    const state = testHarness.store.snapshot(GAME_ID);

    expect(result.status).toBe("RESOLVED");
    expect(state?.initiative.winnerParticipantId).toBe("P3");
    expect(state?.initiative.orderParticipantIds).toEqual([
      "P3",
      "P4",
      "P5",
      "P1",
      "P2",
    ]);
    expect(
      state?.initiative.rolls.map(({ participantId, rawValue }) => [
        participantId,
        rawValue,
      ]),
    ).toEqual([
      ["P1", 8],
      ["P2", 4],
      ["P3", 10],
      ["P4", 9],
      ["P5", 2],
    ]);
    expect(
      state?.events.findLast(({ type }) => type === "INITIATIVE_ORDER_SET")
        ?.payload.order,
    ).toBe("P3,P4,P5,P1,P2");
  });

  it("GE-INI-002 rerolls only the tied highest participants and audits the winner", () => {
    const testHarness = harness();
    reachInitiative(testHarness);
    const requestsBefore = testHarness.random.requests.length;

    requestInitiative(testHarness, sequence("single_reroll"));
    const state = testHarness.store.snapshot(GAME_ID);
    const rolls = state?.initiative.rolls ?? [];

    expect(testHarness.random.requests.slice(requestsBefore)).toHaveLength(7);
    expect(
      rolls
        .filter(({ attempt }) => attempt === 2)
        .map(({ participantId, rawValue }) => [participantId, rawValue]),
    ).toEqual([
      ["P1", 4],
      ["P2", 7],
    ]);
    expect(state?.initiative.winnerParticipantId).toBe("P2");
    expect(
      rolls.some(
        ({ attempt, participantId }) =>
          attempt === 2 && ["P3", "P4", "P5"].includes(participantId),
      ),
    ).toBe(false);
  });

  it("GE-INI-003 repeats tied-highest rerolls until one deterministic winner remains", () => {
    const testHarness = harness();
    reachInitiative(testHarness);

    requestInitiative(testHarness, sequence("multiple_rerolls"));
    const rolls = testHarness.store.snapshot(GAME_ID)?.initiative.rolls ?? [];

    expect(
      rolls.map(({ participantId, attempt, rawValue }) => [
        participantId,
        attempt,
        rawValue,
      ]),
    ).toEqual([
      ["P1", 1, 10],
      ["P2", 1, 10],
      ["P3", 1, 9],
      ["P4", 1, 3],
      ["P5", 1, 2],
      ["P1", 2, 8],
      ["P2", 2, 8],
      ["P1", 3, 6],
      ["P2", 3, 9],
    ]);
  });

  it("GE-INI-004 discards any valid own subset, fills an eight-card hand to ten and applies income", () => {
    const testHarness = harness();
    reachInitiative(testHarness);
    requestInitiative(testHarness, [10, 8, 6, 4, 2]);
    const seeded = testHarness.store.snapshot(GAME_ID);
    const strategy = seeded?.strategy.P1;
    if (seeded === undefined || strategy === undefined)
      throw new Error("P1 strategy missing");
    const movedOut = strategy.handCardInstanceIds.splice(-2);
    strategy.operationsDeckOrder.unshift(...movedOut);
    for (const cardId of movedOut)
      seeded.cards[cardId]!.zone = "OPERATIONS_DECK";
    const discarded = strategy.handCardInstanceIds.slice(0, 3);
    if (!testHarness.store.commitState(GAME_ID, seeded.version, seeded))
      throw new Error("Seed failed");
    const resourcesBefore = seeded.countries.ARDEN.resources;

    expect(setMaintenance(testHarness, "P1", discarded).status).toBe(
      "RESOLVED",
    );
    const result = lockMaintenance(testHarness, "P1");
    const state = testHarness.store.snapshot(GAME_ID);

    expect(result.status).toBe("RESOLVED");
    expect(state?.strategy.P1?.handCardInstanceIds).toHaveLength(10);
    expect(state?.strategy.P1?.discardCardInstanceIds).toEqual(discarded);
    expect(
      state?.events
        .filter(
          ({ type, payload }) =>
            type === "CARD_DRAWN" && payload.participantId === "P1",
        )
        .slice(-5),
    ).toHaveLength(5);
    expect(state?.countries.ARDEN.resources).toBe(resourcesBefore + 2);
  });

  it("GE-INI-005 draws the final two deck cards, reshuffles recyclable discard once and draws three more", () => {
    const testHarness = harness();
    reachInitiative(testHarness);
    requestInitiative(testHarness, [10, 8, 6, 4, 2]);
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
      throw new Error("Seed failed");
    testHarness.random.enqueue(0, 0, 0);

    setMaintenance(testHarness, "P1", []);
    lockMaintenance(testHarness, "P1");
    const state = testHarness.store.snapshot(GAME_ID);
    const reshuffles =
      state?.events.filter(
        ({ type, payload }) =>
          type === "DECK_SHUFFLED" && payload.source === "DISCARD_RESHUFFLE",
      ) ?? [];

    expect(state?.strategy.P1?.handCardInstanceIds).toHaveLength(10);
    expect(reshuffles).toHaveLength(1);
    expect(state?.strategy.P1?.operationsDeckOrder).toHaveLength(1);
    expect(state?.strategy.P1?.discardCardInstanceIds).toEqual([]);
  });

  it("GE-INI-006 stops fill without error when deck and recyclable discard are empty but still applies income", () => {
    const testHarness = harness();
    reachInitiative(testHarness);
    requestInitiative(testHarness, [10, 8, 6, 4, 2]);
    const seeded = testHarness.store.snapshot(GAME_ID);
    const strategy = seeded?.strategy.P1;
    if (seeded === undefined || strategy === undefined)
      throw new Error("P1 strategy missing");
    strategy.handCardInstanceIds = strategy.handCardInstanceIds.slice(0, 8);
    strategy.operationsDeckOrder = [];
    strategy.discardCardInstanceIds = [];
    for (const card of Object.values(seeded.cards).filter(
      ({ controllerParticipantId }) => controllerParticipantId === "P1",
    )) {
      if (
        !strategy.handCardInstanceIds.includes(card.id) &&
        (card.zone === "HAND" || card.zone === "OPERATIONS_DECK")
      )
        card.zone = "OPERATIONS_POOL";
    }
    const resourcesBefore = seeded.countries.ARDEN.resources;
    if (!testHarness.store.commitState(GAME_ID, seeded.version, seeded))
      throw new Error("Seed failed");

    setMaintenance(testHarness, "P1", []);
    const result = lockMaintenance(testHarness, "P1");
    const state = testHarness.store.snapshot(GAME_ID);

    expect(result.status).toBe("RESOLVED");
    expect(state?.strategy.P1?.handCardInstanceIds).toHaveLength(8);
    expect(state?.countries.ARDEN.resources).toBe(resourcesBefore + 2);
  });

  it("GE-INI-009 applies exact country income once and reconciles five TURN_INCOME ledger entries", () => {
    const testHarness = harness();
    reachInitiative(testHarness);
    requestInitiative(testHarness, [10, 8, 6, 4, 2]);
    const before = testHarness.store.snapshot(GAME_ID);
    const expectedIncome = { P1: 2, P2: 1, P3: 2, P4: 2, P5: 3 } as const;

    for (const participantId of PLAYER_IDS) {
      setMaintenance(testHarness, participantId, []);
      lockMaintenance(testHarness, participantId);
    }
    const state = testHarness.store.snapshot(GAME_ID);

    expect(state?.phase).toBe("ACTION_STAGE_PLAN");
    expect(
      state?.resourceLedger.map(({ participantId, delta, reason }) => ({
        participantId,
        delta,
        reason,
      })),
    ).toEqual(
      PLAYER_IDS.map((participantId) => ({
        participantId,
        delta: expectedIncome[participantId],
        reason: "TURN_INCOME",
      })),
    );
    for (const participantId of PLAYER_IDS) {
      const countryId = state?.seats[participantId]?.countryId;
      if (countryId === undefined) throw new Error("Seat missing");
      expect(state.countries[countryId].resources).toBe(
        before!.countries[countryId].resources + expectedIncome[participantId],
      );
    }
  });

  it("GE-M1-IPL-005 consumes only the deterministic script and rejects exhaustion or out-of-range values atomically", () => {
    for (const values of [
      [8, 4],
      [8, 4, 11],
    ]) {
      const testHarness = harness();
      reachInitiative(testHarness);
      const before = testHarness.store.snapshot(GAME_ID);
      const requestsBefore = testHarness.random.requests.length;
      testHarness.random.enqueue(...values);
      testHarness.random.requireScript();

      const current = testHarness.store.snapshot(GAME_ID);
      const result = testHarness.app.execute("session-p1", {
        engineContractVersion: "0.1",
        commandId: `rng-failure-${values.length}`,
        idempotencyKey: `rng-failure-${values.length}`,
        gameId: GAME_ID,
        expectedGameVersion: current?.version ?? -1,
        commandType: "REQUEST_INITIATIVE_ROLL",
        payloadSchemaVersion: "0.1",
        payload: {},
      });

      expect(result.resultCode).toBe("RANDOM_PROVIDER_FAILURE");
      expect(testHarness.store.snapshot(GAME_ID)).toEqual(before);
      expect(testHarness.random.requests.length - requestsBefore).toBe(
        values.length === 2 ? 3 : 3,
      );
    }
  });
});
