import { audit } from '@keel/audit';
import type { Scope } from '@keel/contracts/ids';
import { db, type KeelDatabase } from '@keel/db';
import { list, recurrenceRule, todo } from '@keel/db/schema';
import { enqueue, type JobHandler } from '@keel/jobs';
import {
  addDays,
  expandOccurrences,
  type RecurrenceRule,
  todayIn,
  validateRule,
} from '@keel/scheduling';
import { editableVia, positionBetween } from '@keel/testbed-lists';
import { emit } from '@keel/webhooks';
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';

/**
 * Recurring todos.
 *
 * ## Series and instance are different things, deliberately
 *
 * A rule is a template. The todos it produces are **ordinary todos** that happen to point
 * back at it — which is why sharing, filtering, tagging, search, the API and webhooks all
 * work on them with no changes at all.
 *
 * That gives an unambiguous answer to the question every recurring-task feature gets wrong:
 *
 * | You edit… | What changes |
 * |---|---|
 * | a generated todo | that occurrence only — it is just a todo |
 * | the rule | future occurrences only; everything already generated is untouched |
 * | delete a generated todo | that occurrence, permanently — it is never regenerated |
 * | delete the rule | no more occurrences; every todo it already made stays |
 *
 * No "edit this or all future events?" dialog, because the two operations are on two
 * different objects and the user has already chosen which one by what they clicked.
 */

export const GENERATE_JOB = 'recurrence.generate';

/** How far ahead occurrences are materialised. */
export const HORIZON_DAYS = 60;

export interface CreateRuleInput {
  listId: string;
  title: string;
  notes?: string | null;
  priority?: 'none' | 'low' | 'medium' | 'high';
  frequency: 'daily' | 'weekly' | 'monthly';
  interval: number;
  byWeekday?: number[] | null;
  startDate: string;
  until?: string | null;
  timeZone: string;
}

const asRule = (row: {
  frequency: 'daily' | 'weekly' | 'monthly';
  interval: number;
  byWeekday: number[] | null;
  startDate: string;
  until: string | null;
  timeZone: string;
}): RecurrenceRule => ({
  frequency: row.frequency,
  interval: row.interval,
  byWeekday: row.byWeekday ?? undefined,
  startDate: row.startDate,
  until: row.until,
  timeZone: row.timeZone,
});

/** Create a series. Requires edit rights on the target list, like any other write to it. */
export async function createRule(
  scope: Scope,
  input: CreateRuleInput,
  database: KeelDatabase = db(),
) {
  const problem = validateRule({
    frequency: input.frequency,
    interval: input.interval,
    byWeekday: input.byWeekday ?? undefined,
    startDate: input.startDate,
    until: input.until,
    timeZone: input.timeZone,
  });
  if (problem) return { ok: false as const, error: problem };

  const [allowed] = await database
    .select({ id: list.id })
    .from(list)
    .where(and(eq(list.id, input.listId), editableVia(list.id, scope)))
    .limit(1);
  if (!allowed) return { ok: false as const, error: 'List not found' };

  const [row] = await database
    .insert(recurrenceRule)
    .values({
      id: `rec_${crypto.randomUUID()}`,
      organizationId: scope.organizationId,
      listId: input.listId,
      userId: scope.userId,
      title: input.title,
      notes: input.notes ?? null,
      priority: input.priority ?? 'none',
      frequency: input.frequency,
      interval: input.interval,
      byWeekday: input.byWeekday ?? null,
      startDate: input.startDate,
      until: input.until ?? null,
      timeZone: input.timeZone,
    })
    .returning();
  if (!row) throw new Error('createRule inserted no row');

  await audit(
    scope,
    {
      action: 'recurrence.created',
      targetType: 'recurrence_rule',
      targetId: row.id,
      summary: `set “${row.title}” to repeat ${row.frequency}`,
      detail: { interval: row.interval, startDate: row.startDate },
    },
    database,
  );

  // Materialise immediately so the user sees the series exist rather than waiting for a
  // worker pass to convince them it worked.
  const created = await generateForRule(row.id, {}, database);
  return { ok: true as const, id: row.id, generated: created };
}

