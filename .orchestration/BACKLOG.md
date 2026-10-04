# Backlog

> **First wave complete.** T-001, T-002, T-003, T-007, T-009, T-010 were implemented
> concurrently by six Sonnet agents in one working tree, partitioned by the `owns:` lists below.
> The partition held — no agent wrote outside its lane. `npm test` is 62/62 and `npm run check`
> is clean.
>
> Two things the wave produced that were not in any task. **T-003 and T-010 converged
> independently on the same structural finding**: the hierarchical root reads all N values, so
> the "no participant sees more than fanout" property fails at the top and hierarchical can never
> beat solo on generation time. Only `partitioned` can win on time, and only because its merge is
> ordinary code rather than an agent — which undercuts the "hierarchical is the interesting
> middle" framing in the README (see T-012). And **the harness lost updates on its own output
> path**: `runs/trial-<i>.txt` was shared by every concurrent run, found because six agents were
> working at once. T-007 fixed it unprompted; T-013 records what is left to assert.
>
> **Second wave complete.** T-004, T-005, T-008, T-013 ran concurrently, again partitioned by
> `owns:` and again with no agent writing outside its lane. `npm test` is 109/109, `npm run check`
> is clean, and all four strategies behave as the README claims.
>
> **The project's central question is answered.** `--crossover` at N=100 on Haiku: `partitioned`
> beats one agent at work >= 0; `hierarchical` at work >= 7 tokens per agent for API calls and
> >= 33 for Claude Code agents (the gap is spin-up); `shared-lock` never, because its deficit is
> N rounds of latency and more work never closes a constant. The cost claim held at all 20 sweep
> points across N from 2 to 1000, two kinds and two models — no topology ever cost less than solo.
>
> Three things the wave surfaced. T-008 found a **second** lock bug beyond the one in the README:
> release was unconditional, so a holder slower than `STALE_MS` would wake, write over the new
> holder's data, and delete the new holder's lock on the way out. Its conclusion after fixing it is
> worth keeping — the remaining windows cannot be closed, so the strategy is mitigated rather than
> sound, and `append` (where contention cannot arise) is still the real answer. T-005 added a
> `--mock` transport, so the agent pipeline is now testable without credentials even though the
> headline numbers still cannot be measured here. T-013 verified the group-file isolation was
> already safe and was explicit that its pid-reuse conclusion rests on reading the cleanup code,
> because a test cannot force a child's pid.
>
> One task-level conflict, surfaced not hidden: T-008's acceptance required a slow-holder run to
> exit 0, which is impossible if a worker that loses its lock simply dies. It added a bounded retry
> and said so. The task note it departed from is the one that needs revising.

> One dispatcher error worth recording: the T-003 brief told it to fix per-token latency, which
> contradicted its own task note deferring that to T-004. The agent surfaced the conflict rather
> than silently choosing. T-004 has been re-scoped.


Groomed 2026-10-04 from README.md, src/, and package.json. Tasks live in `tasks/T-0NN.md`; each
declares the files it may create or modify under `owns:`, and two tasks that need the same file
are serialised with `depends_on` rather than run together.

| id | title | size | depends_on | first owned path |
|---|---|---|---|---|
| T-001 | Add a test gate to package.json | S | — | package.json |
| T-002 | Test and harden the verify oracle | M | — | test/verify.test.mjs |
| T-003 | Pin the cost model with tests and fix its modelling errors | M | — | test/cost-model.test.mjs |
| T-004 | Model per-token latency and find the crossover | M | T-003 | src/cost-model.mjs |
| T-005 | Make agents.mjs runnable offline and fix its answer parsing | M | T-001 | src/agents.mjs |
| T-006 | Implement solo and hierarchical topologies in agents.mjs | M | T-005 | src/agents.mjs |
| T-007 | Add failure injection and non-uniform workers to the process harness | M | — | src/worker.mjs |
| T-008 | Make lockfile release ownership-checked and staleness configurable | M | T-007 | src/strategies/lockfile.mjs |
| T-009 | Guard append compaction and pin its atomicity claims | S | — | src/strategies/append.mjs |
| T-010 | Add a hierarchical process strategy | M | — | src/strategies/hierarchical.mjs |
| T-011 | Single source of truth for model pricing | S | T-004, T-006 | src/pricing.mjs |
| T-012 | Regenerate the README from the code and add a README check | M | T-002, T-007, T-008, T-009, T-010, T-011 | README.md |

## First wave

Runnable now, concurrently, in one working tree: **T-001, T-002, T-003, T-007, T-009, T-010**.

Their owned paths are pairwise disjoint: `package.json` + `test/smoke.test.mjs` (T-001);
`src/verify.mjs` + `test/verify.test.mjs` (T-002); `src/cost-model.mjs` + `test/cost-model.test.mjs`
(T-003); `src/worker.mjs` + `src/run.mjs` + `test/run.test.mjs` (T-007); `src/strategies/append.mjs`
+ `test/append.test.mjs` (T-009); `src/strategies/hierarchical.mjs` + `test/hierarchical.test.mjs`
(T-010) — no file appears in two lists, so no agent can overwrite another's edit.

## Later waves

- Wave 2 (after their single parent lands): T-004 (after T-003), T-005 (after T-001), T-008 (after T-007).
- Wave 3: T-006 (after T-005).
- Wave 4: T-011 (after T-004 and T-006 — the ends of the two chains that touch `src/cost-model.mjs` and `src/agents.mjs`).
- Wave 5: T-012, alone; it quotes numbers produced by everything else.

## Ownership chains (why the serialisation exists)

- `package.json`: T-001 → T-005
- `src/cost-model.mjs`: T-003 → T-004 → T-011
- `src/agents.mjs`: T-005 → T-006 → T-011
- `src/run.mjs`, `src/worker.mjs`: T-007 only (T-008 depends on its flags but does not edit them)
- `README.md`: T-012 only
