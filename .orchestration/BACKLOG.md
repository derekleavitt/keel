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

---

## Groomed 2026-10-04, second grooming: what to do now that the original backlog is exhausted

Four options were on the table: more implementation, reducing what the model takes on faith,
making the eventual real run cheap and honest, or stopping. **The recommendation is the third,
with one correction from the second, and then the fourth.** The argument, from reading the code:

**The project's output is a comparison with one side missing.** Every agent number is a
projection. The harness that would supply the other side (`src/agents.mjs`) reports one
`elapsed` and two token totals per run — enough to say the model was wrong, not enough to say
*which* constant was wrong. `LATENCY` and `OUTPUT_TOKENS_PER_SECOND` are the intercept and
slope of a line through (output tokens, ms) points, and the harness keeps no points. The first
real run would therefore settle nothing. Making it settle something costs two medium tasks
(per-call records; a reader that fits them against the constants) and is the cheapest way to
convert the backlog from argument to data.

**One assumption can be pinned without credentials, and it is structural, not numeric.** The
model assumes unlimited concurrency; the harness defaults to `--concurrency 20`; the API has
rate limits of that order. By the model's own arithmetic, `partitioned` at N=100 with 20 calls
in flight is 5 waves × 1.525s = 7.6s against `solo`'s 4.0s — it loses at zero work and needs
≥ 50 in flight to win. The README's headline `partitioned: work >= 0` is true at infinite
concurrency and false at the harness's default. That is not a wrong constant; it is a parameter
the model lacks, and the first real run would "disprove" the model for a reason that is the
harness's configuration. T-014 adds the parameter with default `Infinity` so no documented
number moves until T-019 decides what to say.

**Why not (b) more broadly.** "Pin token counts against a real tokenizer" is weaker than it
sounds: there is no offline tokenizer for current Claude models, `count_tokens` needs the same
credential the run does, and no Claude Code system prompt is available here to measure the
15,000. What *can* be said offline is that the harness's actual API prompt is ~45 tokens by a
chars/4 count against an assumed `OVERHEAD.api = 200` — which, if it holds, makes every API
dollar figure 3–4× too high. That is a prediction for the compare tool (T-017) to confirm, not a
constant to edit by argument.

**Why not (a).** A recursive process strategy, thin direct coverage of `naive`/`lockfile`,
large-payload append atomicity: each is real and none changes an answer. The agents harness
already shows multi-level merging and measures it; `naive` is pinned by `test/run.test.mjs`;
the append header already states the bound it relies on and that nothing tests beyond it.
Hill-climbing. The one item from that list worth doing is `runs/` debris, because it is
measurable (10 files per `node --test test/run.test.mjs`) and the fix is one test file (T-018).

**Why not (d) yet.** The conclusions — never a cost saving; partitioned wins time only by moving
the work to code; hierarchical cannot beat solo's generation floor; shared-lock never — are
robust to the constants. But the headline table is contingent on an assumption the measuring
tool contradicts by default, and the README overstates what the harness measures (see below).
Fix those, land the instruments, and *then* stop: after T-019 the honest next step is a key,
not a task. This backlog deliberately does not groom anything past that point.

**Not groomed, on purpose:** a `claude -p` transport to measure the `claude-code` column
(nothing here can measure it; a real API run should come first), resumability for half-finished
runs (the README's API runs cost cents; see T-016 notes), and any change to a model constant.

### What the existing backlog and README get wrong

- The README's "Running real agents" section says the harness reports "the three things the
  cost model only projects". It makes API calls only. The `claude-code` rows — half the table,
  and the "what you mean by agent dominates" finding — have no instrument in this repository.
- The README's real-run command fails from a fresh checkout before it reaches the credential
  check: `node_modules/` is absent and `@anthropic-ai/sdk` is not installed.
- The crossover table omits the concurrency condition it depends on (above).
- The "central question is answered" note above this section is true at unlimited concurrency
  and should be read with that qualifier.
- Task files `T-006.md`, `T-011.md` and `T-012.md` still say `status: open`; the work is done
  and committed. Not modified here (the brief forbids it); worth a one-line fix by the owner.
- `test/run.test.mjs` leaves 10 files in `runs/` per run; `runs/` held 260 at grooming time.

### Tasks

| id | title | size | depends_on | first owned path |
|---|---|---|---|---|
| T-014 | Make concurrency a parameter of the cost model and export its assumptions | M | — | src/cost-model.mjs |
| T-015 | Record every call the agent harness makes, with timing | M | — | src/agents.mjs |
| T-016 | Dry-run projection and a spend ceiling for the agent harness | M | T-014, T-015 | src/agents.mjs |
| T-017 | Compare a recorded run against the cost model's assumptions | M | T-014, T-015 | src/compare.mjs |
| T-018 | Stop the test suite leaving trial files in runs/ | S | — | test/run.test.mjs |
| T-019 | README: concurrency, the measurement instruments, and what the harness cannot measure | M | T-014, T-015, T-016, T-017, T-018 | README.md |

### First wave

Runnable now, concurrently, in one working tree: **T-014, T-015, T-018**.

Their owned paths are pairwise disjoint: `src/cost-model.mjs` + `test/cost-model.test.mjs` +
`test/crossover.test.mjs` (T-014); `src/agents.mjs` + `test/agents.test.mjs` (T-015);
`test/run.test.mjs` (T-018). No file appears in two lists. No task in this wave reads another's
output: T-014 changes nothing at default concurrency, T-015 adds a record nobody consumes yet,
T-018 touches only where a test writes.

**Expected red during this wave, and whose it is.** T-015 adds `--record`, which
`test/readme.test.mjs`'s flag-documentation test will flag as undocumented until T-019. Every
other test, in every file, must stay green; T-015's acceptance says so explicitly. An agent on
T-014 or T-018 seeing that one failure should report it as T-015's, not fix it — README.md is
T-019's alone.

### Later waves

- Wave 2: **T-016** and **T-017**, concurrently, after T-014 and T-015 both land. Disjoint:
  `src/agents.mjs` + `test/agents-guardrails.test.mjs` (T-016) against `src/compare.mjs` +
  `test/compare.test.mjs` + `test/fixtures/*` (T-017). T-017 builds against the T-015 record
  format *as merged*, and is told to report any divergence rather than adapt silently.
  Expected red: the flag test (on `--dry-run`, `--max-spend`, `--record`) and the layout test
  (on `src/compare.mjs`), both in `test/readme.test.mjs`, both T-019's.
- Wave 3: **T-019**, alone. It quotes every other task's output.
- Between waves the owner may `rm -rf runs/`. No task may do it: other agents' in-flight trial
  files live there, and deleting them is the lost update this project documents.

### Ownership chains

- `src/cost-model.mjs`: T-014 only (T-016 and T-017 import from it; neither edits it)
- `src/agents.mjs`: T-015 → T-016
- `README.md`, `test/readme.test.mjs`: T-019 only
- `src/pricing.mjs`, `src/run.mjs`, `src/worker.mjs`, `src/verify.mjs`, `src/strategies/*`: untouched this round

### The semantic dependency to watch

T-015 defines a record format in its body; T-017 consumes it. They own disjoint files and would
not collide — which is exactly the T-011/T-012 shape, where nothing errors and the consumer is
built against a stale description. They are serialised (`T-017 depends_on T-015`) for that
reason, not for a file. The same holds for T-016's dry-run, which prints `project({ concurrency })`
and so needs T-014 merged, not merely described.
