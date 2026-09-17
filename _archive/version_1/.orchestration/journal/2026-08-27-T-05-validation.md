# T-05 — tags, built cold by a validation agent

Protocol's every-third-feature validation, run as real work: a cold agent built the whole
tags feature in a worktree while T-04 proceeded on `main`. 15 PGlite tests, 3 browser
tests, cascade asserted three ways rather than commented.

## The merge experiment — the T-02 fix works

Both branches added tables, contracts and UI. Conflicts:

| File | Result |
|---|---|
| `packages/db/src/schema/index.ts` | **clean** |
| `packages/contracts/src/index.ts` | **clean** |
| `packages/db/drizzle/*` | **clean** — nothing generated on the branch |
| `apps/web/next.config.ts`, `package.json` | **clean** |
| `todo-list.tsx`, `page.tsx` | conflict — both features edit the same component |
| `L-017.md` | conflict — both allocated the same lesson id |

Run 1: eight shared files, two of three merges conflicted. Now: **every structural
conflict is gone**, and what remains is genuine feature overlap in one React component,
which no schema layout can fix. The spread protocol, the file-per-area split and
integrator-only migrations all held under a real parallel build.

## The finding that mattered most: I wrote a rule my own commits contradict

`.claude/rules/database.md` forbids `db:generate` on a feature branch. T-02, T-03 and T-04
each committed one — correctly, because that work was on `main` where generating is the
integrator's job. Nothing in those commits said so.

From a branch, the history reads as three precedents against one rule. The agent put it
exactly: *"The rule and the only two precedents disagree, which is why nobody had
noticed."* It followed the rule; the next one might reasonably not. [[L-020]]

**Precedent beats prose.** It is concrete, it is in the codebase, and it demonstrably
passed review.

## Two rules that combined into a blocker

Branches must not generate migrations; the test database is built *from* migrations. So a
branch's new tables were untestable — the cascade test central to T-05 was unreachable on
the branch that wrote the cascade. Neither rule is wrong; together they closed the door.

The agent built `applyPendingSchema()`: derive the delta from the newest committed snapshot
using the same drizzle-kit machinery, apply it to the test database only, write nothing to
`drizzle/`. It no-ops when integrated, and sits inside the L-016 snapshot so the cost is
paid once. [[L-019]]

Its second half — the *app* still could not run on a branch, and the default gate skips
e2e so nothing says so — became K-004, closed with `pnpm db:sync`.

## What the reference example was missing

The agent copied `examples/notes` for the routine 80% and named precisely what it had to
invent: anything many-to-many, get-or-create, transactions, batch loading, and **the
actions layer entirely** — the most security-critical file in the repo had no reference at
all, so the de-facto references were `testbed/*`, which no documentation points at.

And the one that matters most: **ownership of a referenced id**. A foreign key proves the
row exists, not that it is yours. Found in `createTodo` at T-03 and independently in
`attachTag` at T-05. Twice is a pattern, so it is now written where it gets copied from,
with the check spelled out.

`examples/notes` now ships `actions.ts`, and its hand-written `CREATE TABLE` — which the
agent flagged as the wrong thing to pattern-match — carries a boxed DO NOT COPY warning.
The README explained the deviation; the code is what gets copied.
