import type { Scope } from '@keel/contracts/ids';
import { db, type KeelDatabase } from '@keel/db';
import { list, listShare, user } from '@keel/db/schema';
import { and, eq } from 'drizzle-orm';
import { roleOnList } from './access.ts';

export type ShareRole = 'viewer' | 'editor';

/**
 * Sharing operations.
 *
 * Only an owner may grant or revoke. An editor can change what is *in* a list but not who
 * else can see it — otherwise a grant quietly becomes the power to hand the list to anyone,
 * which is the classic way a sharing feature turns into a permissions hole.
 */

/** Who a list is shared with. Owner only — the grantee list is itself sensitive. */
export async function listShares(scope: Scope, listId: string, database: KeelDatabase = db()) {
  const [owned] = await database
    .select({ id: list.id })
    .from(list)
    .where(and(eq(list.id, listId), eq(list.userId, scope.userId)))
    .limit(1);
  if (!owned) return null;

  return database
    .select({
      userId: listShare.userId,
      role: listShare.role,
      email: user.email,
      name: user.name,
    })
    .from(listShare)
    .innerJoin(user, eq(user.id, listShare.userId))
    .where(eq(listShare.listId, listId));
}

/**
 * Share a list with someone, by email.
 *
 * Re-sharing at a different level updates the existing grant rather than inserting a
 * second row — the composite primary key makes two grants impossible, so without the
 * upsert this would fail rather than change the level.
 *
 * Returns a discriminated result rather than throwing: "no such user" and "that is you"
 * are ordinary outcomes a form needs to explain, not exceptional conditions.
 */
export async function shareList(
  scope: Scope,
  input: { listId: string; email: string; role: ShareRole },
  database: KeelDatabase = db(),
): Promise<{ ok: true } | { ok: false; reason: 'not-owner' | 'no-such-user' | 'self' }> {
  const [owned] = await database
    .select({ id: list.id })
    .from(list)
    .where(and(eq(list.id, input.listId), eq(list.userId, scope.userId)))
    .limit(1);
  if (!owned) return { ok: false, reason: 'not-owner' };

  const [recipient] = await database
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, input.email.trim().toLowerCase()))
    .limit(1);
  if (!recipient) return { ok: false, reason: 'no-such-user' };
  if (recipient.id === scope.userId) return { ok: false, reason: 'self' };

  await database
    .insert(listShare)
    .values({ listId: input.listId, userId: recipient.id, role: input.role })
    .onConflictDoUpdate({
      target: [listShare.listId, listShare.userId],
      set: { role: input.role },
    });

  return { ok: true };
}

/** Revoke a grant. Takes effect on the next query — the predicates are subqueries. */
export async function revokeShare(
  scope: Scope,
  input: { listId: string; userId: string },
  database: KeelDatabase = db(),
): Promise<boolean> {
  const [owned] = await database
    .select({ id: list.id })
    .from(list)
    .where(and(eq(list.id, input.listId), eq(list.userId, scope.userId)))
    .limit(1);
  if (!owned) return false;

  const removed = await database
    .delete(listShare)
    .where(and(eq(listShare.listId, input.listId), eq(listShare.userId, input.userId)))
    .returning({ userId: listShare.userId });
  return removed.length > 0;
}

export { roleOnList };
