# keel

This repository is the first instrument of a platform that does not exist yet. The platform's
intent is stated below as intent. The instrument is a small, fully tested measurement of one
coordination problem, and every claim about it is checked against the code by
`test/readme.test.mjs`, which runs the tools and fails when this file drifts from what they
print. The two halves are kept in separate sections and the boundary between them is marked.
The largest `--agents` value in any command in this file is 100.

## The mission

In the owner's words: an "infinite agent dispatch platform that can work in maximum realtime
managing swarms of 1000s at a time", a safe system that can "build on itself infinitely without
getting lost, creating docs and graphs as it goes", scaling to a codebase the size of the
Windows 11 source, where millions of agents are distributed and "all work in harmony and never
get lost or start dysfunctioning".

This repository does not do that. It dispatches no agents. What it has is a decidable version of
the failure that sentence describes, a measurement of four ways to avoid it, a cost model for
what avoiding it costs at N agents, and a working method for keeping a document honest about
code that agents change. The architecture section says what the rest would have to be. The
sections from `What it costs` onward describe only what exists.

## What a system like that needs

None of this is built. It is the design the owner's mission requires, reasoned from what this
repository measured and from what went wrong while building it. Where a point rests on a result
below, the result is named.

### The unit of ownership is an interface, not a file

Two writers to one file is the `naive` strategy below: each reads valid state, writes valid
state, and one contribution vanishes with nothing erroring. So concurrent tasks must own
disjoint files. The backlog for this repository enforced that by hand (`.orchestration/BACKLOG.md`
lists each task's `owns:` paths and checks pairwise intersection), and across eight waves no
agent wrote outside its lane.

Disjoint files were not enough. Twice (T-011 against T-012, T-015 against T-017) two tasks
owned disjoint files while one consumed a format the other defined. The consumer was built
against the task note's description of the format, the producer changed it, and nothing
errored, because a file-level partition cannot see a contract. The thing agents actually share
in a codebase is names, signatures, formats and invariants, and those cross file boundaries by
construction. A dispatcher therefore has to treat an interface as the owned unit: a task may
change an interface only if it also owns every consumer, or the change is serialised behind
the consumers' tasks, which is what `depends_on` did here once the problem was recognised. For
that to be mechanical rather than remembered, every interface a task depends on must be a
checkable artifact at dispatch time (a schema, a type, a fixture file, a test that imports it),
so a consumer built against a stale description fails when its own check runs and not at
integration. The record format in `src/agents.mjs` and its reader in `src/compare.mjs` are
coupled this way now by the fixtures in `test/fixtures/`; the general mechanism is not built.

### The knowledge graph is derived, and every authored claim in it is a test

A graph of a codebase that agents write by hand goes stale the way this README went stale, three
times, between waves. The only durable fix found here was to stop authoring the facts and start
deriving them: `test/readme.test.mjs` runs each tool, parses what it prints, parses the matching
claim out of this file, and compares. Nothing is compared against a number written in the test.
That is a 31-check prototype of what "creating docs and graphs as it goes" has to mean at scale:
the graph's edges (which file imports which, which flag is read where, which test pins which
claim) are regenerated from the code, and the prose a human or agent adds to it is admitted only
with a check that can fail. A derived graph is trustworthy exactly to the extent that each node
has a producer that can be re-run and each annotation has a check that can go red. An authored
graph is trustworthy for as long as nobody has changed anything, which in a system whose purpose
is change is no time at all.

### The oracle is layered, and where it is absent the change is quarantined

This instrument has a perfect oracle: sorted, complete, no duplicates, nothing invented, each
true or false. A semantic change to a codebase has no such thing. What exists instead is a stack
of partial oracles of decreasing strength: it parses and type-checks; the existing tests pass
(regression); the task's own acceptance tests pass (specification); the interfaces it depends on
are unchanged, or every consumer was updated in the same change (contract); the derived
documentation still matches (coherence). None of these decides whether the code is good, and no
mechanism can. The design consequence is not to pretend otherwise but to record which layer each
change cleared and to forbid other agents from building on a change that cleared nothing but the
first. The stale-description failure above spreads through exactly that path: a consumer built on
an unverified producer. Where a change has no oracle at all, it goes to a reviewer with a
different context, and the graph marks it unverified until then. One more rule comes from T-022
in this repository: a harness that reported `PASS` with zero calls. An oracle must also check
that work occurred, because a system that can pass by doing nothing will.

### Coordination cost scales against the swarm, and only one shape survives it

