import { type SQL, sql } from 'drizzle-orm';
import {
  boolean,
  date,
  doublePrecision,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { user } from './auth.ts';
import { list } from './list.ts';
import { tsvector } from './tsvector.ts';

/**
 * Todos.
 *
 * `listId` cascades from `list`: deleting a list removes its todos. The PRD requires
 * offering to move them first, which is a product decision enforced in the UI — the
 * cascade is the backstop for when a list genuinely goes, not the primary path.
 *
 * Note the foreign key crosses what would be two feature packages. It is expressible only
 * because all tables live in this module; a table defined inside `testbed/lists` could not
 * be referenced from `testbed/todos` without a workspace cycle. That constraint drove the
 * schema layout and is worth remembering before anyone proposes moving tables out.
 */
/**
 * Priority, declared least-to-most urgent.
 *
 * Postgres orders an enum by declaration, so `desc(priority)` means "most urgent first"
 * with no CASE expression. Reordering these values silently reorders every query that
 * sorts by priority.
 */
export const todoPriority = pgEnum('todo_priority', ['none', 'low', 'medium', 'high']);

export const todo = pgTable(
  'todo',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    listId: text('list_id')
      .notNull()
      .references(() => list.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    notes: text('notes'),
    done: boolean('done')
      .$defaultFn(() => false)
      .notNull(),
    /**
     * A DATE, not a timestamp. "Due Tuesday" means Tuesday in every timezone, and
     * `mode: 'string'` keeps it a bare YYYY-MM-DD on both sides of the driver.
     *
     * `date('due_date')` without the mode returns a JS Date, which reintroduces exactly
     * the timezone bug the PRD names as the classic failure in this category.
     */
    dueDate: date('due_date', { mode: 'string' }),
    /**
     * `.default()`, not `.$defaultFn()`.
     *
     * `$defaultFn` is a JavaScript-side default — it never reaches SQL, so a generated
     * migration adds this column as NOT NULL with no DEFAULT and fails on any table that
     * already has rows. A test database is always empty, so nothing catches it there.
     */
    priority: todoPriority('priority').default('none').notNull(),
    position: doublePrecision('position').notNull(),

    /**
     * The series this todo was generated from, and which occurrence it is.
     *
     * Nullable because most todos are not recurring. The pair carries a unique index, and
     * **that index is the idempotency guarantee** — generation inserts with
     * `on conflict do nothing`, so running the generator twice, or three overlapping
     * workers running it at once, cannot produce a duplicate. No application-level "have I
     * already done this" check can offer that under concurrency.
     *
     * `set null` rather than cascade on delete: deleting a series must not delete the
     * todos it already produced, which are real work somebody may have done.
     */
    /**
     * The full-text index, as a **generated column**.
     *
     * Not a trigger and not a background reindex job, and the difference is the whole
     * acceptance criterion "indexing keeps up with writes": there is no indexing step to
     * fall behind. Postgres computes this inside the same statement that writes the row, so
     * a todo is searchable in the transaction that created it and cannot be stale — not
     * after a crash, not after a bulk import, not after a migration that forgot to reindex.
     *
     * The weights matter: a match in a title (`A`) outranks one in notes (`B`). `coalesce`
     * because `to_tsvector(null)` is null, and a null vector matches nothing — which would
     * silently exclude every todo without notes from search entirely.
     */
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('english', coalesce(${todo.title}, '')), 'A') || setweight(to_tsvector('english', coalesce(${todo.notes}, '')), 'B')`,
    ),

    recurrenceRuleId: text('recurrence_rule_id'),
    occurrenceDate: date('occurrence_date', { mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [
    // Ordering within a list: done rows sink, then position decides.
    index('todo_list_done_position_idx').on(table.userId, table.listId, table.done, table.position),
    // The cross-list "due today" view (T-07) reads by date, not by list.
    index('todo_user_due_idx').on(table.userId, table.dueDate),
    // GIN, not btree: a btree index cannot answer a `@@` containment query at all.
    index('todo_search_idx').using('gin', table.searchVector),
    // The idempotency guarantee. Partial, so the millions of non-recurring todos are not
    // in it and two null occurrence dates never collide.
    uniqueIndex('todo_occurrence_idx')
      .on(table.recurrenceRuleId, table.occurrenceDate)
      .where(sql`${table.recurrenceRuleId} is not null`),
  ],
);

export const todoTables = { todo };
export const todoEnums = { todoPriority };
