import type { Scope } from '@keel/contracts/ids';
import { billingEvent, subscription } from '@keel/db/schema';
import { createTestDatabase, seedScope } from '@keel/db/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyProviderEvent,
  checkLimit,
  effectivePlan,
  entitlements,
  limitFor,
  PLANS,
  stubProvider,
} from './index.ts';
import type { ProviderEvent } from './provider.ts';

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

const at = (iso: string) => new Date(iso);

const event = (over: Partial<ProviderEvent> = {}): ProviderEvent => ({
  id: `evt_${Math.random().toString(36).slice(2)}`,
  type: 'subscription.updated',
  createdAt: at('2026-08-28T10:00:00Z'),
  organizationId: acme.organizationId,
  plan: 'team',
  status: 'active',
  seats: 10,
  ...over,
});

describe('entitlements', () => {
  it('creates a free subscription on first read', async () => {
    expect(await entitlements(acme.organizationId, database)).toMatchObject({
      plan: 'free',
      status: 'active',
    });
    const rows = await database.select().from(subscription);
    expect(rows).toHaveLength(1);
  });

  it('is idempotent, so a race cannot create two', async () => {
    await Promise.all([
      entitlements(acme.organizationId, database),
      entitlements(acme.organizationId, database),
      entitlements(acme.organizationId, database),
    ]);
    expect(await database.select().from(subscription)).toHaveLength(1);
  });

  /*
   * `past_due` keeps its entitlements. Cutting a customer off the moment a card expires
   * loses their access over a billing detail they can usually fix in a minute, while the
   * provider is still retrying the charge.
   */
  it('keeps the plan while payment is merely late', () => {
    expect(effectivePlan('team', 'past_due')).toBe('team');
    expect(effectivePlan('team', 'trialing')).toBe('team');
  });

  /** Cancelling drops to free, not to nothing — a former customer can still read and export. */
  it('falls back to free when cancelled', () => {
    expect(effectivePlan('business', 'canceled')).toBe('free');
  });
});

describe('limits', () => {
  it('reports usage and allowance, not just a verdict', async () => {
    const check = await checkLimit(acme.organizationId, 'lists', 0, database);
    expect(check).toMatchObject({ allowed: true, used: 0, limit: PLANS.free.lists });
  });

  it('refuses once usage has reached the allowance', async () => {
    const check = await checkLimit(acme.organizationId, 'lists', PLANS.free.lists, database);
    expect(check.allowed).toBe(false);
  });

  it('treats unlimited as unlimited rather than a very large number', async () => {
    expect(limitFor('business', 'lists')).toBeNull();
    // Create the row first: `entitlements` is what creates it, so updating before that call
    // updates nothing and the read then writes a free row over the top.
    await entitlements(acme.organizationId, database);
    await database
      .update(subscription)
      .set({ plan: 'business' })
      .where(eq(subscription.organizationId, acme.organizationId));

    const check = await checkLimit(acme.organizationId, 'lists', 10_000, database);
    expect(check.limit).toBeNull();
    expect(check.allowed).toBe(true);
  });

  /*
   * Billing cannot count lists, and that is the design: it would mean this package knowing
   * which tables a feature owns. The enforcement test therefore lives in `testbed/lists`,
   * where the dependency runs the right way round.
   */
  it('counts nothing itself — the caller measures', async () => {
    const generous = await checkLimit(acme.organizationId, 'lists', 0, database);
    const exceeded = await checkLimit(acme.organizationId, 'lists', 99, database);
    expect([generous.allowed, exceeded.allowed]).toEqual([true, false]);
  });

  it('each tenant is measured against its own plan', async () => {
    await entitlements(other.organizationId, database);
    await applyProviderEvent(
      event({ organizationId: other.organizationId, plan: 'team' }),
      database,
    );

    expect((await checkLimit(acme.organizationId, 'lists', 5, database)).allowed).toBe(false);
    expect((await checkLimit(other.organizationId, 'lists', 5, database)).allowed).toBe(true);
  });
});

