import { date, index, integer, jsonb, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './auth.ts';
import { list } from './list.ts';
import { organization } from './organization.ts';
import { todoPriority } from './todo.ts';

export const recurrenceFrequency = pgEnum('recurrence_frequency', ['daily', 'weekly', 'monthly']);

/**
 * A repeating series.
 *
 * The rule is the template; the generated todos are ordinary rows that happen to point
 * back at it. That direction matters — it means every existing query, filter, share and
 * webhook works on a recurring todo with no changes, and a series can be deleted without
 * taking its history with it.
 */
export const recurrenceRule = pgTable(
  'recurrence_rule',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    listId: text('list_id')
      .notNull()
      .references(() => list.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    /** What each generated todo says. Editing these changes only future occurrences. */
    title: text('title').notNull(),
    notes: text('notes'),
    priority: todoPriority('priority').default('none').notNull(),

    frequency: recurrenceFrequency('frequency').notNull(),
    interval: integer('interval').default(1).notNull(),
    /** Weekly only: `[1,4]` is Monday and Thursday. 0 is Sunday. */
    byWeekday: jsonb('by_weekday').$type<number[]>(),

    startDate: date('start_date', { mode: 'string' }).notNull(),
    until: date('until', { mode: 'string' }),

    /**
     * The zone the series is anchored to.
     *
     * Not a display preference — it decides what "today" means for this series, and
     * therefore which day each occurrence lands on. A series without one would generate
     * against the server's timezone, which is nobody's. See `@keel/scheduling`.
     */
    timeZone: text('time_zone').notNull(),

    /**
     * How far generation has run. Load-bearing, in a way worth being precise about.
     *
     * It is **not** what prevents duplicates — the unique index on
     * `(recurrence_rule_id, occurrence_date)` does that, and would even if this column
     * were always null.
     *
     * What it prevents is **resurrection**. Generation resumes from the day after this,
     * so an occurrence the user deleted is never revisited. Without it, the next sweep
     * would find no conflicting row and helpfully recreate the todo somebody had just
     * thrown away — the single most infuriating bug a recurring-task feature can have.
     */
    generatedThrough: date('generated_through', { mode: 'string' }),

    pausedAt: timestamp('paused_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('recurrence_rule_org_idx').on(table.organizationId),
    index('recurrence_rule_list_idx').on(table.listId),
  ],
);

export const recurrenceTables = { recurrenceRule };
