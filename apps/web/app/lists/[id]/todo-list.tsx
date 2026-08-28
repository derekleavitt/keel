'use client';

import type { TodoPriority } from '@keel/contracts/todo';
import {
  createTodoAction,
  deleteTodoAction,
  reorderTodoAction,
  setTodoDoneAction,
} from '@keel/testbed-todos/actions';
import { Button, useSerialMutations } from '@keel/ui';
import { useRouter } from 'next/navigation';
import { useOptimistic, useRef, useState } from 'react';
import { Attachments } from './attachments.tsx';
import { TodoDetail } from './todo-detail.tsx';
import { type TagChip, TodoTags } from './todo-tags.tsx';

type Row = {
  id: string;
  title: string;
  done: boolean;
  dueDate: string | null;
  priority: TodoPriority;
  tags: TagChip[];
  files: { id: string; filename: string; size: number }[];
};

export function TodoList({
  listId,
  rows,
  allTags,
  filtered = false,
  canEdit = true,
}: {
  listId: string;
  rows: Row[];
  allTags: TagChip[];
  /** False for a viewer: attachments render read-only rather than being hidden. */
  canEdit?: boolean;
  /** True when a filter is narrowing. Changes what an empty result means. */
  filtered?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
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
  const outstandingIds = ordered.filter((row) => !row.done).map((row) => row.id);

  /**
   * Drop `dragging` onto `targetId`.
   *
   * The action names the neighbour to sit *after*, never a position — a client that picks
   * its own float can collide two rows or invent an order that does not exist. Dropping on
   * the row directly above means "take its place", so the anchor is the row before that.
   */
  /**
   * Move a todo one place, by button.
   *
   * Drag is an enhancement; this is the interface. Reordering that only works by dragging
   * is unusable with a keyboard, unusable with a screen reader, and awkward on a phone —
   * and it is the only path a test can drive deterministically, since HTML5 drag emulation
   * varies by browser.
   */
  function move(id: string, direction: -1 | 1) {
    const index = outstandingIds.indexOf(id);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= outstandingIds.length) return;

    const afterId =
      target === 0 ? null : (outstandingIds[target - (direction > 0 ? 0 : 1)] ?? null);
    setError(null);
    enqueue(() => reorderTodoAction({ id, listId, afterId }));
  }

  function drop(targetId: string) {
    if (!dragging || dragging === targetId) return;

    const from = outstandingIds.indexOf(dragging);
    const to = outstandingIds.indexOf(targetId);
    if (from === -1 || to === -1) return;

    const afterId = to === 0 ? null : (outstandingIds[to > from ? to : to - 1] ?? null);
    setDragging(null);
    setError(null);
    enqueue(() => reorderTodoAction({ id: dragging, listId, afterId }));
  }
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
          <ul
            aria-label="Todos"
            className="flex flex-col gap-px overflow-hidden rounded-lg border border-line bg-line"
          >
            {/*
             * The row is the drop *target*, but only the handle starts a drag.
             *
             * Making the whole row draggable broke as soon as it contained a file input:
             * `<input type="file">` is a native drop target, so a drag landing anywhere
             * near it never reached this handler. Links, checkboxes and selects have the
             * same problem in milder forms — a row full of controls is an ambiguous thing
             * to pick up.
             */}
            {ordered.map((row) => (
              <li
                key={row.id}
                aria-label={`Reorder ${row.title}`}
                onDragOver={(event) => {
                  if (dragging && !row.done) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  drop(row.id);
                }}
                className={
                  dragging === row.id
                    ? 'flex items-start gap-3 bg-surface-2 px-4 py-3 opacity-60'
                    : 'flex items-start gap-3 bg-surface px-4 py-3'
                }
              >
                {!row.done && (
                  <span className="mt-0.5 flex flex-col">
                    <button
                      type="button"
                      disabled={pending || outstandingIds.indexOf(row.id) === 0}
                      aria-label={`Move ${row.title} up`}
                      onClick={() => move(row.id, -1)}
                      className="text-xs leading-none text-muted disabled:opacity-30"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      disabled={
                        pending || outstandingIds.indexOf(row.id) === outstandingIds.length - 1
                      }
                      aria-label={`Move ${row.title} down`}
                      onClick={() => move(row.id, 1)}
                      className="text-xs leading-none text-muted disabled:opacity-30"
                    >
                      ▼
                    </button>
                  </span>
                )}
                {!row.done && (
                  /*
                   * A real button, not a styled span. It is focusable, it has a role, and
                   * it can carry an accessible name — none of which a span with drag
                   * handlers can. Dragging is the enhancement; the move buttons above are
                   * the interface that works without a mouse.
                   */
                  <button
                    type="button"
                    draggable={!pending}
                    aria-label={`Drag ${row.title}`}
                    onDragStart={() => setDragging(row.id)}
                    onDragEnd={() => setDragging(null)}
                    onDragOver={(event) => {
                      if (dragging) event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      drop(row.id);
                    }}
                    className="mt-1 cursor-grab select-none text-xs text-muted"
                  >
                    ⠿
                  </button>
                )}
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
                  <Attachments
                    todoId={row.id}
                    todoTitle={row.title}
                    files={row.files}
                    canEdit={canEdit}
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
