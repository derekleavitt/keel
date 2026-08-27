import type { UserId } from '@keel/contracts/ids';
import { createTestDatabase, seedUser } from '@keel/db/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { roleOnList } from './access.ts';
import { createList, deleteList, getList, listLists, updateList } from './queries.ts';
import { listShares, revokeShare, shareList } from './sharing.ts';

/**
 * Sharing is the first thing in this repo where "can I see it" stops being a property of
 * the row. Every test here has three actors: an owner, someone the list is shared with,
 * and a stranger — because a grant that leaks to a stranger and a grant that fails to
 * reach its recipient are both failures, and a two-actor test catches only one of them.
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

describe('granting', () => {
  it('makes a list visible to the recipient and nobody else', async () => {
    expect(await share('viewer')).toEqual({ ok: true });

    expect((await listLists(friend, database)).map((l) => l.name)).toEqual(['Shared']);
    expect(await listLists(stranger, database)).toEqual([]);
    expect(await getList(stranger, listId, database)).toBeNull();
  });

  it('re-sharing changes the level instead of adding a second grant', async () => {
    await share('viewer');
    await share('editor');

    const shares = await listShares(owner, listId, database);
    expect(shares).toHaveLength(1);
    expect(shares?.[0]?.role).toBe('editor');
  });

  it('refuses to share a list you do not own', async () => {
    await share('editor');
    const result = await shareList(
      friend,
      { listId, email: 's@example.test', role: 'viewer' },
      database,
    );
    // An editor may change what is in a list, never who else can reach it.
    expect(result).toEqual({ ok: false, reason: 'not-owner' });
  });

  it('reports an unknown recipient and self-sharing as ordinary outcomes', async () => {
    expect(
      await shareList(owner, { listId, email: 'nobody@example.test', role: 'viewer' }, database),
    ).toEqual({ ok: false, reason: 'no-such-user' });
    expect(
      await shareList(owner, { listId, email: 'owner@example.test', role: 'viewer' }, database),
    ).toEqual({ ok: false, reason: 'self' });
  });

  it('keeps the grantee list private to the owner', async () => {
    await share('editor');
    expect(await listShares(friend, listId, database)).toBeNull();
    expect(await listShares(stranger, listId, database)).toBeNull();
  });
});

describe('what a grant does and does not permit', () => {
  it('a viewer can read but not rename', async () => {
    await share('viewer');
    expect(await getList(friend, listId, database)).not.toBeNull();
    expect(await updateList(friend, listId, { name: 'Renamed' }, database)).toBeNull();
  });

  it('an editor still cannot rename or delete the list itself', async () => {
    await share('editor');
    expect(await updateList(friend, listId, { name: 'Renamed' }, database)).toBeNull();
    expect(await deleteList(friend, listId, database)).toBe(false);
    expect((await getList(owner, listId, database))?.name).toBe('Shared');
  });

  it('reports the caller’s role', async () => {
    expect(await roleOnList(owner, listId, database)).toBe('owner');
    expect(await roleOnList(friend, listId, database)).toBeNull();
    await share('viewer');
    expect(await roleOnList(friend, listId, database)).toBe('viewer');
    await share('editor');
    expect(await roleOnList(friend, listId, database)).toBe('editor');
    expect(await roleOnList(stranger, listId, database)).toBeNull();
  });
});

describe('revoking', () => {
  it('takes effect on the next query', async () => {
    await share('editor');
    expect(await getList(friend, listId, database)).not.toBeNull();

    expect(await revokeShare(owner, { listId, userId: friend }, database)).toBe(true);

    // The predicates are subqueries evaluated per statement, so there is no cached id list
    // still being trusted after the grant is gone.
    expect(await getList(friend, listId, database)).toBeNull();
    expect(await listLists(friend, database)).toEqual([]);
  });

  it('only the owner may revoke', async () => {
    await share('editor');
    expect(await revokeShare(friend, { listId, userId: friend }, database)).toBe(false);
    expect(await getList(friend, listId, database)).not.toBeNull();
  });

  it('reports honestly when there was nothing to revoke', async () => {
    expect(await revokeShare(owner, { listId, userId: stranger }, database)).toBe(false);
  });

  it('deleting the list removes its grants', async () => {
    await share('editor');
    await deleteList(owner, listId, database);
    expect(await listLists(friend, database)).toEqual([]);
  });
});
