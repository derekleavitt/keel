import { audit, listActivity } from '@keel/audit';
import { grantPlatformAdmin, listAdminActions } from '@keel/auth/platform';
import type { Scope } from '@keel/contracts/ids';
import { createTestDatabase, seedScope } from '@keel/db/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findUsers, listOrganizations, organizationDetail, recordAndDisclose } from './index.ts';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let acme: Scope;
let other: Scope;
let staffEmail: string;

beforeEach(async () => {
  database = await createTestDatabase();
  const first = await seedScope(database, { id: 'acme' });
  const second = await seedScope(database, { id: 'other' });
  acme = first.scope;
  other = second.scope;
  staffEmail = first.user.email;
  await grantPlatformAdmin(staffEmail, { note: 'tests' }, database);
});

afterEach(async () => {
  await database.close();
});

const actor = () => ({ id: acme.userId, email: staffEmail });

describe('crossing tenants, on purpose', () => {
  it('lists every organization with its member count', async () => {
    const organizations = await listOrganizations(50, database);
    expect(organizations.length).toBeGreaterThanOrEqual(2);
    expect(organizations.every((org) => org.members >= 1)).toBe(true);
  });

  it('shows who is in an organization and what they can do', async () => {
    const detail = await organizationDetail(acme.organizationId, database);
    expect(detail?.members).toHaveLength(1);
    expect(detail?.members[0]?.role).toBe('owner');
  });

  it('returns null for an organization that does not exist', async () => {
    expect(await organizationDetail('org_nope', database)).toBeNull();
  });

  it('finds a user by partial email across tenants', async () => {
    const found = await findUsers(staffEmail.slice(0, 6), 10, database);
    expect(found.map((row) => row.email)).toContain(staffEmail);
  });

  /** A `%` typed into the search box is a literal, not a wildcard matching every account. */
  it('treats wildcard characters in the search as literal', async () => {
    expect(await findUsers('%', 10, database)).toHaveLength(0);
    expect(await findUsers('_', 10, database)).toHaveLength(0);
  });
});

describe('disclosure', () => {
  /*
   * The property that keeps a cross-tenant support tool honest. A log only the vendor can
   * read is not the same promise as one the customer can read.
   */
  it('writes a tenant-facing entry as well as the staff one', async () => {
    await recordAndDisclose(
      actor(),
      {
        action: 'organization.inspected',
        summary: 'opened the organization',
        organizationId: acme.organizationId,
      },
      database,
    );

    const staffLog = await listAdminActions(10, database);
    expect(staffLog[0]?.action).toBe('organization.inspected');

    const tenantLog = await listActivity(acme, {}, database);
    expect(tenantLog[0]?.action).toBe('staff.organization.inspected');
    // Named, not anonymised: "someone at the vendor" is a worse answer than a name.
    expect(tenantLog[0]?.summary).toContain(staffEmail);
    expect(tenantLog[0]?.summary).toContain('(support)');
  });

  it('discloses only to the tenant named, not to every tenant', async () => {
    await recordAndDisclose(
      actor(),
      {
        action: 'organization.inspected',
        summary: 'opened the organization',
        organizationId: acme.organizationId,
      },
      database,
    );

    expect(await listActivity(other, {}, database)).toHaveLength(0);
  });

  /** A platform-wide action has no tenant to disclose to, and that is normal. */
  it('records an untargeted action without disclosing it anywhere', async () => {
    await recordAndDisclose(
      actor(),
      { action: 'organizations.listed', summary: 'listed every organization' },
      database,
    );

    expect(await listAdminActions(10, database)).toHaveLength(1);
    expect(await listActivity(acme, {}, database)).toHaveLength(0);
    expect(await listActivity(other, {}, database)).toHaveLength(0);
  });

  it('does not disturb the tenant’s own activity', async () => {
    await audit(
      acme,
      { action: 'list.created', targetType: 'list', targetId: 'l1', summary: 'made a list' },
      database,
    );
    await recordAndDisclose(
      actor(),
      {
        action: 'organization.inspected',
        summary: 'looked',
        organizationId: acme.organizationId,
      },
      database,
    );

    const tenantLog = await listActivity(acme, {}, database);
    expect(tenantLog.map((row) => row.action)).toEqual([
      'staff.organization.inspected',
      'list.created',
    ]);
  });
});

describe('search determinism', () => {
  /*
   * A `LIMIT` with no `ORDER BY` returns an arbitrary subset, and which subset changes as
   * the table grows — a support tool that silently omits the account being searched for is
   * worse than a slow one. This surfaced as a browser test that passed alone and failed in
   * the full suite, once enough users existed to exceed the limit.
   */
  it('returns the same page of results every time', async () => {
    for (let n = 0; n < 8; n += 1) {
      await seedScope(database, { id: `bulk${n}` });
    }

    const first = await findUsers('@', 5, database);
    const second = await findUsers('@', 5, database);
    expect(first.map((row) => row.email)).toEqual(second.map((row) => row.email));
    expect(first.map((row) => row.email)).toEqual([...first.map((row) => row.email)].sort());
  });
});
