import { randomUUID } from 'node:crypto';

import { sha256CanonicalJson } from '@malign-ai/shared';
import type { Pool } from 'pg';

import { seedApprovedRegistry } from './registry-seed.js';

export interface DurableGameFixture {
  readonly gameId: string;
  readonly actorParticipantId: string;
  readonly participantIds: readonly string[];
  readonly externalUserRefsByParticipant: Readonly<Record<string, string>>;
  readonly controllersByCountry: Readonly<Record<string, string>>;
  readonly countryDefinitionIds: Readonly<Record<string, string>>;
  readonly turnId: string;
  readonly pdStateId: string;
  readonly influenceStackId: string;
  readonly actionResolutionId: string;
  readonly rulesetVersionId: string;
  readonly registryVersionId: string;
  readonly engineContractVersionId: string;
  readonly scenarioDefinitionId: string;
  readonly ertDefinitionId: string;
}

export interface DurableFixtureStateContext {
  readonly gameId:string;
  readonly participantIds:readonly string[];
  readonly externalUserRefsByParticipant:Readonly<Record<string,string>>;
  readonly controllersByCountry:Readonly<Record<string,string>>;
}

export const createDurableGameFixture = async (
  pool: Pool,
  name = 'M2-A durable fixture',
  initialStateFactory?: (context:DurableFixtureStateContext)=>Readonly<Record<string,unknown>>,
): Promise<DurableGameFixture> => {
  const seeded = await seedApprovedRegistry(pool);
  const fixtureKey = randomUUID().replaceAll('-', '').slice(0, 16);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE malign_migration_owner');
    const firstCountry = await client.query<{ id: string }>(
      `SELECT id FROM malign.country_definitions WHERE version='0.1' ORDER BY logical_id LIMIT 1`,
    );
    const countryId = firstCountry.rows[0]?.id;
    if (!countryId) throw new Error('Seeded country missing');
    const ert = await client.query<{ id: string }>(
      `INSERT INTO malign.ert_definitions(logical_id,name,ruleset_version_id,status)
       VALUES ('ERT_BASE','ERT BASE',$1,'ACTIVE')
       ON CONFLICT (logical_id,ruleset_version_id) DO UPDATE SET logical_id=EXCLUDED.logical_id RETURNING id`,
      [seeded.rulesetVersionId],
    );
    const ertId = ert.rows[0]?.id;
    if (!ertId) throw new Error('ERT identity missing');
    const scenario = await client.query<{ id: string }>(
      `INSERT INTO malign.scenario_definitions(
         logical_id,canonical_name,scenario_version,narrative,default_turn_limit,
         ruleset_version_id,card_registry_version_id,status,source_reference
       ) VALUES ($3,$4,'0.1','Durable integration fixture',10,$1,$2,'ACTIVE','DEC-078')
       RETURNING id`,
      [seeded.rulesetVersionId, seeded.registryVersionId, `M2A_SCENARIO_${fixtureKey}`, `M2-A Scenario ${fixtureKey}`],
    );
    const scenarioId = scenario.rows[0]?.id;
    if (!scenarioId) throw new Error('Scenario identity missing');
    const gameIdentity = await client.query<{ id: string }>('SELECT uuidv7() id');
    const gameId = gameIdentity.rows[0]?.id;
    if (!gameId) throw new Error('Game identity missing');
    const initialState = {
      id: gameId,
      version: 0,
      phase: 'ACTION_STAGE_PLAN',
      rngCursor: 0,
      clockCursor: 0,
      targets: ['TARGET-1'],
      plannedTargetId: 'TARGET-1',
      influenceCount: 0,
      victoryPoints: 0,
      resources: 2,
    };
    await client.query(
      `INSERT INTO malign.games(
         id,name,status,ruleset_version_id,scenario_definition_id,card_registry_version_id,
         engine_contract_version_id,ert_definition_id,dice_mode,game_version,event_sequence_head,
         authoritative_state_json,gameplay_state_hash
       ) VALUES ($1,$2,'ACTIVE',$3,$4,$5,$6,$7,'DETERMINISTIC',0,1,$8::jsonb,decode($9,'hex'))`,
      [
        gameId,
        name,
        seeded.rulesetVersionId,
        scenarioId,
        seeded.registryVersionId,
        seeded.engineContractVersionId,
        ertId,
        JSON.stringify(initialState),
        sha256CanonicalJson(initialState),
      ],
    );
    const countries = await client.query<{ id: string; logical_id: string }>(
      `SELECT id,logical_id FROM malign.country_definitions WHERE version='0.1' ORDER BY logical_id`,
    );
    const participantIds: string[] = [];
    const externalUserRefsByParticipant: Record<string, string> = {};
    const controllersByCountry: Record<string, string> = {};
    const countryDefinitionIds: Record<string, string> = {};
    for (const [index, country] of countries.rows.entries()) {
      const participant = await client.query<{ id: string }>(
        `INSERT INTO malign.game_participants(game_id,external_user_ref,role,status,joined_at)
         VALUES ($1,$2,'PLAYER','ACTIVE',clock_timestamp()) RETURNING id`,
        [gameId, `m2a-player-${index + 1}`],
      );
      const participantId = participant.rows[0]?.id;
      if (!participantId) throw new Error('Participant identity missing');
      participantIds.push(participantId);
      externalUserRefsByParticipant[participantId] = `m2a-player-${index + 1}`;
      controllersByCountry[country.logical_id] = participantId;
      countryDefinitionIds[country.logical_id] = country.id;
      await client.query(
        `INSERT INTO malign.player_seats(game_id,participant_id,seat_index,clockwise_index,country_definition_id)
         VALUES ($1,$2,$3,$3,$4)`,
        [gameId, participantId, index, country.id],
      );
      await client.query(
        `INSERT INTO malign.game_countries(
           game_id,country_definition_id,controlling_participant_id,current_resources_cache
         ) SELECT $1,id,$3,starting_resource_default FROM malign.country_definitions WHERE id=$2`,
        [gameId, country.id, participantId],
      );
    }
    const actorId = participantIds[0];
    if (!actorId) throw new Error('Actor identity missing');
    const turn = await client.query<{ id: string }>(
      `INSERT INTO malign.turns(game_id,number,status,started_at) VALUES ($1,1,'ACTIVE',clock_timestamp()) RETURNING id`,
      [gameId],
    );
    const turnId = turn.rows[0]?.id;
    if (!turnId) throw new Error('Turn identity missing');
    for (const [index, participantId] of participantIds.entries()) {
      await client.query(
        `INSERT INTO malign.action_point_balances(
           game_id,turn_id,participant_id,allocated,spent,remaining,last_transaction_sequence
         ) VALUES ($1,$2,$3,3,0,3,1)`,
        [gameId, turnId, participantId],
      );
      await client.query(
        `INSERT INTO malign.action_point_transactions(
           game_id,game_event_sequence,artifact_ordinal,turn_id,participant_id,sequence_number,
           delta,reason_type,correlation_id,balance_after
         ) VALUES ($1,1,$2,$3,$4,1,3,'TURN_ALLOCATION',uuidv7(),3)`,
        [gameId,index+1,turnId,participantId],
      );
      await client.query(
        `INSERT INTO malign.resource_transactions(
           game_id,game_event_sequence,artifact_ordinal,turn_id,participant_id,delta,reason_type,balance_after
         ) SELECT $1,1,$2,$3,$4,c.starting_resource_default,'SCENARIO_SETUP',c.starting_resource_default
             FROM malign.game_countries g JOIN malign.country_definitions c ON c.id=g.country_definition_id
            WHERE g.game_id=$1 AND g.controlling_participant_id=$4`,
        [gameId,index+1,turnId,participantId],
      );
    }
    const pdDefinition = await client.query<{ id: string }>(
      `INSERT INTO malign.scenario_pd_definitions(
         scenario_definition_id,logical_pd_id,host_country_definition_id,local_index,population_size
       ) VALUES ($1,$3,$2,1,'MEDIUM') RETURNING id`,
      [scenarioId, countryId, `PD-M2A-${fixtureKey}`],
    );
    const pdState = await client.query<{ id: string }>(
      `INSERT INTO malign.population_demographic_states(
         game_id,scenario_pd_definition_id,host_country_definition_id,current_legitimacy_participant_id
       ) VALUES ($1,$2,$3,$4) RETURNING id`,
      [gameId, pdDefinition.rows[0]?.id, countryId, actorId],
    );
    const pdStateId = pdState.rows[0]?.id;
    if (!pdStateId) throw new Error('PD state identity missing');
    const stack = await client.query<{ id: string }>(
      `INSERT INTO malign.influence_stacks(
         game_id,pd_state_id,influence_type,attribution_country_definition_id,count
       ) VALUES ($1,$2,'MALIGN',$3,0) RETURNING id`,
      [gameId, pdStateId, countryId],
    );
    await client.query(
      `UPDATE malign.game_countries SET legitimacy_count_cache=1
        WHERE game_id=$1 AND controlling_participant_id=$2`,
      [gameId,actorId],
    );
    const planned = await client.query<{ id: string }>(
      `INSERT INTO malign.planned_actions(
         game_id,turn_id,participant_id,sequence_within_player,action_type,ap_cost,
         payload_json,payload_schema_id,payload_schema_version,state
       ) VALUES ($1,$2,$3,1,'M2A_FIXTURE',1,'{}','malign.command','0.1','LOCKED') RETURNING id`,
      [gameId, turnId, actorId],
    );
    const resolution = await client.query<{ id: string }>(
      `INSERT INTO malign.action_resolutions(
         game_id,planned_action_id,initiative_position,resolution_status,started_at
       ) VALUES ($1,$2,1,'ACTIVE',clock_timestamp()) RETURNING id`,
      [gameId, planned.rows[0]?.id],
    );
    const authoritativeInitialState=initialStateFactory?.({
      gameId,participantIds,externalUserRefsByParticipant,controllersByCountry,
    })??initialState;
    const initialHash = sha256CanonicalJson(authoritativeInitialState);
    await client.query(
      `UPDATE malign.games SET authoritative_state_json=$2::jsonb,gameplay_state_hash=decode($3,'hex') WHERE id=$1`,
      [gameId,JSON.stringify(authoritativeInitialState),initialHash],
    );
    await client.query(
      `INSERT INTO malign.game_events(
         game_id,sequence_number,turn_id,event_type,subject_type,subject_id,payload_json,
         payload_schema_id,payload_schema_version,visibility_class,correlation_id,state_hash_after
       ) VALUES ($1,1,$2,'SCENARIO_SETUP','GAME',$1,$3::jsonb,
                 'malign.fixture-genesis','0.2','GAME',uuidv7(),decode($4,'hex'))`,
      [gameId,turnId,JSON.stringify({source:'DEC-078/DEC-079',state:authoritativeInitialState}),initialHash],
    );
    await client.query(
      `INSERT INTO malign.game_snapshots(
         game_id,game_version,last_event_sequence,snapshot_json,snapshot_schema_id,snapshot_schema_version,
         canonical_jcs_sha256,gameplay_state_hash,ruleset_version_id,scenario_definition_id,
         card_registry_version_id,engine_contract_version_id
       ) VALUES ($1,0,1,$2::jsonb,'malign.game-state','0.2',decode($3,'hex'),decode($3,'hex'),$4,$5,$6,$7)`,
      [gameId,JSON.stringify(authoritativeInitialState),initialHash,seeded.rulesetVersionId,scenarioId,
        seeded.registryVersionId,seeded.engineContractVersionId],
    );
    await client.query('COMMIT');
    return {
      gameId,
      actorParticipantId: actorId,
      participantIds,
      externalUserRefsByParticipant,
      controllersByCountry,
      countryDefinitionIds,
      turnId,
      pdStateId,
      influenceStackId: stack.rows[0]?.id ?? '',
      actionResolutionId: resolution.rows[0]?.id ?? '',
      rulesetVersionId: seeded.rulesetVersionId,
      registryVersionId: seeded.registryVersionId,
      engineContractVersionId: seeded.engineContractVersionId,
      scenarioDefinitionId: scenarioId,
      ertDefinitionId: ertId,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
