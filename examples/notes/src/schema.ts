import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * PATTERN: table definition.
 *
 * In a real feature this file's contents live in `packages/db/src/schema/<feature>.ts`,
 * with two lines added to `packages/db/src/schema/index.ts` — one re-export and one
 * spread. It is kept local here only so the example does not add tables to the product
 * schema of a template people clone.
 *
 * Everything else about the shape is faithful:
 * - `userId` on every row, because scoping is enforced in queries, not the UI
 * - explicit `createdAt`/`updatedAt`
 * - cascade points inward (deleting a user removes their notes), never outward
 */
export const note = pgTable('example_note', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  createdAt: timestamp('created_at')
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp('updated_at')
    .$defaultFn(() => new Date())
    .notNull(),
});

export const noteTables = { note };
