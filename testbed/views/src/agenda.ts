import type { UserId } from '@keel/contracts/ids';
import type { TodoPriority } from '@keel/contracts/todo';
import { db, type KeelDatabase } from '@keel/db';
import { listLists } from '@keel/testbed-lists';
import { listTagsForTodos } from '@keel/testbed-tags';
import { isOverdue, listDueTodos, todayIn } from '@keel/testbed-todos';

/**
 * A cross-feature read model.
 *
 * The agenda spans todos, lists and tags, and belongs to none of them — a question left
 * open at decomposition and deliberately deferred until a feature forced an answer.
 *
 * **The answer: cross-feature reads live in a package that depends on several features and
 * is depended on by nothing but the app.** It sits as a leaf in the dependency graph, so
 * no feature package ever learns about another and the graph stays acyclic. The
 * alternatives both fail:
 *
 * - *Put it in `todos`* — which is what the first draft did, joining `list` for a name.
 *   The next cross-feature field makes todos read a third table, and "the todos package"
 *   quietly becomes "the package that knows about everything".
 * - *Put it in `apps/web`* — the app is meant to compose components, not own query logic,
 *   and it cannot be unit-tested against a database.
 *
 * This package writes **no SQL of its own**. It calls each feature's own read functions
 * and merges the results, so every table keeps exactly one package that knows how to query
 * it. The cost is one round trip per feature rather than a single join; that is the right
 * trade until measurement says otherwise, and the escape hatch — a hand-written join
 * living here — is available without moving any ownership.
 */
export interface AgendaEntry {
  id: string;
  title: string;
  dueDate: string;
  priority: TodoPriority;
  listId: string;
  listName: string;
  tags: { id: string; name: string; colour: string | null }[];
  overdue: boolean;
}

export interface Agenda {
  today: string;
  overdue: AgendaEntry[];
  dueToday: AgendaEntry[];
  /** True when there is genuinely nothing due, as opposed to nothing loaded. */
  empty: boolean;
}

/**
 * Everything outstanding and due on or before today, in the user's timezone.
 *
 * The timezone is the caller's because only the browser knows it — a server-side `today`
 * would show the wrong day to anyone not on the server's clock, which is the failure the
 * PRD names as "correct at midnight without a refresh".
 */
export async function buildAgenda(
  userId: UserId,
  timeZone: string,
  database: KeelDatabase = db(),
): Promise<Agenda> {
  const today = todayIn(timeZone);

  const due = await listDueTodos(userId, today, database);
  if (due.length === 0) {
    return { today, overdue: [], dueToday: [], empty: true };
  }

  // Two batched lookups rather than one per todo. Each feature answers for its own tables.
  const [lists, tagsByTodo] = await Promise.all([
    listLists(userId, database),
    listTagsForTodos(
      userId,
      due.map((row) => row.id),
      database,
    ),
  ]);

  const listNames = new Map(lists.map((row) => [row.id, row.name]));

  const entries: AgendaEntry[] = due.map((row) => ({
    id: row.id,
    title: row.title,
    // `listDueTodos` only returns rows with a due date, so this is never null in practice.
    dueDate: row.dueDate ?? today,
    priority: row.priority,
    listId: row.listId,
    listName: listNames.get(row.listId) ?? 'Unknown list',
    tags: tagsByTodo.get(row.id) ?? [],
    overdue: isOverdue(row.dueDate, today),
  }));

  return {
    today,
    overdue: entries.filter((entry) => entry.overdue),
    dueToday: entries.filter((entry) => !entry.overdue),
    empty: false,
  };
}
