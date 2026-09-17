import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Every column below holds an *instant*, so every one is `withTimezone: true`.
 *
 * Drizzle's `timestamp()` defaults to `timestamp without time zone`, which stores the
 * wall-clock digits and forgets which clock they came from. Nothing breaks until something
 * compares in SQL — `expires_at <= now()` reconciles a zone-less column against a
 * zone-aware expression through the *server's* zone, and quietly returns the wrong answer
 * on any server not running in UTC. See `.orchestration/lessons/L-025.md`.
 *
 * Authentication tables.
 *
 * Column names and types are dictated by the Better Auth Drizzle adapter — do not
 * rename them.
 */

/**
 * Every column below holds an *instant*, so every one is `withTimezone: true`.
 *
 * Drizzle's `timestamp()` defaults to `timestamp without time zone`, which stores the
 * wall-clock digits and forgets which clock they came from. Nothing breaks until something
 * compares in SQL — `expires_at <= now()` reconciles a zone-less column against a
 * zone-aware expression through the *server's* zone, and quietly returns the wrong answer
 * on any server not running in UTC. See `.orchestration/lessons/L-025.md`.
 *
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
  createdAt: timestamp('created_at', { withTimezone: true })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .$defaultFn(() => new Date())
    .notNull(),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
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
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  issuer: text('issuer'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at', { withTimezone: true }).$defaultFn(() => new Date()),
});

/**
 * Tables owned by the auth layer. Dictated by the Better Auth adapter.
 */

export const authTables = { user, session, account, verification };
