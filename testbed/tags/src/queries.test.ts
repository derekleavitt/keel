import type { Scope } from '@keel/contracts/ids';
import { tag, todo, todoTag } from '@keel/db/schema';
import { createTestDatabase, seedScope } from '@keel/db/testing';
import { createList } from '@keel/testbed-lists';
import { createTodo, deleteTodo, getTodo } from '@keel/testbed-todos';
import { eq } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  attachTag,
  createTag,
  deleteTag,
  detachTag,
  getTag,
  listTags,
  listTagsForTodo,
  listTagsForTodos,
  listTodosWithTag,
  tagTodoByName,
  updateTag,
} from './queries.ts';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let owner: Scope;
let stranger: Scope;
/** Two lists for the owner, because the point of a tag is that it spans them. */
let work: string;
let home: string;
let strangerList: string;

beforeEach(async () => {
  database = await createTestDatabase();
  owner = (await seedScope(database, { id: 'owner' })).scope;
  stranger = (await seedScope(database, { id: 'stranger' })).scope;
  work = (await createList(owner, { name: 'Work' }, database)).id;
  home = (await createList(owner, { name: 'Home' }, database)).id;
  strangerList = (await createList(stranger, { name: 'Theirs' }, database)).id;
});

afterEach(async () => {
  await database.close();
});

async function makeTodo(userId: Scope, listId: string, title: string) {
  const row = await createTodo(userId, { listId, title }, database);
  if (!row) throw new Error(`setup failed to create ${title}`);
  return row;
}

async function links() {
  return database.select().from(todoTag);
}

/**
 * THE assertion this feature exists to get right.
 *
 * "Deleting a tag removes it from todos but never deletes the todos" is a one-line rule
 * in the PRD and a one-character mistake in the schema: a `tag_id` column on `todo` with
 * `onDelete: 'cascade'` reads as a reasonable one-to-many shortcut and destroys a user's
 * work the first time they tidy up their labels. A comment saying "cascade points inward"
 * does not fail a build, so this does — behaviourally against real Postgres, and
 * structurally against the foreign keys themselves.
 */
describe('deleting a tag never deletes a todo', () => {
  it('removes the tag and its links, and leaves every todo standing', async () => {
    const urgent = await createTag(owner, { name: 'urgent' }, database);
    if (!urgent) throw new Error('setup failed');
    const deploy = await makeTodo(owner, work, 'Deploy');
    const bins = await makeTodo(owner, home, 'Bins');
    await attachTag(owner, { todoId: deploy.id, tagId: urgent.id }, database);
    await attachTag(owner, { todoId: bins.id, tagId: urgent.id }, database);
    expect(await links()).toHaveLength(2);

    expect(await deleteTag(owner, urgent.id, database)).toBe(true);

    // The tag is gone and so are its links...
    expect(await getTag(owner, urgent.id, database)).toBeNull();
    expect(await links()).toHaveLength(0);
    // ...and both todos are untouched, in both lists.
    expect(await getTodo(owner, deploy.id, database)).not.toBeNull();
    expect(await getTodo(owner, bins.id, database)).not.toBeNull();
    expect(await database.select().from(todo)).toHaveLength(2);
  });

  it('cascades the other way too: deleting a todo drops its links but keeps the tag', async () => {
    const urgent = await createTag(owner, { name: 'urgent' }, database);
    if (!urgent) throw new Error('setup failed');
    const deploy = await makeTodo(owner, work, 'Deploy');
    await attachTag(owner, { todoId: deploy.id, tagId: urgent.id }, database);

    expect(await deleteTodo(owner, deploy.id, database)).toBe(true);

    expect(await links()).toHaveLength(0);
    expect(await getTag(owner, urgent.id, database)).not.toBeNull();
  });

  it('declares no foreign key that could reach a todo from a tag', async () => {
    // Structural counterpart to the behavioural tests above. A cascade can only delete
    // rows in the table that *declares* the foreign key, so the guarantee is exactly:
    // nothing on `todo` or `tag` references the other, and every link-table key cascades.
    const todoReferences = getTableConfig(todo).foreignKeys.map(
      (fk) => getTableConfig(fk.reference().foreignTable).name,
    );
    expect(todoReferences).not.toContain('tag');
    expect(todoReferences).not.toContain('todo_tag');

    const tagReferences = getTableConfig(tag).foreignKeys.map(
      (fk) => getTableConfig(fk.reference().foreignTable).name,
    );
    expect(tagReferences).not.toContain('todo');
    expect(tagReferences).not.toContain('todo_tag');

    const linkKeys = getTableConfig(todoTag).foreignKeys;
    expect(linkKeys).toHaveLength(3);
    for (const fk of linkKeys) {
      expect(fk.onDelete).toBe('cascade');
    }
  });
});

