import type { Scope } from '@keel/contracts/ids';
import type { KeelDatabase } from '@keel/db';

/**
 * The search boundary.
 *
 * The shape here is the answer to a question T-19 raised: search reads across every feature
 * at once, so who owns it?
 *
 * The answer is that **nobody searches across features**. Each feature exposes a
 * `SearchSource` that knows how to search *its own tables* — including the authorization
 * rule that decides what the caller may see, which is exactly the knowledge that must not
 * be reimplemented elsewhere. A composition package collects the sources, merges the
 * results and ranks them. It writes no SQL of its own.
 *
 * That keeps two properties at once: no package reads another's tables, and adding a
 * searchable feature is a registration rather than an edit to a growing union query.
 *
 * ## Replacing the engine
 *
 * A `SearchSource` is an async function returning ranked hits. The Postgres implementation
 * queries a `tsvector` column; a Meilisearch or Typesense one would call an HTTP API. The
 * composition layer, the page and the tests do not change, because none of them knows how
 * a hit was produced.
 */

export interface SearchHit {
  id: string;
  /** Which source produced this — `todo`, `list`. Used for routing and grouping. */
  type: string;
  title: string;
  /** A short excerpt with the match in it, when the source can produce one. */
  snippet: string | null;
  /**
   * Relevance, higher is better.
   *
   * Only comparable **within** a source. Postgres `ts_rank` values from two different
   * tables are not on a shared scale, so merging by raw rank silently favours whichever
   * table has shorter documents — see `mergeHits`.
   */
  rank: number;
  /** Anything the caller needs that is specific to this kind of hit. */
  meta?: Record<string, unknown>;
}

export type SearchSource = (
  scope: Scope,
  query: string,
  options: { limit: number; database: KeelDatabase },
) => Promise<SearchHit[]>;

export interface SearchOptions {
  limit?: number;
  database: KeelDatabase;
}

/**
 * Merge ranked hits from several sources.
 *
 * Ranks are normalised **per source** before merging. `ts_rank` is a function of term
 * frequency and document length, so a hit in a short `list.name` scores far higher than an
 * equally relevant hit in a long `todo.notes`. Sorting the raw numbers together would put
 * every list above every todo and look like a deliberate ranking decision rather than an
 * artefact of how the numbers are produced.
 *
 * Normalising to 0–1 within each source makes them comparable, and the per-source weight is
 * then an explicit, arguable choice rather than an accident.
 */
export function mergeHits(
  groups: SearchHit[][],
  weights: Record<string, number> = {},
  limit = 50,
): SearchHit[] {
  const normalised = groups.flatMap((hits) => {
    if (hits.length === 0) return [];
    const top = Math.max(...hits.map((hit) => hit.rank));
    // A source where everything scored zero still returns its hits, ordered as it gave them.
    if (top <= 0) return hits.map((hit, index) => ({ ...hit, rank: 1 - index / hits.length }));
    return hits.map((hit) => ({ ...hit, rank: (hit.rank / top) * (weights[hit.type] ?? 1) }));
  });

  return normalised.sort((a, b) => b.rank - a.rank).slice(0, limit);
}

/** Run every source and merge. Sources run concurrently; one failing does not hide the rest. */
export async function runSearch(
  sources: Record<string, SearchSource>,
  scope: Scope,
  query: string,
  options: SearchOptions & { weights?: Record<string, number> },
): Promise<SearchHit[]> {
  const limit = options.limit ?? 50;
  const entries = Object.entries(sources);

  const settled = await Promise.allSettled(
    entries.map(([, source]) => source(scope, query, { limit, database: options.database })),
  );

  const groups: SearchHit[][] = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      groups.push(result.value);
      return;
    }
    /*
     * One source failing degrades the results rather than emptying the page. A search that
     * returns todos but not lists is obviously better than an error, and the failure is
     * still visible in the log rather than swallowed.
     */
    console.error(
      JSON.stringify({
        event: 'search.source_failed',
        source: entries[index]?.[0],
        message: result.reason instanceof Error ? result.reason.message : String(result.reason),
      }),
    );
  });

  return mergeHits(groups, options.weights, limit);
}
