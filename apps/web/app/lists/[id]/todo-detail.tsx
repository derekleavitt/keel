'use client';

import { TODO_PRIORITIES, type TodoPriority } from '@keel/contracts/todo';
import { updateTodoAction } from '@keel/testbed-todos/actions';
import { useSerialMutations } from '@keel/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const LABELS: Record<TodoPriority, string> = {
  none: 'No priority',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

/**
 * Due date and priority for one todo.
 *
 * Both commit on change rather than behind a save button — the PRD's bar is that adding
 * and adjusting a todo stays fast, and a save button for two fields is friction.
 */
export function TodoDetail({
  id,
  title,
  dueDate,
  priority,
}: {
  id: string;
  title: string;
  dueDate: string | null;
  priority: TodoPriority;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { enqueue, pending } = useSerialMutations({
    onSettled: () => router.refresh(),
    onError: setError,
  });

  function save(patch: { dueDate?: string | null; priority?: TodoPriority }) {
    setError(null);
    enqueue(() => updateTodoAction(id, patch));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="date"
        value={dueDate ?? ''}
        disabled={pending}
        aria-label={`Due date for ${title}`}
        onChange={(event) => save({ dueDate: event.target.value || null })}
        className="h-8 rounded-md border border-line bg-surface px-2 text-xs"
      />
      <select
        value={priority}
        disabled={pending}
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
  );
}
