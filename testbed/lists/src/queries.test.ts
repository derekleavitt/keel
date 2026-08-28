import { listActivity } from '@keel/audit';
import { entitlements, LimitExceededError, PLANS } from '@keel/billing';
import type { Scope } from '@keel/contracts/ids';
import { subscription } from '@keel/db/schema';
import { createTestDatabase, seedScope } from '@keel/db/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POSITION_STEP } from './position.ts';
import { createList, deleteList, getList, listLists, reorderList, updateList } from './queries.ts';

/**
 * Two users, always. A query that returns the right rows for its owner and also returns
 * them for a stranger passes every single-user test ever written.
 */
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let owner: Scope;
let stranger: Scope;

beforeEach(async () => {
  database = await createTestDatabase();
  owner = (await seedScope(database, { id: 'owner' })).scope;
  stranger = (await seedScope(database, { id: 'stranger' })).scope;
});

afterEach(async () => {
  await database.close();
});

const names = async (userId: Scope) => (await listLists(userId, database)).map((row) => row.name);

describe('ownership', () => {
  it('lists only the caller’s rows', async () => {
    await createList(owner, { name: 'Mine' }, database);
    await createList(stranger, { name: 'Theirs' }, database);
    expect(await names(owner)).toEqual(['Mine']);
    expect(await names(stranger)).toEqual(['Theirs']);
  });

  it('refuses to read, update or delete another user’s list', async () => {
    const created = await createList(owner, { name: 'Private' }, database);

    expect(await getList(stranger, created.id, database)).toBeNull();
    expect(await updateList(stranger, created.id, { name: 'Hacked' }, database)).toBeNull();
    expect(await deleteList(stranger, created.id, database)).toBe(false);

    expect((await getList(owner, created.id, database))?.name).toBe('Private');
  });

  it('will not reorder another user’s list', async () => {
    const created = await createList(owner, { name: 'Private' }, database);
    expect(await reorderList(stranger, { id: created.id, afterId: null }, database)).toBe(false);
  });

  it('removes a user’s lists when the user goes', async () => {
    await createList(owner, { name: 'Doomed' }, database);
    await database.delete((await import('@keel/db/schema')).user);
    expect(await listLists(owner, database)).toHaveLength(0);
  });
});

describe('ordering', () => {
  it('appends new lists in creation order', async () => {
    for (const name of ['A', 'B', 'C']) await createList(owner, { name }, database);
    expect(await names(owner)).toEqual(['A', 'B', 'C']);
  });

  it('moves a list to the front', async () => {
    for (const name of ['A', 'B', 'C']) await createList(owner, { name }, database);
    const rows = await listLists(owner, database);
    const c = rows.find((r) => r.name === 'C');
    if (!c) throw new Error('missing C');

    await reorderList(owner, { id: c.id, afterId: null }, database);
    expect(await names(owner)).toEqual(['C', 'A', 'B']);
  });

  it('moves a list one place, which a naive implementation makes a no-op', async () => {
    for (const name of ['A', 'B', 'C']) await createList(owner, { name }, database);
    const rows = await listLists(owner, database);
    const [a, b] = rows;
    if (!a || !b) throw new Error('missing rows');

    await reorderList(owner, { id: a.id, afterId: b.id }, database);
    expect(await names(owner)).toEqual(['B', 'A', 'C']);
  });

  it('writes exactly one row for an ordinary move', async () => {
    for (const name of ['A', 'B', 'C']) await createList(owner, { name }, database);
    const before = await listLists(owner, database);
    const c = before.find((r) => r.name === 'C');
    if (!c) throw new Error('missing C');

    await reorderList(owner, { id: c.id, afterId: null }, database);
    const after = await listLists(owner, database);

    const moved = after.filter((row) => {
      const original = before.find((b) => b.id === row.id);
      return original && original.position !== row.position;
    });
    expect(moved).toHaveLength(1);
  });

  it('renumbers when the gap between neighbours is exhausted', async () => {
    const { list } = await import('@keel/db/schema');
    const { eq } = await import('drizzle-orm');

    for (const name of ['A', 'B', 'C']) await createList(owner, { name }, database);
    const rows = await listLists(owner, database);
    const [a, b, c] = rows;
    if (!a || !b || !c) throw new Error('missing rows');

    // Force adjacent doubles between A and B, so no midpoint exists.
    await database.update(list).set({ position: 1 }).where(eq(list.id, a.id));
    await database
      .update(list)
      .set({ position: 1 + Number.EPSILON })
      .where(eq(list.id, b.id));

    await reorderList(owner, { id: c.id, afterId: a.id }, database);

    const after = await listLists(owner, database);
    expect(after.map((r) => r.name)).toEqual(['A', 'C', 'B']);

    // A renumber restores usable spacing; halving alone could never produce it.
    const gaps = after.slice(1).map((row, i) => row.position - (after[i]?.position ?? 0));
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(POSITION_STEP);
  });
});

