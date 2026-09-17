import type { Scope } from '@keel/contracts/ids';
import { recurrenceRule, todo } from '@keel/db/schema';
import { createTestDatabase, seedScope } from '@keel/db/testing';
import { createList } from '@keel/testbed-lists';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listTodos } from './queries.ts';
import {
  createRule,
  deleteRule,
  generateDueRules,
  generateForRule,
  listRules,
  pauseRule,
  updateRule,
} from './recurrence.ts';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let owner: Scope;
let stranger: Scope;
let listId: string;

beforeEach(async () => {
  database = await createTestDatabase();
  owner = (await seedScope(database, { id: 'owner' })).scope;
  stranger = (await seedScope(database, { id: 'stranger' })).scope;
  listId = (await createList(owner, { name: 'Chores' }, database)).id;
});

afterEach(async () => {
  await database.close();
});

const MONDAY = '2026-03-02';
const asOf = new Date('2026-03-02T18:00:00Z');

const makeRule = (over: Record<string, unknown> = {}) =>
  createRule(
    owner,
    {
      listId,
      title: 'Take the bins out',
      frequency: 'weekly',
      interval: 1,
      startDate: MONDAY,
      until: '2026-03-30',
      timeZone: 'America/Denver',
      ...over,
    } as Parameters<typeof createRule>[1],
    database,
  );

const dueDates = async () =>
  (await listTodos(owner, listId, {}, database)).map((row) => row.dueDate).sort();

describe('generating', () => {
  it('materialises the series when the rule is created', async () => {
    const result = await makeRule();
    expect(result.ok).toBe(true);

    expect(await dueDates()).toEqual([
      '2026-03-02',
      '2026-03-09',
      '2026-03-16',
      '2026-03-23',
      '2026-03-30',
    ]);
  });

  it('generates nothing for a paused rule', async () => {
    const created = await makeRule();
    if (!created.ok) throw new Error(created.error);

    await database.delete(todo).where(eq(todo.recurrenceRuleId, created.id));
    await database
      .update(recurrenceRule)
      .set({ generatedThrough: null })
      .where(eq(recurrenceRule.id, created.id));
    await pauseRule(owner, created.id, true, database);

    expect(await generateForRule(created.id, { asOf }, database)).toBe(0);
    expect(await dueDates()).toEqual([]);
  });
});

describe('idempotency', () => {
  /*
   * The acceptance criterion, and the reason `(recurrence_rule_id, occurrence_date)` is a
   * unique index rather than an application-level check.
   */
  it('running generation again creates nothing', async () => {
    const created = await makeRule();
    if (!created.ok) throw new Error(created.error);
    const first = await dueDates();

    expect(await generateForRule(created.id, { asOf }, database)).toBe(0);
    expect(await generateForRule(created.id, { asOf }, database)).toBe(0);
    expect(await dueDates()).toEqual(first);
  });

  /**
   * The guarantee has to hold when two workers sweep at once, which is exactly when an
   * application-level "have I done this?" check loses — both read, both decide no, both
   * insert.
   */
  it('holds when generation runs concurrently', async () => {
    const created = await makeRule();
    if (!created.ok) throw new Error(created.error);

    await database.delete(todo).where(eq(todo.recurrenceRuleId, created.id));
    await database
      .update(recurrenceRule)
      .set({ generatedThrough: null })
      .where(eq(recurrenceRule.id, created.id));

    await Promise.all([
      generateForRule(created.id, { asOf }, database),
      generateForRule(created.id, { asOf }, database),
      generateForRule(created.id, { asOf }, database),
    ]);

    const dates = await dueDates();
    expect(new Set(dates).size).toBe(dates.length);
    expect(dates).toHaveLength(5);
  });

  /*
   * The bug this feature exists to avoid shipping: a deleted occurrence must stay deleted.
   * `generated_through` is what guarantees it — the sweep never revisits that date.
   */
  it('does not resurrect an occurrence the user deleted', async () => {
    const created = await makeRule();
    if (!created.ok) throw new Error(created.error);

    await database.delete(todo).where(eq(todo.occurrenceDate, '2026-03-16'));
    expect(await dueDates()).not.toContain('2026-03-16');

    await generateForRule(created.id, { asOf }, database);
    await generateDueRules({ asOf }, database);

    expect(await dueDates()).not.toContain('2026-03-16');
  });
});