describe('tags are global to the user, never scoped to a list', () => {
  it('declares no list column at all', () => {
    const columns = getTableConfig(tag).columns.map((column) => column.name);
    expect(columns).not.toContain('list_id');
    const linkColumns = getTableConfig(todoTag).columns.map((column) => column.name);
    expect(linkColumns).not.toContain('list_id');
  });

  it('returns todos from every list carrying the tag', async () => {
    const urgent = await createTag(owner, { name: 'urgent' }, database);
    if (!urgent) throw new Error('setup failed');
    const deploy = await makeTodo(owner, work, 'Deploy');
    const bins = await makeTodo(owner, home, 'Bins');
    await makeTodo(owner, work, 'Untagged');
    await attachTag(owner, { todoId: deploy.id, tagId: urgent.id }, database);
    await attachTag(owner, { todoId: bins.id, tagId: urgent.id }, database);

    const tagged = await listTodosWithTag(owner, urgent.id, database);
    expect(tagged.map((row) => row.title).sort()).toEqual(['Bins', 'Deploy']);
    // The cross-list property, stated as an assertion rather than an intention.
    expect(new Set(tagged.map((row) => row.listId)).size).toBe(2);
  });

  it('lets one name exist once per user, and independently for other users', async () => {
    expect(await createTag(owner, { name: 'urgent' }, database)).not.toBeNull();
    expect(await createTag(owner, { name: 'urgent' }, database)).toBeNull();
    expect(await createTag(stranger, { name: 'urgent' }, database)).not.toBeNull();
    expect(await listTags(owner, database)).toHaveLength(1);
  });
});

describe('inline creation while tagging', () => {
  it('creates a tag that does not exist yet and attaches it in one call', async () => {
    const deploy = await makeTodo(owner, work, 'Deploy');
    expect(await listTags(owner, database)).toHaveLength(0);

    const created = await tagTodoByName(
      owner,
      { todoId: deploy.id, name: 'waiting-on', colour: '#4f46e5' },
      database,
    );

    expect(created?.name).toBe('waiting-on');
    expect(created?.colour).toBe('#4f46e5');
    expect(await listTags(owner, database)).toHaveLength(1);
    expect((await listTagsForTodo(owner, deploy.id, database)).map((row) => row.name)).toEqual([
      'waiting-on',
    ]);
  });

  it('reuses an existing tag rather than creating a second one', async () => {
    const deploy = await makeTodo(owner, work, 'Deploy');
    const bins = await makeTodo(owner, home, 'Bins');

    const first = await tagTodoByName(owner, { todoId: deploy.id, name: 'urgent' }, database);
    const second = await tagTodoByName(owner, { todoId: bins.id, name: 'urgent' }, database);

    expect(first?.id).toBe(second?.id);
    expect(await listTags(owner, database)).toHaveLength(1);
    expect(await listTodosWithTag(owner, first?.id ?? '', database)).toHaveLength(2);
  });

  it('refuses to tag a todo the caller does not own, and creates nothing', async () => {
    const theirs = await makeTodo(stranger, strangerList, 'Theirs');

    expect(await tagTodoByName(owner, { todoId: theirs.id, name: 'urgent' }, database)).toBeNull();
    // The transaction must not leave a tag behind after refusing the attachment.
    expect(await listTags(owner, database)).toHaveLength(0);
    expect(await links()).toHaveLength(0);
  });
});

