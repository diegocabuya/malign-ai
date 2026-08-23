import { describe, expect, it } from 'vitest';
import { satisfiesGlobalNumericInvariants, tierForCampaignValue } from '../../packages/rules/src/index.js';

describe('PR-1 global numeric invariants', () => {
  it('GE-CORE-012 enforces non-negative quantities, hand cap, and single card zone', () => {
    expect(satisfiesGlobalNumericInvariants({ actionPoints: [0, 3], resources: [0, 12], victoryPoints: [0, 20], cubeCounts: [0, 40], handSizes: [0, 10], cardZoneAssignments: [{ cardInstanceId: 'card-1', zone: 'HAND' }, { cardInstanceId: 'card-2', zone: 'DECK' }] })).toBe(true);
    expect(satisfiesGlobalNumericInvariants({ actionPoints: [-1], resources: [0], victoryPoints: [0], cubeCounts: [0], handSizes: [11], cardZoneAssignments: [{ cardInstanceId: 'card-1', zone: 'HAND' }, { cardInstanceId: 'card-1', zone: 'DISCARD' }] })).toBe(false);
  });

  it('invariant: every non-negative integer CV maps to exactly one tier', () => {
    for (let value = 0; value <= 1_000; value += 1) expect(['LOW', 'MEDIUM', 'HIGH']).toContain(tierForCampaignValue(value));
  });
});
