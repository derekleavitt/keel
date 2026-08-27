import type { UserId } from '@keel/contracts/ids';
import type { TodoFilter, TodoPriority } from '@keel/contracts/todo';
import { db } from '@keel/db';
import { list, type schema, todo, todoTag } from '@keel/db/schema';
import { positionBetween } from '@keel/testbed-lists';
import { and, asc, desc, eq, exists, inArray, lte, type SQL } from 'drizzle-orm';
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
/**
 * The list query, exposed as a builder so its SQL can be asserted without a connection.
 *
 * User scoping is the security-critical property here, and `scoping.test.ts` renders this
 * across every filter combination to prove the scope survives all of them — including
 * combinations nobody has written a behavioural test for.
 */
export function buildTodoListQuery(
  userId: UserId,
  listId: string,
  filter: TodoFilter = {},
  database: TodosDatabase = db(),
) {
  const narrowing: (SQL | undefined)[] = [eq(todo.listId, listId)];
  if (filter.done !== undefined) narrowing.push(eq(todo.done, filter.done));
  if (filter.priority?.length) narrowing.push(inArray(todo.priority, filter.priority));
  if (filter.dueOnOrBefore) narrowing.push(lte(todo.dueDate, filter.dueOnOrBefore));
  if (filter.tagIds?.length) {
    // EXISTS rather than a join: a todo carrying two of the selected tags must appear
    // once, not twice. A join would duplicate the row per matching tag.
    narrowing.push(
      exists(
        database
          .select({ one: todoTag.tagId })
          .from(todoTag)
          .where(and(eq(todoTag.todoId, todo.id), inArray(todoTag.tagId, filter.tagIds))),
      ),
    );
  }

  return database
    .select()
    .from(todo)
    .where(ownedBy(userId, ...narrowing))
    .orderBy(asc(todo.done), desc(todo.priority), asc(todo.position));
}

export async function listTodos(
  userId: UserId,
  listId: string,
  filter: TodoFilter = {},
  database: TodosDatabase = db(),
) {
  return buildTodoListQuery(userId, listId, filter, database);
}

/**
 * Outstanding todos due on or before a day, across every list.
 *
 * Ordered by date then priority — the morning question is "what is late", not "what is
 * important".
 *
 * Deliberately returns `listId` and not the list *name*. Joining `list` here would make
 * this package read another feature's table, and the next cross-feature field would make
 * it read a third. Composition belongs in `@keel/testbed-agenda`, which is allowed to
 * depend on several features precisely because nothing depends on it.
 */
export async function listDueTodos(
  userId: UserId,
  onOrBefore: string,
  database: TodosDatabase = db(),
) {
  return database
    .select()
    .from(todo)
    .where(ownedBy(userId, eq(todo.done, false), lte(todo.dueDate, onOrBefore)))
    .orderBy(asc(todo.dueDate), desc(todo.priority));
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
  input: {
    listId: string;
    title: string;
    notes?: string | null;
    dueDate?: string | null;
    priority?: TodoPriority;
  },
  database: TodosDatabase = db(),
) {
  const [owned] = await database
    .select({ id: list.id })
    .from(list)
    .where(and(eq(list.id, input.listId), eq(list.userId, userId)))
    .limit(1);
  if (!owned) return null;

  const existing = await listTodos(userId, input.listId, {}, database);
  const last = existing.at(-1)?.position ?? null;

  const [row] = await database
    .insert(todo)
    .values({
      id: `tdo_${crypto.randomUUID()}`,
      userId,
      listId: input.listId,
      title: input.title,
      notes: input.notes ?? null,
      dueDate: input.dueDate ?? null,
      priority: input.priority ?? 'none',
      position: positionBetween(last, null),
    })
    .returning();
  if (!row) throw new Error('createTodo inserted no row');
  return row;
}

export async function updateTodo(
  userId: UserId,
  id: string,
  patch: {
    title?: string;
    notes?: string | null;
    dueDate?: string | null;
    priority?: TodoPriority;
  },
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
