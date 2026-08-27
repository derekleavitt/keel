'use client';

import type { TodoPriority } from '@keel/contracts/todo';
import { createTodoAction, deleteTodoAction, setTodoDoneAction } from '@keel/testbed-todos/actions';
import { Button, useSerialMutations } from '@keel/ui';
import { useRouter } from 'next/navigation';
import { useOptimistic, useRef, useState } from 'react';
import { TodoDetail } from './todo-detail.tsx';
import { type TagChip, TodoTags } from './todo-tags.tsx';

type Row = {
  id: string;
  title: string;
  done: boolean;
  dueDate: string | null;
  priority: TodoPriority;
  tags: TagChip[];
};

export function TodoList({
  listId,
  rows,
  allTags,
  filtered = false,
}: {
  listId: string;
  rows: Row[];
  allTags: TagChip[];
  /** True when a filter is narrowing. Changes what an empty result means. */
  filtered?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Mutations run one at a time. Overlapping them lets a later revalidation render server
   * state fetched before an earlier write landed, silently reverting it — see
   * .orchestration/lessons/L-021.md.
   */
  const { enqueue, pending } = useSerialMutations({
    onSettled: () => router.refresh(),
    onError: setError,
  });

  /**
   * Optimistic completion state.
   *
   * A checkbox driven straight from server state does not move when clicked: React
   * re-renders it from `rows`, which has not changed yet, so the tick reverts until the
   * round trip lands. On a fast local connection that reads as a flicker; on a slow one it
   * reads as broken.
   *
   * `useOptimistic` applies the change immediately and rolls it back automatically if the
   * action fails. It must be updated inside a transition, which is why every mutation here
   * goes through `run()`.
   */
  const [optimisticRows, applyOptimistic] = useOptimistic(
    rows,
    (state: Row[], change: { id: string; done: boolean }) =>
      state.map((row) => (row.id === change.id ? { ...row, done: change.done } : row)),
  );

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    enqueue(action);
  }

  // Sorting client-side mirrors the query's `order by done, position`, so an optimistic
  // tick moves the row immediately instead of waiting for the server to reorder it.
  const ordered = [...optimisticRows].sort((a, b) => Number(a.done) - Number(b.done));
  const outstanding = ordered.filter((row) => !row.done).length;

  return (
    <div className="flex flex-col gap-6">
      {/* Quick add: type a title, press enter. Everything else is editable later. */}
      <form
        action={(data) => {
          const title = String(data.get('title') ?? '');
          if (!title.trim()) return;
          run(() => createTodoAction({ listId, title }));
          inputRef.current?.form?.reset();
          inputRef.current?.focus();
        }}
      >
        <input
          ref={inputRef}
          name="title"
          required
          placeholder="Add a todo and press enter"
          aria-label="New todo"
          autoComplete="off"
          className="h-11 w-full rounded-md border border-line bg-surface px-3 text-sm outline-none focus-visible:border-accent"
        />
      </form>

      {error && (
        <p role="alert" className="rounded-md border border-line bg-surface-2 px-3 py-2 text-sm">
          {error}
        </p>
      )}

      {ordered.length === 0 ? (
        /*
         * "Nothing here" and "nothing matches" are different states, and the PRD calls
         * this out specifically: users read an empty filtered list as a broken app.
         */
        <p className="text-sm text-muted">
          {filtered ? 'No todos match these filters.' : 'Nothing here yet.'}
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-px overflow-hidden rounded-lg border border-line bg-line">
            {ordered.map((row) => (
              <li key={row.id} className="flex items-start gap-3 bg-surface px-4 py-3">
                <input
                  type="checkbox"
                  checked={row.done}
                  disabled={pending}
                  aria-label={`Mark ${row.title} ${row.done ? 'not done' : 'done'}`}
                  onChange={(event) => {
                    const done = event.target.checked;
                    setError(null);
                    enqueue(async () => {
                      applyOptimistic({ id: row.id, done });
                      return setTodoDoneAction({ id: row.id, done });
                    });
                  }}
                  className="mt-1 size-4 accent-accent"
                />
                <div className="flex flex-1 flex-col gap-2">
                  <span className={row.done ? 'text-sm text-muted line-through' : 'text-sm'}>
                    {row.title}
                  </span>
                  <TodoDetail
                    id={row.id}
                    title={row.title}
                    dueDate={row.dueDate}
                    priority={row.priority}
                  />
                  <TodoTags
                    todoId={row.id}
                    todoTitle={row.title}
                    tags={row.tags}
                    suggestions={allTags}
                    onChanged={() => router.refresh()}
                  />
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  aria-label={`Delete ${row.title}`}
                  onClick={() => run(() => deleteTodoAction(row.id))}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">
            {outstanding === 0 ? 'All done.' : `${outstanding} outstanding`}
          </p>
        </>
      )}
    </div>
  );
}
