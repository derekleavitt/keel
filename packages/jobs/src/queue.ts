import { db, type KeelDatabase } from '@keel/db';
import { job } from '@keel/db/schema';
import { and, asc, eq, lte, sql } from 'drizzle-orm';

/**
 * The job queue.
 *
 * Three properties matter more than throughput, and each is a decision:
 *
 * 1. **Enqueue is transactional.** Pass the same transaction that made the write, and the
 *    job either exists with the row or with neither. "Saved the record but lost the email"
 *    is the classic background-work bug and it is designed out here rather than retried.
 *
 * 2. **Claiming is safe under concurrency.** `FOR UPDATE SKIP LOCKED` means two workers
 *    never take the same job and neither blocks the other — no broker, no leases to expire.
 *
 * 3. **Failure is visible and bounded.** Attempts back off exponentially and then the job
 *    is dead-lettered, not retried forever. A queue that silently retries a permanently
 *    broken job looks healthy while doing nothing.
 */
export interface JobHandler<T = unknown> {
  kind: string;
  handle: (payload: T, context: { database: KeelDatabase; attempt: number }) => Promise<void>;
  /** Override the default retry budget for handlers where retrying is pointless. */
  maxAttempts?: number;
}

/**
 * A registry of handlers with differing payload types.
 *
 * `JobHandler<T>` is contravariant in `T` — a handler taking `DigestSendPayload` is not a
 * handler taking `unknown` — so an array of mixed handlers cannot be typed as
 * `JobHandler<unknown>[]`. `never` is the parameter type every handler is assignable to,
 * which makes this the one signature a heterogeneous registry can have without `any`.
 *
 * The cost is a single cast where the payload is handed back, confined to `runJobs`, where
 * the value genuinely is unknown until the handler is chosen by kind.
 */
export type JobHandlerRegistry = readonly JobHandler<never>[];

export interface EnqueueOptions {
  /** Not before this instant. Defaults to now. */
  runAt?: Date;
  /** Enqueuing the same key twice is a no-op — makes scheduling safe to repeat. */
  uniqueKey?: string;
  maxAttempts?: number;
}

/** Exponential backoff with a ceiling: 1m, 2m, 4m, 8m, 16m, then 30m. */
export function backoffMs(attempt: number): number {
  return Math.min(2 ** (attempt - 1) * 60_000, 30 * 60_000);
}

export async function enqueue(
  kind: string,
  payload: unknown,
  options: EnqueueOptions = {},
  database: KeelDatabase = db(),
): Promise<{ enqueued: boolean }> {
  const rows = await database
    .insert(job)
    .values({
      id: `job_${crypto.randomUUID()}`,
      kind,
      payload,
      runAt: options.runAt ?? new Date(),
      uniqueKey: options.uniqueKey ?? null,
      maxAttempts: options.maxAttempts ?? 5,
    })
    // A duplicate unique key is success, not an error: the work is already scheduled.
    .onConflictDoNothing({ target: job.uniqueKey })
    .returning({ id: job.id });

  return { enqueued: rows.length > 0 };
}

/**
 * Claim one job for this worker.
 *
 * `SKIP LOCKED` is what makes this safe to run from several processes at once: a row
 * already locked by another worker is passed over rather than waited on.
 */
async function claim(database: KeelDatabase, asOf: Date) {
  type ClaimedRow = {
    id: string;
    kind: string;
    payload: unknown;
    attempts: number;
    max_attempts: number;
  };

  const claimed = (await database.execute(sql`
    update ${job} set status = 'running', updated_at = ${asOf}
    where id = (
      select id from ${job}
      where status in ('pending', 'failed') and run_at <= ${asOf}
      order by run_at asc
      for update skip locked
      limit 1
    )
    returning id, kind, payload, attempts, max_attempts
  `)) as unknown as { rows: ClaimedRow[] };

  return claimed.rows[0] ?? null;
}

export interface RunResult {
  processed: number;
  failed: number;
  dead: number;
}

/**
 * Drain up to `limit` jobs.
 *
 * Returns counts rather than throwing: one poisonous job must not stop the worker from
 * making progress on everything behind it.
 */
