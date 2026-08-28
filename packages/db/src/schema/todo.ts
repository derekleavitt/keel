import {
  boolean,
  date,
  doublePrecision,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { user } from './auth.ts';
import { list } from './list.ts';

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
  ],
);

export const todoTables = { todo };
export const todoEnums = { todoPriority };
