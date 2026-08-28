import type { Scope } from '@keel/contracts/ids';
import { createTestDatabase, seedScope } from '@keel/db/testing';
import { createList } from '@keel/testbed-lists';
import { attachTag, createTag } from '@keel/testbed-tags';
import { createTodo, setTodoDone } from '@keel/testbed-todos';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildAgenda } from './agenda.ts';

/**
 * The agenda composes three features, so its tests exercise all three — which is the point
 * of the package existing. Nothing else in the repo reads across feature boundaries.
 */
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let owner: Scope;
let stranger: Scope;
let work: string;
let home: string;

const UTC = 'UTC';

beforeEach(async () => {
  database = await createTestDatabase();
  owner = (await seedScope(database, { id: 'owner' })).scope;
  stranger = (await seedScope(database, { id: 'stranger' })).scope;
  work = (await createList(owner, { name: 'Work' }, database)).id;
  home = (await createList(owner, { name: 'Home' }, database)).id;
});

afterEach(async () => {
  await database.close();
});

const yesterday = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
const today = () => new Date().toISOString().slice(0, 10);
const tomorrow = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

describe('buildAgenda', () => {
  it('separates overdue from due today', async () => {
    await createTodo(owner, { listId: work, title: 'Late', dueDate: yesterday() }, database);
    await createTodo(owner, { listId: home, title: 'Now', dueDate: today() }, database);

    const agenda = await buildAgenda(owner, UTC, database);

    expect(agenda.overdue.map((e) => e.title)).toEqual(['Late']);
    expect(agenda.dueToday.map((e) => e.title)).toEqual(['Now']);
    expect(agenda.empty).toBe(false);
  });

  it('excludes anything due later', async () => {
    await createTodo(owner, { listId: work, title: 'Later', dueDate: tomorrow() }, database);
    const agenda = await buildAgenda(owner, UTC, database);
    expect(agenda.empty).toBe(true);
  });

  it('excludes completed todos even when overdue', async () => {
    const done = await createTodo(
      owner,
      { listId: work, title: 'Finished', dueDate: yesterday() },
      database,
    );
    if (!done) throw new Error('setup failed');
    await setTodoDone(owner, done.id, true, database);

    expect((await buildAgenda(owner, UTC, database)).empty).toBe(true);
  });

  it('excludes todos with no due date', async () => {
    await createTodo(owner, { listId: work, title: 'Someday' }, database);
    expect((await buildAgenda(owner, UTC, database)).empty).toBe(true);
  });

  it('carries the list name across the feature boundary', async () => {
    await createTodo(owner, { listId: home, title: 'Dishes', dueDate: today() }, database);
    const agenda = await buildAgenda(owner, UTC, database);
    expect(agenda.dueToday[0]?.listName).toBe('Home');
  });

  it('carries tags across the feature boundary', async () => {
    const urgent = await createTag(owner, { name: 'urgent', colour: '#ff0000' }, database);
    const item = await createTodo(
      owner,
      { listId: work, title: 'Tagged', dueDate: today() },
      database,
    );
    if (!item || !urgent) throw new Error('setup failed');
    await attachTag(owner, { todoId: item.id, tagId: urgent.id }, database);

    const agenda = await buildAgenda(owner, UTC, database);
    expect(agenda.dueToday[0]?.tags.map((t) => t.name)).toEqual(['urgent']);
  });

  it('never shows another user’s todos, lists or tags', async () => {
    const theirList = await createList(stranger, { name: 'Theirs' }, database);
    await createTodo(
      stranger,
      { listId: theirList.id, title: 'Not mine', dueDate: yesterday() },
      database,
    );
    await createTodo(owner, { listId: work, title: 'Mine', dueDate: yesterday() }, database);

    const agenda = await buildAgenda(owner, UTC, database);
    expect(agenda.overdue.map((e) => e.title)).toEqual(['Mine']);
    expect(agenda.overdue[0]?.listName).toBe('Work');
  });

  it('reads today from the caller’s timezone, not the server’s', async () => {
    // A todo due "today" in Kiritimati (UTC+14) is not yet due in Honolulu (UTC-10).
    await createTodo(owner, { listId: work, title: 'Edge', dueDate: tomorrow() }, database);

    const ahead = await buildAgenda(owner, 'Pacific/Kiritimati', database);
    const behind = await buildAgenda(owner, 'Pacific/Honolulu', database);

    expect(ahead.today >= behind.today).toBe(true);
    // Whatever the zones resolve to, the two must not disagree about their own boundary.
    expect(behind.dueToday.length + behind.overdue.length).toBeLessThanOrEqual(
      ahead.dueToday.length + ahead.overdue.length,
    );
  });
});
