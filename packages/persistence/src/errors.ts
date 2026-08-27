export type PersistenceErrorCode =
  | 'DATABASE_UNAVAILABLE'
  | 'MIGRATION_CHECKSUM_MISMATCH'
  | 'MIGRATION_MANIFEST_INVALID'
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
  | 'UNKNOWN_TARGET';

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
  return new PersistenceError('DATABASE_UNAVAILABLE', 'PostgreSQL operation failed');
};
