import type { UserId } from '@keel/contracts/ids';
import { createTestDatabase, seedUser } from '@keel/db/testing';
import { createList, revokeShare, shareList } from '@keel/testbed-lists';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createTodo,
  deleteTodo,
  getTodo,
  listTodos,
  reorderTodo,
  setTodoDone,
  updateTodo,
} from './queries.ts';

/**
 * Todos inherit access from their list.
 *
 * These are the tests that would have caught the old model: before sharing, every todo
 * query scoped by `todo.userId`, which is *who created it*. On a shared list that is the
 * wrong question — the owner must see a grantee's todos and vice versa, and neither works
 * if the scope is the row's own creator.
 */
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let owner: UserId;
let friend: UserId;
let stranger: UserId;
let listId: string;

beforeEach(async () => {
  database = await createTestDatabase();
  owner = (await seedUser(database, { id: 'owner', email: 'owner@example.test' })).id as UserId;
  friend = (await seedUser(database, { id: 'friend', email: 'friend@example.test' })).id as UserId;
  stranger = (await seedUser(database, { id: 'stranger', email: 's@example.test' })).id as UserId;
  listId = (await createList(owner, { name: 'Shared' }, database)).id;
});

afterEach(async () => {
  await database.close();
});

const share = (role: 'viewer' | 'editor') =>
  shareList(owner, { listId, email: 'friend@example.test', role }, database);

const titles = async (userId: UserId) =>
  (await listTodos(userId, listId, {}, database)).map((row) => row.title);

describe('a viewer', () => {
  beforeEach(() => share('viewer'));

  it('sees the owner’s todos', async () => {
    await createTodo(owner, { listId, title: 'Owner item' }, database);
    expect(await titles(friend)).toEqual(['Owner item']);
  });

  it('cannot create, edit, tick, reorder or delete', async () => {
    const item = await createTodo(owner, { listId, title: 'Owner item' }, database);
    if (!item) throw new Error('setup failed');

    expect(await createTodo(friend, { listId, title: 'Sneaky' }, database)).toBeNull();
    expect(await updateTodo(friend, item.id, { title: 'Hacked' }, database)).toBeNull();
    expect(await setTodoDone(friend, item.id, true, database)).toBeNull();
    expect(await deleteTodo(friend, item.id, database)).toBe(false);
    expect(await reorderTodo(friend, { id: item.id, listId, afterId: null }, database)).toBe(false);

    const after = await getTodo(owner, item.id, database);
    expect(after?.title).toBe('Owner item');
    expect(after?.done).toBe(false);
  });
});

describe('an editor', () => {
  beforeEach(() => share('editor'));

  it('can add todos to a list they do not own', async () => {
    const added = await createTodo(friend, { listId, title: 'From friend' }, database);
    expect(added?.title).toBe('From friend');
    // And the owner sees them — the point of sharing.
    expect(await titles(owner)).toEqual(['From friend']);
  });

  it('can tick and edit the owner’s todos', async () => {
    const item = await createTodo(owner, { listId, title: 'Owner item' }, database);
    if (!item) throw new Error('setup failed');

    expect(await setTodoDone(friend, item.id, true, database)).not.toBeNull();
    expect(await updateTodo(friend, item.id, { title: 'Edited' }, database)).not.toBeNull();
    expect((await getTodo(owner, item.id, database))?.title).toBe('Edited');
  });

  it('loses access the moment the grant is revoked', async () => {
    await createTodo(owner, { listId, title: 'Owner item' }, database);
    expect(await titles(friend)).toEqual(['Owner item']);

    await revokeShare(owner, { listId, userId: friend }, database);

    expect(await titles(friend)).toEqual([]);
    expect(await createTodo(friend, { listId, title: 'After revoke' }, database)).toBeNull();
  });
});

describe('a stranger', () => {
  it('sees nothing and can do nothing, shared or not', async () => {
    await share('editor');
    const item = await createTodo(owner, { listId, title: 'Private' }, database);
    if (!item) throw new Error('setup failed');

    expect(await titles(stranger)).toEqual([]);
    expect(await getTodo(stranger, item.id, database)).toBeNull();
    expect(await createTodo(stranger, { listId, title: 'Sneaky' }, database)).toBeNull();
    expect(await updateTodo(stranger, item.id, { title: 'Hacked' }, database)).toBeNull();
    expect(await deleteTodo(stranger, item.id, database)).toBe(false);
  });
});
