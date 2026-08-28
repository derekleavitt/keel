import { requireUserOrRedirect } from '@keel/auth/session';
import Link from 'next/link';
import { SignOutButton } from '../sign-out-button.tsx';

/**
 * A protected page, and the starting point for your application.
 *
 * `requireUserOrRedirect()` sends a signed-out visitor to /sign-in rather than throwing.
 * Opening a protected page while logged out is ordinary behaviour, not an error — the
 * throwing variant belongs in server actions, where an unauthenticated call is a bug or an
 * attack.
 *
 * Everything the platform provides is already wired: organizations and scoping, billing
 * limits, the job queue, audit logging, rate limiting and the admin surface. Copy
 * `examples/notes` for the shape of a feature package.
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

      <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface px-5 py-4">
        <Link href="/organizations" className="text-sm text-accent underline underline-offset-4">
          Workspaces
        </Link>
        <Link
          href="/settings/api-keys"
          className="text-sm text-accent underline underline-offset-4"
        >
          API keys
        </Link>
        <Link href="/settings/billing" className="text-sm text-accent underline underline-offset-4">
          Billing
        </Link>
      </div>

      <p className="text-sm text-muted">
        This is your application now. Add a feature package under <code>packages/</code>, a route
        here, and the gate will hold you to the same standard everything else was built to.
      </p>
    </main>
  );
}