The cost model below finds, at every one of 20 work sizes, that no topology ever costs less than
one agent doing everything. Distribution buys time, never money, because the fixed cost per
agent is paid N times. For a coding agent that fixed cost is roughly 15,000 tokens of system
prompt and tool definitions before it reads the task. Any agent that must see shared state
carries O(N) context, so N such agents cost O(N²), which is the `shared-lock` row. The only
shape whose cost stays linear and whose time can fall is `partitioned`: each agent sees only its
own input and ordinary code merges the outputs. That shape wins partly because the merge is code,
and in a codebase the merge is where the difficulty lives. A management tree does not fix this:
`hierarchical` bounds how many reports a merger has, not how much it must read, and a merger one
level below the root sees fanout squared values. Real concurrency is bounded by rate limits, and
the model's own arithmetic shows a topology that wins at unlimited concurrency losing at the
harness's default of 20 in flight. So the platform's job, concretely, is to produce partitions in
which almost nothing is shared, to make the merge mechanical (the test gate, not an agent), and
to treat the number of agents actually in flight as the governing parameter rather than the
number dispatched. A swarm whose members share state is a slow single agent that costs N times
as much.

### Safe means impossible, not discouraged

An instruction in a prompt is discouragement. The following have to be unreachable by
construction, and each has a precedent in this repository:

- Two in-flight tasks owning the same path: refused by the dispatcher computing the
  intersection, as the backlog did by hand.
- A write outside the owned set: refused by the sandbox or worktree, not by the brief.
- A merge that cleared no oracle: refused by the gate.
- Spend beyond a ceiling: `--max-spend` is enforced from measured token usage during the run,
  not from the projection, so it holds when the model is wrong.
- A pass with no work: `--agents 0` and `--agents abc` once reported `PASS`; they now exit 2.
- Shared infrastructure paths: the process harness and then the agent harness each lost
  updates on their own output files, and each was fixed by a layout in which nothing is shared
  (a process id in the file name), not by a lock.
- A lock with an expiry: `lockfile` took two attempts and is still mitigated rather than sound,
  because POSIX has no compare-and-unlink. A design that needs a lock on shared state has
  already lost.

### The failure modes of a very large swarm, named

Every one of these was observed here at small N or follows directly from something that was.

- Lost update: disjoint writers were not enforced. Silent, well-formed output with something
  missing.
- Stale contract: disjoint files, coupled meaning. Nothing errors; the consumer is wrong.
- Self-certification: an agent declares done where no oracle exists, or an oracle passes
  because nothing happened.
- Cascade from a wrong interface: a consumer built on an unverified producer propagates the
  defect, and the cost of correction grows with the number of dependents dispatched meanwhile.
- Convergent duplication: two agents independently reach the same change. Here two agents
  independently found the same structural result, which was cheap. At scale it is paid work
  that then has to be reconciled.
- Documentation drift: authored descriptions of a system outliving the system they described.
- Context dilution: an agent whose required context grows with the swarm, the O(N) row.
- Coordinator misjudging completion: `compact()` run while a worker is still appending loses the
  append silently. Knowing when everyone has finished is the step coordinators get wrong.
- Lock theft and livelock on any resource that is genuinely shared.
- Spend runaway: a projection used as a ceiling, with the projection wrong by a factor the
  fixtures here suggest may be about four.

## Why the first instrument sorts a list

The hypothesis this repository tests is that N agents each contributing one number to a file
that must end sorted, complete, duplicate-free and free of invented values is the smallest
decidable instance of the coordination problem the mission describes: shared mutable state,
concurrent writers with no shared memory, each individually correct, and a success condition
that needs no judgement.

Where that holds: the mechanism is the same. The lost update at N=16 is a writer basing its
output on state another writer has already changed, and nothing in the system can see it. At a
million agents on a large tree, "getting lost and starting to dysfunction" is that same event,
repeated, with no oracle to name it. The cost structure also carries over: what an agent must
read decides cost before anything else does, and that is a property of the topology, not of the
task.

Where it fails, and these are not small:

- A number has no consumers. A code change does. The dependency problem, which produced the two
  stale-contract failures here, cannot be expressed in this instrument at all. The instrument's
  own development process hit it; the instrument cannot.
- Sortedness is decidable; architectural coherence is not. This measures coordination mechanics
  and can never measure quality. A platform that reasons from this result alone will build
  something that merges cleanly and is wrong.
- `partitioned` wins because the merge is sorting integers in a few microseconds of code. In a
  codebase the merge is the work, and the instrument prices it at zero.
- The partition here is given: agent k gets number k. In a codebase, finding a partition in
  which nothing is shared is the hard problem, and the one the architecture above mostly
  consists of.

So the instrument is a real foundation for one layer, the coordination substrate (ownership,
contention, cost, instrumentation discipline), and no evidence about the semantic layer. The
process that built it, with its `owns:` lists, serialised waves and a document pinned to tool
output, is a closer prototype of the platform than the code is.

## What is built and what is not

