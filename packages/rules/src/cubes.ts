export interface TwoToOneResolution {
  readonly generated: number;
  readonly consumedInCancellation: number;
  readonly oppositeRemoved: number;
  readonly placed: number;
  readonly oppositeRemaining: number;
}

const requireCount = (value: number, field: string): number => {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${field} must be a non-negative integer`);
  return value;
};

export const resolveTwoToOne = (incomingCount: number, oppositeExisting: number): TwoToOneResolution => {
  const generated = requireCount(incomingCount, 'incomingCount');
  const opposite = requireCount(oppositeExisting, 'oppositeExisting');
  const oppositeRemoved = Math.min(Math.floor(generated / 2), opposite);
  const consumedInCancellation = oppositeRemoved * 2;
  return { generated, consumedInCancellation, oppositeRemoved, placed: generated - consumedInCancellation, oppositeRemaining: opposite - oppositeRemoved };
};
