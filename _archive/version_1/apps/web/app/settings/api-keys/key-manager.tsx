'use client';

import { Button } from '@keel/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createApiKeyAction, revokeApiKeyAction } from './actions.ts';

export type KeyRow = {
  id: string;
  name: string;
  hint: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

export function KeyManager({ rows }: { rows: KeyRow[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /**
   * The one and only time this value exists in the browser.
   *
   * Held in component state rather than written anywhere: no localStorage, no URL, no
   * cookie. A navigation loses it, which is correct — a token the app can retrieve later
   * is a token an attacker can retrieve later.
   */
  const [issued, setIssued] = useState<{ name: string; token: string } | null>(null);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    setPending(true);
    try {
      const result = await action();
      if (!result.ok) setError(result.error ?? 'Something went wrong');
      router.refresh();
      return result;
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        action={async (data) => {
          const name = String(data.get('name') ?? '').trim();
          if (!name) return;
          const result = await run(() => createApiKeyAction({ name }));
          if (result.ok && 'token' in result && typeof result.token === 'string') {
            setIssued({ name, token: result.token });
          }
        }}
        className="flex gap-2"
      >
        <input
          name="name"
          required
          placeholder="What is this key for?"
          aria-label="New key name"
          autoComplete="off"
          className="h-11 flex-1 rounded-md border border-line bg-surface px-3 text-sm outline-none focus-visible:border-accent"
        />
        <Button type="submit" disabled={pending}>
          Create key
        </Button>
      </form>

      {error && (
        <p role="alert" className="rounded-md border border-line bg-surface-2 px-3 py-2 text-sm">
          {error}
        </p>
      )}

      {issued && (
        <div className="flex flex-col gap-2 rounded-md border border-accent bg-surface-2 px-4 py-3">
          <p className="text-sm font-medium">Copy “{issued.name}” now — it is shown once.</p>
          {/*
           * `<output>`, not `<code>`: it carries an implicit `status` role, so the token
           * is announced when it appears and can take an accessible name. `aria-label` on
           * a bare `<code>` is dropped — the element has no role to attach it to.
           */}
          <output aria-label="New API key" className="break-all font-mono text-xs text-accent">
            {issued.token}
          </output>
          <button
            type="button"
            onClick={() => setIssued(null)}
            className="self-start text-xs text-muted underline underline-offset-4"
          >
            I have copied it
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted">No API keys yet.</p>
      ) : (
        <ul
          aria-label="API keys"
          className="flex flex-col gap-px overflow-hidden rounded-lg border border-line bg-line"
        >
          {rows.map((row) => (
            <li
              key={row.id}
              aria-label={`Key ${row.name}`}
              className="flex items-center justify-between gap-4 bg-surface px-4 py-3"
            >
              <div className="flex flex-col gap-1">
                <span className={row.revokedAt ? 'text-sm text-muted line-through' : 'text-sm'}>
                  {row.name}
                </span>
                <span className="font-mono text-xs text-muted">
                  {row.hint} ·{' '}
                  {row.revokedAt
                    ? 'revoked'
                    : row.lastUsedAt
                      ? `last used ${row.lastUsedAt.toISOString().slice(0, 10)}`
                      : 'never used'}
                </span>
              </div>
              {!row.revokedAt && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  aria-label={`Revoke ${row.name}`}
                  onClick={() => run(() => revokeApiKeyAction(row.id))}
                >
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
