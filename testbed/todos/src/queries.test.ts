import type { Scope } from '@keel/contracts/ids';
import { createTestDatabase, seedScope } from '@keel/db/testing';
import { createList } from '@keel/testbed-lists';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createTodo,
  deleteTodo,
  getTodo,
  listDueTodos,
  listTodos,
  reorderTodo,
  setTodoDone,
  updateTodo,
} from './queries.ts';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let owner: Scope;
let stranger: Scope;
let ownerList: string;
let strangerList: string;

beforeEach(async () => {
  database = await createTestDatabase();
  owner = (await seedScope(database, { id: 'owner' })).scope;
  stranger = (await seedScope(database, { id: 'stranger' })).scope;
  ownerList = (await createList(owner, { name: 'Mine' }, database)).id;
  strangerList = (await createList(stranger, { name: 'Theirs' }, database)).id;
});

afterEach(async () => {
  await database.close();
});

const titles = async (userId: Scope, listId: string) =>
  (await listTodos(userId, listId, {}, database)).map((row) => row.title);

describe('quick add', () => {
  it('needs only a title and a list', async () => {
    const row = await createTodo(owner, { listId: ownerList, title: 'Milk' }, database);
    expect(row?.title).toBe('Milk');
    expect(row?.done).toBe(false);
  });

  it('appends in creation order', async () => {
    for (const title of ['A', 'B', 'C']) {
      await createTodo(owner, { listId: ownerList, title }, database);
    }
    expect(await titles(owner, ownerList)).toEqual(['A', 'B', 'C']);
  });
});

describe('ownership', () => {
  it('refuses to file a todo into a list the caller does not own', async () => {
    // The foreign key only proves the list exists — not that it is yours.
    const row = await createTodo(owner, { listId: strangerList, title: 'Intrusion' }, database);
    expect(row).toBeNull();
    expect(await titles(stranger, strangerList)).toEqual([]);
  });

  it('refuses to read, update, tick or delete another user’s todo', async () => {
    const created = await createTodo(owner, { listId: ownerList, title: 'Private' }, database);
    if (!created) throw new Error('setup failed');

    expect(await getTodo(stranger, created.id, database)).toBeNull();
    expect(await updateTodo(stranger, created.id, { title: 'Hacked' }, database)).toBeNull();
    expect(await setTodoDone(stranger, created.id, true, database)).toBeNull();
    expect(await deleteTodo(stranger, created.id, database)).toBe(false);

    const still = await getTodo(owner, created.id, database);
    expect(still?.title).toBe('Private');
    expect(still?.done).toBe(false);
  });

  it('does not leak todos across lists', async () => {
    await createTodo(owner, { listId: ownerList, title: 'Mine' }, database);
    expect(await titles(stranger, strangerList)).toEqual([]);
  });
});

describe('completion', () => {
  it('sinks completed todos to the bottom without moving their position', async () => {
    for (const title of ['A', 'B', 'C']) {
      await createTodo(owner, { listId: ownerList, title }, database);
    }
    const before = await listTodos(owner, ownerList, {}, database);
    const a = before[0];
    if (!a) throw new Error('missing A');

    await setTodoDone(owner, a.id, true, database);
    expect(await titles(owner, ownerList)).toEqual(['B', 'C', 'A']);

    const after = await getTodo(owner, a.id, database);
    expect(after?.position).toBe(a.position);
  });

  it('un-ticking restores the original order', async () => {
    for (const title of ['A', 'B']) {
      await createTodo(owner, { listId: ownerList, title }, database);
    }
    const rows = await listTodos(owner, ownerList, {}, database);
    const a = rows[0];
    if (!a) throw new Error('missing A');

    await setTodoDone(owner, a.id, true, database);
    expect(await titles(owner, ownerList)).toEqual(['B', 'A']);
    await setTodoDone(owner, a.id, false, database);
    expect(await titles(owner, ownerList)).toEqual(['A', 'B']);
  });
});

