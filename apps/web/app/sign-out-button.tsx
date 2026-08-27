'use client';

import { authClient } from '@keel/auth/client';
import { Button } from '@keel/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await authClient.signOut();
        router.push('/sign-in');
        router.refresh();
      }}
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}
