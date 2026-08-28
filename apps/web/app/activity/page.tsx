import { listActivity } from '@keel/audit';
import { requireScopeOrRedirect } from '@keel/testbed-orgs/scope';
import Link from 'next/link';
import { ActivityFeed } from './activity-feed.tsx';

export const dynamic = 'force-dynamic';

export default async function ActivityPage() {
  const scope = await requireScopeOrRedirect('/activity');
  const rows = await listActivity(scope, { limit: 100 });

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-1">
        <p className="font-mono text-xs uppercase tracking-widest text-accent">Activity</p>
        <h1 className="text-2xl font-semibold tracking-tight">Everything that happened here</h1>
        <p className="text-sm text-muted">
          Scoped to this organisation.{' '}
          <Link href="/lists" className="underline underline-offset-4">
            Back to lists
          </Link>
        </p>
      </header>

      <ActivityFeed rows={rows} empty="Nothing has happened yet." />
    </main>
  );
}