describe('editing', () => {
  it('distinguishes clearing a colour from leaving it alone', async () => {
    const created = await createList(owner, { name: 'L', colour: '#4f46e5' }, database);

    await updateList(owner, created.id, { name: 'L2' }, database);
    expect((await getList(owner, created.id, database))?.colour).toBe('#4f46e5');

    await updateList(owner, created.id, { colour: null }, database);
    expect((await getList(owner, created.id, database))?.colour).toBeNull();
  });

  it('reports deletion honestly', async () => {
    const created = await createList(owner, { name: 'Gone' }, database);
    expect(await deleteList(owner, created.id, database)).toBe(true);
    expect(await deleteList(owner, created.id, database)).toBe(false);
  });
});

describe('activity', () => {
  const feed = async (scope: Scope) =>
    (await listActivity(scope, {}, database)).map((row) => `${row.action}: ${row.summary}`);

  it('records mutations without the caller asking for it', async () => {
    const created = await createList(owner, { name: 'Groceries' }, database);
    await updateList(owner, created.id, { name: 'Shopping' }, database);

    expect(await feed(owner)).toEqual([
      'list.updated: renamed a list to “Shopping”',
      'list.created: created the list “Groceries”',
    ]);
  });

  /*
   * The whole reason `audit_entry.target_id` carries no foreign key. Asking "who deleted
   * this list" only ever happens once the list is gone, so a cascade would delete the
   * answer along with the question.
   */
  it('keeps the entry after the list it describes is deleted', async () => {
    const created = await createList(owner, { name: 'Doomed' }, database);
    expect(await deleteList(owner, created.id, database)).toBe(true);

    expect(await getList(owner, created.id, database)).toBeNull();
    expect(await feed(owner)).toContain('list.deleted: deleted a list');
  });

  it('does not record a write that was refused', async () => {
    const created = await createList(owner, { name: 'Private' }, database);
    await updateList(stranger, created.id, { name: 'Hacked' }, database);
    await deleteList(stranger, created.id, database);

    // The stranger's feed is empty: nothing happened, so nothing is recorded.
    expect(await feed(stranger)).toEqual([]);
  });
});

describe('plan limits', () => {
  /*
   * Enforced in the query layer, which is what makes it unbypassable: the web UI, the public
   * API and any future import all reach `createList`, so there is no endpoint to call
   * instead. Same argument as the audit log — see .orchestration/lessons/L-028.md.
   */
  it('refuses a list beyond the plan allowance', async () => {
    for (let n = 0; n < PLANS.free.lists; n += 1) {
      await createList(owner, { name: `List ${n}` }, database);
    }

    await expect(createList(owner, { name: 'One too many' }, database)).rejects.toBeInstanceOf(
      LimitExceededError,
    );
  });

  it('counts each tenant separately', async () => {
    for (let n = 0; n < PLANS.free.lists; n += 1) {
      await createList(owner, { name: `List ${n}` }, database);
    }
    // A neighbour filling their allowance has no effect on this one.
    await expect(createList(stranger, { name: 'Theirs' }, database)).resolves.toBeTruthy();
  });

  it('allows it again once the plan is raised', async () => {
    for (let n = 0; n < PLANS.free.lists; n += 1) {
      await createList(owner, { name: `List ${n}` }, database);
    }
    await expect(createList(owner, { name: 'Blocked' }, database)).rejects.toThrow();

    await entitlements(owner.organizationId, database);
    await database
      .update(subscription)
      .set({ plan: 'team' })
      .where(eq(subscription.organizationId, owner.organizationId));

    await expect(createList(owner, { name: 'Now fine' }, database)).resolves.toBeTruthy();
  });

  /** The error carries the numbers, so the message can tell the user what to do. */
  it('reports the plan and the allowance it hit', async () => {
    for (let n = 0; n < PLANS.free.lists; n += 1) {
      await createList(owner, { name: `List ${n}` }, database);
    }

    await createList(owner, { name: 'Nope' }, database).catch((error: unknown) => {
      expect(error).toBeInstanceOf(LimitExceededError);
      expect((error as LimitExceededError).check).toMatchObject({
        plan: 'free',
        limit: PLANS.free.lists,
        used: PLANS.free.lists,
      });
    });
  });
});
