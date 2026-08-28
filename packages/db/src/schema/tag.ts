import { index, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { user } from './auth.ts';
import { organization } from './organization.ts';
import { todo } from './todo.ts';

/**
 * Tags, and the join table that attaches them to todos.
 *
 * **Tags are global to the user, never scoped to a list.** There is deliberately no
 * `listId` here: slicing across lists is the entire reason tags exist, and a column
 * naming one list would make the cross-list view impossible to express. The uniqueness
 * constraint is `(user_id, name)` for the same reason — one "urgent" per person, not one
 * per list.
 *
 * ## Cascade directions
 *
 * Both foreign keys on `todo_tag` point *out* at their parents, so deletion cascades
 * *in* to the join table and stops there:
 *
 * ```
 *   tag ──cascade──▶ todo_tag ◀──cascade── todo
 * ```
 *
 * Deleting a tag removes its rows in `todo_tag` and touches no todo; deleting a todo
 * removes its rows in `todo_tag` and touches no tag. The PRD requires the first of those
 * explicitly ("deleting a tag removes it from todos but never deletes the todos"), and a
 * comment saying so is worth nothing — `packages/db/src/schema/schema.test.ts` and
 * `testbed/tags/src/queries.test.ts` assert it structurally and behaviourally.
 *
 * The failure this guards against is a foreign key declared the other way round — a
 * `tagId` column on `todo` with `onDelete: 'cascade'` — which reads as a reasonable
 * one-to-many shortcut and silently deletes a user's todos the first time they tidy up
 * their tags.
 */
export const tag = pgTable(
  'tag',
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
    createdAt: timestamp('created_at', { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [
    // One tag of a given name per user. Inline creation relies on this: "create it if it
    // is not already there" is only well defined if the database agrees what "already
    // there" means.
    uniqueIndex('tag_user_name_idx').on(table.userId, table.name),
  ],
);

export const todoTag = pgTable(
  'todo_tag',
  {
    todoId: text('todo_id')
      .notNull()
      .references(() => todo.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tag.id, { onDelete: 'cascade' }),
    // Denormalised so the join table can be scoped by the same `ownedBy()` discipline as
    // every other table, without a join back to `todo` just to prove ownership.
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [
    // A todo carries a tag once or not at all; attaching twice is a no-op, not a duplicate.
    primaryKey({ columns: [table.todoId, table.tagId] }),
    // "Which todos carry this tag", the cross-list query tags exist for.
    index('todo_tag_user_tag_idx').on(table.userId, table.tagId),
  ],
);

export const tagTables = { tag, todoTag };
