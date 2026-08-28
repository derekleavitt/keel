import { index, integer, jsonb, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The job queue.
 *
 * Backed by Postgres rather than Redis or a hosted queue, deliberately. It is one fewer
 * service to run, back up and secure; a job can be enqueued **in the same transaction as
 * the write that caused it**, so "row saved but job lost" cannot happen; and `FOR UPDATE
 * SKIP LOCKED` gives safe concurrent claiming without a broker.
 *
 * The honest limit: this handles thousands of jobs per minute, not millions. When that
 * stops being enough, the handler registry and the queue interface stay — only the claim
 * mechanism changes. That is why `enqueue`/`claim` are an interface rather than raw SQL
 * scattered through features.
 */
export const jobStatus = pgEnum('job_status', ['pending', 'running', 'failed', 'dead']);

export const job = pgTable(
  'job',
  {
    id: text('id').primaryKey(),
    /** Which handler runs this. Unknown kinds dead-letter rather than blocking the queue. */
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull(),
    status: jobStatus('status').default('pending').notNull(),
    /** Not before this instant. Backoff moves it forward; scheduling sets it ahead. */
    runAt: timestamp('run_at', { withTimezone: true }).notNull(),
    attempts: integer('attempts').default(0).notNull(),
    maxAttempts: integer('max_attempts').default(5).notNull(),
    lastError: text('last_error'),
    /**
     * Optional idempotency key. A unique index means enqueuing the same logical job twice
     * is a no-op — which is what makes a daily digest safe to schedule from more than one
     * place, or to retry after a partial failure.
     */
    uniqueKey: text('unique_key').unique(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [
    // The claim query's index: pending work, oldest first.
    index('job_claim_idx').on(table.status, table.runAt),
  ],
);

export const jobTables = { job };
export const jobEnums = { jobStatus };