export async function listRules(scope: Scope, listId: string, database: KeelDatabase = db()) {
  return database
    .select({
      id: recurrenceRule.id,
      title: recurrenceRule.title,
      frequency: recurrenceRule.frequency,
      interval: recurrenceRule.interval,
      byWeekday: recurrenceRule.byWeekday,
      startDate: recurrenceRule.startDate,
      until: recurrenceRule.until,
      timeZone: recurrenceRule.timeZone,
      pausedAt: recurrenceRule.pausedAt,
    })
    .from(recurrenceRule)
    .innerJoin(list, eq(list.id, recurrenceRule.listId))
    .where(and(eq(recurrenceRule.listId, listId), editableVia(list.id, scope)));
}

/**
 * Change a series. **Future occurrences only.**
 *
 * Already-generated todos are left alone even when the title changes, because they may
 * have been edited, completed, tagged or shared. Rewriting them would silently discard
 * work; leaving them is the conservative half of an ambiguous choice.
 */
export async function updateRule(
  scope: Scope,
  id: string,
  patch: Partial<Pick<CreateRuleInput, 'title' | 'notes' | 'priority' | 'until'>>,
  database: KeelDatabase = db(),
) {
  const [row] = await database
    .update(recurrenceRule)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(recurrenceRule.id, id), eq(recurrenceRule.organizationId, scope.organizationId)))
    .returning();
  if (!row) return null;

  await audit(
    scope,
    {
      action: 'recurrence.updated',
      targetType: 'recurrence_rule',
      targetId: row.id,
      summary: `changed the repeating todo “${row.title}”`,
      detail: patch,
    },
    database,
  );
  return row;
}

/** Stop generating without losing the rule, so it can be resumed with its history intact. */
export async function pauseRule(
  scope: Scope,
  id: string,
  paused: boolean,
  database: KeelDatabase = db(),
): Promise<boolean> {
  const rows = await database
    .update(recurrenceRule)
    .set({ pausedAt: paused ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(recurrenceRule.id, id), eq(recurrenceRule.organizationId, scope.organizationId)))
    .returning({ id: recurrenceRule.id });
  return rows.length > 0;
}

/**
 * Delete a series. **Generated todos survive.**
 *
 * They are real work somebody may have already done — some are completed, some carry notes
 * and tags. Cascading would delete a month of finished tasks because the user stopped a
 * reminder, which nobody means by "stop repeating this".
 */
export async function deleteRule(
  scope: Scope,
  id: string,
  database: KeelDatabase = db(),
): Promise<boolean> {
  return database.transaction(async (tx) => {
    const rows = await tx
      .delete(recurrenceRule)
      .where(
        and(eq(recurrenceRule.id, id), eq(recurrenceRule.organizationId, scope.organizationId)),
      )
      .returning({ id: recurrenceRule.id });
    if (rows.length === 0) return false;

    // The column has no foreign key, so the orphaned todos are detached explicitly.
    await tx
      .update(todo)
      .set({ recurrenceRuleId: null, occurrenceDate: null })
      .where(eq(todo.recurrenceRuleId, id));

    await audit(
      scope,
      {
        action: 'recurrence.deleted',
        targetType: 'recurrence_rule',
        targetId: id,
        summary: 'stopped a repeating todo',
      },
      tx,
    );
    return true;
  });
}

/**
 * Materialise a rule's occurrences up to the horizon.
 *
 * Idempotent by construction: the insert is `on conflict do nothing` against the unique
 * index on `(recurrence_rule_id, occurrence_date)`. Running this twice, or from three
 * workers at once, cannot produce a duplicate — and unlike an application-level "have I
 * done this already" check, that holds under concurrency, because the guarantee is the
 * database's rather than a read-then-write race.
 */
