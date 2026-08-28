import { keyHint, listApiKeys } from '@keel/auth/api-key';
import { requireScopeOrRedirect } from '@keel/testbed-orgs/scope';
import Link from 'next/link';
import { KeyManager } from './key-manager.tsx';

export const dynamic = 'force-dynamic';

export default async function ApiKeysPage() {
  const scope = await requireScopeOrRedirect('/settings/api-keys');
  const rows = await listApiKeys(scope.organizationId);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-1">
        <p className="font-mono text-xs uppercase tracking-widest text-accent">API keys</p>
        <h1 className="text-2xl font-semibold tracking-tight">Keys for this organisation</h1>
        <p className="text-sm text-muted">
          A key acts as you, in this organisation only, until it is revoked.{' '}
          <Link href="/lists" className="underline underline-offset-4">
            Back to lists
          </Link>
        </p>
      </header>

      <KeyManager
        rows={rows.map((row) => ({
          id: row.id,
          name: row.name,
          hint: keyHint(row.selector),
          lastUsedAt: row.lastUsedAt,
          revokedAt: row.revokedAt,
          createdAt: row.createdAt,
        }))}
      />
    </main>
  );
}
