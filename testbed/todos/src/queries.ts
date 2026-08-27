import type { UserId } from '@keel/contracts/ids';
import { db } from '@keel/db';
import { list, type schema, todo } from '@keel/db/schema';
import { positionBetween } from '@keel/testbed-lists';
import { and, asc, eq, type SQL } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

/**
 * Todo query layer. Same shape as `examples/notes` and `testbed/lists`.
 *
 * Ordering reuses the fractional-position arithmetic from `@keel/testbed-lists` rather
 * than reimplementing it — the second copy of that logic would be the first place the two
 * drift apart.
 */
export type TodosDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

function ownedBy(userId: UserId, ...narrowing: (SQL | undefined)[]): SQL {
  const owner = eq(todo.userId, userId);
  return and(owner, ...narrowing) ?? owner;
}

/**
 * Todos in a list: outstanding first in position order, completed sinking to the bottom.
 * Ordering by `done` before `position` is what makes ticking something move it, without
 * touching its position.
 */
export async function listTodos(userId: UserId, listId: string, database: TodosDatabase = db()) {
  return database
    .select()
    .from(todo)
    .where(ownedBy(userId, eq(todo.listId, listId)))
    .orderBy(asc(todo.done), asc(todo.position));
}

export async function getTodo(userId: UserId, id: string, database: TodosDatabase = db()) {
  const [row] = await database
    .select()
    .from(todo)
    .where(ownedBy(userId, eq(todo.id, id)))
    .limit(1);
  return row ?? null;
}

/**
 * Quick add. A title and a list is all it takes.
 *
 * The list is verified to belong to the caller before insert. Without that check a user
 * could file a todo into someone else's list by guessing an id — the foreign key alone
 * only proves the list exists, not that it is theirs.
 */
export async function createTodo(
  userId: UserId,
  input: { listId: string; title: string; notes?: string | null },
  database: TodosDatabase = db(),
) {
  const [owned] = await database
    .select({ id: list.id })
    .from(list)
    .where(and(eq(list.id, input.listId), eq(list.userId, userId)))
    .limit(1);
  if (!owned) return null;

  const existing = await listTodos(userId, input.listId, database);
  const last = existing.at(-1)?.position ?? null;

  const [row] = await database
    .insert(todo)
    .values({
      id: `tdo_${crypto.randomUUID()}`,
      userId,
      listId: input.listId,
      title: input.title,
      notes: input.notes ?? null,
      position: positionBetween(last, null),
    })
    .returning();
  if (!row) throw new Error('createTodo inserted no row');
  return row;
}

export async function updateTodo(
  userId: UserId,
  id: string,
  patch: { title?: string; notes?: string | null },
  database: TodosDatabase = db(),
) {
  const [row] = await database
    .update(todo)
    .set({ ...patch, updatedAt: new Date() })
    .where(ownedBy(userId, eq(todo.id, id)))
    .returning();
  return row ?? null;
}

export async function setTodoDone(
  userId: UserId,
  id: string,
  done: boolean,
  database: TodosDatabase = db(),
) {
  const [row] = await database
    .update(todo)
    .set({ done, updatedAt: new Date() })
    .where(ownedBy(userId, eq(todo.id, id)))
    .returning();
  return row ?? null;
}

export async function deleteTodo(userId: UserId, id: string, database: TodosDatabase = db()) {
  const rows = await database
    .delete(todo)
    .where(ownedBy(userId, eq(todo.id, id)))
    .returning({ id: todo.id });
  return rows.length > 0;
}
