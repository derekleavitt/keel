import type { Scope } from '@keel/contracts/ids';
import { db, type KeelDatabase } from '@keel/db';
import { list, listShare } from '@keel/db/schema';
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * Authorization, expressed once.
 *
 * Before sharing existed, every query said `eq(table.userId, userId)` — three identical
 * `ownedBy` helpers across three packages. That works exactly until two people touch one
 * thing, and then "can I see this" stops being a property of the row.
 *
 * **The list is the authorization boundary.** A todo inherits access from the list it
 * belongs to; its `userId` records who created it and no longer decides who may see it.
 * One ACL per list beats one per row, and it means a single grant covers everything
 * inside.
 *
 * These predicates are subqueries rather than fetched id lists on purpose: the database
 * evaluates them per statement, so revoking a grant takes effect on the next query with no
 * cache to invalidate and no window where a stale list of ids is still trusted.
 *
 * Every query in every package composes one of these. Re-deriving the rule inline is how
 * one query ends up subtly more permissive than the rest.
 */

/**
 * Lists the caller may read: their own, plus anything shared with them — **within the
 * active organization only.**
 *
 * The tenant filter is on the inner selects rather than applied afterwards, so a share
 * that somehow pointed across tenants still could not widen the result. Tenancy is not a
 * refinement of ownership here; it is the outer boundary that ownership operates inside.
 */
export function visibleListIds(scope: Scope) {
  return sql<string>`(
    select ${list.id} from ${list}
      where ${list.userId} = ${scope.userId}
        and ${list.organizationId} = ${scope.organizationId}
    union
    select ${listShare.listId} from ${listShare}
      join ${list} on ${list.id} = ${listShare.listId}
      where ${listShare.userId} = ${scope.userId}
        and ${list.organizationId} = ${scope.organizationId}
  )`;
}

/** Lists the caller may change: their own, plus editor grants, within the active tenant. */
export function editableListIds(scope: Scope) {
  return sql<string>`(
    select ${list.id} from ${list}
      where ${list.userId} = ${scope.userId}
        and ${list.organizationId} = ${scope.organizationId}
    union
    select ${listShare.listId} from ${listShare}
      join ${list} on ${list.id} = ${listShare.listId}
      where ${listShare.userId} = ${scope.userId}
        and ${listShare.role} = 'editor'
        and ${list.organizationId} = ${scope.organizationId}
  )`;
}

/**
 * Scope a query on any column holding a list id.
 *
 * Deliberately accepts any text column rather than `list.id` specifically: the whole point
 * is that `todo.list_id` — and any future table hanging off a list — composes the same
 * predicate. Narrowing this to one table would push every other caller into re-deriving
 * the rule, which is exactly what this module exists to prevent.
 */
export function visibleVia(column: AnyPgColumn, scope: Scope): SQL {
  return sql`${column} in ${visibleListIds(scope)}`;
}

export function editableVia(column: AnyPgColumn, scope: Scope): SQL {
  return sql`${column} in ${editableListIds(scope)}`;
}

/**
 * Only the owner may share, rename or delete a list.
 *
 * An editor can change what is *in* a list but not who else can see it — otherwise a grant
 * silently becomes the power to hand the list to anyone.
 */
export function ownedByUser(scope: Scope, ...narrowing: (SQL | undefined)[]): SQL {
  const owner = and(
    eq(list.userId, scope.userId),
    eq(list.organizationId, scope.organizationId),
  ) as SQL;
  return and(owner, ...narrowing) ?? owner;
}

/** The caller's role on a list: owner, their grant, or null if they cannot see it. */
export async function roleOnList(
  scope: Scope,
  listId: string,
  database: KeelDatabase = db(),
): Promise<'owner' | 'editor' | 'viewer' | null> {
  const [owned] = await database
    .select({ id: list.id })
    .from(list)
    .where(
      and(
        eq(list.id, listId),
        eq(list.userId, scope.userId),
        eq(list.organizationId, scope.organizationId),
      ),
    )
    .limit(1);
  if (owned) return 'owner';

  // The join enforces tenancy: a grant on a list in another organization cannot resolve.
  const [share] = await database
    .select({ role: listShare.role })
    .from(listShare)
    .innerJoin(list, eq(list.id, listShare.listId))
    .where(
      and(
        eq(listShare.listId, listId),
        eq(listShare.userId, scope.userId),
        eq(list.organizationId, scope.organizationId),
      ),
    )
    .limit(1);
  return share?.role ?? null;
}

/** Ids the caller may read, materialised — for callers that need a list rather than a predicate. */
export async function readableListIds(
  scope: Scope,
  database: KeelDatabase = db(),
): Promise<string[]> {
  const rows = await database
    .select({ id: list.id })
    .from(list)
    .where(sql`${list.id} in ${visibleListIds(scope)}`);
  return rows.map((row) => row.id);
}

export { inArray };
