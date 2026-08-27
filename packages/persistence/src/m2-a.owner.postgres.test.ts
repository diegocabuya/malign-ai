import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  APPROVED_REGISTRY_JCS_SHA256,
  DeduplicatingTestConsumer,
  M2A_QUERY_BUDGETS,
  M2A_WRITE_BOUNDARIES,
  PostgresDurableUnitOfWork,
  PostgresOutboxPublisher,
  TransactionalSequence,
  captureCriticalExplainPlans,
  configForDatabase,
  createDisposableDatabase,
  createDurableGameFixture,
  createPostgresPool,
  dropDisposableDatabase,
  loadApprovedRegistrySnapshot,
  materializeRegistryForGame,
  migratePostgres,
  postgresConfigFromEnvironment,
  recordFacilitatorOverride,
  reconcileDurableGame,
  recoverDurableGame,
  seedApprovedRegistry,
  validateMigrationManifest,
  validateProductSchema,
  type DurableCommand,
  type DurableGameFixture,
} from './index.js';

const adminConfig = postgresConfigFromEnvironment();
const databaseName = `malign_m2a_owner_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
const databaseConfig = configForDatabase(adminConfig, databaseName);
const adminPool = createPostgresPool(adminConfig);
const pool = createPostgresPool(databaseConfig);

const fingerprint = (value: string): string => createHash('sha256').update(value).digest('hex');

const makeCommand = (
  fixture: DurableGameFixture,
  key: string,
  overrides: Partial<DurableCommand> = {},
): DurableCommand => ({
  gameId: fixture.gameId,
  actorId: fixture.actorParticipantId,
  commandId: randomUUID(),
  idempotencyKey: key,
  fingerprintSha256: fingerprint(key),
  expectedGameVersion: 0,
  commandType: 'M2A_DURABLE_COMMAND',
  resultState: { phase: 'RESOLUTION_STAGE', durableKey: key, rngCursor: 1, clockCursor: 1 },
  turnId: fixture.turnId,
  pdStateId: fixture.pdStateId,
  actionResolutionId: fixture.actionResolutionId,
  ...overrides,
});

const artifactCounts = async (gameId: string): Promise<Readonly<Record<string, number>>> => {
  const result = await pool.query<Record<string, string>>(
    `SELECT
       (SELECT game_version FROM malign.games WHERE id=$1)::text game_version,
       (SELECT count(*) FROM malign.game_events WHERE game_id=$1)::text events,
       (SELECT count(*) FROM malign.action_point_transactions WHERE game_id=$1)::text ap,
       (SELECT count(*) FROM malign.resource_transactions WHERE game_id=$1)::text resources,
       (SELECT count(*) FROM malign.vp_transactions WHERE game_id=$1)::text vp,
       (SELECT count(*) FROM malign.influence_mutations WHERE game_id=$1)::text influence,
       (SELECT count(*) FROM malign.legitimacy_events WHERE game_id=$1)::text legitimacy,
       (SELECT count(*) FROM malign.die_rolls WHERE game_id=$1)::text rng,
       (SELECT count(*) FROM malign.adjudication_traces WHERE game_id=$1)::text traces,
       (SELECT count(*) FROM malign.pending_resolutions WHERE game_id=$1)::text continuations,
       (SELECT count(*) FROM malign.game_snapshots WHERE game_id=$1)::text snapshots,
       (SELECT count(*) FROM malign.idempotency_records WHERE game_id=$1)::text idempotency,
       (SELECT count(*) FROM malign.outbox_messages WHERE game_id=$1)::text outbox`,
    [gameId],
  );
  return Object.fromEntries(Object.entries(result.rows[0] ?? {}).map(([key, value]) => [key, Number(value)]));
};

beforeAll(async () => {
  const version = await adminPool.query<{ server_version: string }>('SHOW server_version');
  expect(version.rows[0]?.server_version).toBe('18.6');
  await createDisposableDatabase(adminPool, databaseName);
  await migratePostgres(pool, { applicationBuild: 'm2-a-owner-gate' });
}, 120_000);

afterAll(async () => {
  await pool.end();
  await dropDisposableDatabase(adminPool, databaseName);
  await adminPool.end();
});

describe('M2-A PostgreSQL 18.6 owner gate', () => {
  it('GE-M2-DB-001 — physical schema matches the approved manifest', async () => {
    await expect(validateMigrationManifest()).resolves.toHaveLength(4);
    await expect(validateProductSchema(pool)).resolves.toBeUndefined();
    const tables = await pool.query<{ count: string }>(
      `SELECT count(*)::text count FROM information_schema.tables
        WHERE table_schema='malign' AND table_type='BASE TABLE'`,
    );
    expect(Number(tables.rows[0]?.count)).toBe(87);
    const ledger = await pool.query<{ count: string }>(
      `SELECT count(*)::text count FROM information_schema.tables WHERE table_schema='malign_meta'`,
    );
    expect(Number(ledger.rows[0]?.count)).toBe(1);
    const uuidRows = await pool.query<{ first_id: string; second_id: string; version: number }>(
      `WITH first AS (SELECT uuidv7() first_id), pause AS (SELECT pg_sleep(0.002)),
            second AS (SELECT uuidv7() second_id FROM pause)
       SELECT first_id::text,second_id::text,uuid_extract_version(first_id)::int version FROM first,second`,
    );
    expect(uuidRows.rows[0]?.version).toBe(7);
    expect((uuidRows.rows[0]?.second_id ?? '') > (uuidRows.rows[0]?.first_id ?? '')).toBe(true);
    const privileges = await pool.query<{
      public_schema: boolean;
      app_ddl: boolean;
      publisher_game_update: boolean;
      publisher_outbox_update: boolean;
      games_owner: string;
      app_delete: boolean;
      rls_tables: string;
      app_is_migration_member: boolean;
    }>(
      `SELECT
         has_schema_privilege('public','malign','USAGE') public_schema,
         has_schema_privilege('malign_app_runtime','malign','CREATE') app_ddl,
         has_table_privilege('malign_outbox_publisher','malign.games','UPDATE') publisher_game_update,
         has_column_privilege('malign_outbox_publisher','malign.outbox_delivery_states','delivery_status','UPDATE') publisher_outbox_update,
         pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='malign.games'::regclass)) games_owner,
         has_table_privilege('malign_app_runtime','malign.games','DELETE') app_delete,
         (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='malign' AND c.relrowsecurity)::text rls_tables,
         pg_has_role('malign_app_runtime','malign_migration_owner','MEMBER') app_is_migration_member`,
    );
    expect(privileges.rows[0]).toEqual({
      public_schema: false,
      app_ddl: false,
      publisher_game_update: false,
      publisher_outbox_update: true,
      games_owner: 'malign_migration_owner',
      app_delete: false,
      rls_tables: '0',
      app_is_migration_member: false,
    });
  });

  it('GE-M2-DB-002 — bootstrap and migration ledger are repeatable', async () => {
    const schemaBefore = await pool.query<{ digest: string }>(
      `SELECT md5(string_agg(table_name||':'||column_name||':'||data_type,',' ORDER BY table_name,ordinal_position)) digest
         FROM information_schema.columns WHERE table_schema='malign'`,
    );
    await expect(migratePostgres(pool)).resolves.toEqual([]);
    const schemaAfter = await pool.query<{ digest: string }>(
      `SELECT md5(string_agg(table_name||':'||column_name||':'||data_type,',' ORDER BY table_name,ordinal_position)) digest
         FROM information_schema.columns WHERE table_schema='malign'`,
    );
    expect(schemaAfter.rows[0]?.digest).toBe(schemaBefore.rows[0]?.digest);
    const ledgers = await pool.query<{ technical: string; product: string }>(
      `SELECT (SELECT count(*) FROM malign_meta.schema_migrations)::text technical,
              (SELECT count(*) FROM malign.schema_migrations)::text product`,
    );
    expect(ledgers.rows[0]).toEqual({ technical: '4', product: '4' });
  });

  it('GE-M2-DB-003 — N-1 upgrade preserves active and historical rows', async () => {
    const n1Name = `malign_m2a_n1_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    await createDisposableDatabase(adminPool, n1Name);
    const n1Config = configForDatabase(adminConfig, n1Name);
    const n1Pool = createPostgresPool(n1Config);
    try {
      await migratePostgres(n1Pool, { targetVersion: 3 });
      const fixture = await createDurableGameFixture(n1Pool, 'N-1 preserved game');
      const completedFixture = await createDurableGameFixture(n1Pool, 'N-1 completed game');
      await n1Pool.query("UPDATE malign.games SET status='COMPLETED',ended_at=clock_timestamp() WHERE id=$1", [completedFixture.gameId]);
      const before = await n1Pool.query<{ game_id: string; definitions: string; registry_hash: string }>(
        `SELECT $1::text game_id,
                (SELECT count(*) FROM malign.card_definitions)::text definitions,
                encode((SELECT jcs_sha256 FROM malign.card_registry_versions WHERE id=g.card_registry_version_id),'hex') registry_hash
           FROM malign.games g WHERE id=$1::uuid`,
        [fixture.gameId],
      );
      await migratePostgres(n1Pool);
      const after = await n1Pool.query<{ game_id: string; definitions: string; registry_hash: string; recovery_blocked: boolean }>(
        `SELECT g.id::text game_id,
                (SELECT count(*) FROM malign.card_definitions)::text definitions,
                encode(r.jcs_sha256,'hex') registry_hash,g.recovery_blocked
           FROM malign.games g JOIN malign.card_registry_versions r ON r.id=g.card_registry_version_id WHERE g.id=$1`,
        [fixture.gameId],
      );
      expect(after.rows[0]).toMatchObject({ ...before.rows[0], recovery_blocked: false });
      const statuses = await n1Pool.query<{ status: string }>(
        `SELECT status FROM malign.games WHERE id IN ($1,$2) ORDER BY status`,
        [fixture.gameId, completedFixture.gameId],
      );
      expect(statuses.rows.map((row) => row.status)).toEqual(['ACTIVE', 'COMPLETED']);
    } finally {
      await n1Pool.end();
      await dropDisposableDatabase(adminPool, n1Name);
    }
  }, 120_000);

  it('GE-M2-DB-004 — physical constraints reject invalid writes atomically', async () => {
    const fixture = await createDurableGameFixture(pool, 'Constraint fixture');
    const before = await artifactCounts(fixture.gameId);
    await expect(
      pool.query(
        `UPDATE malign.action_point_balances SET remaining=-1
          WHERE game_id=$1 AND participant_id=$2`,
        [fixture.gameId, fixture.actorParticipantId],
      ),
    ).rejects.toBeDefined();
    expect(await artifactCounts(fixture.gameId)).toEqual(before);
    const constraints = await pool.query<{ count: string }>(
      `SELECT count(*)::text count FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
        WHERE n.nspname='malign' AND c.contype IN ('p','f','u','c')`,
    );
    expect(Number(constraints.rows[0]?.count)).toBeGreaterThan(150);
  });

  it('GE-M2-DB-005 — approved registry seed and 540-card materialization are idempotent', async () => {
    const snapshot = await loadApprovedRegistrySnapshot();
    const seeded = await seedApprovedRegistry(pool);
    const fixture = await createDurableGameFixture(pool, 'Materialization fixture');
    expect(await materializeRegistryForGame(pool, fixture.gameId, fixture.controllersByCountry)).toEqual({ cards: 540, starters: 25 });
    expect(await materializeRegistryForGame(pool, fixture.gameId, fixture.controllersByCountry)).toEqual({ cards: 540, starters: 25 });
    expect(seeded).toMatchObject({ definitions: 100, templates: 108, aliases: 4, effects: 59, operations: 103 });
    expect(snapshot.materialization.card_instances_per_base_game).toBe(540);
    const perCountry = await pool.query<{ logical_id: string; cards: string; starters: string }>(
      `SELECT c.logical_id,count(*)::text cards,count(*) FILTER (WHERE t.starter)::text starters
         FROM malign.card_instances i
         JOIN malign.country_definitions c ON c.id=i.country_owner_definition_id
         JOIN malign.country_card_serial_templates t ON t.id=i.serial_template_id
        WHERE i.game_id=$1 GROUP BY c.logical_id ORDER BY c.logical_id`,
      [fixture.gameId],
    );
    expect(perCountry.rows).toHaveLength(5);
    expect(perCountry.rows.every((row) => row.cards === '108' && row.starters === '5')).toBe(true);
    const hash = await pool.query<{ hash: string }>(
      `SELECT encode(jcs_sha256,'hex') hash FROM malign.card_registry_versions WHERE id=$1`,
      [fixture.registryVersionId],
    );
    expect(hash.rows[0]?.hash).toBe(APPROVED_REGISTRY_JCS_SHA256);
  }, 120_000);

  it('GE-M2-DB-006 — game registry pins are immutable when a future version is published', async () => {
    const fixture = await createDurableGameFixture(pool, 'Pin fixture');
    const r2 = await pool.query<{ id: string }>(
      `INSERT INTO malign.card_registry_versions(
         logical_id,version,status,jcs_sha256,snapshot_blob_sha1,approved_decision_id,activated_at
       ) VALUES ('MALIGN_CARD_REGISTRY','FUTURE_TEST','ACTIVE',decode(repeat('11',32),'hex'),decode(repeat('22',20),'hex'),'TEST_ONLY',clock_timestamp()) RETURNING id`,
    );
    await expect(
      pool.query('UPDATE malign.games SET card_registry_version_id=$2 WHERE id=$1', [fixture.gameId, r2.rows[0]?.id]),
    ).rejects.toBeDefined();
    const pin = await pool.query<{ card_registry_version_id: string }>('SELECT card_registry_version_id FROM malign.games WHERE id=$1', [fixture.gameId]);
    expect(pin.rows[0]?.card_registry_version_id).toBe(fixture.registryVersionId);
    const futureGame = await pool.query<{ card_registry_version_id: string }>(
      `INSERT INTO malign.games(
         name,status,ruleset_version_id,scenario_definition_id,card_registry_version_id,
         engine_contract_version_id,ert_definition_id,dice_mode
       ) SELECT 'Future pin fixture','SETUP',ruleset_version_id,scenario_definition_id,$2,
                engine_contract_version_id,ert_definition_id,dice_mode
           FROM malign.games WHERE id=$1 RETURNING card_registry_version_id`,
      [fixture.gameId, r2.rows[0]?.id],
    );
    expect(futureGame.rows[0]?.card_registry_version_id).toBe(r2.rows[0]?.id);
  });

  it('GE-M2-DB-007 — PostgreSQL 18.6 backup/restore preserves manifest and registry pins', async () => {
    const pgBin = process.env['MALIGN_PG_BIN'];
    if (!pgBin) throw new Error('MALIGN_PG_BIN is required for the PostgreSQL 18.6 backup/restore owner gate');
    const restoreName = `malign_m2a_restore_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const backupDirectory = mkdtempSync(join(tmpdir(), 'malign-m2a-backup-'));
    const archive = join(backupDirectory, 'owner-gate.dump');
    const host = process.env['PGHOST'] ?? '127.0.0.1';
    const port = process.env['PGPORT'] ?? '5432';
    const user = process.env['PGUSER'] ?? process.env['USER'] ?? '';
    const fixture = await createDurableGameFixture(pool, 'Backup fixture');
    await new PostgresDurableUnitOfWork(pool).execute(
      makeCommand(fixture, 'backup-artifacts', { persistContinuation: true }),
    );
    try {
      execFileSync(join(pgBin, 'pg_dump'), ['-Fc', '-h', host, '-p', port, '-U', user, '-f', archive, databaseName]);
      await createDisposableDatabase(adminPool, restoreName);
      execFileSync(join(pgBin, 'pg_restore'), ['--exit-on-error', '-h', host, '-p', port, '-U', user, '-d', restoreName, archive]);
      const restorePool = createPostgresPool(configForDatabase(adminConfig, restoreName));
      try {
        await validateProductSchema(restorePool);
        const restored = await restorePool.query<{ hash: string; game_count: string }>(
          `SELECT encode(r.jcs_sha256,'hex') hash,(SELECT count(*) FROM malign.games)::text game_count
             FROM malign.games g JOIN malign.card_registry_versions r ON r.id=g.card_registry_version_id
            WHERE g.id=$1`,
          [fixture.gameId],
        );
        expect(restored.rows[0]?.hash).toBe(APPROVED_REGISTRY_JCS_SHA256);
        expect(Number(restored.rows[0]?.game_count)).toBeGreaterThan(0);
        const restoredOwner = await restorePool.query<{ owner: string }>(
          `SELECT pg_get_userbyid(relowner) owner FROM pg_class WHERE oid='malign.games'::regclass`,
        );
        expect(restoredOwner.rows[0]?.owner).toBe('malign_migration_owner');
        await expect(reconcileDurableGame(restorePool, fixture.gameId)).resolves.toBeUndefined();
        const recovered = await recoverDurableGame(restorePool, fixture.gameId);
        expect(recovered).toMatchObject({ gameId: fixture.gameId, gameVersion: 1, snapshotVersion: 1 });
        const registryCount = await restorePool.query<{ count: string }>('SELECT count(*)::text count FROM malign.card_definitions');
        await expect(
          restorePool.query(
            `INSERT INTO malign.card_definitions(
               logical_id,registry_version_id,canonical_name,category,action_point_cost,resource_cost,status,source_reference
             ) VALUES ('BROKEN_SEED',(SELECT id FROM malign.card_registry_versions LIMIT 1),'Broken','STARTER',-1,0,'ACTIVE','fault')`,
          ),
        ).rejects.toBeDefined();
        const registryAfterFailure = await restorePool.query<{ count: string }>('SELECT count(*)::text count FROM malign.card_definitions');
        expect(registryAfterFailure.rows[0]?.count).toBe(registryCount.rows[0]?.count);
        await expect(
          restorePool.query(`BEGIN; CREATE TABLE malign.m2a_failed_migration(id int); SELECT 1/0; COMMIT;`),
        ).rejects.toBeDefined();
        await restorePool.query('ROLLBACK');
        const partial = await restorePool.query<{ found: boolean }>(
          `SELECT to_regclass('malign.m2a_failed_migration') IS NOT NULL found`,
        );
        expect(partial.rows[0]?.found).toBe(false);
      } finally {
        await restorePool.end();
      }
    } finally {
      const exists = await adminPool.query<{ exists: boolean }>('SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname=$1) exists', [restoreName]);
      if (exists.rows[0]?.exists) await dropDisposableDatabase(adminPool, restoreName);
      rmSync(backupDirectory, { recursive: true, force: true });
    }
  }, 120_000);

  it('GE-E2E-006 — durable counters impose no physical component caps', async () => {
    const fixture = await createDurableGameFixture(pool, 'No component caps');
    await pool.query('UPDATE malign.influence_stacks SET count=41 WHERE game_id=$1', [fixture.gameId]);
    await pool.query('UPDATE malign.game_countries SET current_vp_cache=101 WHERE game_id=$1', [fixture.gameId]);
    const state = await pool.query<{ cubes: number; vp: number }>(
      `SELECT (SELECT max(count) FROM malign.influence_stacks WHERE game_id=$1)::int cubes,
              (SELECT max(current_vp_cache) FROM malign.game_countries WHERE game_id=$1)::int vp`,
      [fixture.gameId],
    );
    expect(state.rows[0]).toEqual({ cubes: 41, vp: 101 });
  });

  it('GE-CORE-011 — an unknown target is rejected without partial mutation', async () => {
    const fixture = await createDurableGameFixture(pool, 'Unknown target');
    await pool.query("UPDATE malign.game_participants SET role='FACILITATOR' WHERE id=$1", [fixture.actorParticipantId]);
    const before = await artifactCounts(fixture.gameId);
    await expect(
      recordFacilitatorOverride(pool, {
        gameId: fixture.gameId,
        facilitatorParticipantId: fixture.actorParticipantId,
        targetCardInstanceId: randomUUID(),
        reason: 'Target disappeared before resolution',
        noncanonical: true,
      }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_TARGET' });
    expect(await artifactCounts(fixture.gameId)).toEqual(before);
  });

  it('GE-AUD-002 — resource journal reconciles the cached balance', async () => {
    const fixture = await createDurableGameFixture(pool, 'Resource audit');
    await new PostgresDurableUnitOfWork(pool).execute(makeCommand(fixture, 'resource-audit'));
    await expect(reconcileDurableGame(pool, fixture.gameId)).resolves.toBeUndefined();
    const result = await pool.query<{ cache: string; ledger: string }>(
      `SELECT c.current_resources_cache::text cache,
              COALESCE(sum(t.delta),0)::text ledger
         FROM malign.game_countries c LEFT JOIN malign.resource_transactions t
           ON t.game_id=c.game_id AND t.participant_id=c.controlling_participant_id
        WHERE c.game_id=$1 AND c.controlling_participant_id=$2 GROUP BY c.current_resources_cache`,
      [fixture.gameId, fixture.actorParticipantId],
    );
    expect(result.rows[0]?.cache).toBe(result.rows[0]?.ledger);
  });

  it('GE-AUD-003 — VP journal reconciles the cached balance', async () => {
    const fixture = await createDurableGameFixture(pool, 'VP audit');
    await new PostgresDurableUnitOfWork(pool).execute(makeCommand(fixture, 'vp-audit'));
    await expect(reconcileDurableGame(pool, fixture.gameId)).resolves.toBeUndefined();
    const result = await pool.query<{ cache: string; ledger: string }>(
      `SELECT c.current_vp_cache::text cache,COALESCE(sum(t.delta),0)::text ledger
         FROM malign.game_countries c LEFT JOIN malign.vp_transactions t
           ON t.game_id=c.game_id AND t.participant_id=c.controlling_participant_id
        WHERE c.game_id=$1 AND c.controlling_participant_id=$2 GROUP BY c.current_vp_cache`,
      [fixture.gameId, fixture.actorParticipantId],
    );
    expect(result.rows[0]?.cache).toBe(result.rows[0]?.ledger);
  });

  it('GE-AUD-004 — snapshot/event recovery reaches the authoritative state hash', async () => {
    const fixture = await createDurableGameFixture(pool, 'Replay audit');
    const state = { phase: 'RESOLUTION_STAGE', replay: 'stable', rngCursor: 1, clockCursor: 1 };
    await new PostgresDurableUnitOfWork(pool).execute(makeCommand(fixture, 'replay-audit', { resultState: state }));
    const recovered = await recoverDurableGame(pool, fixture.gameId);
    expect(recovered.state).toEqual(state);
    expect(recovered.snapshotVersion).toBe(1);
    expect(recovered.eventTail).toEqual([]);
  });

  it('GE-FAC-002 — facilitator override records reason, refs and noncanonical state', async () => {
    const fixture = await createDurableGameFixture(pool, 'Facilitator override');
    await materializeRegistryForGame(pool, fixture.gameId, fixture.controllersByCountry);
    await pool.query("UPDATE malign.game_participants SET role='FACILITATOR' WHERE id=$1", [fixture.actorParticipantId]);
    const card = await pool.query<{ id: string }>('SELECT id FROM malign.card_instances WHERE game_id=$1 ORDER BY id LIMIT 1', [fixture.gameId]);
    const decisionId = await recordFacilitatorOverride(pool, {
      gameId: fixture.gameId,
      facilitatorParticipantId: fixture.actorParticipantId,
      targetCardInstanceId: card.rows[0]?.id ?? '',
      reason: 'Audited correction outside normal flow',
      noncanonical: true,
    });
    const result = await pool.query<{ noncanonical: boolean; rationale: string; before_snapshot_json: unknown; after_snapshot_json: unknown; event_type: string }>(
      `SELECT g.noncanonical,d.rationale,d.before_snapshot_json,d.after_snapshot_json,e.event_type
         FROM malign.facilitator_decisions d JOIN malign.games g ON g.id=d.game_id
         JOIN malign.game_events e ON e.game_id=d.game_id AND e.subject_id=d.target_entity_id
        WHERE d.id=$1`,
      [decisionId],
    );
    expect(result.rows[0]).toMatchObject({ noncanonical: true, rationale: 'Audited correction outside normal flow', event_type: 'FACILITATOR_OVERRIDE' });
    expect(result.rows[0]?.before_snapshot_json).toBeDefined();
    expect(result.rows[0]?.after_snapshot_json).toBeDefined();
  }, 120_000);

  it('GE-M2-TX-001 — S/E/L/T/O and idempotency commit in one UoW', async () => {
    const fixture = await createDurableGameFixture(pool, 'Atomic UoW');
    const result = await new PostgresDurableUnitOfWork(pool, {
      postCommitObserver: () => {
        throw new Error('observer failure after commit');
      },
    }).execute(makeCommand(fixture, 'atomic-uow', { persistContinuation: true }));
    expect(result).toMatchObject({ gameVersion: 1, eventSequence: 1, outboxSequence: 1, replayed: false });
    expect(await artifactCounts(fixture.gameId)).toEqual({
      game_version: 1,
      events: 1,
      ap: 1,
      resources: 1,
      vp: 1,
      influence: 1,
      legitimacy: 1,
      rng: 1,
      traces: 1,
      continuations: 1,
      snapshots: 1,
      idempotency: 1,
      outbox: 1,
    });
    const plans = await captureCriticalExplainPlans(pool, fixture.gameId);
    expect(Object.keys(plans)).toHaveLength(6);
    expect(M2A_QUERY_BUDGETS.every((budget) => !/\bOFFSET\b/i.test(budget.sql))).toBe(true);
    const indexRows = await pool.query<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE schemaname='malign'`);
    const indexes = new Set(indexRows.rows.map((row) => row.indexname));
    expect(M2A_QUERY_BUDGETS.every((budget) => indexes.has(budget.expectedIndex))).toBe(true);
    await expect(
      pool.query(`UPDATE malign.game_events SET event_type='REWRITTEN' WHERE game_id=$1`, [fixture.gameId]),
    ).rejects.toBeDefined();
  });

  it('GE-M2-TX-002 — every write-boundary fault rolls back all artifacts and provider cursors', async () => {
    const fixture = await createDurableGameFixture(pool, 'Fault matrix');
    const rng = new TransactionalSequence([7]);
    const clock = new TransactionalSequence([new Date('2026-01-01T00:00:00.000Z')]);
    const uow = new PostgresDurableUnitOfWork(pool, { rng, clock });
    const before = await artifactCounts(fixture.gameId);
    for (const boundary of M2A_WRITE_BOUNDARIES) {
      await expect(
        uow.execute(makeCommand(fixture, `fault-${boundary}`, { faultAt: boundary, persistContinuation: true })),
      ).rejects.toMatchObject({ code: 'TRANSACTION_WRITE_FAILED' });
      expect(await artifactCounts(fixture.gameId)).toEqual(before);
      expect(rng.cursor).toBe(0);
      expect(clock.cursor).toBe(0);
    }
  }, 120_000);

  it('GE-M2-TX-003 — two connections produce one CAS winner and a clean loser', async () => {
    const fixture = await createDurableGameFixture(pool, 'CAS concurrency');
    const rngA = new TransactionalSequence([3]);
    const rngB = new TransactionalSequence([8]);
    const clockA = new TransactionalSequence([new Date('2026-01-01T00:00:00Z')]);
    const clockB = new TransactionalSequence([new Date('2026-01-01T00:00:01Z')]);
    const a = new PostgresDurableUnitOfWork(pool, { rng: rngA, clock: clockA });
    const b = new PostgresDurableUnitOfWork(pool, { rng: rngB, clock: clockB });
    const outcomes = await Promise.allSettled([
      a.execute(makeCommand(fixture, 'cas-a', { resultState: { winner: 'A' } })),
      b.execute(makeCommand(fixture, 'cas-b', { resultState: { winner: 'B' } })),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(rejected && rejected.status === 'rejected' ? rejected.reason : undefined).toMatchObject({ code: 'GAME_VERSION_CONFLICT' });
    expect(await artifactCounts(fixture.gameId)).toMatchObject({ game_version: 1, events: 1, idempotency: 1, outbox: 1 });
    expect([rngA.cursor, rngB.cursor].sort()).toEqual([0, 1]);
    expect([clockA.cursor, clockB.cursor].sort()).toEqual([0, 1]);
  });

  it('GE-M2-TX-004 — same key/fingerprint retry from a new adapter returns the durable result', async () => {
    const fixture = await createDurableGameFixture(pool, 'Durable idempotency');
    const command = makeCommand(fixture, 'retry-after-restart');
    const [original, concurrent] = await Promise.all([
      new PostgresDurableUnitOfWork(pool).execute(command),
      new PostgresDurableUnitOfWork(pool).execute(command),
    ]);
    expect(concurrent).toEqual(original);
    const secondPool = createPostgresPool(databaseConfig);
    try {
      const retried = await new PostgresDurableUnitOfWork(secondPool).execute(command);
      expect(retried).toEqual(original);
      expect(await artifactCounts(fixture.gameId)).toMatchObject({ game_version: 1, events: 1, idempotency: 1, outbox: 1 });
    } finally {
      await secondPool.end();
    }
  });

  it('GE-M2-TX-005 — same key with a different fingerprint fails without leakage or mutation', async () => {
    const fixture = await createDurableGameFixture(pool, 'Fingerprint conflict');
    const original = makeCommand(fixture, 'fingerprint-key');
    const different = {
      ...original,
      commandId: randomUUID(),
      fingerprintSha256: fingerprint('different'),
      resultState: { winner: 'different-fingerprint' },
    };
    const outcomes = await Promise.allSettled([
      new PostgresDurableUnitOfWork(pool).execute(original),
      new PostgresDurableUnitOfWork(pool).execute(different),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const conflict = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(conflict && conflict.status === 'rejected' ? conflict.reason : undefined).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(await artifactCounts(fixture.gameId)).toMatchObject({ game_version: 1, events: 1, idempotency: 1, outbox: 1 });
  });

  it('GE-M2-TX-006 — outbox is visible only after gameplay commit', async () => {
    const fixture = await createDurableGameFixture(pool, 'Outbox visibility');
    await expect(
      new PostgresDurableUnitOfWork(pool).execute(makeCommand(fixture, 'rollback-outbox', { faultAt: 'delivery_state' })),
    ).rejects.toMatchObject({ code: 'TRANSACTION_WRITE_FAILED' });
    expect((await artifactCounts(fixture.gameId)).outbox).toBe(0);
    await new PostgresDurableUnitOfWork(pool).execute(makeCommand(fixture, 'commit-outbox'));
    const claimed = await new PostgresOutboxPublisher(pool).claimOne(30_000, fixture.gameId);
    expect(claimed).toMatchObject({ gameId: fixture.gameId, outboxSequence: 1 });
  });

  it('GE-M2-TX-007 — publisher crashes converge at-least-once through durable attempts and dedup', async () => {
    const fixture = await createDurableGameFixture(pool, 'Publisher recovery');
    await new PostgresDurableUnitOfWork(pool).execute(makeCommand(fixture, 'publisher-recovery'));
    const publisher = new PostgresOutboxPublisher(pool);
    const consumer = new DeduplicatingTestConsumer();
    const first = await publisher.claimOne(30_000, fixture.gameId);
    if (!first) throw new Error('Expected an outbox claim');
    expect(consumer.consume(first)).toBe(true);
    await expect(publisher.deliver(first, () => Promise.reject(new Error('crash before send returned')))).rejects.toThrow(
      'Outbox send failed',
    );
    const afterFailure = await publisher.claimOne(30_000, fixture.gameId);
    if (!afterFailure) throw new Error('Expected a post-failure retry claim');
    expect(consumer.consume(afterFailure)).toBe(false);
    await publisher.deliver(afterFailure, () => Promise.resolve('transport-1'));
    await pool.query(
      `UPDATE malign.outbox_delivery_states SET claim_expires_at=clock_timestamp()-interval '1 second'
        WHERE outbox_message_id=$1`,
      [afterFailure.id],
    );
    expect(await publisher.recoverExpiredLeases()).toBe(1);
    const retry = await publisher.claimOne(30_000, fixture.gameId);
    if (!retry) throw new Error('Expected a retry claim');
    expect(consumer.consume(retry)).toBe(false);
    await publisher.deliver(retry, () => Promise.resolve('transport-2'));
    await publisher.acknowledge(retry);
    const delivery = await pool.query<{ delivery_status: string; attempts: string }>(
      `SELECT s.delivery_status,(SELECT count(*) FROM malign.outbox_delivery_attempts a WHERE a.outbox_message_id=s.outbox_message_id)::text attempts
         FROM malign.outbox_delivery_states s WHERE s.outbox_message_id=$1`,
      [retry.id],
    );
    expect(delivery.rows[0]?.delivery_status).toBe('ACKNOWLEDGED');
    expect(Number(delivery.rows[0]?.attempts)).toBeGreaterThanOrEqual(13);
    expect(await artifactCounts(fixture.gameId)).toMatchObject({ game_version: 1, events: 1, outbox: 1 });
  });

  it('GE-M2-TX-008 — a new adapter recovers canonical state and versioned continuation without providers', async () => {
    const fixture = await createDurableGameFixture(pool, 'Recovery boundary');
    const command = makeCommand(fixture, 'continuation-recovery', { persistContinuation: true });
    await new PostgresDurableUnitOfWork(pool).execute(command);
    const secondPool = createPostgresPool(databaseConfig);
    try {
      const recovered = await recoverDurableGame(secondPool, fixture.gameId);
      expect(recovered.state).toEqual(command.resultState);
      expect(recovered.continuation).toEqual({ commandId: command.commandId });
      expect(recovered.pins.registry).toBe(fixture.registryVersionId);
    } finally {
      await secondPool.end();
    }
  });

  it('GE-M2-TX-009 — reconciliation mismatch fails closed and blocks advancement', async () => {
    const mismatchInjectors: readonly ((fixture: DurableGameFixture) => Promise<unknown>)[] = [
      (fixture) => pool.query(`UPDATE malign.games SET authoritative_state_json='{"tampered":true}'::jsonb WHERE id=$1`, [fixture.gameId]),
      (fixture) => pool.query(`UPDATE malign.games SET event_sequence_head=event_sequence_head+1 WHERE id=$1`, [fixture.gameId]),
      (fixture) => pool.query(
        `UPDATE malign.action_point_balances SET spent=spent+1,remaining=remaining-1
          WHERE game_id=$1 AND participant_id=$2`,
        [fixture.gameId, fixture.actorParticipantId],
      ),
      (fixture) => pool.query(
        `INSERT INTO malign.adjudication_traces(
           game_id,game_event_sequence,artifact_ordinal,turn_id,participant_id,trace_type,
           pre_state_hash,post_state_hash,input_snapshot_json,rule_evaluation_json,output_snapshot_json,
           trace_schema_id,trace_schema_version,correlation_id
         ) VALUES ($1,99,1,$2,$3,'ORPHAN',decode(repeat('00',32),'hex'),decode(repeat('00',32),'hex'),
                   '{}','{}','{}','malign.adjudication-trace','0.1',uuidv7())`,
        [fixture.gameId, fixture.turnId, fixture.actorParticipantId],
      ),
      (fixture) => pool.query(
        `DELETE FROM malign.outbox_delivery_states
          WHERE outbox_message_id IN (SELECT id FROM malign.outbox_messages WHERE game_id=$1)`,
        [fixture.gameId],
      ),
    ];
    for (const [index, injectMismatch] of mismatchInjectors.entries()) {
      const fixture = await createDurableGameFixture(pool, `Reconciliation mismatch ${index + 1}`);
      await new PostgresDurableUnitOfWork(pool).execute(makeCommand(fixture, `reconciliation-source-${index + 1}`));
      await injectMismatch(fixture);
      await expect(reconcileDurableGame(pool, fixture.gameId)).rejects.toMatchObject({ code: 'RECONCILIATION_MISMATCH' });
      const blocked = await pool.query<{ recovery_blocked: boolean }>('SELECT recovery_blocked FROM malign.games WHERE id=$1', [fixture.gameId]);
      expect(blocked.rows[0]?.recovery_blocked).toBe(true);
      await expect(
        new PostgresDurableUnitOfWork(pool).execute(
          makeCommand(fixture, `blocked-command-${index + 1}`, { expectedGameVersion: 1 }),
        ),
      ).rejects.toMatchObject({ code: 'GAME_RECOVERY_BLOCKED' });
    }
  });
});