describe('cascades', () => {
  it('deleting a list removes its todos', async () => {
    const { list } = await import('@keel/db/schema');
    const { eq } = await import('drizzle-orm');

    await createTodo(owner, { listId: ownerList, title: 'Doomed' }, database);
    await database.delete(list).where(eq(list.id, ownerList));
    expect(await titles(owner, ownerList)).toEqual([]);
  });

  it('deleting a user removes their todos', async () => {
    const { user } = await import('@keel/db/schema');
    const { eq } = await import('drizzle-orm');

    await createTodo(owner, { listId: ownerList, title: 'Doomed' }, database);
    await database.delete(user).where(eq(user.id, owner.userId));
    expect(await titles(owner, ownerList)).toEqual([]);
  });
});

describe('due dates and priority', () => {
  it('stores the due date as a SQL date, not a timestamp', async () => {
    // A future edit could flip drizzle's `date()` mode and silently reintroduce the
    // timezone bug the PRD calls the classic failure. Ask the database directly.
    const { sql } = await import('drizzle-orm');
    const result = await database.execute(sql`
      select data_type from information_schema.columns
      where table_name = 'todo' and column_name = 'due_date'
    `);
    expect((result.rows[0] as { data_type: string }).data_type).toBe('date');
  });

  it('round-trips a bare YYYY-MM-DD with no timezone shift', async () => {
    const created = await createTodo(
      owner,
      { listId: ownerList, title: 'Dated', dueDate: '2026-02-28' },
      database,
    );
    expect(created?.dueDate).toBe('2026-02-28');
    expect(typeof created?.dueDate).toBe('string');
  });

  it('distinguishes clearing a due date from leaving it alone', async () => {
    const created = await createTodo(
      owner,
      { listId: ownerList, title: 'D', dueDate: '2026-03-01', priority: 'high' },
      database,
    );
    if (!created) throw new Error('setup failed');

    await updateTodo(owner, created.id, { title: 'D2' }, database);
    expect((await getTodo(owner, created.id, database))?.dueDate).toBe('2026-03-01');

    await updateTodo(owner, created.id, { dueDate: null }, database);
    const cleared = await getTodo(owner, created.id, database);
    expect(cleared?.dueDate).toBeNull();
    expect(cleared?.priority).toBe('high');
  });

  it('orders by priority descending, using the enum declaration order', async () => {
    for (const [title, priority] of [
      ['low one', 'low'],
      ['urgent', 'high'],
      ['middling', 'medium'],
    ] as const) {
      await createTodo(owner, { listId: ownerList, title, priority }, database);
    }
    expect(await titles(owner, ownerList)).toEqual(['urgent', 'middling', 'low one']);
  });

  it('filters by priority and by done state', async () => {
    await createTodo(owner, { listId: ownerList, title: 'H', priority: 'high' }, database);
    await createTodo(owner, { listId: ownerList, title: 'L', priority: 'low' }, database);

    const high = await listTodos(owner, ownerList, { priority: ['high'] }, database);
    expect(high.map((r) => r.title)).toEqual(['H']);

    const outstanding = await listTodos(owner, ownerList, { done: false }, database);
    expect(outstanding).toHaveLength(2);
  });

  it('returns outstanding todos due on or before a day, scoped to the user', async () => {
    const second = await createList(owner, { name: 'Second' }, database);
    await createTodo(owner, { listId: ownerList, title: 'Late', dueDate: '2026-01-01' }, database);
    await createTodo(owner, { listId: second.id, title: 'Today', dueDate: '2026-06-15' }, database);
    await createTodo(owner, { listId: ownerList, title: 'Later', dueDate: '2027-01-01' }, database);
    await createTodo(
      stranger,
      { listId: strangerList, title: 'Not mine', dueDate: '2026-01-01' },
      database,
    );

    const due = await listDueTodos(owner, '2026-06-15', database);
    expect(due.map((row) => row.title)).toEqual(['Late', 'Today']);
    // No list name here on purpose — composing across features is the agenda package's
    // job, not this one's. See testbed/agenda/src/agenda.ts.
    expect(due[1]?.listId).toBe(second.id);
  });
});