| component | state | where |
|---|---|---|
| oracle: sorted, complete, no duplicates, nothing invented | measured | `src/verify.mjs`, `test/verify.test.mjs` |
| four process strategies under real OS concurrency | measured | `src/run.mjs`, `src/worker.mjs`, `src/strategies/` |
| two lock defects, found and fixed, the lock still not sound | measured | `src/strategies/lockfile.mjs`, `test/lockfile.test.mjs` |
| lost updates on the harness's own output path, fixed by layout | measured | `test/run-isolation.test.mjs` |
| cost and time per topology, with `--concurrency` and `--fanout` | projected | `src/cost-model.mjs` |
| where distribution wins on time (`--crossover`) | projected | `src/cost-model.mjs`, `test/crossover.test.mjs` |
| agent harness: four topologies, per-call records, spend ceiling | tested offline | `src/agents.mjs` |
| fit of a recorded run against the model's constants | tested offline | `src/compare.mjs`, `test/fixtures/` |
| this file, pinned to tool output in both directions | tested offline | `test/readme.test.mjs` |
| a real agent run | not built | — |
| a dispatcher that checks `owns:` lists mechanically | not built | — |
| ownership of interfaces rather than files | not built | — |
| a derived graph of a codebase | not built | — |
| any oracle for a semantic change | not built | — |
| sandboxed writes, review queues, more than one repository | not built | — |

`measured` means a real process ran and the number is what it reported. `projected` means
arithmetic on assumed constants that no real run has checked. `tested offline` means the code is
exercised by the suite without a credential and has never touched a model. The rest of this file
is about the first three rows of states only.

## What it costs

For 100 agents each contributing one number, on Haiku 4.5, with no limit on how many calls run
at once:

| kind | topology | calls | tokens in | tokens out | cost | ~time |
|---|---|---|---|---|---|---|
| api | solo | 1 | 200 | 250 | $0.0015 | 4.0s |
| api | shared-lock | 100 | 32375 | 12625 | $0.0955 | 276s |
| api | partitioned | 100 | 20000 | 250 | $0.0213 | 1.5s |
| api | hierarchical | 111 | 22700 | 750 | $0.0265 | 7.3s |
| claude-code | solo | 1 | 15000 | 250 | $0.0163 | 10.5s |
| claude-code | shared-lock | 100 | 1512375 | 12625 | $1.5755 | 926s |
| claude-code | partitioned | 100 | 1500000 | 250 | $1.5012 | 8.0s |
| claude-code | hierarchical | 111 | 1665500 | 750 | $1.6692 | 26.8s |

**These are projections, not measurements**: published per-token pricing against an explicit
token estimate. `node src/cost-model.mjs --agents 100` prints this table for any N, and
`test/readme.test.mjs` fails if the table above stops matching what it prints.

The ~time column assumes unlimited concurrency, and the agent harness does not run that way.
`src/agents.mjs` keeps at most 20 calls in flight by default. `--concurrency N` on the cost
model projects a limited run; at 20, the times for the same job are:

```bash
node src/cost-model.mjs --agents 100 --concurrency 20
```

| kind | topology | unlimited | concurrency 20 |
|---|---|---|---|
| api | solo | 4.0s | 4.0s |
| api | shared-lock | 276s | 276s |
| api | partitioned | 1.5s | 7.6s |
| api | hierarchical | 7.3s | 13.4s |
| claude-code | solo | 10.5s | 10.5s |
| claude-code | shared-lock | 926s | 926s |
| claude-code | partitioned | 8.0s | 40.1s |
| claude-code | hierarchical | 26.8s | 58.9s |

Calls, tokens and cost do not change with concurrency; only time does. `solo` and
`shared-lock` make one call at a time, so a limit does not touch them. `partitioned` makes 100
calls in one round, which at concurrency 20 runs as five waves of 20, so it is 7.6s as API
calls against `solo`'s 4.0s. At the harness's own default, `partitioned` is slower than one
agent. It is faster only when at least 50 calls can be in flight (the smallest concurrency at
which 100 calls fit in two waves).

A call's duration is a fixed round-trip latency (1.5s for an API call, 8s for a Claude Code
agent) plus its output tokens at an assumed 100 tokens per second. That generation term is
what makes `solo` slow: one agent emitting a hundred numbers takes 4.0s, not 1.5s. Rounds run
one after another and calls inside a round run concurrently, so the time is the sum over rounds
of each round's slowest call, and a round of k calls under a concurrency limit c takes
ceil(k / c) waves. Input prefill time is ignored. Without `--concurrency` the model assumes no
limit, which is the condition the first table above and the default crossover table below
depend on.

Four things follow from the table.

What you mean by "agent" dominates everything else. The same 100-agent job is $0.0213 as API
calls and $1.5012 as Claude Code agents (`partitioned`). That is not the work; it is roughly
15,000 tokens of system prompt and tool definitions each agent loads before reading a word of
the task. Spin-up is a fixed cost paid N times, so it is the first thing to price and the
easiest to forget.

Distribution is a latency tool and never a cost saving. One agent doing all hundred costs
$0.0015. Every distributed option costs more, because the fixed cost is paid N times to do the
same total work. You distribute to make something finish sooner, and only when the work per
agent is big enough to be worth the spin-up. The crossover sweep below checks this at 20 work
sizes and finds no topology ever cheaper than `solo`.

