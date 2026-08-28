import { entitlements, PLANS } from '@keel/billing';
import type { OrganizationId, Scope, UserId } from '@keel/contracts/ids';
import { subscription } from '@keel/db/schema';
import { createTestDatabase, seedScope } from '@keel/db/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addMember, createOrganization, listMembers } from './queries.ts';

/**
 * Membership and seats.
 *
 * Note what this file being new says: organizations shipped in T-11 with no unit tests of
 * their own, covered only indirectly through the packages that consume a `Scope`. Adding seat
 * limits was the first thing that needed to assert on membership directly.
 */
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let owner: UserId;
let friendEmail: string;
let strangerEmail: string;
let extraEmail: string;
let outsiderEmail: string;

beforeEach(async () => {
  database = await createTestDatabase();
  const ownerSeed = await seedScope(database, { id: 'owner', email: 'owner@example.test' });
  const friendSeed = await seedScope(database, { id: 'friend', email: 'friend@example.test' });
  const strangerSeed = await seedScope(database, { id: 'stranger', email: 's@example.test' });
  const extraSeed = await seedScope(database, { id: 'extra', email: 'extra@example.test' });
  const outsiderSeed = await seedScope(database, { id: 'outsider', email: 'out@example.test' });

  owner = ownerSeed.scope.userId;
  friendEmail = friendSeed.user.email;
  strangerEmail = strangerSeed.user.email;
  extraEmail = extraSeed.user.email;
  outsiderEmail = outsiderSeed.user.email;
});

afterEach(async () => {
  await database.close();
});

/** A workspace with the owner in it, and its scope. */
async function workspace(name: string) {
  const row = await createOrganization(owner, { name, slug: name.toLowerCase() }, database);
  return {
    id: row.id,
    scope: { userId: owner, organizationId: row.id } as Scope,
  };
}

async function setPlan(organizationId: string, plan: 'free' | 'team' | 'business') {
  await entitlements(organizationId as OrganizationId, database);
  await database
    .update(subscription)
    .set({ plan })
    .where(eq(subscription.organizationId, organizationId));
}

describe('membership', () => {
  it('makes the creator an owner', async () => {
    const { scope } = await workspace('Acme');
    expect(await listMembers(scope, database)).toMatchObject([{ role: 'owner' }]);
  });

  it('refuses an unknown email', async () => {
    const { id, scope } = await workspace('Acme');
    await setPlan(id, 'team');

    expect(
      await addMember(scope, { email: 'nobody@example.test', role: 'member' }, database),
    ).toMatchObject({ ok: false, reason: 'no-such-user' });
  });

  it('refuses a member who tries to invite', async () => {
    const { id, scope } = await workspace('Acme');
    await setPlan(id, 'team');
    await addMember(scope, { email: friendEmail, role: 'member' }, database);

    const friend = await listMembers(scope, database).then((rows) =>
      rows.find((row) => row.email === friendEmail),
    );
    const asFriend = { userId: friend?.userId, organizationId: id } as Scope;

    expect(
      await addMember(asFriend, { email: strangerEmail, role: 'member' }, database),
    ).toMatchObject({ ok: false, reason: 'not-allowed' });
  });
});

describe('seat limits', () => {
  /*
   * Enforced in the query layer, so the public API reaches the same refusal. Same placement
   * and the same argument as the list limit — see .orchestration/lessons/L-028.md.
   */
  it('refuses an invitation beyond the seat allowance', async () => {
    const { scope } = await workspace('Tight');

    // Fill the free plan: the creator holds one seat, so invite until it is full.
    for (const email of [friendEmail, strangerEmail].slice(0, PLANS.free.seats - 1)) {
      expect(await addMember(scope, { email, role: 'member' }, database)).toEqual({ ok: true });
    }
    expect(await listMembers(scope, database)).toHaveLength(PLANS.free.seats);

    const result = await addMember(scope, { email: extraEmail, role: 'member' }, database);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no-seats');
    expect(result.seats).toMatchObject({
      used: PLANS.free.seats,
      limit: PLANS.free.seats,
      plan: 'free',
    });
  });

  it('allows the invitation once the plan has room', async () => {
    const { id, scope } = await workspace('Roomy');
    await setPlan(id, 'team');

    expect(await addMember(scope, { email: friendEmail, role: 'member' }, database)).toEqual({
      ok: true,
    });
    expect(await listMembers(scope, database)).toHaveLength(2);
  });

  /*
   * The case that decides the design. A tenant downgrading from ten seats to one still has
   * ten people, and locking nine of them out to enforce a number is a worse outcome than
   * letting the count sit over. The limit governs *growth*, not existing state.
   */
  it('does not remove or block existing members when the plan shrinks', async () => {
    const { id, scope } = await workspace('Downgraded');
    await setPlan(id, 'team');
    for (const email of [friendEmail, strangerEmail, extraEmail]) {
      await addMember(scope, { email, role: 'member' }, database);
    }

    // Back to a three-seat plan with four people in the workspace.
    await setPlan(id, 'free');

    // Nobody is removed…
    expect(await listMembers(scope, database)).toHaveLength(4);
    // …and an existing member's role can still be changed, because that consumes no seat.
    expect(await addMember(scope, { email: friendEmail, role: 'admin' }, database)).toEqual({
      ok: true,
    });
    // Only adding somebody new is refused.
    expect(
      await addMember(scope, { email: outsiderEmail, role: 'member' }, database),
    ).toMatchObject({ ok: false, reason: 'no-seats' });
  });

  it('counts seats per organisation, not globally', async () => {
    const first = await workspace('One');
    const second = await workspace('Two');
    await setPlan(first.id, 'team');
    await setPlan(second.id, 'team');

    expect(await addMember(first.scope, { email: friendEmail, role: 'member' }, database)).toEqual({
      ok: true,
    });
    // The same person joining a second workspace consumes a seat there, not another here.
    expect(await addMember(second.scope, { email: friendEmail, role: 'member' }, database)).toEqual(
      { ok: true },
    );
  });

  /** A personal workspace is a single seat by construction, whatever the plan says. */
  it('still refuses members on a personal workspace', async () => {
    const personal = { userId: owner, organizationId: `org_${owner}` } as Scope;
    await setPlan(`org_${owner}`, 'business');

    expect(
      await addMember(personal, { email: friendEmail, role: 'member' }, database),
    ).toMatchObject({ ok: false, reason: 'personal' });
  });
});
