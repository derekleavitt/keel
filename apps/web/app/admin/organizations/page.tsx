import { requirePlatformAdmin } from '@keel/auth/session';
import { listOrganizations, recordAndDisclose } from '@keel/testbed-admin';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function AdminOrganizationsPage() {
  /*
   * The layout already gated this route. Calling it again is not redundancy for its own
   * sake — it is how the actor's identity reaches the disclosure below, and it means this
   * page is still safe if it is ever moved out from under that layout.
   */
  /*
   * The layout already gated this route, but a page and its layout render concurrently,
   * so this can resolve before the layout's `notFound()` lands. Answering 404 here too
   * keeps the two consistent and keeps a raw error out of the log — and means the page is
   * still safe if it is ever moved out from under that layout.
   */
  const actor = await requirePlatformAdmin().catch(() => notFound());
  const organizations = await listOrganizations(200);

  await recordAndDisclose(actor, {
    action: 'organizations.listed',
    summary: 'listed every organization',
    detail: { count: organizations.length },
  });

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Organizations</h1>
      <ul
        aria-label="Organizations"
        className="flex flex-col gap-px overflow-hidden rounded-lg border border-line bg-line"
      >
        {organizations.map((org) => (
          <li
            key={org.id}
            aria-label={`Organization ${org.name}`}
            className="flex items-center justify-between gap-4 bg-surface px-4 py-3"
          >
            <span className="text-sm">{org.name}</span>
            <span className="font-mono text-xs text-muted">
              {org.members} {org.members === 1 ? 'member' : 'members'} · {org.id}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
