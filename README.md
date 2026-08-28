# Keel

**A Next.js starter for building large web platforms with coding agents.**

Not "AI-friendly" in the sense of having good docs. Keel is built around a single claim about
how agents actually fail on large codebases, and every mechanism here follows from it:

> **Agents are ephemeral. Context is durable.**

A subagent is a fresh context window that spawns, works, and evaporates. Nothing persists in
it. So you never try to keep an agent informed — you make the **repository** informative
enough that a cold agent is productive in seconds, and you make the important constraints
impossible to violate rather than merely documented.

Keel is that context layer, plus a platform substantial enough to prove it works at scale.

---

## The four failure modes

Agents fail on large codebases in ways that are specific and addressable:

| Failure | What Keel does about it |
|---|---|
| **Burning context rediscovering the repo** | A 132-line `CLAUDE.md`, and path-scoped rules that load only when the matching files are touched |
| **No machine-checkable "done"** | `pnpm verify` on the `Stop` hook — an agent *cannot finish a turn* while it is red |
| **Repeating mistakes across sessions** | A lesson ledger the gate refuses to let decay |
| **Documentation drifting into lies** | Conventions enforced by code, not prose — and where that fails, it is recorded as a lesson |

### The gate is the load-bearing piece

```bash
pnpm verify   # lint · typecheck · unit · lessons · build · (opt-in) browser
```

It runs on the Claude Code `Stop` hook via `.claude/settings.json`, exiting non-zero to block.
An agent that breaks something cannot end its turn and declare success — the definition of
done is executable, not a judgement call.

**~40 seconds including 100 browser tests.** Speed is a correctness property here: a gate slow
enough to be annoying is a gate someone disables. Twice during development the suite got slow,
and both times the cause was real — a leaked socket, then two parallel runners each sizing
themselves to the machine.

### The lesson ledger, and why it can't rot

Forty-eight lessons in `.orchestration/lessons/`. Each one names an **enforcement mechanism**,
and the gate fails if a lesson claims one that doesn't exist:

```
✗ L-035: enforcement_ref 'testbed/todos/src/recurrence.test.ts' does not exist.
  A lesson claiming enforcement that is absent is worse than one claiming none.
```

That check is what separates a ledger from a folder of good intentions. A lesson is promoted
along a ladder — test > lint > hook > gate > example > rule > doc — so the strongest available
mechanism is the one that holds it, and "we should remember to…" is the last resort rather
than the first.

It works. Three separate lessons converged independently on the same principle:

> When correctness depends on "nobody else did this at the same moment", it belongs in a
> constraint or a single statement — never in a check.

A unique index for recurring todos, a primary key on the provider's event id for billing, one
`INSERT … ON CONFLICT` for rate limiting.

### Boundaries an agent cannot talk its way past

Package boundaries are enforced by **module resolution, not lint rules**. A package that
doesn't declare a dependency fails to build when it imports one — there is no comment that
suppresses it, no `eslint-disable` to reach for. Structural safety beats procedural
politeness, which matters more as the codebase grows past what fits in one context window.

## How it was built — and why that's the interesting part

Keel was not specified and then implemented. A real multi-tenant application was built **on**
it, in the same workspace and behind the same gate, and grown deliberately — sharing, then
organizations, jobs, a public API, webhooks, billing — until each capability was genuinely
demanded. **Friction building the app generated the platform's backlog.** Nothing was built
because a design document predicted it.

Twenty-six iterations are written up in `.orchestration/journal/`, mistakes included: a job
queue that was green for four tasks without ever having run, a rate limit so tight the test
suite tripped it against itself, a development database deleted by a `down -v` that crossed
compose files.

### The method's sharpest result was about the design itself

A self-updating code graph was one of the founding requirements — the durable map an agent
would consult instead of re-reading the repo. So it was tested honestly: ten consecutive
cross-cutting features, each the archetypal case for one, checked against *"would a graph have
helped here?"*

| Feature | What actually found the problem |
|---|---|
| Organizations across every package | `tsc` — 62 compile errors formed a complete worklist |
| A second auth mechanism | reading twelve lines of a fallback branch |
| Webhooks over the queue | running it — two driver incompatibilities |
| Live updates | knowing `NOTIFY` has no replay, and that `0` is a real cursor |
| Billing across features | **Turbo's cycle check** — already in the gate, free |

**The failures that cost real time were semantic, not structural.** A graph answers "what
references this?" Not one of these was blocked on that question.

