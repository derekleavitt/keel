import { isPlatformAdmin } from '@keel/auth/platform';
import { requireUserOrRedirect } from '@keel/auth/session';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

export const dynamic = 'force-dynamic';

/**
 * The gate for **every** route under `/admin`.
 *
 * Deliberately here rather than in each page. A per-page check is one page away from being
 * forgotten, and the page somebody forgets is the one that crosses tenants — the failure is
 * silent, and it looks like a working feature. A layout cannot be bypassed by adding a
 * route beneath it, so the safe thing is the default thing.
 *
 * **404, not 403.** A 403 confirms that `/admin` exists and that the reader is simply not
 * allowed, which tells an attacker where to spend their time. To anyone who is not staff
 * this area does not exist — the same reasoning that makes another tenant's list a 404 in
 * the public API.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const caller = await requireUserOrRedirect('/admin');
  if (!(await isPlatformAdmin(caller.id))) notFound();

  return (
    <div className="min-h-dvh">
      <nav aria-label="Staff" className="border-b border-line bg-surface-2">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-6 py-3">
          <span className="font-mono text-xs uppercase tracking-widest text-accent">Staff</span>
          {/*
           * Written out rather than mapped: `typedRoutes` checks route literals, and a
           * tuple array widens them to `string`, which defeats the check that catches a
           * link to a page that does not exist.
           */}
          <Link href="/admin" className="text-sm underline underline-offset-4">
            Overview
          </Link>
          <Link href="/admin/organizations" className="text-sm underline underline-offset-4">
            Organizations
          </Link>
          <Link href="/admin/users" className="text-sm underline underline-offset-4">
            Users
          </Link>
          <Link href="/admin/jobs" className="text-sm underline underline-offset-4">
            Jobs
          </Link>
          <Link href="/admin/actions" className="text-sm underline underline-offset-4">
            Action log
          </Link>
          <Link href="/lists" className="ml-auto text-sm text-muted underline underline-offset-4">
            Leave staff area
          </Link>
        </div>
      </nav>
      {children}
    </div>
  );
}
