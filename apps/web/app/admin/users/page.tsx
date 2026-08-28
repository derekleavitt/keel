import { findUsers, recordAndDisclose } from '@keel/admin';
import { requirePlatformAdmin } from '@keel/auth/session';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /*
   * The layout already gated this route, but a page and its layout render concurrently,
   * so this can resolve before the layout's `notFound()` lands. Answering 404 here too
   * keeps the two consistent and keeps a raw error out of the log — and means the page is
   * still safe if it is ever moved out from under that layout.
   */
  const actor = await requirePlatformAdmin().catch(() => notFound());
  const raw = (await searchParams).q;
  const query = (Array.isArray(raw) ? raw[0] : raw) ?? '';
  const users = query ? await findUsers(query) : [];

  if (query) {
    /*
     * Searching for a person is itself a staff action worth recording. Reads are the
     * majority of what support does, and an audit log that only covers writes cannot answer
     * "who looked at this account", which is the question that actually gets asked.
     */
    await recordAndDisclose(actor, {
      action: 'users.searched',
      summary: `searched users for “${query}”`,
      detail: { results: users.length },
    });
  }

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Users</h1>

      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={query}
          placeholder="Search by email"
          aria-label="Search users"
          className="h-11 flex-1 rounded-md border border-line bg-surface px-3 text-sm outline-none focus-visible:border-accent"
        />
        <button
          type="submit"
          className="h-11 rounded-md border border-line bg-surface-2 px-4 text-sm"
        >
          Search
        </button>
      </form>

      {query && users.length === 0 ? (
        <p className="text-sm text-muted">No users match “{query}”.</p>
      ) : (
        users.length > 0 && (
          <ul
            aria-label="Users"
            className="flex flex-col gap-px overflow-hidden rounded-lg border border-line bg-line"
          >
            {users.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-4 bg-surface px-4 py-3"
              >
                <span className="text-sm">{row.email}</span>
                <span className="font-mono text-xs text-muted">
                  {row.organizations} {row.organizations === 1 ? 'org' : 'orgs'}
                </span>
              </li>
            ))}
          </ul>
        )
      )}
    </main>
  );
}
