'use client';

import { Button, useSerialMutations } from '@keel/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function RetryButton({
  id,
  kind,
  action,
}: {
  id: string;
  kind: string;
  action: (id: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { enqueue, pending } = useSerialMutations({
    onSettled: () => router.refresh(),
    onError: setError,
  });

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        aria-label={`Retry ${kind}`}
        onClick={() => {
          setError(null);
          enqueue(() => action(id));
        }}
      >
        Retry
      </Button>
      {error && <span className="text-xs text-muted">{error}</span>}
    </>
  );
}
