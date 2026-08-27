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

export const M2A_QUERY_BUDGETS: readonly QueryBudget[] = [
  {
    name: 'aggregate_load',
    maxQueries: 2,
    sql: `SELECT g.*,b.remaining,c.current_resources_cache,c.current_vp_cache
            FROM malign.games g
            LEFT JOIN malign.action_point_balances b ON b.game_id=g.id
            LEFT JOIN malign.game_countries c ON c.game_id=g.id
           WHERE g.id=$1`,
    expectedIndex: 'games_pkey',
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
           WHERE s.delivery_status='PENDING' ORDER BY m.game_id,m.outbox_sequence,m.id LIMIT 1`,
    expectedIndex: 'outbox_delivery_states_pending_idx',
  },
  {
    name: 'registry_pin_lookup',
    maxQueries: 1,
    sql: `SELECT r.version,r.jcs_sha256 FROM malign.games g
            JOIN malign.card_registry_versions r ON r.id=g.card_registry_version_id WHERE g.id=$1`,
    expectedIndex: 'games_pkey',
  },
] as const;

export const captureCriticalExplainPlans = async (
  pool: Pool,
  gameId: string,
): Promise<Readonly<Record<QueryBudgetName, readonly unknown[]>>> => {
  const plans = {} as Record<QueryBudgetName, readonly unknown[]>;
  for (const budget of M2A_QUERY_BUDGETS) {
    if (/\bOFFSET\b/i.test(budget.sql)) throw new Error(`OFFSET is forbidden in ${budget.name}`);
    const parameterCount = Math.max(...[...budget.sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])), 0);
    const parameters = [gameId, 0, 100].slice(0, parameterCount);
    const result = await pool.query<{ 'QUERY PLAN': unknown[] }>(`EXPLAIN (FORMAT JSON) ${budget.sql}`, parameters);
    plans[budget.name] = result.rows[0]?.['QUERY PLAN'] ?? [];
  }
  return plans;
};
