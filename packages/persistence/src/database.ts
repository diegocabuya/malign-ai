import { Pool, type PoolClient, type PoolConfig } from 'pg';

import { safeDatabaseError } from './errors.js';

export type PostgresConfig = Readonly<PoolConfig>;

export const postgresConfigFromEnvironment = (
  environment: NodeJS.ProcessEnv = process.env,
): PostgresConfig => {
  if (environment['MALIGN_TEST_DATABASE_URL']) {
    return { connectionString: environment['MALIGN_TEST_DATABASE_URL'], max: 12 };
  }
  if (!environment['PGHOST']) {
    throw new Error(
      'PostgreSQL 18.6 is required: set MALIGN_TEST_DATABASE_URL or PGHOST/PGPORT/PGDATABASE/PGUSER',
    );
  }
  return {
    host: environment['PGHOST'],
    port: Number(environment['PGPORT'] ?? '5432'),
    database: environment['PGDATABASE'] ?? 'postgres',
    user: environment['PGUSER'],
    password: environment['PGPASSWORD'],
    max: 12,
  };
};

export const createPostgresPool = (config: PostgresConfig): Pool => new Pool(config);

export const withPostgresClient = async <T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> => {
  const client = await pool.connect();
  try {
    return await operation(client);
  } catch (error) {
    throw safeDatabaseError(error);
  } finally {
    client.release();
  }
};

const assertDisposableDatabaseName = (databaseName: string): void => {
  if (!/^malign_m2a_[a-z0-9_]{8,48}$/.test(databaseName)) {
    throw new Error('Disposable database name must use the malign_m2a_ prefix');
  }
};

export const createDisposableDatabase = async (pool: Pool, databaseName: string): Promise<void> => {
  assertDisposableDatabaseName(databaseName);
  await pool.query(`CREATE DATABASE ${databaseName}`);
};

export const dropDisposableDatabase = async (pool: Pool, databaseName: string): Promise<void> => {
  assertDisposableDatabaseName(databaseName);
  await pool.query(`DROP DATABASE ${databaseName}`);
};

export const configForDatabase = (config: PostgresConfig, database: string): PostgresConfig => {
  const next = { ...config, database };
  delete next.connectionString;
  if (config.connectionString) {
    const url = new URL(config.connectionString);
    url.pathname = `/${database}`;
    return { connectionString: url.toString(), max: config.max };
  }
  return next;
};
