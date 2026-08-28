export type PersistenceErrorCode =
  | 'DATABASE_UNAVAILABLE'
  | 'MIGRATION_CHECKSUM_MISMATCH'
  | 'MIGRATION_MANIFEST_INVALID'
  | 'MIGRATION_AUTHORITY_INVALID'
  | 'SCHEMA_MANIFEST_MISMATCH'
  | 'REGISTRY_SNAPSHOT_REJECTED'
  | 'GAME_NOT_FOUND'
  | 'GAME_RECOVERY_BLOCKED'
  | 'GAME_VERSION_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'TRANSACTION_WRITE_FAILED'
  | 'CROSS_GAME_REFERENCE'
  | 'RECONCILIATION_MISMATCH'
  | 'FACILITATOR_REASON_REQUIRED'
  | 'UNKNOWN_TARGET'
  | 'SINGLE_ZONE_VIOLATION'
  | 'ORDERING_CONSTRAINT_VIOLATION'
  | 'NEGATIVE_BALANCE'
  | 'REFERENCE_CONSTRAINT_VIOLATION'
  | 'REPLAY_EVENT_SEQUENCE_INVALID'
  | 'REPLAY_SCHEMA_UNSUPPORTED'
  | 'REPLAY_HASH_MISMATCH'
  | 'CONTINUATION_INVALID'
  | 'ENGINE_TRANSITION_REQUIRED';

export class PersistenceError extends Error {
  constructor(
    readonly code: PersistenceErrorCode,
    message: string,
    readonly safeDetail: Readonly<Record<string, string | number | boolean>> = {},
  ) {
    super(message);
    this.name = 'PersistenceError';
  }
}

export const safeDatabaseError = (error: unknown): PersistenceError => {
  if (error instanceof PersistenceError) return error;
  const candidate = error as { readonly code?: string; readonly constraint?: string; readonly message?: string };
  const message = candidate.message ?? '';
  const constraint = candidate.constraint ?? '';
  if (message.includes('M2A_SINGLE_ZONE_VIOLATION')) {
    return new PersistenceError('SINGLE_ZONE_VIOLATION', 'A card cannot occupy incompatible zones');
  }
  if (constraint.includes('artifact_ordinal') || constraint.includes('sequence') || candidate.code === '23505') {
    return new PersistenceError('ORDERING_CONSTRAINT_VIOLATION', 'Durable sequence or ordinal is invalid');
  }
  if (constraint.includes('nonnegative') || message.includes('violates check constraint')) {
    return new PersistenceError('NEGATIVE_BALANCE', 'A durable balance cannot become negative');
  }
  if (candidate.code === '23503') {
    return new PersistenceError(
      constraint.includes('_game_') || constraint.includes('cross_game')
        ? 'CROSS_GAME_REFERENCE'
        : 'REFERENCE_CONSTRAINT_VIOLATION',
      'A durable reference is invalid',
    );
  }
  return new PersistenceError('DATABASE_UNAVAILABLE', 'PostgreSQL operation failed');
};
