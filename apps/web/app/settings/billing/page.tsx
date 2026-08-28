import { billingSummary, PLANS, recentBillingEvents } from '@keel/billing';
import { listLists } from '@keel/testbed-lists';
import { listMembers } from '@keel/testbed-orgs';
import { requireScopeOrRedirect } from '@keel/testbed-orgs/scope';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

function Usage({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const atLimit = limit !== null && used >= limit;
  return (
    <li
      aria-label={`${label} usage`}
      className="flex items-center justify-between gap-4 bg-surface px-4 py-3"
    >
      <span className="text-sm">{label}</span>
      <span className={atLimit ? 'font-mono text-xs text-accent' : 'font-mono text-xs text-muted'}>
        {used} / {limit ?? 'unlimited'}
      </span>
    </li>
  );
}

export default async function BillingPage() {
  const scope = await requireScopeOrRedirect('/settings/billing');
  /*
   * The counts are gathered here, from the packages that own each resource — billing
   * deliberately cannot measure them. Same shape as every other cross-feature read: the
   * composition happens where the dependencies already point.
   */
  const [lists, members] = await Promise.all([listLists(scope), listMembers(scope)]);
  const summary = await billingSummary(scope, {
    lists: lists.length,
    seats: members.length,
    storageBytes: 0,
  });
  const events = await recentBillingEvents(scope.organizationId);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-1">
        <p className="font-mono text-xs uppercase tracking-widest text-accent">Billing</p>
        <h1 className="text-2xl font-semibold tracking-tight">{PLANS[summary.plan].label} plan</h1>
        <p className="text-sm text-muted">
          Status: <span data-testid="billing-status">{summary.status}</span>.{' '}
          <Link href="/lists" className="underline underline-offset-4">
            Back to lists
          </Link>
        </p>
        {/*
         * The account id, shown because it is the first thing a support conversation about
         * billing needs and the customer otherwise has no way to find it.
         */}
        <p className="font-mono text-[0.65rem] text-muted" data-testid="organization-id">
          {scope.organizationId}
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted">Usage</h2>
        <ul
          aria-label="Usage"
          className="flex flex-col gap-px overflow-hidden rounded-lg border border-line bg-line"
        >
          <Usage label="Lists" used={summary.lists.used} limit={summary.lists.limit} />
          <Usage label="Seats" used={summary.seats.used} limit={summary.seats.limit} />
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted">Plans</h2>
        <ul
          aria-label="Plans"
          className="flex flex-col gap-px overflow-hidden rounded-lg border border-line bg-line"
        >
          {Object.entries(PLANS).map(([name, plan]) => (
            <li
              key={name}
              aria-label={`Plan ${plan.label}`}
              className="flex items-center justify-between gap-4 bg-surface px-4 py-3"
            >
              <span className={name === summary.plan ? 'text-sm text-accent' : 'text-sm'}>
                {plan.label}
                {name === summary.plan && ' · current'}
              </span>
              <span className="font-mono text-xs text-muted">
                {plan.seats ?? '∞'} seats · {plan.lists ?? '∞'} lists
              </span>
            </li>
          ))}
        </ul>
        {/*
         * No upgrade button. Checkout needs a real payment provider, and wiring one needs
         * an account and live keys that belong to whoever deploys this — see docs/billing.md
         * for the four functions to implement. Showing a button that cannot work would be
         * worse than showing none.
         */}
        <p className="text-sm text-muted">
          Changing plan requires a payment provider. See{' '}
          <code className="font-mono text-xs">docs/billing.md</code>.
        </p>
      </section>

      {events.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-mono text-xs uppercase tracking-widest text-muted">
            Provider events
          </h2>
          <ul
            aria-label="Provider events"
            className="flex flex-col gap-px overflow-hidden rounded-lg border border-line bg-line"
          >
            {events.map((row) => (
              <li key={row.id} className="flex flex-col gap-1 bg-surface px-4 py-3">
                <span className="text-sm">{row.type}</span>
                <span className="font-mono text-[0.65rem] uppercase tracking-widest text-muted">
                  {row.id}
                  {row.skippedReason && ` · skipped: ${row.skippedReason}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
