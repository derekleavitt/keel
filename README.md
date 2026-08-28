# Keel

**Most boilerplates optimise the first hour. Keel optimises the ten-thousandth run.**

The first hour is easy — any starter gets you a running app. What breaks a large codebase is
what happens months later, when nobody remembers why a constraint exists, the documentation
quietly stopped being true, and the agent working on it is a fresh context window that has
never seen this repository before.

Keel is built so that agent can spin up, know exactly where to start, and keep going
effectively — on run one and on run ten thousand.

> **Agents are ephemeral. Context is durable.**
>
> You cannot keep an agent informed. You can make the *repository* informative, and make the
> things that matter impossible to violate rather than merely written down.

---

## Two layers

**A substrate** — the platform underneath your product. Multi-tenancy, auth, billing, jobs, a
public API, rate limiting. Built, tested, and shaped so the important rules are enforced by
the compiler and the build rather than by an agent's good intentions.

**A memory layer** — how the repository remembers *why*. Decisions, hard-won lessons, and the
constraints that came out of them, each attached to a mechanism that fails the build if it is
violated. Not a wiki nobody reads.

Together they answer one question: **how do you safely reach run ten thousand on any web
platform build-out?**

## What actually breaks at scale, and the answer here

| At run 10,000 | Keel's answer |
|---|---|
| Nobody remembers why a constraint exists, so it gets violated | Constraints are enforced by module resolution, branded types and the gate — there is no comment that suppresses them |
| Documentation drifted and an agent acts on it | Conventions live in code and in path-scoped rules that load only when relevant files are touched |
| The same mistake is made again by a different agent | A lesson ledger where every entry names an enforcement mechanism — and the gate fails if that mechanism doesn't exist |
| "Done" is a judgement call, so work gets undone | `pnpm verify` on the `Stop` hook: an agent **cannot finish a turn** while the repo is broken |
| An agent burns its context rediscovering the repo | A 132-line entry point, and a vertical slice to copy |
| Parallel agents collide | One-file-per-feature schema layout, a task ledger, and territories |

## Quick start

```bash
pnpm install
pnpm db:up        # Postgres in Docker, writes .env with generated secrets
pnpm db:migrate
pnpm dev
```

No account anywhere, no `.env` to hand-edit, no Postgres to install.

A demo todo application ships with it so nothing is hypothetical — it is what the substrate
was built against. Replace it with yours when ready:

```bash
pnpm eject:testbed --confirm
```

The demo goes; the platform and the test suite stay green.

## Build your first feature

Copy [`examples/notes`](./examples/notes) — a complete, commented vertical slice.

**1. Tables** in `packages/db/src/schema/<feature>.ts` — a new file, so parallel work never
conflicts. Two lines in `schema/index.ts`: one re-export, one spread. Then `pnpm db:generate
&& pnpm db:migrate`.

**2. Validation** in `packages/contracts/src/<feature>.ts`. Every layer agrees on these shapes.

**3. The package** — `packages/<feature>/package.json` with
`"exports": { ".": "./src/index.ts" }`, a tsconfig extending the base, and `typecheck` /
`test:unit` scripts. Run `pnpm install` twice.

**4. Queries** in `src/queries.ts`. Every one takes a `Scope` first:

```ts
export async function listProjects(scope: Scope, database: KeelDatabase = db()) {
  return database.select().from(project).where(visibleVia(project.id, scope));
}
```

`Scope` is branded, so forgetting tenancy is a **compile error**, not a data leak. That is the
substrate doing the remembering for you — in a year, an agent that has never read a line of
your documentation still cannot write an unscoped query.

**5. Server actions** in `src/actions.ts`. Every export from a `'use server'` file is a public
endpoint: never take a `userId` argument, never export helpers, validate everything.

**6. Tests** — `createTestDatabase()` gives you PGlite with your migrations applied. Real
constraints, real cascades, fast enough to run per test.

**7. Routes** in `apps/web/app/`. Thin: compose packages, don't put logic here.

**8. `pnpm verify`.**

## The substrate

Already built, tested, and yours to build on:

| | |
|---|---|
| **Auth** | Sign-up, sign-in, sessions — Better Auth, wired |
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
| **Storage & email** | Driver interfaces; email writes to disk in development |

## The memory layer

This is what makes run ten thousand survivable, and it is a tool you use — not a folder to
read once.

**[CLAUDE.md](./CLAUDE.md) is the entry point.** Short on purpose: context spent reading
instructions is context not spent on the problem.

**Rules load on demand.** `.claude/rules/*.md` carry `paths:` frontmatter, so schema rules
appear when an agent touches `packages/db/**` and stay out of the way otherwise. Adding a rule
is adding a file.

