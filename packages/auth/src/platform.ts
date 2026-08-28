import { db, type KeelDatabase } from '@keel/db';
import { adminAction, platformAdmin, user } from '@keel/db/schema';
import { desc, eq } from 'drizzle-orm';

/**
 * Platform staff: who may operate the service, as opposed to a tenant.
 *
 * Deliberately not in the orgs package: routing this through anything tenant-shaped is how
 * the two roles get conflated, and conflating them hands every customer the keys to every
 * other customer.
 *
 * **Nothing here touches a request.** Every function takes its inputs and a database handle,
 * so the grant CLI, a job and a test can all use it. `requirePlatformAdmin()` — the one
 * request-bound question — lives in `./session.ts` with the other `require*` helpers,
 * because a module that mixes the two cannot be imported by anything that is not serving a
 * web request. That is not a style preference: it is why `pnpm admin:grant` exists at all.
 */

export async function isPlatformAdmin(
  userId: string,
  database: KeelDatabase = db(),
): Promise<boolean> {
  const [row] = await database
    .select({ userId: platformAdmin.userId })
    .from(platformAdmin)
    .where(eq(platformAdmin.userId, userId))
    .limit(1);
  return Boolean(row);
}

/** Who is acting. A plain shape, so the CLI and a request can both produce one. */
export interface PlatformActor {
  id: string;
  email: string;
}

export interface AdminActionRecord {
  action: string;
  summary: string;
  targetType?: string;
  targetId?: string;
  /** The tenant affected, when there is one. */
  organizationId?: string | null;
  detail?: Record<string, unknown>;
}

/**
 * Record what staff did. **Never throws**, for the same reason `audit()` does not: losing
 * the log must not fail the operation, and a support action that errors halfway is worse
 * than an unlogged one.
 *
 * When the action names an organization the caller is expected to *also* write to that
 * tenant's own audit log — see `packages/admin`. A support tool the customer cannot see is
 * indistinguishable from a back door.
 */
export async function recordAdminAction(
  actor: PlatformActor,
  record: AdminActionRecord,
  database: KeelDatabase = db(),
): Promise<void> {
  try {
    await database.insert(adminAction).values({
      id: `adm_${crypto.randomUUID()}`,
      actorId: actor.id,
      actorEmail: actor.email,
      action: record.action,
      targetType: record.targetType ?? null,
      targetId: record.targetId ?? null,
      organizationId: record.organizationId ?? null,
      summary: record.summary,
      detail: record.detail ?? null,
    });
  } catch (caught) {
    console.error(
      JSON.stringify({
        event: 'admin_action.failed',
        action: record.action,
        message: caught instanceof Error ? caught.message : String(caught),
      }),
    );
  }
}

/** The staff action log, newest first. */
export async function listAdminActions(limit = 100, database: KeelDatabase = db()) {
  return database
    .select({
      id: adminAction.id,
      actorEmail: adminAction.actorEmail,
      action: adminAction.action,
      summary: adminAction.summary,
      organizationId: adminAction.organizationId,
      createdAt: adminAction.createdAt,
    })
    .from(adminAction)
    .orderBy(desc(adminAction.createdAt))
    .limit(limit);
}

/**
 * Grant staff access.
 *
 * Not exposed as a server action anywhere, and that is the design. The first administrator
 * has to be created out of band — `pnpm admin:grant <email>` — because an in-app path to
 * self-promotion is an in-app path to privilege escalation the moment any other bug lets a
 * request reach it.
 */
export async function grantPlatformAdmin(
  email: string,
  options: { grantedBy?: string; note?: string } = {},
  database: KeelDatabase = db(),
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const [target] = await database
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  if (!target) return { ok: false, error: `No user with email ${email}` };

  await database
    .insert(platformAdmin)
    .values({
      userId: target.id,
      grantedBy: options.grantedBy ?? null,
      note: options.note ?? null,
    })
    .onConflictDoNothing();

  return { ok: true, userId: target.id };
}

/** Revoke staff access. Separate from granting so an audit shows which one happened. */
export async function revokePlatformAdmin(
  userId: string,
  database: KeelDatabase = db(),
): Promise<boolean> {
  const rows = await database
    .delete(platformAdmin)
    .where(eq(platformAdmin.userId, userId))
    .returning({ userId: platformAdmin.userId });
  return rows.length > 0;
}

/** Everyone with staff access, so the list is reviewable rather than folklore. */
export async function listPlatformAdmins(database: KeelDatabase = db()) {
  return database
    .select({
      userId: platformAdmin.userId,
      email: user.email,
      note: platformAdmin.note,
      grantedAt: platformAdmin.grantedAt,
    })
    .from(platformAdmin)
    .innerJoin(user, eq(user.id, platformAdmin.userId))
    .orderBy(desc(platformAdmin.grantedAt));
}