export async function generateForRule(
  ruleId: string,
  options: { asOf?: Date; horizonDays?: number } = {},
  database: KeelDatabase = db(),
): Promise<number> {
  const [row] = await database
    .select()
    .from(recurrenceRule)
    .where(eq(recurrenceRule.id, ruleId))
    .limit(1);
  if (!row || row.pausedAt) return 0;

  // "Today" in the *series'* zone, never the server's. See @keel/scheduling.
  const today = todayIn(row.timeZone, options.asOf ?? new Date());
  const through = addDays(today, options.horizonDays ?? HORIZON_DAYS);

  /*
   * Resume the day after the last generated date, not from the start of the series.
   *
   * This is what makes deletion stick: an occurrence the user threw away is never
   * revisited, so it cannot be helpfully recreated by the next sweep.
   */
  const from = row.generatedThrough ? addDays(row.generatedThrough, 1) : row.startDate;
  const dates = expandOccurrences(asRule(row), { from, to: through });

  if (dates.length === 0) {
    await database
      .update(recurrenceRule)
      .set({ generatedThrough: through })
      .where(eq(recurrenceRule.id, row.id));
    return 0;
  }

  const [tail] = await database
    .select({ position: sql<number>`coalesce(max(${todo.position}), 0)` })
    .from(todo)
    .where(eq(todo.listId, row.listId));
  let position = tail?.position ?? 0;

  const inserted = await database
    .insert(todo)
    .values(
      dates.map((date) => {
        position = positionBetween(position, null);
        return {
          id: `tdo_${crypto.randomUUID()}`,
          userId: row.userId,
          listId: row.listId,
          title: row.title,
          notes: row.notes,
          dueDate: date,
          priority: row.priority,
          position,
          recurrenceRuleId: row.id,
          occurrenceDate: date,
        };
      }),
    )
    .onConflictDoNothing()
    .returning({ id: todo.id, dueDate: todo.dueDate, title: todo.title });

  await database
    .update(recurrenceRule)
    .set({ generatedThrough: through })
    .where(eq(recurrenceRule.id, row.id));

  const scope: Scope = { userId: row.userId, organizationId: row.organizationId } as Scope;
  for (const created of inserted) {
    await emit(
      scope,
      'todo.created',
      { id: created.id, listId: row.listId, title: created.title, recurring: true },
      database,
    );
  }

  return inserted.length;
}

/**
 * Sweep every rule that has not been generated through the horizon.
 *
 * Selecting on `generated_through` rather than scanning everything means a steady state
 * costs one indexed query, not one per series.
 */
export async function generateDueRules(
  options: { asOf?: Date; limit?: number } = {},
  database: KeelDatabase = db(),
): Promise<{ rules: number; todos: number }> {
  const asOf = options.asOf ?? new Date();
  // A generous bound in UTC: each rule re-checks the horizon in its own zone, so this only
  // has to be wide enough not to miss one, never exact.
  const cutoff = addDays(todayIn('UTC', asOf), HORIZON_DAYS);

  const due = await database
    .select({ id: recurrenceRule.id })
    .from(recurrenceRule)
    .where(
      and(
        isNull(recurrenceRule.pausedAt),
        or(isNull(recurrenceRule.generatedThrough), lte(recurrenceRule.generatedThrough, cutoff)),
      ),
    )
    .limit(options.limit ?? 200);

  let todos = 0;
  for (const rule of due) {
    todos += await generateForRule(rule.id, { asOf }, database);
  }
  return { rules: due.length, todos };
}

export const generateHandler: JobHandler<{ asOf?: string }> = {
  kind: GENERATE_JOB,
  async handle(payload, { database }) {
    await generateDueRules({ asOf: payload.asOf ? new Date(payload.asOf) : undefined }, database);
  },
};

export const recurrenceHandlers = [generateHandler];

/** Schedule a sweep. The unique key makes calling this on every worker pass free. */
export function scheduleGeneration(day: string, database: KeelDatabase = db()) {
  return enqueue(GENERATE_JOB, {}, { uniqueKey: `recurrence-generate:${day}` }, database);
}
