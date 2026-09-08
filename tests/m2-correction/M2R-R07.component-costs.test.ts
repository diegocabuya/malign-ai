import { describe, expect, it } from 'vitest';
import { adjudicationHarness, GAME_ID, runActivation, runConstruct } from '../m1-2/test-fixtures.js';

const activationCostEntries = (serial: 54 | 69, resources = 10) => {
  const testHarness = adjudicationHarness({ serials: [102, serial], resources, die: 7 });
  const constructed = runConstruct(testHarness);
  if (constructed.status !== 'RESOLVED') throw new Error(JSON.stringify(constructed));
  const before = testHarness.store.snapshot(GAME_ID)!;
  const result = runActivation(testHarness);
  const after = testHarness.store.snapshot(GAME_ID)!;
  return { testHarness, before, result, after };
};

describe('M2R-R07 — approved campaign-component resource costs', () => {
  it('GE-ERT-009 charges Military Exercises as the valid MEDIUM tier cost plus one component resource', () => {
    const { before, result, after } = activationCostEntries(54);
    expect(result).toMatchObject({ status: 'RESOLVED', resultCode: 'CAMPAIGN_ACTIVATION_COMPLETED' });
    expect(before.countries.ARDEN.resources - after.countries.ARDEN.resources).toBe(3);
    expect(after.resourceLedger.slice(-2)).toMatchObject([
      { reason: 'CAMPAIGN_ACTIVATION_COST', delta: -2 },
      { reason: 'CAMPAIGN_COMPONENT_COST', delta: -1 },
    ]);
    expect(after.events.findLast(({ type }) => type === 'CAMPAIGN_COST_PAID')?.payload)
      .toMatchObject({ amount: 3, tierCost: 2, componentCost: 1 });
    expect(after.adjudication.traces.at(-1)).toMatchObject({ baseCv: 9, baseTier: 'MEDIUM', resourceCost: 3 });
  });

  it('GE-ERT-010 charges Military Mobilization as the valid MEDIUM tier cost plus three component resources', () => {
    const { before, result, after } = activationCostEntries(69);
    expect(result).toMatchObject({ status: 'RESOLVED', resultCode: 'CAMPAIGN_ACTIVATION_COMPLETED' });
    expect(before.countries.ARDEN.resources - after.countries.ARDEN.resources).toBe(5);
    expect(after.resourceLedger.slice(-2)).toMatchObject([
      { reason: 'CAMPAIGN_ACTIVATION_COST', delta: -2 },
      { reason: 'CAMPAIGN_COMPONENT_COST', delta: -3 },
    ]);
    expect(after.events.findLast(({ type }) => type === 'CAMPAIGN_COST_PAID')?.payload)
      .toMatchObject({ amount: 5, tierCost: 2, componentCost: 3 });
    expect(after.adjudication.traces.at(-1)).toMatchObject({ baseCv: 9, baseTier: 'MEDIUM', resourceCost: 5 });
  });

  it('fails atomically before narrative, die and ERT when the total component-inclusive cost is unavailable', () => {
    const { before, result, after } = activationCostEntries(69, 2);
    expect(result).toMatchObject({ status: 'RESOLVED', resultCode: 'COST_PAYMENT_FAILED' });
    expect(after.countries.ARDEN.resources).toBe(before.countries.ARDEN.resources);
    expect(after.resourceLedger).toEqual(before.resourceLedger);
    expect(after.adjudication.dieRolls).toEqual(before.adjudication.dieRolls);
    expect(after.events.slice(before.events.length).map(({ type }) => type)).not.toContain('ERT_RESOLVED');
  });
});
