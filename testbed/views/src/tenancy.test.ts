import type { OrganizationId, Scope } from '@keel/contracts/ids';
import { createTestDatabase, seedScope, seedSharedOrganization } from '@keel/db/testing';
import { createList, getList, listLists, shareList } from '@keel/testbed-lists';
import { resolveScope, scopeFor } from '@keel/testbed-orgs';
import { createTodo, listTodos } from '@keel/testbed-todos';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Tenancy, tested adversarially.
 *
 * Lives in the composition package because it spans orgs, lists and todos. Putting it in
 * `testbed/orgs` created a workspace dependency cycle — orgs would have needed the very
 * features that depend on it for `requireScope`. ADR 0001 turns out to describe
 * cross-feature *tests* as well as cross-feature queries.
 *
 * Everything here assumes the attacker already knows the ids — a list id, an organization
 * id, a user id. That is the realistic case: ids leak through URLs, screenshots and logs,
 * and a boundary that only holds while ids stay secret is not a boundary.
 */
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let alice: Scope;
let bob: Scope;
let aliceUserId: string;
let bobUserId: string;

beforeEach(async () => {
  database = await createTestDatabase();
  const a = await seedScope(database, { id: 'alice', email: 'alice@example.test' });
  const b = await seedScope(database, { id: 'bob', email: 'bob@example.test' });
  alice = a.scope;
  bob = b.scope;
  aliceUserId = a.user.id;
  bobUserId = b.user.id;
});

afterEach(async () => {
  await database.close();
});

describe('a scope cannot be forged', () => {
  it('refuses an organization the user does not belong to', async () => {
    expect(await scopeFor(alice.userId, bob.organizationId, database)).toBeNull();
  });

  it('refuses an organization that does not exist', async () => {
    expect(await scopeFor(alice.userId, 'org_invented', database)).toBeNull();
  });

  it('falls back to the personal workspace rather than honouring a forged id', async () => {
    // The cookie is attacker-controlled. The failure mode must be "your own data",
    // never "someone else's".
    const resolved = await resolveScope(alice.userId, bob.organizationId, database);
    expect(resolved?.organizationId).toBe(alice.organizationId);
    expect(resolved?.organizationId).not.toBe(bob.organizationId);
  });
});

describe('data cannot cross a tenant boundary', () => {
  it('a list is invisible from another organization, even with its id', async () => {
    const list = await createList(alice, { name: 'Private' }, database);

    expect(await getList(bob, list.id, database)).toBeNull();
    expect(await listLists(bob, database)).toEqual([]);
  });

  it('a hand-built scope naming the right tenant but the wrong member proves nothing', async () => {
    const list = await createList(alice, { name: 'Private' }, database);

    // Bob asserts Alice's organization id directly. There is no membership row, and the
    // predicates check membership through the data rather than trusting the scope object.
    const forged: Scope = {
      userId: bob.userId,
      organizationId: alice.organizationId as OrganizationId,
    };
    expect(await getList(forged, list.id, database)).toBeNull();
    expect(await listLists(forged, database)).toEqual([]);
  });

  it('todos are invisible across tenants because their list is', async () => {
    const list = await createList(alice, { name: 'Private' }, database);
    await createTodo(alice, { listId: list.id, title: 'Secret' }, database);

    expect(await listTodos(bob, list.id, {}, database)).toEqual([]);
    expect(await createTodo(bob, { listId: list.id, title: 'Sneaky' }, database)).toBeNull();
  });

  it('a share cannot reach someone outside the organization', async () => {
    const list = await createList(alice, { name: 'Private' }, database);

    // Bob is a real user with a real account — just not a member of Alice's workspace.
    await shareList(
      alice,
      { listId: list.id, email: 'bob@example.test', role: 'editor' },
      database,
    );

    expect(await getList(bob, list.id, database)).toBeNull();
    expect(await listLists(bob, database)).toEqual([]);
  });
});

describe('switching organization changes everything at once', () => {
  it('the same user sees different data in each workspace', async () => {
    const inTeam = await seedSharedOrganization(database, [aliceUserId, bobUserId], 'Team');
    const aliceInTeam = inTeam(aliceUserId);

    await createList(alice, { name: 'Personal list' }, database);
    await createList(aliceInTeam, { name: 'Team list' }, database);

    // One user, two scopes, two disjoint worlds — and nothing had to be cleared or
    // re-fetched between them, because the scope is part of every query.
    expect((await listLists(alice, database)).map((l) => l.name)).toEqual(['Personal list']);
    expect((await listLists(aliceInTeam, database)).map((l) => l.name)).toEqual(['Team list']);
  });

  it('a colleague sees the shared workspace but not the personal one', async () => {
    const inTeam = await seedSharedOrganization(database, [aliceUserId, bobUserId], 'Team');
    const aliceInTeam = inTeam(aliceUserId);
    const bobInTeam = inTeam(bobUserId);

    await createList(alice, { name: 'Personal list' }, database);
    const teamList = await createList(aliceInTeam, { name: 'Team list' }, database);

    // Bob is in the team, so the workspace is his — but the list is still Alice's until
    // she shares it. Tenancy and ownership are separate questions.
    expect(await listLists(bobInTeam, database)).toEqual([]);
    expect(await getList(bobInTeam, teamList.id, database)).toBeNull();

    await shareList(
      aliceInTeam,
      { listId: teamList.id, email: 'bob@example.test', role: 'viewer' },
      database,
    );
    expect((await listLists(bobInTeam, database)).map((l) => l.name)).toEqual(['Team list']);

    // And still nothing from Alice's personal workspace.
    expect(await listLists(bob, database)).toEqual([]);
  });
});
