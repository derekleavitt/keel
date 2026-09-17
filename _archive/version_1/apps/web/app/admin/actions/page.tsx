import { listAdminActions } from '@keel/auth/platform';

export const dynamic = 'force-dynamic';

/**
 * The staff action log.
 *
 * Read-only and unfiltered by design: a log staff can narrow, edit or clear is a log that
 * proves nothing. Everything here is also disclosed to the affected tenant when there is
 * one — see `recordAndDisclose`.
 */
export default async function AdminActionsPage() {
  const actions = await listAdminActions(200);

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Action log</h1>
      {actions.length === 0 ? (
        <p className="text-sm text-muted">Nothing yet.</p>
      ) : (
        <ul
          aria-label="Actions"
          className="flex flex-col gap-px overflow-hidden rounded-lg border border-line bg-line"
        >
          {actions.map((row) => (
            <li key={row.id} className="flex flex-col gap-1 bg-surface px-4 py-3">
              <span className="text-sm">
                <span className="text-muted">{row.actorEmail}</span> {row.summary}
              </span>
              <span className="font-mono text-[0.65rem] uppercase tracking-widest text-muted">
                {row.action}
                {row.organizationId && ` · ${row.organizationId}`} ·{' '}
                {row.createdAt.toISOString().replace('T', ' ').slice(0, 16)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
