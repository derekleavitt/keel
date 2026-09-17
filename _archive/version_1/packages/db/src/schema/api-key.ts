import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { user } from './auth.ts';
import { organization } from './organization.ts';

/**
 * API keys, stored as a split token.
 *
 * A key presented as `keel_sk_<selector><verifier>` is checked in two halves:
 *
 * - **`selector`** is stored in the clear and uniquely indexed. It is what turns
 *   verification into a single indexed lookup instead of a scan.
 * - **`verifierHash`** is a SHA-256 of the other half and is the only proof of possession.
 *
 * Storing one half in the clear is not a weakness — it identifies the row and grants
 * nothing. The alternative, hashing the whole token, forces either a full table scan
 * hashing every candidate, or an unsalted hash used as a lookup key, which is the same
 * exposure with worse performance.
 *
 * SHA-256 rather than a password hash on purpose: a key is 128 bits of machine-generated
 * randomness, not a human-chosen secret, so there is no dictionary to slow down. bcrypt
 * here would add latency to every API request and defend against nothing.
 *
 * **The full token exists only in the response that created it.** Nothing in this table
 * can reconstruct it, which is the point.
 */
export const apiKey = pgTable(
  'api_key',
  {
    id: text('id').primaryKey(),

    /**
     * A key belongs to an organization, and that is the tenancy boundary it can never
     * cross. Not derived from the user at request time — a key issued for one tenant must
     * keep meaning that tenant even if its creator later joins others.
     */
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    /**
     * The user the key acts as.
     *
     * Membership is re-checked on every request rather than trusted from this column, so
     * removing someone from an organization disables their keys for it immediately. See
     * `packages/auth/src/api-key.ts`.
     */
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    /** What a human calls it in the UI. Not unique — two "CI" keys are a normal mistake. */
    name: text('name').notNull(),

    selector: text('selector').notNull(),
    verifierHash: text('verifier_hash').notNull(),

    /**
     * Cheap last-seen, updated on use.
     *
     * Deliberately not an access log: this table would become the hottest write in the
     * system. `audit_entry` records what a key actually did; this answers only "is this
     * key still in use", which is the question asked before revoking one.
     */
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),

    /**
     * Revocation is a timestamp, not a delete.
     *
     * A revoked key that vanishes takes with it the answer to "was this key active when
     * that happened", which is exactly the question asked after a leak.
     */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Verification is a single lookup on this index, on every API request.
    uniqueIndex('api_key_selector_idx').on(table.selector),
    index('api_key_org_idx').on(table.organizationId),
  ],
);

export const apiKeyTables = { apiKey };
