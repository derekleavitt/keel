import { db, type KeelDatabase } from '@keel/db';
import { rateLimitBucket } from '@keel/db/schema';
import { lt, sql } from 'drizzle-orm';

/**
 * Rate limiting.
 *
 * ## One statement, or it is not a rate limit
 *
 * The whole check — read the counter, roll the window if it has expired, increment — happens
 * in a single `insert … on conflict do update`. Any version that reads and then writes is
 * two concurrent requests away from being wrong, and concurrent requests are the entire
 * situation a rate limiter exists for. This is the same argument as the idempotency index in
 * [[L-035]] and the billing event key in T-21: when correctness depends on "nobody else did
 * this at the same moment", it belongs in the database's hands rather than the code's.
 *
 * ## Sliding window, not fixed
 *
 * A fixed window lets a client send its whole allowance at 0:59 and again at 1:00 — twice the
 * limit inside two seconds, with every individual window looking compliant. This keeps the
 * previous window's count and weights it by how much of it still overlaps the last `window`
 * milliseconds, which removes the boundary burst for the cost of one integer.
 *
 * The estimate is not exact — a burst inside the previous window is smeared evenly across it
 * — and that is the accepted trade. The alternative, a log of individual timestamps, is exact
 * and costs a row per request.
 *
 * ## The limit is a parameter
 *
 * This package does not know about plans, keys or routes. The caller decides what the limit
 * is and what the key means, which is what keeps `@keel/billing` and this from depending on
 * each other — see [[L-044]] for the cycle that lesson came from.
 */

export interface RateLimitPolicy {
  /** Requests permitted per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  /** Never negative — a client that is over does not need to know by how much. */
  remaining: number;
  /** Epoch milliseconds when the current window ends. */
  resetAt: number;
  /** Seconds to wait, for `Retry-After`. Zero when allowed. */
  retryAfterSeconds: number;
}

/**
 * Count one request against `key` and say whether it is allowed.
 *
 * **The attempt is counted even when it is refused.** A client that keeps hammering while
 * blocked therefore stays blocked rather than being handed a fresh allowance the moment the
 * window rolls — which is the behaviour worth having, because the clients that ignore a 429
 * are exactly the ones the limit is for.
 */
export async function consume(
  key: string,
  policy: RateLimitPolicy,
  database: KeelDatabase = db(),
  now: number = Date.now(),
): Promise<RateLimitResult> {
  const windowStart = Math.floor(now / policy.windowMs) * policy.windowMs;
  const previousStart = windowStart - policy.windowMs;

  /*
   * `excluded` is the row we tried to insert; the aliased table is the row already there.
   * The three cases are: same window (increment), the immediately previous window (roll it
   * down and start again at one), or older than that (both counts are irrelevant).
   */
  const result = (await database.execute(sql`
    insert into ${rateLimitBucket} ("key", "window_start", "current_count", "previous_count")
    values (${key}, ${windowStart}, 1, 0)
    on conflict ("key") do update set
      "previous_count" = case
        when ${rateLimitBucket}."window_start" = ${windowStart}
          then ${rateLimitBucket}."previous_count"
        when ${rateLimitBucket}."window_start" = ${previousStart}
          then ${rateLimitBucket}."current_count"
        else 0
      end,
      "current_count" = case
        when ${rateLimitBucket}."window_start" = ${windowStart}
          then ${rateLimitBucket}."current_count" + 1
        else 1
      end,
      "window_start" = ${windowStart}
    returning "current_count", "previous_count"
  `)) as unknown as
    | { rows: { current_count: number; previous_count: number }[] }
    | { current_count: number; previous_count: number }[];

  // Drivers disagree about the shape of a raw result — see .orchestration/lessons/L-033.md.
  const rows = Array.isArray(result) ? result : result.rows;
  const row = rows?.[0];
  const current = Number(row?.current_count ?? 1);
  const previous = Number(row?.previous_count ?? 0);

  // How much of the previous window still falls inside the trailing `windowMs`.
  const elapsed = now - windowStart;
  const overlap = 1 - elapsed / policy.windowMs;
  const estimated = previous * overlap + current;

  const resetAt = windowStart + policy.windowMs;
  const allowed = estimated <= policy.limit;

  return {
    allowed,
    limit: policy.limit,
    remaining: Math.max(0, Math.floor(policy.limit - estimated)),
    resetAt,
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((resetAt - now) / 1000)),
  };
}

/**
 * The headers to return, on every response rather than only on a 429.
 *
 * A client that can only learn its remaining allowance by being refused has to be refused to
 * find out — which is precisely the request you wanted it not to make. Reporting continuously
 * lets a well-behaved integration slow down before it hits anything.
 *
 * Names follow the IETF `RateLimit-*` draft, which is what most clients now look for;
 * `Retry-After` is the long-standing one and is added only when refused.
 */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'ratelimit-limit': String(result.limit),
    'ratelimit-remaining': String(result.remaining),
    'ratelimit-reset': String(Math.max(0, Math.ceil((result.resetAt - Date.now()) / 1000))),
  };
  if (!result.allowed) headers['retry-after'] = String(result.retryAfterSeconds);
  return headers;
}

/**
 * Discard buckets nobody is using.
 *
 * Without this the table grows one row per distinct key forever — and for IP-keyed limits
 * that is unbounded and attacker-controlled, which turns the rate limiter into a slower way
 * of running out of disk.
 */
export async function pruneRateLimits(
  olderThanMs: number,
  database: KeelDatabase = db(),
  now: number = Date.now(),
): Promise<number> {
  const rows = await database
    .delete(rateLimitBucket)
    .where(lt(rateLimitBucket.windowStart, now - olderThanMs))
    .returning({ key: rateLimitBucket.key });
  return rows.length;
}
