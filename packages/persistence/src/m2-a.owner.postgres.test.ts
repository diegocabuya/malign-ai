import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  dispatchM2APersistenceFixture,
  type M2APersistenceFixtureCommand,
  type M2APersistenceFixtureOutcome,
  type M2APersistenceFixtureState,
  type SetupCommandPayload,
  type SetupCommandType,
} from '@malign-ai/game-engine';
import {
  M1_0_BASELINE_VERSIONS,
  buildDurableEngineTransition,
  durableTransitionCompletenessFailures,
  type SetupGameState,
  type TransactionalRandomProvider,
} from '@malign-ai/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresGameSessionApplication, type SessionCommandInput } from '../../../apps/server/src/game-session-application.js';
import { InMemorySessionAuthority } from '../../authz/src/index.js';
import { sha256CanonicalJson } from '@malign-ai/shared';
import { PARTICIPANT_FIXTURE, STRATEGY_FIXTURE, trustedBindings } from '../../../tests/m1-0/test-fixtures.js';

import {
  DeduplicatingTestConsumer,
  M2A_QUERY_BUDGETS,
  M2A_WRITE_BOUNDARIES,
  PostgresDurableUnitOfWork,
  PostgresOutboxPublisher,
  TransactionalSequence,
  assertCriticalExplainPlansUseIndexes,
  bootstrapPostgresClusterRoles,
  captureCriticalExplainPlans,
  captureDurableEvidence,
  configForDatabase,
  configForPrincipal,
  createEphemeralLoginPrincipal,
  createDisposableDatabase,
  createDurableGameFixture,
  createM2AQueryMetrics,
  createPostgresPool,
  dropDisposableDatabase,
  dropEphemeralLoginPrincipal,
  executeWithinQueryBudget,
  getLatestMigrationExecutionAudit,
  loadApprovedRegistrySnapshot,
  materializeRegistryForGame,
  migratePostgres,
  physicalCatalogSha256,
  probeConstraintViolation,
  postgresConfigFromEnvironment,
  readPhysicalCatalog,
  reconcileDurableGame,
  recordFacilitatorOverride,
  recoverDurableGame,
  seedApprovedRegistry,
  validateMigrationManifest,
  validateProductSchema,
  type AcceptedEngineResult,
  type DurableEffectBatch,
  type DurableGameFixture,
  type M2AFutureFixtureTransition,
} from './index.js';

const adminConfig=postgresConfigFromEnvironment();
const databaseName=`malign_m2a_owner_${randomUUID().replaceAll('-','').slice(0,16)}`;
const databaseConfig=configForDatabase(adminConfig,databaseName);
const adminPool=createPostgresPool(adminConfig);
const adminDatabasePool=createPostgresPool(databaseConfig);
const principalSuffix=randomUUID().replaceAll('-','').slice(0,10);
const migratorPrincipal=`malign_test_migrator_${principalSuffix}`;
const appPrincipal=`malign_test_app_${principalSuffix}`;
const outboxPrincipal=`malign_test_outbox_${principalSuffix}`;
const pool=createPostgresPool(configForPrincipal(databaseConfig,migratorPrincipal));
const appPool=createPostgresPool(configForPrincipal(databaseConfig,appPrincipal));
const outboxPool=createPostgresPool(configForPrincipal(databaseConfig,outboxPrincipal));
const fixedNow=()=>new Date('2026-01-01T00:00:00.000Z');
const fingerprint=(value:unknown):string=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const minimumRandomFactory = ():TransactionalRandomProvider => ({
  checkpoint:()=>({cursor:0}),restore:()=>undefined,commit:()=>undefined,
  integer:(minimum:number)=>minimum,
});

const scriptedRandomFactory = (script:readonly number[]) => ():TransactionalRandomProvider => {
  let cursor=0;
  return {
    checkpoint:()=>({cursor}),
    restore:checkpoint=>{cursor=checkpoint.cursor;},
    commit:()=>undefined,
    integer:(minimum,maximum)=>{
      const value=script[cursor]??minimum;
      if(!Number.isInteger(value)||value<minimum||value>maximum)throw new Error('Invalid M2A deterministic RNG script');
      cursor+=1;
      return value;
    },
  };
};

const canonicalM1RandomFactory=():TransactionalRandomProvider=>{
  let cursor=0;
  return {
    checkpoint:()=>({cursor}),restore:checkpoint=>{cursor=checkpoint.cursor;},commit:()=>undefined,
    integer:(minimum,maximum)=>{
      if(minimum===0)return maximum;
      const initiative=[10,8,6,4,2,7];
      const value=initiative[cursor]??7;cursor+=1;
      if(value<minimum||value>maximum)throw new Error('Canonical M2A RNG request is outside the script');
      return value;
    },
  };
};

const auditedRandomProvider=(
  select:(minimum:number,maximum:number,callIndex:number)=>number=(minimum)=>minimum,
)=>{
  const audit={cursor:0,checkpoints:0,restores:0,commits:0,calls:[] as {minimum:number;maximum:number}[]};
  const provider:TransactionalRandomProvider={
    checkpoint:()=>{audit.checkpoints+=1;return {cursor:audit.cursor};},
    restore:checkpoint=>{audit.restores+=1;audit.cursor=checkpoint.cursor;},
    commit:()=>{audit.commits+=1;},
    integer:(minimum,maximum)=>{
      const callIndex=audit.cursor;
      audit.cursor+=1;
      audit.calls.push({minimum,maximum});
      return select(minimum,maximum,callIndex);
    },
  };
  return {audit,provider};
};

const createRealM1ApplicationFixture=async(options:{
  readonly randomFactory?:()=>TransactionalRandomProvider;
  readonly stopAt?:'AFTER_START'|'BEFORE_INITIATIVE'|'READY';
}={})=>{
  let gameId=`provisional:${randomUUID()}`;
  const authority=new InMemorySessionAuthority(trustedBindings(gameId));
  const unitOfWork=new PostgresDurableUnitOfWork(appPool);
  const app=new PostgresGameSessionApplication(
    authority,unitOfWork,options.randomFactory??canonicalM1RandomFactory,fixedNow,
  );
  const created=await app.createGame('session-f1',{
    engineContractVersion:M1_0_BASELINE_VERSIONS.engineContractVersion,
    commandId:randomUUID(),idempotencyKey:`m2a-real:CREATE_GAME:${randomUUID()}`,
    expectedGameVersion:0,payloadSchemaVersion:M1_0_BASELINE_VERSIONS.fixtureSchemaVersion,
    payload:{scenarioDefinitionId:'BASE_2025',...M1_0_BASELINE_VERSIONS,turnLimit:10,preferredDiceMode:'DIGITAL'},
  });
  if(created.result.status!=='RESOLVED')throw new Error(`Real PostgreSQL CREATE_GAME failed: ${created.result.resultCode}`);
  gameId=created.gameId;
  let version=created.result.gameVersionAfter;
  const execute=async(sessionId:string,commandType:SetupCommandType,payload:SetupCommandPayload)=>{
    const result=await app.execute(sessionId,{
      engineContractVersion:M1_0_BASELINE_VERSIONS.engineContractVersion,
      commandId:randomUUID(),idempotencyKey:`m2a-real:${commandType}:${randomUUID()}`,gameId,
      expectedGameVersion:version,commandType,
      payloadSchemaVersion:M1_0_BASELINE_VERSIONS.fixtureSchemaVersion,payload,
    });
    if(result.status!=='RESOLVED')throw new Error(`Real PostgreSQL ${commandType} failed: ${result.resultCode}`);
    version=result.gameVersionAfter;
    return result;
  };
  const fixture=()=>({app,authority,unitOfWork,execute,gameId,get version(){return version;}});
  for(const player of PARTICIPANT_FIXTURE.participants.filter(({role})=>role==='PLAYER')) {
    await execute(player.authenticated_session_id,'JOIN_GAME_MEMBERSHIP',{});
  }
  for(const player of PARTICIPANT_FIXTURE.participants.filter(({role})=>role==='PLAYER')) {
    if(player.country_id===undefined||player.seat_index===undefined||player.clockwise_index===undefined)
      throw new Error('Canonical participant fixture is incomplete');
    await execute('session-f1','ASSIGN_PLAYER_SEAT',{
      playerParticipantId:player.participant_id,countryId:player.country_id,
      seatIndex:player.seat_index,clockwiseIndex:player.clockwise_index,
    });
  }
  await execute('session-f1','START_GAME',{});
  if(options.stopAt==='AFTER_START')return fixture();
  for(const player of PARTICIPANT_FIXTURE.participants.filter(({role})=>role==='PLAYER')) {
    if(player.country_id===undefined)throw new Error('Canonical country is missing');
    const canonicalDeck=[...STRATEGY_FIXTURE.operations_decks[player.country_id]];
    const selectedDeck=player.participant_id==='P1'
      ? [`${player.country_id}-CARD-102`,`${player.country_id}-CARD-045`,...canonicalDeck.slice(2)]
      : canonicalDeck;
    await execute(player.authenticated_session_id,'SUBMIT_OPERATIONS_DECK',{
      cardInstanceIds:selectedDeck,
    });
    await execute(player.authenticated_session_id,'LOCK_STRATEGY',{});
  }
  if(options.stopAt==='BEFORE_INITIATIVE')return fixture();
  await execute('session-p1','REQUEST_INITIATIVE_ROLL',{});
  for(const player of PARTICIPANT_FIXTURE.participants.filter(({role})=>role==='PLAYER')) {
    await execute(player.authenticated_session_id,'SET_INITIATIVE_MAINTENANCE',{discardCardInstanceIds:[]});
    await execute(player.authenticated_session_id,'LOCK_INITIATIVE_MAINTENANCE',{});
  }
  return fixture();
};

const persistRealSchedulerStep=async(app:PostgresGameSessionApplication,gameId:string)=>{
  const before=(await recoverDurableGame(appPool,gameId)).state as unknown as SetupGameState;
  const commandId=randomUUID();
  const idempotencyKey=`m2a-real:scheduler:${randomUUID()}`;
  const result=await app.runM1SchedulerNext({gameId,expectedGameVersion:before.version,commandId,idempotencyKey,
    correlationId:`m2a-real-scheduler:${before.version}`});
  if(result.status==='REJECTED')throw new Error(`Real M1 scheduler rejected: ${result.resultCode}`);
  const after=(await recoverDurableGame(appPool,gameId)).state as unknown as SetupGameState;
  return {before,after,result};
};

const realCampaignSlots=(state:SetupGameState)=>{
  const hand=state.strategy.P1?.handCardInstanceIds??[];
  const intentCardInstanceId=hand.find(cardId=>{
    const definitionId=state.cards[cardId]?.definitionId;
    return definitionId!==undefined&&state.adjudication.campaignCardRules[definitionId]?.influenceValueBySlot.INTENT!==undefined;
  });
  const methodCardInstanceId=hand.find(cardId=>{
    const definitionId=state.cards[cardId]?.definitionId;
    return cardId!==intentCardInstanceId&&definitionId!==undefined&&
      state.adjudication.campaignCardRules[definitionId]?.influenceValueBySlot.METHOD!==undefined;
  });
  if(intentCardInstanceId===undefined||methodCardInstanceId===undefined)
    throw new Error('Real PostgreSQL hand lacks a compatible Intent/Method pair');
  return [{sequenceIndex:1,actionType:'CONSTRUCT_CAMPAIGN' as const,actionPayload:{row:'I' as const,
    intentCardInstanceId,methodCardInstanceId,targetDtId:'RACE:BLACK'}},
  {sequenceIndex:2,actionType:'ACTIVATE_CAMPAIGN' as const,actionPayload:{
    campaignId:`${state.id}:campaign:P1:row-i`,requestedTargetPdId:'ARDEN_PD_2',
  }}];
};

const fixtureState=async (targetPool:typeof pool,fixture:DurableGameFixture):Promise<M2APersistenceFixtureState> =>
  (await targetPool.query<{authoritative_state_json:M2APersistenceFixtureState}>(
    'SELECT authoritative_state_json FROM malign.games WHERE id=$1',[fixture.gameId]
  )).rows[0]?.authoritative_state_json as M2APersistenceFixtureState;

