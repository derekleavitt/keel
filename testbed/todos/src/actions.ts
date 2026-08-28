'use server';

import {
  createTodoSchema,
  reorderTodoSchema,
  setTodoDoneSchema,
  updateTodoSchema,
} from '@keel/contracts/todo';
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
import { createTodo, deleteTodo, reorderTodo, setTodoDone, updateTodo } from './queries.ts';

/** Every export is a public endpoint: no helpers, no userId arguments, parse everything. */
export async function createTodoAction(input: unknown) {
  const scope = await requireScope();
  const parsed = createTodoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }

  const row = await createTodo(scope, parsed.data);
  if (!row) return { ok: false as const, error: 'List not found' };
  revalidatePath('/lists', 'layout');
  return { ok: true as const };
}

export async function setTodoDoneAction(input: unknown) {
  const scope = await requireScope();
  const parsed = setTodoDoneSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'Invalid' };

  const row = await setTodoDone(scope, parsed.data.id, parsed.data.done);
  if (!row) return { ok: false as const, error: 'Todo not found' };
  revalidatePath('/lists', 'layout');
  return { ok: true as const };
}

export async function updateTodoAction(id: unknown, patch: unknown) {
  const scope = await requireScope();
  if (typeof id !== 'string') return { ok: false as const, error: 'Invalid todo' };
  const parsed = updateTodoSchema.safeParse(patch);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }

  const row = await updateTodo(scope, id, parsed.data);
  if (!row) return { ok: false as const, error: 'Todo not found' };
  revalidatePath('/lists', 'layout');
  return { ok: true as const };
}

export async function reorderTodoAction(input: unknown) {
  const scope = await requireScope();
  const parsed = reorderTodoSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'Invalid move' };

  const moved = await reorderTodo(scope, parsed.data);
  if (!moved) return { ok: false as const, error: 'Todo not found' };
  revalidatePath('/lists', 'layout');
  return { ok: true as const };
}

export async function deleteTodoAction(id: unknown) {
  const scope = await requireScope();
  if (typeof id !== 'string') return { ok: false as const, error: 'Invalid todo' };

  const removed = await deleteTodo(scope, id);
  if (!removed) return { ok: false as const, error: 'Todo not found' };
  revalidatePath('/lists', 'layout');
  return { ok: true as const };
}
