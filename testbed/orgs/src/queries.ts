import type { OrganizationId, Scope, UserId } from '@keel/contracts/ids';
import { db, type KeelDatabase } from '@keel/db';
import { membership, organization, user } from '@keel/db/schema';
import { and, asc, eq } from 'drizzle-orm';

/**
 * Organizations and membership.
 *
 * This package owns tenancy itself; every other package merely receives a `Scope` and
 * trusts that it was built here. That is deliberate — resolving which tenant a request
 * belongs to is exactly the decision you want in one place, verified once, rather than
 * re-derived by each feature from whatever it has to hand.
 */

/** Every organization the user belongs to, personal first, then alphabetical. */
export async function listOrganizations(userId: UserId, database: KeelDatabase = db()) {
  const rows = await database
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      role: membership.role,
      personal: organization.personal,
    })
    .from(membership)
    .innerJoin(organization, eq(organization.id, membership.organizationId))
    .where(eq(membership.userId, userId))
    .orderBy(asc(organization.name));

  return rows
    .map((row) => ({ ...row, isPersonal: row.personal !== null }))
    .sort((a, b) => Number(b.isPersonal) - Number(a.isPersonal));
}

/**
 * Build a scope, verifying membership.
 *
 * Returns null rather than throwing when the user is not a member: an organization id
 * arriving from a cookie is attacker-controlled, and "you are not in that tenant" is an
 * ordinary outcome the caller handles by falling back, not an exception.
 *
 * **This is the only sanctioned way to construct a `Scope`.** Assembling one inline from a
 * request parameter skips the membership check, which is the entire protection.
 */
export async function scopeFor(
  userId: UserId,
  organizationId: string,
  database: KeelDatabase = db(),
): Promise<Scope | null> {
  const [member] = await database
    .select({ role: membership.role })
    .from(membership)
    .where(and(eq(membership.userId, userId), eq(membership.organizationId, organizationId)))
    .limit(1);

  if (!member) return null;
  return { userId, organizationId: organizationId as OrganizationId };
}

/** The user's personal organization — always exists, cannot be left. */
export async function personalScope(
  userId: UserId,
  database: KeelDatabase = db(),
): Promise<Scope | null> {
  const [own] = await database
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.personal, userId))
    .limit(1);

  if (!own) return null;
  return { userId, organizationId: own.id as OrganizationId };
}

/**
 * Resolve the active organization for a request.
 *
 * Falls back to the personal organization whenever the requested one is missing, unknown,
 * or not one the user belongs to — so a stale or forged cookie degrades to "your own
 * workspace" rather than to an error page or, far worse, to someone else's data.
 */
export async function resolveScope(
  userId: UserId,
  requested: string | undefined,
  database: KeelDatabase = db(),
): Promise<Scope | null> {
  if (requested) {
    const scope = await scopeFor(userId, requested, database);
    if (scope) return scope;
  }
  return (await personalScope(userId, database)) ?? ensurePersonalOrganization(userId, database);
}

/**
 * Ensure a user has a personal organization, creating one if not.
 *
 * Called on every scope resolution rather than only at sign-up. A user who exists without
 * one has no workspace at all — every page throws — and that state can arise from a
 * sign-up that raced, a restored backup, or a user created outside the app. Making this
 * idempotent and cheap is worth far more than assuming the sign-up path is the only way a
 * user comes into existence.
 */
export async function ensurePersonalOrganization(
  userId: UserId,
  database: KeelDatabase = db(),
): Promise<Scope> {
  const existing = await personalScope(userId, database);
  if (existing) return existing;

  const [profile] = await database
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  const organizationId = `org_${userId}`;
  await database.transaction(async (tx) => {
    await tx
      .insert(organization)
      .values({
        id: organizationId,
        name: `${profile?.name || profile?.email || 'Personal'}'s workspace`,
        slug: `personal-${userId}`,
        personal: userId,
      })
      .onConflictDoNothing();
    await tx
      .insert(membership)
      .values({ organizationId, userId, role: 'owner' })
      .onConflictDoNothing();
  });

  return { userId, organizationId: organizationId as OrganizationId };
}

/** Create an organization and make the creator its owner. */
export async function createOrganization(
  userId: UserId,
  input: { name: string; slug: string },
  database: KeelDatabase = db(),
) {
  return database.transaction(async (tx) => {
    const [row] = await tx
      .insert(organization)
      .values({
        id: `org_${crypto.randomUUID()}`,
        name: input.name,
        slug: input.slug,
      })
      .returning();
    if (!row) throw new Error('createOrganization inserted no row');

    await tx.insert(membership).values({
      organizationId: row.id,
      userId,
      role: 'owner',
    });
    return row;
  });
}

/** Add someone to an organization, by email. Owners and admins only. */
export async function addMember(
  scope: Scope,
  input: { email: string; role: 'admin' | 'member' },
  database: KeelDatabase = db(),
): Promise<{ ok: true } | { ok: false; reason: 'not-allowed' | 'no-such-user' | 'personal' }> {
  const [org] = await database
    .select({ personal: organization.personal })
    .from(organization)
    .where(eq(organization.id, scope.organizationId))
    .limit(1);
  // A personal workspace has exactly one member, permanently.
  if (org?.personal) return { ok: false, reason: 'personal' };

  const [caller] = await database
    .select({ role: membership.role })
    .from(membership)
    .where(
      and(eq(membership.userId, scope.userId), eq(membership.organizationId, scope.organizationId)),
    )
    .limit(1);
  if (!caller || caller.role === 'member') return { ok: false, reason: 'not-allowed' };

  const [recipient] = await database
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, input.email.trim().toLowerCase()))
    .limit(1);
  if (!recipient) return { ok: false, reason: 'no-such-user' };

  await database
    .insert(membership)
    .values({ organizationId: scope.organizationId, userId: recipient.id, role: input.role })
    .onConflictDoUpdate({
      target: [membership.organizationId, membership.userId],
      set: { role: input.role },
    });
  return { ok: true };
}

/** Everyone in an organization. Any member may see who else is in it. */
export async function listMembers(scope: Scope, database: KeelDatabase = db()) {
  return database
    .select({
      userId: membership.userId,
      role: membership.role,
      email: user.email,
      name: user.name,
    })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .where(eq(membership.organizationId, scope.organizationId))
    .orderBy(asc(user.email));
}
