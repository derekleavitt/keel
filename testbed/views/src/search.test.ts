import type { UserId } from '@keel/contracts/ids';
import { createTestDatabase, seedUser } from '@keel/db/testing';
import { createList } from '@keel/testbed-lists';
import { createTodo } from '@keel/testbed-todos';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { searchAcrossLists } from './search.ts';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let owner: UserId;
let stranger: UserId;
let work: string;
let home: string;

beforeEach(async () => {
  database = await createTestDatabase();
  owner = (await seedUser(database, { id: 'owner' })).id as UserId;
  stranger = (await seedUser(database, { id: 'stranger' })).id as UserId;
  work = (await createList(owner, { name: 'Work' }, database)).id;
  home = (await createList(owner, { name: 'Home' }, database)).id;
});

afterEach(async () => {
  await database.close();
});

const titles = async (query: string) =>
  (await searchAcrossLists(owner, query, database)).hits.map((hit) => hit.title);

describe('searchAcrossLists', () => {
  it('matches on title and on notes', async () => {
    await createTodo(owner, { listId: work, title: 'Buy milk' }, database);
    await createTodo(
      owner,
      { listId: home, title: 'Errands', notes: 'remember the milk' },
      database,
    );
    await createTodo(owner, { listId: work, title: 'Unrelated' }, database);

    expect((await titles('milk')).sort()).toEqual(['Buy milk', 'Errands']);
  });

  it('is case-insensitive', async () => {
    await createTodo(owner, { listId: work, title: 'Buy MILK' }, database);
    expect(await titles('milk')).toEqual(['Buy MILK']);
  });

  it('returns everything for an empty query rather than nothing', async () => {
    // A search box that empties the screen when cleared reads as broken.
    await createTodo(owner, { listId: work, title: 'One' }, database);
    await createTodo(owner, { listId: home, title: 'Two' }, database);

    const blank = await searchAcrossLists(owner, '   ', database);
    expect(blank.hits).toHaveLength(2);
    expect(blank.searched).toBe(false);
  });

  it('treats a typed % as a literal, not a wildcard', async () => {
    await createTodo(owner, { listId: work, title: '50% done' }, database);
    await createTodo(owner, { listId: work, title: '50 things' }, database);

    // Unescaped, "50%" as a LIKE pattern would match both.
    expect(await titles('50%')).toEqual(['50% done']);
  });

  it('treats a typed _ as a literal, not a single-character wildcard', async () => {
    await createTodo(owner, { listId: work, title: 'snake_case' }, database);
    await createTodo(owner, { listId: work, title: 'snakeXcase' }, database);

    expect(await titles('snake_case')).toEqual(['snake_case']);
  });

  it('handles a backslash without breaking the escape', async () => {
    await createTodo(owner, { listId: work, title: 'path\\to\\file' }, database);
    expect(await titles('path\\to')).toEqual(['path\\to\\file']);
  });

  it('never returns another user’s todos', async () => {
    const theirs = await createList(stranger, { name: 'Theirs' }, database);
    await createTodo(stranger, { listId: theirs.id, title: 'Secret milk' }, database);
    await createTodo(owner, { listId: work, title: 'My milk' }, database);

    expect(await titles('milk')).toEqual(['My milk']);
    const asStranger = await searchAcrossLists(stranger, 'milk', database);
    expect(asStranger.hits.map((h) => h.title)).toEqual(['Secret milk']);
  });

  it('carries the list name across the feature boundary', async () => {
    await createTodo(owner, { listId: home, title: 'Dishes' }, database);
    const results = await searchAcrossLists(owner, 'Dishes', database);
    expect(results.hits[0]?.listName).toBe('Home');
  });
});
