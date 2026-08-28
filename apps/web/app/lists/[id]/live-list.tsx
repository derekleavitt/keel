'use client';

import { useLiveUpdates } from '@keel/ui';
import { useRouter } from 'next/navigation';

/**
 * Keeps this list page current while somebody else changes it.
 *
 * Renders a small status line and nothing else — the update itself is `router.refresh()`,
 * which refetches the server components with the caller's own authorization. Nothing arrives
 * over the connection except "something on this channel moved".
 */
export function LiveList({ listId, cursor }: { listId: string; cursor: number }) {
  const router = useRouter();
  const status = useLiveUpdates([`list:${listId}`], () => router.refresh(), { cursor });

  const label = {
    live: 'Live',
    connecting: 'Connecting…',
    polling: 'Live (polling)',
    offline: 'Not updating',
  }[status];

  return (
    <p className="font-mono text-[0.65rem] uppercase tracking-widest text-muted">
      <span
        aria-hidden
        className={
          status === 'offline'
            ? 'mr-2 inline-block size-1.5 rounded-full bg-muted'
            : 'mr-2 inline-block size-1.5 rounded-full bg-accent'
        }
      />
      <span data-testid="live-status">{label}</span>
    </p>
  );
}
