import type { Scope } from '@keel/contracts/ids';
import { db } from '@keel/db';
import { type schema, tag, todo, todoTag } from '@keel/db/schema';
import { and, asc, eq, inArray, type SQL } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

/**
 * Tag query layer. Shape copied from `examples/notes` — see that package for why the
 * database handle is a trailing parameter with a `db()` default, and why `userId` is the
 * branded type rather than a string.
 *
 * Two things are specific to tags:
 *
 * **Nothing here takes a `listId`.** Tags are global to the user. Every query is scoped
 * by `userId` alone, which is what makes `listTodosWithTag` able to return todos from
 * several lists at once — the reason tags exist.
 *
 * **Deleting a tag never deletes a todo.** That is a property of the foreign keys in
 * `packages/db/src/schema/tag.ts` rather than of anything written here, which is exactly
 * why `queries.test.ts` asserts it against a real database instead of trusting this
 * sentence.
 */
export type TagsDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * Tags are personal *within a tenant*: the same user in two organizations has two
 * separate sets, which is what people expect from a workspace switcher.
 */
function ownedBy(scope: Scope, ...narrowing: (SQL | undefined)[]): SQL {
  const owner = and(
    eq(tag.userId, scope.userId),
    eq(tag.organizationId, scope.organizationId),
  ) as SQL;
  return and(owner, ...narrowing) ?? owner;
}

/**
 * The join table carries its own `user_id`, so it gets its own scope helper rather than
 * joining back to `todo` to prove ownership. Same discipline, same failure mode if it is
 * forgotten: no predicate at all rather than a leaky one.
 */
function linkOwnedBy(scope: Scope, ...narrowing: (SQL | undefined)[]): SQL {
  const owner = eq(todoTag.userId, scope.userId);
  return and(owner, ...narrowing) ?? owner;
}

export async function listTags(scope: Scope, database: TagsDatabase = db()) {
  return database.select().from(tag).where(ownedBy(scope)).orderBy(asc(tag.name));
}

export async function getTag(scope: Scope, id: string, database: TagsDatabase = db()) {
  const [row] = await database
    .select()
    .from(tag)
    .where(ownedBy(scope, eq(tag.id, id)))
    .limit(1);
  return row ?? null;
}

/**
 * Create a tag, or return null when the user already has one by that name.
 *
 * Null rather than a throw, and rather than silently returning the existing row: the
 * caller asked to create something new, and "you already have that tag" is a message a
 * user can act on. Inline tagging wants the other behaviour and uses `tagTodoByName`.
 */
export async function createTag(
  scope: Scope,
  input: { name: string; colour?: string | null },
  database: TagsDatabase = db(),
) {
  const [row] = await database
    .insert(tag)
    .values({
      id: `tag_${crypto.randomUUID()}`,
      userId: scope.userId,
      organizationId: scope.organizationId,
      name: input.name,
      colour: input.colour ?? null,
    })
    .onConflictDoNothing({ target: [tag.userId, tag.name] })
    .returning();
  return row ?? null;
}

export async function updateTag(
  scope: Scope,
  id: string,
  patch: { name?: string; colour?: string | null },
  database: TagsDatabase = db(),
) {
  const [row] = await database
    .update(tag)
    .set({ ...patch, updatedAt: new Date() })
    .where(ownedBy(scope, eq(tag.id, id)))
    .returning();
  return row ?? null;
}

/**
 * Delete a tag. **The todos carrying it survive.**
 *
 * There is no cleanup of `todo_tag` here, and that absence is deliberate: the cascade on
 * `todo_tag.tag_id` removes the links, and no foreign key points from `tag` into `todo`,
 * so no todo can be reached from this statement. Doing it by hand would work too and
 * would hide the day someone declared the foreign key the other way round.
 *
 * Returns whether a row was removed, so callers can tell "gone" from "not yours".
 */
export async function deleteTag(scope: Scope, id: string, database: TagsDatabase = db()) {
  const rows = await database
    .delete(tag)
    .where(ownedBy(scope, eq(tag.id, id)))
    .returning({ id: tag.id });
  return rows.length > 0;
}

/** The tags on one todo, for rendering a single row. */
export async function listTagsForTodo(scope: Scope, todoId: string, database: TagsDatabase = db()) {
  return database
    .select({ id: tag.id, name: tag.name, colour: tag.colour })
    .from(todoTag)
    .innerJoin(tag, eq(tag.id, todoTag.tagId))
    .where(linkOwnedBy(scope, eq(todoTag.todoId, todoId)))
    .orderBy(asc(tag.name));
}

/**
 * The tags on many todos in one query.
 *
 * A list page renders every todo with its tags; doing that a row at a time is the N+1 the
 * page would ship with if this helper did not exist.
 */
