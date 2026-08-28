import { index, integer, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { organization } from './organization.ts';

export const billingPlan = pgEnum('billing_plan', ['free', 'team', 'business']);

/** Mirrors the states a provider actually reports, not a simplification of them. */
export const billingStatus = pgEnum('billing_status', [
  'active',
  'trialing',
  'past_due',
  'canceled',
]);

/**
 * What a tenant is entitled to.
 *
 * A **local mirror** of the provider's state, not the source of truth — the provider owns
 * that. Reconciled by webhook, and readable without a network call, which matters because
 * every limit check reads it: an entitlement lookup that depends on a third party being
 * reachable turns their outage into yours, and fails in whichever direction you did not
 * think about.
 *
 * One row per organization, created on demand at the free plan. There is no "no
 * subscription" state to handle separately — an unpaying tenant is on `free`, which is a
 * plan like any other.
 */
export const subscription = pgTable(
  'subscription',
  {
    organizationId: text('organization_id')
      .primaryKey()
      .references(() => organization.id, { onDelete: 'cascade' }),

    plan: billingPlan('plan').default('free').notNull(),
    status: billingStatus('status').default('active').notNull(),

    /**
     * Seats paid for, which is not the same as seats used.
     *
     * Stored rather than derived: a tenant that downgrades keeps its members until someone
     * removes them, and the limit check has to be able to say "you have 12 people and 10
     * seats" rather than silently locking four of them out.
     */
    seats: integer('seats').default(1).notNull(),

    /** Opaque provider handles. Never parsed, never used for authorization. */
    providerCustomerId: text('provider_customer_id'),
    providerSubscriptionId: text('provider_subscription_id'),

    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),

    /**
     * When the provider event that produced this state was created — **their** clock.
     *
     * This is what makes out-of-order delivery survivable. Webhooks are not ordered: a
     * `canceled` sent at 10:00 can arrive after an `updated` sent at 09:59, and applying
     * them in arrival order would resurrect a cancelled subscription. An event older than
     * this is discarded.
     */
    lastEventAt: timestamp('last_event_at', { withTimezone: true }),

    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('subscription_provider_idx').on(table.providerSubscriptionId)],
);

/**
 * Every provider event we have already applied.
 *
 * The primary key is the **provider's** event id, so replaying one is an
 * `on conflict do nothing` rather than a decision. Providers retry aggressively and will
 * happily deliver the same event a dozen times; a handler that is merely careful is not
 * enough, because two retries can be in flight at once.
 *
 * Kept after processing — this is the record that answers "did we ever receive the
 * cancellation", which is the question asked when a customer says they were billed after
 * cancelling.
 */
export const billingEvent = pgTable(
  'billing_event',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    organizationId: text('organization_id'),
    /** The provider's own creation time, used for ordering. */
    eventAt: timestamp('event_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
    /** Why an event was received but not applied — stale, unknown tenant, unhandled type. */
    skippedReason: text('skipped_reason'),
  },
  (table) => [index('billing_event_time_idx').on(table.receivedAt)],
);

export const billingTables = { subscription, billingEvent };
