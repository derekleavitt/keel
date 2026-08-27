import type { UserId } from '@keel/contracts/ids';
import type { TodoPriority } from '@keel/contracts/todo';
import { db, type KeelDatabase } from '@keel/db';
import { listLists } from '@keel/testbed-lists';
import { listTagsForTodos } from '@keel/testbed-tags';
import { searchTodos } from '@keel/testbed-todos';

/**
 * Search results, with the list each hit lives in.
 *
 * The second view built on ADR 0001, and it confirmed the pattern generalises: the query
 * itself belongs to `todos`, because title and notes are todo columns and the escaping
 * belongs with the table it protects. Only "which list is this in" crosses a boundary, and
 * only that part lives here.
 */
export interface SearchHit {
  id: string;
  title: string;
  notes: string | null;
  done: boolean;
  dueDate: string | null;
  priority: TodoPriority;
  listId: string;
  listName: string;
  tags: { id: string; name: string; colour: string | null }[];
}

export interface SearchResults {
  query: string;
  hits: SearchHit[];
  /** True when the user actually searched, as opposed to landing on an empty box. */
  searched: boolean;
}

export async function searchAcrossLists(
  userId: UserId,
  query: string,
  database: KeelDatabase = db(),
): Promise<SearchResults> {
  const trimmed = query.trim();
  const matches = await searchTodos(userId, trimmed, database);

  if (matches.length === 0) {
    return { query: trimmed, hits: [], searched: trimmed.length > 0 };
  }

  const [lists, tagsByTodo] = await Promise.all([
    listLists(userId, database),
    listTagsForTodos(
      userId,
      matches.map((row) => row.id),
      database,
    ),
  ]);
  const listNames = new Map(lists.map((row) => [row.id, row.name]));

  return {
    query: trimmed,
    searched: trimmed.length > 0,
    hits: matches.map((row) => ({
      id: row.id,
      title: row.title,
      notes: row.notes,
      done: row.done,
      dueDate: row.dueDate,
      priority: row.priority,
      listId: row.listId,
      listName: listNames.get(row.listId) ?? 'Unknown list',
      tags: tagsByTodo.get(row.id) ?? [],
    })),
  };
}
