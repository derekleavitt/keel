import { requireUserOrRedirect } from '@keel/auth/session';
import { requireScopeOrRedirect } from '@keel/testbed-orgs/scope';
import { buildAgenda } from '@keel/testbed-views';
import Link from 'next/link';
import { SignOutButton } from '../sign-out-button.tsx';
import { agendaForTimeZone } from './actions.ts';
import { AgendaView } from './agenda-view.tsx';

export const dynamic = 'force-dynamic';

export default async function AgendaPage() {
  const scope = await requireScopeOrRedirect('/agenda');
  const user = await requireUserOrRedirect('/agenda');
  // Rendered in UTC first so there is something on screen immediately; the client
  // re-reads it for the real timezone.
  const initial = await buildAgenda(scope, 'UTC');

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="font-mono text-xs uppercase tracking-widest text-accent">Today</p>
          <h1 className="text-2xl font-semibold tracking-tight">{user.name ?? user.email}</h1>
          <Link href="/lists" className="text-sm text-accent underline underline-offset-4">
            All lists
          </Link>
        </div>
        <SignOutButton />
      </header>

      <AgendaView initial={initial} load={agendaForTimeZone} />
    </main>
  );
}
