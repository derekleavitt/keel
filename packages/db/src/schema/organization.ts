import { index, pgEnum, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './auth.ts';

/**
 * Tenancy.
 *
 * An organization is the outermost boundary: every list and every tag belongs to exactly
 * one, and nothing is ever visible across two. Sharing (see `list_share`) operates *inside*
 * an organization — a grant can never reach someone who is not a member.
 *
 * Todos deliberately carry no `organization_id`. They inherit tenancy from their list, the
 * same way they inherit access, so there is one place that decides which tenant a todo
 * belongs to rather than two that can disagree.
 */
export const membershipRole = pgEnum('membership_role', ['owner', 'admin', 'member']);

export const organization = pgTable('organization', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Stable, human-readable handle. Unique so it can appear in a URL later. */
  slug: text('slug').notNull().unique(),
  /**
   * A personal organization is created for every user on sign-up and cannot be left or
   * deleted — it is where their own lists live, and having one guarantees every user
   * always has somewhere to work.
   */
  personal: text('personal_for_user_id').references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at')
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp('updated_at')
    .$defaultFn(() => new Date())
    .notNull(),
});

export const membership = pgTable(
  'membership',
  {
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: membershipRole('role').notNull(),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId] }),
    index('membership_user_idx').on(table.userId),
  ],
);

export const organizationTables = { organization, membership };
export const organizationEnums = { membershipRole };
