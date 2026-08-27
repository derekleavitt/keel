import { requireUserOrRedirect } from '@keel/auth/session';
import Link from 'next/link';
import { SignOutButton } from '../sign-out-button.tsx';

/**
 * A protected page.
 *
 * `requireUserOrRedirect()` sends a signed-out visitor to /sign-in rather than throwing.
 * Opening a protected page while logged out is ordinary behaviour, not an error — the
 * throwing variant belongs in server actions, where an unauthenticated call is a bug or
 * an attack.
 */
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await requireUserOrRedirect('/dashboard');

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="font-mono text-xs uppercase tracking-widest text-accent">Signed in</p>
          <h1 className="text-2xl font-semibold tracking-tight">{user.name ?? user.email}</h1>
          <p className="text-sm text-muted">{user.email}</p>
        </div>
        <SignOutButton />
      </header>

      <div className="rounded-lg border border-line bg-surface px-5 py-4">
        <div className="flex flex-col gap-2">
          <Link href="/agenda" className="text-sm text-accent underline underline-offset-4">
            What's due today
          </Link>
          <Link href="/lists" className="text-sm text-accent underline underline-offset-4">
            Go to your lists
          </Link>
          <Link href="/search" className="text-sm text-accent underline underline-offset-4">
            Search everything
          </Link>
        </div>
      </div>
    </main>
  );
}
