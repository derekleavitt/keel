'use client';

import {
  createListAction,
  deleteListAction,
  reorderListAction,
  updateListAction,
} from '@keel/testbed-lists/actions';
import { Button } from '@keel/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

type Row = { id: string; name: string; colour: string | null };

export function ListManager({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? 'Something went wrong');
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex gap-2"
        action={(data) => run(() => createListAction({ name: String(data.get('name') ?? '') }))}
      >
        <input
          name="name"
          required
          placeholder="New list"
          aria-label="New list name"
          className="h-10 flex-1 rounded-md border border-line bg-surface px-3 text-sm outline-none focus-visible:border-accent"
        />
        <Button type="submit" disabled={pending}>
          Add
        </Button>
      </form>

      {error && (
        <p role="alert" className="rounded-md border border-line bg-surface-2 px-3 py-2 text-sm">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted">No lists yet. Add one above.</p>
      ) : (
        <ul className="flex flex-col gap-px overflow-hidden rounded-lg border border-line bg-line">
          {rows.map((row, index) => (
            <li key={row.id} className="flex items-center gap-3 bg-surface px-4 py-3">
              {editing === row.id ? (
                <form
                  className="flex flex-1 gap-2"
                  action={(data) => {
                    run(() => updateListAction(row.id, { name: String(data.get('name') ?? '') }));
                    setEditing(null);
                  }}
                >
                  <input
                    name="name"
                    defaultValue={row.name}
                    aria-label={`Rename ${row.name}`}
                    className="h-8 flex-1 rounded-md border border-line bg-surface px-2 text-sm"
                  />
                  <Button type="submit" size="sm" disabled={pending}>
                    Save
                  </Button>
                </form>
              ) : (
                <>
                  <span className="flex-1 text-sm">{row.name}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending || index === 0}
                    aria-label={`Move ${row.name} up`}
                    onClick={() =>
                      run(() =>
                        reorderListAction({
                          id: row.id,
                          afterId: index >= 2 ? (rows[index - 2]?.id ?? null) : null,
                        }),
                      )
                    }
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => setEditing(row.id)}
                  >
                    Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    aria-label={`Delete ${row.name}`}
                    onClick={() => run(() => deleteListAction(row.id))}
                  >
                    Delete
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
