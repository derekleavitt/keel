import { requireUserOrRedirect } from '@keel/auth/session';
import { deadJobs, pendingJobs } from '@keel/jobs';
import { retryJobAction } from './actions.ts';
import { RetryButton } from './retry-button.tsx';

export const dynamic = 'force-dynamic';

/**
 * Where a failing job actually surfaces.
 *
 * A dead-letter queue nobody looks at is the same as no dead-letter queue — the job stops
 * retrying, nothing errors, and the work silently never happens. This page is the "look".
 *
 * Signed-in users only, which is deliberately weak: proper role-gating arrives with T-18,
 * and until then visibility matters more than restriction — the failure mode this prevents
 * is nobody noticing, not the wrong person noticing.
 */
export default async function AdminJobsPage() {
  await requireUserOrRedirect('/admin/jobs');
  const [dead, pending] = await Promise.all([deadJobs(), pendingJobs()]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-1">
        <p className="font-mono text-xs uppercase tracking-widest text-accent">Jobs</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {dead.length > 0 ? `${dead.length} needing attention` : 'Nothing stuck'}
        </h1>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">
          Dead letter{' '}
          <span className="font-mono text-xs font-normal text-muted">{dead.length}</span>
        </h2>
        {dead.length === 0 ? (
          <p className="text-sm text-muted">No jobs have exhausted their retries.</p>
        ) : (
          <ul className="flex flex-col gap-px overflow-hidden rounded-lg border border-line bg-line">
            {dead.map((row) => (
              <li key={row.id} className="flex flex-col gap-2 bg-surface px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-accent">{row.kind}</span>
                  <span className="text-xs text-muted">after {row.attempts} attempts</span>
                  <span className="flex-1" />
                  <RetryButton id={row.id} kind={row.kind} action={retryJobAction} />
                </div>
                {row.lastError && (
                  <pre className="overflow-x-auto rounded bg-surface-2 px-3 py-2 text-xs text-muted">
                    {row.lastError.split('\n').slice(0, 3).join('\n')}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">
          Waiting <span className="font-mono text-xs font-normal text-muted">{pending.length}</span>
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-muted">The queue is empty.</p>
        ) : (
          <ul className="flex flex-col gap-px overflow-hidden rounded-lg border border-line bg-line">
            {pending.map((row) => (
              <li key={row.id} className="flex items-center gap-3 bg-surface px-4 py-3">
                <span className="font-mono text-xs text-accent">{row.kind}</span>
                <span className="text-xs text-muted">
                  {row.attempts > 0 ? `retry ${row.attempts}` : 'queued'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