describe('reconciliation', () => {
  it('applies an update', async () => {
    await entitlements(acme.organizationId, database);
    expect(await applyProviderEvent(event(), database)).toEqual({ applied: true });

    expect(await entitlements(acme.organizationId, database)).toMatchObject({
      plan: 'team',
      status: 'active',
      seats: 10,
    });
  });

  /*
   * Providers retry aggressively and two retries can be in flight at once, so the guard is
   * the primary key on the event id rather than a read-then-write check.
   */
  it('is idempotent — the same event twice changes nothing', async () => {
    await entitlements(acme.organizationId, database);
    const duplicate = event();

    expect(await applyProviderEvent(duplicate, database)).toEqual({ applied: true });
    expect(await applyProviderEvent(duplicate, database)).toEqual({
      applied: false,
      reason: 'duplicate',
    });

    expect(await database.select().from(billingEvent)).toHaveLength(1);
  });

  it('holds under concurrent delivery of the same event', async () => {
    await entitlements(acme.organizationId, database);
    const duplicate = event();

    const results = await Promise.all([
      applyProviderEvent(duplicate, database),
      applyProviderEvent(duplicate, database),
      applyProviderEvent(duplicate, database),
    ]);

    expect(results.filter((r) => r.applied)).toHaveLength(1);
    expect(await database.select().from(billingEvent)).toHaveLength(1);
  });

  /*
   * The other half, and a different mechanism: webhooks are not ordered, so a cancellation
   * sent at 10:00 can arrive after an update sent at 09:59. Applying them in arrival order
   * would resurrect a cancelled subscription.
   */
  it('ignores an event older than the state it would overwrite', async () => {
    await entitlements(acme.organizationId, database);
    await applyProviderEvent(
      event({ type: 'subscription.canceled', createdAt: at('2026-08-28T10:00:00Z') }),
      database,
    );

    const stale = await applyProviderEvent(
      event({ plan: 'business', createdAt: at('2026-08-28T09:59:00Z') }),
      database,
    );

    expect(stale).toEqual({ applied: false, reason: 'stale' });
    expect(await entitlements(acme.organizationId, database)).toMatchObject({
      plan: 'free',
      status: 'canceled',
    });
  });

  /** A stale event is still recorded — the log answers "did we ever receive it". */
  it('records an event it declines to apply, and why', async () => {
    await entitlements(acme.organizationId, database);
    await applyProviderEvent(event({ createdAt: at('2026-08-28T10:00:00Z') }), database);
    await applyProviderEvent(event({ createdAt: at('2026-08-28T09:00:00Z') }), database);

    const rows = await database.select().from(billingEvent);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.skippedReason).filter(Boolean)).toEqual(['stale']);
  });

  it('declines an event for an organisation that does not exist', async () => {
    const result = await applyProviderEvent(event({ organizationId: 'org_nope' }), database);
    expect(result).toEqual({ applied: false, reason: 'unknown organization' });
  });

  it('cancelling drops the plan and the seats together', async () => {
    await entitlements(acme.organizationId, database);
    await applyProviderEvent(event({ plan: 'team', seats: 10 }), database);
    await applyProviderEvent(
      event({ type: 'subscription.canceled', createdAt: at('2026-08-28T11:00:00Z') }),
      database,
    );

    expect(await entitlements(acme.organizationId, database)).toMatchObject({
      plan: 'free',
      status: 'canceled',
      seats: 1,
    });
  });
});

describe('the provider boundary', () => {
  const provider = stubProvider('whsec_test');

  it('refuses a webhook with the wrong signature', async () => {
    const body = JSON.stringify({ id: 'evt_1', type: 'subscription.updated' });
    expect(await provider.parseWebhook(body, 'wrong')).toBeNull();
    expect(await provider.parseWebhook(body, null)).toBeNull();
  });

  it('refuses a body that is not the shape it claims', async () => {
    expect(await provider.parseWebhook('not json', 'whsec_test')).toBeNull();
    expect(await provider.parseWebhook('{"nope":1}', 'whsec_test')).toBeNull();
  });

  it('parses a well-formed event', async () => {
    const parsed = await provider.parseWebhook(
      JSON.stringify({
        id: 'evt_1',
        type: 'subscription.updated',
        createdAt: '2026-08-28T10:00:00Z',
        organizationId: acme.organizationId,
        plan: 'team',
      }),
      'whsec_test',
    );
    expect(parsed).toMatchObject({ id: 'evt_1', plan: 'team' });
  });
});
