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

---

> **Waves four to six complete** (T-014, T-015, T-018; then T-016, T-017; then T-019). Partitioned
> by `owns:` as before; no agent wrote outside its lane. `npm test` is 201/201, `npm run check` is
> clean, working tree clean at 300304d. The instruments the second grooming asked for exist:
> `--concurrency` in the cost model, `--record` writing per-call JSONL, `--dry-run`, `--max-spend`
> enforced before and during a run, and `src/compare.mjs`, which fits a record against the frozen
> `ASSUMPTIONS` and labels every constant `measured`, `upper-bound` or `not-identifiable`.
>
> Three things the waves surfaced. T-017 found that `project()` hardcodes hierarchical fanout at 10
> while the harness takes `--fanout`, so a hierarchical record at any other fanout cannot be set
> against the model (filed as T-020, never dispatched). Three agents independently concluded from
> the harness's leaf prompt that `OVERHEAD.api` is nearer 45 than the assumed 200, and all three
> correctly declined to change it: the only evidence is a hand-authored fixture. T-019 corrected the
> headline: `partitioned: work >= 0` holds only at unlimited concurrency; at the harness's own
> default of 20 it needs 8 tokens of real work per agent as API calls and 63 as Claude Code agents.
>
> One dispatch amendment, recorded in T-017's file: mock records are refused by `compare.mjs`
> (exit 2) rather than reported as dashes, because a report made of dashes still looks like output.
> The implementing agent surfaced the conflict rather than choosing silently.
>
> The T-006/T-011/T-012 `status: open` discrepancy the second grooming flagged has been fixed.

## Groomed 2026-10-04, third grooming: one closing wave, then a key

The second grooming declined to groom past T-019: "the honest next step is a key, not a task."
Asked to revisit with the instruments that now exist, the verdict is unchanged in substance and
narrowed in form. **Nothing here produces knowledge. There is no task that moves a published
number, and none should be invented.** What exists is one wave of defects in the instrument itself,
each confirmed by running it, each of which would make the first real run either misleading or
less interpretable than it needs to be. They are worth a single closing wave because they are
small, because three of them are false statements the README currently makes about the code, and
because one of them turns the test suite red on 2027-01-03 with no change to any file. After this
wave the project is done until a credential exists, and this backlog grooms nothing past it.

### What was confirmed, not inferred

Run with `--mock` against 300304d:

- `--concurrency abc` makes **zero calls** and reports `result FAIL` / `missing 4: [1,2,3,4]`,
  exit 1. `pooled()` builds `Array.from({ length: NaN })`. On a real run that reads as the model
  losing every number.
- `--agents abc` prints `NaN agents`, makes no call, and reports **`PASS`, exit 0**. So does
  `--agents 0`. `--agents 2.5` makes two calls and passes. The dry-run and max-spend paths validate
  (because `project()` throws); the plain run path does not.
- A token-returning transport with `--model claude-sonnet-4-5` (not in `pricing.mjs`) reports
  `3000 in / 3000 out` at **`$0.0000`**; `costOf()` falls back to a zero price. The README's exit
  table promises 2 for an unknown price; that holds only under `--dry-run`/`--max-spend`.
- `warnIfPricingStale(PRICING_CHECKED + 91 days)` writes to stderr, and
  `test/readme.test.mjs:457` compares the `--max-spend 0.01` refusal stderr **by equality**. The
  suite fails on 2027-01-03. No other test compares stderr by equality.
- The default `--out`, `runs/agents-<topology>-<agents>.txt`, is shared by concurrent runs of the
  same shape, and `shared-lock` reads it back between calls: the `runs/trial-<i>.txt` lost-update
  layout T-007 fixed in `run.mjs`, surviving in the agent harness.
- `project({ agents: 12, topology: 'hierarchical' })` gives 15 calls; the harness at fanout 3 makes
  19. The hierarchical fixture's non-leaf `valuesIn` sum to 36, which is exactly the model's
  covered-value count at fanout 3, so after T-020 the residual (3890 projected against 927) is
  attributable to `OVERHEAD.api` and `TOKENS_PER_NUMBER` and to nothing structural. That is the
  acceptance T-020 now carries, replacing the earlier "within a tolerance OR explain" clause,
  whose second branch would always have applied.
