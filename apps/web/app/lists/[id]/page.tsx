import { listActivity } from '@keel/audit';
import { isTodoFilterNarrowing, type TodoFilter, todoFilterSchema } from '@keel/contracts/todo';
import { requireScopeOrRedirect } from '@keel/organizations/scope';
import { currentCursor } from '@keel/realtime';
import { listAttachments } from '@keel/testbed-attachments';
import { getList, listShares, roleOnList } from '@keel/testbed-lists';
import { listTags, listTagsForTodos } from '@keel/testbed-tags';
import { listRules, listTodos } from '@keel/testbed-todos';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActivityFeed } from '../../activity/activity-feed.tsx';
import { LiveList } from './live-list.tsx';
import { RepeatPanel } from './repeat-panel.tsx';
import { SharePanel } from './share-panel.tsx';
import { TodoFilters } from './todo-filters.tsx';
import { TodoList } from './todo-list.tsx';

export const dynamic = 'force-dynamic';

/** Query string to filter. Anything unparseable is simply ignored rather than erroring. */
function readFilter(search: Record<string, string | string[] | undefined>): TodoFilter {
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

  const parsed = todoFilterSchema.safeParse({
    done: one(search.done) === undefined ? undefined : one(search.done) === 'true',
    priority: one(search.priority) ? [one(search.priority)] : undefined,
    tagIds: one(search.tag) ? [one(search.tag)] : undefined,
  });
  return parsed.success ? parsed.data : {};
}

export default async function ListPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const filter = readFilter(await searchParams);
  const scope = await requireScopeOrRedirect('/lists');

  /*
   * The cursor is taken **before** the page's data is read, never after. The other order
   * drops anything that lands in between: the page renders state from T1, subscribes from
   * T2, and silently never hears about the gap.
   */
  const cursor = await currentCursor(scope.organizationId);

  const list = await getList(scope, id);
  if (!list) notFound();

  const [todos, role, shares, history] = await Promise.all([
    listTodos(scope, id, filter),
    roleOnList(scope, id),
    listShares(scope, id),
    // The history of this one list, served straight off the (target_type, target_id) index.
    listActivity(scope, { targetType: 'list', targetId: id, limit: 20 }),
  ]);
  const series = await listRules(scope, id);
  // One query for every row's tags rather than one per row, and one for the suggestions
  // offered by the inline tag input. Tags are global to the user, so the second is not
  // scoped to this list.
  const filesByTodo = new Map(
    await Promise.all(
      todos.map(async (row) => [row.id, await listAttachments(scope, row.id)] as const),
    ),
  );

  const [tagsByTodo, allTags] = await Promise.all([
    listTagsForTodos(
      scope,
      todos.map((row) => row.id),
    ),
    listTags(scope),
  ]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <Link href="/lists" className="text-sm text-accent underline underline-offset-4">
          ← All lists
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{list.name}</h1>
        <LiveList listId={id} cursor={cursor} />
        {role !== 'owner' && (
          <p className="text-xs text-muted">
            Shared with you · {role === 'editor' ? 'you can edit' : 'view only'}
          </p>
        )}
      </header>

      {shares !== null && <SharePanel listId={id} shares={shares} />}

      <TodoFilters
        filter={filter}
        tags={allTags.map(({ id: tagId, name }) => ({ id: tagId, name }))}
        active={isTodoFilterNarrowing(filter)}
      />

      <TodoList
        listId={list.id}
        allTags={allTags.map(({ id, name, colour }) => ({ id, name, colour }))}
        filtered={isTodoFilterNarrowing(filter)}
        canEdit={role === 'owner' || role === 'editor'}
        rows={todos.map(({ id, title, done, notes, dueDate, priority }) => ({
          id,
          title,
          done,
          notes,
          dueDate,
          priority,
          tags: tagsByTodo.get(id) ?? [],
          files: (filesByTodo.get(id) ?? []).map((file) => ({
            id: file.id,
            filename: file.filename,
            size: file.size,
          })),
        }))}
      />

      <RepeatPanel listId={id} series={series} />

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted">History</h2>
        <ActivityFeed rows={history} empty="Nothing recorded for this list yet." />
      </section>
    </main>
  );
}
