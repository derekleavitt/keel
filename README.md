# Keel

**A Next.js starter for building web platforms with Claude Code.**

Clone it, point an agent at it, and start building. The repository is set up so a fresh agent
is productive immediately: a short entry point, constraints it cannot accidentally violate,
and one command that decides whether the work is finished.

Multi-tenancy, auth, billing, background jobs, a public API and more are already built and
tested, so your first feature starts on a platform rather than an empty app.

---

## Quick start

```bash
pnpm install
pnpm db:up        # Postgres in Docker, writes .env with generated secrets
pnpm db:migrate
pnpm dev
```

No account anywhere, no `.env` to hand-edit, no Postgres to install. Open
`http://localhost:3000`, create an account, and you're in.

A demo todo application ships with it so nothing is hypothetical. When you're ready to
replace it with your own:

```bash
pnpm eject:testbed            # preview what goes
pnpm eject:testbed --confirm
```

That removes the demo and leaves the platform, with the test suite still passing.

## Build your first feature

Every feature follows the same shape. Copy [`examples/notes`](./examples/notes) — it is a
complete vertical slice, heavily commented, and it compiles.

**1. Add your tables** in `packages/db/src/schema/<feature>.ts` — a new file, so parallel work
never conflicts. Add two lines to `schema/index.ts`: one re-export, one spread. Then:

```bash
pnpm db:generate && pnpm db:migrate
```

**2. Add validation** in `packages/contracts/src/<feature>.ts`. Zod schemas live here so
every layer agrees on the same shapes.

**3. Create the package** — `packages/<feature>/package.json` with
`"exports": { ".": "./src/index.ts" }`, a `tsconfig.json` extending the base, and
`typecheck` / `test:unit` scripts. Run `pnpm install` twice; the first pass reports the
lockfile as current and skips linking.

**4. Write queries** in `src/queries.ts`. Every one takes a `Scope` as its first argument:

```ts
export async function listProjects(scope: Scope, database: KeelDatabase = db()) {
  return database.select().from(project).where(visibleVia(project.id, scope));
}
```

`Scope` is branded, so a query that forgets tenancy is a **compile error**, not a data leak.
Authorization is expressed once as a composable predicate and never re-derived — that is what
keeps one query from being quietly more permissive than the rest.

**5. Write server actions** in `src/actions.ts`. Every export from a `'use server'` file is a
public HTTP endpoint, so: never accept a `userId` argument, never export helpers, and validate
every input with a contract schema before it reaches a query.

**6. Test against real Postgres.** `createTestDatabase()` gives you PGlite with your migrations
applied — real constraints, real cascades, fast enough to run per test.

**7. Add routes** in `apps/web/app/`. Keep them thin: compose packages, don't put logic here.

**8. Run the gate.**

```bash
pnpm verify
```

## What you get for free

Building on top of these rather than writing them:

| | |
|---|---|
| **Auth** | Sign-up, sign-in, sessions, password handling — Better Auth, wired |
| **Multi-tenancy** | Organizations, membership, invitations; `Scope` on every query |
| **Sharing** | Per-resource grants that compose into your own queries |
| **API keys** | Split-token, hashed, revocable, per-key rate limits |
| **Admin roles** | Platform staff as a *separate axis* from tenant roles |
| **Background jobs** | Postgres queue: transactional enqueue, backoff, dead letter |
| **Scheduled work** | Recurrence rules, DST-correct, idempotent generation |
| **Billing** | Plans, limits enforced in the query layer, idempotent provider webhooks |
| **Rate limiting** | Shared across instances, sliding window |
| **Public API** | Versioned `/api/v1`, documented error codes |
| **Outbound webhooks** | Signed, retried, replayable, SSRF-guarded |
| **Realtime** | Server-sent events, re-authorized while open, degrades to polling |
| **Full-text search** | Postgres FTS with an index that cannot fall behind |
| **Audit log** | Recorded at the query layer, so every entry point is covered |
| **File storage** | Driver interface, local in development |
| **Email** | Writes to `.keel/mail/` in development and never sends |

Each is documented where you'd look for it — see [Reference](#reference).

## Working with an agent

