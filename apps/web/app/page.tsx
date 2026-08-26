import { Button } from '@keel/ui';

const checks = [
  { name: 'Monorepo', detail: 'pnpm workspaces + Turborepo, affected-only tasks' },
  { name: 'Contracts', detail: 'Zod schemas and the env contract, shared by every package' },
  { name: 'Database', detail: 'Drizzle over Postgres, schema as plain TypeScript' },
  { name: 'Auth', detail: 'Better Auth, configured in-repo and fully readable' },
  { name: 'Gate', detail: 'pnpm verify — typecheck, lint, unit tests, build' },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-10 px-6 py-16">
      <div className="flex flex-col gap-4">
        <p className="font-mono text-xs uppercase tracking-widest text-accent">Phase 0</p>
        <h1 className="text-4xl font-semibold tracking-tight text-balance">
          The foundation is up.
        </h1>
        <p className="text-muted text-lg leading-relaxed">
          Keel is an agent-native starter: a durable context layer that makes any freshly spawned
          agent immediately competent anywhere in the codebase.
        </p>
      </div>

      <ul className="flex flex-col gap-px overflow-hidden rounded-lg border border-line bg-line">
        {checks.map((check) => (
          <li
            key={check.name}
            className="flex flex-col gap-1 bg-surface px-5 py-4 sm:flex-row sm:gap-6"
          >
            <span className="w-28 shrink-0 font-mono text-xs uppercase tracking-wider text-accent">
              {check.name}
            </span>
            <span className="text-sm text-muted">{check.detail}</span>
          </li>
        ))}
      </ul>

      <div className="flex gap-3">
        <Button>Read the architecture</Button>
        <Button variant="secondary">View on GitHub</Button>
      </div>
    </main>
  );
}
