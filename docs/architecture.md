# Architecture

The design this repository is being built toward. Phase 0 is implemented; phases 1–6
are specified here and not yet built.

A visually formatted version of this document, with diagrams, is published as a
[design brief](https://claude.ai/code/artifact/6bdc3acf-b1b4-4c8c-9b8f-9a05fd70f9fd).

---

## 1. What this is

Three layers, and conflating them is why "boilerplate" is the wrong word:

| Layer | Term |
|---|---|
| Next.js, Turborepo, Drizzle, Better Auth, the gate | **starter template** — this part genuinely is boilerplate |
| CLAUDE.md, rules, skills, subagents, hooks, MCP | **agent harness** — packageable as a portable plugin |
| PRD → backlog → autonomous build | **spec-driven development** |

The harness should eventually ship as a separate plugin so it travels to projects that
are not this one. Welding it to the scaffold traps it in one stack.

## 2. The mental model

**Agent definitions persist. Agent instances do not.**

A subagent is a fresh context window that spawns, works, returns, and evaporates. So
"one agent per territory" cannot mean a resident agent. It means a durable definition —
`.claude/agents/billing.md` — plus a repository informative enough that a cold instance
spawned from it is competent within seconds.

The territory's memory lives in charters, the graph, and the journal. Not in a process.

## 3. Decisions

| Decision | Choice |
|---|---|
| Repo shape | Monorepo, five packages, extract more only when a real boundary appears |
| Enforcement | Hard block on the `Stop` hook and in CI |
| Orchestration | Full — ledger, territories, worktrees, blast-radius checks |
| Data | Postgres, Drizzle, Better Auth |
| Requirements input | Freeform markdown PRD |
| Build autonomy | Runs to backlog completion without epic checkpoints |
| Reference patterns | Two worked vertical slices: CRUD, and async/background |

## 4. The gate

`pnpm verify` — lint, typecheck, unit, build, opt-in e2e smoke. Cheapest step first.

Currently ~2s warm, ~7s cold. Turborepo runs only affected packages. **This speed is
load-bearing**: the gate fires on every agent turn, and a slow gate gets disabled.

Phases 1–2 add `graph validate` (boundary violations, dependency cycles, orphans) and
`docs validate` (signature drift, dead links, uncovered requirements) to the pipeline.

## 5. Documentation, in three trust tiers

Self-documenting repos fail because every doc is treated identically.

- **Derived** — route map, export surface, schema, env inventory, dependency graph.
  Script-generated, regenerated every commit, never agent-edited. Correct by construction.
- **Curated** — charters, ADRs, glossary, feature specs. Human and agent authored, but
  every claim links to a derived node, so staleness is mechanically detectable.
- **Ephemeral** — journals, plans, scratch. Append-only, pruned, untrusted. Git is history.

### The staleness mechanism

Curated docs declare what they cover, by stable node ID:

```yaml
---
id: doc.billing.charter
type: charter
covers:
  - pkg:billing
  - sym:packages/billing/src/subscribe.ts#createSubscription
  - table:subscriptions
sig: sha256:a3f9c1…
---
```

`sig` hashes the **public signatures** of covered nodes, not file bodies. Renaming a
local variable changes nothing; changing a function's parameters, a column, or a return
type fails `docs validate` and names the drifted node.

Hashing bodies would mark half the docs stale on every commit, and the gate would be
switched off within a week. This distinction is what makes the system survivable.

The principle throughout: **detect drift and block, do not auto-generate prose.**

## 6. The graph

Not a documentation feature. Its jobs are context economy and collision avoidance.

Node IDs are stable and greppable:

```
pkg:billing
mod:packages/billing/src/subscribe.ts
sym:packages/billing/src/subscribe.ts#createSubscription
route:/(dash)/billing        table:subscriptions      col:subscriptions.status
env:STRIPE_SECRET_KEY        feat:billing.subscriptions
req:REQ-014                  adr:0007
```

Tools exposed over MCP — six, not twenty, because tool count degrades selection:

| Tool | Answers |
|---|---|
| `graph_context(target)` | The minimal file set needed to work on X. The largest context saving in the design. |
| `graph_impact(paths)` | Downstream nodes, affected tests and packages. |
| `graph_disjoint(territories)` | Do these agents' blast radii overlap? Precondition for safe fan-out. |
| `graph_query(predicate)` | Escape hatch. |
| `docs_get` / `docs_stale` | Retrieval and drift reporting. |
| `ledger_list` / `ledger_claim` | Backlog read and atomic claim. |

### Requirements are nodes

The PRD is not a dead file. Each requirement links to the code satisfying it, which
turns archaeology into queries: which requirements have no implementation, which
requirement does this function serve, what breaks if REQ-014 changes, what is untested
against acceptance criteria.

This also gives the autonomous loop a real termination condition — **done is every
requirement node having satisfied coverage**, not an agent deciding it feels finished.

## 7. Territories and handoff

```yaml
# .orchestration/territories.yaml
billing:
  owns:      [pkg:billing, "route:/billing/**"]
  may_edit:  [pkg:contracts]        # triggers contract-change protocol
  read_only: [pkg:db, pkg:ui]
```

A `PreToolUse` hook checks every write against the acting agent's territory — killing
cross-territory conflicts *before they exist* rather than at merge, when they have become
semantic rather than textual.

Handoff is **ledger-mediated, never agent-to-agent**. Direct messaging is fragile, loses
context, and dies with either side. Filing a task is durable and inspectable.

| Situation | Protocol |
|---|---|
| Trivial, additive, no interface change | Temporary territory extension, flagged in the diff for review |
| Real work elsewhere | File a task tagged to that territory, declare the interface needed, keep working |
| Contract change | Serialised — widest blast radius, goes first, everything rebases |

Tasks are claimed with `mkdir .orchestration/locks/T-0042` — atomic test-and-set on any
POSIX filesystem, and a losing agent gets a clean `EEXIST` instead of a race.

### On parallelism

The mechanism scales far — subagents cost the parent nothing until called. But
throughput is not the binding constraint; **coherence is**. Fan-out width should track
boundary maturity, not ambition: two to four agents while territories are still forming,
more as charters stabilise and `graph_disjoint` shows genuinely clean separation. The
system must degrade gracefully to sequential.

## 8. Initiation

`/init-project` ingests a freeform markdown PRD and produces a domain model and proposed
schema, a feature and task decomposition, a territory map, and generated per-territory
agent definitions, charter stubs, and ADRs for the calls made during decomposition.

**It produces a plan, not a build.** Schema, territory split, and backlog get reviewed
before anything is written — these are cheap to change now and brutal after 200 tasks.
Since the build itself runs unsupervised, this checkpoint carries the weight that
per-epic reviews would otherwise carry.

## 9. Making full autonomy survivable

**Autonomy is safe in proportion to how much was decided before the loop started.** So
the architecture is frozen at the initiation checkpoint: during an autonomous run,
`packages/contracts` and the schema are locked. An agent needing to change them stops and
files a blocker. This converts the unsupervised phase from *design plus execution* into
*execution only* — and design is where unsupervised agents do real damage.

Circuit breakers, each halting the run with a full-context report:

| Trip | Threshold | Catches |
|---|---|---|
| Identical verify failure | 3× | thrashing |
| Iterations on one task | 8 | mis-scoped task |
| Requirement coverage flat | 5 iterations | motion without progress |
| Contract or schema change | any | architectural drift |
| New dependency cycle | any | structural decay |
| Duplicate-shape symbol | any | two agents inventing the same helper |
| Coverage or green tests fall | any | regression laundered as progress |
| Global budget | configurable | runaway spend |

Three of these are only detectable because the graph exists. The goal of unsupervised
operation is not to remove you — it is to **batch** you: blockers accumulate with full
context so you triage a stack at once instead of being interrupted per task.

## 10. Prior art, and what not to build

This design converges with where the field independently landed. Spec-driven development
emerged through 2025 as the answer to agents producing plausible code that drifts from
intent; GitHub Spec Kit, AWS Kiro, BMAD-METHOD, OpenSpec and Agent OS all ship a variant.
Nothing in sections 2–9 is eccentric.

But local-first code graphs are now a mature, crowded category — SQLite-backed,
MCP-served, incremental, with blast-radius analysis built in. **Adopt the engine; build
only the layer above it.**

| Component | Verdict |
|---|---|
| Code graph engine | **adopt** — pilot `code-review-graph` (MIT, SQLite, blast-radius focused) |
| Search interception | **adopt the pattern** — a `PreToolUse` hook that consults the graph *before* every file-search call, popularised by Graphify |
| Semantic edits | **evaluate** — Serena, complementary: the graph says what is affected, the language server changes it safely |
| PRD → task graph | **evaluate** — `claude-task-master` or Spec Kit, if either can emit our task schema |
| Territory guard + ledger | **build** — no surveyed tool does write-time territory enforcement |
| Doc staleness gate | **build** — signature-hash validation against graph nodes |
| Requirement traceability | **build** — thin layer over an adopted engine |

Supporting MCP servers worth wiring in: **Context7** (live library docs — the direct fix
for hallucinated APIs during an unsupervised run), **Playwright** (agents verifying their
own work), **GitHub** (the integrator role needs PR automation), **Postgres** (real
schema state rather than inferred).

## 11. Roadmap

| Phase | Deliverable | Status |
|---|---|---|
| 0 | Foundation — monorepo, app, data, auth, the gate | **done** |
| 1 | Graph layer — adopt engine, build validation on top | designed |
| 2 | Doc system — three tiers, signature staleness | designed |
| 3 | Harness plugin — skills, subagents, hooks, MCP, portable | designed |
| 4 | Orchestration — territories, ledger, worktrees, integrator | designed |
| 5 | Initiation — PRD → schema → backlog → agent definitions | designed |
| 6 | Autonomous loop — breakers, drift detection, instrumentation | designed |

Sequenced so the machinery stays optional until it earns its place. Phase 0 is
independently useful; if it were not, the harness would have become the project.
