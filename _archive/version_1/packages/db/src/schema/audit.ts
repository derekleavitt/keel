import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { organization } from './organization.ts';

/**
 * The audit log.
 *
 * Two decisions here are deliberate and both look wrong at first glance.
 *
 * **`target_id` has no foreign key.** An audit row must outlive the thing it describes —
 * "who deleted this list" is precisely the question asked after the list is gone, and a
 * foreign key would cascade the answer away with it. The cost is that a target id can
 * dangle, which is correct: the record is of an event, not of a relationship.
 *
 * **The actor is denormalised.** `actor_email` is copied at write time rather than joined
 * on demand, because an account can be deleted or an address changed and the log must
 * still say who did it *then*. A join would quietly rewrite history every time someone
 * updated their profile.
 *
 * `organization_id` does keep its foreign key: an audit log for a tenant that no longer
 * exists has no reader.
 */
export const auditEntry = pgTable(
  'audit_entry',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    /** Who. Denormalised on purpose — see above. */
    actorId: text('actor_id').notNull(),
    actorEmail: text('actor_email').notNull(),

    /** What happened, as `resource.verb`: `list.created`, `todo.deleted`. */
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),

    /**
     * A human-readable line, written at the time.
     *
     * Rendering the feed from ids alone means loading rows that may be gone, so the
     * sentence is composed when the event happens and stored with it. Everything needed to
     * display an entry is in the entry.
     */
    summary: text('summary').notNull(),

    /** Anything worth keeping that does not fit the columns. Never used for filtering. */
    detail: jsonb('detail'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [
    // The two ways a feed is read: everything in a tenant, or the history of one thing.
    index('audit_org_time_idx').on(table.organizationId, table.createdAt),
    index('audit_target_idx').on(table.targetType, table.targetId),
  ],
);

export const auditTables = { auditEntry };
