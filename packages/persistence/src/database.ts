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

export type EphemeralProductRole =
  | 'malign_migration_owner'
  | 'malign_app_runtime'
  | 'malign_outbox_publisher';

const assertEphemeralPrincipalName = (name: string): void => {
  if (!/^malign_test_(migrator|app|outbox)_[a-z0-9]{6,24}$/.test(name)) {
    throw new Error('Ephemeral principal name is outside the approved test namespace');
  }
};

export interface EphemeralPrincipalAudit {
  readonly principal: string;
  readonly memberOf: EphemeralProductRole;
  readonly canLogin: true;
  readonly superuser: false;
  readonly createDatabase: false;
  readonly createRole: false;
  readonly memberships: readonly string[];
}

export const createEphemeralLoginPrincipal = async (
  administrativePool: Pool,
  principal: string,
  memberOf: EphemeralProductRole,
  databaseName: string,
): Promise<EphemeralPrincipalAudit> => {
  assertEphemeralPrincipalName(principal);
  await administrativePool.query(
    `CREATE ROLE ${principal} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT`,
  );
  await administrativePool.query(`GRANT ${memberOf} TO ${principal}`);
  await administrativePool.query(`GRANT CONNECT ON DATABASE ${databaseName} TO ${principal}`);
  const row = (await administrativePool.query<{
    rolcanlogin: boolean; rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean; memberships: string[];
  }>(`SELECT r.rolcanlogin,r.rolsuper,r.rolcreatedb,r.rolcreaterole,
       ARRAY(SELECT granted.rolname::text FROM pg_auth_members m JOIN pg_roles granted ON granted.oid=m.roleid
              WHERE m.member=r.oid ORDER BY granted.rolname)::text[] memberships
       FROM pg_roles r WHERE r.rolname=$1`, [principal])).rows[0];
  if (!row || !row.rolcanlogin || row.rolsuper || row.rolcreatedb || row.rolcreaterole ||
      row.memberships.length !== 1 || row.memberships[0] !== memberOf) {
    throw new Error(`Ephemeral principal does not satisfy the least-privilege contract: ${JSON.stringify(row)}`);
  }
  return { principal, memberOf, canLogin: true, superuser: false, createDatabase: false, createRole: false,
    memberships: row.memberships };
};

export const dropEphemeralLoginPrincipal = async (administrativePool: Pool, principal: string): Promise<void> => {
  assertEphemeralPrincipalName(principal);
  await administrativePool.query(`DROP ROLE IF EXISTS ${principal}`);
};

export const configForPrincipal = (config: PostgresConfig, principal: string): PostgresConfig => {
  assertEphemeralPrincipalName(principal);
  if (config.connectionString) {
    const url = new URL(config.connectionString);
    url.username = principal;
    url.password = '';
    return { connectionString: url.toString(), max: config.max };
  }
  return { ...config, user: principal, password: undefined };
};

/** Executes a negative physical-contract probe and guarantees total rollback. */
export const probeConstraintViolation = async (
  pool: Pool,
  sql: string,
  parameters: readonly unknown[] = [],
): Promise<ReturnType<typeof safeDatabaseError>> => {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE malign_app_runtime');
    try {
      await client.query(sql,[...parameters]);
    } catch (error) {
      await client.query('ROLLBACK');
      return safeDatabaseError(error);
    }
    await client.query('ROLLBACK');
    throw new Error('Constraint probe unexpectedly succeeded');
  } finally { client.release(); }
};
