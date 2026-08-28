import type { GameId } from '@malign-ai/domain';

export * from './database.js';
export * from './errors.js';
export * from './evidence.js';
export * from './migrations.js';
export * from './outbox.js';
export * from './query-budgets.js';
export * from './recovery.js';
export * from './registry-seed.js';
export * from './runtime-identity.js';
export * from './test-fixture.js';
export * from './unit-of-work.js';

export interface VersionedEntity {
  readonly id: string;
  readonly version: number;
}

export interface Repository<T extends VersionedEntity> {
  findById(id: string): Promise<T | undefined>;
  save(entity: T): Promise<void>;
}

export interface GameRepository<T extends VersionedEntity> extends Repository<T> {
  findByGameId(gameId: GameId): Promise<T | undefined>;
}

export type CardRepository<T extends VersionedEntity> = Repository<T>;
export type ScenarioRepository<T extends VersionedEntity> = Repository<T>;
export type RulesetRepository<T extends VersionedEntity> = Repository<T>;
export type IdempotencyRepository<T extends VersionedEntity> = Repository<T>;
export type EventRepository<T extends VersionedEntity> = Repository<T>;
export type TraceRepository<T extends VersionedEntity> = Repository<T>;
export type OutboxRepository<T extends VersionedEntity> = Repository<T>;

export interface PersistenceUnitOfWork<TCommand, TResult> {
  execute(command: TCommand): Promise<TResult>;
}

export interface AggregateRepository<TAggregate extends VersionedEntity> extends GameRepository<TAggregate> {
  saveExpectedVersion(aggregate: TAggregate, expectedVersion: number): Promise<void>;
}

export interface AppendOnlyJournalRepository<TEntry extends VersionedEntity> {
  append(entry: TEntry): Promise<void>;
  listByGame(gameId: GameId, afterSequence?: number): Promise<readonly TEntry[]>;
}

export type ActionPointJournalRepository<T extends VersionedEntity> = AppendOnlyJournalRepository<T>;
export type ResourceJournalRepository<T extends VersionedEntity> = AppendOnlyJournalRepository<T>;
export type VictoryPointJournalRepository<T extends VersionedEntity> = AppendOnlyJournalRepository<T>;
export type InfluenceJournalRepository<T extends VersionedEntity> = AppendOnlyJournalRepository<T>;
export type LegitimacyJournalRepository<T extends VersionedEntity> = AppendOnlyJournalRepository<T>;
export type SnapshotRepository<T extends VersionedEntity> = AppendOnlyJournalRepository<T>;
export type ContinuationRepository<T extends VersionedEntity> = Repository<T>;
export type ChoiceRepository<T extends VersionedEntity> = Repository<T>;
export type RegistryPinRepository<T extends VersionedEntity> = Repository<T>;
export type OutboxMessageRepository<T extends VersionedEntity> = AppendOnlyJournalRepository<T>;
export type OutboxDeliveryStateRepository<T extends VersionedEntity> = Repository<T>;
export type OutboxDeliveryAttemptRepository<T extends VersionedEntity> = AppendOnlyJournalRepository<T>;

export interface ReconciliationPort {
  reconcile(gameId: GameId): Promise<void>;
}

export interface RecoveryPort<TRecovered> {
  recover(gameId: GameId): Promise<TRecovered>;
}

export class InMemoryRepository<T extends VersionedEntity> implements Repository<T> {
  readonly #entities = new Map<string, T>();

  findById(id: string): Promise<T | undefined> {
    return Promise.resolve(this.#entities.get(id));
  }

  save(entity: T): Promise<void> {
    this.#entities.set(entity.id, entity);
    return Promise.resolve();
  }

  clear(): void {
    this.#entities.clear();
  }
}
