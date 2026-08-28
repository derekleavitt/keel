import { job } from '@keel/db/schema';
import { createTestDatabase } from '@keel/db/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backoffMs, deadJobs, enqueue, type JobHandler, retryDeadJob, runJobs } from './queue.ts';

/**
 * Queue behaviour, against real Postgres.
 *
 * The interesting cases are all failure cases: a queue that runs happy-path jobs is easy,
 * and every property worth having is about what happens when a handler throws.
 */
let database: Awaited<ReturnType<typeof createTestDatabase>>;

beforeEach(async () => {
  database = await createTestDatabase();
});

afterEach(async () => {
  await database.close();
});

const ok = (kind: string, seen: unknown[]): JobHandler => ({
  kind,
  handle: async (payload) => {
    seen.push(payload);
  },
});

const always = (kind: string, message: string, maxAttempts?: number): JobHandler => ({
  kind,
  maxAttempts,
  handle: async () => {
    throw new Error(message);
  },
});

describe('running jobs', () => {
  it('runs a job and removes it', async () => {
    const seen: unknown[] = [];
    await enqueue('greet', { name: 'Ada' }, {}, database);

    const result = await runJobs([ok('greet', seen)], { database });

    expect(result.processed).toBe(1);
    expect(seen).toEqual([{ name: 'Ada' }]);
    expect(await database.select().from(job)).toHaveLength(0);
  });

  it('does not run a job scheduled for the future', async () => {
    const seen: unknown[] = [];
    await enqueue('greet', {}, { runAt: new Date(Date.now() + 60_000) }, database);

    expect((await runJobs([ok('greet', seen)], { database })).processed).toBe(0);
    expect(seen).toEqual([]);
  });

  it('keeps going after one job fails', async () => {
    const seen: unknown[] = [];
    await enqueue('boom', {}, {}, database);
    await enqueue('greet', { name: 'Ada' }, {}, database);

    const result = await runJobs([always('boom', 'nope'), ok('greet', seen)], { database });

    // A poisonous job must not stop everything behind it.
    expect(result.processed).toBe(1);
    expect(result.failed).toBe(1);
    expect(seen).toEqual([{ name: 'Ada' }]);
  });
});

describe('retries and the dead letter', () => {
  it('backs off exponentially, with a ceiling', () => {
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(2)).toBe(120_000);
    expect(backoffMs(3)).toBe(240_000);
    // Without a ceiling, attempt 20 would schedule the retry decades away.
    expect(backoffMs(20)).toBe(30 * 60_000);
  });

  it('schedules a retry in the future rather than spinning', async () => {
    await enqueue('boom', {}, {}, database);
    const before = Date.now();
    await runJobs([always('boom', 'nope')], { database });

    const [row] = await database.select().from(job);
    expect(row?.status).toBe('failed');
    expect(row?.attempts).toBe(1);
    expect(row?.runAt.getTime()).toBeGreaterThan(before);
    expect(row?.lastError).toContain('nope');
  });

  it('dead-letters after the attempt budget, instead of retrying forever', async () => {
    await enqueue('boom', {}, { maxAttempts: 2 }, database);

    // Each pass claims it once; runAt is pushed forward, so wind it back to retry now.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await runJobs([always('boom', 'nope', 2)], { database });
      await database.update(job).set({ runAt: new Date() });
    }

    const dead = await deadJobs(database);
    expect(dead).toHaveLength(1);
    expect(dead[0]?.attempts).toBe(2);
    // A queue that silently retries a permanently broken job looks healthy while doing
    // nothing. It has to stop and become visible.
    expect(dead[0]?.status).toBe('dead');
  });

  it('dead-letters an unknown kind rather than blocking the queue', async () => {
    await enqueue('kind-from-a-newer-deploy', {}, {}, database);

    const result = await runJobs([], { database });
    expect(result.dead).toBe(1);
    expect((await deadJobs(database))[0]?.lastError).toContain('No handler registered');
  });

  it('can be retried by hand once the cause is fixed', async () => {
    const seen: unknown[] = [];
    await enqueue('boom', { id: 1 }, { maxAttempts: 1 }, database);
    await runJobs([always('boom', 'nope', 1)], { database });

    const [dead] = await deadJobs(database);
    if (!dead) throw new Error('expected a dead job');
    expect(await retryDeadJob(dead.id, database)).toBe(true);

    // The handler is fixed this time.
    expect((await runJobs([ok('boom', seen)], { database })).processed).toBe(1);
    expect(seen).toEqual([{ id: 1 }]);
  });

  it('refuses to retry a job that is not dead', async () => {
    await enqueue('greet', {}, {}, database);
    const [row] = await database.select().from(job);
    expect(await retryDeadJob(row?.id ?? '', database)).toBe(false);
  });
});

describe('idempotency', () => {
  it('enqueuing the same key twice is a no-op', async () => {
    expect(
      (await enqueue('digest', { day: 1 }, { uniqueKey: 'digest-1' }, database)).enqueued,
    ).toBe(true);
    expect(
      (await enqueue('digest', { day: 1 }, { uniqueKey: 'digest-1' }, database)).enqueued,
    ).toBe(false);
    expect(await database.select().from(job)).toHaveLength(1);
  });

  it('different keys enqueue separately', async () => {
    await enqueue('digest', {}, { uniqueKey: 'digest-1' }, database);
    await enqueue('digest', {}, { uniqueKey: 'digest-2' }, database);
    expect(await database.select().from(job)).toHaveLength(2);
  });

  it('the key frees up once the job has run', async () => {
    const seen: unknown[] = [];
    await enqueue('digest', { day: 1 }, { uniqueKey: 'digest-1' }, database);
    await runJobs([ok('digest', seen)], { database });

    // Tomorrow's digest reuses the pattern; yesterday's must not block it forever.
    expect(
      (await enqueue('digest', { day: 2 }, { uniqueKey: 'digest-1' }, database)).enqueued,
    ).toBe(true);
  });
});

describe('transactional enqueue', () => {
  it('a job rolled back with its transaction never exists', async () => {
    await expect(
      database.transaction(async (tx) => {
        await enqueue('greet', {}, {}, tx);
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');

    // "Saved the row but lost the email" is the classic background-work bug. Enqueuing in
    // the same transaction as the write designs it out.
    expect(await database.select().from(job)).toHaveLength(0);
  });
});
