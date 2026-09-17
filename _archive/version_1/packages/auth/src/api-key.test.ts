import type { OrganizationId, UserId } from '@keel/contracts/ids';
import { apiKey } from '@keel/db/schema';
import { createTestDatabase, seedScope } from '@keel/db/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authenticateApiKey, issueApiKey, keyHint, listApiKeys, revokeApiKey } from './api-key.ts';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let acme: { userId: UserId; organizationId: OrganizationId };
let other: { userId: UserId; organizationId: OrganizationId };

beforeEach(async () => {
  database = await createTestDatabase();
  acme = (await seedScope(database, { id: 'acme' })).scope;
  other = (await seedScope(database, { id: 'other' })).scope;
});

afterEach(async () => {
  await database.close();
});

const mint = (scope: typeof acme, name = 'CI') =>
  issueApiKey({ organizationId: scope.organizationId, userId: scope.userId, name }, database);

describe('issuing', () => {
  it('returns a token that authenticates', async () => {
    const issued = await mint(acme);
    expect(issued.token).toMatch(/^keel_sk_[0-9a-f]{64}$/);

    const identity = await authenticateApiKey(issued.token, database);
    expect(identity).toMatchObject({
      keyId: issued.id,
      userId: acme.userId,
      organizationId: acme.organizationId,
    });
  });

  /*
   * The property the whole split-token design exists for. If the stored row is enough to
   * reconstruct the token, a database leak is a credential leak.
   */
  it('stores nothing that reveals the token', async () => {
    const issued = await mint(acme);
    const [stored] = await database.select().from(apiKey).where(eq(apiKey.id, issued.id));

    const secret = issued.token.slice('keel_sk_'.length).slice(16);
    expect(JSON.stringify(stored)).not.toContain(secret);
    expect(JSON.stringify(stored)).not.toContain(issued.token);
  });

  it('mints a distinct token every time', async () => {
    const first = await mint(acme, 'one');
    const second = await mint(acme, 'two');
    expect(first.token).not.toBe(second.token);
  });
});

describe('rejecting', () => {
  it.each([
    ['empty', ''],
    ['no prefix', 'abcdef0123456789'],
    ['prefix only', 'keel_sk_'],
    ['non-hex body', 'keel_sk_zzzzzzzzzzzzzzzzzz'],
    ['unknown selector', `keel_sk_${'a'.repeat(64)}`],
  ])('refuses a %s token', async (_label, token) => {
    expect(await authenticateApiKey(token, database)).toBeNull();
  });

  /*
   * The right selector with the wrong secret must be indistinguishable from a wrong
   * selector. Returning a different answer here tells an attacker that half their guess
   * landed, which is the whole game.
   */
  it('refuses a valid selector with a wrong verifier', async () => {
    const issued = await mint(acme);
    const selector = issued.token.slice('keel_sk_'.length, 'keel_sk_'.length + 16);

    expect(await authenticateApiKey(`keel_sk_${selector}${'b'.repeat(48)}`, database)).toBeNull();
  });
});

describe('revocation', () => {
  it('stops the token working', async () => {
    const issued = await mint(acme);
    expect(await authenticateApiKey(issued.token, database)).not.toBeNull();

    expect(await revokeApiKey(acme.organizationId, issued.id, database)).toBe(true);
    expect(await authenticateApiKey(issued.token, database)).toBeNull();
  });

  it('is idempotent, and keeps the first revocation time', async () => {
    const issued = await mint(acme);
    expect(await revokeApiKey(acme.organizationId, issued.id, database)).toBe(true);
    const [first] = await database.select().from(apiKey).where(eq(apiKey.id, issued.id));

    expect(await revokeApiKey(acme.organizationId, issued.id, database)).toBe(false);
    const [second] = await database.select().from(apiKey).where(eq(apiKey.id, issued.id));
    expect(second?.revokedAt).toEqual(first?.revokedAt);
  });

  it('leaves the row in place, so the record of the key survives', async () => {
    const issued = await mint(acme);
    await revokeApiKey(acme.organizationId, issued.id, database);
    expect(await listApiKeys(acme.organizationId, database)).toHaveLength(1);
  });

  /** One tenant revoking another's key would be a denial of service across the boundary. */
  it('refuses to revoke another organisation’s key', async () => {
    const issued = await mint(acme);
    expect(await revokeApiKey(other.organizationId, issued.id, database)).toBe(false);
    expect(await authenticateApiKey(issued.token, database)).not.toBeNull();
  });
});

describe('tenancy', () => {
  it('lists only the organisation’s own keys', async () => {
    await mint(acme, 'acme key');
    await mint(other, 'other key');

    expect((await listApiKeys(acme.organizationId, database)).map((r) => r.name)).toEqual([
      'acme key',
    ]);
    expect((await listApiKeys(other.organizationId, database)).map((r) => r.name)).toEqual([
      'other key',
    ]);
  });

  /*
   * The task's named acceptance test, at the identity layer: a key resolves to the
   * organization it was issued for and no other. The HTTP half is in
   * `apps/web/e2e/api.spec.ts`.
   */
  it('resolves a key only to the organisation that issued it', async () => {
    const issued = await mint(acme);
    const identity = await authenticateApiKey(issued.token, database);

    expect(identity?.organizationId).toBe(acme.organizationId);
    expect(identity?.organizationId).not.toBe(other.organizationId);
  });
});

describe('bookkeeping', () => {
  it('records last-used on a successful authentication', async () => {
    const issued = await mint(acme);
    expect((await listApiKeys(acme.organizationId, database))[0]?.lastUsedAt).toBeNull();

    await authenticateApiKey(issued.token, database);
    // The update is fire-and-forget, so the assertion polls rather than assuming ordering.
    await expect
      .poll(async () => (await listApiKeys(acme.organizationId, database))[0]?.lastUsedAt)
      .not.toBeNull();
  });
});

describe('display', () => {
  it('shows enough of a key to recognise it and not enough to use it', () => {
    const hint = keyHint('0123456789abcdef');
    expect(hint).toBe('keel_sk_012345…');
    expect(hint).not.toContain('6789abcdef');
  });
});