describe('attaching and detaching', () => {
  it('is idempotent — attaching twice leaves one link', async () => {
    const urgent = await createTag(owner, { name: 'urgent' }, database);
    if (!urgent) throw new Error('setup failed');
    const deploy = await makeTodo(owner, work, 'Deploy');

    expect(await attachTag(owner, { todoId: deploy.id, tagId: urgent.id }, database)).toBe(true);
    expect(await attachTag(owner, { todoId: deploy.id, tagId: urgent.id }, database)).toBe(true);
    expect(await links()).toHaveLength(1);
  });

  it('detaching says whether anything was removed', async () => {
    const urgent = await createTag(owner, { name: 'urgent' }, database);
    if (!urgent) throw new Error('setup failed');
    const deploy = await makeTodo(owner, work, 'Deploy');
    await attachTag(owner, { todoId: deploy.id, tagId: urgent.id }, database);

    expect(await detachTag(owner, { todoId: deploy.id, tagId: urgent.id }, database)).toBe(true);
    expect(await detachTag(owner, { todoId: deploy.id, tagId: urgent.id }, database)).toBe(false);
    // Detaching is not deleting: both ends survive.
    expect(await getTodo(owner, deploy.id, database)).not.toBeNull();
    expect(await getTag(owner, urgent.id, database)).not.toBeNull();
  });

  it('groups tags by todo without an N+1', async () => {
    const urgent = await createTag(owner, { name: 'urgent' }, database);
    const quick = await createTag(owner, { name: '5-minutes' }, database);
    if (!urgent || !quick) throw new Error('setup failed');
    const deploy = await makeTodo(owner, work, 'Deploy');
    const bins = await makeTodo(owner, home, 'Bins');
    await attachTag(owner, { todoId: deploy.id, tagId: urgent.id }, database);
    await attachTag(owner, { todoId: deploy.id, tagId: quick.id }, database);
    await attachTag(owner, { todoId: bins.id, tagId: urgent.id }, database);

    const grouped = await listTagsForTodos(owner, [deploy.id, bins.id], database);
    expect(grouped.get(deploy.id)?.map((row) => row.name)).toEqual(['5-minutes', 'urgent']);
    expect(grouped.get(bins.id)?.map((row) => row.name)).toEqual(['urgent']);
    expect(await listTagsForTodos(owner, [], database)).toHaveLength(0);
  });
});

describe('cross-user isolation', () => {
  it('never lists, reads, updates or deletes another user’s tag', async () => {
    const mine = await createTag(owner, { name: 'private' }, database);
    if (!mine) throw new Error('setup failed');

    expect(await listTags(stranger, database)).toHaveLength(0);
    expect(await getTag(stranger, mine.id, database)).toBeNull();
    expect(await updateTag(stranger, mine.id, { name: 'hacked' }, database)).toBeNull();
    expect(await deleteTag(stranger, mine.id, database)).toBe(false);
    expect((await getTag(owner, mine.id, database))?.name).toBe('private');
  });

  it('refuses to attach across an ownership boundary in either direction', async () => {
    const myTag = await createTag(owner, { name: 'mine' }, database);
    const theirTag = await createTag(stranger, { name: 'theirs' }, database);
    if (!myTag || !theirTag) throw new Error('setup failed');
    const myTodo = await makeTodo(owner, work, 'Mine');
    const theirTodo = await makeTodo(stranger, strangerList, 'Theirs');

    // My tag onto their todo — the foreign key would happily allow it.
    expect(await attachTag(owner, { todoId: theirTodo.id, tagId: myTag.id }, database)).toBe(false);
    // Their tag onto my todo.
    expect(await attachTag(owner, { todoId: myTodo.id, tagId: theirTag.id }, database)).toBe(false);
    expect(await links()).toHaveLength(0);
  });

  it('never shows a stranger the todos behind a tag, or the tags on a todo', async () => {
    const urgent = await createTag(owner, { name: 'urgent' }, database);
    if (!urgent) throw new Error('setup failed');
    const deploy = await makeTodo(owner, work, 'Deploy');
    await attachTag(owner, { todoId: deploy.id, tagId: urgent.id }, database);

    expect(await listTodosWithTag(stranger, urgent.id, database)).toHaveLength(0);
    expect(await listTagsForTodo(stranger, deploy.id, database)).toHaveLength(0);
    expect(await listTagsForTodo(owner, deploy.id, database)).toHaveLength(1);
    // Detaching someone else's link must not work either.
    expect(await detachTag(stranger, { todoId: deploy.id, tagId: urgent.id }, database)).toBe(
      false,
    );
    expect(
      await database.select().from(todoTag).where(eq(todoTag.userId, owner.userId)),
    ).toHaveLength(1);
  });
});
