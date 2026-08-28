import { serverEnv } from '@keel/contracts/env';
import { runJobs } from '@keel/jobs';
import { webhookHandlers } from '@keel/webhooks/handlers';

export const dynamic = 'force-dynamic';

/**
 * The worker.
 *
 * A route rather than a long-running process, so the same deployment serves requests and
 * drains the queue — nothing extra to deploy, scale or forget to restart. A platform
 * scheduler calls it on a timer; see `docs/deployment.md`.
 *
 * **Authenticated by a shared secret, not a session.** A scheduler has no user, and an
 * unauthenticated endpoint that drains a queue lets anyone exhaust every job's retry budget.
 *
 * Register your own handlers here. A job kind with no registered handler is dead-lettered
 * rather than retried forever, so adding a handler package means adding it to this array.
 */
export async function POST(request: Request): Promise<Response> {
  const expected = serverEnv().JOBS_SECRET;
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

  if (!expected || provided !== expected) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await runJobs([...webhookHandlers], {
    onError: (error, kind) => {
      // Structured so a log search for `job.failed` finds every occurrence, with the kind to
      // group by. The dead-letter queue is the durable record; this is the alert.
      console.error(JSON.stringify({ event: 'job.failed', kind, message: error.message }));
    },
  });

  return Response.json(result);
}
