'use server';

import { requireUserId } from '@keel/auth/session';
import { createListSchema, reorderListSchema, updateListSchema } from '@keel/contracts/list';
import { revalidatePath } from '@keel/runtime';
import { createList, deleteList, reorderList, updateList } from './queries.ts';

/**
 * Server actions.
 *
 * Every export here is a public HTTP endpoint, so: no helpers are exported, no action
 * takes a `userId`, and every argument is `unknown` until a contract schema has parsed it.
 * See `.claude/rules/server-actions.md`.
 */
export async function createListAction(input: unknown) {
  const userId = await requireUserId();
  const parsed = createListSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };

  await createList(userId, parsed.data);
  revalidatePath('/lists');
  return { ok: true as const };
}

export async function updateListAction(id: unknown, patch: unknown) {
  const userId = await requireUserId();
  if (typeof id !== 'string') return { ok: false as const, error: 'Invalid list' };
  const parsed = updateListSchema.safeParse(patch);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };

  const row = await updateList(userId, id, parsed.data);
  if (!row) return { ok: false as const, error: 'List not found' };
  revalidatePath('/lists');
  return { ok: true as const };
}

export async function deleteListAction(id: unknown) {
  const userId = await requireUserId();
  if (typeof id !== 'string') return { ok: false as const, error: 'Invalid list' };

  const removed = await deleteList(userId, id);
  if (!removed) return { ok: false as const, error: 'List not found' };
  revalidatePath('/lists');
  return { ok: true as const };
}

export async function reorderListAction(input: unknown) {
  const userId = await requireUserId();
  const parsed = reorderListSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'Invalid move' };

  const moved = await reorderList(userId, parsed.data);
  if (!moved) return { ok: false as const, error: 'List not found' };
  revalidatePath('/lists');
  return { ok: true as const };
}
