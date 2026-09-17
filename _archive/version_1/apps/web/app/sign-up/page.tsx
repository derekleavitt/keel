import { AuthForm } from '../auth-form.tsx';

export const dynamic = 'force-dynamic';

export default function SignUpPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-6 py-16">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>
        <p className="text-sm text-muted">Takes about ten seconds.</p>
      </div>
      <AuthForm mode="sign-up" />
    </main>
  );
}
