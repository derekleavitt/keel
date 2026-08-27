import { requireUserOrRedirect } from '@keel/auth/session';
import { searchAcrossLists } from '@keel/testbed-views';
import Link from 'next/link';
import { SignOutButton } from '../sign-out-button.tsx';

export const dynamic = 'force-dynamic';

/**
 * Search, as a GET form.
 *
 * The query lives in the URL, so a result set can be shared, bookmarked and reloaded — and
 * the page needs no client JavaScript at all.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUserOrRedirect('/search');
  const raw = (await searchParams).q;
  const query = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');

  const results = await searchAcrossLists(user.id, query);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="font-mono text-xs uppercase tracking-widest text-accent">Search</p>
          <Link href="/lists" className="text-sm text-accent underline underline-offset-4">
            All lists
          </Link>
        </div>
        <SignOutButton />
      </header>

      <form className="flex gap-2">
        <input
          name="q"
          type="search"
          defaultValue={results.query}
          placeholder="Search titles and notes"
          aria-label="Search todos"
          autoComplete="off"
          className="h-10 flex-1 rounded-md border border-line bg-surface px-3 text-sm outline-none focus-visible:border-accent"
        />
        <button
          type="submit"
          className="h-10 rounded-md border border-line bg-surface-2 px-4 text-sm font-medium"
        >
          Search
        </button>
      </form>

      {results.hits.length === 0 ? (
        <p className="text-sm text-muted">
          {results.searched
            ? `Nothing matches “${results.query}”.`
            : 'Nothing here yet. Add a todo from one of your lists.'}
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">
            {results.hits.length} {results.hits.length === 1 ? 'result' : 'results'}
            {results.searched ? ` for “${results.query}”` : ''}
          </p>
          <ul className="flex flex-col gap-px overflow-hidden rounded-lg border border-line bg-line">
            {results.hits.map((hit) => (
              <li key={hit.id} className="flex flex-col gap-1 bg-surface px-4 py-3">
                <span className={hit.done ? 'text-sm text-muted line-through' : 'text-sm'}>
                  {hit.title}
                </span>
                {hit.notes && <span className="text-xs text-muted">{hit.notes}</span>}
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Link href={`/lists/${hit.listId}`} className="underline underline-offset-4">
                    {hit.listName}
                  </Link>
                  {hit.dueDate && <span>· due {hit.dueDate}</span>}
                  {hit.tags.map((tag) => (
                    <span key={tag.id} className="rounded-full border border-line px-2 py-0.5">
                      {tag.name}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
