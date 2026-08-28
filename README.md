# Keel

**A Next.js platform starter built by using it, not by specifying it.**

Most starters give you a scaffold and a README. Keel was developed by building a real
multi-tenant application on top of itself, and every capability here exists because that
application demanded it — then stayed because it was exercised, not because it was planned.

When you're ready, `pnpm eject:testbed` removes that application and leaves the platform.

---

## What you get

| | |
|---|---|
| **Auth & sessions** | Better Auth, with API keys and platform-staff roles as separate axes |
| **Multi-tenancy** | `Scope` is branded — no signature accepts a user without a tenant |
| **Authorization** | Expressed once as composable SQL predicates, never re-derived per query |
| **Background jobs** | Postgres queue: transactional enqueue, backoff, dead letter, `SKIP LOCKED` |
| **Billing** | Plans and limits enforced in the query layer; webhooks idempotent and order-safe |
| **Rate limiting** | Shared across instances, sliding window, one atomic statement per request |
| **Public API** | Versioned, split-token keys, `402` for plan limits, `404` for another tenant |
| **Webhooks** | Two-stage dispatch, signed, replayable, SSRF-guarded |
| **Realtime** | SSE over a Postgres change log, re-authorized while open, degrades to polling |
| **Full-text search** | Generated `tsvector` columns — no index that can lag |
| **Scheduling** | Recurrence as pure functions; DST-correct in both hemispheres |
| **Audit log** | Recorded at the query layer, so every entry point is covered |
| **Admin surface** | Cross-tenant, gated in a layout, every staff action disclosed to the tenant |
| **Storage & email** | Driver interfaces; email writes to disk in development and never sends |

Plus the harness: a gate that blocks an agent from finishing a red turn, a lesson ledger the
gate refuses to let decay, and a demand-driven task loop with crash-safe resume.

## The gate

```bash
pnpm verify
```

Lint, typecheck, unit tests, the lesson ledger, build, and (opt-in) a browser suite. It runs
on the Claude Code `Stop` hook — **an agent cannot finish a turn while it is red** — and in CI,
so the pipeline and your agent never disagree.

**~40 seconds including 100 browser tests.** That speed is a correctness property: a gate slow
enough to be annoying is a gate that gets disabled. Twice during development the suite became
slow, and both times the cause was real — one was a leaked socket, the other two parallel
runners each sizing themselves to the machine.

It also passes on a clean checkout with **no `.env` at all**. Environment, database and auth
are lazily initialised, so nothing needs secrets — a property the Dockerfile depends on and
therefore re-tests on every image build.

## How it was built, and why that matters

A todo application lives in `testbed/`, in this workspace and behind this gate. It was grown
deliberately — sharing, then organizations, then jobs, an API, webhooks, billing — until it
demanded each capability above. **Friction building it generated the backlog.** Nothing was
built because a design document predicted it.

Twenty-six iterations are written up in `.orchestration/journal/`, including the mistakes: a
job queue that was green for four tasks without ever having run, a rate limit set so tight the
test suite tripped it against itself, a development database deleted by a `down -v` that
crossed compose files.

Forty-eight lessons in `.orchestration/lessons/` each name an enforcement mechanism, and
**the gate fails if a lesson claims one that doesn't exist** — so the ledger cannot rot into
folklore. Three of them turned out to be the same principle arrived at independently:

> When correctness depends on "nobody else did this at the same moment", it belongs in a
> constraint or a single statement — never in a check.

That's a unique index for recurring todos, a primary key on the provider's event id for
billing, and one `INSERT … ON CONFLICT` for rate limiting.

### The method's sharpest result was about the design itself

A self-updating code graph was one of the founding ideas. Ten consecutive cross-cutting
features were checked against *"would a graph have helped here?"* — each one the archetypal
case for it. The answer was consistently no:

| Task | What actually found the problem |
|---|---|
| Organizations across every package | `tsc` — 62 compile errors formed a complete worklist |
| A second auth mechanism | reading twelve lines of a fallback branch |
| Webhooks over the queue | running it — two driver incompatibilities |
| Live updates | knowing `NOTIFY` has no replay, and that `0` is a real cursor |
| Billing across features | **Turbo's cycle check** — already in the gate, free |

**The failures that cost real time were semantic, not structural.** A graph answers "what
references this?" Not one task was blocked on that question. Fourteen of twenty-one
predictions didn't survive contact with the work; the evidence is in
[`.orchestration/predictions-review.md`](./.orchestration/predictions-review.md), including
which ones survived and why.

## Ejecting

```bash
pnpm eject:testbed            # show what would be removed
pnpm eject:testbed --confirm  # do it
```

Removes the application — 5,400 lines across 6 feature packages, its schema, routes,
contracts and browser specs — and hands back a repo whose **gate still passes**: 236 unit
tests, 38 browser tests, and no application.

It is `git rm`, so a clean tree makes `git checkout .` the undo. Lessons whose enforcement
lived in the removed tests are archived rather than deleted — the reasoning about daylight
saving, idempotency and sentinel values is not about todo lists.

Verified by cloning this repo, ejecting, and running the gate. Not asserted.

## Getting started

```bash
pnpm install
pnpm db:up        # Postgres in Docker, writes .env with generated secrets
pnpm db:migrate
pnpm dev
```

No account anywhere, no `.env` to hand-edit, no Postgres to install.

## Stack

Next.js 16 · React 19 · TypeScript 5.9 strict · pnpm + Turborepo · Postgres + Drizzle ·
Better Auth · Tailwind 4 · Biome · Vitest + PGlite · Playwright

Package boundaries are enforced by **module resolution, not lint rules** — a package that
doesn't declare a dependency fails to build when it imports one. An agent cannot suppress that
with a comment.

TypeScript 5.9 rather than 7 is deliberate and measured: TS7 couldn't resolve Next's
`typedRoutes` ambient namespace, and was *slower* here. The claim that motivated the upgrade
went untested for a phase; see `.orchestration/lessons/L-013.md`.

## For agents

Read [CLAUDE.md](./CLAUDE.md) — deliberately short, because context spent on instructions is
context not spent on the problem. Cross-cutting constraints live in `.claude/rules/` with
`paths:` frontmatter, so they load only when the relevant files are touched.
[AGENTS.md](./AGENTS.md) points other coding agents at the same guidance.

## Honest limits

- **Hosting is untested.** The container is built, booted against real Postgres, migrated and
  verified serving — locally. Deploying needs an account that isn't the template's to hold, so
  [`docs/deployment.md`](./docs/deployment.md) presents Vercel as a checklist, not a guarantee.
- **No payment provider is wired.** The interface, reconciliation, idempotency and limits are
  built and tested against a stub; connecting a real one is four functions and your keys.
- **Multi-agent territories are designed, not proven.** Every iteration after the first ran as
  a single agent, so that's absence of evidence rather than evidence of absence.

## Documentation

| | |
|---|---|
| [docs/platform-readiness.md](./docs/platform-readiness.md) | What "done" means, row by row, with what proved it |
| [docs/architecture.md](./docs/architecture.md) | Why the repo is shaped this way |
| [docs/api.md](./docs/api.md) | Keys, webhooks, rate limits, error codes |
| [docs/billing.md](./docs/billing.md) | Plans, limits, wiring a provider |
| [docs/deployment.md](./docs/deployment.md) | Container and hosting, with the untested parts named |

## License

MIT
