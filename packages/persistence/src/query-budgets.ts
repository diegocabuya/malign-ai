import type { Pool } from 'pg';

export type QueryBudgetName =
  | 'aggregate_load'
  | 'authorized_projection_load'
  | 'replay_page'
  | 'pending_dashboard'
  | 'outbox_claim'
  | 'registry_pin_lookup';

export interface QueryBudget {
  readonly name: QueryBudgetName;
  readonly maxQueries: number;
  readonly sql: string;
  readonly expectedIndex: string;
}

export interface QueryExecutionEvidence {
  readonly name: QueryBudgetName;
  readonly queryCount: number;
  readonly rowCount: number;
  readonly maxQueries: number;
  readonly withinBudget: boolean;
}

export interface M2AQueryMetrics {
  aggregateLoadQueries: number;
  authorizedProjectionQueries: number;
  replayPages: number;
  replayRows: number;
  pendingDashboardQueries: number;
  outboxClaimQueries: number;
  registryPinQueries: number;
  historyRowsObserved: number;
}

export const createM2AQueryMetrics = (): M2AQueryMetrics => ({
  aggregateLoadQueries:0,authorizedProjectionQueries:0,replayPages:0,replayRows:0,
  pendingDashboardQueries:0,outboxClaimQueries:0,registryPinQueries:0,historyRowsObserved:0,
});

export const M2A_QUERY_BUDGETS: readonly QueryBudget[] = [
  {
    name: 'aggregate_load',
    maxQueries: 2,
    sql: `SELECT g.*,b.remaining,c.current_resources_cache,c.current_vp_cache
            FROM malign.games g
            LEFT JOIN malign.action_point_balances b ON b.game_id=g.id
            LEFT JOIN malign.game_countries c ON c.game_id=g.id
           WHERE g.id=$1`,
    expectedIndex: 'games_id_game_version_key',
  },
  {
    name: 'authorized_projection_load',
    maxQueries: 1,
    sql: `SELECT sequence_number,event_type,payload_json FROM malign.game_events
           WHERE game_id=$1 AND sequence_number>$2 ORDER BY sequence_number,id LIMIT $3`,
    expectedIndex: 'game_events_replay_keyset_idx',
  },
  {
    name: 'replay_page',
    maxQueries: 1,
    sql: `SELECT sequence_number,event_type,payload_json,state_hash_after FROM malign.game_events
           WHERE game_id=$1 AND sequence_number>$2 ORDER BY sequence_number,id LIMIT $3`,
    expectedIndex: 'game_events_replay_keyset_idx',
  },
  {
    name: 'pending_dashboard',
    maxQueries: 2,
    sql: `SELECT id,status,continuation_type FROM malign.pending_resolutions
           WHERE game_id=$1 AND status='OPEN' ORDER BY id LIMIT $2`,
    expectedIndex: 'pending_resolutions_dashboard_idx',
  },
  {
    name: 'outbox_claim',
    maxQueries: 3,
    sql: `SELECT m.id,m.outbox_sequence FROM malign.outbox_delivery_states s
            JOIN malign.outbox_messages m ON m.id=s.outbox_message_id
           WHERE s.delivery_status='PENDING' AND NOT EXISTS (
             SELECT 1 FROM malign.outbox_messages earlier
             JOIN malign.outbox_delivery_states es ON es.outbox_message_id=earlier.id
             WHERE earlier.game_id=m.game_id AND earlier.outbox_sequence<m.outbox_sequence
               AND es.delivery_status<>'ACKNOWLEDGED'
           ) ORDER BY m.game_id,m.outbox_sequence,m.id LIMIT 1`,
    expectedIndex: 'outbox_delivery_states_pending_idx',
  },
  {
    name: 'registry_pin_lookup',
    maxQueries: 1,
    sql: `SELECT r.version,r.jcs_sha256 FROM malign.games g
            JOIN malign.card_registry_versions r ON r.id=g.card_registry_version_id WHERE g.id=$1`,
    expectedIndex: 'games_id_game_version_key',
  },
] as const;

export const executeWithinQueryBudget = async (
  pool: Pool,
  name: QueryBudgetName,
  parameters: readonly unknown[],
  metrics: M2AQueryMetrics = createM2AQueryMetrics(),
): Promise<QueryExecutionEvidence> => {
  const budget=M2A_QUERY_BUDGETS.find(candidate=>candidate.name===name);
  if (!budget) throw new Error(`Unknown query budget ${name}`);
  if (/\bOFFSET\b/i.test(budget.sql)) throw new Error(`OFFSET is forbidden in ${name}`);
  let queryCount=0;
  const result=await pool.query(budget.sql,[...parameters]);
  queryCount+=1;
  if (name==='aggregate_load') metrics.aggregateLoadQueries+=queryCount;
  if (name==='authorized_projection_load') metrics.authorizedProjectionQueries+=queryCount;
  if (name==='replay_page') { metrics.replayPages+=1; metrics.replayRows+=result.rowCount??0; }
  if (name==='pending_dashboard') metrics.pendingDashboardQueries+=queryCount;
  if (name==='outbox_claim') metrics.outboxClaimQueries+=queryCount;
  if (name==='registry_pin_lookup') metrics.registryPinQueries+=queryCount;
  metrics.historyRowsObserved+=result.rowCount??0;
  return {name,queryCount,rowCount:result.rowCount??0,maxQueries:budget.maxQueries,withinBudget:queryCount<=budget.maxQueries};
};

export const captureCriticalExplainPlans = async (
  pool: Pool,
  gameId: string,
): Promise<Readonly<Record<QueryBudgetName, readonly unknown[]>>> => {
  const plans = {} as Record<QueryBudgetName, readonly unknown[]>;
  const client=await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query('SET LOCAL ROLE malign_app_runtime');
    await client.query('SET LOCAL enable_seqscan=off');
    for (const budget of M2A_QUERY_BUDGETS) {
      if (/\bOFFSET\b/i.test(budget.sql)) throw new Error(`OFFSET is forbidden in ${budget.name}`);
      const parameterCount = Math.max(...[...budget.sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])), 0);
      const parameters = [gameId, 0, 100].slice(0, parameterCount);
      const result = await client.query<{ 'QUERY PLAN': unknown[] }>(`EXPLAIN (FORMAT JSON) ${budget.sql}`, parameters);
      plans[budget.name] = result.rows[0]?.['QUERY PLAN'] ?? [];
    }
    await client.query('COMMIT');
    return plans;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
};

export const assertCriticalExplainPlansUseIndexes = (
  plans: Readonly<Record<QueryBudgetName, readonly unknown[]>>,
): void => {
  for (const budget of M2A_QUERY_BUDGETS) {
    if (!JSON.stringify(plans[budget.name]).includes(budget.expectedIndex)) {
      throw new Error(`${budget.name} did not use ${budget.expectedIndex}`);
    }
  }
};
