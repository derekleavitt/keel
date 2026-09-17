import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './auth.ts';
import { organization } from './organization.ts';

/**
 * Platform staff.
 *
 * **This is a different axis from `membership.role`, and keeping them apart is the whole
 * point of the table.** An organization's `owner` or `admin` administers *their tenant*:
 * they invite people, rename the workspace, manage its keys. A platform admin operates
 * *the service* and can see across tenants.
 *
 * Storing staff as a membership role would mean any customer who makes themselves an admin
 * of their own workspace — which every customer can do, by creating one — acquires the
 * ability to read every other tenant. The two roles share a word and nothing else.
 *
 * A table rather than a column on `user`, for two reasons: the auth tables are dictated by
 * the Better Auth adapter and adding to them invites trouble, and a grant is an event worth
 * recording — who granted it, when, and why.
 */
export const platformAdmin = pgTable('platform_admin', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),

  /** Null for the first admin, which is necessarily granted out of band. */
  grantedBy: text('granted_by'),
  /** Why this person has it. Empty here is a smell, not a convenience. */
  note: text('note'),
  grantedAt: timestamp('granted_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * What staff did.
 *
 * Separate from `audit_entry` because the two answer different questions and have
 * incompatible shapes. A tenant's audit log is scoped by `organization_id` — that scoping
 * is exactly what makes it safe to show a customer — but a platform action often has no
 * tenant at all (retrying a job, listing organizations), and making that column nullable
 * would weaken the one guarantee the tenant log depends on.
 *
 * So staff actions are recorded here, always. When an action *does* target a specific
 * tenant it is **also** written to that tenant's own audit log, so the customer can see
 * that staff touched their data. Transparency is the point; a support tool nobody can
 * audit is indistinguishable from a back door.
 */
export const adminAction = pgTable(
  'admin_action',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id').notNull(),
    /** Denormalised for the same reason as `audit_entry.actor_email`: history must not move. */
    actorEmail: text('actor_email').notNull(),

    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),

    /** The tenant affected, when there is one. Null is normal, not missing data. */
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),

    summary: text('summary').notNull(),
    detail: jsonb('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('admin_action_time_idx').on(table.createdAt),
    index('admin_action_actor_idx').on(table.actorId, table.createdAt),
  ],
);

export const platformTables = { platformAdmin, adminAction };
