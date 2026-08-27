'use client';

import type { ShareRole } from '@keel/contracts/list';
import { revokeShareAction, shareListAction } from '@keel/testbed-lists/actions';
import { Button, useSerialMutations } from '@keel/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Share = { userId: string; email: string; name: string | null; role: ShareRole };

/**
 * Sharing, owner only.
 *
 * Rendered only when the viewer owns the list — an editor can change what is in a list but
 * not who else can reach it, and showing them a control they cannot use invites a support
 * question rather than preventing anything.
 */
export function SharePanel({ listId, shares }: { listId: string; shares: Share[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const { enqueue, pending } = useSerialMutations({
    onSettled: () => router.refresh(),
    onError: setError,
  });

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center justify-between text-left text-sm font-medium"
        aria-expanded={open}
      >
        Sharing
        <span className="font-mono text-xs font-normal text-muted">
          {shares.length === 0 ? 'private' : `${shares.length} shared`}
        </span>
      </button>

      {open && (
        <>
          <form
            className="flex flex-wrap gap-2"
            action={(data) => {
              setError(null);
              enqueue(() =>
                shareListAction({
                  listId,
                  email: String(data.get('email') ?? ''),
                  role: String(data.get('role') ?? 'viewer') as ShareRole,
                }),
              );
            }}
          >
            <input
              name="email"
              type="email"
              required
              placeholder="their@email.com"
              aria-label="Share with email"
              className="h-8 flex-1 rounded-md border border-line bg-surface px-2 text-xs"
            />
            <select
              name="role"
              aria-label="Share role"
              defaultValue="viewer"
              className="h-8 rounded-md border border-line bg-surface px-2 text-xs"
            >
              <option value="viewer">Can view</option>
              <option value="editor">Can edit</option>
            </select>
            <Button type="submit" size="sm" disabled={pending}>
              Share
            </Button>
          </form>

          {error && (
            <p role="alert" className="text-xs text-muted">
              {error}
            </p>
          )}

          {shares.length > 0 && (
            <ul className="flex flex-col gap-2">
              {shares.map((share) => (
                <li key={share.userId} className="flex items-center gap-3 text-xs">
                  <span className="flex-1">
                    {share.name ?? share.email}
                    <span className="text-muted">
                      {' '}
                      · {share.role === 'editor' ? 'can edit' : 'can view'}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    aria-label={`Revoke access for ${share.email}`}
                    onClick={() => {
                      setError(null);
                      enqueue(() => revokeShareAction({ listId, userId: share.userId }));
                    }}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