describe('reordering', () => {
  const positions = async (listId: string) =>
    (await listTodos(owner, listId, {}, database)).map((row) => row.title);

  it('moves a todo to the top of its list', async () => {
    for (const title of ['A', 'B', 'C']) {
      await createTodo(owner, { listId: ownerList, title }, database);
    }
    const rows = await listTodos(owner, ownerList, {}, database);
    const c = rows.find((row) => row.title === 'C');
    if (!c) throw new Error('missing C');

    await reorderTodo(owner, { id: c.id, listId: ownerList, afterId: null }, database);
    expect(await positions(ownerList)).toEqual(['C', 'A', 'B']);
  });

  it('moves a todo one place, which a naive implementation makes a no-op', async () => {
    for (const title of ['A', 'B', 'C']) {
      await createTodo(owner, { listId: ownerList, title }, database);
    }
    const rows = await listTodos(owner, ownerList, {}, database);
    const [a, b] = rows;
    if (!a || !b) throw new Error('missing rows');

    await reorderTodo(owner, { id: a.id, listId: ownerList, afterId: b.id }, database);
    expect(await positions(ownerList)).toEqual(['B', 'A', 'C']);
  });

  it('writes exactly one row for an ordinary move', async () => {
    for (const title of ['A', 'B', 'C']) {
      await createTodo(owner, { listId: ownerList, title }, database);
    }
    const before = await listTodos(owner, ownerList, {}, database);
    const c = before.find((row) => row.title === 'C');
    if (!c) throw new Error('missing C');

    await reorderTodo(owner, { id: c.id, listId: ownerList, afterId: null }, database);
    const after = await listTodos(owner, ownerList, {}, database);

    const moved = after.filter((row) => {
      const original = before.find((b) => b.id === row.id);
      return original && original.position !== row.position;
    });
    expect(moved).toHaveLength(1);
  });

  it('renumbers inside a transaction when the gap is exhausted', async () => {
    const { todo } = await import('@keel/db/schema');
    const { eq } = await import('drizzle-orm');

    for (const title of ['A', 'B', 'C']) {
      await createTodo(owner, { listId: ownerList, title }, database);
    }
    const rows = await listTodos(owner, ownerList, {}, database);
    const [a, b, c] = rows;
    if (!a || !b || !c) throw new Error('missing rows');

    // Force adjacent doubles between A and B, so no midpoint exists.
    await database.update(todo).set({ position: 1 }).where(eq(todo.id, a.id));
    await database
      .update(todo)
      .set({ position: 1 + Number.EPSILON })
      .where(eq(todo.id, b.id));

    await reorderTodo(owner, { id: c.id, listId: ownerList, afterId: a.id }, database);

    const after = await listTodos(owner, ownerList, {}, database);
    expect(after.map((row) => row.title)).toEqual(['A', 'C', 'B']);

    // Proof the renumber actually ran: pure halving from 1 could never produce this
    // spacing. Asserting the order alone would pass even if the branch were dead.
    const gaps = after.slice(1).map((row, index) => row.position - (after[index]?.position ?? 0));
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1024);
  });

  it('will not reorder another user’s todo', async () => {
    const mine = await createTodo(owner, { listId: ownerList, title: 'Mine' }, database);
    if (!mine) throw new Error('setup failed');
    expect(
      await reorderTodo(stranger, { id: mine.id, listId: ownerList, afterId: null }, database),
    ).toBe(false);
  });

  it('leaves completed todos out of the ordering', async () => {
    for (const title of ['A', 'B']) {
      await createTodo(owner, { listId: ownerList, title }, database);
    }
    const rows = await listTodos(owner, ownerList, {}, database);
    const a = rows[0];
    if (!a) throw new Error('missing A');

    await setTodoDone(owner, a.id, true, database);
    // A is done, so it is not a candidate neighbour — moving B to the top is a no-op that
    // must still succeed rather than throwing on a missing anchor.
    const b = rows[1];
    if (!b) throw new Error('missing B');
    expect(await reorderTodo(owner, { id: b.id, listId: ownerList, afterId: null }, database)).toBe(
      true,
    );
  });
});
