import { requireScopeOrRedirect } from '@keel/testbed-orgs/scope';
import { searchEverything } from '@keel/testbed-views';
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
  const scope = await requireScopeOrRedirect('/search');
  const raw = (await searchParams).q;
  const query = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');

  const results = await searchEverything(scope, query);

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
          placeholder="Search todos and lists"
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
          <ul
            aria-label="Results"
            className="flex flex-col gap-px overflow-hidden rounded-lg border border-line bg-line"
          >
            {results.hits.map((hit) => {
              const listId = typeof hit.meta?.listId === 'string' ? hit.meta.listId : hit.id;
              const done = hit.meta?.done === true;
              const dueDate = typeof hit.meta?.dueDate === 'string' ? hit.meta.dueDate : null;

              return (
                <li
                  key={`${hit.type}:${hit.id}`}
                  className="flex flex-col gap-1 bg-surface px-4 py-3"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[0.6rem] uppercase tracking-widest text-muted">
                      {hit.type}
                    </span>
                    <span className={done ? 'text-sm text-muted line-through' : 'text-sm'}>
                      {hit.title}
                    </span>
                  </div>
                  {/*
                   * The snippet comes from `ts_headline`, which marks the matched fragment
                   * with `<<`/`>>` rather than HTML — so it can be rendered as text with no
                   * escaping question at all.
                   */}
                  {hit.snippet && <span className="text-xs text-muted">{hit.snippet}</span>}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    {/* Which list a hit lives in — the cross-feature half of a result. */}
                    <Link href={`/lists/${listId}`} className="underline underline-offset-4">
                      {typeof hit.meta?.listName === 'string' ? hit.meta.listName : 'Open'}
                    </Link>
                    {dueDate && <span>· due {dueDate}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </main>
  );
}