- `--concurrency Infinity` writes `"concurrency":null` into the record (confirmed). Reachable only
  by typing `Infinity`; closed by T-022 requiring a positive integer.

### Tasks

| id | title | size | depends_on | first owned path |
|---|---|---|---|---|
| T-020 | Give project() a fanout parameter, and let compare.mjs project the tree that ran | M | — | src/cost-model.mjs |
| T-021 | Close the surviving test race in test/hierarchical.test.mjs | S | — | test/hierarchical.test.mjs |
| T-022 | Make the agent harness refuse bad arguments and unpriced models before it spends | M | — | src/agents.mjs |
| T-023 | README and its test: fanout honoured, the race closed, the harness's refusals, a dated failure | M | T-020, T-021, T-022 | README.md |

Ranked by whether they change a published claim, not by effort. T-020 and T-021 each falsify a
sentence in "What this cannot measure" (and so force T-023). T-022 makes the exit-code table true
on every path and closes a PASS-with-no-work. T-023 is the only place the README changes.

### Wave seven

Runnable now, concurrently, in one working tree: **T-020, T-021, T-022**.

Owned paths, checked mechanically over every `status: open` task file (pairwise intersection of
`owns:` lists): `src/cost-model.mjs` + `src/compare.mjs` + `test/cost-model.test.mjs` +
`test/crossover.test.mjs` + `test/compare.test.mjs` (T-020); `test/hierarchical.test.mjs` (T-021);
`src/agents.mjs` + `src/worker.mjs` + `test/agents-guardrails.test.mjs` (T-022); `README.md` +
`test/readme.test.mjs` (T-023). **No path appears in two lists.**

**Expected red during wave seven, and whose it is.** Exactly one test, in one file:
`test/readme.test.mjs` › `"what this cannot measure": each limitation is still true of the code`.
It fails on T-020 (it asserts `project()` ignores fanout and that `compare.mjs` contains
`project() has no fanout parameter`) and on T-021 (it asserts `test/hierarchical.test.mjs` reads
`runs/`). Both are T-023's. T-022 adds no flag and changes no quoted line, so it must leave the
suite fully green; its acceptance says so. An agent on any wave-seven task seeing that one failure
reports it, does not fix it, and does not touch README.md.

### Wave eight

**T-023**, alone, after all three land. It quotes their output and rewrites the pinned assertions.
It also carries the stderr filter for the pricing-staleness warning, which is its own finding and
belongs in the file it owns. Between waves the owner may `rm -rf runs/`; no task may.

### The semantic dependencies to watch

Disjoint files are necessary, not sufficient; this project has been bitten twice (T-011/T-012,
T-015/T-017) by a consumer built against a stale description. Three to name this wave:

- **T-020 adds `fanout` to `project()`; T-022's `--dry-run` and preflight call `project()`.**
  T-022 is told to pass `fanout` through now. Before T-020 lands the key is ignored by
  destructuring; after, it is honoured. Both orderings pass both tasks' tests, so there is no
  merge-order dependency — but the parameter **name** is a contract between them (`fanout`), and
  T-023 holds the cross-check: `--agents 12 --topology hierarchical --fanout 3 --dry-run` must
  print `calls 19`, not `15`, once both are in.
- **T-022 writes the record; T-020's `compare.mjs` reads it.** T-022 is required to keep the
  record format byte-identical (eleven call keys, twelve summary keys, in order), and T-020 is
  told not to assume any new field. If either needs a change, it reports it rather than making it.
- **T-022 must not break `test/readme.test.mjs` by refactoring.** That file asserts the literal
  source substrings `arg('agents', 10)`, `arg('concurrency', 20)`, `arg('fanout', 10)` and extracts
  flags with the regex `(?:arg|num|numberArg)\(`. T-022 reads raw values with `arg(...)` as today
  and validates afterwards. Stated in its acceptance.

