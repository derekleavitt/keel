import type { Scope } from '@keel/contracts/ids';
import { changeLog } from '@keel/db/schema';
import { createTestDatabase, seedScope } from '@keel/db/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changesSince, channelFor, currentCursor, pruneChangeLog, publish } from './index.ts';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let acme: Scope;
let other: Scope;

beforeEach(async () => {
  database = await createTestDatabase();
  acme = (await seedScope(database, { id: 'acme' })).scope;
  other = (await seedScope(database, { id: 'other' })).scope;
});

afterEach(async () => {
  await database.close();
});

const since = (scope: Scope, channels: string[], cursor: number) =>
  changesSince(scope.organizationId, channels, cursor, database);

describe('cursors', () => {
  it('reports only what happened after the cursor', async () => {
    await publish(acme, 'list:a', database);
    const mark = await currentCursor(acme.organizationId, database);

    await publish(acme, 'list:a', database);
    await publish(acme, 'list:a', database);

    const changes = await since(acme, ['list:a'], mark);
    expect(changes).toHaveLength(2);
    expect(changes[0]?.id).toBeGreaterThan(mark);
  });

  it('is monotonic, so a client never goes backwards', async () => {
    for (let n = 0; n < 5; n += 1) await publish(acme, 'list:a', database);
    const ids = (await since(acme, ['list:a'], 0)).map((change) => change.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  /*
   * The reconnection path and the first-connection path are the same code, which is what
   * makes recovery something exercised on every page load rather than only in an incident.
   */
  it('a resumed cursor recovers everything missed while away', async () => {
    await publish(acme, 'list:a', database);
    const disconnectedAt = await currentCursor(acme.organizationId, database);

    for (let n = 0; n < 3; n += 1) await publish(acme, 'list:a', database);

    expect(await since(acme, ['list:a'], disconnectedAt)).toHaveLength(3);
  });

  it('starts a fresh subscriber at now, not at the beginning of history', async () => {
    for (let n = 0; n < 3; n += 1) await publish(acme, 'list:a', database);
    const fresh = await currentCursor(acme.organizationId, database);

    expect(await since(acme, ['list:a'], fresh)).toEqual([]);
  });

  it('is zero for a tenant that has never changed anything', async () => {
    expect(await currentCursor(acme.organizationId, database)).toBe(0);
  });
});

describe('channels', () => {
  it('returns only the channels asked for', async () => {
    await publish(acme, 'list:a', database);
    await publish(acme, 'list:b', database);

    expect((await since(acme, ['list:a'], 0)).map((c) => c.channel)).toEqual(['list:a']);
  });

  it('returns nothing when no channels are requested', async () => {
    await publish(acme, 'list:a', database);
    expect(await since(acme, [], 0)).toEqual([]);
  });

  it('names channels the same way for publisher and subscriber', () => {
    expect(channelFor('list', 'lst_1')).toBe('list:lst_1');
  });
});

describe('tenancy', () => {
  /*
   * The channel name comes from the client, so it is a request rather than a permission.
   * Even a correctly-guessed channel belonging to another tenant reveals nothing — including
   * the *timing* of their activity, which is what an unscoped query would leak.
   */
  it('never reports another organisation’s changes, even on a known channel', async () => {
    await publish(other, 'list:secret', database);

    expect(await since(acme, ['list:secret'], 0)).toEqual([]);
    expect(await since(other, ['list:secret'], 0)).toHaveLength(1);
  });

  it('keeps cursors independent per tenant', async () => {
    await publish(other, 'list:a', database);
    expect(await currentCursor(acme.organizationId, database)).toBe(0);
    expect(await currentCursor(other.organizationId, database)).toBeGreaterThan(0);
  });
});

describe('publishing', () => {
  /*
   * The notification commits with the write that caused it — so a rolled-back mutation
   * cannot wake anybody into refetching state that was never stored.
   */
  it('is lost when the transaction that published it rolls back', async () => {
    await expect(
      database.transaction(async (tx) => {
        await publish(acme, 'list:a', tx);
        throw new Error('the mutation failed');
      }),
    ).rejects.toThrow('the mutation failed');

    expect(await since(acme, ['list:a'], 0)).toEqual([]);
  });

  /** A failure to notify must not fail the write it describes. */
  it('never throws', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      publish({ ...acme, organizationId: 'org_missing' } as Scope, 'list:a', database),
    ).resolves.toBeUndefined();
    expect(stderr).toHaveBeenCalledOnce();
    stderr.mockRestore();
  });
});

describe('pruning', () => {
  it('discards entries older than the window and keeps the rest', async () => {
    await publish(acme, 'list:a', database);
    const old = new Date(Date.now() - 60 * 60_000);
    await database.update(changeLog).set({ createdAt: old });
    await publish(acme, 'list:a', database);

    expect(await pruneChangeLog(new Date(Date.now() - 30 * 60_000), database)).toBe(1);
    expect(await since(acme, ['list:a'], 0)).toHaveLength(1);
  });

  /*
   * Pruning must not rewind live cursors. `bigserial` never reuses a value, so a client
   * holding a cursor above the pruned range is unaffected — deleting rows cannot make an
   * old cursor start matching again.
   */
  it('does not rewind a cursor held by a connected client', async () => {
    await publish(acme, 'list:a', database);
    const held = await currentCursor(acme.organizationId, database);

    await pruneChangeLog(new Date(Date.now() + 60_000), database);
    await publish(acme, 'list:a', database);

    const changes = await since(acme, ['list:a'], held);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.id).toBeGreaterThan(held);
  });
});
