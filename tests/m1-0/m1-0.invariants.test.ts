import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CountryId } from '../../packages/domain/src/index.js';
import {
  GAME_ID,
  PARTICIPANT_FIXTURE,
  command,
  completeAndStart,
  createGame,
  harness,
  joinPlayers,
  lockStrategy,
  sessionId,
  submitDeck,
} from './test-fixtures.js';

interface ScenarioFixture {
  readonly fixture_schema_version: string;
  readonly countries: readonly { readonly id: CountryId; readonly starting_resources: number; readonly turn_income: number }[];
  readonly pd_initial_influence: readonly (readonly [string, 'MALIGN' | 'RESILIENCY', number, CountryId])[];
  readonly cards_per_country: number;
  readonly operations_pool_per_country: number;
}

const scenarioFixture = JSON.parse(
  readFileSync(new URL('../fixtures/m1-0/scenario-base-m1.json', import.meta.url), 'utf8'),
) as ScenarioFixture;

describe('M1-0 complementary invariants', () => {
  it('keeps explicit BASE_2025 fixture counts, resources, income and attributed influence exact', () => {
    const testHarness = harness();
    createGame(testHarness);
    const state = testHarness.app.gameSnapshot(GAME_ID);

    expect(scenarioFixture.fixture_schema_version).toBe('0.1');
    expect(Object.values(state?.countries ?? {}).map(({ id, resources, turnIncome }) => ({ id, starting_resources: resources, turn_income: turnIncome }))).toEqual(scenarioFixture.countries);
    expect(Object.values(state?.populationDemographics ?? {}).map((pd) => [pd.id, pd.initialInfluence.type, pd.initialInfluence.count, pd.initialInfluence.attributionCountryId])).toEqual(scenarioFixture.pd_initial_influence);
    for (const country of scenarioFixture.countries) {
      const cards = Object.values(state?.cards ?? {}).filter(({ countryOwnerId }) => countryOwnerId === country.id);
      expect(cards).toHaveLength(scenarioFixture.cards_per_country);
      expect(cards.filter((card) => state?.cardDefinitions[card.definitionId]?.starter === false)).toHaveLength(scenarioFixture.operations_pool_per_country);
    }
  });

  it('preserves participant, country, seat and clockwise uniqueness for every canonical assignment order', () => {
    const players = PARTICIPANT_FIXTURE.participants.filter((participant) => participant.role === 'PLAYER');
    for (let rotation = 0; rotation < players.length; rotation += 1) {
      const testHarness = harness();
      createGame(testHarness);
      joinPlayers(testHarness);
      const order = [...players.slice(rotation), ...players.slice(0, rotation)];
      for (const player of order) {
        const before = testHarness.app.gameSnapshot(GAME_ID);
        if (player.country_id === undefined || player.seat_index === undefined || player.clockwise_index === undefined) throw new Error('Invalid fixture');
        const result = testHarness.app.execute(sessionId('F1'), command('ASSIGN_PLAYER_SEAT', GAME_ID, before?.version ?? -1, {
          playerParticipantId: player.participant_id,
          countryId: player.country_id,
          seatIndex: player.seat_index,
          clockwiseIndex: player.clockwise_index,
        }));
        const seats = Object.values(testHarness.app.gameSnapshot(GAME_ID)?.seats ?? {});
        expect(result.status).toBe('RESOLVED');
        expect(new Set(seats.map(({ participantId }) => participantId)).size).toBe(seats.length);
        expect(new Set(seats.map(({ countryId }) => countryId)).size).toBe(seats.length);
        expect(new Set(seats.map(({ seatIndex }) => seatIndex)).size).toBe(seats.length);
        expect(new Set(seats.map(({ clockwiseIndex }) => clockwiseIndex)).size).toBe(seats.length);
      }
    }
  });

  it('transitions exactly once to INITIATIVE_STAGE after five valid Strategy locks and stops there', () => {
    const testHarness = harness();
    completeAndStart(testHarness);
    for (const participantId of ['P1', 'P2', 'P3', 'P4', 'P5']) {
      expect(submitDeck(testHarness, participantId).status).toBe('RESOLVED');
      expect(lockStrategy(testHarness, participantId).status).toBe('RESOLVED');
    }
    const state = testHarness.app.gameSnapshot(GAME_ID);

    expect(state?.phase).toBe('INITIATIVE_STAGE');
    expect(Object.values(state?.strategy ?? {}).every(({ locked }) => locked)).toBe(true);
    expect(state?.events.filter(({ type, payload }) => type === 'PHASE_CHANGED' && payload.phase === 'INITIATIVE_STAGE')).toHaveLength(1);
    expect(state?.events.filter(({ type }) => type === 'CARD_DRAWN')).toHaveLength(25);
    expect(testHarness.random.requests).toHaveLength(29 * 5);
  });
});
