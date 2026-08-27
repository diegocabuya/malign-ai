import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Pool, PoolClient } from 'pg';

import { PersistenceError } from './errors.js';

export interface MigrationManifestEntry {
  readonly version: number;
  readonly name: string;
  readonly file: string;
  readonly sha256: string;
}

interface MigrationManifest {
  readonly formatVersion: number;
  readonly targetPostgreSQL: string;
  readonly migrations: readonly MigrationManifestEntry[];
}

interface ProductTableManifest {
  readonly productTableCount: number;
  readonly schema: string;
  readonly tables: readonly string[];
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsRoot = resolve(packageRoot, 'migrations');
const schemaRoot = resolve(packageRoot, 'schema');

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export const loadMigrationManifest = async (): Promise<MigrationManifest> =>
  JSON.parse(await readFile(resolve(migrationsRoot, 'manifest.json'), 'utf8')) as MigrationManifest;

export const loadProductTableManifest = async (): Promise<ProductTableManifest> =>
  JSON.parse(await readFile(resolve(schemaRoot, 'product-tables.json'), 'utf8')) as ProductTableManifest;

export const validateMigrationManifest = async (): Promise<readonly MigrationManifestEntry[]> => {
  const manifest = await loadMigrationManifest();
  if (manifest.formatVersion !== 1 || manifest.targetPostgreSQL !== '18.6') {
    throw new PersistenceError('MIGRATION_MANIFEST_INVALID', 'Unsupported migration manifest');
  }
  for (let index = 0; index < manifest.migrations.length; index += 1) {
    const migration = manifest.migrations[index];
    if (!migration || migration.version !== index + 1 || !/^\d{3}_[a-z0-9_]+\.sql$/.test(migration.file)) {
      throw new PersistenceError('MIGRATION_MANIFEST_INVALID', 'Migration versions must be contiguous');
    }
    const sql = await readFile(resolve(migrationsRoot, migration.file), 'utf8');
    if (sha256(sql) !== migration.sha256) {
      throw new PersistenceError('MIGRATION_CHECKSUM_MISMATCH', `Checksum mismatch at migration ${migration.version}`);
    }
  }
  return manifest.migrations;
};

const ensureLedger = async (client: PoolClient): Promise<void> => {
  await client.query('CREATE SCHEMA IF NOT EXISTS malign_meta');
  await client.query(`
    CREATE TABLE IF NOT EXISTS malign_meta.schema_migrations (
      version integer PRIMARY KEY CHECK (version > 0),
      name text NOT NULL,
      checksum text NOT NULL CHECK (length(checksum) = 64),
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      status text NOT NULL CHECK (status = 'APPLIED')
    )
  `);
};

export const migratePostgres = async (
  pool: Pool,
  options: Readonly<{ targetVersion?: number; applicationBuild?: string }> = {},
): Promise<readonly number[]> => {
  const migrations = await validateMigrationManifest();
  const targetVersion = options.targetVersion ?? migrations.length;
  if (!Number.isInteger(targetVersion) || targetVersion < 0 || targetVersion > migrations.length) {
    throw new PersistenceError('MIGRATION_MANIFEST_INVALID', 'Invalid target migration version');
  }
  const client = await pool.connect();
  const applied: number[] = [];
  try {
    await ensureLedger(client);
    const existing = await client.query<{ version: number; name: string; checksum: string }>(
      'SELECT version, name, checksum FROM malign_meta.schema_migrations ORDER BY version',
    );
    for (const row of existing.rows) {
      const expected = migrations[row.version - 1];
      if (!expected || expected.name !== row.name || expected.sha256 !== row.checksum) {
        throw new PersistenceError('MIGRATION_CHECKSUM_MISMATCH', `Applied migration ${row.version} differs from manifest`);
      }
    }
    for (const migration of migrations) {
      if (migration.version > targetVersion || existing.rows.some((row) => row.version === migration.version)) continue;
      const sql = await readFile(resolve(migrationsRoot, migration.file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO malign_meta.schema_migrations(version, name, checksum, status) VALUES ($1, $2, $3, $4)',
          [migration.version, migration.name, migration.sha256, 'APPLIED'],
        );
        await client.query(
          `INSERT INTO malign.schema_migrations(version, name, checksum, application_build)
           VALUES ($1, $2, decode($3, 'hex'), $4)`,
          [String(migration.version).padStart(3, '0'), migration.name, migration.sha256, options.applicationBuild ?? 'local'],
        );
        await client.query('COMMIT');
        applied.push(migration.version);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    return applied;
  } finally {
    client.release();
  }
};

export const validateProductSchema = async (pool: Pool): Promise<void> => {
  const manifest = await loadProductTableManifest();
  const result = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name`,
    [manifest.schema],
  );
  const actual = result.rows.map((row) => row.table_name).sort();
  const expected = [...manifest.tables].sort();
  if (actual.length !== manifest.productTableCount || JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new PersistenceError('SCHEMA_MANIFEST_MISMATCH', 'Product schema differs from the approved 87-table manifest', {
      expected: manifest.productTableCount,
      actual: actual.length,
    });
  }
};
