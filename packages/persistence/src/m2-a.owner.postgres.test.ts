import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dispatchM2APersistenceFixture, type M2APersistenceFixtureCommand, type M2APersistenceFixtureOutcome, type M2APersistenceFixtureState } from '@malign-ai/game-engine';
import { M1_0_BASELINE_VERSIONS, type SetupGameState, type TransactionalRandomProvider } from '@malign-ai/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresGameSessionApplication, type SessionCommandInput } from '../../../apps/server/src/game-session-application.js';
import { InMemorySessionAuthority } from '../../authz/src/index.js';

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
  createDisposableDatabase,
  createDurableGameFixture,
  createM2AQueryMetrics,
  createPostgresPool,
  dropDisposableDatabase,
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
  recoverDurableGame,
  seedApprovedRegistry,
  validateMigrationManifest,
  validateProductSchema,
  type AcceptedEngineResult,
  type AcceptedEngineTransition,
  type DurableEffectBatch,
  type DurableGameFixture,
} from './index.js';

const adminConfig=postgresConfigFromEnvironment();
const databaseName=`malign_m2a_owner_${randomUUID().replaceAll('-','').slice(0,16)}`;
const databaseConfig=configForDatabase(adminConfig,databaseName);
const adminPool=createPostgresPool(adminConfig);
const pool=createPostgresPool(databaseConfig);
const fixedNow=()=>new Date('2026-01-01T00:00:00.000Z');
const fingerprint=(value:unknown):string=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

const applicationFixtureState = (gameId:string):SetupGameState => ({
  id:gameId,version:0,scenarioId:'BASE_2025',phase:'ACTION_STAGE_PLAN',overlay:'ACTIVE',
  versions:M1_0_BASELINE_VERSIONS,turnLimit:10,diceMode:'DIGITAL',baseApPerTurn:3,
  strategyDeckSize:30,starterCardsPerPlayer:5,handLimit:10,
  participants:{P1:{id:'P1',gameId,userId:'m2a-player-1',role:'PLAYER',status:'ACTIVE'}},
  seats:{P1:{id:'seat-p1',gameId,participantId:'P1',seatIndex:0,clockwiseIndex:0,countryId:'ARDEN'}},
  countries:{
    ARDEN:{id:'ARDEN',controllerParticipantId:'P1',resources:2,turnIncome:2},
    FLUMA:{id:'FLUMA',resources:2,turnIncome:1},URSARIA:{id:'URSARIA',resources:3,turnIncome:2},
    PRESQUE:{id:'PRESQUE',resources:3,turnIncome:2},DINESIA:{id:'DINESIA',resources:4,turnIncome:3},
  },populationDemographics:{},cardDefinitions:{},cards:{},strategy:{},
  initiative:{status:'COMPLETE',rolls:[],orderParticipantIds:['P1'],maintenance:{}},
  actionPlanning:{P1:{participantId:'P1',apAllocated:3,apAvailable:3,draftSlots:[],lockedSlots:[],locked:false}},
  resourceLedger:[],actionPointLedger:[],secretVictoryObjectives:{},
  adjudication:{} as SetupGameState['adjudication'],events:[],
});

const minimumRandomFactory = ():TransactionalRandomProvider => ({
  checkpoint:()=>({cursor:0}),restore:()=>undefined,commit:()=>undefined,
  integer:(minimum:number)=>minimum,
});

const fixtureState=async (targetPool:typeof pool,fixture:DurableGameFixture):Promise<M2APersistenceFixtureState> =>
  (await recoverDurableGame(targetPool,fixture.gameId)).state as M2APersistenceFixtureState;

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
  options:Partial<AcceptedEngineTransition>={},
):Promise<{transition:AcceptedEngineTransition;outcome:M2APersistenceFixtureOutcome}> => {
  const before=await fixtureState(targetPool,fixture);
  const outcome=dispatchM2APersistenceFixture(before,command,fixedNow);
  if (outcome.result.status!=='RESOLVED') throw new Error(`Fixture command rejected: ${outcome.result.resultCode}`);
  return {outcome,transition:{gameId:fixture.gameId,actorId:fixture.externalUserRefsByParticipant[fixture.actorParticipantId]??'m2a-player-1',
    actorParticipantId:fixture.actorParticipantId,commandType:command.type,idempotencyKey:key,
    fingerprintSha256:fingerprint(command),beforeState:outcome.before,afterState:outcome.after,
    engineResult:outcome.result as AcceptedEngineResult,effects:effectsFor(fixture,outcome),...options}};
};

