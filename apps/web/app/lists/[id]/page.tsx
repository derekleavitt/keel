import { requireUserOrRedirect } from '@keel/auth/session';
import { getList } from '@keel/testbed-lists';
import { listTags, listTagsForTodos } from '@keel/testbed-tags';
import { listTodos } from '@keel/testbed-todos';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TodoList } from './todo-list.tsx';

export const dynamic = 'force-dynamic';

export default async function ListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUserOrRedirect('/lists');

  const list = await getList(user.id, id);
  if (!list) notFound();

  const todos = await listTodos(user.id, id);
  // One query for every row's tags rather than one per row, and one for the suggestions
  // offered by the inline tag input. Tags are global to the user, so the second is not
  // scoped to this list.
  const [tagsByTodo, allTags] = await Promise.all([
    listTagsForTodos(
      user.id,
      todos.map((row) => row.id),
    ),
    listTags(user.id),
  ]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <Link href="/lists" className="text-sm text-accent underline underline-offset-4">
          ← All lists
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{list.name}</h1>
      </header>

      <TodoList
        listId={list.id}
        allTags={allTags.map(({ id, name, colour }) => ({ id, name, colour }))}
        rows={todos.map(({ id, title, done, dueDate, priority }) => ({
          id,
          title,
          done,
          dueDate,
          priority,
          tags: tagsByTodo.get(id) ?? [],
        }))}
      />
    </main>
  );
}
