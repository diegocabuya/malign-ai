export interface CardZoneAssignment { readonly cardInstanceId: string; readonly zone: string; }
export interface GlobalInvariantState {
  readonly actionPoints: readonly number[];
  readonly resources: readonly number[];
  readonly victoryPoints: readonly number[];
  readonly cubeCounts: readonly number[];
  readonly handSizes: readonly number[];
  readonly cardZoneAssignments: readonly CardZoneAssignment[];
}

const allNonNegativeIntegers = (values: readonly number[]): boolean => values.every((value) => Number.isInteger(value) && value >= 0);

export const satisfiesGlobalNumericInvariants = (state: GlobalInvariantState): boolean => {
  const cardIds = state.cardZoneAssignments.map(({ cardInstanceId }) => cardInstanceId);
  return allNonNegativeIntegers(state.actionPoints) && allNonNegativeIntegers(state.resources) && allNonNegativeIntegers(state.victoryPoints) && allNonNegativeIntegers(state.cubeCounts) && state.handSizes.every((size) => Number.isInteger(size) && size >= 0 && size <= 10) && new Set(cardIds).size === cardIds.length;
};