### Rejected, with reasons

- **Change `OVERHEAD.api` from 200 to 45.** No. There is no offline tokenizer for current Claude
  models and `count_tokens` needs the same credential as the run. What *can* be said offline is a
  bound: the leaf call is ~175 characters of system plus user prompt, and no BPE tokenizer spends
  fewer than ~2 characters per English token, so the true count is under ~100 and 200 is wrong by
  at least 2×. That says the constant is wrong; it does not say what it is. Replacing a labelled
  guess with a better-argued guess converts nothing into a measurement, and the README already
  states the implication (every API dollar figure may be ~4× high) at the point of use. First real
  record settles it in one `compare.mjs` line. **Not a task.**
- **Tool-check the three structural assumptions** (50/50 work split, ignored prefill, unpriced
  merge). The split cannot be checked by this harness: the task has no real work, so `work` is 0 in
  every run it can make. Prefill is already fitted by `compare.mjs` whenever the record can separate
  it, and labelled when it cannot. The partitioned merge could be timed in a few lines, but sorting
  100 integers takes microseconds and the result is known before measuring it; it moves no number.
  **Not a task.**
- **`stallAfterAcquire` "references a runner flag that does not exist."** It does not. The
  `lockfile.mjs` header says a runner flag "can pass it through to the worker (not wired yet)" —
  an accurate statement of what is and is not implemented, and `test/lockfile.test.mjs` uses the
  hook directly. **Not a defect.**
- **`@anthropic-ai/sdk` declared but not installed.** An environment fact, documented in the
  README and detected by `--dry-run`. `npm install` is the owner's command, not a task.
- **A `claude -p` transport for the `claude-code` column, resumable runs, any process-strategy
  addition.** Unchanged from the second grooming: nothing here can measure the column, the API
  runs cost cents, and the process results are complete for the claims made.
- **`compare.mjs` "not-identifiable: not identifiable:" note.** Real, cosmetic, and folded into
  T-020 rather than given its own task, since T-020 owns the file.
- **`worker.mjs` header omits `hierarchical`.** Real, one line, folded into T-022 for the same reason.

### After this wave

Stop. The next entry in this file should be a measurement, not a task: a `--record` from a real
`partitioned` run at N=100 on Haiku (projected $0.0213, more likely ~$0.006 if the overhead
estimate holds), then `node src/compare.mjs` on it, then whatever the `overhead.api` line says.

---

## Groomed 2026-10-04, fourth grooming: three real calls, and the plateau they found

The third grooming ended with "the next entry in this file should be a measurement, not a task".
It is. The owner observed that a boilerplate opened in Claude Code already has an authenticated
session, so a separate `ANTHROPIC_API_KEY` is the wrong shape for this project, and authorised three
calls there, each `claude -p "Output the number N. Nothing else." --output-format json`, each
returning the right number, model `claude-opus-5[1m]`, list pricing, standard tier:

| call | input | cache_creation | cache_read | output | cost_usd | duration_ms |
|---|---|---|---|---|---|---|
| 1 (cold) | 2 | 44,539 | 0 | 3 | 0.445475 | 3039 |
| 2 | 2 | 11,679 | 32,862 | 3 | 0.133306 | 3001 |
| 3 | 2 | 11,683 | 32,862 | 3 | 0.133346 | 2824 |

Total spend $0.71. No further calls are authorised.

### What the calls establish

**All three costs are reproduced from `src/pricing.mjs` to six decimals, at one pair of multipliers.**
Write 2x, read 0.1x on the opus input rate: `(11679 x 5 x 2 + 32862 x 5 x 0.1 + 2 x 5 + 3 x 25) / 1e6
= 0.133306`. Write at 1x or 1.25x reproduces none of them. So the cache-write and cache-read
multipliers are verified against vendor-reported costs, the 2x is consistent with a one-hour cache,
and the opus rates in `pricing.mjs` have passed their first external check.