const effectsFor = (fixture:DurableGameFixture,outcome:M2APersistenceFixtureOutcome):DurableEffectBatch => {
  const resources: NonNullable<DurableEffectBatch['resources']>[number][]=[];
  const victoryPoints: NonNullable<DurableEffectBatch['victoryPoints']>[number][]=[];
  const influence: NonNullable<DurableEffectBatch['influence']>[number][]=[];
  for (const artifact of outcome.artifacts) {
    if (artifact.delta===undefined || artifact.delta===0) continue;
    if (artifact.family==='RESOURCE') {
      const transferTarget=artifact.reason.startsWith('TRANSFER_IN:')?artifact.reason.slice('TRANSFER_IN:'.length):undefined;
      resources.push({turnId:fixture.turnId,participantId:transferTarget??fixture.actorParticipantId,
        delta:artifact.delta,reasonType:(transferTarget?'TRANSFER_IN':artifact.reason) as 'TURN_INCOME'|'SPEND'|'TRANSFER_IN'|'TRANSFER_OUT'});
    }
    if (artifact.family==='VP') victoryPoints.push({turnId:fixture.turnId,participantId:fixture.actorParticipantId,
      delta:artifact.delta,reasonType:artifact.reason as 'CAMPAIGN'|'LEGITIMACY'|'CORRUPTION'|'OBJECTIVE'});
    if (artifact.family==='INFLUENCE') influence.push({turnId:fixture.turnId,pdStateId:fixture.pdStateId,
      influenceType:'MALIGN',attributionCountryDefinitionId:fixture.countryDefinitionIds['ARDEN']??'',
      delta:artifact.delta,reasonType:artifact.reason});
  }
  return {resources,victoryPoints,influence};
};

const transitionFor = async (
  targetPool:typeof pool,
  fixture:DurableGameFixture,
  command:M2APersistenceFixtureCommand,
  key:string,
  options:Partial<M2AFutureFixtureTransition>={},
):Promise<{transition:M2AFutureFixtureTransition;outcome:M2APersistenceFixtureOutcome}> => {
  const before=await fixtureState(targetPool,fixture);
  const outcome=dispatchM2APersistenceFixture(before,command,fixedNow);
  if (outcome.result.status!=='RESOLVED') throw new Error(`Fixture command rejected: ${outcome.result.resultCode}`);
  return {outcome,transition:{fixtureSchemaId:'malign.m2a-future-persistence-fixture',gameId:fixture.gameId,
    actorId:fixture.externalUserRefsByParticipant[fixture.actorParticipantId]??'m2a-player-1',
    actorParticipantId:fixture.actorParticipantId,commandType:command.type,idempotencyKey:key,
    fingerprintSha256:fingerprint(command),beforeState:outcome.before,afterState:outcome.after,
    engineResult:outcome.result as AcceptedEngineResult,effects:effectsFor(fixture,outcome),...options}};
};

const persist = async (
  targetPool:typeof pool,fixture:DurableGameFixture,command:M2APersistenceFixtureCommand,key:string,
  options:Partial<M2AFutureFixtureTransition>={},
) => {
  const prepared=await transitionFor(targetPool,fixture,command,key,options);
  const runtimePool=targetPool===pool?appPool:targetPool;
  const result=await new PostgresDurableUnitOfWork(runtimePool).persistM2AFutureFixtureTransition(prepared.transition);
  return {...prepared,result};
};

const artifactCounts=async(targetPool:typeof pool,gameId:string)=>Object.fromEntries(Object.entries((await targetPool.query<Record<string,string>>(
  `SELECT (SELECT game_version FROM malign.games WHERE id=$1)::text game_version,
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
   (SELECT count(*) FROM malign.outbox_messages WHERE game_id=$1)::text outbox`,[gameId])).rows[0]??{}).map(([k,v])=>[k,Number(v)]));

beforeAll(async()=>{
  expect((await adminPool.query<{server_version:string}>('SHOW server_version')).rows[0]?.server_version).toBe('18.6');
  await createDisposableDatabase(adminPool,databaseName);
  await bootstrapPostgresClusterRoles(adminDatabasePool);
  await createEphemeralLoginPrincipal(adminPool,migratorPrincipal,'malign_migration_owner',databaseName);
  await createEphemeralLoginPrincipal(adminPool,appPrincipal,'malign_app_runtime',databaseName);
  await createEphemeralLoginPrincipal(adminPool,outboxPrincipal,'malign_outbox_publisher',databaseName);
  await migratePostgres(pool,{applicationBuild:'m2-a-r20-r24',administrativePool:adminDatabasePool});
  await seedApprovedRegistry(pool);
},120_000);

afterAll(async()=>{
  await Promise.all([pool.end(),appPool.end(),outboxPool.end(),adminDatabasePool.end()]);
  await dropDisposableDatabase(adminPool,databaseName);
  await dropEphemeralLoginPrincipal(adminPool,migratorPrincipal);
  await dropEphemeralLoginPrincipal(adminPool,appPrincipal);
  await dropEphemeralLoginPrincipal(adminPool,outboxPrincipal);
  await adminPool.end();
});

