import { bigserial, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { organization } from './organization.ts';

/**
 * The change log that drives live updates.
 *
 * A table rather than `LISTEN`/`NOTIFY`, and the reason is the whole design.
 *
 * `NOTIFY` delivers to whoever is connected *at that moment* and to nobody else. A client
 * that reconnects — a laptop waking, a phone changing network, a deploy restarting the
 * server — has no way to learn what it missed, so "reconnects recover missed state" cannot
 * be built on it without adding a durable log anyway. It also needs a dedicated connection
 * held open per listener, which is precisely what serverless deployment does not give you.
 *
 * A monotonic `id` makes the cursor trivial: a client says "I have seen 41", the server
 * answers with everything above 41. Reconnection and first connection are the same code
 * path, which means the recovery path is exercised on every page load rather than only
 * during the incident it exists for.
 *
 * The cost is polling the log rather than being pushed to. That is a real cost and it is
 * bounded: one indexed query per connected client per interval, against a table that is
 * pruned. Postgres does this comfortably at the scale this template is honest about, and
 * swapping in a broker later changes `packages/realtime` and nothing else.
 */
export const changeLog = pgTable(
  'change_log',
  {
    /** The cursor. Monotonic, gapless enough for `>` comparison, never reused. */
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    /**
     * What changed, as `resource:id` — `list:lst_123`.
     *
     * Deliberately coarse. A client learns *that* something in a list changed and refetches;
     * it does not receive the change itself. That means the payload can never disagree with
     * the database, and — more importantly — a subscriber cannot be shown data the server
     * would have refused them, because the refetch goes through the ordinary authorized
     * query. Sending diffs down the socket would require re-implementing every visibility
     * rule at the socket layer.
     */
    channel: text('channel').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // The only read: "everything on these channels above this cursor".
    index('change_log_channel_idx').on(table.channel, table.id),
    // Pruning, and the tenancy filter on every query.
    index('change_log_org_time_idx').on(table.organizationId, table.createdAt),
  ],
);

export const changeLogTables = { changeLog };
