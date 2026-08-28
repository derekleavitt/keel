import { audit } from '@keel/audit';
import type { Scope } from '@keel/contracts/ids';
import type { TodoFilter, TodoPriority } from '@keel/contracts/todo';
import { db } from '@keel/db';
import { list, type schema, todo, todoTag } from '@keel/db/schema';
import {
  editableVia,
  evenPositions,
  neighboursForMove,
  PositionExhaustedError,
  positionBetween,
  visibleVia,
} from '@keel/testbed-lists';
import { and, asc, desc, eq, exists, ilike, inArray, lte, or, type SQL, sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

/**
 * Todo query layer. Same shape as `examples/notes` and `testbed/lists`.
 *
 * Ordering reuses the fractional-position arithmetic from `@keel/testbed-lists` rather
 * than reimplementing it — the second copy of that logic would be the first place the two
 * drift apart.
 */
export type TodosDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * Access derives from the list, not the row.
 *
 * `todo.userId` records who created a todo; it no longer decides who may see it. On a
 * shared list, a todo created by the owner must be visible to a grantee, and one created
 * by a grantee must be visible to the owner — neither works if the scope is the row's own
 * user. See `@keel/testbed-lists/access`.
 */
function visible(scope: Scope, ...narrowing: (SQL | undefined)[]): SQL {
  const predicate = visibleVia(todo.listId, scope);
  return and(predicate, ...narrowing) ?? predicate;
}

/** Mutations additionally require an editor grant, or ownership of the list. */
function editable(scope: Scope, ...narrowing: (SQL | undefined)[]): SQL {
  const predicate = editableVia(todo.listId, scope);
  return and(predicate, ...narrowing) ?? predicate;
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
  scope: Scope,
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
    .where(visible(scope, ...narrowing))
    .orderBy(asc(todo.done), desc(todo.priority), asc(todo.position));
}

export async function listTodos(
  scope: Scope,
  listId: string,
  filter: TodoFilter = {},
  database: TodosDatabase = db(),
) {
  return buildTodoListQuery(scope, listId, filter, database);
}

/**
 * Outstanding todos due on or before a day, across every list.
 *
 * Ordered by date then priority — the morning question is "what is late", not "what is
 * important".
 *
 * Deliberately returns `listId` and not the list *name*. Joining `list` here would make
 * this package read another feature's table, and the next cross-feature field would make
 * it read a third. Composition belongs in `@keel/testbed-views`, which is allowed to
 * depend on several features precisely because nothing depends on it.
 */
export async function listDueTodos(
  scope: Scope,
  onOrBefore: string,
  database: TodosDatabase = db(),
) {
  return database
    .select()
    .from(todo)
    .where(visible(scope, eq(todo.done, false), lte(todo.dueDate, onOrBefore)))
    .orderBy(asc(todo.dueDate), desc(todo.priority));
}

/**
 * Escape a user-supplied string for use inside a LIKE pattern.
 *
 * `%` and `_` are wildcards in SQL. Typed by a user they are literal characters, and a
 * search for `50%` that quietly matches everything starting with `50` is both wrong and,
 * on a large table, a way to make the database do far more work than the user asked for.
 *
 * The backslash must be escaped first, or escaping the wildcards would re-escape the
 * backslashes this function just added.
 */
export function escapeLikePattern(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Search a user's todos by title and notes.
 *
 * An empty or whitespace-only query returns everything rather than nothing — a search box
 * that empties the screen when cleared reads as broken.
 *
 * Returns todo columns only. Which list a hit belongs to is a cross-feature question and
 * belongs to the composition layer — see docs/adr/0001-cross-feature-read-models.md.
 */
export async function searchTodos(scope: Scope, query: string, database: TodosDatabase = db()) {
  const trimmed = query.trim();
  const narrowing: (SQL | undefined)[] = [];

  if (trimmed.length > 0) {
    const pattern = `%${escapeLikePattern(trimmed)}%`;
    narrowing.push(or(ilike(todo.title, pattern), ilike(todo.notes, pattern)));
  }

  return database
    .select()
    .from(todo)
    .where(visible(scope, ...narrowing))
    .orderBy(asc(todo.done), desc(todo.priority), asc(todo.dueDate));
}

export async function getTodo(scope: Scope, id: string, database: TodosDatabase = db()) {
  const [row] = await database
    .select()
    .from(todo)
    .where(visible(scope, eq(todo.id, id)))
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
  scope: Scope,
  input: {
    listId: string;
    title: string;
    notes?: string | null;
    dueDate?: string | null;
    priority?: TodoPriority;
  },
  database: TodosDatabase = db(),
) {
  // Edit rights on the target list, not ownership of it — a grantee filing a todo into a
  // list shared with them is the entire point of sharing. The foreign key only proves the
  // list exists.
  const [allowed] = await database
    .select({ id: list.id })
    .from(list)
    .where(and(eq(list.id, input.listId), editableVia(list.id, scope)))
    .limit(1);
  if (!allowed) return null;

  const existing = await listTodos(scope, input.listId, {}, database);
  const last = existing.at(-1)?.position ?? null;

  const [row] = await database
    .insert(todo)
    .values({
      id: `tdo_${crypto.randomUUID()}`,
      userId: scope.userId,
      listId: input.listId,
      title: input.title,
      notes: input.notes ?? null,
      dueDate: input.dueDate ?? null,
      priority: input.priority ?? 'none',
      position: positionBetween(last, null),
    })
    .returning();
  if (!row) throw new Error('createTodo inserted no row');
  await audit(
    scope,
    {
      action: 'todo.created',
      targetType: 'todo',
      targetId: row.id,
      summary: `added “${row.title}”`,
      detail: { listId: input.listId },
    },
    database,
  );
  return row;
}

export async function updateTodo(
  scope: Scope,
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
    .where(editable(scope, eq(todo.id, id)))
    .returning();
  if (!row) return null;
  await audit(
    scope,
    {
      action: 'todo.updated',
      targetType: 'todo',
      targetId: row.id,
      summary: `edited “${row.title}”`,
      detail: patch,
    },
    database,
  );
  return row;
}

export async function setTodoDone(
  scope: Scope,
  id: string,
  done: boolean,
  database: TodosDatabase = db(),
) {
  const [row] = await database
    .update(todo)
    .set({ done, updatedAt: new Date() })
    .where(editable(scope, eq(todo.id, id)))
    .returning();
  if (!row) return null;
  await audit(
    scope,
    {
      action: done ? 'todo.completed' : 'todo.reopened',
      targetType: 'todo',
      targetId: row.id,
      summary: `${done ? 'completed' : 'reopened'} “${row.title}”`,
    },
    database,
  );
  return row;
}

/**
 * Move a todo to sit after `afterId`, or to the top of its list when that is null.
 *
 * Writes one row in the ordinary case. When the gap between neighbours has run out of
 * floats the list is renumbered in the same transaction, so a reader never sees a
 * half-reordered list.
 *
 * Only outstanding todos participate: completed ones sink to the bottom by the `done`
 * sort, so dragging among them would reorder something the user cannot see the effect of.
 */
export async function reorderTodo(
  scope: Scope,
  input: { id: string; listId: string; afterId: string | null },
  database: TodosDatabase = db(),
) {
  return database.transaction(async (tx) => {
    const ordered = await tx
      .select({ id: todo.id, position: todo.position })
      .from(todo)
      .where(editable(scope, eq(todo.listId, input.listId), eq(todo.done, false)))
      .orderBy(asc(todo.position));

    if (!ordered.some((row) => row.id === input.id)) return false;

    const { before, after } = neighboursForMove(ordered, input.id, input.afterId);

    try {
      await tx
        .update(todo)
        .set({ position: positionBetween(before, after), updatedAt: new Date() })
        .where(editable(scope, eq(todo.id, input.id)));
      return true;
    } catch (error) {
      if (!(error instanceof PositionExhaustedError)) throw error;
    }

    const without = ordered.filter((row) => row.id !== input.id);
    const target =
      input.afterId === null ? 0 : without.findIndex((row) => row.id === input.afterId) + 1;
    const resequenced = [...without.slice(0, target), { id: input.id }, ...without.slice(target)];
    const positions = evenPositions(resequenced.length);

    for (const [index, row] of resequenced.entries()) {
      const position = positions[index];
      if (position === undefined) throw new Error('renumber produced no position');
      await tx
        .update(todo)
        .set({ position, updatedAt: new Date() })
        .where(editable(scope, eq(todo.id, row.id)));
    }
    return true;
  });
}

/**
 * Delete a todo.
 *
 * Attachment rows go by cascade, which never touches storage — so their blobs are recorded
 * as orphaned first, inside the same transaction. Doing it afterwards would mean a crash
 * in between leaks files nothing will ever look for again.
 *
 * The orphan rows are written here rather than by `@keel/testbed-attachments` because a
 * cascade gives that package no opportunity to run. The alternative — attachments
 * subscribing to todo deletions — is a coupling with no mechanism behind it.
 */
export async function deleteTodo(scope: Scope, id: string, database: TodosDatabase = db()) {
  return database.transaction(async (tx) => {
    const [owned] = await tx
      .select({ id: todo.id })
      .from(todo)
      .where(editable(scope, eq(todo.id, id)))
      .limit(1);
    if (!owned) return false;

    await tx.execute(sql`
      insert into "orphaned_blob" ("storage_key", "created_at")
      select "storage_key", now() from "attachment" where "todo_id" = ${id}
      on conflict ("storage_key") do nothing
    `);
    await tx.delete(todo).where(eq(todo.id, id));
    // `tx`, not the outer handle: the entry commits with the deletion or not at all, so
    // the log can never claim something that was rolled back.
    await audit(
      scope,
      {
        action: 'todo.deleted',
        targetType: 'todo',
        targetId: id,
        summary: 'deleted a todo',
      },
      tx,
    );
    return true;
  });
}
