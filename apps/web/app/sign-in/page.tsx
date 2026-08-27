import { AuthForm } from '../auth-form.tsx';

export const dynamic = 'force-dynamic';

export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-6 py-16">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted">Welcome back.</p>
      </div>
      <AuthForm mode="sign-in" />
    </main>
  );
}
