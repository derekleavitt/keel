import type { OrganizationId, Scope } from '@keel/contracts/ids';
import { db, type KeelDatabase } from '@keel/db';
import { billingEvent, subscription } from '@keel/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { effectivePlan, type LimitName, limitFor, type PlanName } from './plans.ts';
import type { ProviderEvent } from './provider.ts';

export * from './plans.ts';
export type { BillingProvider, CheckoutRequest, ProviderEvent } from './provider.ts';
export { stubProvider } from './provider.ts';

/**
 * The tenant's entitlements, creating a free subscription if there is none.
 *
 * Idempotent and cheap, and called on every limit check rather than only at sign-up — for
 * the same reason `ensurePersonalOrganization` is: a tenant with no row has no entitlements
 * at all, and that state can arise from a restored backup, a race, or an organization
 * created outside the app. Making the common path self-healing is worth more than trusting
 * that one creation path is the only one.
 */
export async function entitlements(
  organizationId: OrganizationId,
  database: KeelDatabase = db(),
): Promise<{ plan: PlanName; status: string; seats: number; currentPeriodEnd: Date | null }> {
  const [row] = await database
    .select()
    .from(subscription)
    .where(eq(subscription.organizationId, organizationId))
    .limit(1);

  if (!row) {
    await database.insert(subscription).values({ organizationId }).onConflictDoNothing();
    return { plan: 'free', status: 'active', seats: 1, currentPeriodEnd: null };
  }

  return {
    // A cancelled subscription falls back to `free`, not to nothing: a former customer can
    // still read and export what they wrote.
    plan: effectivePlan(row.plan, row.status),
    status: row.status,
    seats: row.seats,
    currentPeriodEnd: row.currentPeriodEnd,
  };
}

export interface LimitCheck {
  allowed: boolean;
  used: number;
  limit: number | null;
  plan: PlanName;
}

/**
 * Whether a tenant may add one more of something.
 *
 * **The caller supplies `used`.** Billing deliberately cannot count lists, todos or files:
 * doing so would mean this package knowing which tables a feature owns, and every new
 * limited resource would then require editing billing rather than the feature that has it.
 *
 * The inversion also keeps the direction of dependency honest — a first attempt had billing
 * counting `list` rows, which made `@keel/billing` and `@keel/testbed-lists` depend on each
 * other and Turbo refuse the graph outright. The cycle was the design telling on itself.
 *
 * Returns the numbers as well as the verdict, because "you have reached your limit" without
 * the limit is a message nobody can act on.
 */
export async function checkLimit(
  organizationId: OrganizationId,
  limit: LimitName,
  used: number,
  database: KeelDatabase = db(),
): Promise<LimitCheck> {
  const { plan } = await entitlements(organizationId, database);
  const allowance = limitFor(plan, limit);

  return { allowed: allowance === null || used < allowance, used, limit: allowance, plan };
}

/** Thrown when a write would exceed a plan limit. Carries the numbers for the message. */
export class LimitExceededError extends Error {
  constructor(
    readonly limit: LimitName,
    readonly check: LimitCheck,
  ) {
    super(`Plan limit reached: ${check.used}/${check.limit} ${limit}`);
  }
}

/**
 * Reconcile a provider event into local state.
 *
 * Two distinct hazards, two distinct mechanisms, and conflating them is how one of them
 * quietly stops working:
 *
 * | Hazard | Prevented by |
 * |---|---|
 * | the same event delivered twice | the primary key on `billing_event.id` |
 * | events arriving out of order | comparing against `subscription.last_event_at` |
 *
 * The first is a constraint, not a check — providers retry aggressively and two retries can
 * be in flight at once, so a read-then-write would race. The second cannot be a constraint:
 * an older event is a legitimate delivery that must be recorded and *not applied*.
 */
export async function applyProviderEvent(
  event: ProviderEvent,
  database: KeelDatabase = db(),
): Promise<{ applied: boolean; reason?: string }> {
  return database.transaction(async (tx) => {
    const inserted = await tx
      .insert(billingEvent)
      .values({
        id: event.id,
        type: event.type,
        organizationId: event.organizationId,
        eventAt: event.createdAt,
      })
      .onConflictDoNothing()
      .returning({ id: billingEvent.id });

    // Already processed. Success, not an error — the provider is retrying, and telling it
    // otherwise makes it retry harder.
    if (inserted.length === 0) return { applied: false, reason: 'duplicate' };

    const [current] = await tx
      .select()
      .from(subscription)
      .where(eq(subscription.organizationId, event.organizationId))
      .limit(1);

    if (!current) {
      await tx
        .update(billingEvent)
        .set({ skippedReason: 'unknown organization' })
        .where(eq(billingEvent.id, event.id));
      return { applied: false, reason: 'unknown organization' };
    }

    if (current.lastEventAt && current.lastEventAt >= event.createdAt) {
      await tx
        .update(billingEvent)
        .set({ skippedReason: 'stale' })
        .where(eq(billingEvent.id, event.id));
      return { applied: false, reason: 'stale' };
    }

    const canceled = event.type === 'subscription.canceled';
    await tx
      .update(subscription)
      .set({
        plan: canceled ? 'free' : ((event.plan as PlanName | undefined) ?? current.plan),
        status: canceled ? 'canceled' : ((event.status as 'active') ?? current.status),
        seats: canceled ? 1 : (event.seats ?? current.seats),
        currentPeriodEnd: canceled ? null : (event.currentPeriodEnd ?? current.currentPeriodEnd),
        providerCustomerId: event.providerCustomerId ?? current.providerCustomerId,
        providerSubscriptionId: event.providerSubscriptionId ?? current.providerSubscriptionId,
        lastEventAt: event.createdAt,
        updatedAt: new Date(),
      })
      .where(eq(subscription.organizationId, event.organizationId));

    return { applied: true };
  });
}

/**
 * Everything the billing screen needs, given counts the caller has measured.
 *
 * The page composes this from the features that own each resource, which is the same shape
 * as every other cross-feature read here — see `docs/adr/0001-cross-feature-read-models.md`.
 */
export async function billingSummary(
  scope: Scope,
  counts: Record<LimitName, number>,
  database: KeelDatabase = db(),
) {
  const current = await entitlements(scope.organizationId, database);
  const [lists, seats] = await Promise.all([
    checkLimit(scope.organizationId, 'lists', counts.lists, database),
    checkLimit(scope.organizationId, 'seats', counts.seats, database),
  ]);
  return { ...current, lists, seats };
}

/** Recent provider events, so a billing problem is diagnosable without the provider's dashboard. */
export async function recentBillingEvents(
  organizationId: OrganizationId,
  database: KeelDatabase = db(),
  limit = 20,
) {
  return database
    .select()
    .from(billingEvent)
    .where(and(eq(billingEvent.organizationId, organizationId)))
    .orderBy(sql`${billingEvent.receivedAt} desc`)
    .limit(limit);
}
