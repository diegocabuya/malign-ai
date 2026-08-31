import { describe, expect, it } from 'vitest';
import { applyM2StateToCanonical, buildM2StateFromCanonical } from '../../packages/game-engine/src/index.js';
import { completeAndStart, harness } from '../m1-0/test-fixtures.js';

describe('M2R-R01 canonical state integration seam', () => {
  it('round-trips resources, VP, influence, legitimacy and scheduler through canonical state', () => {
    const testHarness = harness();
    const state = completeAndStart(testHarness);
    const m2 = buildM2StateFromCanonical(state);
    const participant = m2.participants.P1!;
    participant.resources += 3; participant.victoryPoints += 4;
    m2.influence.push({ pdId: 'ARDEN_PD_1', type: 'RESILIENCY', attributionCountryId: 'ARDEN', count: 2 });
    m2.legitimacyByPd.ARDEN_PD_1 = 'P1'; m2.scheduler.status = 'COMPLETE';
    applyM2StateToCanonical(state, m2);
    expect(state.countries.ARDEN.resources).toBe(participant.resources);
    expect(state.adjudication.vpByParticipant.P1).toBe(participant.victoryPoints);
    expect(state.adjudication.influenceStacks.at(-1)).toMatchObject({ pdId: 'ARDEN_PD_1', type: 'RESILIENCY', count: 2 });
    expect(state.adjudication.legitimacyByPd.ARDEN_PD_1).toBe('P1');
    expect(state.adjudication.scheduler.status).toBe('COMPLETE');
  });
});
