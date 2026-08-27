'use client';

import { detachTagAction, tagTodoByNameAction } from '@keel/testbed-tags/actions';
import { useOptimistic, useRef, useState, useTransition } from 'react';

export type TagChip = { id: string; name: string; colour: string | null };

/**
 * Tags on one todo, with inline creation.
 *
 * The input is a plain text field backed by a `datalist` of the tags the user already
 * has, rather than a picker plus a separate "new tag" dialog. Typing a name that exists
 * reuses it and typing one that does not creates it — `tagTodoByNameAction` decides,
 * inside one transaction, so the UI never has to ask which case it is in. That is the
 * whole of "create a new tag inline while doing it".
 *
 * `useOptimistic` is here for the reason `.claude/rules/web.md` gives: a chip rendered
 * straight from server state does not appear until the round trip lands, which on a slow
 * connection reads as the button having done nothing.
 */
export function TodoTags({
  todoId,
  todoTitle,
  tags,
  suggestions,
  onChanged,
}: {
  todoId: string;
  todoTitle: string;
  tags: TagChip[];
  suggestions: TagChip[];
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = `tag-options-${todoId}`;

  const [optimisticTags, applyOptimistic] = useOptimistic(
    tags,
    (state: TagChip[], change: { type: 'add'; name: string } | { type: 'remove'; id: string }) =>
      change.type === 'remove'
        ? state.filter((row) => row.id !== change.id)
        : // A tag being created has no id yet; the refresh replaces this with the real row.
          [...state, { id: `pending:${change.name}`, name: change.name, colour: null }].sort(
            (a, b) => a.name.localeCompare(b.name),
          ),
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {optimisticTags.map((row) => (
        <span
          key={row.id}
          className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 py-0.5 pr-1 pl-2 text-xs"
        >
          {row.colour && (
            <span
              aria-hidden="true"
              className="size-2 rounded-full"
              style={{ backgroundColor: row.colour }}
            />
          )}
          {row.name}
          <button
            type="button"
            disabled={pending || row.id.startsWith('pending:')}
            aria-label={`Remove tag ${row.name} from ${todoTitle}`}
            className="rounded-full px-1 text-muted hover:text-fg"
            onClick={() => {
              setError(null);
              startTransition(async () => {
                applyOptimistic({ type: 'remove', id: row.id });
                const result = await detachTagAction({ todoId, tagId: row.id });
                if (!result.ok) setError(result.error ?? 'Something went wrong');
                onChanged();
              });
            }}
          >
            ×
          </button>
        </span>
      ))}

      <form
        action={(data) => {
          const name = String(data.get('name') ?? '').trim();
          if (!name) return;
          setError(null);
          startTransition(async () => {
            applyOptimistic({ type: 'add', name });
            const result = await tagTodoByNameAction({ todoId, name });
            if (!result.ok) setError(result.error ?? 'Something went wrong');
            onChanged();
          });
          inputRef.current?.form?.reset();
        }}
      >
        <input
          ref={inputRef}
          name="name"
          list={listId}
          disabled={pending}
          placeholder="+ tag"
          aria-label={`Add a tag to ${todoTitle}`}
          autoComplete="off"
          className="h-6 w-24 rounded-full border border-dashed border-line bg-transparent px-2 text-xs outline-none focus-visible:border-accent"
        />
        <datalist id={listId}>
          {suggestions.map((row) => (
            <option key={row.id} value={row.name} />
          ))}
        </datalist>
      </form>

      {error && (
        <span role="alert" className="text-xs text-muted">
          {error}
        </span>
      )}
    </div>
  );
}