const persist = async (
  targetPool:typeof pool,fixture:DurableGameFixture,command:M2APersistenceFixtureCommand,key:string,
  options:Partial<AcceptedEngineTransition>={},
) => {
  const prepared=await transitionFor(targetPool,fixture,command,key,options);
  const result=await new PostgresDurableUnitOfWork(targetPool).persistAcceptedTransition(prepared.transition);
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
  await migratePostgres(pool,{applicationBuild:'m2-a-r11-r19'});
},120_000);

afterAll(async()=>{await pool.end();await dropDisposableDatabase(adminPool,databaseName);await adminPool.end();});

describe('M2-A PostgreSQL 18.6 corrected owner gate',()=>{
  it('GE-M2-DB-001 — full physical catalog manifest rejects extra column, constraint, index and authority',async()=>{
    await expect(validateMigrationManifest()).resolves.toHaveLength(5);
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
    expect(audit).toHaveLength(5);
    expect(audit.map(({version,currentUser})=>[version,currentUser])).toEqual([
      [1,'malign_migration_owner'],[2,'malign_migration_owner'],[3,audit[2]?.sessionUser],
      [4,'malign_migration_owner'],[5,'malign_migration_owner'],
    ]);
    const roles=await pool.query<{rolname:string;rolcanlogin:boolean;rolsuper:boolean}>(
      `SELECT rolname,rolcanlogin,rolsuper FROM pg_roles WHERE rolname LIKE 'malign_%' ORDER BY rolname`);
    expect(roles.rows.every(row=>!row.rolcanlogin&&!row.rolsuper)).toBe(true);
  });

  it('GE-M2-DB-002 — administrative bootstrap and migration ledger are repeatable and checksummed',async()=>{
    const bootstrap=await bootstrapPostgresClusterRoles(pool);
    expect(bootstrap.currentUser).toBe(bootstrap.sessionUser);
    await expect(migratePostgres(pool,{applicationBuild:'repeat'})).resolves.toEqual([]);
    const ledger=await pool.query<{version:number;checksum:string}>(
      'SELECT version,checksum FROM malign_meta.schema_migrations ORDER BY version');
    expect(ledger.rows).toHaveLength(5);
    expect(ledger.rows.every(row=>/^[a-f0-9]{64}$/.test(row.checksum))).toBe(true);
  });

  it('GE-M2-DB-003 — N-1 upgrade preserves complete durable evidence',async()=>{
    const name=`malign_m2a_n1_${randomUUID().replaceAll('-','').slice(0,12)}`;
    await createDisposableDatabase(adminPool,name);
    const n1=createPostgresPool(configForDatabase(adminConfig,name));
    try {
      await migratePostgres(n1,{targetVersion:4,applicationBuild:'n-1'});
      const fixture=await createDurableGameFixture(n1,'N-1 evidence');
      await persist(n1,fixture,{type:'RESOURCE_EFFECT',commandId:randomUUID(),reason:'TURN_INCOME',delta:2},'n1-income');
      const before=await captureDurableEvidence(n1,fixture.gameId,state=>({id:state['id'],version:state['version']}));
      await migratePostgres(n1,{applicationBuild:'n'});
      const after=await captureDurableEvidence(n1,fixture.gameId,state=>({id:state['id'],version:state['version']}));
      expect(after).toEqual(before);
    } finally {await n1.end();await dropDisposableDatabase(adminPool,name);}
  },120_000);

  it('GE-M2-DB-004 — five physical invariant families fail typed and roll back',async()=>{
    const fixture=await createDurableGameFixture(pool,'Constraint matrix');
    await materializeRegistryForGame(pool,fixture.gameId,fixture.controllersByCountry);
    const card=await pool.query<{id:string}>(`SELECT id FROM malign.card_instances WHERE game_id=$1 AND zone='HAND' LIMIT 1`,[fixture.gameId]);
    const other=await createDurableGameFixture(pool,'Cross-game ref');
    const before=await artifactCounts(pool,fixture.gameId);
    const errors=[];
    errors.push(await probeConstraintViolation(pool,
      `INSERT INTO malign.deck_card_positions(game_id,participant_id,card_instance_id,position,shuffle_revision)
       VALUES ($1,$2,$3,1,1)`,[fixture.gameId,fixture.actorParticipantId,card.rows[0]?.id]));
    errors.push(await probeConstraintViolation(pool,
      `INSERT INTO malign.action_point_transactions(game_id,game_event_sequence,artifact_ordinal,turn_id,
       participant_id,sequence_number,delta,reason_type,correlation_id,balance_after)
       VALUES ($1,1,1,$2,$3,1,1,'DUPLICATE',uuidv7(),4)`,[fixture.gameId,fixture.turnId,fixture.actorParticipantId]));
    errors.push(await probeConstraintViolation(pool,
      `UPDATE malign.game_countries SET current_resources_cache=-1 WHERE game_id=$1`,[fixture.gameId]));
    errors.push(await probeConstraintViolation(pool,
      `INSERT INTO malign.card_instances(game_id,country_owner_definition_id,serial_template_id,card_definition_id,
       current_controller_participant_id,zone) VALUES ($1,uuidv7(),uuidv7(),uuidv7(),$2,'HAND')`,
      [fixture.gameId,fixture.actorParticipantId]));
    errors.push(await probeConstraintViolation(pool,
      `INSERT INTO malign.resource_transactions(game_id,game_event_sequence,artifact_ordinal,turn_id,
       participant_id,delta,reason_type,balance_after) VALUES ($1,99,1,$2,$3,1,'CROSS_GAME',1)`,
      [fixture.gameId,fixture.turnId,other.actorParticipantId]));
    expect(errors.map(error=>error.code)).toEqual(['SINGLE_ZONE_VIOLATION','ORDERING_CONSTRAINT_VIOLATION',
      'NEGATIVE_BALANCE','REFERENCE_CONSTRAINT_VIOLATION','CROSS_GAME_REFERENCE']);
    expect(await artifactCounts(pool,fixture.gameId)).toEqual(before);
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
    expect(await materializeRegistryForGame(pool,fixture.gameId,fixture.controllersByCountry)).toEqual({cards:540,starters:25});
    expect(await materializeRegistryForGame(pool,fixture.gameId,fixture.controllersByCountry)).toEqual({cards:540,starters:25});
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
    const before=await captureDurableEvidence(pool,fixture.gameId,state=>({id:state['id'],version:state['version']}));
    const dir=mkdtempSync(join(tmpdir(),'malign-m2a-backup-'));const dump=join(dir,'database.dump');
    const restoreName=`malign_m2a_restore_${randomUUID().replaceAll('-','').slice(0,12)}`;
    try {
      execFileSync('pg_dump',['--format=custom','--file',dump,databaseName],{env:{...process.env}});
      await createDisposableDatabase(adminPool,restoreName);
      execFileSync('pg_restore',['--dbname',restoreName,'--exit-on-error',dump],{env:{...process.env}});
      const restored=createPostgresPool(configForDatabase(adminConfig,restoreName));
      try {await validateProductSchema(restored);expect(await captureDurableEvidence(restored,fixture.gameId,
        state=>({id:state['id'],version:state['version']}))).toEqual(before);} finally {await restored.end();}
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
    expect(row).toEqual({cubes:41,vp:101});await expect(reconcileDurableGame(pool,fixture.gameId)).resolves.toBeUndefined();
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
    await expect(reconcileDurableGame(pool,fixture.gameId)).resolves.toBeUndefined();
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
    await expect(reconcileDurableGame(pool,fixture.gameId)).resolves.toBeUndefined();
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
    const fresh=createPostgresPool(databaseConfig);
    try {const recovered=await recoverDurableGame(fresh,fixture.gameId);expect(recovered.snapshotVersion).toBe(1);
      expect(recovered.eventTail).toHaveLength(2);expect(recovered.stateHash).toBe(fingerprintCanonical(recovered.state));
      expect(recovered.gameVersion).toBe(3);} finally {await fresh.end();}
  });

  it('GE-FAC-002 — facilitator override records reason, refs and noncanonical state',async()=>{
    const fixture=await createDurableGameFixture(pool,'Facilitator override');
    await materializeRegistryForGame(pool,fixture.gameId,fixture.controllersByCountry);
    await pool.query("UPDATE malign.game_participants SET role='FACILITATOR' WHERE id=$1",[fixture.actorParticipantId]);
    const card=(await pool.query<{id:string}>('SELECT id FROM malign.card_instances WHERE game_id=$1 LIMIT 1',[fixture.gameId])).rows[0]?.id??'';
    const {recordFacilitatorOverride}=await import('./recovery.js');
    const id=await recordFacilitatorOverride(pool,{gameId:fixture.gameId,facilitatorParticipantId:fixture.actorParticipantId,
      targetCardInstanceId:card,reason:'Audited correction',noncanonical:true});
    expect((await pool.query<{rationale:string;noncanonical:boolean}>(`SELECT d.rationale,g.noncanonical FROM malign.facilitator_decisions d
      JOIN malign.games g ON g.id=d.game_id WHERE d.id=$1`,[id])).rows[0]).toEqual({rationale:'Audited correction',noncanonical:true});
    const recovered=await recoverDurableGame(pool,fixture.gameId);
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
    const result=await new PostgresDurableUnitOfWork(pool).persistAcceptedTransition({...prepared.transition,effects,
      continuation:{sourceResolutionId:fixture.actionResolutionId,waitingInteractionId:randomUUID(),type:'CHOICE',state:{step:1}}});
    expect(result).toMatchObject({gameVersion:1,eventSequence:2,outboxSequence:1,currentUser:'malign_app_runtime'});
    await expect(reconcileDurableGame(pool,fixture.gameId)).resolves.toBeUndefined();
    const metrics=createM2AQueryMetrics();
    const params:Record<string,readonly unknown[]>={aggregate_load:[fixture.gameId],authorized_projection_load:[fixture.gameId,0,100],
      replay_page:[fixture.gameId,0,100],pending_dashboard:[fixture.gameId,100],outbox_claim:[],registry_pin_lookup:[fixture.gameId]};
    for (const budget of M2A_QUERY_BUDGETS) expect((await executeWithinQueryBudget(pool,budget.name,params[budget.name]??[],metrics)).withinBudget).toBe(true);
    const plans=await captureCriticalExplainPlans(pool,fixture.gameId);assertCriticalExplainPlansUseIndexes(plans);
    expect(metrics.replayPages).toBe(1);expect(metrics.historyRowsObserved).toBeGreaterThan(0);
  });

  it('GE-M2-TX-002 — every write-boundary fault rolls back artifacts and provider cursors',async()=>{
    for (const boundary of M2A_WRITE_BOUNDARIES) {
      const fixture=await createDurableGameFixture(pool,`Fault ${boundary}`);
      const prepared=await transitionFor(pool,fixture,{type:'APPLY_COMPONENT_EFFECT',commandId:randomUUID(),influenceDelta:1,victoryPointDelta:1},`fault-${boundary}`);
      const rng=new TransactionalSequence([7]);const clock=new TransactionalSequence([fixedNow()]);
      const before=await artifactCounts(pool,fixture.gameId);
      await expect(new PostgresDurableUnitOfWork(pool,{rng,clock}).persistAcceptedTransition({...prepared.transition,
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
    const outcomes=await Promise.allSettled([new PostgresDurableUnitOfWork(pool).persistAcceptedTransition(a.transition),
      new PostgresDurableUnitOfWork(pool).persistAcceptedTransition(b.transition)]);
    expect(outcomes.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    expect(outcomes.find(result=>result.status==='rejected')?.status==='rejected'?
      (outcomes.find(result=>result.status==='rejected') as PromiseRejectedResult).reason:undefined).toMatchObject({code:'GAME_VERSION_CONFLICT'});
    expect(await artifactCounts(pool,fixture.gameId)).toMatchObject({game_version:1,idempotency:1,outbox:1});
  });

  it('GE-M2-TX-004 — retry from a new adapter returns the durable Engine result exactly once',async()=>{
    const fixture=await createDurableGameFixture(pool,'Idempotency retry');
    const prepared=await transitionFor(pool,fixture,{type:'VP_EFFECT',commandId:randomUUID(),reason:'CAMPAIGN',delta:1,floorZero:true},'retry');
    const original=await new PostgresDurableUnitOfWork(pool).persistAcceptedTransition(prepared.transition);
    const fresh=createPostgresPool(databaseConfig);
    try {expect(await new PostgresDurableUnitOfWork(fresh).persistAcceptedTransition(prepared.transition)).toEqual(original);} finally {await fresh.end();}
    expect(await artifactCounts(pool,fixture.gameId)).toMatchObject({game_version:1,idempotency:1,outbox:1});
  });

  it('GE-M2-TX-005 — fingerprint conflict fails without leakage or mutation',async()=>{
    const fixture=await createDurableGameFixture(pool,'Idempotency conflict');
    const prepared=await transitionFor(pool,fixture,{type:'VP_EFFECT',commandId:randomUUID(),reason:'CAMPAIGN',delta:1,floorZero:true},'same-key');
    await new PostgresDurableUnitOfWork(pool).persistAcceptedTransition(prepared.transition);
    const before=await artifactCounts(pool,fixture.gameId);
    await expect(new PostgresDurableUnitOfWork(pool).persistAcceptedTransition({...prepared.transition,
      fingerprintSha256:fingerprint('different')})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
    expect(await artifactCounts(pool,fixture.gameId)).toEqual(before);
  });

  it('GE-M2-TX-006 — outbox is invisible on rollback and visible only with gameplay commit',async()=>{
    const fixture=await createDurableGameFixture(pool,'Outbox visibility');
    const prepared=await transitionFor(pool,fixture,{type:'VP_EFFECT',commandId:randomUUID(),reason:'CAMPAIGN',delta:1,floorZero:true},'outbox-rollback');
    await expect(new PostgresDurableUnitOfWork(pool).persistAcceptedTransition({...prepared.transition,faultAt:'delivery_state'})).rejects.toBeDefined();
    expect((await artifactCounts(pool,fixture.gameId)).outbox).toBe(0);
    await new PostgresDurableUnitOfWork(pool).persistAcceptedTransition(prepared.transition);
    expect(await new PostgresOutboxPublisher(pool).claimOne(30_000,fixture.gameId)).toMatchObject({outboxSequence:1});
  });

  it('GE-M2-TX-007 — two publishers preserve per-game order through lease, retry, ACK and dedup',async()=>{
    const fixture=await createDurableGameFixture(pool,'Ordered outbox');
    await persist(pool,fixture,{type:'VP_EFFECT',commandId:randomUUID(),reason:'CAMPAIGN',delta:1,floorZero:true},'outbox-1');
    await persist(pool,fixture,{type:'VP_EFFECT',commandId:randomUUID(),reason:'OBJECTIVE',delta:1,floorZero:true},'outbox-2');
    const firstPublisher=new PostgresOutboxPublisher(pool);const secondPublisher=new PostgresOutboxPublisher(pool);
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
    const fresh=createPostgresPool(databaseConfig);try {const recovered=await recoverDurableGame(fresh,fixture.gameId);
      expect(recovered.eventTail).toHaveLength(2);expect(recovered.continuation).toEqual({choice:'OPEN'});
      expect(recovered.currentUser).toBe('malign_app_runtime');} finally {await fresh.end();}
  });

  it('M2A-R12 — replay rejects gaps, duplicate ordering, unknown schemas, bad hashes and invalid continuations',async()=>{
    const duplicateFixture=await createDurableGameFixture(pool,'Replay duplicate ordering');
    await persist(pool,duplicateFixture,{type:'VP_EFFECT',commandId:randomUUID(),reason:'CAMPAIGN',delta:1,floorZero:true},'replay-duplicate');
    await expect(probeConstraintViolation(pool,`INSERT INTO malign.game_events(
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
      await expect(recoverDurableGame(pool,fixture.gameId)).rejects.toMatchObject({code:'RECONCILIATION_MISMATCH'});
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
      await expect(reconcileDurableGame(pool,fixture.gameId)).rejects.toMatchObject({code:'RECONCILIATION_MISMATCH'});
      expect((await pool.query<{recovery_blocked:boolean}>('SELECT recovery_blocked FROM malign.games WHERE id=$1',[fixture.gameId])).rows[0]?.recovery_blocked).toBe(true);
      expect((await artifactCounts(pool,fixture.gameId)).events).toBe(eventsBefore);
      expect(Number((await pool.query<{count:string}>(`SELECT count(*)::text count FROM malign.facilitator_decisions
        WHERE game_id=$1 AND decision_type='RECONCILIATION_DIAGNOSTIC'`,[fixture.gameId])).rows[0]?.count)).toBe(1);
    }
  },180_000);

  it('M2A-R11 — authenticated application executes Engine once and persists only accepted PostgreSQL transitions',async()=>{
    const fixture=await createDurableGameFixture(pool,'Application to Engine to PostgreSQL',({gameId})=>
      applicationFixtureState(gameId) as unknown as Readonly<Record<string,unknown>>);
    const authority=new InMemorySessionAuthority([{
      authenticatedSessionId:'m2a-session-p1',userId:'m2a-player-1',gameId:fixture.gameId,
      participantId:'P1',role:'PLAYER',
    }]);
    authority.materializeMembership('m2a-session-p1',fixture.gameId,'P1');
    const app=new PostgresGameSessionApplication(
      authority,new PostgresDurableUnitOfWork(pool),minimumRandomFactory,fixedNow,
    );
    const accepted:SessionCommandInput={
      engineContractVersion:M1_0_BASELINE_VERSIONS.engineContractVersion,
      commandId:randomUUID(),idempotencyKey:'application-accepted',gameId:fixture.gameId,
      expectedGameVersion:0,commandType:'SET_ACTION_PLAN',
      payloadSchemaVersion:M1_0_BASELINE_VERSIONS.fixtureSchemaVersion,payload:{actionSlots:[]},
    };
    const first=await app.execute('m2a-session-p1',accepted);
    expect(first).toMatchObject({status:'RESOLVED',resultCode:'ACTION_PLAN_SAVED',gameVersionBefore:0,gameVersionAfter:1});
    const committed=await artifactCounts(pool,fixture.gameId);
    expect(committed).toMatchObject({game_version:1,events:2,traces:1,idempotency:1,outbox:1});
    expect(await app.execute('m2a-session-p1',accepted)).toEqual(first);
    expect(await artifactCounts(pool,fixture.gameId)).toEqual(committed);

    const rejectedInputs:readonly [string,SessionCommandInput,string][]=[
      ['stale',{...accepted,commandId:randomUUID(),idempotencyKey:'application-stale'},'STALE_STATE_VERSION'],
      ['spoof',{...accepted,commandId:randomUUID(),idempotencyKey:'application-spoof',expectedGameVersion:1,
        payload:{actionSlots:[],actorId:'caller-controlled'} as never},'INVALID_ACTOR_CONTEXT'],
      ['wrong-phase',{...accepted,commandId:randomUUID(),idempotencyKey:'application-wrong-phase',expectedGameVersion:1,
        commandType:'SUBMIT_OPERATIONS_DECK',payload:{cardInstanceIds:[]}},'WRONG_PHASE'],
      ['cross-game',{...accepted,commandId:randomUUID(),idempotencyKey:'application-cross-game',gameId:randomUUID()},'GAME_ID_MISMATCH'],
    ];
    for (const [,input,code] of rejectedInputs) {
      expect(await app.execute('m2a-session-p1',input)).toMatchObject({status:'REJECTED',resultCode:code});
      expect(await artifactCounts(pool,fixture.gameId)).toEqual(committed);
    }
    const projection=await app.getGameProjection('m2a-session-p1',fixture.gameId);
    expect(projection.ok).toBe(true);
  });

  it('M2A-R19 — real roles enforce minimum privilege while allowed UoW and publisher operations succeed',async()=>{
    const fixture=await createDurableGameFixture(pool,'Least privilege');
    const client=await pool.connect();
    try {
      await client.query('BEGIN');await client.query('SET LOCAL ROLE malign_app_runtime');
      await expect(client.query('CREATE TABLE malign.forbidden_ddl(id int)')).rejects.toBeDefined();await client.query('ROLLBACK');
      await client.query('BEGIN');await client.query('SET LOCAL ROLE malign_app_runtime');
      await expect(client.query('DELETE FROM malign.games WHERE id=$1',[fixture.gameId])).rejects.toBeDefined();await client.query('ROLLBACK');
      await client.query('BEGIN');await client.query('SET LOCAL ROLE malign_outbox_publisher');
      await expect(client.query('SELECT authoritative_state_json FROM malign.games WHERE id=$1',[fixture.gameId])).rejects.toBeDefined();await client.query('ROLLBACK');
    } finally {client.release();}
    await persist(pool,fixture,{type:'VP_EFFECT',commandId:randomUUID(),reason:'CAMPAIGN',delta:1,floorZero:true},'least-privilege');
    expect(await new PostgresOutboxPublisher(pool).claimOne(30_000,fixture.gameId)).toBeDefined();
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
