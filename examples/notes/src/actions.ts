'use server';

import { requireUserId } from '@keel/auth/session';
import { revalidatePath } from '@keel/runtime';
import { createNoteSchema, updateNoteSchema } from './contract.ts';
import { createNote, deleteNote, updateNote } from './queries.ts';

/**
 * PATTERN: server actions. This is the most dangerous file in any feature package.
 *
 * **Every export here is a public HTTP endpoint.** Not "callable from your forms" —
 * callable by anyone who can reach the app, with whatever arguments they like. The rules
 * below are not style; each one closes a way to leak or corrupt another user's data.
 *
 * 1. NEVER EXPORT A HELPER. A `currentUserId()` exported from a file like this publishes
 *    the signed-in user's id as an endpoint. Helpers live elsewhere; actions import them.
 *
 * 2. NEVER TAKE `userId` AS AN ARGUMENT. Arguments are attacker-controlled. Resolve the
 *    user inside, from the session.
 *
 * 3. EVERY ARGUMENT IS `unknown` UNTIL A SCHEMA HAS PARSED IT. Do not trust the shape, and
 *    do not trust that the client sent what your form rendered.
 *
 * 4. CHECK OWNERSHIP OF EVERY ID YOU ARE HANDED, INCLUDING THE ONES YOU ONLY REFERENCE.
 *    This is the mistake this repo has now made twice independently — see below.
 *
 * 5. RETURN ERRORS AS VALUES. A thrown error in an action becomes an opaque digest in
 *    production, which tells the user nothing and the developer nearly as little.
 *
 * Actions cannot be exported from a package barrel — `'use server'` modules may only
 * export async functions. Export this as its own subpath (`@keel/example-notes/actions`).
 */

export async function createNoteAction(input: unknown) {
  const userId = await requireUserId();

  const parsed = createNoteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  await createNote(userId, parsed.data);
  revalidatePath('/notes');
  return { ok: true as const };
}

export async function updateNoteAction(id: unknown, patch: unknown) {
  const userId = await requireUserId();
  if (typeof id !== 'string') return { ok: false as const, error: 'Invalid note' };

  const parsed = updateNoteSchema.safeParse(patch);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  // The query is scoped by userId, so a note belonging to someone else simply does not
  // match and returns null. Ownership is enforced in the WHERE clause, not by an `if`.
  const row = await updateNote(userId, id, parsed.data);
  if (!row) return { ok: false as const, error: 'Note not found' };

  revalidatePath('/notes');
  return { ok: true as const };
}

export async function deleteNoteAction(id: unknown) {
  const userId = await requireUserId();
  if (typeof id !== 'string') return { ok: false as const, error: 'Invalid note' };

  const removed = await deleteNote(userId, id);
  if (!removed) return { ok: false as const, error: 'Note not found' };

  revalidatePath('/notes');
  return { ok: true as const };
}
