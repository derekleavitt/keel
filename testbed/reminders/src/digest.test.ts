import type { Scope } from '@keel/contracts/ids';
import { createTestDatabase, seedScope } from '@keel/db/testing';
import { captureEmail } from '@keel/email/testing';
import { runJobs } from '@keel/jobs';
import { createList } from '@keel/testbed-lists';
import { createTodo } from '@keel/testbed-todos';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { reminderHandlers, scheduleDigest } from './digest.ts';

/**
 * The digest, end to end: schedule, fan out, send.
 *
 * Nothing here mocks the queue — jobs really are enqueued, claimed and run against real
 * Postgres. Only the email transport is swapped, which is the one thing that would
 * otherwise reach the outside world.
 */
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let alice: Scope;
let sent: ReturnType<typeof captureEmail>;

const TODAY = '2026-06-15';
const yesterday = '2026-06-14';

beforeEach(async () => {
  database = await createTestDatabase();
  alice = (await seedScope(database, { id: 'alice', email: 'alice@example.test', name: 'Alice' }))
    .scope;
  sent = captureEmail();
});

afterEach(async () => {
  await database.close();
});

/** Run the fan-out, then the per-user sends it produced. */
async function drain() {
  await runJobs(reminderHandlers, { database });
  return runJobs(reminderHandlers, { database });
}

describe('the daily digest', () => {
  it('sends one email listing what is overdue and due today', async () => {
    const list = await createList(alice, { name: 'Work' }, database);
    await createTodo(alice, { listId: list.id, title: 'Late thing', dueDate: yesterday }, database);
    await createTodo(alice, { listId: list.id, title: 'Today thing', dueDate: TODAY }, database);

    await scheduleDigest(TODAY, 'UTC', database);
    await drain();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('alice@example.test');
    expect(sent[0]?.subject).toBe('1 overdue, 1 due today');
    expect(sent[0]?.text).toContain('Late thing');
    expect(sent[0]?.text).toContain('Today thing');
    expect(sent[0]?.text).toContain('Work');
  });

  it('sends nothing when there is nothing due', async () => {
    const list = await createList(alice, { name: 'Work' }, database);
    await createTodo(alice, { listId: list.id, title: 'Someday' }, database);

    await scheduleDigest(TODAY, 'UTC', database);
    await drain();

    // A daily "you have no tasks" email is how a useful reminder becomes something people
    // filter to trash — and once filtered, the useful ones go too.
    expect(sent).toEqual([]);
  });

  it('does not send twice for the same day', async () => {
    const list = await createList(alice, { name: 'Work' }, database);
    await createTodo(alice, { listId: list.id, title: 'Thing', dueDate: TODAY }, database);

    await scheduleDigest(TODAY, 'UTC', database);
    await scheduleDigest(TODAY, 'UTC', database);
    await drain();
    await drain();

    expect(sent).toHaveLength(1);
  });

  it('sends again the next day', async () => {
    const list = await createList(alice, { name: 'Work' }, database);
    await createTodo(alice, { listId: list.id, title: 'Thing', dueDate: TODAY }, database);

    await scheduleDigest(TODAY, 'UTC', database);
    await drain();
    await scheduleDigest('2026-06-16', 'UTC', database);
    await drain();

    expect(sent).toHaveLength(2);
  });

  it('never mixes one person’s todos into another’s digest', async () => {
    const bob = (await seedScope(database, { id: 'bob', email: 'bob@example.test', name: 'Bob' }))
      .scope;

    const aliceList = await createList(alice, { name: 'Alice work' }, database);
    await createTodo(alice, { listId: aliceList.id, title: 'Alice task' }, database);
    await createTodo(alice, { listId: aliceList.id, title: 'Alice due', dueDate: TODAY }, database);

    const bobList = await createList(bob, { name: 'Bob work' }, database);
    await createTodo(bob, { listId: bobList.id, title: 'Bob due', dueDate: TODAY }, database);

    await scheduleDigest(TODAY, 'UTC', database);
    await drain();

    expect(sent).toHaveLength(2);
    const toAlice = sent.find((email) => email.to === 'alice@example.test');
    const toBob = sent.find((email) => email.to === 'bob@example.test');

    expect(toAlice?.text).toContain('Alice due');
    expect(toAlice?.text).not.toContain('Bob due');
    expect(toBob?.text).toContain('Bob due');
    expect(toBob?.text).not.toContain('Alice due');
  });

  it('one person’s failure does not stop everyone else’s mail', async () => {
    const bob = (await seedScope(database, { id: 'bob', email: 'bob@example.test', name: 'Bob' }))
      .scope;
    const aliceList = await createList(alice, { name: 'A' }, database);
    await createTodo(alice, { listId: aliceList.id, title: 'A due', dueDate: TODAY }, database);
    const bobList = await createList(bob, { name: 'B' }, database);
    await createTodo(bob, { listId: bobList.id, title: 'B due', dueDate: TODAY }, database);

    await scheduleDigest(TODAY, 'UTC', database);
    await runJobs(reminderHandlers, { database });

    // Fail exactly one recipient. This is why the digest fans out per user rather than
    // looping inside a single job: a failure is isolated, and its retry reaches only the
    // person it affected instead of re-sending to everyone already reached.
    const failing = [
      reminderHandlers[0]!,
      {
        ...reminderHandlers[1]!,
        handle: async (
          payload: { userId: string },
          context: { database: typeof database; attempt: number },
        ) => {
          if (payload.userId === 'alice') throw new Error('provider rejected');
          return reminderHandlers[1]!.handle(payload, context);
        },
      },
    ];
    const result = await runJobs(failing as typeof reminderHandlers, { database });

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(1);
    expect(sent.map((email) => email.to)).toEqual(['bob@example.test']);
  });
});
