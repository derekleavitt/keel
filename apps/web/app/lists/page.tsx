import { requireUserOrRedirect } from '@keel/auth/session';
import { listLists } from '@keel/testbed-lists';
import { requireScopeOrRedirect } from '@keel/testbed-orgs/scope';
import { SignOutButton } from '../sign-out-button.tsx';
import { ListManager } from './list-manager.tsx';

export const dynamic = 'force-dynamic';

export default async function ListsPage() {
  const scope = await requireScopeOrRedirect('/lists');
  const user = await requireUserOrRedirect('/lists');
  const rows = await listLists(scope);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="font-mono text-xs uppercase tracking-widest text-accent">Lists</p>
          <h1 className="text-2xl font-semibold tracking-tight">{user.name ?? user.email}</h1>
        </div>
        <div className="flex items-center gap-4">
          <a href="/activity" className="text-sm text-accent underline underline-offset-4">
            Activity
          </a>
          <a href="/settings/api-keys" className="text-sm text-accent underline underline-offset-4">
            API keys
          </a>
          <a href="/settings/webhooks" className="text-sm text-accent underline underline-offset-4">
            Webhooks
          </a>
          <SignOutButton />
        </div>
      </header>

      <ListManager rows={rows.map(({ id, name, colour }) => ({ id, name, colour }))} />
    </main>
  );
}
