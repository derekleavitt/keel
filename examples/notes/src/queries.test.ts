import type { UserId } from '@keel/contracts/ids';
import { createTestDatabase, seedUser } from '@keel/db/testing';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNote, deleteNote, getNote, listNotes, updateNote } from './queries.ts';

/**
 * PATTERN: query-layer tests against real Postgres.
 *
 * Two users, always. Cross-user isolation is the assertion that matters most — a query
 * that returns the right rows for its owner and also returns them for a stranger passes
 * every single-user test ever written.
 */
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let owner: UserId;
let stranger: UserId;

beforeEach(async () => {
  database = await createTestDatabase();
  // The example keeps its table local, so create it here. A real feature's table would
  // arrive through the committed migrations that createTestDatabase() already applies.
  await database.execute(sql`
    CREATE TABLE example_note (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      title text NOT NULL,
      body text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  owner = (await seedUser(database, { id: 'owner' })).id as UserId;
  stranger = (await seedUser(database, { id: 'stranger' })).id as UserId;
});

afterEach(async () => {
  await database.close();
});

describe('notes query layer', () => {
  it('round-trips a note', async () => {
    const created = await createNote(owner, { title: 'First' }, database);
    expect(created.title).toBe('First');
    expect(await getNote(owner, created.id, database)).toMatchObject({ title: 'First' });
  });

  it('lists only the caller’s notes', async () => {
    await createNote(owner, { title: 'Mine' }, database);
    await createNote(stranger, { title: 'Theirs' }, database);

    const mine = await listNotes(owner, database);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.title).toBe('Mine');
  });

  it('refuses to read another user’s note', async () => {
    const created = await createNote(owner, { title: 'Private' }, database);
    expect(await getNote(stranger, created.id, database)).toBeNull();
  });

  it('refuses to update another user’s note', async () => {
    const created = await createNote(owner, { title: 'Private' }, database);
    expect(await updateNote(stranger, created.id, { title: 'Hacked' }, database)).toBeNull();
    expect((await getNote(owner, created.id, database))?.title).toBe('Private');
  });

  it('refuses to delete another user’s note, and says so', async () => {
    const created = await createNote(owner, { title: 'Private' }, database);
    expect(await deleteNote(stranger, created.id, database)).toBe(false);
    expect(await getNote(owner, created.id, database)).not.toBeNull();
    expect(await deleteNote(owner, created.id, database)).toBe(true);
  });

  it('distinguishes clearing a field from leaving it alone', async () => {
    const created = await createNote(owner, { title: 'T', body: 'text' }, database);
    await updateNote(owner, created.id, { title: 'T2' }, database);
    expect((await getNote(owner, created.id, database))?.body).toBe('text');

    await updateNote(owner, created.id, { body: null }, database);
    expect((await getNote(owner, created.id, database))?.body).toBeNull();
  });
});