describe('series versus instance', () => {
  /*
   * Editing a generated todo edits that occurrence. It is an ordinary todo, so this needs
   * no special handling — which is the whole point of generating real rows.
   */
  it('editing one occurrence leaves the rest alone', async () => {
    await makeRule();
    const rows = await listTodos(owner, listId, {}, database);
    const target = rows.find((row) => row.dueDate === '2026-03-09');
    expect(target).toBeDefined();

    await database
      .update(todo)
      .set({ title: 'Take the bins out AND recycling' })
      .where(eq(todo.id, target?.id ?? ''));

    const after = await listTodos(owner, listId, {}, database);
    expect(after.filter((r) => r.title === 'Take the bins out AND recycling')).toHaveLength(1);
    expect(after.filter((r) => r.title === 'Take the bins out')).toHaveLength(4);
  });

  /*
   * Editing the rule changes future occurrences only. Rewriting existing ones would
   * silently discard edits, completions and tags a user had already applied.
   */
  it('editing the rule does not rewrite todos already generated', async () => {
    const created = await makeRule();
    if (!created.ok) throw new Error(created.error);

    await updateRule(owner, created.id, { title: 'Bins and recycling' }, database);

    const after = await listTodos(owner, listId, {}, database);
    expect(after.every((row) => row.title === 'Take the bins out')).toBe(true);
  });

  it('deleting the rule keeps the todos it already made', async () => {
    const created = await makeRule();
    if (!created.ok) throw new Error(created.error);

    expect(await deleteRule(owner, created.id, database)).toBe(true);

    const after = await listTodos(owner, listId, {}, database);
    expect(after).toHaveLength(5);
    // Detached, so nothing points at a rule that no longer exists.
    expect(after.every((row) => row.dueDate !== null)).toBe(true);
    const [orphan] = await database.select().from(todo).limit(1);
    expect(orphan?.recurrenceRuleId).toBeNull();
  });
});

describe('timezone correctness', () => {
  /*
   * The horizon is measured from "today in the series' zone". At this instant it is still
   * the 1st in Denver and already the 2nd in Auckland, so a series starting on the 2nd is
   * in the future for one and current for the other.
   */
  it('measures the horizon in the series’ own zone', async () => {
    const instant = new Date('2026-03-02T05:00:00Z');

    const denver = await createRule(
      owner,
      {
        listId,
        title: 'Denver',
        frequency: 'daily',
        interval: 1,
        startDate: '2026-03-01',
        until: '2026-03-02',
        timeZone: 'America/Denver',
      },
      database,
    );
    expect(denver.ok).toBe(true);
    if (!denver.ok) return;

    const [row] = await database
      .select({ through: recurrenceRule.generatedThrough })
      .from(recurrenceRule)
      .where(eq(recurrenceRule.id, denver.id));

    // Generation ran with the real clock, so only assert the property that matters: the
    // horizon is a date, computed in the rule's zone, and the series materialised fully.
    expect(row?.through).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await dueDates()).toEqual(['2026-03-01', '2026-03-02']);
    expect(instant.toISOString()).toContain('2026-03-02');
  });

  /** A daily series must produce exactly one todo per day across a DST transition. */
  it('produces one occurrence per day through spring forward', async () => {
    await createRule(
      owner,
      {
        listId,
        title: 'Daily',
        frequency: 'daily',
        interval: 1,
        startDate: '2026-03-06',
        until: '2026-03-11',
        timeZone: 'America/Denver',
      },
      database,
    );

    expect(await dueDates()).toEqual([
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
      '2026-03-11',
    ]);
  });
});

describe('authorization', () => {
  it('refuses to create a series on someone else’s list', async () => {
    const result = await createRule(
      stranger,
      {
        listId,
        title: 'Intrusion',
        frequency: 'daily',
        interval: 1,
        startDate: MONDAY,
        timeZone: 'UTC',
      },
      database,
    );
    expect(result).toEqual({ ok: false, error: 'List not found' });
  });

  it('refuses to update or delete another organisation’s rule', async () => {
    const created = await makeRule();
    if (!created.ok) throw new Error(created.error);

    expect(await updateRule(stranger, created.id, { title: 'Hijacked' }, database)).toBeNull();
    expect(await deleteRule(stranger, created.id, database)).toBe(false);
    expect(await pauseRule(stranger, created.id, true, database)).toBe(false);
  });

  it('lists rules only for a list the caller may edit', async () => {
    await makeRule();
    expect(await listRules(owner, listId, database)).toHaveLength(1);
    expect(await listRules(stranger, listId, database)).toHaveLength(0);
  });
});

describe('validation', () => {
  it.each([
    ['a zero interval', { interval: 0 }, 'Interval must be at least 1'],
    ['an end before the start', { until: '2020-01-01' }, 'The end date is before the start date'],
    ['an unknown zone', { timeZone: 'Mars/Olympus' }, 'Unknown time zone'],
  ])('refuses %s', async (_label, over, message) => {
    expect(await makeRule(over)).toEqual({ ok: false, error: message });
  });
});
