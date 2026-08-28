import type { Scope } from '@keel/contracts/ids';
import { db, type KeelDatabase } from '@keel/db';
import { todo } from '@keel/db/schema';
import { type SearchHit, searchQuery } from '@keel/search';
import { visibleVia } from '@keel/testbed-lists';
import { and, desc, sql } from 'drizzle-orm';

/**
 * How todos are searched. Owned here, because these are todo columns and the rule about
 * who may see a todo is a todo rule.
 *
 * The composition layer merges this with other sources and never writes SQL against these
 * tables — see `@keel/search` for why that split is the answer to "who owns search".
 */
export async function searchTodoSource(
  scope: Scope,
  query: string,
  options: { limit: number; database?: KeelDatabase },
): Promise<SearchHit[]> {
  const database = options.database ?? db();
  const tsquery = searchQuery(query);
  if (!tsquery) return [];

  const visible = visibleVia(todo.listId, scope);
  const predicate = and(visible, sql`${todo.searchVector} @@ ${tsquery}`) ?? visible;

  const rows = await database
    .select({
      id: todo.id,
      title: todo.title,
      listId: todo.listId,
      done: todo.done,
      dueDate: todo.dueDate,
      /*
       * `ts_headline` over the notes, not a substring: it finds the matching fragment and
       * marks it, so the excerpt actually contains the term the user searched for. A
       * `slice(0, 120)` shows the first 120 characters, which usually do not.
       */
      snippet: sql<string | null>`
        case when ${todo.notes} is null or ${todo.notes} = '' then null
        else ts_headline('english', ${todo.notes}, ${tsquery},
          'MaxWords=18, MinWords=6, StartSel=<<, StopSel=>>')
        end
      `,
      rank: sql<number>`ts_rank(${todo.searchVector}, ${tsquery})`,
    })
    .from(todo)
    .where(predicate)
    .orderBy(desc(sql`ts_rank(${todo.searchVector}, ${tsquery})`))
    .limit(options.limit);

  return rows.map((row) => ({
    id: row.id,
    type: 'todo',
    title: row.title,
    snippet: row.snippet,
    rank: Number(row.rank),
    meta: { listId: row.listId, done: row.done, dueDate: row.dueDate },
  }));
}

/** Registered under this name by the composition layer. */
export const todoSearchSource = searchTodoSource;
