import type { GameId } from '@malign-ai/domain';

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
