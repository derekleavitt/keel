'use server';

import {
  createListSchema,
  reorderListSchema,
  revokeShareSchema,
  shareListSchema,
  updateListSchema,
} from '@keel/contracts/list';
import { revalidatePath } from '@keel/runtime';
import { requireScope } from '@keel/testbed-orgs/scope';

/*
 * Revalidating `/lists` alone does NOT invalidate `/lists/[id]`. The write lands, the
 * server is correct, and the client keeps serving a cached payload for the page the user
 * is actually looking at — which reads as a lost write.
 *
 * The `'layout'` variant invalidates the segment and everything nested under it. See
 * .orchestration/lessons/L-021.md.
 */
import { createList, deleteList, reorderList, updateList } from './queries.ts';
import { revokeShare, shareList } from './sharing.ts';

/**
 * Server actions.
 *
 * Every export here is a public HTTP endpoint, so: no helpers are exported, no action
 * takes a `userId`, and every argument is `unknown` until a contract schema has parsed it.
 * See `.claude/rules/server-actions.md`.
 */
export async function createListAction(input: unknown) {
  const scope = await requireScope();
  const parsed = createListSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };

  await createList(scope, parsed.data);
  revalidatePath('/lists', 'layout');
  return { ok: true as const };
}

export async function updateListAction(id: unknown, patch: unknown) {
  const scope = await requireScope();
  if (typeof id !== 'string') return { ok: false as const, error: 'Invalid list' };
  const parsed = updateListSchema.safeParse(patch);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };

  const row = await updateList(scope, id, parsed.data);
  if (!row) return { ok: false as const, error: 'List not found' };
  revalidatePath('/lists', 'layout');
  return { ok: true as const };
}

export async function deleteListAction(id: unknown) {
  const scope = await requireScope();
  if (typeof id !== 'string') return { ok: false as const, error: 'Invalid list' };

  const removed = await deleteList(scope, id);
  if (!removed) return { ok: false as const, error: 'List not found' };
  revalidatePath('/lists', 'layout');
  return { ok: true as const };
}

export async function reorderListAction(input: unknown) {
  const scope = await requireScope();
  const parsed = reorderListSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'Invalid move' };

  const moved = await reorderList(scope, parsed.data);
  if (!moved) return { ok: false as const, error: 'List not found' };
  revalidatePath('/lists', 'layout');
  return { ok: true as const };
}

export async function shareListAction(input: unknown) {
  const scope = await requireScope();
  const parsed = shareListSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }

  const result = await shareList(scope, parsed.data);
  if (!result.ok) {
    const messages = {
      'not-owner': 'Only the owner can share this list',
      'no-such-user': 'No account with that email',
      self: 'That list is already yours',
    } as const;
    return { ok: false as const, error: messages[result.reason] };
  }

  revalidatePath('/lists', 'layout');
  return { ok: true as const };
}

export async function revokeShareAction(input: unknown) {
  const scope = await requireScope();
  const parsed = revokeShareSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'Invalid' };

  const removed = await revokeShare(scope, parsed.data);
  if (!removed) return { ok: false as const, error: 'Nothing to revoke' };
  revalidatePath('/lists', 'layout');
  return { ok: true as const };
}
