import type { Scope } from '@keel/contracts/ids';
import { createTestDatabase, seedScope } from '@keel/db/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audit, listActivity } from './index.ts';

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

const summaries = async (scope: Scope, options = {}) =>
  (await listActivity(scope, options, database)).map((row) => row.summary);

describe('recording', () => {
  it('stamps the actor, the action and the time', async () => {
    const before = new Date();
    await audit(
      acme,
      { action: 'list.created', targetType: 'list', targetId: 'lst_1', summary: 'created a list' },
      database,
    );

    const [entry] = await listActivity(acme, {}, database);
    expect(entry?.action).toBe('list.created');
    expect(entry?.actorEmail).toContain('@');
    expect(entry?.targetId).toBe('lst_1');
    expect(entry?.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });

  it('returns newest first', async () => {
    for (const n of [1, 2, 3]) {
      await audit(
        acme,
        { action: 'todo.created', targetType: 'todo', targetId: `t${n}`, summary: `todo ${n}` },
        database,
      );
    }
    expect(await summaries(acme)).toEqual(['todo 3', 'todo 2', 'todo 1']);
  });
});

describe('tenancy', () => {
  /*
   * The one failure mode that makes an audit log worse than no audit log: it is a record
   * of everything anyone did, so a leak across tenants exposes activity that no ordinary
   * query would ever have shown.
   */
  it('never returns another organisation’s entries', async () => {
    await audit(
      acme,
      { action: 'list.created', targetType: 'list', targetId: 'a', summary: 'acme did a thing' },
      database,
    );
    await audit(
      other,
      { action: 'list.created', targetType: 'list', targetId: 'b', summary: 'other did a thing' },
      database,
    );

    expect(await summaries(acme)).toEqual(['acme did a thing']);
    expect(await summaries(other)).toEqual(['other did a thing']);
  });
});

describe('filtering', () => {
  it('narrows to the history of one resource', async () => {
    await audit(
      acme,
      { action: 'list.created', targetType: 'list', targetId: 'lst_1', summary: 'made the list' },
      database,
    );
    await audit(
      acme,
      { action: 'todo.created', targetType: 'todo', targetId: 'tdo_1', summary: 'made a todo' },
      database,
    );

    expect(await summaries(acme, { targetType: 'list', targetId: 'lst_1' })).toEqual([
      'made the list',
    ]);
    expect(await summaries(acme, { targetType: 'todo' })).toEqual(['made a todo']);
  });
});

describe('durability', () => {
  /*
   * The reason `target_id` carries no foreign key. "Who deleted this?" is asked after the
   * thing is gone; a cascade would delete the answer along with the question.
   */
  it('keeps entries whose target no longer exists', async () => {
    await audit(
      acme,
      {
        action: 'list.deleted',
        targetType: 'list',
        targetId: 'lst_that_never_existed',
        summary: 'deleted a list',
      },
      database,
    );

    expect(await summaries(acme)).toEqual(['deleted a list']);
  });

  /*
   * A failed log must not fail the operation being logged. Losing a user's work to
   * preserve a line in a feed is the wrong trade in every direction.
   */
  it('swallows its own failures rather than failing the mutation', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      audit(
        { userId: acme.userId, organizationId: 'org_does_not_exist' } as Scope,
        { action: 'x.y', targetType: 'x', targetId: '1', summary: 'doomed' },
        database,
      ),
    ).resolves.toBeUndefined();

    expect(stderr).toHaveBeenCalledOnce();
    expect(String(stderr.mock.calls[0]?.[0])).toContain('audit.failed');
    stderr.mockRestore();
  });
});