export async function runJobs(
  handlers: JobHandlerRegistry,
  options: {
    limit?: number;
    database?: KeelDatabase;
    /** Treat this instant as "now". Lets a test run a job scheduled for the future. */
    asOf?: Date;
    onError?: (error: Error, kind: string) => void;
  } = {},
): Promise<RunResult> {
  const database = options.database ?? db();
  const limit = options.limit ?? 25;
  /**
   * The comparison instant is a parameter rather than SQL `now()`.
   *
   * `run_at` is `timestamp` without time zone and `now()` is `timestamptz`, so Postgres
   * reconciles them through the server's zone — and a job stored in UTC is never "due"
   * unless the server happens to run in UTC. It fails silently and completely: the queue
   * claims nothing at all.
   *
   * Passing a `Date` makes both sides the same type, and makes "now" controllable in a
   * test. The underlying schema issue is repo-wide; see K-007.
   */
  const asOf = options.asOf ?? new Date();
  const byKind = new Map(handlers.map((handler) => [handler.kind, handler]));
  const result: RunResult = { processed: 0, failed: 0, dead: 0 };

  for (let index = 0; index < limit; index += 1) {
    const row = await claim(database, asOf);
    if (!row) break;

    const handler = byKind.get(row.kind);
    const attempt = row.attempts + 1;

    if (!handler) {
      // An unknown kind is a deployment mismatch, not a transient fault. Retrying it
      // forever would keep a permanently unrunnable job at the front of the queue.
      await database
        .update(job)
        .set({
          status: 'dead',
          attempts: attempt,
          lastError: `No handler registered for kind "${row.kind}"`,
          updatedAt: new Date(),
        })
        .where(eq(job.id, row.id));
      result.dead += 1;
      continue;
    }

    try {
      // Safe: the handler was selected by `kind`, which is what determines the payload
      // shape. This is the one place the type has to be reasserted.
      await handler.handle(row.payload as never, { database, attempt });
      await database.delete(job).where(eq(job.id, row.id));
      result.processed += 1;
    } catch (caught) {
      const error = caught instanceof Error ? caught : new Error(String(caught));
      const max = handler.maxAttempts ?? row.max_attempts;
      const exhausted = attempt >= max;

      await database
        .update(job)
        .set({
          status: exhausted ? 'dead' : 'failed',
          attempts: attempt,
          lastError: `${error.message}\n${error.stack ?? ''}`.slice(0, 4000),
          runAt: exhausted ? new Date() : new Date(Date.now() + backoffMs(attempt)),
          updatedAt: new Date(),
        })
        .where(eq(job.id, row.id));

      if (exhausted) result.dead += 1;
      else result.failed += 1;
      options.onError?.(error, row.kind);
    }
  }

  return result;
}

/**
 * Jobs that have exhausted their retries.
 *
 * Exposed as a query because a dead-letter queue nobody can see is the same as no
 * dead-letter queue. `/admin/jobs` renders this, and the count is what a human checks.
 */
export async function deadJobs(database: KeelDatabase = db(), limit = 50) {
  return database
    .select()
    .from(job)
    .where(eq(job.status, 'dead'))
    .orderBy(asc(job.updatedAt))
    .limit(limit);
}

/** Jobs waiting or retrying, for the same visibility reason. */
export async function pendingJobs(database: KeelDatabase = db(), limit = 50) {
  return database
    .select()
    .from(job)
    .where(and(eq(job.status, 'pending'), lte(job.runAt, new Date())))
    .orderBy(asc(job.runAt))
    .limit(limit);
}

/** Put a dead job back in the queue after the cause is fixed. */
export async function retryDeadJob(id: string, database: KeelDatabase = db()): Promise<boolean> {
  const rows = await database
    .update(job)
    .set({ status: 'pending', attempts: 0, runAt: new Date(), lastError: null })
    .where(and(eq(job.id, id), eq(job.status, 'dead')))
    .returning({ id: job.id });
  return rows.length > 0;
}
