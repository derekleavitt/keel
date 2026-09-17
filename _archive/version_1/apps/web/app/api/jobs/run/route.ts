import { serverEnv } from '@keel/contracts/env';
import { runJobs } from '@keel/jobs';
import { reminderHandlers } from '@keel/testbed-reminders';
import { recurrenceHandlers, scheduleGeneration } from '@keel/testbed-todos';
import { webhookHandlers } from '@keel/webhooks/handlers';

export const dynamic = 'force-dynamic';

/**
 * The worker.
 *
 * A route rather than a long-running process, so the same deployment serves requests and
 * drains the queue — no second thing to deploy, scale or forget to restart. A platform
 * scheduler (Vercel Cron, a Kubernetes CronJob, anything that can make an HTTP request)
 * calls it on a timer.
 *
 * The trade is that a job cannot run longer than the platform's request timeout. Anything
 * that long should be split into smaller jobs anyway, which the queue makes cheap.
 *
 * **Authenticated by a shared secret, not a session.** A scheduler has no user, and an
 * unauthenticated endpoint that drains a queue is a way for anyone to exhaust the retry
 * budget on every job you have.
 */
export async function POST(request: Request): Promise<Response> {
  const expected = serverEnv().JOBS_SECRET;
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

  if (!expected || provided !== expected) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // One registry for the whole app. A job whose kind is not registered here is
  // dead-lettered rather than retried, so adding a handler package means adding it here.
  /*
   * Schedule the day's recurrence sweep before draining.
   *
   * The unique key makes this free to call on every pass — a second enqueue for the same
   * day is a no-op — so the worker needs no separate schedule and no cron entry of its own.
   */
  await scheduleGeneration(new Date().toISOString().slice(0, 10));

  const result = await runJobs([...reminderHandlers, ...webhookHandlers, ...recurrenceHandlers], {
    onError: (error, kind) => {
      // Structured so a log search for `job.failed` finds every occurrence, with the kind
      // to group by. The dead-letter queue is the durable record; this is the alert.
      console.error(JSON.stringify({ event: 'job.failed', kind, message: error.message }));
    },
  });

  return Response.json(result);
}
