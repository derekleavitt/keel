import { audit } from '@keel/audit';
import { checkLimit, LimitExceededError } from '@keel/billing';
import type { Scope } from '@keel/contracts/ids';
import { db, type KeelDatabase } from '@keel/db';
import { list } from '@keel/db/schema';
import { and, asc, count, eq, type SQL } from 'drizzle-orm';

import { ownedByUser, visibleVia } from './access.ts';
import {
  evenPositions,
  neighboursForMove,
  PositionExhaustedError,
  positionBetween,
} from './position.ts';

/**
 * The query layer. Shape copied from `examples/notes` — see that package for why the
 * database handle is a trailing parameter with a `db()` default, and why `userId` is the
 * branded type rather than a string.
 */
export type ListsDatabase = KeelDatabase;

/**
 * Reads use visibility (owned or shared); writes use ownership or an editor grant.
 * Both come from `./access.ts` so the rule exists in exactly one place.
 */
function visible(scope: Scope, ...narrowing: (SQL | undefined)[]): SQL {
  const predicate = visibleVia(list.id, scope);
  return and(predicate, ...narrowing) ?? predicate;
}

export async function listLists(scope: Scope, database: ListsDatabase = db()) {
  return database.select().from(list).where(visible(scope)).orderBy(asc(list.position));
}

export async function getList(scope: Scope, id: string, database: ListsDatabase = db()) {
  const [row] = await database
    .select()
    .from(list)
    .where(visible(scope, eq(list.id, id)))
    .limit(1);
  return row ?? null;
}

export async function createList(
  scope: Scope,
  input: { name: string; colour?: string | null },
  database: ListsDatabase = db(),
) {
  /*
   * The plan limit is enforced **here**, in the query layer, not in the action.
   *
   * Every entry point funnels through this function — the web UI, the public API, a future
   * import job — so the limit cannot be bypassed by calling a different endpoint, which is
   * exactly the failure the task warned about. The same argument as the audit log in
   * [[L-028]]: a cross-cutting rule belongs at the layer that owns the resource, because the
   * layer that owns the request grows a new entry point every other task.
   */
  const [{ n: owned } = { n: 0 }] = await database
    .select({ n: count() })
    .from(list)
    .where(eq(list.organizationId, scope.organizationId));

  const allowance = await checkLimit(scope.organizationId, 'lists', Number(owned), database);
  if (!allowance.allowed) throw new LimitExceededError('lists', allowance);

  const existing = await listLists(scope, database);
  const last = existing.at(-1)?.position ?? null;

  const [row] = await database
    .insert(list)
    .values({
      id: `lst_${crypto.randomUUID()}`,
      userId: scope.userId,
      organizationId: scope.organizationId,
      name: input.name,
      colour: input.colour ?? null,
      position: positionBetween(last, null),
    })
    .returning();
  if (!row) throw new Error('createList inserted no row');
  await audit(
    scope,
    {
      action: 'list.created',
      targetType: 'list',
      targetId: row.id,
      summary: `created the list “${row.name}”`,
    },
    database,
  );
  return row;
}

export async function updateList(
  scope: Scope,
  id: string,
  patch: { name?: string; colour?: string | null },
  database: ListsDatabase = db(),
) {
  const [row] = await database
    .update(list)
    .set({ ...patch, updatedAt: new Date() })
    // Renaming is an owner action: an editor may change what is in a list, not the list.
    .where(ownedByUser(scope, eq(list.id, id)))
    .returning();
  if (!row) return null;
  await audit(
    scope,
    {
      action: 'list.updated',
      targetType: 'list',
      targetId: row.id,
      summary: `renamed a list to “${row.name}”`,
      detail: patch,
    },
    database,
  );
  return row;
}

/** Returns whether a row was removed, so callers can tell "gone" from "not yours". */
export async function deleteList(scope: Scope, id: string, database: ListsDatabase = db()) {
  const rows = await database
    .delete(list)
    .where(ownedByUser(scope, eq(list.id, id)))
    .returning({ id: list.id });
  if (rows.length === 0) return false;
  // Recorded after the row is gone. The entry carries no foreign key to its target
  // precisely so it survives this — "who deleted it" is a question asked afterwards.
  await audit(
    scope,
    {
      action: 'list.deleted',
      targetType: 'list',
      targetId: id,
      summary: 'deleted a list',
    },
    database,
  );
  return true;
}

/**
 * Move a list to sit after `afterId`, or to the front when that is null.
 *
 * Writes one row in the ordinary case. When the gap between neighbours has run out of
 * floats the whole list is renumbered, in the same transaction, so a reader never sees a
 * partially reordered list.
 */
export async function reorderList(
  scope: Scope,
  input: { id: string; afterId: string | null },
  database: ListsDatabase = db(),
) {
  return database.transaction(async (tx) => {
    const ordered = await tx
      .select({ id: list.id, position: list.position })
      .from(list)
      .where(ownedByUser(scope))
      .orderBy(asc(list.position));

    if (!ordered.some((row) => row.id === input.id)) return false;

    const { before, after } = neighboursForMove(ordered, input.id, input.afterId);

    try {
      await tx
        .update(list)
        .set({ position: positionBetween(before, after), updatedAt: new Date() })
        .where(ownedByUser(scope, eq(list.id, input.id)));
      return true;
    } catch (error) {
      if (!(error instanceof PositionExhaustedError)) throw error;
    }

    // Renumber, then place the moved row using the fresh spacing.
    const without = ordered.filter((row) => row.id !== input.id);
    const target =
      input.afterId === null ? 0 : without.findIndex((r) => r.id === input.afterId) + 1;
    const resequenced = [...without.slice(0, target), { id: input.id }, ...without.slice(target)];
    const positions = evenPositions(resequenced.length);

    for (const [index, row] of resequenced.entries()) {
      const position = positions[index];
      if (position === undefined) throw new Error('renumber produced no position');
      await tx
        .update(list)
        .set({ position, updatedAt: new Date() })
        .where(ownedByUser(scope, eq(list.id, row.id)));
    }
    return true;
  });
}
