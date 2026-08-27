import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Authentication tables.
 *
 * Column names and types are dictated by the Better Auth Drizzle adapter — do not
 * rename them. Application tables belong in their own feature package rather than
 * being appended here.
 */

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified')
    .$defaultFn(() => false)
    .notNull(),
  image: text('image'),
  createdAt: timestamp('created_at')
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp('updated_at')
    .$defaultFn(() => new Date())
    .notNull(),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').$defaultFn(() => new Date()),
});

/**
 * Tables owned by the auth layer. Dictated by the Better Auth adapter.
 */
export const authTables = { user, session, account, verification };

/**
 * The full schema handed to Drizzle and to Better Auth.
 *
 * Assembled from per-area spreads rather than one flat literal. A feature adds its
 * tables above and a single `...featureTables` line here — so parallel branches append
 * distinct lines instead of all editing the same one. That turns the most collision-prone
 * line in the repo into a mechanical merge.
 *
 * Feature tables must live in this file: `drizzle.config.ts` reads only this module, and
 * moving them into feature packages would require `@keel/db` to import those packages,
 * which is a workspace dependency cycle.
 */
export const schema = {
  ...authTables,
};
