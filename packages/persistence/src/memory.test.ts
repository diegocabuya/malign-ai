import { describe, expect, it } from 'vitest';
import { InMemoryRepository } from './index.js';

describe('PR-0 in-memory repository skeleton', () => {
  it('stores and retrieves a versioned entity', async () => {
    const repository = new InMemoryRepository<{ id: string; version: number }>();
    await repository.save({ id: 'game-1', version: 0 });
    await expect(repository.findById('game-1')).resolves.toEqual({ id: 'game-1', version: 0 });
  });
});
