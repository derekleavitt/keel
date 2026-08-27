# Keel

**An agent-native Next.js starter with a spec-driven build harness.**

Most starters optimise for the first hour. Keel optimises for the ten thousandth agent
turn — when the codebase is large, several agents are working at once, and nobody
remembers why anything is the way it is.

Its real product is not the scaffold. It is a **durable context layer** that makes any
freshly-spawned agent immediately competent anywhere in the codebase.

> **Status: Phase 0 of 6.** The foundation is built and green. The graph layer, doc
> staleness gate, territories, task ledger and autonomous build loop are designed in
> detail but not yet implemented. See [docs/architecture.md](./docs/architecture.md).

---

## Why this exists

Agents fail on large codebases in four specific ways:

1. They burn context rediscovering what the repo already knows.
2. They let documentation drift until it actively misleads the next agent.
3. They collide with each other when run in parallel.
4. They have no machine-checkable definition of "done", so they stop when they *feel*
   finished.

Keel treats all four as one problem — the repository does not carry enough durable,
verifiable context — and fixes it structurally rather than with prompting.

## The one idea

**Agents are ephemeral. Context is durable.**

A subagent is a fresh context window that spawns, works, and evaporates. Nothing
persists in it. So you never keep an agent alive — you keep the *repository* informative
enough that a cold agent is productive in seconds.

Everything here follows from that.

## The gate

```bash
pnpm verify
```

One command defines done: lint, typecheck, unit tests, build, and (opt-in) a browser
smoke test. It runs on the Claude Code `Stop` hook, so **an agent cannot finish a turn
while it is red**, and in CI, so the pipeline and your agent never disagree.

It runs in **~2 seconds warm**, because Turborepo only re-checks what the change
actually affected. That speed is a correctness property: a gate slow enough to be
annoying is a gate that gets disabled.

## Stack

| | |
|---|---|
| **Framework** | Next.js 16, React 19, App Router |
| **Language** | TypeScript 7, strict, `noUncheckedIndexedAccess` |
| **Monorepo** | pnpm workspaces + Turborepo |
| **Database** | Postgres + Drizzle ORM |
| **Auth** | Better Auth |
| **Styling** | Tailwind CSS v4 |
| **Quality** | Biome, Vitest, Playwright |

Every choice favours **code the agent can read and change** over convenience that hides
behaviour in a vendor dashboard.

## Layout

```
apps/web            Routes and composition. Deliberately thin.
packages/contracts  Zod schemas, shared types, the env contract.
packages/db         Drizzle schema, migrations, the db() handle.
packages/auth       Better Auth config. The only package importing better-auth.
packages/ui         Components and design tokens.
```

Package boundaries are enforced by module resolution, not by lint rules — if a package
does not declare a dependency, importing it **fails to build**. An agent cannot suppress
that with a comment. This is what makes parallel agents structurally safe rather than
merely well-behaved.

Internal packages export TypeScript source directly. There is no build step between
editing a package and seeing the effect.

## Getting started

```bash
pnpm install
pnpm db:up        # starts Postgres in Docker, writes .env with a generated secret
pnpm db:migrate
pnpm dev
```

That is the whole setup. No account anywhere, no `.env` to hand-edit, no Postgres to
install. `pnpm db:down` stops it; `pnpm db:reset` wipes and recreates it.

Already have a database? Skip `db:up`, copy `.env.example` to `.env` and point
`DATABASE_URL` at it.

`pnpm verify` passes on a clean checkout with **no `.env` at all** — environment,
database and auth are all lazily initialised, so typecheck, lint, tests and build never
require secrets. You only need a database once you want the app to actually run.

## For agents

Read [CLAUDE.md](./CLAUDE.md). It is deliberately short — under 200 lines, per
Anthropic's guidance — because context spent on instructions is context not spent on
your problem. Cross-cutting constraints live in `.claude/rules/` with `paths:`
frontmatter so they load only when the relevant files are touched.

[AGENTS.md](./AGENTS.md) points other coding agents at the same guidance.

## Roadmap

| Phase | | Status |
|---|---|---|
| 0 | Foundation — monorepo, app, data, auth, the gate | **done** |
| 1 | Graph layer — adopt an engine, build boundary and cycle validation on top | designed |
| 2 | Doc system — three trust tiers, signature-hash staleness detection | designed |
| 3 | Harness plugin — skills, subagents, hooks, MCP wiring, portable | designed |
| 4 | Orchestration — territories, task ledger, worktree flow, integrator | designed |
| 5 | Initiation — PRD → domain model → backlog → agent definitions | designed |
| 6 | Autonomous loop — circuit breakers, drift detection, instrumentation | designed |

Phases 1–6 are specified in [docs/architecture.md](./docs/architecture.md), including
the deliberate decision to **adopt** an existing code-graph engine rather than build one.

## License

MIT
