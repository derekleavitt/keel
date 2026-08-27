import type { UserId } from '@keel/contracts/ids';
import { db } from '@keel/db';
import type { schema } from '@keel/db/schema';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { note } from './schema.ts';

/**
 * PATTERN: the query layer. This is the file to copy.
 *
 * Three things here are load-bearing, and every one of them was independently invented
 * three different ways by three agents before this example existed.
 *
 * 1. THE DATABASE SEAM. `db()` returns a postgres-js handle; `createTestDatabase()`
 *    returns a PGlite one. `PgDatabase<PgQueryResultHKT, typeof schema>` is the
 *    supertype both satisfy, so one helper runs against production Postgres and against
 *    real Postgres-in-WASM in tests. Without this, the security-critical layer can only
 *    be typechecked, never executed.
 *
 * 2. THE HANDLE GOES LAST, WITH A DEFAULT. `userId` must be first (see
 *    .claude/rules/server-actions.md) and `db()` must stay lazy (see CLAUDE.md), so the
 *    handle is a trailing parameter defaulting to `db()`. Defaults evaluate per call, so
 *    importing this module opens no connection and `pnpm verify` still passes with no
 *    `.env`.
 *
 * 3. THE PARAMETER ORDER IS A CONTRACT, NOT A STYLE. `userId` first, then the arguments
 *    the operation needs, then the database handle **last**. Never insert a parameter
 *    before the handle: an all-optional options type is satisfied by *any* object, so
 *    TypeScript will happily accept the database sitting in the new slot and the query
 *    will silently run against a default connection. New options go inside an existing
 *    options object. See .orchestration/lessons/L-017.md.
 *
 * 4. SCOPING IS STRUCTURAL, NOT REMEMBERED. `userId` is the branded `UserId`, so a raw
 *    string will not type-check — an unvalidated id cannot reach this layer at all. Every
 *    statement goes through `ownedBy()`, so forgetting the scope means writing no
 *    predicate at all rather than writing a leaky one.
 */
export type NotesDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * Scope every statement to one user.
 *
 * `and()` returns `SQL | undefined`, and `noNonNullAssertion` bans `and(...)!`. The
 * `?? owner` fallback is not a workaround — it is safer than the assertion, because the
 * degenerate case is "this user's rows" rather than "every row".
 */
function ownedBy(userId: UserId, ...narrowing: (SQL | undefined)[]): SQL {
  const owner = eq(note.userId, userId);
  return and(owner, ...narrowing) ?? owner;
}

export async function listNotes(userId: UserId, database: NotesDatabase = db()) {
  return database.select().from(note).where(ownedBy(userId)).orderBy(desc(note.updatedAt));
}

export async function getNote(userId: UserId, id: string, database: NotesDatabase = db()) {
  const [row] = await database
    .select()
    .from(note)
    .where(ownedBy(userId, eq(note.id, id)))
    .limit(1);
  return row ?? null;
}

export async function createNote(
  userId: UserId,
  input: { title: string; body?: string | null },
  database: NotesDatabase = db(),
) {
  const [row] = await database
    .insert(note)
    .values({
      id: `note_${crypto.randomUUID()}`,
      userId,
      title: input.title,
      body: input.body ?? null,
    })
    .returning();
  if (!row) throw new Error('createNote inserted no row');
  return row;
}

export async function updateNote(
  userId: UserId,
  id: string,
  patch: { title?: string; body?: string | null },
  database: NotesDatabase = db(),
) {
  const [row] = await database
    .update(note)
    .set({ ...patch, updatedAt: new Date() })
    .where(ownedBy(userId, eq(note.id, id)))
    .returning();
  return row ?? null;
}

/** Returns whether a row was actually removed, so callers can tell "gone" from "not yours". */
export async function deleteNote(userId: UserId, id: string, database: NotesDatabase = db()) {
  const rows = await database
    .delete(note)
    .where(ownedBy(userId, eq(note.id, id)))
    .returning({ id: note.id });
  return rows.length > 0;
}
