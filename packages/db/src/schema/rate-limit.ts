import { bigint, index, pgTable, text } from 'drizzle-orm/pg-core';

/**
 * Rate-limit counters.
 *
 * In Postgres rather than in memory, because "shared across instances" is the requirement
 * that decides the design. A per-process counter is not a rate limit — it is a rate limit
 * divided by however many instances happen to be running, which is a number nobody chose and
 * which changes when the platform scales. Under serverless it is worse still: each cold
 * start begins at zero, so an attacker who forces new instances has no limit at all.
 *
 * The table is deliberately tiny and written with a single statement per request. Everything
 * that makes rate limiting subtle — the read, the window roll and the increment — happens
 * inside one `insert … on conflict do update`, because any version that reads and then writes
 * is two instances away from being wrong.
 *
 * Two counters, not one: this is a **sliding window counter**. A plain fixed window lets a
 * client send its whole allowance at 0:59 and again at 1:00 — twice the limit in two seconds,
 * while every individual window looks compliant. Weighting the previous window by how much of
 * it still overlaps costs one extra integer and removes that.
 */
export const rateLimitBucket = pgTable(
  'rate_limit_bucket',
  {
    /** `key:<id>` or `ip:<addr>`, scoped by route family. Opaque here. */
    key: text('key').primaryKey(),

    /** Start of the current window, as epoch milliseconds. */
    windowStart: bigint('window_start', { mode: 'number' }).notNull(),
    currentCount: bigint('current_count', { mode: 'number' }).notNull(),
    /** The window before this one, kept so the boundary can be smoothed. */
    previousCount: bigint('previous_count', { mode: 'number' }).notNull(),
  },
  // Pruning only: the read path is always by primary key.
  (table) => [index('rate_limit_window_idx').on(table.windowStart)],
);

export const rateLimitTables = { rateLimitBucket };