**The marginal cost of a dispatched Claude Code agent is $0.133, and it plateaus there.** The
prefix is about 44,541 tokens on every call, split three ways: 32,862 stable tokens written once and
read on every later call ($0.016 warm), about 11,680 volatile tokens re-created at the write price on
every call ($0.117, 88% of the warm cost), and 2 tokens of task. Calls 2 and 3 agree to four
decimals, so the volatile block is per-invocation, not a cache that had not finished warming. The
earlier worry that $0.45 might be the marginal cost is answered: $0.445 is the cold start and $0.133
is every agent after it. The earlier hope that it might be $0.02 is answered too: it is not, because
of the volatile block.

**The README's claude-code projection is understated by 9x to 30x, and the factors are separate
errors.** Projected $1.50 for the 100-agent partitioned job at Haiku. Measured constants give $13.64
if the agents run one after another (1 cold + 99 warm), $19.57 at the harness's default of 20 in
flight (20 cold + 80 warm, since the first wave starts before any cache entry exists), and $44.55 if
all 100 start at once. The factors: 3x the tokens (a wrong constant); the session's Opus against the
table's Haiku (a lost lever: a dispatched Claude Code agent takes no `--model`, so the api/claude-code
distinction removes the choice that makes the api kind cheap); and cache-write pricing on a block
that never hits (a term the model does not have). Against the API path for the same job, $0.0213 at
Haiku, Claude Code dispatch is about 640x the price for identical work; if `OVERHEAD.api` is really
~45 as the fixtures suggest, the api job is ~$0.006 and the ratio is over 2000x.

**Cost now depends on concurrency.** The README says "Calls, tokens and cost do not change with
concurrency; only time does". Under caching, how many calls start before the first cache entry
exists decides how many pay cold, so the sentence is true only without a cache. The concurrency the
model treats as a pure time parameter is a cost parameter too, and in the direction opposite to
time: fewer in flight is cheaper and slower.

**Latency.** `LATENCY['claude-code']` is 8 s; the three calls took 3.04, 3.00 and 2.82 s wall-clock
with ~1.5 to 2.2 s to first token, and the warm calls were not noticeably faster than the cold one.
That is an upper bound on fixed latency that includes a 44K-token prefill. The assumption was too
high by about 2.7x while the token assumption was too low by 3x. The model is wrong in both
directions at once, and correcting both widens the gap between the two kinds rather than narrowing
it: `OVERHEAD.api = 200` is probably ~4x too high (still unmeasured) and `OVERHEAD['claude-code']`
is 3x too low (now measured). That strengthens the architectural conclusion that what you mean by
"agent" dominates everything else.

**The engineering target is the volatile block.** A warm call with a fully stable prefix would cost
about $0.022; one that simply did not cache the volatile block would cost about $0.075, because a
cache write that is never read costs twice what plain input costs. Nobody has looked at what the
block contains or why it differs between invocations; it is a property of the Claude Code harness,
not of this repository, which had no `CLAUDE.md` during the calls.

### What they do not establish

- Variance. Three calls, one machine, one session, one model, within minutes. Nothing about other
  days, other sessions, other machines, the five-minute versus one-hour TTL (all calls were inside
  both), or whether the stable block survives a session restart.
- The content of the volatile block, or whether a project `CLAUDE.md` lands in the stable block or
  the volatile one. For a boilerplate whose purpose is to put instructions in front of every agent,
  that is the question that decides whether its own instructions cost 10 cents or half a cent per
  agent. It is one three-call sequence with a `CLAUDE.md` present, and it is first in `Measure it`.
- Anything about generation speed (3 output tokens fit no slope), the api kind, `OVERHEAD.api`, or
  whether concurrent cold starts all pay the write (assumed yes; not observed).
- Whether `[1m]` long-context pricing applies above 200K tokens of input. Not exercised at 44K.

### Tasks

