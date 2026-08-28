import type { OrganizationId, Scope, UserId } from '@keel/contracts/ids';
import { db, type KeelDatabase } from '@keel/db';
import { membership, user } from '@keel/db/schema';
import { sendEmail } from '@keel/email';
import { enqueue, type JobHandler } from '@keel/jobs';
import { buildAgenda } from '@keel/testbed-views';
import { eq } from 'drizzle-orm';

/**
 * The daily digest: one email per person, listing what is overdue or due today.
 *
 * Two jobs rather than one, deliberately. A single job that looped over every user would
 * be one failure away from nobody getting mail, and its retry would re-send to everyone it
 * had already reached. Instead a **fan-out** job enqueues one **per-user** job each, so a
 * failure is isolated to the person it affects and retries only reach them.
 */
export const DIGEST_FANOUT = 'digest.fanout';
export const DIGEST_SEND = 'digest.send';

export interface DigestSendPayload {
  userId: string;
  organizationId: string;
  /** The calendar day this digest is for. Part of the idempotency key. */
  day: string;
  timeZone: string;
}

/**
 * Enqueue a digest for everyone with a membership.
 *
 * The unique key is `digest:<user>:<org>:<day>`, so running the fan-out twice on the same
 * day — a retry, an overlapping schedule, an operator being careful — produces no second
 * email. That is the property that makes a daily job safe to trigger by hand.
 */
export const digestFanoutHandler: JobHandler<{ day: string; timeZone?: string }> = {
  kind: DIGEST_FANOUT,
  handle: async (payload, { database }) => {
    const timeZone = payload.timeZone ?? 'UTC';
    const rows = await database
      .select({ userId: membership.userId, organizationId: membership.organizationId })
      .from(membership);

    for (const row of rows) {
      await enqueue(
        DIGEST_SEND,
        {
          userId: row.userId,
          organizationId: row.organizationId,
          day: payload.day,
          timeZone,
        } satisfies DigestSendPayload,
        { uniqueKey: `digest:${row.userId}:${row.organizationId}:${payload.day}` },
        database,
      );
    }
  },
};

/**
 * Send one person's digest.
 *
 * Sends nothing when there is nothing due. A daily email that says "you have no tasks" is
 * how a useful reminder becomes something people filter to trash, and once filtered the
 * useful ones go too.
 */
export const digestSendHandler: JobHandler<DigestSendPayload> = {
  kind: DIGEST_SEND,
  handle: async (payload, { database }) => {
    const scope: Scope = {
      userId: payload.userId as UserId,
      organizationId: payload.organizationId as OrganizationId,
    };

    // The digest is *for* payload.day, so that day is "today" — not whenever this job
    // happens to run. Without this a retry the following morning reports every item as
    // overdue.
    const agenda = await buildAgenda(scope, payload.timeZone, database, payload.day);
    if (agenda.empty) return;

    const [recipient] = await database
      .select({ email: user.email, name: user.name })
      .from(user)
      .where(eq(user.id, payload.userId))
      .limit(1);
    if (!recipient) return;

    const lines: string[] = [];
    if (agenda.overdue.length > 0) {
      lines.push(`Overdue (${agenda.overdue.length}):`);
      for (const entry of agenda.overdue) {
        lines.push(`  · ${entry.title} — ${entry.listName}, due ${entry.dueDate}`);
      }
      lines.push('');
    }
    if (agenda.dueToday.length > 0) {
      lines.push(`Due today (${agenda.dueToday.length}):`);
      for (const entry of agenda.dueToday) {
        lines.push(`  · ${entry.title} — ${entry.listName}`);
      }
    }

    const total = agenda.overdue.length + agenda.dueToday.length;
    await sendEmail({
      to: recipient.email,
      subject:
        agenda.overdue.length > 0
          ? `${agenda.overdue.length} overdue, ${agenda.dueToday.length} due today`
          : `${total} due today`,
      text: [`Morning${recipient.name ? `, ${recipient.name}` : ''}.`, '', ...lines].join('\n'),
    });
  },
};

export const reminderHandlers = [digestFanoutHandler, digestSendHandler];

/** Schedule today's digest. Safe to call repeatedly — the fan-out key is per day. */
export async function scheduleDigest(day: string, timeZone = 'UTC', database: KeelDatabase = db()) {
  return enqueue(DIGEST_FANOUT, { day, timeZone }, { uniqueKey: `digest-fanout:${day}` }, database);
}