describe('M2-A PostgreSQL 18.6 corrected owner gate',()=>{
  it('GE-M2-DB-001 — full physical catalog manifest rejects extra column, constraint, index and authority',async()=>{
    await expect(validateMigrationManifest()).resolves.toHaveLength(6);
    await expect(validateProductSchema(pool)).resolves.toBeUndefined();
    expect(physicalCatalogSha256(await readPhysicalCatalog(pool))).toMatch(/^[a-f0-9]{64}$/);
    const mutations=[
      [`ALTER TABLE malign.games ADD COLUMN m2a_extra_column integer`,`ALTER TABLE malign.games DROP COLUMN m2a_extra_column`],
      [`ALTER TABLE malign.games ADD CONSTRAINT m2a_extra_constraint CHECK (game_version>=0)`,`ALTER TABLE malign.games DROP CONSTRAINT m2a_extra_constraint`],
      [`CREATE INDEX m2a_extra_index ON malign.games(name)`,`DROP INDEX malign.m2a_extra_index`],
      [`GRANT SELECT ON malign.games TO PUBLIC`,`REVOKE SELECT ON malign.games FROM PUBLIC`],
    ] as const;
    for (const [add,remove] of mutations) {
      await pool.query(add);await expect(validateProductSchema(pool)).rejects.toMatchObject({code:'SCHEMA_MANIFEST_MISMATCH'});
      await pool.query(remove);await expect(validateProductSchema(pool)).resolves.toBeUndefined();
    }
    const audit=getLatestMigrationExecutionAudit();
    expect(audit).toHaveLength(6);
    expect(audit.map(({version,currentUser})=>[version,currentUser])).toEqual([
      [1,'malign_migration_owner'],[2,'malign_migration_owner'],[3,audit[2]?.sessionUser],
      [4,'malign_migration_owner'],[5,'malign_migration_owner'],[6,'malign_migration_owner'],
    ]);
    const roles=await pool.query<{rolname:string;rolcanlogin:boolean;rolsuper:boolean}>(
      `SELECT rolname,rolcanlogin,rolsuper FROM pg_roles
        WHERE rolname IN ('malign_migration_owner','malign_app_runtime','malign_outbox_publisher') ORDER BY rolname`);
    expect(roles.rows.every(row=>!row.rolcanlogin&&!row.rolsuper)).toBe(true);
  });

  it('GE-M2-DB-002 — administrative bootstrap and migration ledger are repeatable and checksummed',async()=>{
    const bootstrap=await bootstrapPostgresClusterRoles(adminDatabasePool);
    expect(bootstrap.currentUser).toBe(bootstrap.sessionUser);
    await expect(migratePostgres(pool,{applicationBuild:'repeat',administrativePool:adminDatabasePool})).resolves.toEqual([]);
    const ledger=await pool.query<{version:number;checksum:string}>(
      'SELECT version,checksum FROM malign_meta.schema_migrations ORDER BY version');
    expect(ledger.rows).toHaveLength(6);
    expect(ledger.rows.every(row=>/^[a-f0-9]{64}$/.test(row.checksum))).toBe(true);
  });

  it('GE-M2-DB-003/M2A-R26 — real migration-005 upgrade backfills legacy NULL traces atomically',async()=>{
    const name=`malign_m2a_n1_${randomUUID().replaceAll('-','').slice(0,12)}`;
    await createDisposableDatabase(adminPool,name);
    const n1Admin=createPostgresPool(configForDatabase(adminConfig,name));
    await adminPool.query(`GRANT CONNECT ON DATABASE ${name} TO ${appPrincipal}`);
    const n1=createPostgresPool(configForPrincipal(configForDatabase(adminConfig,name),migratorPrincipal));
    const n1App=createPostgresPool(configForPrincipal(configForDatabase(adminConfig,name),appPrincipal));
    try {
      await migratePostgres(n1,{targetVersion:5,applicationBuild:'n-1',administrativePool:n1Admin});
      const fixture=await createDurableGameFixture(n1,'N-1 evidence');
      const prepared=await transitionFor(n1,fixture,{type:'RESOURCE_EFFECT',commandId:randomUUID(),reason:'TURN_INCOME',delta:2},'n1-income');
      await new PostgresDurableUnitOfWork(n1App).persistM2AFutureFixtureTransition(prepared.transition);
      const legacy=await n1.query<{sequence:string;ordinal:number;balance:number}>(`SELECT game_event_sequence::text sequence,
        COALESCE(max(artifact_ordinal),0)::int+1 ordinal,max(balance_after)::int+1 balance
        FROM malign.resource_transactions WHERE game_id=$1 GROUP BY game_event_sequence ORDER BY game_event_sequence LIMIT 1`,
      [fixture.gameId]);
      const legacyRow=legacy.rows[0];if(legacyRow===undefined)throw new Error('Legacy resource evidence missing');
      await n1.query(`UPDATE malign.game_countries SET current_resources_cache=$2 WHERE game_id=$1
        AND controlling_participant_id=$3`,[fixture.gameId,legacyRow.balance,fixture.actorParticipantId]);
      await n1.query(`INSERT INTO malign.resource_transactions(game_id,game_event_sequence,artifact_ordinal,turn_id,
        participant_id,delta,reason_type,source_entity_type,source_entity_id,adjudication_trace_id,balance_after)
        VALUES ($1,$2,$3,$4,$5,1,'TURN_INCOME','LEGACY_MIGRATION_005',uuidv7(),NULL,$6)`,
      [fixture.gameId,legacyRow.sequence,legacyRow.ordinal,fixture.turnId,fixture.actorParticipantId,legacyRow.balance]);
      expect(Number((await n1.query<{count:string}>(`SELECT count(*)::text count FROM malign.resource_transactions
        WHERE game_id=$1 AND adjudication_trace_id IS NULL`,[fixture.gameId])).rows[0]?.count)).toBe(1);
      const before=await captureDurableEvidence(n1App,fixture.gameId,state=>({id:state['id'],version:state['version']}));

      const migration006=readFileSync(join(process.cwd(),'packages/persistence/migrations/006_durable_parity_and_least_privilege.sql'),'utf8');
      const rollbackClient=await n1.connect();
      try {
        await rollbackClient.query('BEGIN');await rollbackClient.query('SET LOCAL ROLE malign_migration_owner');
        await expect(rollbackClient.query(`${migration006}\nSELECT 1/0;`)).rejects.toBeDefined();
        await rollbackClient.query('ROLLBACK');
      } finally {rollbackClient.release();}
      expect(Number((await n1.query<{version:number}>('SELECT max(version)::int version FROM malign_meta.schema_migrations')).rows[0]?.version)).toBe(5);
      expect(Number((await n1.query<{count:string}>(`SELECT count(*)::text count FROM information_schema.columns
        WHERE table_schema='malign' AND table_name='planned_actions' AND column_name='parameters_json'`)).rows[0]?.count)).toBe(0);
      expect((await n1.query<{enabled:string}>(`SELECT tgenabled enabled FROM pg_trigger
        WHERE tgname='resource_transactions_append_only'`)).rows[0]?.enabled).toBe('O');

      await migratePostgres(n1,{applicationBuild:'n',administrativePool:n1Admin});
      const after=await captureDurableEvidence(n1App,fixture.gameId,state=>({id:state['id'],version:state['version']}));
      expect(after.state).toEqual(before.state);expect(after.gameplayHash).toBe(before.gameplayHash);
      expect(after.events).toEqual(before.events);expect(after.resourceLedger).toEqual(before.resourceLedger);
      expect(after.traces).toHaveLength(before.traces.length+1);
      expect(after.traces.filter(row=>row['trace_type']!=='M2A_FORWARD_LINK_BACKFILL')).toEqual(before.traces);
      expect(Number((await n1.query<{count:string}>(`SELECT count(*)::text count FROM malign.resource_transactions
        WHERE game_id=$1 AND adjudication_trace_id IS NULL`,[fixture.gameId])).rows[0]?.count)).toBe(0);
      expect(Number((await n1.query<{count:string}>(`SELECT count(*)::text count FROM malign.adjudication_traces
        WHERE game_id=$1 AND trace_type='M2A_FORWARD_LINK_BACKFILL'`,[fixture.gameId])).rows[0]?.count)).toBe(1);
      await expect(n1.query(`UPDATE malign.resource_transactions SET reason_type='FORBIDDEN'
        WHERE game_id=$1`,[fixture.gameId])).rejects.toBeDefined();
      await expect(n1.query('DELETE FROM malign.resource_transactions WHERE game_id=$1',[fixture.gameId])).rejects.toBeDefined();
    } finally {await Promise.all([n1.end(),n1App.end(),n1Admin.end()]);await dropDisposableDatabase(adminPool,name);}
  },120_000);

  it('GE-M2-DB-004 — five physical invariant families fail typed and roll back',async()=>{
    const fixture=await createDurableGameFixture(pool,'Constraint matrix');
    await materializeRegistryForGame(appPool,fixture.gameId,fixture.controllersByCountry);
    const card=await pool.query<{id:string}>(`SELECT id FROM malign.card_instances WHERE game_id=$1 AND zone='HAND' LIMIT 1`,[fixture.gameId]);
    const other=await createDurableGameFixture(pool,'Cross-game ref');
    const before=await artifactCounts(pool,fixture.gameId);
    const errors=[];
    errors.push(await probeConstraintViolation(appPool,
      `INSERT INTO malign.deck_card_positions(game_id,participant_id,card_instance_id,position,shuffle_revision)
       VALUES ($1,$2,$3,1,1)`,[fixture.gameId,fixture.actorParticipantId,card.rows[0]?.id]));
    errors.push(await probeConstraintViolation(appPool,
      `INSERT INTO malign.action_point_transactions(game_id,game_event_sequence,artifact_ordinal,turn_id,
       participant_id,sequence_number,delta,reason_type,correlation_id,adjudication_trace_id,balance_after)
       VALUES ($1,1,1,$2,$3,1,1,'DUPLICATE',uuidv7(),
         (SELECT id FROM malign.adjudication_traces WHERE game_id=$1 ORDER BY artifact_ordinal LIMIT 1),4)`,
      [fixture.gameId,fixture.turnId,fixture.actorParticipantId]));
    errors.push(await probeConstraintViolation(appPool,
      `UPDATE malign.game_countries SET current_resources_cache=-1 WHERE game_id=$1`,[fixture.gameId]));
    errors.push(await probeConstraintViolation(appPool,
      `INSERT INTO malign.card_instances(game_id,country_owner_definition_id,serial_template_id,card_definition_id,
       current_controller_participant_id,zone) VALUES ($1,uuidv7(),uuidv7(),uuidv7(),$2,'HAND')`,
      [fixture.gameId,fixture.actorParticipantId]));
    errors.push(await probeConstraintViolation(appPool,
      `INSERT INTO malign.resource_transactions(game_id,game_event_sequence,artifact_ordinal,turn_id,
       participant_id,delta,reason_type,balance_after) VALUES ($1,99,1,$2,$3,1,'CROSS_GAME',1)`,
      [fixture.gameId,fixture.turnId,other.actorParticipantId]));
    expect(errors.map(error=>error.code)).toEqual(['SINGLE_ZONE_VIOLATION','ORDERING_CONSTRAINT_VIOLATION',
      'NEGATIVE_BALANCE','REFERENCE_CONSTRAINT_VIOLATION','CROSS_GAME_REFERENCE']);
    expect(await artifactCounts(pool,fixture.gameId)).toEqual(before);
  },120_000);

  it('M2A-R27 — every trace-bearing artifact enforces the composite Game scope',async()=>{
    const expectedConstraints=[
      'action_point_transactions_trace_fk','resource_transactions_trace_fk','influence_mutations_trace_fk',
      'legitimacy_events_trace_fk','vp_transactions_trace_fk','action_resolutions_trace_fk',
      'reaction_plays_trace_fk','campaign_activations_trace_fk','modifier_applications_trace_fk',
      'influence_resolutions_trace_fk','viralization_resolutions_trace_fk',
      'regime_ability_activations_trace_fk','game_events_trace_fk','facilitator_requests_trace_fk',
    ].sort();
    const constraints=await pool.query<{name:string;definition:string}>(`SELECT conname name,
      pg_get_constraintdef(oid,true) definition FROM pg_constraint
      WHERE connamespace='malign'::regnamespace AND conname=ANY($1::text[]) ORDER BY conname`,[expectedConstraints]);
    expect(constraints.rows.map(({name})=>name)).toEqual(expectedConstraints);
    expect(constraints.rows.every(({definition})=>
      definition.includes('(game_id, adjudication_trace_id)')||definition.includes('(game_id, full_context_trace_id)'))).toBe(true);
    const gameA=await createDurableGameFixture(pool,'Trace scope A');
    const gameB=await createDurableGameFixture(pool,'Trace scope B');
    const foreignTrace=(await pool.query<{id:string}>(`SELECT id FROM malign.adjudication_traces
      WHERE game_id=$1 ORDER BY game_event_sequence,artifact_ordinal LIMIT 1`,[gameB.gameId])).rows[0]?.id;
    const before=await artifactCounts(pool,gameA.gameId);
    const error=await probeConstraintViolation(appPool,`INSERT INTO malign.game_events(game_id,sequence_number,
      event_type,subject_type,subject_id,payload_json,payload_schema_id,payload_schema_version,
      visibility_class,adjudication_trace_id,correlation_id,state_hash_after)
      SELECT $1,event_sequence_head+1,'CROSS_GAME_TRACE','GAME',$1,'{}'::jsonb,'malign.fault','1.0',
        'GAME',$2,uuidv7(),gameplay_state_hash FROM malign.games WHERE id=$1`,
    [gameA.gameId,foreignTrace]);
    expect(error.code).toBe('CROSS_GAME_REFERENCE');
    expect(await artifactCounts(pool,gameA.gameId)).toEqual(before);
  },120_000);

  it('GE-M2-DB-005 — official country data, approved registry and 540-card materialization are idempotent',async()=>{
    const approved=await loadApprovedRegistrySnapshot();expect(approved.compatibility.seedable).toBe(true);
    await seedApprovedRegistry(pool);await seedApprovedRegistry(pool);
    const countries=await pool.query<{logical_id:string;mascot:string;starting_resource_default:number;turn_income_default:number;source_reference:string}>(
      `SELECT logical_id,mascot,starting_resource_default,turn_income_default,source_reference
       FROM malign.country_definitions ORDER BY logical_id`);
    expect(countries.rows.map(row=>[row.logical_id,row.mascot])).toEqual([
      ['ARDEN','Tree'],['DINESIA','Shark'],['FLUMA','Tree and River'],['PRESQUE','Horse'],['URSARIA','Bear']]);
    expect(countries.rows.every(row=>row.starting_resource_default>0&&row.turn_income_default>0&&row.source_reference.includes('section 13'))).toBe(true);
    const fixture=await createDurableGameFixture(pool,'Registry materialization');
    expect(await materializeRegistryForGame(appPool,fixture.gameId,fixture.controllersByCountry)).toEqual({cards:540,starters:25});
    expect(await materializeRegistryForGame(appPool,fixture.gameId,fixture.controllersByCountry)).toEqual({cards:540,starters:25});
  },120_000);

  it('GE-M2-DB-006 — registry pins remain immutable',async()=>{
    const fixture=await createDurableGameFixture(pool,'Immutable pins');
    const future=await pool.query<{id:string}>(`INSERT INTO malign.card_registry_versions(logical_id,version,status,
      jcs_sha256,snapshot_blob_sha1,approved_decision_id) VALUES ('FUTURE','9','DRAFT',decode(repeat('01',32),'hex'),
      decode(repeat('02',20),'hex'),'TEST') RETURNING id`);
    await expect(pool.query('UPDATE malign.games SET card_registry_version_id=$2 WHERE id=$1',
      [fixture.gameId,future.rows[0]?.id])).rejects.toBeDefined();
    expect((await pool.query<{id:string}>('SELECT card_registry_version_id id FROM malign.games WHERE id=$1',[fixture.gameId])).rows[0]?.id)
      .toBe(fixture.registryVersionId);
  });

  it('GE-M2-DB-007 — pg_dump/pg_restore preserves the complete evidence bundle',async()=>{
    const fixture=await createDurableGameFixture(pool,'Backup evidence');
    await persist(pool,fixture,{type:'VP_EFFECT',commandId:randomUUID(),reason:'CAMPAIGN',delta:4,floorZero:true},'backup-vp');
    const before=await captureDurableEvidence(appPool,fixture.gameId,state=>({id:state['id'],version:state['version']}));
    const dir=mkdtempSync(join(tmpdir(),'malign-m2a-backup-'));const dump=join(dir,'database.dump');
    const restoreName=`malign_m2a_restore_${randomUUID().replaceAll('-','').slice(0,12)}`;
    try {
      execFileSync('pg_dump',['--format=custom','--file',dump,databaseName],{env:{...process.env}});
      await createDisposableDatabase(adminPool,restoreName);
      execFileSync('pg_restore',['--dbname',restoreName,'--exit-on-error',dump],{env:{...process.env}});
      await adminPool.query(`GRANT CONNECT ON DATABASE ${restoreName} TO ${appPrincipal}`);
      const restored=createPostgresPool(configForDatabase(adminConfig,restoreName));
      const restoredApp=createPostgresPool(configForPrincipal(configForDatabase(adminConfig,restoreName),appPrincipal));
      try {expect(await captureDurableEvidence(restoredApp,fixture.gameId,
        state=>({id:state['id'],version:state['version']}))).toEqual(before);}
      finally {await Promise.all([restored.end(),restoredApp.end()]);}
    } finally {
      if ((await adminPool.query<{exists:boolean}>('SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname=$1) exists',[restoreName])).rows[0]?.exists)
        await dropDisposableDatabase(adminPool,restoreName);
      rmSync(dir,{recursive:true,force:true});
    }
  },120_000);

  it('GE-E2E-006 — typed Engine effects exceed 40 cubes and the VP visual track',async()=>{
    const fixture=await createDurableGameFixture(pool,'No component caps');
    await persist(pool,fixture,{type:'APPLY_COMPONENT_EFFECT',commandId:randomUUID(),influenceDelta:41,victoryPointDelta:101},'component-effect');
    const row=(await pool.query<{cubes:number;vp:number}>(`SELECT
      (SELECT max(count) FROM malign.influence_stacks WHERE game_id=$1)::int cubes,
      (SELECT max(current_vp_cache) FROM malign.game_countries WHERE game_id=$1)::int vp`,[fixture.gameId])).rows[0];
    expect(row).toEqual({cubes:41,vp:101});await expect(reconcileDurableGame(appPool,fixture.gameId)).resolves.toBeUndefined();
  });

  it('GE-CORE-011 — a preserved planned target removed by action one rejects action two without mutation',async()=>{
    const fixture=await createDurableGameFixture(pool,'Removed planned target');
    await persist(pool,fixture,{type:'REMOVE_TARGET',commandId:randomUUID(),targetId:'TARGET-1'},'remove-target');
    const before=await artifactCounts(pool,fixture.gameId);const state=await fixtureState(pool,fixture);
    const outcome=dispatchM2APersistenceFixture(state,{type:'RESOLVE_PLANNED_TARGET',commandId:randomUUID()},fixedNow);
    expect(outcome.result).toMatchObject({status:'REJECTED',resultCode:'OBJECT_NO_LONGER_VALID'});
    expect(outcome.artifacts).toEqual([]);expect(await artifactCounts(pool,fixture.gameId)).toEqual(before);
  });

  it('GE-AUD-002 — income, spend and transfer reconstruct resources from the complete ledger',async()=>{
    const fixture=await createDurableGameFixture(pool,'Resource journal');
    await persist(pool,fixture,{type:'RESOURCE_EFFECT',commandId:randomUUID(),reason:'TURN_INCOME',delta:3},'income');
    await persist(pool,fixture,{type:'RESOURCE_EFFECT',commandId:randomUUID(),reason:'SPEND',delta:-2},'spend');
    await persist(pool,fixture,{type:'RESOURCE_TRANSFER',commandId:randomUUID(),amount:1,targetParticipantId:fixture.participantIds[1]??''},'transfer');
    await expect(reconcileDurableGame(appPool,fixture.gameId)).resolves.toBeUndefined();
    const result=await pool.query<{participant_id:string;cache:string;ledger:string}>(`SELECT c.controlling_participant_id participant_id,
      c.current_resources_cache::text cache,COALESCE(sum(t.delta),0)::text ledger FROM malign.game_countries c
      LEFT JOIN malign.resource_transactions t ON t.game_id=c.game_id AND t.participant_id=c.controlling_participant_id
      WHERE c.game_id=$1 GROUP BY c.controlling_participant_id,c.current_resources_cache ORDER BY c.controlling_participant_id`,[fixture.gameId]);
    expect(result.rows.every(row=>row.cache===row.ledger)).toBe(true);
    expect(new Set((await pool.query<{reason_type:string}>('SELECT reason_type FROM malign.resource_transactions WHERE game_id=$1',[fixture.gameId])).rows.map(row=>row.reason_type)))
      .toEqual(new Set(['SCENARIO_SETUP','TURN_INCOME','SPEND','TRANSFER_OUT','TRANSFER_IN']));
  });

  it('GE-AUD-003 — campaign, legitimacy, corruption and objective VP entries reconstruct with floor zero',async()=>{
    const fixture=await createDurableGameFixture(pool,'VP journal');
    for (const command of [
      {type:'VP_EFFECT',commandId:randomUUID(),reason:'CAMPAIGN',delta:5,floorZero:true},
      {type:'VP_EFFECT',commandId:randomUUID(),reason:'LEGITIMACY',delta:3,floorZero:true},
      {type:'VP_EFFECT',commandId:randomUUID(),reason:'CORRUPTION',delta:-20,floorZero:true},
      {type:'VP_EFFECT',commandId:randomUUID(),reason:'OBJECTIVE',delta:4,floorZero:true},
    ] as const) await persist(pool,fixture,command,`vp-${command.reason}`);
    await expect(reconcileDurableGame(appPool,fixture.gameId)).resolves.toBeUndefined();
    const result=await pool.query<{cache:string;ledger:string;minimum:string}>(`SELECT c.current_vp_cache::text cache,
      COALESCE(sum(t.delta),0)::text ledger,min(t.balance_after)::text minimum FROM malign.game_countries c
      JOIN malign.vp_transactions t ON t.game_id=c.game_id AND t.participant_id=c.controlling_participant_id
      WHERE c.game_id=$1 AND c.controlling_participant_id=$2 GROUP BY c.current_vp_cache`,[fixture.gameId,fixture.actorParticipantId]);
    expect(result.rows[0]).toEqual({cache:'4',ledger:'4',minimum:'0'});
  });

  it('GE-AUD-004 — stable snapshot N plus two real reducer events replays to the exact final hash',async()=>{
    const fixture=await createDurableGameFixture(pool,'Replay tail');
    await persist(pool,fixture,{type:'RESOURCE_EFFECT',commandId:randomUUID(),reason:'TURN_INCOME',delta:1},'snap-n',{captureSnapshot:true});
    await persist(pool,fixture,{type:'VP_EFFECT',commandId:randomUUID(),reason:'CAMPAIGN',delta:2,floorZero:true},'tail-1');
    await persist(pool,fixture,{type:'APPLY_COMPONENT_EFFECT',commandId:randomUUID(),influenceDelta:2,victoryPointDelta:1},'tail-2');
    const fresh=createPostgresPool(configForPrincipal(databaseConfig,appPrincipal));
    try {const recovered=await recoverDurableGame(fresh,fixture.gameId);expect(recovered.snapshotVersion).toBe(1);
      expect(recovered.eventTail).toHaveLength(2);expect(recovered.stateHash).toBe(fingerprintCanonical(recovered.state));
      expect(recovered.gameVersion).toBe(3);} finally {await fresh.end();}
  });

  it('GE-FAC-002 — facilitator override records reason, refs and noncanonical state',async()=>{
    const fixture=await createDurableGameFixture(pool,'Facilitator override');
    await materializeRegistryForGame(appPool,fixture.gameId,fixture.controllersByCountry);
    await pool.query("UPDATE malign.game_participants SET role='FACILITATOR' WHERE id=$1",[fixture.actorParticipantId]);
    const card=(await pool.query<{id:string}>('SELECT id FROM malign.card_instances WHERE game_id=$1 LIMIT 1',[fixture.gameId])).rows[0]?.id??'';
    const {recordFacilitatorOverride}=await import('./recovery.js');
    const id=await recordFacilitatorOverride(appPool,{gameId:fixture.gameId,facilitatorParticipantId:fixture.actorParticipantId,
      targetCardInstanceId:card,reason:'Audited correction',noncanonical:true});
    expect((await pool.query<{rationale:string;noncanonical:boolean}>(`SELECT d.rationale,g.noncanonical FROM malign.facilitator_decisions d
      JOIN malign.games g ON g.id=d.game_id WHERE d.id=$1`,[id])).rows[0]).toEqual({rationale:'Audited correction',noncanonical:true});
    const recovered=await recoverDurableGame(appPool,fixture.gameId);
    expect(recovered).toMatchObject({gameVersion:1,snapshotVersion:0});
    expect(recovered.eventTail).toHaveLength(1);
  });

  it('GE-M2-TX-001 — accepted Engine transition commits state, ledgers, trace, idempotency and outbox atomically',async()=>{
    const fixture=await createDurableGameFixture(pool,'Atomic UoW');
    const command={type:'APPLY_COMPONENT_EFFECT',commandId:randomUUID(),influenceDelta:1,victoryPointDelta:1} as const;
    const prepared=await transitionFor(pool,fixture,command,'atomic');
    const effects:DurableEffectBatch={...prepared.transition.effects,actionPoints:[{turnId:fixture.turnId,
      participantId:fixture.actorParticipantId,delta:-1,reasonType:'COMMAND'}],resources:[{turnId:fixture.turnId,
      participantId:fixture.actorParticipantId,delta:1,reasonType:'COMMAND'}],legitimacy:[{turnId:fixture.turnId,
      pdStateId:fixture.pdStateId,previousParticipantId:fixture.actorParticipantId,
      newParticipantId:fixture.participantIds[1]??null,reasonType:'COMMAND'}],dieRolls:[{turnId:fixture.turnId,
      participantId:fixture.actorParticipantId,rawValue:7,sourceType:'COMMAND'}]};
    const result=await new PostgresDurableUnitOfWork(appPool).persistM2AFutureFixtureTransition({...prepared.transition,effects,
      continuation:{sourceResolutionId:fixture.actionResolutionId,waitingInteractionId:randomUUID(),type:'CHOICE',state:{step:1}}});
    expect(result).toMatchObject({gameVersion:1,eventSequence:2,outboxSequence:1,currentUser:'malign_app_runtime'});
    await expect(reconcileDurableGame(appPool,fixture.gameId)).resolves.toBeUndefined();
    const metrics=createM2AQueryMetrics();
    const params:Record<string,readonly unknown[]>={aggregate_load:[fixture.gameId],authorized_projection_load:[fixture.gameId,0,100],
      replay_page:[fixture.gameId,0,100],pending_dashboard:[fixture.gameId,100],outbox_claim:[],registry_pin_lookup:[fixture.gameId]};
    for (const budget of M2A_QUERY_BUDGETS) expect((await executeWithinQueryBudget(pool,budget.name,params[budget.name]??[],metrics)).withinBudget).toBe(true);
    const plans=await captureCriticalExplainPlans(appPool,fixture.gameId);assertCriticalExplainPlansUseIndexes(plans);
    expect(metrics.replayPages).toBe(1);expect(metrics.historyRowsObserved).toBeGreaterThan(0);
  });

  it('GE-M2-TX-002 — every write-boundary fault rolls back artifacts and provider cursors',async()=>{
    for (const boundary of M2A_WRITE_BOUNDARIES) {
      const fixture=await createDurableGameFixture(pool,`Fault ${boundary}`);
      const prepared=await transitionFor(pool,fixture,{type:'APPLY_COMPONENT_EFFECT',commandId:randomUUID(),influenceDelta:1,victoryPointDelta:1},`fault-${boundary}`);
      const rng=new TransactionalSequence([7]);const clock=new TransactionalSequence([fixedNow()]);
      const before=await artifactCounts(pool,fixture.gameId);
      await expect(new PostgresDurableUnitOfWork(appPool,{rng,clock}).persistM2AFutureFixtureTransition({...prepared.transition,
        effects:{...prepared.transition.effects,actionPoints:[{turnId:fixture.turnId,participantId:fixture.actorParticipantId,
          delta:-1,reasonType:'COMMAND'}],resources:[{turnId:fixture.turnId,participantId:fixture.actorParticipantId,
          delta:1,reasonType:'COMMAND'}],legitimacy:[{turnId:fixture.turnId,pdStateId:fixture.pdStateId,
          previousParticipantId:fixture.actorParticipantId,newParticipantId:fixture.participantIds[1]??null,reasonType:'COMMAND'}],
          dieRolls:[{turnId:fixture.turnId,participantId:fixture.actorParticipantId,sourceType:'COMMAND'}]},
        continuation:{sourceResolutionId:fixture.actionResolutionId,waitingInteractionId:randomUUID(),type:'CHOICE',state:{step:1}},
        captureSnapshot:true,faultAt:boundary})).rejects.toBeDefined();
      expect(await artifactCounts(pool,fixture.gameId)).toEqual(before);expect(rng.cursor).toBe(0);expect(clock.cursor).toBe(0);
    }
  },180_000);

  it('GE-M2-TX-003 — concurrent connections produce one CAS winner and one clean stale rejection',async()=>{
    const fixture=await createDurableGameFixture(pool,'CAS');
    const a=await transitionFor(pool,fixture,{type:'VP_EFFECT',commandId:randomUUID(),reason:'CAMPAIGN',delta:1,floorZero:true},'cas-a');
    const b=await transitionFor(pool,fixture,{type:'VP_EFFECT',commandId:randomUUID(),reason:'OBJECTIVE',delta:2,floorZero:true},'cas-b');
    const outcomes=await Promise.allSettled([new PostgresDurableUnitOfWork(appPool).persistM2AFutureFixtureTransition(a.transition),
      new PostgresDurableUnitOfWork(appPool).persistM2AFutureFixtureTransition(b.transition)]);
    expect(outcomes.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    expect(outcomes.find(result=>result.status==='rejected')?.status==='rejected'?
      (outcomes.find(result=>result.status==='rejected') as PromiseRejectedResult).reason:undefined).toMatchObject({code:'GAME_VERSION_CONFLICT'});
    expect(await artifactCounts(pool,fixture.gameId)).toMatchObject({game_version:1,idempotency:1,outbox:1});
  });

  it('GE-M2-TX-004 — retry from a new adapter returns the durable Engine result exactly once',async()=>{
    const fixture=await createDurableGameFixture(pool,'Idempotency retry');
    const prepared=await transitionFor(pool,fixture,{type:'VP_EFFECT',commandId:randomUUID(),reason:'CAMPAIGN',delta:1,floorZero:true},'retry');
    const original=await new PostgresDurableUnitOfWork(appPool).persistM2AFutureFixtureTransition(prepared.transition);
    const fresh=createPostgresPool(configForPrincipal(databaseConfig,appPrincipal));
    try {expect(await new PostgresDurableUnitOfWork(fresh).persistM2AFutureFixtureTransition(prepared.transition)).toEqual(original);} finally {await fresh.end();}
    expect(await artifactCounts(pool,fixture.gameId)).toMatchObject({game_version:1,idempotency:1,outbox:1});
  });

  it('GE-M2-TX-005 — fingerprint conflict fails without leakage or mutation',async()=>{
    const fixture=await createDurableGameFixture(pool,'Idempotency conflict');
    const prepared=await transitionFor(pool,fixture,{type:'VP_EFFECT',commandId:randomUUID(),reason:'CAMPAIGN',delta:1,floorZero:true},'same-key');
    await new PostgresDurableUnitOfWork(appPool).persistM2AFutureFixtureTransition(prepared.transition);
    const before=await artifactCounts(pool,fixture.gameId);
    await expect(new PostgresDurableUnitOfWork(appPool).persistM2AFutureFixtureTransition({...prepared.transition,
      fingerprintSha256:fingerprint('different')})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
    expect(await artifactCounts(pool,fixture.gameId)).toEqual(before);
  });

  it('GE-M2-TX-006 — outbox is invisible on rollback and visible only with gameplay commit',async()=>{
    const fixture=await createDurableGameFixture(pool,'Outbox visibility');
    const prepared=await transitionFor(pool,fixture,{type:'VP_EFFECT',commandId:randomUUID(),reason:'CAMPAIGN',delta:1,floorZero:true},'outbox-rollback');
    await expect(new PostgresDurableUnitOfWork(appPool).persistM2AFutureFixtureTransition({...prepared.transition,faultAt:'delivery_state'})).rejects.toBeDefined();
    expect((await artifactCounts(pool,fixture.gameId)).outbox).toBe(0);
    await new PostgresDurableUnitOfWork(appPool).persistM2AFutureFixtureTransition(prepared.transition);
    expect(await new PostgresOutboxPublisher(outboxPool).claimOne(30_000,fixture.gameId)).toMatchObject({outboxSequence:1});
  });

  it('GE-M2-TX-007 — two publishers preserve per-game order through lease, retry, ACK and dedup',async()=>{
    const fixture=await createDurableGameFixture(pool,'Ordered outbox');
    await persist(pool,fixture,{type:'VP_EFFECT',commandId:randomUUID(),reason:'CAMPAIGN',delta:1,floorZero:true},'outbox-1');
    await persist(pool,fixture,{type:'VP_EFFECT',commandId:randomUUID(),reason:'OBJECTIVE',delta:1,floorZero:true},'outbox-2');
    const firstPublisher=new PostgresOutboxPublisher(outboxPool);const secondPublisher=new PostgresOutboxPublisher(outboxPool);
    const consumer=new DeduplicatingTestConsumer();const first=await firstPublisher.claimOne(30_000,fixture.gameId);
    if (!first) throw new Error('Expected first claim');expect(first.outboxSequence).toBe(1);expect(consumer.consume(first)).toBe(true);
    expect(await secondPublisher.claimOne(30_000,fixture.gameId)).toBeUndefined();
    await pool.query(`UPDATE malign.outbox_delivery_states SET claim_expires_at=clock_timestamp()-interval '1 second'
      WHERE outbox_message_id=$1`,[first.id]);
    expect(await secondPublisher.recoverExpiredLeases()).toBe(1);
    const retried=await secondPublisher.claimOne(30_000,fixture.gameId);if(!retried)throw new Error('Expected retry');
    expect(retried.outboxSequence).toBe(1);expect(consumer.consume(retried)).toBe(false);
    await secondPublisher.deliver(retried,()=>Promise.resolve('transport'));await secondPublisher.acknowledge(retried);
    const second=await firstPublisher.claimOne(30_000,fixture.gameId);expect(second?.outboxSequence).toBe(2);
    const attempts=await pool.query<{attempt_ordinal:string;stage_ordinal:number}>(`SELECT attempt_ordinal,stage_ordinal
      FROM malign.outbox_delivery_attempts WHERE outbox_message_id=$1 ORDER BY attempt_ordinal,stage_ordinal`,[first.id]);
    const attemptOrder=attempts.rows.map(row=>`${row.attempt_ordinal}:${row.stage_ordinal}`);
    expect(attemptOrder).toEqual([...attemptOrder].sort((a,b)=>{
      const [aa='0',as='0']=a.split(':');const [ba='0',bs='0']=b.split(':');
      return Number(aa)-Number(ba)||Number(as)-Number(bs);
    }));
  });

  it('GE-M2-TX-008 — new Pool replays two tail events and validates a versioned continuation without providers',async()=>{
    const fixture=await createDurableGameFixture(pool,'Recovery restart');
    await persist(pool,fixture,{type:'VP_EFFECT',commandId:randomUUID(),reason:'CAMPAIGN',delta:1,floorZero:true},'recovery-snapshot',{captureSnapshot:true});
    await persist(pool,fixture,{type:'RESOURCE_EFFECT',commandId:randomUUID(),reason:'TURN_INCOME',delta:1},'recovery-tail-1',{
      continuation:{sourceResolutionId:fixture.actionResolutionId,waitingInteractionId:randomUUID(),type:'CHOICE',state:{choice:'OPEN'}}});
    await persist(pool,fixture,{type:'APPLY_COMPONENT_EFFECT',commandId:randomUUID(),influenceDelta:1,victoryPointDelta:1},'recovery-tail-2');
    const fresh=createPostgresPool(configForPrincipal(databaseConfig,appPrincipal));try {const recovered=await recoverDurableGame(fresh,fixture.gameId);
      expect(recovered.eventTail).toHaveLength(2);expect(recovered.continuation).toEqual({choice:'OPEN'});
      expect(recovered.currentUser).toBe('malign_app_runtime');} finally {await fresh.end();}
  });

  it('M2A-R12 — replay rejects gaps, duplicate ordering, unknown schemas, bad hashes and invalid continuations',async()=>{
    const duplicateFixture=await createDurableGameFixture(pool,'Replay duplicate ordering');
    await persist(pool,duplicateFixture,{type:'VP_EFFECT',commandId:randomUUID(),reason:'CAMPAIGN',delta:1,floorZero:true},'replay-duplicate');
    await expect(probeConstraintViolation(appPool,`INSERT INTO malign.game_events(
      game_id,sequence_number,event_type,payload_json,payload_schema_id,payload_schema_version,
      visibility_class,correlation_id,state_hash_after)
      SELECT game_id,sequence_number,event_type,payload_json,payload_schema_id,payload_schema_version,
             visibility_class,uuidv7(),state_hash_after FROM malign.game_events
       WHERE game_id=$1 AND sequence_number=2`,[duplicateFixture.gameId]))
      .resolves.toMatchObject({code:'ORDERING_CONSTRAINT_VIOLATION'});

    const cases:readonly [string,(fixture:DurableGameFixture)=>Promise<unknown>,boolean][]=[
      ['missing-sequence',async f=>{await pool.query('ALTER TABLE malign.game_events DISABLE TRIGGER game_events_append_only');
        try{return await pool.query('UPDATE malign.game_events SET sequence_number=3 WHERE game_id=$1 AND sequence_number=2',[f.gameId]);}
        finally{await pool.query('ALTER TABLE malign.game_events ENABLE TRIGGER game_events_append_only');}},false],
      ['unknown-schema',async f=>{await pool.query('ALTER TABLE malign.game_events DISABLE TRIGGER game_events_append_only');
        try{return await pool.query("UPDATE malign.game_events SET payload_schema_version='999' WHERE game_id=$1 AND sequence_number=2",[f.gameId]);}
        finally{await pool.query('ALTER TABLE malign.game_events ENABLE TRIGGER game_events_append_only');}},false],
      ['bad-event-hash',async f=>{await pool.query('ALTER TABLE malign.game_events DISABLE TRIGGER game_events_append_only');
        try{return await pool.query("UPDATE malign.game_events SET state_hash_after=decode(repeat('ff',32),'hex') WHERE game_id=$1 AND sequence_number=2",[f.gameId]);}
        finally{await pool.query('ALTER TABLE malign.game_events ENABLE TRIGGER game_events_append_only');}},false],
      ['invalid-continuation',f=>pool.query("UPDATE malign.pending_resolutions SET state_hash=decode(repeat('ff',32),'hex') WHERE game_id=$1",[f.gameId]),true],
    ];
    for (const [name,corrupt,withContinuation] of cases) {
      const fixture=await createDurableGameFixture(pool,`Replay rejection ${name}`);
      await persist(pool,fixture,{type:'VP_EFFECT',commandId:randomUUID(),reason:'CAMPAIGN',delta:1,floorZero:true},`replay-${name}`,
        withContinuation?{continuation:{sourceResolutionId:fixture.actionResolutionId,waitingInteractionId:randomUUID(),
          type:'CHOICE',state:{valid:true}}}:{});
      await corrupt(fixture);
      await expect(recoverDurableGame(appPool,fixture.gameId)).rejects.toMatchObject({code:'RECONCILIATION_MISMATCH'});
    }
  });

  it('GE-M2-TX-009 — reconciliation detects every durable family, blocks and appends diagnostics without gameplay events',async()=>{
    const injectors:[string,(fixture:DurableGameFixture)=>Promise<unknown>][]=[
      ['coordinated-cache',async f=>{const s={tampered:true};await pool.query(`UPDATE malign.games SET authoritative_state_json=$2,
        gameplay_state_hash=decode($3,'hex') WHERE id=$1`,[f.gameId,JSON.stringify(s),fingerprintCanonical(s)]);}],
      ['event-head',f=>pool.query('UPDATE malign.games SET event_sequence_head=event_sequence_head+1 WHERE id=$1',[f.gameId])],
      ['outbox-head',f=>pool.query('UPDATE malign.games SET outbox_sequence_head=outbox_sequence_head+1 WHERE id=$1',[f.gameId])],
      ['ap',f=>pool.query(`UPDATE malign.action_point_balances SET spent=spent+1,remaining=remaining-1
        WHERE game_id=$1 AND participant_id=$2`,[f.gameId,f.actorParticipantId])],
      ['resources',f=>pool.query('UPDATE malign.game_countries SET current_resources_cache=current_resources_cache+1 WHERE game_id=$1',[f.gameId])],
      ['vp',f=>pool.query('UPDATE malign.game_countries SET current_vp_cache=current_vp_cache+1 WHERE game_id=$1',[f.gameId])],
      ['influence',f=>pool.query('UPDATE malign.influence_stacks SET count=count+1 WHERE game_id=$1',[f.gameId])],
      ['legitimacy',f=>pool.query('UPDATE malign.game_countries SET legitimacy_count_cache=legitimacy_count_cache+1 WHERE game_id=$1',[f.gameId])],
      ['trace',async f=>{await pool.query('ALTER TABLE malign.adjudication_traces DISABLE TRIGGER adjudication_traces_append_only');
        await pool.query(`UPDATE malign.adjudication_traces SET pre_state_hash=decode(repeat('ff',32),'hex') WHERE game_id=$1`,[f.gameId]);
        await pool.query('ALTER TABLE malign.adjudication_traces ENABLE TRIGGER adjudication_traces_append_only');}],
      ['snapshot-hash',async f=>{await pool.query('ALTER TABLE malign.game_snapshots DISABLE TRIGGER game_snapshots_append_only');
        await pool.query(`UPDATE malign.game_snapshots SET canonical_jcs_sha256=decode(repeat('ff',32),'hex') WHERE game_id=$1`,[f.gameId]);
        await pool.query('ALTER TABLE malign.game_snapshots ENABLE TRIGGER game_snapshots_append_only');}],
      ['snapshot-pin',async f=>{const other=await createDurableGameFixture(pool,'Alternate snapshot pin');
        await pool.query('ALTER TABLE malign.game_snapshots DISABLE TRIGGER game_snapshots_append_only');
        await pool.query(`UPDATE malign.game_snapshots SET scenario_definition_id=$2 WHERE game_id=$1`,[f.gameId,other.scenarioDefinitionId]);
        await pool.query('ALTER TABLE malign.game_snapshots ENABLE TRIGGER game_snapshots_append_only');}],
      ['idempotency',async f=>{await pool.query('ALTER TABLE malign.idempotency_records DISABLE TRIGGER idempotency_records_seal');
        await pool.query(`UPDATE malign.idempotency_records SET result_json=jsonb_set(result_json,'{gameVersion}','999'::jsonb)
          WHERE game_id=$1`,[f.gameId]);
        await pool.query('ALTER TABLE malign.idempotency_records ENABLE TRIGGER idempotency_records_seal');}],
      ['continuation',f=>pool.query(`UPDATE malign.pending_resolutions SET state_hash=decode(repeat('ff',32),'hex') WHERE game_id=$1`,[f.gameId])],
      ['outbox-state',f=>pool.query(`DELETE FROM malign.outbox_delivery_states WHERE outbox_message_id IN
        (SELECT id FROM malign.outbox_messages WHERE game_id=$1)`,[f.gameId])],
      ['attempt-head',f=>pool.query(`UPDATE malign.outbox_delivery_states SET last_attempt_ordinal=4 WHERE outbox_message_id IN
        (SELECT id FROM malign.outbox_messages WHERE game_id=$1)`,[f.gameId])],
    ];
    for (const [family,inject] of injectors) {
      const fixture=await createDurableGameFixture(pool,`Mismatch ${family}`);
      await persist(pool,fixture,{type:'VP_EFFECT',commandId:randomUUID(),reason:'CAMPAIGN',delta:1,floorZero:true},`source-${family}`,{
        continuation:{sourceResolutionId:fixture.actionResolutionId,waitingInteractionId:randomUUID(),type:'CHOICE',state:{valid:true}}});
      const eventsBefore=(await artifactCounts(pool,fixture.gameId)).events;await inject(fixture);
      await expect(reconcileDurableGame(appPool,fixture.gameId)).rejects.toMatchObject({code:'RECONCILIATION_MISMATCH'});
      expect((await pool.query<{recovery_blocked:boolean}>('SELECT recovery_blocked FROM malign.games WHERE id=$1',[fixture.gameId])).rows[0]?.recovery_blocked).toBe(true);
      expect((await artifactCounts(pool,fixture.gameId)).events).toBe(eventsBefore);
      expect(Number((await pool.query<{count:string}>(`SELECT count(*)::text count FROM malign.adjudication_traces
        WHERE game_id=$1 AND trace_type='RECONCILIATION_DIAGNOSTIC_SYSTEM' AND participant_id IS NULL`,[fixture.gameId])).rows[0]?.count)).toBe(1);
    }
  },180_000);

  it('M2A-R11/R29 — authenticated application allocates Game identity in PostgreSQL and persists accepted transitions',async()=>{
    const provisionalGameId=`caller-selected:${randomUUID()}`;
    const authority=new InMemorySessionAuthority([
      {authenticatedSessionId:'m2a-session-f1',userId:'m2a-facilitator',gameId:provisionalGameId,participantId:'F1',role:'FACILITATOR'},
      {authenticatedSessionId:'m2a-session-p1',userId:'m2a-player-1',gameId:provisionalGameId,participantId:'P1',role:'PLAYER'},
    ]);
    const app=new PostgresGameSessionApplication(
      authority,new PostgresDurableUnitOfWork(appPool),minimumRandomFactory,fixedNow,
    );
    const callerCreate:SessionCommandInput={
      engineContractVersion:M1_0_BASELINE_VERSIONS.engineContractVersion,
      commandId:randomUUID(),idempotencyKey:'caller-selected-create',gameId:provisionalGameId,
      expectedGameVersion:0,commandType:'CREATE_GAME',payloadSchemaVersion:M1_0_BASELINE_VERSIONS.fixtureSchemaVersion,
      payload:{scenarioDefinitionId:'BASE_2025',...M1_0_BASELINE_VERSIONS,turnLimit:10,preferredDiceMode:'DIGITAL'},
    };
    await expect(app.execute('m2a-session-f1',callerCreate)).resolves.toMatchObject({status:'REJECTED',resultCode:'NOT_AUTHORIZED'});
    const createInput={engineContractVersion:callerCreate.engineContractVersion,commandId:callerCreate.commandId,
      idempotencyKey:'application-create',expectedGameVersion:callerCreate.expectedGameVersion,
      payloadSchemaVersion:callerCreate.payloadSchemaVersion,payload:callerCreate.payload};
    const allocation=await app.createGame('m2a-session-f1',createInput);
    const {gameId}=allocation;
    const created=allocation.result;
    expect(gameId).not.toBe(provisionalGameId);
    expect((await pool.query<{version:number}>('SELECT uuid_extract_version($1::uuid)::int version',[gameId])).rows[0]?.version).toBe(7);
    expect(created).toMatchObject({status:'RESOLVED',resultCode:'GAME_CREATED',gameVersionBefore:0,gameVersionAfter:1});
    const joined=await app.execute('m2a-session-p1',{...callerCreate,gameId,commandId:randomUUID(),idempotencyKey:'application-join',
      expectedGameVersion:1,commandType:'JOIN_GAME_MEMBERSHIP',payload:{}});
    expect(joined).toMatchObject({status:'RESOLVED',resultCode:'PARTICIPANT_JOINED',gameVersionAfter:2});
    expect(await artifactCounts(pool,gameId)).toMatchObject({game_version:2,events:2,traces:2,idempotency:2,outbox:2});
    const projection=await app.getGameProjection('m2a-session-p1',gameId);
    expect(projection.ok).toBe(true);
  });

  it('M2A-R25/R30-C/D — campaign scheduler and M1 continuation commit real RNG only after PostgreSQL',async()=>{
    const fixture=await createRealM1ApplicationFixture();
    const {gameId}=fixture;
    const planning=(await fixture.unitOfWork.recover(gameId)).state as unknown as SetupGameState;
    await fixture.execute('session-p1','SET_ACTION_PLAN',{actionSlots:realCampaignSlots(planning)});
    await fixture.execute('session-p1','LOCK_ACTION_PLAN',{});
    for(const participantId of ['P2','P3','P4','P5']) {
      await fixture.execute(`session-${participantId.toLowerCase()}`,'SET_ACTION_PLAN',{actionSlots:[]});
      await fixture.execute(`session-${participantId.toLowerCase()}`,'LOCK_ACTION_PLAN',{});
    }
    await expect(persistRealSchedulerStep(fixture.app,gameId)).resolves.toMatchObject({
      result:{status:'RESOLVED',resultCode:'ACTION_SLOT_RESOLVED'},
    });
    const requested=await persistRealSchedulerStep(fixture.app,gameId);
    expect(requested.result).toMatchObject({status:'REQUIRES_CHOICE',resultCode:'NARRATIVE_REQUIRED'});
    const pending=requested.after.adjudication.pendingResolution;
    if(pending?.kind!=='NARRATIVE')throw new Error('M2A-R30 narrative continuation missing');

    const {audit,provider}=auditedRandomProvider((minimum)=>minimum);
    const clockAudit={cursor:0,checkpoints:0,restores:0,commits:0};
    const transactionalClock={
      checkpoint:()=>{clockAudit.checkpoints+=1;return clockAudit.cursor;},
      restore:(checkpoint:number)=>{clockAudit.restores+=1;clockAudit.cursor=checkpoint;},
      commit:()=>{clockAudit.commits+=1;},
      now:()=>{const value=new Date(1_767_225_600_000+clockAudit.cursor);clockAudit.cursor+=1;return value;},
    };
    const input={engineContractVersion:M1_0_BASELINE_VERSIONS.engineContractVersion,
      commandId:randomUUID(),idempotencyKey:`m2a-r30:${randomUUID()}`,gameId,
      expectedGameVersion:requested.after.version,commandType:'SUBMIT_CAMPAIGN_NARRATIVE' as const,
      payloadSchemaVersion:M1_0_BASELINE_VERSIONS.fixtureSchemaVersion,
      payload:{campaignId:pending.campaignId,narrative:'RNG durable confirmado después del commit.'},
      correlationId:'m2a-r30-real-continuation'};
    const before=await artifactCounts(pool,gameId);const notifications:string[]=[];
    const observe=()=>{expect(audit.commits).toBe(1);expect(clockAudit.commits).toBe(1);notifications.push('committed');};
    const casApplication=new PostgresGameSessionApplication(fixture.authority,
      new PostgresDurableUnitOfWork(appPool,{forceCasMiss:true,postCommitObserver:()=>{notifications.push('committed');}}),
      ()=>provider,fixedNow,()=>transactionalClock);
    await expect(casApplication.executeM1Interaction('session-p1',input)).resolves.toMatchObject({
      status:'REJECTED',resultCode:'STALE_STATE_VERSION',
    });
    expect(await artifactCounts(pool,gameId)).toEqual(before);
    expect({cursor:audit.cursor,restores:audit.restores,commits:audit.commits,notifications})
      .toEqual({cursor:0,restores:1,commits:0,notifications:[]});
    expect(clockAudit).toMatchObject({cursor:0,restores:1,commits:0});

    const exceptionApplication=new PostgresGameSessionApplication(fixture.authority,
      new PostgresDurableUnitOfWork(appPool,{faultAt:'event',postCommitObserver:()=>{notifications.push('committed');}}),
      ()=>provider,fixedNow,()=>transactionalClock);
    await expect(exceptionApplication.executeM1Interaction('session-p1',input))
      .rejects.toMatchObject({code:'TRANSACTION_WRITE_FAILED'});
    expect(await artifactCounts(pool,gameId)).toEqual(before);
    expect({cursor:audit.cursor,restores:audit.restores,commits:audit.commits,notifications})
      .toEqual({cursor:0,restores:2,commits:0,notifications:[]});
    expect(clockAudit).toMatchObject({cursor:0,restores:2,commits:0});

    const committedApplication=new PostgresGameSessionApplication(fixture.authority,
      new PostgresDurableUnitOfWork(appPool,{postCommitObserver:observe}),
      ()=>provider,fixedNow,()=>transactionalClock);
    const committed=await committedApplication.executeM1Interaction('session-p1',input);
    expect(committed.status).not.toBe('REJECTED');
    expect(audit.cursor).toBeGreaterThan(0);
    expect(clockAudit.cursor).toBeGreaterThan(0);
    expect(audit.calls.some(({minimum,maximum})=>minimum===1&&maximum===10)).toBe(true);
    expect({restores:audit.restores,commits:audit.commits,notifications})
      .toEqual({restores:2,commits:1,notifications:['committed']});
    const after=await artifactCounts(pool,gameId);
    expect(after.events).toBe((before.events??0)+1);expect(after.outbox).toBe((before.outbox??0)+1);
    const cursorAfterCommit=audit.cursor;const clockAfterCommit=clockAudit.cursor;
    expect(await committedApplication.executeM1Interaction('session-p1',input)).toEqual(committed);
    expect(await artifactCounts(pool,gameId)).toEqual(after);
    expect(audit.cursor).toBe(cursorAfterCommit);expect(clockAudit.cursor).toBe(clockAfterCommit);
    expect({commits:audit.commits,checkpoints:audit.checkpoints,notifications})
      .toEqual({commits:1,checkpoints:3,notifications:['committed']});
  },180_000);

  it('M2A-R30-B — Operations Deck shuffle restores on CAS/fault and commits once on durable success',async()=>{
    const {audit,provider}=auditedRandomProvider((minimum)=>minimum);
    const fixture=await createRealM1ApplicationFixture({randomFactory:()=>provider,stopAt:'AFTER_START'});
    const {gameId}=fixture;
    const state=(await fixture.unitOfWork.recover(gameId)).state as unknown as SetupGameState;
    const deck=[...STRATEGY_FIXTURE.operations_decks.ARDEN];
    await fixture.execute('session-p1','SUBMIT_OPERATIONS_DECK',{cardInstanceIds:deck});
    const input:SessionCommandInput={engineContractVersion:M1_0_BASELINE_VERSIONS.engineContractVersion,
      commandId:randomUUID(),idempotencyKey:`m2a-r30-deck:${randomUUID()}`,gameId,
      expectedGameVersion:fixture.version,commandType:'LOCK_STRATEGY',
      payloadSchemaVersion:M1_0_BASELINE_VERSIONS.fixtureSchemaVersion,payload:{}};
    const cursorBefore=audit.cursor;const commitsBefore=audit.commits;
    const artifactsBefore=await artifactCounts(pool,gameId);
    const casApp=new PostgresGameSessionApplication(fixture.authority,
      new PostgresDurableUnitOfWork(appPool,{forceCasMiss:true}),()=>provider,fixedNow);
    await expect(casApp.execute('session-p1',input)).resolves.toMatchObject({status:'REJECTED',resultCode:'STALE_STATE_VERSION'});
    expect(audit.cursor).toBe(cursorBefore);expect(audit.commits).toBe(commitsBefore);
    const faultApp=new PostgresGameSessionApplication(fixture.authority,
      new PostgresDurableUnitOfWork(appPool,{faultAt:'event'}),()=>provider,fixedNow);
    await expect(faultApp.execute('session-p1',input)).rejects.toMatchObject({code:'TRANSACTION_WRITE_FAILED'});
    expect(audit.cursor).toBe(cursorBefore);expect(await artifactCounts(pool,gameId)).toEqual(artifactsBefore);
    const successApp=new PostgresGameSessionApplication(fixture.authority,
      new PostgresDurableUnitOfWork(appPool),()=>provider,fixedNow);
    const committed=await successApp.execute('session-p1',input);
    expect(committed).toMatchObject({status:'RESOLVED',resultCode:'STRATEGY_LOCKED'});
    expect(audit.cursor-cursorBefore).toBe(29);expect(audit.commits).toBe(commitsBefore+1);
    const committedCursor=audit.cursor;
    expect(await successApp.execute('session-p1',input)).toEqual(committed);
    expect(audit.cursor).toBe(committedCursor);
    expect(state.phase).toBe('STRATEGY_STAGE');
  },180_000);

  it('M2A-R30-A/E — initiative RNG is isolated by a same-Game single-writer coordinator',async()=>{
    const initiative=[10,8,6,4,2];
    const {audit,provider}=auditedRandomProvider((minimum,maximum,index)=>
      minimum===1&&maximum===10?(initiative[index%initiative.length]??10):minimum);
    const fixture=await createRealM1ApplicationFixture({randomFactory:()=>provider,stopAt:'BEFORE_INITIATIVE'});
    const {gameId}=fixture;const cursorBefore=audit.cursor;const commitsBefore=audit.commits;
    const base={engineContractVersion:M1_0_BASELINE_VERSIONS.engineContractVersion,gameId,
      expectedGameVersion:fixture.version,commandType:'REQUEST_INITIATIVE_ROLL' as const,
      payloadSchemaVersion:M1_0_BASELINE_VERSIONS.fixtureSchemaVersion,payload:{}};
    const faultInput:SessionCommandInput={...base,commandId:randomUUID(),idempotencyKey:`m2a-r30-initiative-fault:${randomUUID()}`};
    const before=await artifactCounts(pool,gameId);
    const casApp=new PostgresGameSessionApplication(fixture.authority,
      new PostgresDurableUnitOfWork(appPool,{forceCasMiss:true}),()=>provider,fixedNow);
    await expect(casApp.execute('session-p1',faultInput)).resolves.toMatchObject({status:'REJECTED',resultCode:'STALE_STATE_VERSION'});
    const faultApp=new PostgresGameSessionApplication(fixture.authority,
      new PostgresDurableUnitOfWork(appPool,{faultAt:'event'}),()=>provider,fixedNow);
    await expect(faultApp.execute('session-p1',faultInput)).rejects.toMatchObject({code:'TRANSACTION_WRITE_FAILED'});
    expect(audit.cursor).toBe(cursorBefore);expect(audit.commits).toBe(commitsBefore);
    expect(await artifactCounts(pool,gameId)).toEqual(before);

    const app=new PostgresGameSessionApplication(fixture.authority,new PostgresDurableUnitOfWork(appPool),()=>provider,fixedNow);
    const first:SessionCommandInput={...base,commandId:randomUUID(),idempotencyKey:`m2a-r30-initiative-a:${randomUUID()}`};
    const second:SessionCommandInput={...base,commandId:randomUUID(),idempotencyKey:`m2a-r30-initiative-b:${randomUUID()}`};
    const results=await Promise.all([app.execute('session-p1',first),app.execute('session-p1',second)]);
    expect(results.filter(({status})=>status==='RESOLVED')).toHaveLength(1);
    expect(results.filter(({resultCode})=>resultCode==='STALE_STATE_VERSION')).toHaveLength(1);
    expect(audit.cursor-cursorBefore).toBe(5);expect(audit.commits).toBe(commitsBefore+1);
    const after=await artifactCounts(pool,gameId);
    expect(after.events).toBe((before.events??0)+1);expect(after.outbox).toBe((before.outbox??0)+1);
  },180_000);

  it('M2A-R30-F/G — Game A rollback cannot rewind Game B and replay creates no provider',async()=>{
    const fixtureA=await createRealM1ApplicationFixture({stopAt:'BEFORE_INITIATIVE'});
    const fixtureB=await createRealM1ApplicationFixture({stopAt:'BEFORE_INITIATIVE'});
    const bindingsA=trustedBindings(fixtureA.gameId).map(binding=>({
      ...binding,authenticatedSessionId:`a:${binding.authenticatedSessionId}`,
    }));
    const bindingsB=trustedBindings(fixtureB.gameId).map(binding=>({
      ...binding,authenticatedSessionId:`b:${binding.authenticatedSessionId}`,
    }));
    const authority=new InMemorySessionAuthority([...bindingsA,...bindingsB]);
    const failed=auditedRandomProvider((_minimum,maximum)=>maximum+1);
    const committed=auditedRandomProvider((minimum,maximum,index)=>
      minimum===1&&maximum===10?([10,8,6,4,2][index%5]??10):minimum);
    const app=new PostgresGameSessionApplication(authority,new PostgresDurableUnitOfWork(appPool),
      gameId=>gameId===fixtureA.gameId?failed.provider:committed.provider,fixedNow);
    const makeInput=(gameId:string,key:string):SessionCommandInput=>({
      engineContractVersion:M1_0_BASELINE_VERSIONS.engineContractVersion,commandId:randomUUID(),
      idempotencyKey:key,gameId,expectedGameVersion:gameId===fixtureA.gameId?fixtureA.version:fixtureB.version,
      commandType:'REQUEST_INITIATIVE_ROLL',payloadSchemaVersion:M1_0_BASELINE_VERSIONS.fixtureSchemaVersion,payload:{},
    });
    const inputA=makeInput(fixtureA.gameId,`m2a-r30-game-a:${randomUUID()}`);
    const inputB=makeInput(fixtureB.gameId,`m2a-r30-game-b:${randomUUID()}`);
    const beforeA=await artifactCounts(pool,fixtureA.gameId);const beforeB=await artifactCounts(pool,fixtureB.gameId);
    const [resultA,resultB]=await Promise.all([
      app.execute('a:session-p1',inputA),app.execute('b:session-p1',inputB),
    ]);
    expect(resultA).toMatchObject({status:'REJECTED',resultCode:'RANDOM_PROVIDER_FAILURE'});
    expect(resultB).toMatchObject({status:'RESOLVED',resultCode:'INITIATIVE_ORDER_SET'});
    expect(failed.audit.cursor).toBe(0);expect(failed.audit.restores).toBe(1);
    expect(committed.audit.cursor).toBe(5);expect(committed.audit.commits).toBe(1);
    expect(await artifactCounts(pool,fixtureA.gameId)).toEqual(beforeA);
    expect((await artifactCounts(pool,fixtureB.gameId)).events).toBe((beforeB.events??0)+1);

    let replayProviderCreations=0;
    const restarted=new PostgresGameSessionApplication(
      new InMemorySessionAuthority(bindingsB),new PostgresDurableUnitOfWork(appPool),
      ()=>{replayProviderCreations+=1;return auditedRandomProvider().provider;},fixedNow,
    );
    expect(await restarted.execute('b:session-p1',inputB)).toEqual(resultB);
    expect(replayProviderCreations).toBe(0);
    await expect(restarted.getGameProjection('b:session-p1',fixtureB.gameId)).resolves.toMatchObject({ok:true});
    expect(replayProviderCreations).toBe(0);
  },180_000);

  it('M2A-R20 — PostgreSQL adapter persists CREATE/JOIN/START and locked AP planning across restart',async()=>{
    const fixture=await createRealM1ApplicationFixture();
    const {gameId}=fixture;
    const planning=(await fixture.unitOfWork.recover(gameId)).state as unknown as SetupGameState;
    expect(planning.phase).toBe('ACTION_STAGE_PLAN');
    await fixture.execute('session-p1','SET_ACTION_PLAN',{actionSlots:realCampaignSlots(planning).slice(0,1)});
    await fixture.execute('session-p1','LOCK_ACTION_PLAN',{});
    const projectionsBefore=await Promise.all([
      fixture.app.getGameProjection('session-p1',gameId),
      fixture.app.getM1AdjudicationProjection('session-p2',gameId),
      fixture.app.getM1InitialSync('session-f1',gameId),
    ]);
    const freshPool=createPostgresPool(configForPrincipal(databaseConfig,appPrincipal));
    try {
      const restarted=new PostgresGameSessionApplication(
        new InMemorySessionAuthority(trustedBindings(gameId)),new PostgresDurableUnitOfWork(freshPool),
        scriptedRandomFactory([10,8,6,4,2,7]),fixedNow,
      );
      const projectionsAfter=await Promise.all([
        restarted.getGameProjection('session-p1',gameId),
        restarted.getM1AdjudicationProjection('session-p2',gameId),
        restarted.getM1InitialSync('session-f1',gameId),
      ]);
      expect(projectionsAfter).toEqual(projectionsBefore);
      const recovered=(await recoverDurableGame(freshPool,gameId)).state as unknown as SetupGameState;
      expect(recovered).toMatchObject({phase:'ACTION_STAGE_PLAN',overlay:'ACTIVE'});
      expect(recovered.actionPlanning.P1).toMatchObject({apAllocated:3,apAvailable:2,locked:true});
    } finally {await freshPool.end();}
    const durable=await pool.query<{allocated:number;spent:number;remaining:number;reason_type:string;trace_id:string|null}>(
      `SELECT b.allocated,b.spent,b.remaining,t.reason_type,t.adjudication_trace_id::text trace_id
         FROM malign.action_point_balances b JOIN malign.game_participants p ON p.id=b.participant_id
         JOIN malign.action_point_transactions t ON t.game_id=b.game_id AND t.turn_id=b.turn_id
           AND t.participant_id=b.participant_id
        WHERE b.game_id=$1 AND p.external_user_ref='user-p1' AND t.reason_type='PLAN_COMMIT'`,[gameId]);
    expect(durable.rows).toHaveLength(1);
    expect(durable.rows[0]).toMatchObject({allocated:3,spent:1,remaining:2,
      reason_type:'PLAN_COMMIT'});
    expect(durable.rows[0]?.trace_id).toMatch(/^[a-f0-9-]{36}$/u);
    expect(Number((await pool.query<{count:string}>(`SELECT count(*)::text count FROM malign.game_participants
      WHERE game_id=$1`,[gameId])).rows[0]?.count)).toBe(6);
    expect((await pool.query<{status:string}>('SELECT status FROM malign.games WHERE id=$1',[gameId])).rows[0]?.status).toBe('ACTIVE');
  },180_000);

  it('M2A-R21 — completeness guard rejects an adulterated M1 transition before every durable write',async()=>{
    const provisionalGameId=`provisional:${randomUUID()}`;
    const authority=new InMemorySessionAuthority(trustedBindings(provisionalGameId));
    const unitOfWork=new PostgresDurableUnitOfWork(appPool);
    const app=new PostgresGameSessionApplication(authority,unitOfWork,minimumRandomFactory,fixedNow);
    const commandId=randomUUID();
    const created=await app.createGame('session-f1',{engineContractVersion:M1_0_BASELINE_VERSIONS.engineContractVersion,
      commandId,idempotencyKey:`guard-create:${randomUUID()}`,expectedGameVersion:0,
      payloadSchemaVersion:M1_0_BASELINE_VERSIONS.fixtureSchemaVersion,
      payload:{scenarioDefinitionId:'BASE_2025',...M1_0_BASELINE_VERSIONS,turnLimit:10,preferredDiceMode:'DIGITAL'}});
    const {gameId}=created;
    const before=(await recoverDurableGame(appPool,gameId)).state as unknown as SetupGameState;
    const after=structuredClone(before);after.overlay='PAUSED';after.version+=1;
    const nextCommandId=randomUUID();
    const complete=buildDurableEngineTransition({gameId,commandType:'PAUSE_GAME',idempotencyKey:'adulterated',
      fingerprintSha256:fingerprint({pause:true}),actor:{actorId:'user-f1',actorType:'FACILITATOR',
        participantId:'F1',authenticatedSessionId:'session-f1'},beforeState:before,afterState:after,
      engineResult:{commandId:nextCommandId,gameId,status:'RESOLVED',gameVersionBefore:before.version,
        gameVersionAfter:after.version,resultCode:'GAME_PAUSED',emittedEventRefs:[],adjudicationTraceRefs:[],
        resolvedAt:fixedNow().toISOString()},
    });
    const adulterated={...complete,normalizedMutations:[]};
    expect(durableTransitionCompletenessFailures(adulterated)).toContain('normalizedMutations');
    const countsBefore=await artifactCounts(pool,gameId);
    await expect(unitOfWork.persistAcceptedTransition(adulterated)).rejects.toMatchObject({code:'ENGINE_TRANSITION_INCOMPLETE'});
    expect(await artifactCounts(pool,gameId)).toEqual(countsBefore);
  });

  it('M2A-R21/R22 — real M1 campaign adjudication persists narrative, RNG, ledgers and normalized artifacts',async()=>{
    const fixture=await createRealM1ApplicationFixture();
    const {gameId}=fixture;
    const planning=(await fixture.unitOfWork.recover(gameId)).state as unknown as SetupGameState;
    await fixture.execute('session-p1','SET_ACTION_PLAN',{actionSlots:realCampaignSlots(planning)});
    await fixture.execute('session-p1','LOCK_ACTION_PLAN',{});
    for(const participantId of ['P2','P3','P4','P5']) {
      await fixture.execute(`session-${participantId.toLowerCase()}`,'SET_ACTION_PLAN',{actionSlots:[]});
      await fixture.execute(`session-${participantId.toLowerCase()}`,'LOCK_ACTION_PLAN',{});
    }
    const constructed=await persistRealSchedulerStep(fixture.app,gameId);
    expect(constructed.result).toMatchObject({status:'RESOLVED',resultCode:'ACTION_SLOT_RESOLVED'});
    const requested=await persistRealSchedulerStep(fixture.app,gameId);
    expect(requested.result).toMatchObject({status:'REQUIRES_CHOICE',resultCode:'NARRATIVE_REQUIRED'});
    const pending=requested.after.adjudication.pendingResolution;
    if(pending?.kind!=='NARRATIVE')throw new Error('Real M1 narrative continuation missing');
    const completed=await fixture.app.executeM1Interaction('session-p1',{
      engineContractVersion:M1_0_BASELINE_VERSIONS.engineContractVersion,commandId:randomUUID(),
      idempotencyKey:`m2a-real:narrative:${randomUUID()}`,gameId,expectedGameVersion:requested.after.version,
      commandType:'SUBMIT_CAMPAIGN_NARRATIVE',payloadSchemaVersion:M1_0_BASELINE_VERSIONS.fixtureSchemaVersion,
      payload:{campaignId:pending.campaignId,narrative:'Una narrativa de integración durable.'},
      correlationId:'m2a-real-narrative',
    });
    expect(completed.status).not.toBe('REJECTED');
    await expect(reconcileDurableGame(appPool,gameId)).resolves.toBeUndefined();
    const evidence=(await pool.query<Record<string,string>>(`SELECT
      (SELECT count(*) FROM malign.campaign_activations WHERE game_id=$1)::text activations,
      (SELECT count(*) FROM malign.narrative_submissions WHERE game_id=$1)::text narratives,
      (SELECT count(*) FROM malign.die_rolls WHERE game_id=$1 AND source_type='CAMPAIGN_ERT')::text campaign_dice,
      (SELECT count(*) FROM malign.resource_transactions WHERE game_id=$1 AND reason_type='CAMPAIGN_ACTIVATION_COST')::text resource_costs,
      (SELECT count(*) FROM malign.influence_resolutions WHERE game_id=$1)::text influence_resolutions,
      (SELECT count(*) FROM malign.action_resolutions WHERE game_id=$1)::text resolutions,
      (SELECT count(*) FROM malign.adjudication_traces WHERE game_id=$1)::text traces,
      (SELECT count(*) FROM malign.pending_resolutions WHERE game_id=$1)::text continuations`,[gameId])).rows[0];
    expect(Number(evidence?.activations)).toBeGreaterThanOrEqual(1);
    expect(Number(evidence?.narratives)).toBe(1);
    expect(Number(evidence?.campaign_dice)).toBe(1);
    expect(Number(evidence?.resource_costs)).toBeGreaterThanOrEqual(1);
    expect(Number(evidence?.influence_resolutions)).toBeGreaterThanOrEqual(1);
    expect(Number(evidence?.resolutions)).toBeGreaterThanOrEqual(2);
    expect(Number(evidence?.traces)).toBeGreaterThan(0);
    expect(Number(evidence?.continuations)).toBe(1);
  },180_000);

  it('M2A-R22 — normalized phase divergence blocks recovery with nullable SYSTEM diagnostic provenance',async()=>{
    const {gameId}=await createRealM1ApplicationFixture();
    await pool.query(`UPDATE malign.phase_states SET phase_type='CORRUPTED_PHASE'
      WHERE id=(SELECT id FROM malign.phase_states WHERE game_id=$1 ORDER BY opened_at DESC NULLS LAST,id DESC LIMIT 1)`,[gameId]);
    const eventsBefore=(await artifactCounts(pool,gameId)).events;
    await expect(recoverDurableGame(appPool,gameId)).rejects.toMatchObject({code:'RECONCILIATION_MISMATCH'});
    expect((await artifactCounts(pool,gameId)).events).toBe(eventsBefore);
    expect((await pool.query<{participant_id:string|null;trace_type:string}>(`SELECT participant_id,trace_type
      FROM malign.adjudication_traces WHERE game_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`,[gameId])).rows[0])
      .toEqual({participant_id:null,trace_type:'RECONCILIATION_DIAGNOSTIC_SYSTEM'});
  },180_000);

  it('M2A-R28 — semantic continuation drift with a valid hash blocks recovery and deduplicates SYSTEM diagnostics',async()=>{
    const fixture=await createRealM1ApplicationFixture();const {gameId}=fixture;
    const planning=(await fixture.unitOfWork.recover(gameId)).state as unknown as SetupGameState;
    await fixture.execute('session-p1','SET_ACTION_PLAN',{actionSlots:realCampaignSlots(planning)});
    await fixture.execute('session-p1','LOCK_ACTION_PLAN',{});
    for(const participantId of ['P2','P3','P4','P5']) {
      await fixture.execute(`session-${participantId.toLowerCase()}`,'SET_ACTION_PLAN',{actionSlots:[]});
      await fixture.execute(`session-${participantId.toLowerCase()}`,'LOCK_ACTION_PLAN',{});
    }
    await persistRealSchedulerStep(fixture.app,gameId);
    await persistRealSchedulerStep(fixture.app,gameId);
    const continuation=(await pool.query<{state:Record<string,unknown>}>(`SELECT continuation_state_json state
      FROM malign.pending_resolutions WHERE game_id=$1 AND status='OPEN'`,[gameId])).rows[0]?.state;
    if(continuation===undefined)throw new Error('R28 continuation missing');
    const adulterated=structuredClone(continuation);
    const continuationState=adulterated['continuation'] as Record<string,unknown>;
    continuationState['resourceCost']=Number(continuationState['resourceCost'])+1;
    await pool.query(`UPDATE malign.pending_resolutions SET continuation_state_json=$2::jsonb,
      state_hash=decode($3,'hex') WHERE game_id=$1 AND status='OPEN'`,
    [gameId,JSON.stringify(adulterated),sha256CanonicalJson(adulterated)]);
    const before=(await pool.query<{game_version:string;hash:string;state:unknown;events:string}>(`SELECT
      game_version::text,encode(gameplay_state_hash,'hex') hash,authoritative_state_json state,
      (SELECT count(*)::text FROM malign.game_events WHERE game_id=$1) events FROM malign.games WHERE id=$1`,[gameId])).rows[0];
    await expect(recoverDurableGame(appPool,gameId)).rejects.toMatchObject({code:'RECONCILIATION_MISMATCH'});
    await expect(recoverDurableGame(appPool,gameId)).rejects.toMatchObject({code:'RECONCILIATION_MISMATCH'});
    const after=(await pool.query<{game_version:string;hash:string;state:unknown;events:string}>(`SELECT
      game_version::text,encode(gameplay_state_hash,'hex') hash,authoritative_state_json state,
      (SELECT count(*)::text FROM malign.game_events WHERE game_id=$1) events FROM malign.games WHERE id=$1`,[gameId])).rows[0];
    expect(after).toEqual(before);
    const diagnostics=await pool.query<{participant_id:string|null;rules:unknown;output:unknown}>(`SELECT participant_id,
      rule_evaluation_json rules,output_snapshot_json output FROM malign.adjudication_traces
      WHERE game_id=$1 AND trace_type='RECONCILIATION_DIAGNOSTIC_SYSTEM'`,[gameId]);
    expect(diagnostics.rows).toHaveLength(1);
    expect(diagnostics.rows[0]).toMatchObject({participant_id:null,
      rules:{actorType:'SYSTEM',visibility:'FACILITATOR_ONLY',createsGameplayEvent:false},
      output:{recoveryBlocked:true}});
  },180_000);

  it('M2A-R23 — independent 87-table manifest detects required nullability drift',async()=>{
    await pool.query('ALTER TABLE malign.action_point_transactions ALTER COLUMN adjudication_trace_id DROP NOT NULL');
    try {await expect(validateProductSchema(pool)).rejects.toMatchObject({code:'SCHEMA_MANIFEST_MISMATCH'});}
    finally {await pool.query('ALTER TABLE malign.action_point_transactions ALTER COLUMN adjudication_trace_id SET NOT NULL');}
    await expect(validateProductSchema(pool)).resolves.toBeUndefined();
    const manifest=JSON.parse(JSON.stringify(await readPhysicalCatalog(pool))) as {tables:unknown[]};
    expect(manifest.tables).toHaveLength(87);
  });

  it('M2A-R24 — ephemeral LOGIN principals expose exactly one product membership and reject administrative adapters',async()=>{
    const identities=await adminPool.query<{rolname:string;rolcanlogin:boolean;rolsuper:boolean;rolcreatedb:boolean;
      rolcreaterole:boolean;memberships:string[]}>(`SELECT r.rolname,r.rolcanlogin,r.rolsuper,r.rolcreatedb,r.rolcreaterole,
      ARRAY(SELECT granted.rolname::text FROM pg_auth_members m JOIN pg_roles granted ON granted.oid=m.roleid
        WHERE m.member=r.oid ORDER BY granted.rolname)::text[] memberships FROM pg_roles r
      WHERE r.rolname=ANY($1::text[]) ORDER BY r.rolname`,[[appPrincipal,migratorPrincipal,outboxPrincipal]]);
    expect(identities.rows).toHaveLength(3);
    expect(identities.rows.every(row=>row.rolcanlogin&&!row.rolsuper&&!row.rolcreatedb&&!row.rolcreaterole&&row.memberships.length===1)).toBe(true);
    const fixture=await createDurableGameFixture(pool,'Administrative adapter rejection');
    const prepared=await transitionFor(pool,fixture,{type:'VP_EFFECT',commandId:randomUUID(),reason:'CAMPAIGN',delta:1,floorZero:true},'admin-reject');
    await expect(new PostgresDurableUnitOfWork(adminDatabasePool)
      .persistM2AFutureFixtureTransition(prepared.transition)).rejects.toMatchObject({code:'RUNTIME_AUTHORITY_INVALID'});
    await expect(recoverDurableGame(adminDatabasePool,fixture.gameId)).rejects.toMatchObject({code:'RUNTIME_AUTHORITY_INVALID'});
    await expect(new PostgresOutboxPublisher(adminDatabasePool).claimOne(30_000,fixture.gameId))
      .rejects.toMatchObject({code:'RUNTIME_AUTHORITY_INVALID'});
    await expect(new PostgresDurableUnitOfWork(adminDatabasePool).allocateGameId())
      .rejects.toMatchObject({code:'RUNTIME_AUTHORITY_INVALID'});
    await expect(materializeRegistryForGame(adminDatabasePool,fixture.gameId,fixture.controllersByCountry))
      .rejects.toMatchObject({code:'RUNTIME_AUTHORITY_INVALID'});
    await expect(recordFacilitatorOverride(adminDatabasePool,{gameId:fixture.gameId,
      facilitatorParticipantId:fixture.actorParticipantId,targetCardInstanceId:randomUUID(),
      reason:'Administrative identity must fail closed',noncanonical:true}))
      .rejects.toMatchObject({code:'RUNTIME_AUTHORITY_INVALID'});
    await expect(appPool.query(`UPDATE malign.country_definitions SET mascot='FORBIDDEN' WHERE logical_id='ARDEN'`)).rejects.toBeDefined();
    await expect(outboxPool.query('SELECT authoritative_state_json FROM malign.games WHERE id=$1',[fixture.gameId])).rejects.toBeDefined();
  });

  it('M2A-R29 — multiple product memberships and cross-game sessions fail closed',async()=>{
    const principal=`malign_test_app_${randomUUID().replaceAll('-','').slice(0,10)}`;
    await createEphemeralLoginPrincipal(adminPool,principal,'malign_app_runtime',databaseName);
    await adminPool.query(`GRANT malign_outbox_publisher TO ${principal}`);
    const multiplePool=createPostgresPool(configForPrincipal(databaseConfig,principal));
    try {
      await expect(new PostgresDurableUnitOfWork(multiplePool).allocateGameId())
        .rejects.toMatchObject({code:'RUNTIME_AUTHORITY_INVALID'});
    } finally {
      await multiplePool.end();
      await adminPool.query(`REVOKE CONNECT ON DATABASE ${databaseName} FROM ${principal}`);
      await dropEphemeralLoginPrincipal(adminPool,principal);
    }
    const first=await createRealM1ApplicationFixture();
    const second=await createRealM1ApplicationFixture();
    await expect(first.app.getGameProjection('session-p1',second.gameId)).resolves.toMatchObject({
      ok:false,error:{code:'GAME_ID_MISMATCH'},
    });
  },180_000);

  it('M2A-R19 — real roles enforce minimum privilege while allowed UoW and publisher operations succeed',async()=>{
    const fixture=await createDurableGameFixture(pool,'Least privilege');
    const client=await appPool.connect();
    try {
      await client.query('BEGIN');await client.query('SET LOCAL ROLE malign_app_runtime');
      await expect(client.query('CREATE TABLE malign.forbidden_ddl(id int)')).rejects.toBeDefined();await client.query('ROLLBACK');
      await client.query('BEGIN');await client.query('SET LOCAL ROLE malign_app_runtime');
      await expect(client.query('DELETE FROM malign.games WHERE id=$1',[fixture.gameId])).rejects.toBeDefined();await client.query('ROLLBACK');
    } finally {client.release();}
    const publisherClient=await outboxPool.connect();
    try {await publisherClient.query('BEGIN');await publisherClient.query('SET LOCAL ROLE malign_outbox_publisher');
      await expect(publisherClient.query('SELECT authoritative_state_json FROM malign.games WHERE id=$1',[fixture.gameId])).rejects.toBeDefined();
      await publisherClient.query('ROLLBACK');} finally {publisherClient.release();}
    await persist(pool,fixture,{type:'VP_EFFECT',commandId:randomUUID(),reason:'CAMPAIGN',delta:1,floorZero:true},'least-privilege');
    expect(await new PostgresOutboxPublisher(outboxPool).claimOne(30_000,fixture.gameId)).toBeDefined();
    const publicAccess=await pool.query<{schema_access:boolean;table_access:boolean}>(`SELECT
      has_schema_privilege('public','malign','USAGE') schema_access,
      has_table_privilege('public','malign.games','SELECT') table_access`);
    expect(publicAccess.rows[0]).toEqual({schema_access:false,table_access:false});
  });
});

const fingerprintCanonical=(value:unknown):string=>{
  const canonical=(candidate:unknown):string=>{
    if(candidate===null||typeof candidate!=='object')return JSON.stringify(candidate);
    if(Array.isArray(candidate))return `[${candidate.map(canonical).join(',')}]`;
    return `{${Object.entries(candidate as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b))
      .map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  };
  return createHash('sha256').update(canonical(value)).digest('hex');
};
