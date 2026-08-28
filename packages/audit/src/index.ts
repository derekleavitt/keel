import type { Scope } from '@keel/contracts/ids';
import { db, type KeelDatabase } from '@keel/db';
import { auditEntry, user } from '@keel/db/schema';
import { and, desc, eq } from 'drizzle-orm';

/**
 * The audit log.
 *
 * What can be factored out of every mutation, and what cannot:
 *
 * - **Cannot**: what happened. Only the code performing a change knows that it renamed a
 *   list from one thing to another. A generic mechanism can record *that a write occurred*
 *   but not what it meant, and "row updated" is not an audit log anyone can use.
 * - **Can**: everything else. Looking up the actor's email, stamping the organization and
 *   the time, minting an id, deciding not to fail the mutation when logging fails.
 *
 * So the mechanism lives here and the sentence lives at the call site.
 *
 * ## Call it from the query layer, not from actions
 *
 * `audit()` belongs beside the write, inside the query helper — not in the server action
 * that wraps it. Two reasons, and the second is the one that bites:
 *
 * 1. **The database handle is in scope there.** Query helpers take `database` as a
 *    trailing parameter so tests can inject PGlite and mutations can pass a transaction.
 *    Auditing a layer above means logging through the default `db()` while the write went
 *    somewhere else — every injected-database test would open a real connection, and a
 *    transactional delete could not log atomically with itself.
 * 2. **Actions are not the only entry point.** A public API, a job handler or a CLI
 *    reaches the same query helpers directly. An audit call in the action layer records
 *    what the browser did and silently misses everything else.
 *
 * This replaced a `withAudit()` wrapper, which could do neither: it could not see inside
 * the mutation to say what happened, and it could not know which of its forwarded
 * arguments was the connection. See `.orchestration/lessons/L-028.md`.
 */
export interface AuditEvent {
  /** `resource.verb`, e.g. `list.renamed`. Grouped and filtered on, so keep it stable. */
  action: string;
  targetType: string;
  targetId: string;
  /** The sentence shown in the feed, composed now while the facts are to hand. */
  summary: string;
  detail?: Record<string, unknown>;
}

/**
 * Record an event.
 *
 * **Never throws.** A failure to write the log must not fail the operation being logged —
 * a user losing their work because an audit insert hit a constraint is a far worse outcome
 * than a missing line in a feed. The failure is reported to stderr, where a log search
 * finds it.
 *
 * Pass the transaction that performed the mutation and the entry commits atomically with
 * it, so the log cannot record something that was rolled back.
 */
export async function audit(
  scope: Scope,
  event: AuditEvent,
  database: KeelDatabase = db(),
): Promise<void> {
  try {
    // The actor's email is copied in, not joined later: an account can be deleted or an
    // address changed, and the log must still say who acted at the time.
    const [actor] = await database
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, scope.userId))
      .limit(1);

    await database.insert(auditEntry).values({
      id: `aud_${crypto.randomUUID()}`,
      organizationId: scope.organizationId,
      actorId: scope.userId,
      actorEmail: actor?.email ?? 'unknown',
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      summary: event.summary,
      detail: event.detail ?? null,
    });
  } catch (caught) {
    const error = caught instanceof Error ? caught : new Error(String(caught));
    console.error(
      JSON.stringify({ event: 'audit.failed', action: event.action, message: error.message }),
    );
  }
}

/** Everything that has happened in a tenant, newest first. */
export async function listActivity(
  scope: Scope,
  options: { limit?: number; targetType?: string; targetId?: string } = {},
  database: KeelDatabase = db(),
) {
  const narrowing = [eq(auditEntry.organizationId, scope.organizationId)];
  if (options.targetType) narrowing.push(eq(auditEntry.targetType, options.targetType));
  if (options.targetId) narrowing.push(eq(auditEntry.targetId, options.targetId));

  return (
    database
      .select({
        id: auditEntry.id,
        action: auditEntry.action,
        actorEmail: auditEntry.actorEmail,
        targetType: auditEntry.targetType,
        targetId: auditEntry.targetId,
        summary: auditEntry.summary,
        createdAt: auditEntry.createdAt,
      })
      .from(auditEntry)
      // Scoped by organization like every other query. An audit log that leaks across
      // tenants is worse than none: it reveals activity nobody was ever meant to see.
      .where(and(...narrowing))
      .orderBy(desc(auditEntry.createdAt))
      .limit(options.limit ?? 100)
  );
}
