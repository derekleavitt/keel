'use client';

import { authClient } from '@keel/auth/client';
import { Button } from '@keel/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Shared sign-in / sign-up form.
 *
 * Client-side because it holds field state and calls the auth client directly. The app
 * never imports `better-auth` — `@keel/auth/client` is the boundary.
 */
export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignUp = mode === 'sign-up';

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    const email = String(data.get('email') ?? '');
    const password = String(data.get('password') ?? '');
    const name = String(data.get('name') ?? '');

    const result = isSignUp
      ? await authClient.signUp.email({ email, password, name })
      : await authClient.signIn.email({ email, password });

    if (result.error) {
      setError(result.error.message ?? 'Something went wrong. Try again.');
      setPending(false);
      return;
    }

    router.push('/dashboard');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {isSignUp && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Name</span>
          <input
            name="name"
            required
            autoComplete="name"
            className="h-10 rounded-md border border-line bg-surface px-3 text-sm outline-none focus-visible:border-accent"
          />
        </label>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className="h-10 rounded-md border border-line bg-surface px-3 text-sm outline-none focus-visible:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Password</span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
          className="h-10 rounded-md border border-line bg-surface px-3 text-sm outline-none focus-visible:border-accent"
        />
        {isSignUp && <span className="text-xs text-muted">At least 8 characters.</span>}
      </label>

      {error && (
        <p role="alert" className="rounded-md border border-line bg-surface-2 px-3 py-2 text-sm">
          {error}
        </p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? 'Working…' : isSignUp ? 'Create account' : 'Sign in'}
      </Button>

      <p className="text-sm text-muted">
        {isSignUp ? 'Already have an account? ' : 'No account yet? '}
        <Link
          href={isSignUp ? '/sign-in' : '/sign-up'}
          className="text-accent underline underline-offset-4"
        >
          {isSignUp ? 'Sign in' : 'Create one'}
        </Link>
      </p>
    </form>
  );
}
