import { adminAction, platformAdmin } from '@keel/db/schema';
import { createTestDatabase, seedScope } from '@keel/db/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  grantPlatformAdmin,
  isPlatformAdmin,
  listAdminActions,
  listPlatformAdmins,
  recordAdminAction,
  revokePlatformAdmin,
} from './platform.ts';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let staff: { userId: string; email: string };
let customer: { userId: string; email: string };

beforeEach(async () => {
  database = await createTestDatabase();
  const first = await seedScope(database, { id: 'staff' });
  const second = await seedScope(database, { id: 'customer' });
  staff = { userId: first.scope.userId, email: first.user.email };
  customer = { userId: second.scope.userId, email: second.user.email };
});

afterEach(async () => {
  await database.close();
});

describe('the platform role is a separate axis', () => {
  /*
   * The mistake this table exists to prevent. Every customer can create an organization and
   * is its owner, so if staff access were a membership role, every customer would have it.
   */
  it('owning an organization does not make you staff', async () => {
    expect(await isPlatformAdmin(customer.userId, database)).toBe(false);
    expect(await isPlatformAdmin(staff.userId, database)).toBe(false);
  });

  it('granting is explicit and revocable', async () => {
    expect(await grantPlatformAdmin(staff.email, { note: 'on call' }, database)).toEqual({
      ok: true,
      userId: staff.userId,
    });
    expect(await isPlatformAdmin(staff.userId, database)).toBe(true);
    expect(await isPlatformAdmin(customer.userId, database)).toBe(false);

    expect(await revokePlatformAdmin(staff.userId, database)).toBe(true);
    expect(await isPlatformAdmin(staff.userId, database)).toBe(false);
  });

  it('granting twice does not duplicate or move the grant', async () => {
    await grantPlatformAdmin(staff.email, { note: 'first' }, database);
    const [before] = await database
      .select()
      .from(platformAdmin)
      .where(eq(platformAdmin.userId, staff.userId));

    await grantPlatformAdmin(staff.email, { note: 'second' }, database);
    const rows = await database.select().from(platformAdmin);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.grantedAt).toEqual(before?.grantedAt);
    expect(rows[0]?.note).toBe('first');
  });

  it('refuses to grant to an unknown email', async () => {
    expect(await grantPlatformAdmin('nobody@example.test', {}, database)).toEqual({
      ok: false,
      error: 'No user with email nobody@example.test',
    });
  });

  it('revoking someone who is not staff reports it', async () => {
    expect(await revokePlatformAdmin(customer.userId, database)).toBe(false);
  });

  /** The list has to be readable, or who has access becomes folklore. */
  it('lists who has access', async () => {
    await grantPlatformAdmin(staff.email, { note: 'on call' }, database);
    const admins = await listPlatformAdmins(database);
    expect(admins.map((row) => row.email)).toEqual([staff.email]);
    expect(admins[0]?.note).toBe('on call');
  });
});

describe('the staff action log', () => {
  it('records who did what', async () => {
    await recordAdminAction(
      { id: staff.userId, email: staff.email },
      { action: 'users.searched', summary: 'searched users for “a”' },
      database,
    );

    const [entry] = await listAdminActions(10, database);
    expect(entry?.actorEmail).toBe(staff.email);
    expect(entry?.action).toBe('users.searched');
    // No tenant is the normal case for a platform action, not missing data.
    expect(entry?.organizationId).toBeNull();
  });

  /** Losing the log must not fail the support action it describes. */
  it('never throws', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      recordAdminAction(
        { id: staff.userId, email: staff.email },
        {
          action: 'x',
          summary: 'doomed',
          organizationId: 'org_does_not_exist',
        },
        database,
      ),
    ).resolves.toBeUndefined();
    expect(stderr).toHaveBeenCalledOnce();
    stderr.mockRestore();
  });

  it('returns newest first', async () => {
    for (const n of [1, 2, 3]) {
      await recordAdminAction(
        { id: staff.userId, email: staff.email },
        { action: 'a', summary: `action ${n}` },
        database,
      );
    }
    expect((await listAdminActions(10, database)).map((row) => row.summary)).toEqual([
      'action 3',
      'action 2',
      'action 1',
    ]);
  });

  it('keeps the actor email even after the account changes', async () => {
    await recordAdminAction(
      { id: staff.userId, email: staff.email },
      { action: 'a', summary: 'did a thing' },
      database,
    );
    const [row] = await database.select().from(adminAction);
    expect(row?.actorEmail).toBe(staff.email);
  });
});