**The gate is the definition of done.** `pnpm verify` runs lint, typecheck, unit tests, the
lesson ledger and the build, wired to the Claude Code `Stop` hook. ~40 seconds with the browser
suite. Speed is a correctness property — a gate slow enough to annoy is a gate someone
disables.

**Lessons are how the repo stops repeating itself.** When your agent hits a real bug, it writes
`.orchestration/lessons/L-NNN.md` naming the mechanism that prevents recurrence:

```yaml
---
id: L-049
enforced_by: test          # test > lint > hook > gate > example > rule > doc
enforcement_ref: packages/projects/src/queries.test.ts
---
# A soft delete that the default query forgets is a resurrection bug
```

The gate **fails if that mechanism doesn't exist**. A lesson claiming enforcement it doesn't
have is worse than one claiming none, so the ledger cannot decay into good intentions. It
ships with worked examples from building the substrate; `pnpm eject:testbed` archives the ones
whose tests leave with the demo.

**Decisions are recorded where the next agent will look.** `.orchestration/journal/` holds why
things are the way they are — the reasoning that would otherwise evaporate with the context
window that had it.

## Running agents on it

**A task backlog** in `.orchestration/tasks/` — one file per unit of work, with acceptance
criteria and a status an agent claims.

**A loop protocol** in `.orchestration/loop-protocol.md`: pick a task, build it, record the
friction, close it. `pnpm loop:status` reconstructs where a crashed session stopped from task
frontmatter, locks and git history — derived state is regenerated, never stored, so it can
never describe someone else's machine.

**Circuit breakers** in `scripts/loop-guard.mjs` halt on identical repeated failures, too many
iterations on one task, or consecutive red runs.

**For parallel agents**, the structural work is done — schema is one file per feature so two
agents adding tables never touch the same file, and package boundaries fail the build rather
than merging badly. Territories and atomic claims are specified in `.orchestration/` and are
the least-proven part of this; see [Known gaps](#known-gaps).

## Everyday commands

```bash
pnpm dev              # all dev servers
pnpm verify           # the gate
pnpm verify unit      # iterate on one step
KEEL_E2E=1 pnpm verify   # include the browser suite
pnpm lint:fix         # run before verify
pnpm db:generate      # migration from schema changes
pnpm db:migrate
pnpm db:studio        # browse the database
pnpm admin:grant you@example.com
```

## Configuration

`pnpm db:up` writes a working `.env`. Beyond local:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres |
| `BETTER_AUTH_SECRET` | yes | ≥32 characters; rotating signs everyone out |
| `BETTER_AUTH_URL` | yes | Your public origin |
| `JOBS_SECRET` | to run jobs | The worker refuses everything without it |
| `BILLING_WEBHOOK_SECRET` | with a provider | See [docs/billing.md](./docs/billing.md) |

New variables go in `packages/contracts/src/env.ts` **and** `.env.example`. Reading
`process.env` anywhere else is a bug.

`pnpm verify` passes with no `.env` at all — environment, database and auth are lazily
initialised, so tests and builds never need secrets.

## Deploying

```bash
docker build -t your-app .
docker run -p 3000:3000 -e DATABASE_URL=… -e BETTER_AUTH_SECRET=… your-app
```

Migrations are a **release step**, never on boot — every replica would migrate at once during
a rolling deploy. Point a scheduler at `POST /api/jobs/run` every minute, or background work
silently never happens. Detail in [docs/deployment.md](./docs/deployment.md).

## Stack

Next.js 16 · React 19 · TypeScript 5.9 strict · pnpm + Turborepo · Postgres + Drizzle ·
Better Auth · Tailwind 4 · Biome · Vitest + PGlite · Playwright

Internal packages export TypeScript source directly — no build step between editing a package
and seeing the effect.

## Reference

| | |
|---|---|
| [CLAUDE.md](./CLAUDE.md) | Agent entry point — read first |
| [examples/notes](./examples/notes) | The vertical slice to copy |
| [docs/architecture.md](./docs/architecture.md) | Why the repo is shaped this way |
| [docs/api.md](./docs/api.md) · [docs/billing.md](./docs/billing.md) · [docs/deployment.md](./docs/deployment.md) | Platform surfaces |
| [.claude/rules/](./.claude/rules/) | Constraints your agent loads on demand |
| [.orchestration/](./.orchestration/) | Tasks, lessons, loop protocol |

## Known gaps

- **Parallel agents are designed, not proven.** The structural groundwork is in place;
  territories and atomic claims are specified but everything here was built one agent at a
  time. This is the least-tested part of the memory layer.
- **No payment provider is wired.** Plans, limits and webhook reconciliation are built and
  tested against a stub; connecting a real one is four functions and your keys.
- **Hosting is documented but untested** — the container is verified locally only.

## License

MIT
