import { boolean, doublePrecision, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
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
    position: doublePrecision('position').notNull(),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [
    // Ordering within a list: done rows sink, then position decides.
    index('todo_list_done_position_idx').on(table.userId, table.listId, table.done, table.position),
  ],
);

export const todoTables = { todo };
