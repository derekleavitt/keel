import type { Scope } from '@keel/contracts/ids';
import { db, type KeelDatabase } from '@keel/db';
import { list } from '@keel/db/schema';
import { type SearchHit, searchQuery } from '@keel/search';
import { and, desc, sql } from 'drizzle-orm';
import { visibleVia } from './access.ts';

/**
 * How lists are searched. Owned here for the same reason todos own theirs: the visibility
 * rule is `visibleVia`, and re-deriving it in a search package is exactly how one query
 * ends up more permissive than the rest.
 */
export async function searchListSource(
  scope: Scope,
  query: string,
  options: { limit: number; database?: KeelDatabase },
): Promise<SearchHit[]> {
  const database = options.database ?? db();
  const tsquery = searchQuery(query);
  if (!tsquery) return [];

  const visible = visibleVia(list.id, scope);
  const predicate = and(visible, sql`${list.searchVector} @@ ${tsquery}`) ?? visible;

  const rows = await database
    .select({
      id: list.id,
      name: list.name,
      rank: sql<number>`ts_rank(${list.searchVector}, ${tsquery})`,
    })
    .from(list)
    .where(predicate)
    .orderBy(desc(sql`ts_rank(${list.searchVector}, ${tsquery})`))
    .limit(options.limit);

  return rows.map((row) => ({
    id: row.id,
    type: 'list',
    title: row.name,
    snippet: null,
    rank: Number(row.rank),
  }));
}

export const listSearchSource = searchListSource;
