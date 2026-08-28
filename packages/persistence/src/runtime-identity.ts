import type { PoolClient } from 'pg';

import { PersistenceError } from './errors.js';

export type ProductRuntimeRole = 'malign_app_runtime' | 'malign_outbox_publisher';

export interface VerifiedRuntimeIdentity {
  readonly sessionUser: string;
  readonly currentUser: ProductRuntimeRole;
  readonly memberships: readonly string[];
}

/**
 * A product runtime connection must be a dedicated LOGIN principal with exactly one
 * direct product-role membership. Administrative/superuser sessions fail closed even
 * when they could SET ROLE successfully.
 */
export const assertLeastPrivilegeRuntimeIdentity = async (
  client: PoolClient,
  expectedRole: ProductRuntimeRole,
): Promise<VerifiedRuntimeIdentity> => {
  const identity = await client.query<{
    session_user: string;
    current_user: string;
    rolcanlogin: boolean;
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    memberships: string[] | null;
  }>(`
    SELECT session_user,current_user,r.rolcanlogin,r.rolsuper,r.rolcreatedb,r.rolcreaterole,
           COALESCE(array_agg(granted.rolname::text ORDER BY granted.rolname)
             FILTER (WHERE granted.rolname IS NOT NULL),ARRAY[]::text[]) memberships
      FROM pg_roles r
      LEFT JOIN pg_auth_members membership ON membership.member=r.oid
      LEFT JOIN pg_roles granted ON granted.oid=membership.roleid
     WHERE r.rolname=session_user
     GROUP BY r.rolcanlogin,r.rolsuper,r.rolcreatedb,r.rolcreaterole
  `);
  const row = identity.rows[0];
  const memberships = row?.memberships ?? [];
  if (
    row === undefined ||
    row.current_user !== expectedRole ||
    row.session_user === expectedRole ||
    !row.rolcanlogin ||
    row.rolsuper ||
    row.rolcreatedb ||
    row.rolcreaterole ||
    memberships.length !== 1 ||
    memberships[0] !== expectedRole
  ) {
    throw new PersistenceError(
      'RUNTIME_AUTHORITY_INVALID',
      `Runtime operation requires a dedicated least-privilege ${expectedRole} principal`,
    );
  }
  return { sessionUser: row.session_user, currentUser: expectedRole, memberships };
};
