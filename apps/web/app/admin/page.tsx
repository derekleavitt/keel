import { listAdminActions } from '@keel/auth/platform';
import { deadJobs } from '@keel/jobs';
import { listOrganizations } from '@keel/testbed-admin';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function AdminOverviewPage() {
  const [organizations, dead, recent] = await Promise.all([
    listOrganizations(500),
    deadJobs(),
    listAdminActions(5),
  ]);

  const members = organizations.reduce((total, org) => total + org.members, 0);

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>

      <dl
        aria-label="Summary"
        className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line"
      >
        {/*
         * Written out rather than mapped: `typedRoutes` checks route literals, and a
         * tuple array widens them to `string`, defeating the check that catches a link to
         * a page that does not exist.
         */}
        <Link href="/admin/organizations" className="flex flex-col gap-1 bg-surface px-4 py-4">
          <dt className="font-mono text-xs uppercase tracking-widest text-muted">Organizations</dt>
          <dd className="text-2xl font-semibold">{organizations.length}</dd>
        </Link>
        <Link href="/admin/users" className="flex flex-col gap-1 bg-surface px-4 py-4">
          <dt className="font-mono text-xs uppercase tracking-widest text-muted">Memberships</dt>
          <dd className="text-2xl font-semibold">{members}</dd>
        </Link>
        <Link href="/admin/jobs" className="flex flex-col gap-1 bg-surface px-4 py-4">
          <dt className="font-mono text-xs uppercase tracking-widest text-muted">Dead jobs</dt>
          <dd className="text-2xl font-semibold">{dead.length}</dd>
        </Link>
      </dl>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted">
          Recent staff actions
        </h2>
        {recent.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet.</p>
        ) : (
          <ul
            aria-label="Recent actions"
            className="flex flex-col gap-px overflow-hidden rounded-lg border border-line bg-line"
          >
            {recent.map((row) => (
              <li key={row.id} className="bg-surface px-4 py-3 text-sm">
                <span className="text-muted">{row.actorEmail}</span> {row.summary}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