| id | title | size | depends_on | first owned path |
|---|---|---|---|---|
| T-024 | A claude-code transport for the agent harness | M | — | src/agents.mjs |
| T-025 | Price the cache, and let the cost model say that cost depends on concurrency | M | — | src/pricing.mjs |
| T-026 | README: the first real calls, what they change, and what they do not establish | M | T-024, T-025 | README.md |

Ranked by what each changes. T-025 moves published numbers (three claude-code constants, derived
from the fixture by a test rather than typed) and adds the missing term. T-024 is the instrument the
README says cannot exist. T-026 is the only place the README changes. The third grooming rejected a
`claude -p` transport because "nothing here can measure the column"; that premise is gone.

### Wave nine

Runnable now, concurrently, in one working tree: **T-024, T-025**. Owned paths, checked
mechanically over every `status: open` task file: `src/agents.mjs` + `test/agents-claude-code.test.mjs`
+ `test/fixtures/claude-p-47.json` (T-024); `src/pricing.mjs` + `src/cost-model.mjs` + `src/compare.mjs`
+ `test/pricing.test.mjs` + `test/cost-model.test.mjs` + `test/crossover.test.mjs` + `test/compare.test.mjs`
(T-025); `README.md` + `test/readme.test.mjs` (T-026). **No path appears in two lists.**

**Expected red during wave nine, and whose it is.** All in `test/readme.test.mjs`, all T-026's:
the flag test (on `--kind`, `--cache`), the cost table, cost prose, both crossover tables and the
concurrency table (on the changed claude-code constants), and the "what this cannot measure" test.
Every other file must stay green, and both tasks' acceptance says so. `test/suite-integrity.test.mjs`
is unaffected: it holds floors, and both tasks add tests.

### Wave ten

**T-026**, alone, after both land.

### The semantic dependencies to watch

- **T-024 writes four new record fields; T-025's `compare.mjs` reads them.** The names are stated
  identically in both files (`cacheCreationInputTokens`, `cacheReadInputTokens`, summary `kind`,
  `reportedCostUsd`). Disjoint files; coupled meaning; the T-011/T-012 shape. Both are told to report
  a divergence rather than adapt.
- **T-024 saves the fixture; T-025 derives three constants from it by test.** The fixture is the
  three verbatim JSON documents in call order. If the dispatcher cannot supply them verbatim, T-024
  does not fabricate them, T-025's test falls back to transcribed constants with a comment, and
  T-026 says the fixture is missing. A reconstructed fixture labelled as a measurement would be the
  one thing worse than no fixture.
- **T-025 exports `priceOf`; T-024 owns the `costOf()` that should eventually call it.** Not this
  wave. The claude-code ceiling uses the CLI's own `total_cost_usd`, so nothing is mispriced
  meanwhile.

### Rejected, with reasons

- **Run the N=100 claude-code partitioned job.** No. The constants now predict it to within the
  cold/warm split ($13.64 to $44.55), the run would spend that to confirm a number three calls
  already fixed, and no further calls are authorised.
- **Change `OVERHEAD.api` from 200 to 45.** Unchanged from the third grooming. The calls measured
  the other kind. It is now the one constant whose measurement would move an api figure, and the api
  run costs cents.
- **Add `claude-opus-5[1m]` to `pricing.mjs`.** It is a context-window variant of a priced model,
  not a model; the three costs priced correctly at the plain opus rates. `compare.mjs` strips the
  suffix for pricing and warns.
- **Investigate the volatile block.** It belongs to the Claude Code harness, not this repository.
  What this repository can measure is whether its own `CLAUDE.md` lands in the stable or the
  volatile block, and that is the first item under `Measure it`, not a task: it is three calls the
  owner may or may not authorise.
- **Model what a stable prefix would save.** The arithmetic is two lines ($0.133 to $0.022) and is
  stated in T-026's README text. A `--cache stable` policy in the model would project a harness that
  does not exist.

### After this wave

Stop again. The next entry should be either the `CLAUDE.md` three-call sequence (which block do
repository instructions land in) or the api run that settles `OVERHEAD.api`. Both are the owner's
to authorise. Neither is a task.
