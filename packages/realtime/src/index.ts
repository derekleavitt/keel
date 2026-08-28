import type { OrganizationId, Scope } from '@keel/contracts/ids';
import { db, type KeelDatabase } from '@keel/db';
import { changeLog } from '@keel/db/schema';
import { and, asc, eq, gt, inArray, lt, sql } from 'drizzle-orm';

/**
 * Live updates.
 *
 * The model is deliberately small: a mutation says *that* a channel changed, a subscriber
 * learns its cursor moved, and the subscriber then **refetches through the ordinary
 * authorized query**. Nothing about the change itself travels over the connection.
 *
 * That constraint is what makes the feature safe rather than merely working. A stream that
 * pushed rows would have to re-implement every visibility rule at the socket layer — and
 * would keep pushing to a subscriber whose access was revoked a second ago. Here the worst
 * a stale subscription can do is provoke a refetch that returns nothing.
 */

/** How often a stream looks for new changes. */
export const POLL_INTERVAL_MS = 1_000;

/**
 * How often an open stream re-checks that the subscriber may still read the channel.
 *
 * A server action authorizes once, at the moment it runs. A stream is a decision that stays
 * true for as long as it is open — so it has to be re-taken. Without this, revoking someone's
 * access to a shared list leaves their tab receiving change notifications for it until they
 * close it, which is a slow leak of activity: not the contents, but who is working and when.
 */
export const REAUTHORIZE_EVERY_MS = 30_000;

export interface Change {
  id: number;
  channel: string;
}

/** Name a channel. One helper so a publisher and a subscriber cannot disagree on the string. */
export function channelFor(resource: string, id: string): string {
  return `${resource}:${id}`;
}

/**
 * Record that a channel changed.
 *
 * Pass the transaction that made the change and the notification commits with it: a
 * rolled-back mutation cannot wake anybody, and a committed one cannot fail to.
 *
 * Never throws — a failure to notify must not fail the write. A missed notification costs a
 * subscriber staleness until their next poll; a failed write costs the user their work.
 */
export async function publish(
  scope: Scope,
  channel: string,
  database: KeelDatabase = db(),
): Promise<void> {
  try {
    await database.insert(changeLog).values({ organizationId: scope.organizationId, channel });
  } catch (caught) {
    console.error(
      JSON.stringify({
        event: 'realtime.publish_failed',
        channel,
        message: caught instanceof Error ? caught.message : String(caught),
      }),
    );
  }
}

/**
 * Changes on these channels after `cursor`.
 *
 * Scoped by organization as well as by channel. The channel string comes from the client, so
 * it is not a permission — a subscriber could otherwise name a channel belonging to another
 * tenant and learn its activity timing. The caller checks the channel is *theirs*; this makes
 * sure it is at least their tenant's.
 */
export async function changesSince(
  organizationId: OrganizationId,
  channels: string[],
  cursor: number,
  database: KeelDatabase = db(),
  limit = 100,
): Promise<Change[]> {
  if (channels.length === 0) return [];

  return database
    .select({ id: changeLog.id, channel: changeLog.channel })
    .from(changeLog)
    .where(
      and(
        eq(changeLog.organizationId, organizationId),
        inArray(changeLog.channel, channels),
        gt(changeLog.id, cursor),
      ),
    )
    .orderBy(asc(changeLog.id))
    .limit(limit);
}

/**
 * The newest cursor, so a fresh subscriber starts from "now" rather than replaying history.
 *
 * Taken **before** the first render's data is fetched, never after. The other order drops
 * every change that lands in between: the page renders state at T1, subscribes from T2, and
 * silently never hears about anything that happened in the gap.
 */
export async function currentCursor(
  organizationId: OrganizationId,
  database: KeelDatabase = db(),
): Promise<number> {
  const [row] = await database
    .select({ id: sql<number>`coalesce(max(${changeLog.id}), 0)` })
    .from(changeLog)
    .where(eq(changeLog.organizationId, organizationId));
  return Number(row?.id ?? 0);
}

/**
 * Discard entries older than the retention window.
 *
 * The log is a wake-up mechanism, not a history — `audit_entry` is the history. A subscriber
 * offline for longer than this reconnects with a cursor the log no longer covers, which is
 * why `changesSince` returning nothing must mean "refetch anyway" rather than "you are up to
 * date"; the client treats a resumed connection as a reason to refetch regardless.
 */
export async function pruneChangeLog(
  olderThan: Date,
  database: KeelDatabase = db(),
): Promise<number> {
  const rows = await database
    .delete(changeLog)
    .where(lt(changeLog.createdAt, olderThan))
    .returning({ id: changeLog.id });
  return rows.length;
}