This is not an argument against the goal — the goal was durable context an agent can trust,
and that goal was met. It is a finding about *which mechanism delivers it*: a strict type
system, a fast gate and an enforced lesson ledger occupied the space a graph was predicted to
fill. Fourteen of twenty-one architectural predictions did not survive contact with the work;
the evidence for each is in
[`.orchestration/predictions-review.md`](./.orchestration/predictions-review.md).

That is the method paying for itself. The alternative was building all twenty-one first and
finding out afterwards.

## The loop

Keel is designed to be built *by* an agent running unattended, and it was:

- **`.orchestration/loop-protocol.md`** — one iteration: pick a task, build it, record the
  friction, close it.
- **Crash-safe resume** — `pnpm loop:status` reconstructs where the last session stopped from
  task frontmatter, locks and git history. Derived state is regenerated, never stored, so it
  cannot describe someone else's machine.
- **Circuit breakers** — `scripts/loop-guard.mjs` halts on identical repeated failures, too
  many iterations on one task, or consecutive red runs.
- **Done is a capability list, not a task count** —
  [`docs/platform-readiness.md`](./docs/platform-readiness.md), where every row names what
  proved it.

## What the method produced

The platform below is **evidence, not the pitch** — it exists because building the test
application demanded it, and each row was exercised rather than asserted:

Auth and sessions · API keys · platform-staff roles as a separate axis from tenant roles ·
multi-tenancy with a branded `Scope` no signature can bypass · composable authorization
predicates · a Postgres job queue · transactional email · blob storage · audit logging ·
plans and limits enforced in the query layer · idempotent, order-safe billing webhooks ·
cross-instance rate limiting · a versioned public API · signed outbound webhooks · realtime
over SSE · full-text search · DST-correct recurrence · a cross-tenant admin surface

When you want it gone:

```bash
pnpm eject:testbed --confirm
```

Removes the application — 5,400 lines across 6 feature packages, its schema, routes, contracts
and specs — and leaves a repo whose **gate still passes**: 236 unit tests, 38 browser tests,
and no application. Verified by cloning this repo, ejecting, and running the gate. Lessons
whose enforcement lived in the removed tests are archived rather than deleted; the reasoning
about daylight saving and idempotency is not about todo lists.

## Getting started

```bash
pnpm install
pnpm db:up        # Postgres in Docker, writes .env with generated secrets
pnpm db:migrate
pnpm dev
```

No account anywhere, no `.env` to hand-edit, no Postgres to install. `pnpm verify` passes on a
clean checkout with **no `.env` at all** — environment, database and auth are lazily
initialised, a property the Dockerfile depends on and re-tests on every image build.

**Then read [CLAUDE.md](./CLAUDE.md).** It is the entry point for your agent and deliberately
short, because context spent on instructions is context not spent on the problem.
[AGENTS.md](./AGENTS.md) points other coding agents at the same guidance.

## Stack

Next.js 16 · React 19 · TypeScript 5.9 strict · pnpm + Turborepo · Postgres + Drizzle ·
Better Auth · Tailwind 4 · Biome · Vitest + PGlite · Playwright

TypeScript 5.9 rather than 7 is deliberate and measured: TS7 couldn't resolve Next's
`typedRoutes` ambient namespace, and was *slower* here. The claim that motivated the upgrade
went untested for a phase — that is lesson `L-013`.

## Honest limits

- **Multiple simultaneous agents is designed, not proven.** Territories and a task ledger are
  specified; every iteration after the first ran as a single agent. That is absence of
  evidence, not evidence of absence — and it is the one founding goal still owed a real test.
- **Hosting is untested.** The container builds, boots against real Postgres, migrates and
  serves — locally. Deploying needs an account that isn't the template's to hold, so
  [`docs/deployment.md`](./docs/deployment.md) presents Vercel as a checklist, not a guarantee.
- **No payment provider is wired.** The interface, reconciliation and limits are built and
  tested against a stub; connecting a real one is four functions and your keys.

## Documentation

| | |
|---|---|
| [CLAUDE.md](./CLAUDE.md) | The agent entry point |
| [docs/platform-readiness.md](./docs/platform-readiness.md) | What "done" means, row by row |
| [docs/architecture.md](./docs/architecture.md) | Why the repo is shaped this way |
| [.orchestration/loop-protocol.md](./.orchestration/loop-protocol.md) | How one build iteration works |
| [.orchestration/predictions-review.md](./.orchestration/predictions-review.md) | Which architectural bets survived, with evidence |
| [docs/api.md](./docs/api.md) · [docs/billing.md](./docs/billing.md) · [docs/deployment.md](./docs/deployment.md) | The platform surfaces |

## License

MIT