Topology decides token cost, not only wall-clock. An agent that must see current state carries
O(N) tokens of context; one that only needs its own input carries O(1). Across N agents that is
O(N²) against O(N). `shared-lock` is 4.5× the cost *and* 181× the time of `partitioned`: a lock
serialises exactly what you paid to parallelise. Against one agent it is 66× the cost and 69×
the time.

Hierarchical is not the middle ground it looks like. Agents in groups of ten, each group merged
by an agent, those merged by another, until a root holds everything. The pitch is that no agent
ever sees more than a handful of values. That does not hold, and three independent pieces of
work found it:

- The root reads all N values and emits all N values. It cannot be faster than one agent
  emitting N values, so `hierarchical` can never beat `solo` on generation time, and it adds
  the merge rounds on top. At zero work it is slower than `solo`: 7.3s against 4.0s as API
  calls, 26.8s against 10.5s as Claude Code agents (unlimited concurrency; the table above
  gives both at 20). It also costs more than `partitioned`.
- A mid-level merger is not bounded either. At fanout 3 with 12 agents, a merger one level
  below the root sees nine values, not three: fanout squared. This is measured, not modelled:
  it is what `src/agents.mjs` reports for every call in a run, here with the offline `--mock`
  transport (so the counts are exact, and no model or token was involved):

```
node src/agents.mjs --agents 12 --topology hierarchical --fanout 3 --mock clean
  L0 leaf   x12   max children 0   max in 1     max out 1
  L1 merger x4    max children 3   max in 3     max out 3
  L2 merger x2    max children 3   max in 9     max out 9
  L3 root   x1    max children 2   max in 12    max out 12
```

- The only bound that holds at every level is the number of children per agent, which is at
  most the fanout. The number of values is not bounded. Total tokens are O(N log N), not O(N).

The process version of the strategy (`src/strategies/hierarchical.mjs`) shows the same shape:
each group file holds at most `fanout` values, but the final merge consumes all of them.

## Where distribution wins on time

The instrument's central question was where N agents beat one. `--crossover` answers it: for
each topology, the smallest work per agent (input plus output tokens, a free parameter) at
which its projected time falls below `solo`'s. At N=100 on Haiku, with unlimited concurrency:

```bash
node src/cost-model.mjs --agents 100 --crossover
```

| topology | api | claude-code |
|---|---|---|
| partitioned | work >= 0 | work >= 0 |
| hierarchical | work >= 7 | work >= 33 |
| shared-lock | never | never |

This table holds only at unlimited concurrency. At 20 calls in flight, the agent harness's
default, the thresholds move:

```bash
node src/cost-model.mjs --agents 100 --crossover --concurrency 20
```

| topology | api | claude-code |
|---|---|---|
| partitioned | work >= 8 | work >= 63 |
| hierarchical | work >= 20 | work >= 102 |
| shared-lock | never | never |

The first table was once given as the result without that condition, and it reported
`partitioned` as winning at zero work. That is true only if 100 calls can run at once. As the
harness ships, `partitioned` needs at least 8 tokens of real work per agent as API calls, and
63 as Claude Code agents, before it beats one agent on time. All of these are projections.

`partitioned` has the lowest threshold in both tables, but read why before believing it: its
merge is ordinary code, and the model neither times nor prices that code. Each agent emits one
number and a coordinator assembles the file for free. It wins partly by taking the work away
from the agents, and the tool says so in its own output. `hierarchical` needs enough work per
agent to pay for its root's generation floor, and the Claude Code threshold is higher than the
API one by the difference in spin-up. `shared-lock` never wins: its deficit is N rounds of
latency, a constant per round, and more work per agent never closes a constant. The sweep
covers work from 0 to 1,000,000 tokens, and the cost check at the end of the same output
reports every topology costing at least as much as `solo` at all 20 sweep points. That cost
check does not depend on concurrency.

Flags for the cost model: `--agents N` (default 100), `--model haiku|sonnet|opus` (default
haiku), `--work W` (tokens of real work per agent, default 0; `solo` does all N times W itself),
`--verbose` (one extra line per row: overhead, average tokens per call, number of rounds),
`--concurrency N` (project with at most N calls in flight; default unlimited, any positive
number), `--fanout N` (hierarchical only: the group size of the merge tree; an integer >= 2,
default 10, and 1 is refused because a fanout of 1 never reduces) and `--crossover` (the
sweep above instead of the table; combines with `--concurrency` and `--fanout`).

`--fanout` changes the projected tree. For 12 agents the default gives 15 `hierarchical`
calls and 3060 input tokens as API calls, and `--fanout 3` gives 19 calls and 3890:

```bash
node src/cost-model.mjs --agents 12 --fanout 3
```

