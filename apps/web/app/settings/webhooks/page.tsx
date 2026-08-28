import { requireScopeOrRedirect } from '@keel/testbed-orgs/scope';
import { listDeliveries, listEndpoints } from '@keel/webhooks';
import Link from 'next/link';
import { WebhookManager } from './webhook-manager.tsx';

export const dynamic = 'force-dynamic';

export default async function WebhooksPage() {
  const scope = await requireScopeOrRedirect('/settings/webhooks');
  const [endpoints, deliveries] = await Promise.all([
    listEndpoints(scope.organizationId),
    listDeliveries(scope.organizationId, { limit: 50 }),
  ]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-1">
        <p className="font-mono text-xs uppercase tracking-widest text-accent">Webhooks</p>
        <h1 className="text-2xl font-semibold tracking-tight">Tell another system what happened</h1>
        <p className="text-sm text-muted">
          Every delivery is signed. Verify it before trusting the body — see{' '}
          <code className="font-mono text-xs">docs/api.md</code>.{' '}
          <Link href="/lists" className="underline underline-offset-4">
            Back to lists
          </Link>
        </p>
      </header>

      <WebhookManager
        endpoints={endpoints.map(({ id, url, events, disabledAt }) => ({
          id,
          url,
          events,
          disabledAt,
        }))}
        deliveries={deliveries}
      />
    </main>
  );
}
