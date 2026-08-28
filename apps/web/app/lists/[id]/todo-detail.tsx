'use client';

import { TODO_PRIORITIES, type TodoPriority } from '@keel/contracts/todo';
import { updateTodoAction } from '@keel/testbed-todos/actions';
import { useSerialMutations } from '@keel/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const LABELS: Record<TodoPriority, string> = {
  none: 'No priority',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

/**
 * Due date, priority and notes for one todo.
 *
 * The pickers commit on change rather than behind a save button — the PRD's bar is that
 * adjusting a todo stays fast, and a save button for two dropdowns is friction.
 *
 * **Notes commit on blur, not on change.** A date picker fires once when a date is chosen;
 * a textarea fires on every keystroke, and saving there is a request per character, a
 * revalidation per character, and a race between them. Blur is one save per edit and is the
 * moment a user has actually finished — debouncing would be the same idea with a timer and
 * an extra way to lose the last keystroke.
 */
export function TodoDetail({
  id,
  title,
  dueDate,
  priority,
  notes,
  canEdit = true,
}: {
  id: string;
  title: string;
  dueDate: string | null;
  priority: TodoPriority;
  notes: string | null;
  /** False for a viewer on a shared list. The server refuses either way; this says so. */
  canEdit?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { enqueue, pending } = useSerialMutations({
    onSettled: () => router.refresh(),
    onError: setError,
  });

  /*
   * The draft is local while the field has focus, and adopts the server's value when it does
   * not. Without that second half a live update from another tab (T-20) would leave this
   * textarea showing an older draft, and the next blur would write it back — quietly undoing
   * someone else's edit.
   */
  const [draft, setDraft] = useState(notes ?? '');
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(notes ?? '');
  }, [notes]);

  function save(patch: {
    dueDate?: string | null;
    priority?: TodoPriority;
    notes?: string | null;
  }) {
    setError(null);
    enqueue(() => updateTodoAction(id, patch));
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={draft}
        rows={2}
        disabled={pending || !canEdit}
        readOnly={!canEdit}
        placeholder="Notes"
        aria-label={`Notes for ${title}`}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          focused.current = false;
          // Only write when something actually changed: a focus-and-leave should not touch
          // the row, bump `updated_at`, or wake every subscriber to this list.
          if (draft !== (notes ?? '')) save({ notes: draft.trim() === '' ? null : draft });
        }}
        className="w-full resize-y rounded-md border border-line bg-surface px-2 py-1 text-xs outline-none focus-visible:border-accent disabled:opacity-60"
      />
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={dueDate ?? ''}
          disabled={pending || !canEdit}
          aria-label={`Due date for ${title}`}
          onChange={(event) => save({ dueDate: event.target.value || null })}
          className="h-8 rounded-md border border-line bg-surface px-2 text-xs"
        />
        <select
          value={priority}
          disabled={pending || !canEdit}
          aria-label={`Priority for ${title}`}
          onChange={(event) => save({ priority: event.target.value as TodoPriority })}
          className="h-8 rounded-md border border-line bg-surface px-2 text-xs"
        >
          {TODO_PRIORITIES.map((value) => (
            <option key={value} value={value}>
              {LABELS[value]}
            </option>
          ))}
        </select>
        {error && (
          <span role="alert" className="text-xs text-muted">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