`--concurrency` has different valid values in the two tools that take it. On the cost model
it is any positive number, and leaving the flag out is how you get unlimited concurrency: the
literal `Infinity` is refused with exit 2 (the library function `project()` does accept
`Infinity`, which is its default). On the agent harness it is an integer >= 1 with a default
of 20, and `Infinity`, `0`, a fraction or text exit 2. A number that works for one tool can be
refused by the other.

Rates live in one place, `src/pricing.mjs`, which both the cost model and the agent harness
read, so they cannot disagree about what a run costs. It carries the date the rates were last
checked (2026-10-04) and the cost model warns on stderr once they are more than 90 days old.
That check was made against a rate table supplied with the task, not against the vendor's
page, which the sandbox could not reach. The file also records a source URL that was written
from memory and has never been verified. Re-check the rates before relying on a dollar figure.

## The coordination problem, measured

The projections say what distribution costs. This says what it takes to get right. Processes
rather than agents: same file, same oracle, real OS concurrency.

```bash
node src/run.mjs --agents 12 --strategy naive --trials 6
```

| strategy | passed | median |
|---|---|---|
| naive | 0/6 | 187ms |
| lockfile | 6/6 | 492ms |
| append | 6/6 | 168ms |
| hierarchical | 6/6 | 194ms |

The medians are wall-clock on one laptop and move by tens of percent between runs; the pass
counts are the result. `test/readme.test.mjs` reruns all four and fails if a pass count above
changes.

`naive` reads the file, inserts, writes it back: what anybody writes first, and what an agent
told "keep this sorted" does unprompted. It never passes. At eight agents a trial typically
keeps one or two of the eight numbers, because nearly all of them read an empty file and write
a one-element file. Note what the oracle reports when it fails: the output is sorted and
well-formed every time. Only completeness catches it. That is the shape of this failure. Not
corruption and not a conflict, just work quietly overwritten by other work, with every worker
individually correct.

`lockfile` works and serialises. `append` does not coordinate at all; each worker appends `,N`
and leaves, which is safe because a small `O_APPEND` write is atomic. The file is unsorted
during the run and a compaction pass sorts it at the end, so the contention did not vanish; it
moved into a coordinator that has to know when the run is over.

`hierarchical` is `append` with one file per group of ten values (`SORTLAB_FANOUT` changes
the group size), sorted per group and then merged. Nothing is shared across groups, so nothing
serialises, and like `append` it needs a coordinator to compact when the workers are done.

`append.compact()` has limits, written into its source. It sorts into `<file>.tmp` and renames,
so a reader sees the old file or the new one, never half of one. It compares the file size
before the read and just before the rename and throws instead of overwriting if an append
landed in between. It cannot see an append between that last check and the rename, and it
cannot see a worker that opened the old file earlier and appends after the rename, because that
write goes to the replaced inode and is lost silently. So "harmless to run twice" is only true
once every worker has finished, which is the thing a coordinator is most likely to get wrong.
A throw from `compact` is a coordinator error: rerun it after the stragglers end.

### The lock took two attempts, and is still not sound

The first version created the lock file, then wrote the holder's timestamp as a second step.
Between those two operations the lock exists and is empty. A worker checking staleness in that
window reads `''`, `Number('')` is `0`, and `Date.now() - 0` is fifty-six years, so it decides
the lock was abandoned, deletes it, and takes it. Two workers then hold the lock, and the
original race is back with a lock on top of it pretending to prevent it. Five failures in
twelve, every one a clean lost update.

Two mistakes stacked. The create was atomic but the lock was not; a lock is its content as well
as its existence, and the fix was to `link()` a fully-written temp file into place. And the
staleness check failed open, reading "I can't parse this" as "this is old". After the fix, 30
concurrent contributors in one process all land, and twenty agents pass 10 trials out of 10;
both are asserted in `test/lockfile.test.mjs`.

The second bug was found later by reading the code rather than running it. Release was
unconditional. A holder slower than the staleness timeout (`STALE_MS`, ten seconds) had its
lock taken by a waiter; when it woke it wrote its stale read-modify-write over the new
holder's data, then deleted the lock on its way out, which by then belonged to the new
holder, admitting a third worker while the second still believed it held the lock. Nothing
tested it, partly because the timeout was a constant.

The lock now records `<pid>:<token>:<timestamp>`, and a holder acts only on a lock carrying its
own token. It re-checks before publishing (the data file goes to a temp name and is renamed in
after the check) and releases only a lock that is still its own. A loss before the write is
retried, because nothing happened; a loss after the write is fatal, because redoing it would
duplicate the value. `SORTLAB_STALE_MS` and `SORTLAB_RETRY_MS` override the timings so theft
can be provoked in milliseconds, and `--slow` below drives it from the runner.

