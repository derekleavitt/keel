import {
  doublePrecision,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { user } from './auth.ts';
import { organization } from './organization.ts';

/** Viewer may read; editor may also change todos. Owners are not stored as shares. */
export const listShareRole = pgEnum('list_share_role', ['viewer', 'editor']);

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
    /** The tenant this row belongs to. Nothing is ever visible across two. */
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    colour: text('colour'),
    position: doublePrecision('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [index('list_user_position_idx').on(table.userId, table.position)],
);

/**
 * Who else can see a list, and what they may do with it.
 *
 * The **list is the authorization boundary**: todos inherit access from the list they
 * belong to rather than carrying their own grants. That keeps one ACL to reason about
 * instead of one per row, and it is why a todo's `userId` records who *created* it and no
 * longer decides who may see it.
 *
 * Composite primary key, so a user cannot hold two grants on one list — re-sharing at a
 * different level is an update, not a second row that silently wins.
 */
export const listShare = pgTable(
  'list_share',
  {
    listId: text('list_id')
      .notNull()
      .references(() => list.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: listShareRole('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.listId, table.userId] }),
    index('list_share_user_idx').on(table.userId),
  ],
);

export const listTables = { list, listShare };
export const listEnums = { listShareRole };
