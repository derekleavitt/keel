import type { UserId } from '@keel/contracts/ids';
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

/** Lists the user may read: their own, plus anything shared with them at any level. */
export function visibleListIds(userId: UserId) {
  return sql<string>`(
    select ${list.id} from ${list} where ${list.userId} = ${userId}
    union
    select ${listShare.listId} from ${listShare} where ${listShare.userId} = ${userId}
  )`;
}

/** Lists the user may change: their own, plus anything shared at editor level. */
export function editableListIds(userId: UserId) {
  return sql<string>`(
    select ${list.id} from ${list} where ${list.userId} = ${userId}
    union
    select ${listShare.listId} from ${listShare}
      where ${listShare.userId} = ${userId} and ${listShare.role} = 'editor'
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
export function visibleVia(column: AnyPgColumn, userId: UserId): SQL {
  return sql`${column} in ${visibleListIds(userId)}`;
}

export function editableVia(column: AnyPgColumn, userId: UserId): SQL {
  return sql`${column} in ${editableListIds(userId)}`;
}

/**
 * Only the owner may share, rename or delete a list.
 *
 * An editor can change what is *in* a list but not who else can see it — otherwise a grant
 * silently becomes the power to hand the list to anyone.
 */
export function ownedByUser(userId: UserId, ...narrowing: (SQL | undefined)[]): SQL {
  const owner = eq(list.userId, userId);
  return and(owner, ...narrowing) ?? owner;
}

/** The caller's role on a list: owner, their grant, or null if they cannot see it. */
export async function roleOnList(
  userId: UserId,
  listId: string,
  database: KeelDatabase = db(),
): Promise<'owner' | 'editor' | 'viewer' | null> {
  const [owned] = await database
    .select({ id: list.id })
    .from(list)
    .where(and(eq(list.id, listId), eq(list.userId, userId)))
    .limit(1);
  if (owned) return 'owner';

  const [share] = await database
    .select({ role: listShare.role })
    .from(listShare)
    .where(and(eq(listShare.listId, listId), eq(listShare.userId, userId)))
    .limit(1);
  return share?.role ?? null;
}

/** Ids the caller may read, materialised — for callers that need a list rather than a predicate. */
export async function readableListIds(
  userId: UserId,
  database: KeelDatabase = db(),
): Promise<string[]> {
  const rows = await database
    .select({ id: list.id })
    .from(list)
    .where(sql`${list.id} in ${visibleListIds(userId)}`);
  return rows.map((row) => row.id);
}

export { inArray };