What stays broken: POSIX has no compare-and-unlink. The ownership check and the write or
unlink after it are separate syscalls, and the stale-reclaim path can still delete a fresh lock
if it lands in that gap. Those windows are narrowed to microseconds, not closed, and its
author's conclusion is that they cannot be: a lock with an expiry cannot be made fully safe
against a holder that outlives it. `lockfile` is mitigated, not sound. The layout in which
contention cannot arise, `append`, is the real answer.

### The harness lost updates on its own output path

Every concurrent `run.mjs` wrote its trial to `runs/trial-<i>.txt`, so two runs at once shared
a file and overwrote each other. It was found only because six agents were working in the same
tree at the same time. It was fixed with a layout change, not a lock: each run's files are now
named with its process id, so there is nothing shared to contend over. That is the result this
instrument keeps arriving at, applied to the instrument itself. `test/run-isolation.test.mjs`
pins the disjoint paths, and `runs/` is gitignored.

### Running the process harness

```bash
node src/run.mjs --agents 8 --strategy lockfile --trials 20
```

`--agents N` (default 8), `--strategy naive|lockfile|append|hierarchical` (default naive),
`--trials T` (default 1; "17/20 passed" is the honest unit). Exit code 0 if every trial
passed, 1 if any failed, 2 for bad arguments.

| flag | meaning | default |
|---|---|---|
| `--delay <ms>` | work time inside each strategy; widens the read-write window for `naive` and `lockfile` | 25 |
| `--slow <k>` | k workers use `--slow-ms` instead of `--delay` | 0 |
| `--slow-ms <ms>` | the delay the slow workers get | 500 |
| `--faulty <k>` | k workers are faulty, distinct from the slow ones | 0 |
| `--fault <mode>` | what a faulty worker does: `crash` or `hang` | crash |
| `--crash-at <ms>` | when a crashing worker exits (code 3) | 10 |
| `--timeout <ms>` | SIGKILL anything still running after this long | 30000 |
| `--keep` | keep trial files after a pass and print a `file:` line per trial | off |

Faulty workers' values are removed from the oracle's expected set, because a worker that was
meant to die promised nothing. If a crashing worker writes its value anyway the oracle reports
it as `unexpected`. A healthy worker that exits non-zero or is killed by the timeout fails the
trial. The summary counts crashed, hung (killed) and errored (a healthy worker that failed)
separately. The runner calls a strategy's `compact` after the workers finish, if it has one.

Not every combination has been explored. Failure injection and non-uniform workers exist and
are tested, but this file makes no claim about how each strategy degrades beyond the lock
results above.

## Running real agents

`src/agents.mjs` does the same experiment with model calls instead of processes. It reports
tokens, dollars and wall-clock for a run, which a real run would let you set against what the
cost model projects. All four topologies (`solo`, `partitioned`, `hierarchical`,
`shared-lock`) are implemented. It makes API calls, so it can measure only the `api` kind. The
`claude-code` rows in the tables above, which carry the finding that what you mean by "agent"
dominates the cost, have no instrument in this repository, and nothing here can measure them.

```bash
npm install
node src/agents.mjs --agents 100 --topology partitioned --model haiku --dry-run
ANTHROPIC_API_KEY=... node src/agents.mjs --agents 100 --topology partitioned --model haiku --max-spend 0.05 --record runs/record.jsonl
node src/compare.mjs runs/record.jsonl
node src/agents.mjs --agents 100 --topology partitioned --mock clean
```

`npm install` is required before any real run. `@anthropic-ai/sdk` is declared in
`package.json` but `node_modules/` is not in the repository, so from a fresh checkout the
second command fails until it is installed. `--dry-run` reports whether the SDK is present by
attempting the import, so run it first. The last command needs neither the SDK nor a credential.

The harness is tested. It has never made a real API call. Nothing in this environment can
authenticate: there is no `ANTHROPIC_API_KEY`, no credential file, and a nested `claude -p`
fails with "OAuth session expired and could not be refreshed". The pipeline is exercised
through a scripted transport instead, so what is known is that the prompts, parsing, blame
accounting, oracle check and reporting work. What is not known is how a model behaves in them.
Every agent figure in this README is a projection. A `--mock` run reports `0 in / 0 out`
and `$0.0000` because it counts no tokens, and it is not a measurement of anything but the
harness.

Flags: `--agents N` (default 10), `--topology` (default partitioned), `--model haiku|sonnet|opus`
or a raw model id that appears in `src/pricing.mjs` (default haiku), `--concurrency N` (calls
in flight at once, default 20), `--fanout N` (hierarchical only; integer >= 2, default 10),
`--out <path>` (the output file; default `runs/agents-<topology>-<agents>-<pid>.txt`, named
with the process id so two runs of the same shape do not write to one file), `--mock <mode>`
where mode is one of `clean|prose|newline|empty`, `--dry-run`, `--max-spend <usd>` and
`--record <file>`. The mock modes return the right answer and then misformat it in one specific
way, to test that the harness rejects a reply instead of coercing it into a number. Replies end
up in one of three places and the report keeps them apart: accepted, rejected (the harness could
not read numbers out of it and wrote nothing), or errored (the call itself failed).