export async function listTagsForTodos(
  scope: Scope,
  todoIds: string[],
  database: TagsDatabase = db(),
): Promise<Map<string, { id: string; name: string; colour: string | null }[]>> {
  const grouped = new Map<string, { id: string; name: string; colour: string | null }[]>();
  if (todoIds.length === 0) return grouped;

  const rows = await database
    .select({ todoId: todoTag.todoId, id: tag.id, name: tag.name, colour: tag.colour })
    .from(todoTag)
    .innerJoin(tag, eq(tag.id, todoTag.tagId))
    .where(linkOwnedBy(scope, inArray(todoTag.todoId, todoIds)))
    .orderBy(asc(tag.name));

  for (const row of rows) {
    const existing = grouped.get(row.todoId);
    const entry = { id: row.id, name: row.name, colour: row.colour };
    if (existing) existing.push(entry);
    else grouped.set(row.todoId, [entry]);
  }
  return grouped;
}

/**
 * Every todo carrying a tag, across every list.
 *
 * This is the query tags exist for, and it is why the table has no `listId`: the result
 * deliberately spans lists, so the caller gets `listId` back on each row rather than
 * supplying one.
 */
export async function listTodosWithTag(scope: Scope, tagId: string, database: TagsDatabase = db()) {
  return database
    .select({
      id: todo.id,
      listId: todo.listId,
      title: todo.title,
      done: todo.done,
      position: todo.position,
    })
    .from(todoTag)
    .innerJoin(todo, eq(todo.id, todoTag.todoId))
    .where(linkOwnedBy(scope, eq(todoTag.tagId, tagId)))
    .orderBy(asc(todo.done), asc(todo.position));
}

/**
 * Attach an existing tag to a todo.
 *
 * Both ends are checked against the caller before the link is written. The foreign keys
 * only prove the rows exist — without these checks a user could attach their own tag to a
 * stranger's todo, or a stranger's tag to their own, by guessing an id. The same hole was
 * found on `createTodo` in T-03; it is a property of every table that references another.
 *
 * Attaching twice is a no-op rather than an error: the composite primary key makes the
 * second insert a conflict, and "this todo has this tag" is already true.
 */
export async function attachTag(
  scope: Scope,
  input: { todoId: string; tagId: string },
  database: TagsDatabase = db(),
) {
  const [ownedTodo] = await database
    .select({ id: todo.id })
    .from(todo)
    .where(and(eq(todo.id, input.todoId), eq(todo.userId, scope.userId)))
    .limit(1);
  if (!ownedTodo) return false;

  const [ownedTag] = await database
    .select({ id: tag.id })
    .from(tag)
    .where(ownedBy(scope, eq(tag.id, input.tagId)))
    .limit(1);
  if (!ownedTag) return false;

  await database
    .insert(todoTag)
    .values({ todoId: input.todoId, tagId: input.tagId, userId: scope.userId })
    .onConflictDoNothing();
  return true;
}

/** Returns whether a link was removed, so callers can tell "not tagged" from "not yours". */
export async function detachTag(
  scope: Scope,
  input: { todoId: string; tagId: string },
  database: TagsDatabase = db(),
) {
  const rows = await database
    .delete(todoTag)
    .where(linkOwnedBy(scope, eq(todoTag.todoId, input.todoId), eq(todoTag.tagId, input.tagId)))
    .returning({ todoId: todoTag.todoId });
  return rows.length > 0;
}

/**
 * Inline creation: tag a todo by name, making the tag first if the user has not got one.
 *
 * One transaction, so a user who types a new tag name never ends up with the tag created
 * and the todo left untagged. `onConflictDoNothing` on the insert plus a re-read covers
 * the race where two requests create the same name at once — the unique index on
 * `(user_id, name)` decides, and the loser reads the winner's row instead of failing.
 *
 * Returns the tag, or null when the todo is not the caller's.
 */
export async function tagTodoByName(
  scope: Scope,
  input: { todoId: string; name: string; colour?: string | null },
  database: TagsDatabase = db(),
) {
  return database.transaction(async (tx) => {
    const [ownedTodo] = await tx
      .select({ id: todo.id })
      .from(todo)
      .where(and(eq(todo.id, input.todoId), eq(todo.userId, scope.userId)))
      .limit(1);
    if (!ownedTodo) return null;

    const [inserted] = await tx
      .insert(tag)
      .values({
        id: `tag_${crypto.randomUUID()}`,
        userId: scope.userId,
        organizationId: scope.organizationId,
        name: input.name,
        colour: input.colour ?? null,
      })
      .onConflictDoNothing({ target: [tag.userId, tag.name] })
      .returning();

    let resolved = inserted;
    if (!resolved) {
      const [existing] = await tx
        .select()
        .from(tag)
        .where(ownedBy(scope, eq(tag.name, input.name)))
        .limit(1);
      resolved = existing;
    }
    if (!resolved) throw new Error('tagTodoByName resolved no tag');

    await tx
      .insert(todoTag)
      .values({ todoId: input.todoId, tagId: resolved.id, userId: scope.userId })
      .onConflictDoNothing();

    return resolved;
  });
}
