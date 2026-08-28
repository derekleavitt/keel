import { audit } from '@keel/audit';
import { type AdminActionRecord, type PlatformActor, recordAdminAction } from '@keel/auth/platform';
import type { OrganizationId, Scope, UserId } from '@keel/contracts/ids';
import { db, type KeelDatabase } from '@keel/db';
import { membership, organization, user } from '@keel/db/schema';
import { count, desc, eq, sql } from 'drizzle-orm';

/**
 * Cross-organization read models for the staff admin surface.
 *
 * A composition package: it depends on several features and nothing but the app depends on
 * it. It writes no SQL that belongs to a feature and owns no tables of its own — the shape
 * `testbed/views` established, applied to the one view that deliberately ignores tenancy.
 *
 * **Every query here crosses the tenant boundary on purpose**, which is exactly why nothing
 * in it may be reachable without `requirePlatformAdmin()`. The gate lives in
 * `apps/web/app/admin/layout.tsx` so that one check covers every route beneath it rather
 * than each page remembering.
 */

/** Every organization with the numbers a support conversation actually starts from. */
export async function listOrganizations(limit = 100, database: KeelDatabase = db()) {
  return database
    .select({
      id: organization.id,
      name: organization.name,
      createdAt: organization.createdAt,
      members: count(membership.userId),
    })
    .from(organization)
    .leftJoin(membership, eq(membership.organizationId, organization.id))
    .groupBy(organization.id, organization.name, organization.createdAt)
    .orderBy(desc(organization.createdAt))
    .limit(limit);
}

/** One organization, with who is in it and what they can do. */
export async function organizationDetail(organizationId: string, database: KeelDatabase = db()) {
  const [org] = await database
    .select({ id: organization.id, name: organization.name, createdAt: organization.createdAt })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);
  if (!org) return null;

  const members = await database
    .select({
      userId: membership.userId,
      email: user.email,
      name: user.name,
      role: membership.role,
    })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .where(eq(membership.organizationId, organizationId))
    .orderBy(desc(membership.role));

  return { ...org, members };
}

/** Find a person by email across every tenant — the first step of most support requests. */
export async function findUsers(query: string, limit = 25, database: KeelDatabase = db()) {
  const term = `%${query.replace(/[%_\\]/g, (match) => `\\${match}`)}%`;
  return (
    database
      .select({
        id: user.id,
        email: user.email,
        name: user.name,
        organizations: sql<number>`(
        select count(*) from ${membership} where ${membership.userId} = ${user.id}
      )`,
      })
      .from(user)
      .where(sql`${user.email} ilike ${term}`)
      /*
       * A `LIMIT` without an `ORDER BY` returns an arbitrary subset — Postgres is free to
       * hand back whichever rows it reaches first, and it does change as the table grows.
       * A support tool that silently omits the account being searched for, with no
       * indication it truncated, is worse than one that is slow.
       */
      .orderBy(user.email)
      .limit(limit)
  );
}

/**
 * Record a staff action, in both places it belongs.
 *
 * The staff log always gets it. When the action names a tenant, that tenant's own audit log
 * gets it too — so the customer can see that staff touched their data. A support tool the
 * customer cannot audit is indistinguishable from a back door, and "we have logs" that only
 * the vendor can read is not the same promise.
 *
 * The tenant-facing entry is attributed to the staff member's real email, not anonymised.
 * "Someone at the vendor" is a worse answer than a name.
 */
export async function recordAndDisclose(
  actor: PlatformActor,
  record: AdminActionRecord,
  database: KeelDatabase = db(),
): Promise<void> {
  await recordAdminAction(actor, record, database);

  if (record.organizationId) {
    await audit(
      {
        userId: actor.id as UserId,
        organizationId: record.organizationId as OrganizationId,
      } satisfies Scope,
      {
        action: `staff.${record.action}`,
        targetType: record.targetType ?? 'organization',
        targetId: record.targetId ?? record.organizationId,
        summary: `${actor.email} (support) ${record.summary}`,
        detail: record.detail,
      },
      database,
    );
  }
}