The gap between the process harness and the agent harness matters because a model is not a
process. A process follows the protocol exactly, which makes it the right tool for finding
races and the wrong tool for everything else. The failures a model produces are different in
kind: misreading the protocol and doing something reasonable nobody specified, deciding the
file looks broken and helpfully repairing it, returning the right answer wrapped in prose, or
being correct but slow enough to trip a lock's staleness timeout. None of those appear above.

`--dry-run` prints the projection for exactly this run, using the harness's own concurrency
rather than the cost model's unlimited default, and exits 0 without a credential, an SDK or a
call. Its first two lines for the command above:

```
dry run   partitioned   claude-haiku-4-5   100 agents   kind api
projected  calls 100  tokens 20000 in / 250 out  cost $0.0213  time 7.6s  (concurrency 20)
```

For a hierarchical run the first line also carries the fanout, and the projection is for that
tree: `--agents 12 --topology hierarchical --fanout 3 --dry-run` prints `calls 19`, the same
count the cost model gives at `--fanout 3`.

The third line is the SDK check (`not installed (run npm install)` in the checkout this was
written against), and the last is `no calls made`.

`--max-spend <usd>` is a spending ceiling, and it is enforced twice. The two checks give
different guarantees.

- Before any call, the harness projects the run's cost with the same model as `--dry-run` and
  compares it to the ceiling. If the projection is higher it prints both figures and exits 3
  having made no call. This compares one projection with a number you chose, so it is only as
  good as the cost model, and the model's constants have never been checked against a real run.
- During the run, the harness prices every completed call from the token counts the API
  reported, the way the final report does. Once that total exceeds the ceiling it starts no
  new call, lets the calls already in flight finish, and exits 1. This check does not use the
  projection, so it holds even if the model is wrong. Because up to `--concurrency` calls are in
  flight when the ceiling is crossed, the overshoot is bounded at that many calls, not zero.
  Under `--mock` this check can never trip, because mock calls report zero tokens.

A refusal looks like this (`--max-spend 0.01` on the same job):

```
refused   projected cost $0.0213 exceeds --max-spend $0.01 (partitioned, claude-haiku-4-5, 100 agents, concurrency 20); no calls made
```

Exit codes:

| code | meaning |
|---|---|
| 0 | the run passed the oracle, or `--dry-run` printed its projection |
| 1 | the oracle failed, or the run was stopped by the mid-run ceiling |
| 2 | bad arguments, a missing credential or SDK, or a model whose price is unknown |
| 3 | refused before any call: the projection exceeds `--max-spend` |

`--agents` and `--concurrency` must be integers >= 1, and `--fanout` for a hierarchical run an
integer >= 2. A bad value exits 2 with the flag named, before any call. A model with no price
in `src/pricing.mjs` also exits 2 before the credential check, because a run whose cost cannot
be computed would otherwise report $0.0000.

`--record <file>` writes one JSON line per call (agent, role, level, start time, duration in
milliseconds, input and output tokens, stop reason, outcome, values in and out) and then one
summary line, so a run leaves its per-call points behind and not only one elapsed time. Why
that matters is the next section.

### Comparing a record with the cost model

One elapsed time per run can show the cost model is wrong. It cannot show which constant is
wrong, because `LATENCY` and `OUTPUT_TOKENS_PER_SECOND` are the intercept and slope of a
line: a call's duration is the first plus the second times its output tokens. Two lines with
different intercepts and slopes can give the same total. A record keeps the individual
points, and `src/compare.mjs` fits the line to them:

```bash
node src/compare.mjs runs/record.jsonl
```

For each of the four keys of `ASSUMPTIONS` (`OVERHEAD`, `TOKENS_PER_NUMBER`,
`OUTPUT_TOKENS_PER_SECOND`, `LATENCY`), and for prefill time, it prints the assumed value, the
fitted value and their ratio. Each line carries one of three states:

- `measured`: the record has enough variation to fit the constant.
- `upper-bound`: the record gives a ceiling on the constant and no more.
- `not-identifiable`: the record cannot say, and the tool prints a dash instead of a number.

The third state is the reason the tool exists. A partitioned record has no variation in output
size, since every call emits one number, so it identifies the intercept and nothing else; the
tool reports the slope as `not-identifiable`. Only a record containing calls of different
output sizes (hierarchical, shared-lock or solo) can fit a slope. A mock record is refused
outright with exit 2, because a report made of dashes would still look like output.

`compare.mjs` projects the tree that ran: for a hierarchical record it passes the record's own
`fanout` to the cost model. If that fanout is missing or unusable (below 2, for instance), the
projection columns print a dash and a warning says why, and no tree is guessed.

