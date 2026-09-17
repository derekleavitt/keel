'use client';

import { authClient } from '@keel/auth/client';
import { Button } from '@keel/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { forgetActiveOrganizationAction } from './actions.ts';

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
        // Clear the workspace selection first: it is a per-browser cookie, so leaving it
        // behind hands the next person to sign in here someone else's active workspace.
        await forgetActiveOrganizationAction();
        await authClient.signOut();
        router.push('/sign-in');
        router.refresh();
      }}
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}
