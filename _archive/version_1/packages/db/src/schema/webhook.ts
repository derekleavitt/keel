import { index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { organization } from './organization.ts';

/**
 * A receiver's subscription.
 *
 * Events are a `jsonb` array rather than a join table: subscriptions are read on every
 * dispatch and written almost never, the list is short, and there is no query that asks
 * "who subscribes to X" other than the dispatch itself, which already has the org.
 */
export const webhookEndpoint = pgTable(
  'webhook_endpoint',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    url: text('url').notNull(),

    /**
     * The signing secret, stored in the clear — and it has to be.
     *
     * Unlike an API key, this is a *shared* secret: the receiver holds the same value and
     * both sides compute the same HMAC. A one-way hash would make signing impossible. It
     * is shown once at creation and thereafter only as a hint, which limits exposure
     * through the UI without pretending the column is not sensitive.
     */
    secret: text('secret').notNull(),

    /** Event names this endpoint wants, e.g. `["todo.created","todo.completed"]`. */
    events: jsonb('events').$type<string[]>().notNull(),

    /**
     * Set when deliveries have failed persistently.
     *
     * A dead endpoint that stays subscribed generates work forever — every event queues a
     * delivery that will never succeed. Disabling is reversible and visible; deleting the
     * row would lose the history of why.
     */
    disabledAt: timestamp('disabled_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('webhook_endpoint_org_idx').on(table.organizationId)],
);

/**
 * One attempt-tracked delivery of one event to one endpoint.
 *
 * Separate from the job row on purpose. A job is deleted when it succeeds — that is what
 * keeps the queue table small — so a queue alone can answer "what is failing now" and
 * never "what did we send yesterday, and did they get it". Replay needs the payload after
 * the job is gone, so the payload lives here.
 */
export const webhookDelivery = pgTable(
  'webhook_delivery',
  {
    id: text('id').primaryKey(),
    endpointId: text('endpoint_id')
      .notNull()
      .references(() => webhookEndpoint.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    event: text('event').notNull(),
    payload: jsonb('payload').notNull(),

    /** `pending` · `delivered` · `failed` — failed meaning retries are exhausted. */
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    responseStatus: integer('response_status'),
    lastError: text('last_error'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  (table) => [
    index('webhook_delivery_endpoint_idx').on(table.endpointId, table.createdAt),
    // The admin view's query: what is broken, newest first.
    index('webhook_delivery_status_idx').on(table.status, table.createdAt),
  ],
);

export const webhookTables = { webhookEndpoint, webhookDelivery };
