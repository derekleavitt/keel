'use server';

import { requireUserId } from '@keel/auth/session';
import {
  createTagSchema,
  tagAssignmentSchema,
  tagTodoByNameSchema,
  updateTagSchema,
} from '@keel/contracts/tag';
import { revalidatePath } from '@keel/runtime';

/*
 * Revalidating `/lists` alone does NOT invalidate `/lists/[id]`. The write lands, the
 * server is correct, and the client keeps serving a cached payload for the page the user
 * is actually looking at — which reads as a lost write.
 *
 * The `'layout'` variant invalidates the segment and everything nested under it. See
 * .orchestration/lessons/L-021.md.
 */
import { attachTag, createTag, deleteTag, detachTag, tagTodoByName, updateTag } from './queries.ts';

/**
 * Server actions.
 *
 * Every export here is a public HTTP endpoint, so: no helpers are exported, no action
 * takes a `userId`, and every argument is `unknown` until a contract schema has parsed it.
 * See `.claude/rules/server-actions.md`.
 */
export async function createTagAction(input: unknown) {
  const userId = await requireUserId();
  const parsed = createTagSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };

  const row = await createTag(userId, parsed.data);
  if (!row) return { ok: false as const, error: 'You already have a tag with that name' };
  revalidatePath('/lists', 'layout');
  return { ok: true as const };
}

export async function updateTagAction(id: unknown, patch: unknown) {
  const userId = await requireUserId();
  if (typeof id !== 'string') return { ok: false as const, error: 'Invalid tag' };
  const parsed = updateTagSchema.safeParse(patch);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };

  const row = await updateTag(userId, id, parsed.data);
  if (!row) return { ok: false as const, error: 'Tag not found' };
  revalidatePath('/lists', 'layout');
  return { ok: true as const };
}

/**
 * Deleting a tag detaches it from every todo and deletes none of them. The cascade in
 * `packages/db/src/schema/tag.ts` is what guarantees that, and
 * `testbed/tags/src/queries.test.ts` is what proves it.
 */
export async function deleteTagAction(id: unknown) {
  const userId = await requireUserId();
  if (typeof id !== 'string') return { ok: false as const, error: 'Invalid tag' };

  const removed = await deleteTag(userId, id);
  if (!removed) return { ok: false as const, error: 'Tag not found' };
  revalidatePath('/lists', 'layout');
  return { ok: true as const };
}

export async function attachTagAction(input: unknown) {
  const userId = await requireUserId();
  const parsed = tagAssignmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'Invalid tag assignment' };

  const attached = await attachTag(userId, parsed.data);
  if (!attached) return { ok: false as const, error: 'Todo or tag not found' };
  revalidatePath('/lists', 'layout');
  return { ok: true as const };
}

export async function detachTagAction(input: unknown) {
  const userId = await requireUserId();
  const parsed = tagAssignmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'Invalid tag assignment' };

  const detached = await detachTag(userId, parsed.data);
  if (!detached) return { ok: false as const, error: 'That todo is not tagged with that tag' };
  revalidatePath('/lists', 'layout');
  return { ok: true as const };
}

/** Inline creation: one round trip creates the tag if needed and attaches it. */
export async function tagTodoByNameAction(input: unknown) {
  const userId = await requireUserId();
  const parsed = tagTodoByNameSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };

  const row = await tagTodoByName(userId, parsed.data);
  if (!row) return { ok: false as const, error: 'Todo not found' };
  revalidatePath('/lists', 'layout');
  return { ok: true as const };
}