**Point it at [CLAUDE.md](./CLAUDE.md).** That is the entry point: layout, conventions, and
the handful of things that will bite if missed. It is deliberately short, because context
spent reading instructions is context not spent on your problem.

**Rules load on demand.** `.claude/rules/*.md` carry `paths:` frontmatter, so the rules about
schema design load when your agent touches `packages/db/**` and stay out of the way otherwise.

**`pnpm verify` is the definition of done.** It runs lint, typecheck, unit tests, the lesson
ledger and the build, and it is wired to the Claude Code `Stop` hook in `.claude/settings.json`
— so **an agent cannot finish a turn while the repo is broken**. Roughly 40 seconds including
the browser suite; a few seconds without it.

**Record what goes wrong.** When your agent hits a real bug, write a lesson in
`.orchestration/lessons/` naming the mechanism that stops it recurring — a test, a lint rule,
a hook. The gate fails if a lesson names enforcement that doesn't exist, so the ledger can't
decay into a folder of good intentions.

**For unattended runs**, `.orchestration/` has a task backlog, a loop protocol, circuit
breakers, and `pnpm loop:status` to reconstruct where a crashed session stopped.

## Everyday commands

```bash
pnpm dev              # all dev servers
pnpm verify           # the gate — lint, typecheck, tests, build
pnpm verify unit      # iterate on one step
KEEL_E2E=1 pnpm verify   # include the browser suite
pnpm lint:fix         # format and autofix — run before verify
pnpm db:generate      # create a migration from schema changes
pnpm db:migrate       # apply migrations
pnpm db:studio        # browse the database
pnpm admin:grant you@example.com   # grant platform-staff access
```

## Configuration

`pnpm db:up` writes a working `.env`. For anything beyond local development:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres |
| `BETTER_AUTH_SECRET` | yes | ≥32 characters; rotating it signs everyone out |
| `BETTER_AUTH_URL` | yes | Your public origin |
| `JOBS_SECRET` | to run jobs | The worker endpoint refuses everything without it |
| `BILLING_WEBHOOK_SECRET` | with a payment provider | See [docs/billing.md](./docs/billing.md) |

New variables go in `packages/contracts/src/env.ts` **and** `.env.example`. Reading
`process.env` anywhere else is a bug the review will catch.

`pnpm verify` passes with no `.env` at all — environment, database and auth are lazily
initialised, so tests and builds never need secrets.

## Deploying

```bash
docker build -t your-app .
docker run -p 3000:3000 -e DATABASE_URL=… -e BETTER_AUTH_SECRET=… your-app
```

Run migrations as a **release step**, never on boot — every replica would migrate at once
during a rolling deploy. And point a scheduler at `POST /api/jobs/run` every minute, or
background work silently never happens.

Full detail, including Vercel and what is untested, in
[docs/deployment.md](./docs/deployment.md).

## Stack

Next.js 16 · React 19 · TypeScript 5.9 strict · pnpm + Turborepo · Postgres + Drizzle ·
Better Auth · Tailwind 4 · Biome · Vitest + PGlite · Playwright

Internal packages export TypeScript source directly — no build step between editing a package
and seeing the effect. Package boundaries are enforced by module resolution: a package that
doesn't declare a dependency fails to build when it imports one.

## Reference

| | |
|---|---|
| [CLAUDE.md](./CLAUDE.md) | Agent entry point — read this first |
| [examples/notes](./examples/notes) | The vertical slice to copy |
| [docs/architecture.md](./docs/architecture.md) | Why the repo is shaped this way |
| [docs/api.md](./docs/api.md) | Public API, keys, webhooks, rate limits |
| [docs/billing.md](./docs/billing.md) | Plans, limits, wiring a payment provider |
| [docs/deployment.md](./docs/deployment.md) | Container, hosting, migrations, the worker |
| [.claude/rules/](./.claude/rules/) | Per-area constraints your agent loads on demand |

## Known gaps

- **No payment provider is wired.** Plans, limits and webhook reconciliation are built and
  tested against a stub; connecting a real one is four functions and your keys.
- **Hosting is documented but untested** — the container is verified locally only.
- **Parallel agents are designed, not proven.** Territories and a task ledger are specified in
  `.orchestration/`; everything here was built by one agent at a time.

## License

MIT
