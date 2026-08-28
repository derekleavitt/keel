import { createTestDatabase } from '@keel/db/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { consume, pruneRateLimits, rateLimitHeaders } from './index.ts';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const policy = { limit: 5, windowMs: 60_000 };

beforeEach(async () => {
  database = await createTestDatabase();
});

afterEach(async () => {
  await database.close();
});

/** A fixed instant, so window arithmetic is asserted rather than raced. */
const T0 = 1_800_000_000_000;

describe('counting', () => {
  it('allows up to the limit and refuses the next', async () => {
    for (let n = 1; n <= policy.limit; n += 1) {
      const result = await consume('k', policy, database, T0);
      expect(result.allowed, `request ${n}`).toBe(true);
    }
    expect((await consume('k', policy, database, T0)).allowed).toBe(false);
  });

  it('reports what is left, so a client can slow down before being refused', async () => {
    const first = await consume('k', policy, database, T0);
    expect(first.remaining).toBe(4);

    await consume('k', policy, database, T0);
    expect((await consume('k', policy, database, T0)).remaining).toBe(2);
  });

  it('never reports a negative remaining', async () => {
    for (let n = 0; n < 20; n += 1) await consume('k', policy, database, T0);
    expect((await consume('k', policy, database, T0)).remaining).toBe(0);
  });

  it('keeps separate keys separate', async () => {
    for (let n = 0; n < policy.limit; n += 1) await consume('a', policy, database, T0);

    expect((await consume('a', policy, database, T0)).allowed).toBe(false);
    expect((await consume('b', policy, database, T0)).allowed).toBe(true);
  });
});

describe('windows', () => {
  it('lets a client through again in a later window', async () => {
    for (let n = 0; n < policy.limit; n += 1) await consume('k', policy, database, T0);
    expect((await consume('k', policy, database, T0)).allowed).toBe(false);

    // Two windows on, nothing of the old one overlaps.
    expect((await consume('k', policy, database, T0 + 2 * policy.windowMs)).allowed).toBe(true);
  });

  /*
   * The reason this is a sliding window and not a fixed one. Spend the whole allowance at the
   * very end of a window, then again at the very start of the next: a fixed window sees two
   * compliant windows and permits twice the limit in a couple of seconds.
   */
  it('refuses a burst that straddles the window boundary', async () => {
    const endOfWindow = T0 + policy.windowMs - 1_000;
    for (let n = 0; n < policy.limit; n += 1) await consume('k', policy, database, endOfWindow);

    const startOfNext = T0 + policy.windowMs + 1_000;
    const result = await consume('k', policy, database, startOfNext);

    // Almost all of the previous window still overlaps, so its spend still counts.
    expect(result.allowed).toBe(false);
  });

  it('lets the previous window decay as it falls out of range', async () => {
    for (let n = 0; n < policy.limit; n += 1) await consume('k', policy, database, T0);

    // Nine tenths of the way through the next window, only a tenth of the old one overlaps.
    const late = T0 + policy.windowMs + policy.windowMs * 0.9;
    expect((await consume('k', policy, database, late)).allowed).toBe(true);
  });

  it('reports when the window resets', async () => {
    const result = await consume('k', policy, database, T0 + 10_000);
    expect(result.resetAt).toBe(T0 + policy.windowMs);
  });

  /*
   * A refused attempt still counts. A client that ignores the 429 and keeps hammering stays
   * blocked rather than being handed a fresh allowance — which is the behaviour worth having,
   * because the clients that ignore a 429 are the ones the limit exists for.
   */
  it('counts refused attempts too', async () => {
    for (let n = 0; n < policy.limit + 10; n += 1) await consume('k', policy, database, T0);

    const justInside = T0 + policy.windowMs + 1_000;
    expect((await consume('k', policy, database, justInside)).allowed).toBe(false);
  });
});

describe('concurrency', () => {
  /*
   * The property the whole design turns on. Read-then-write would let several simultaneous
   * requests each read the same count and each decide they are within the limit — and
   * simultaneous requests are the entire situation a rate limiter is for.
   */
  it('counts every request exactly once under simultaneous load', async () => {
    const attempts = 20;
    const results = await Promise.all(
      Array.from({ length: attempts }, () => consume('k', policy, database, T0)),
    );

    expect(results.filter((r) => r.allowed)).toHaveLength(policy.limit);
    expect(results.filter((r) => !r.allowed)).toHaveLength(attempts - policy.limit);
  });

  it('produces one bucket row per key, not one per request', async () => {
    await Promise.all(Array.from({ length: 10 }, () => consume('k', policy, database, T0)));
    const rows = await database.select().from((await import('@keel/db/schema')).rateLimitBucket);
    expect(rows).toHaveLength(1);
  });
});

describe('headers', () => {
  it('reports the allowance on an allowed request, with no Retry-After', () => {
    const headers = rateLimitHeaders({
      allowed: true,
      limit: 5,
      remaining: 3,
      resetAt: Date.now() + 30_000,
      retryAfterSeconds: 0,
    });
    expect(headers['ratelimit-limit']).toBe('5');
    expect(headers['ratelimit-remaining']).toBe('3');
    expect(headers['retry-after']).toBeUndefined();
  });

  it('adds Retry-After when refused', () => {
    const headers = rateLimitHeaders({
      allowed: false,
      limit: 5,
      remaining: 0,
      resetAt: Date.now() + 30_000,
      retryAfterSeconds: 30,
    });
    expect(headers['retry-after']).toBe('30');
  });
});

describe('pruning', () => {
  /*
   * IP-keyed limits mean an attacker chooses how many rows exist. Without pruning the limiter
   * becomes a slower way of running out of disk.
   */
  it('discards buckets whose window is long past, and keeps live ones', async () => {
    await consume('old', policy, database, T0 - 10 * policy.windowMs);
    await consume('live', policy, database, T0);

    expect(await pruneRateLimits(5 * policy.windowMs, database, T0)).toBe(1);
    expect((await consume('live', policy, database, T0)).remaining).toBe(3);
  });
});
