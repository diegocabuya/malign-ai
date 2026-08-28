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
  readonly formatVersion: number;
  readonly decision: string;
  readonly productTableCount: number;
  readonly schema: string;
  readonly tables: readonly string[];
  readonly catalogSha256: string;
  readonly catalogCoverage: readonly string[];
  readonly requiredInvariants: readonly string[];
}

export interface MigrationExecutionAudit {
  readonly version: number;
  readonly executionMode: 'MIGRATION_ROLE' | 'ADMIN_BOOTSTRAP_EXCEPTION';
  readonly sessionUser: string;
  readonly currentUser: string;
}

export interface ClusterBootstrapAudit {
  readonly sessionUser: string;
  readonly currentUser: string;
  readonly migrationOwner: 'malign_migration_owner';
  readonly applicationRuntime: 'malign_app_runtime';
  readonly outboxPublisher: 'malign_outbox_publisher';
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsRoot = resolve(packageRoot, 'migrations');
const schemaRoot = resolve(packageRoot, 'schema');

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

let latestMigrationAudit: readonly MigrationExecutionAudit[] = [];

export const getLatestMigrationExecutionAudit = (): readonly MigrationExecutionAudit[] =>
  structuredClone(latestMigrationAudit);

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

export const bootstrapPostgresClusterRoles = async (pool: Pool): Promise<ClusterBootstrapAudit> => {
  const client = await pool.connect();
  try {
    await client.query(`
      DO $body$
      DECLARE member_name text;
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='malign_migration_owner') THEN
          CREATE ROLE malign_migration_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='malign_app_runtime') THEN
          CREATE ROLE malign_app_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='malign_outbox_publisher') THEN
          CREATE ROLE malign_outbox_publisher NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
        END IF;
        ALTER ROLE malign_migration_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
        ALTER ROLE malign_app_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
        ALTER ROLE malign_outbox_publisher NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
        FOR member_name IN
          SELECT member_role.rolname
          FROM pg_auth_members membership
          JOIN pg_roles granted_role ON granted_role.oid=membership.roleid
          JOIN pg_roles member_role ON member_role.oid=membership.member
          WHERE granted_role.rolname='malign_migration_owner' AND member_role.rolname<>session_user
        LOOP
          EXECUTE format('REVOKE malign_migration_owner FROM %I', member_name);
        END LOOP;
        EXECUTE format('GRANT malign_migration_owner TO %I', session_user);
        EXECUTE format('GRANT CONNECT,CREATE ON DATABASE %I TO malign_migration_owner', current_database());
        EXECUTE format('REVOKE CREATE,TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
      END
      $body$;
    `);
    const identity = await client.query<{ session_user: string; current_user: string }>(
      'SELECT session_user,current_user',
    );
    const row = identity.rows[0];
    if (!row) throw new PersistenceError('DATABASE_UNAVAILABLE', 'Administrative bootstrap identity unavailable');
    return {
      sessionUser: row.session_user,
      currentUser: row.current_user,
      migrationOwner: 'malign_migration_owner',
      applicationRuntime: 'malign_app_runtime',
      outboxPublisher: 'malign_outbox_publisher',
    };
  } finally {
    client.release();
  }
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
  const audit: MigrationExecutionAudit[] = [];
  try {
    await bootstrapPostgresClusterRoles(pool);
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE malign_migration_owner');
    await ensureLedger(client);
    await client.query('COMMIT');
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
        const executionMode = migration.version === 3
          ? 'ADMIN_BOOTSTRAP_EXCEPTION' as const
          : 'MIGRATION_ROLE' as const;
        if (executionMode === 'MIGRATION_ROLE') {
          await client.query('SET LOCAL ROLE malign_migration_owner');
        }
        const identity = await client.query<{ session_user: string; current_user: string }>(
          'SELECT session_user,current_user',
        );
        const identityRow = identity.rows[0];
        if (!identityRow) throw new Error('Migration execution identity unavailable');
        if (
          (executionMode === 'MIGRATION_ROLE' && identityRow.current_user !== 'malign_migration_owner') ||
          (executionMode === 'ADMIN_BOOTSTRAP_EXCEPTION' && identityRow.current_user !== identityRow.session_user)
        ) {
          throw new PersistenceError('MIGRATION_AUTHORITY_INVALID', 'Migration ran under an unexpected authority');
        }
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
        audit.push({
          version: migration.version,
          executionMode,
          sessionUser: identityRow.session_user,
          currentUser: identityRow.current_user,
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    latestMigrationAudit = audit;
    return applied;
  } finally {
    client.release();
  }
};

export interface PhysicalCatalog {
  readonly schema: Readonly<Record<string, unknown>>;
  readonly tables: readonly Readonly<Record<string, unknown>>[];
  readonly columns: readonly Readonly<Record<string, unknown>>[];
  readonly constraints: readonly Readonly<Record<string, unknown>>[];
  readonly indexes: readonly Readonly<Record<string, unknown>>[];
  readonly triggers: readonly Readonly<Record<string, unknown>>[];
  readonly functions: readonly Readonly<Record<string, unknown>>[];
  readonly domains: readonly Readonly<Record<string, unknown>>[];
}

export const readPhysicalCatalog = async (pool: Pool): Promise<PhysicalCatalog> => {
  const catalogQuery=(sql:string)=>pool.query<Readonly<Record<string,unknown>>>(sql);
  const [schema, tables, columns, constraints, indexes, triggers, functions, domains] = await Promise.all([
    catalogQuery(`SELECT n.nspname name,pg_get_userbyid(n.nspowner) owner,COALESCE(n.nspacl::text,'') acl
                  FROM pg_namespace n WHERE n.nspname='malign'`),
    catalogQuery(`SELECT c.relname name,c.relkind kind,pg_get_userbyid(c.relowner) owner,
                       c.relrowsecurity row_security,c.relforcerowsecurity force_row_security,COALESCE(c.relacl::text,'') acl
                  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                 WHERE n.nspname='malign' AND c.relkind='r' ORDER BY c.relname`),
    catalogQuery(`SELECT c.relname table_name,a.attnum ordinal,a.attname column_name,
                       format_type(a.atttypid,a.atttypmod) data_type,a.attnotnull not_null,
                       COALESCE(pg_get_expr(d.adbin,d.adrelid),'') default_expression
                  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
                  JOIN pg_namespace n ON n.oid=c.relnamespace
                  LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
                 WHERE n.nspname='malign' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped
                 ORDER BY c.relname,a.attnum`),
    catalogQuery(`SELECT c.relname table_name,k.conname name,k.contype type,
                       k.condeferrable deferrable,k.condeferred initially_deferred,
                       pg_get_constraintdef(k.oid,true) definition
                  FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
                  JOIN pg_namespace n ON n.oid=c.relnamespace
                 WHERE n.nspname='malign' ORDER BY c.relname,k.conname`),
    catalogQuery(`SELECT t.relname table_name,i.relname name,pg_get_indexdef(i.oid) definition,
                       COALESCE(pg_get_expr(x.indpred,x.indrelid),'') predicate
                  FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class t ON t.oid=x.indrelid
                  JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='malign'
                 ORDER BY t.relname,i.relname`),
    catalogQuery(`SELECT c.relname table_name,t.tgname name,pg_get_triggerdef(t.oid,true) definition
                  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
                 WHERE n.nspname='malign' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`),
    catalogQuery(`SELECT p.proname name,pg_get_function_identity_arguments(p.oid) arguments,
                       pg_get_userbyid(p.proowner) owner,p.provolatile volatility,
                       pg_get_functiondef(p.oid) definition,COALESCE(p.proacl::text,'') acl
                  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='malign' ORDER BY p.proname,arguments`),
    catalogQuery(`SELECT t.typname name,format_type(t.typbasetype,t.typtypmod) base_type,t.typnotnull not_null,
                       COALESCE(pg_get_expr(t.typdefaultbin,0),'') default_expression
                  FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
                 WHERE n.nspname='malign' AND t.typtype='d' ORDER BY t.typname`),
  ]);
  const normalizedTables=tables.rows.map((row:Readonly<Record<string,unknown>>)=>{
    const owner=typeof row['owner']==='string'?row['owner']:'';
    const acl=typeof row['acl']==='string'?row['acl']:'';
    return acl===`{${owner}=arwdDxtm/${owner}}`?{...row,acl:''}:row;
  });
  return {
    schema: schema.rows[0] ?? {},
    tables: normalizedTables,
    columns: columns.rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
    triggers: triggers.rows,
    functions: functions.rows,
    domains: domains.rows,
  };
};

export const physicalCatalogSha256 = (catalog: PhysicalCatalog): string =>
  sha256(JSON.stringify(catalog));

export const validateProductSchema = async (pool: Pool): Promise<void> => {
  const manifest = await loadProductTableManifest();
  if (
    manifest.formatVersion !== 2 ||
    manifest.decision !== 'DEC-078/DEC-079' ||
    manifest.catalogCoverage.length < 8 ||
    manifest.requiredInvariants.length < 12
  ) {
    throw new PersistenceError('SCHEMA_MANIFEST_MISMATCH', 'Physical catalog manifest is incomplete');
  }
  const catalog = await readPhysicalCatalog(pool);
  const actual = catalog.tables.map((row) => String(row['name'])).sort();
  const expected = [...manifest.tables].sort();
  const digest = physicalCatalogSha256(catalog);
  if (
    actual.length !== manifest.productTableCount ||
    JSON.stringify(actual) !== JSON.stringify(expected) ||
    digest !== manifest.catalogSha256
  ) {
    throw new PersistenceError('SCHEMA_MANIFEST_MISMATCH', 'Product schema differs from the approved 87-table manifest', {
      expected: manifest.productTableCount,
      actual: actual.length,
      expectedCatalog: manifest.catalogSha256,
      actualCatalog: digest,
    });
  }
};
