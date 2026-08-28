# Keel

**An agent-native Next.js starter with a spec-driven build harness.**

Most starters optimise for the first hour. Keel optimises for the ten thousandth agent
turn — when the codebase is large and nobody remembers why anything is the way it is.

Its real product is not the scaffold. It is a **durable context layer** that makes a
freshly-spawned agent immediately competent anywhere in the codebase.

---

## Status

Every capability on [docs/platform-readiness.md](./docs/platform-readiness.md) is built and
exercised. The testbed application that drove them — sharing, organizations, background jobs,
a public API, webhooks, recurring work, an admin surface, full-text search, live updates,
billing and rate limiting — is in `testbed/`, in this workspace, behind the same gate.

**What that means concretely:** 440 unit tests, 100 browser tests, 25 workspace packages, and
47 recorded lessons, each naming an enforcement mechanism the gate checks exists.

**What is *not* done:** deploying to a hosting provider has never been tried — the container
is built, booted and verified locally, and everything beyond that is documented rather than
tested (see [docs/deployment.md](./docs/deployment.md)). No payment provider is wired; that
needs credentials belonging to whoever deploys it. And the predictions about a code graph,
territories and PRD ingestion were reviewed against the work rather than built —
[.orchestration/predictions-review.md](./.orchestration/predictions-review.md) has the
evidence, including why most of them were dropped.

## Why this exists

Agents fail on large codebases in specific ways: they burn context rediscovering what the
repo already knows, they let documentation drift until it misleads the next agent, and they
have no machine-checkable definition of "done", so they stop when they *feel* finished.

Keel treats these as one problem — the repository does not carry enough durable, verifiable
context — and fixes it structurally rather than with prompting.

## The one idea

**Agents are ephemeral. Context is durable.**

A subagent is a fresh context window that spawns, works, and evaporates. So you never keep an
agent alive — you keep the *repository* informative enough that a cold agent is productive in
seconds.

## The gate

```bash
pnpm verify
```

One command defines done: lint, typecheck, unit tests, the lesson ledger, build, and (opt-in)
a browser suite. It runs on the Claude Code `Stop` hook, so **an agent cannot finish a turn
while it is red**, and in CI, so the pipeline and your agent never disagree.

Warm, without the browser step, it is a few seconds — Turborepo only re-checks what a change
affected. With the full browser suite it is around a minute. That speed is a correctness
property: a gate slow enough to be annoying is a gate that gets disabled.

It also passes on a clean checkout with **no `.env` at all**. Environment, database and auth
are lazily initialised, so lint, typecheck, tests and build never need secrets — a property
the Dockerfile depends on and therefore tests on every image build.

## Stack

| | |
|---|---|
| **Framework** | Next.js 16, React 19, App Router |
| **Language** | TypeScript 5.9, strict, `noUncheckedIndexedAccess` |
| **Monorepo** | pnpm workspaces + Turborepo |
| **Database** | Postgres + Drizzle ORM |
| **Auth** | Better Auth |
| **Styling** | Tailwind CSS v4 |
| **Quality** | Biome, Vitest, Playwright, PGlite |

Every choice favours **code the agent can read and change** over convenience that hides
behaviour in a vendor dashboard.

TypeScript 5.9 rather than 7 is deliberate and was measured: TS7 could not resolve Next's
`typedRoutes` ambient namespace, and was *slower* on this repo. See
`.orchestration/lessons/L-013.md`.

## Layout

```
apps/web              Routes and composition. Deliberately thin.
packages/contracts    Zod schemas, shared types, the env contract.
packages/db           Drizzle schema, migrations, the db() handle.
packages/auth         Better Auth, sessions, API keys, platform roles.
packages/ui           Components, design tokens, hooks.
packages/jobs         Postgres-backed queue: transactional enqueue, backoff, dead letter.
packages/audit        Append-only activity log.
packages/billing      Plans, entitlements, provider-agnostic reconciliation.
packages/rate-limit   Shared counters — one atomic statement per request.
packages/realtime     Change log and cursors behind server-sent events.
packages/scheduling   Recurrence: pure date arithmetic, no database.
packages/search       The search boundary; features supply their own sources.
packages/storage      Blob driver interface.
packages/email        Transactional email. Writes to .keel/mail/ in development.
packages/runtime      The only sanctioned way a feature package reaches a Next API.
testbed/*             The todo application Keel is developed against.
examples/notes        The reference vertical slice. Copy this shape.
```

Package boundaries are enforced by module resolution, not lint rules — a package that does not
declare a dependency **fails to build** when it imports one. An agent cannot suppress that
with a comment.

Internal packages export TypeScript source directly. There is no build step between editing a
package and seeing the effect.

## Getting started

```bash
pnpm install
pnpm db:up        # starts Postgres in Docker, writes .env with generated secrets
pnpm db:migrate
pnpm dev
```

That is the whole setup. No account anywhere, no `.env` to hand-edit, no Postgres to install.
`pnpm db:down` stops it; `pnpm db:reset` wipes and recreates it.

Already have a database? Skip `db:up`, copy `.env.example` to `.env` and point `DATABASE_URL`
at it.

## For agents

Read [CLAUDE.md](./CLAUDE.md). It is deliberately short, because context spent on instructions
is context not spent on your problem. Cross-cutting constraints live in `.claude/rules/` with
`paths:` frontmatter so they load only when the relevant files are touched.

[AGENTS.md](./AGENTS.md) points other coding agents at the same guidance.

## How it was built

Keel is developed **demand-driven**. A todo application in `testbed/` is grown deliberately
until it demands the machinery Keel is designed around, and friction encountered building it
generates Keel's backlog. Nothing is built because a design document predicted it.

That method produced its sharpest result about the design itself. A self-updating code graph
was one of the founding ideas; ten consecutive cross-cutting features were checked against
"would a graph have helped here?" and the answer was consistently no. The failures that cost
real time were **semantic** — what a function does in its failure branch, what a provider
guarantees, what `0` collides with, what happens under concurrency — and structural analysis
does not see any of them. The one case that genuinely needed it was caught by Turbo's cycle
check, already in the gate, for free.

Each iteration is written up in `.orchestration/journal/`, including the mistakes. Forty-seven
lessons in `.orchestration/lessons/` each name an enforcement mechanism, and the gate fails if
a lesson claims one that does not exist — so the ledger cannot decay into folklore.

## Documentation

| | |
|---|---|
| [docs/platform-readiness.md](./docs/platform-readiness.md) | What "done" means, row by row |
| [docs/architecture.md](./docs/architecture.md) | Why the repo is shaped this way |
| [docs/api.md](./docs/api.md) | The public API, keys, webhooks, rate limits |
| [docs/billing.md](./docs/billing.md) | Plans, limits, wiring a payment provider |
| [docs/deployment.md](./docs/deployment.md) | Container and hosting, with what is untested named |

## License

MIT