Two synthetic records, `test/fixtures/record-partitioned.jsonl` and
`test/fixtures/record-hierarchical.jsonl`, exercise the tool. They are hand-authored and
the tool prints a SYNTHETIC RECORD banner for them. On `record-hierarchical.jsonl` (12 agents,
fanout 3, 19 calls) the totals line projects 3890 input tokens against 927 measured, and that
gap is accounted for exactly: 3890 = 19 x 200 + 36 x 2.5 and 927 = 19 x 45 + 36 x 2, where 19
is the call count and 36 is the number of values the mergers read. The difference is
`OVERHEAD.api` (200 against 45) and `TOKENS_PER_NUMBER` (2.5 against 2), with nothing about
the tree left in it.

## What this cannot measure

- There is no credential in this environment, and no real run has ever happened. Every
  agent-side number in this README is a projection: the cost table, both crossover tables, the
  concurrency table, and the `--dry-run` output. The process results above are the only
  measured numbers, and they are about processes.
- Both `compare.mjs` fixtures are hand-authored synthetic records. Each obeys one formula
  exactly. They validate the fit arithmetic and no constant in the cost model.
- The fixtures imply that `OVERHEAD.api` may be 45 rather than the assumed 200, an error of
  a factor of about 4.4. If 45 were right, every API input-token and cost figure in this README
  would be too high by a similar factor. The constant has not been changed. A synthetic fixture
  cannot settle a constant, because its 45 is a number its author wrote. The harness's leaf
  prompt was separately estimated at about 45 tokens (an estimate, not a tokenizer count). A
  real record will confirm or refute it first.
- The exact closure of the hierarchical fixture's token gap (3890 projected against 927
  measured, above) is a statement about two numbers a hand-authored file chose. Before
  `project()` took a fanout the same gap mixed a different tree with different constants; the
  tree now matches, so what is left is the two constants and no more. The fixture still cannot
  say which constants are right.
- `ASSUMPTIONS` has four machine-readable keys, and `compare.mjs` can check them. Three further
  structural assumptions are prose comments in `src/cost-model.mjs` that no tool checks: the
  work split between input and output (50/50), the input prefill time that `project()`
  ignores, and the partitioned merge, which is untimed and unpriced.
- Calls are not streamed, so a recorded duration includes input prefill. When the record cannot
  separate prefill from output (input size constant or collinear with output size), the
  one-variable fit folds prefill into `LATENCY`, and `latencyMs` is an upper bound, not a
  measurement.
- The `claude-code` rows cannot be measured at all; see the previous section.
- Nothing above the `What is built and what is not` table is measured by anything. The
  architecture is a design and the bridge is an argument.

## Layout

```
src/verify.mjs                  the oracle: sorted, complete, no duplicates, nothing invented
src/cost-model.mjs              projected cost and time per topology; --crossover finds where distribution wins
src/pricing.mjs                 model ids, per-token rates, and the date they were last checked
src/run.mjs                     process harness: spawn N workers, verify, report pass rate
src/worker.mjs                  one worker process; failure injection lives here
src/agents.mjs                  the same, with model calls (tested offline; needs credentials for real runs)
src/compare.mjs                 fits a --record file against the cost model's constants; says which it can and cannot identify
src/strategies/hierarchical.mjs per-group files merged at the end
src/strategies/lockfile.mjs     exclusive lock around read-modify-write
src/strategies/append.mjs       append and leave, compact at the end
src/strategies/naive.mjs        read, insert, write back; supposed to fail
test/fixtures/                  two synthetic --record files for compare.mjs; hand-authored, not measurements
test/                           node:test files; `npm test` runs them all, including test/readme.test.mjs
.orchestration/                 the backlog and task files the waves were dispatched from; owns: lists and depends_on
_archive/version_1              the earlier Keel, a boilerplate with the same thesis and unrelated code
```

## Open

- Measure it. Every agent figure here is modelled. The procedure is: `--dry-run` to see the
  projection and whether the SDK is installed, then a run with `--record` and `--max-spend`
  (a `--mock` run exercises the harness, but `compare.mjs` refuses its record), then
  `node src/compare.mjs` on the record. A real run still needs an API key. The first thing a
  real record will confirm or refute is the API overhead constant: the model assumes 200 input
  tokens per call, and the harness's leaf prompt was estimated at about 45 tokens (an
  estimate, not a count).
- The crossover is only as good as its constants. It depends on an assumed generation speed
  (100 tokens per second), assumed fixed latencies, a per-number token estimate, and on the
  merge in `partitioned` being free. Change any and the thresholds move. A real run is the only
  thing that can say which are wrong.
- Real agents are not uniform and not reliable. Slow and failing workers exist in the process
  harness now. A model that is slow, wrong, or helpful in ways nobody specified has not been
  seen at all.
- The next instrument, if there is one, should be the dependency problem the sorting task
  cannot express: two tasks with disjoint files and a shared contract, and a check that fails
  when the contract changes under the consumer. That is the smallest decidable instance of the
  failure this repository hit twice while being built and never once while running.
