import { doublePrecision, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './auth.ts';

/**
 * A user's lists. Everything else in the product hangs off one of these.
 *
 * `position` is a float rather than a contiguous integer so dragging a row between two
 * siblings writes exactly one row — the new position is the midpoint of its neighbours.
 * See `@keel/testbed-lists` for the arithmetic and the renumbering fallback.
 *
 * The cascade from `user` is deliberate: deleting an account removes its lists. Deleting
 * a *list* is a product decision — the PRD requires offering to move its todos first —
 * and so belongs to the todo territory's foreign key, not here.
 */
export const list = pgTable(
  'list',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    colour: text('colour'),
    position: doublePrecision('position').notNull(),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [index('list_user_position_idx').on(table.userId, table.position)],
);

export const listTables = { list };
