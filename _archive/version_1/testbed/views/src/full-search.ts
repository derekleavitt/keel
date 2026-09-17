import type { Scope } from '@keel/contracts/ids';
import { db, type KeelDatabase } from '@keel/db';
import { runSearch, type SearchHit } from '@keel/search';
import { listLists, listSearchSource } from '@keel/testbed-lists';
import { searchTodos, todoSearchSource } from '@keel/testbed-todos';

/**
 * Search, across everything.
 *
 * This file is the entire cross-feature part of search, and note what it does not contain:
 * no SQL, no table names, no visibility rules. Each feature searches its own tables under
 * its own authorization rule; this registers them and merges the results.
 *
 * That is the answer to the ownership question T-19 raised. The alternative — one query
 * that unions across every feature's tables — puts the authorization rule for todos in a
 * file that todos does not own, and it grows an arm every time a feature becomes
 * searchable.
 */
const SOURCES = {
  todo: todoSearchSource,
  list: listSearchSource,
};

/**
 * Relative weight per source, applied after each source's ranks are normalised.
 *
 * An explicit, arguable choice rather than an accident of `ts_rank` arithmetic. Todos are
 * weighted slightly higher because they are what people are usually looking for; a list is
 * a container, and finding it is more often a navigation step than the answer.
 */
const WEIGHTS = { todo: 1, list: 0.9 };

export interface FullSearchResults {
  query: string;
  hits: SearchHit[];
  /** True when the user actually searched, rather than landing on an empty box. */
  searched: boolean;
}

export async function searchEverything(
  scope: Scope,
  query: string,
  options: { limit?: number; database?: KeelDatabase } = {},
): Promise<FullSearchResults> {
  const database = options.database ?? db();
  const trimmed = query.trim();
  const limit = options.limit ?? 50;

  /*
   * An empty query shows the caller's todos rather than nothing.
   *
   * A search box that blanks the screen when cleared reads as broken — the decision
   * predates full-text search and survives it. Lists are deliberately excluded here even
   * though they are searchable: an empty box means "show me my work", and `/lists` already
   * exists for browsing containers.
   */
  if (trimmed.length === 0) {
    // `searchTodos('')` is the pre-existing "everything visible, ordered" query.
    const rows = await searchTodos(scope, '', database);
    return {
      query: '',
      searched: false,
      hits: await withListNames(
        scope,
        rows.slice(0, limit).map((row) => ({
          id: row.id,
          type: 'todo',
          title: row.title,
          snippet: row.notes,
          rank: 0,
          meta: { listId: row.listId, done: row.done, dueDate: row.dueDate },
        })),
        database,
      ),
    };
  }

  const hits = await runSearch(SOURCES, scope, trimmed, {
    database,
    limit,
    weights: WEIGHTS,
  });

  return { query: trimmed, hits: await withListNames(scope, hits, database), searched: true };
}

/**
 * Attach the name of the list each todo lives in.
 *
 * The only genuinely cross-feature part of a result, and therefore the only part that
 * belongs in this package. `todos` cannot answer it without reading the lists table, which
 * is precisely the boundary ADR 0001 exists to hold — so the enrichment happens here, once,
 * over the whole result set rather than per row.
 */
async function withListNames(
  scope: Scope,
  hits: SearchHit[],
  database: KeelDatabase,
): Promise<SearchHit[]> {
  if (!hits.some((hit) => hit.type === 'todo')) return hits;

  const names = new Map((await listLists(scope, database)).map((row) => [row.id, row.name]));
  return hits.map((hit) =>
    hit.type === 'todo'
      ? { ...hit, meta: { ...hit.meta, listName: names.get(String(hit.meta?.listId)) ?? null } }
      : hit,
  );
}
