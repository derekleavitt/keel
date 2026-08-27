# Loop protocol

**Starting cold, with no memory of previous sessions? Read `.orchestration/RESUME.md`
first.** It is regenerated from actual repository state and says exactly where the last
session stopped.

---

## The loop is one loop

You are building a todo application in `testbed/`. Keel is the thing you are building it
*with*. Those are not two projects — building the app is how Keel gets built.

```
pick the next testbed feature  (.orchestration/tasks/T-*.md)
        │
        ▼
try to build it on Keel
        │
        ├── it was easy ──────────────► feature lands, next feature
        │
        └── Keel made it hard
                │
                ▼
        that friction IS the next Keel task
                │
                ├── a prediction covers it ──► pull P-* from `predicted` to `open`
                └── nothing covers it ───────► write a new K-* task
                │
                ▼
        fix Keel · record a lesson · build the mechanism
                │
                ▼
        finish the feature, then next feature
```

**Keel only ever grows what the application demanded.** The 21 `predicted` tasks in
`.orchestration/tasks/P*.md` are hypotheses. Never build one because it is next in the
list. If a prediction is never demanded, delete it — that is a finding.

Backlogs: features `T-*` (drive), Keel `P-*` (predicted) and `K-*` (pulled by friction).
Journal: `.orchestration/journal/`. Blockers: `.orchestration/blocked/`.
Lessons: `.orchestration/lessons/`.

---

## One iteration

### 1. Orient

- Read `.orchestration/status.md` and the last two journal entries.
- The next task is whatever `RESUME.md` names. A pulled Keel task always precedes the
  feature that demanded it.
- If nothing is open, stop and report.

### 2. Claim

```bash
mkdir .orchestration/locks/<task-id>          # atomic; EEXIST means taken
node scripts/loop-guard.mjs check <task-id>   # exits 2 if already blocked
```

Set `status: claimed` in the task file.

### 3. Build

Work against the task's **Acceptance** list. That list is the definition of done — not
your judgement of when it feels complete.

Rules that do not bend:

- `pnpm verify` must pass. Never weaken a check, delete a failing test, or add a
  suppression to get past it.
- Nothing throws at import time; verify must still pass with no `.env`.
- Copy `examples/notes` for any query layer. If that example does not answer your
  question, **that is friction** — see step 4.

### 4. Promote friction into Keel work

**This is the step that builds Keel. Do not skip it when the feature was easy — note that
it was easy, which is also data.**

Every time you have to stop and think about *how Keel works* rather than *what the feature
does*, that is friction. Record it. Specifically:

- You could not find something you needed.
- Two pieces of guidance contradicted each other.
- You had to invent a pattern because no example showed one.
- You made a mistake the repo could have prevented.
- You did something three times that should have been done once.

For each one, decide where it lands:

| Friction | Action |
|---|---|
| A `predicted` P-* task covers it | Move it to `status: open`. It is now demanded, and goes before the feature resumes. |
| Nothing covers it | Write `.orchestration/tasks/K-NNN.md` with acceptance criteria, `status: open`. |
| It is a one-off mistake, not a gap | Straight to step 5 as a lesson. |

A feature that generated no friction and no lesson is suspicious. Either Keel is genuinely
good here — say so explicitly in the journal, because that is the result you are looking
for — or the step was skipped.

### 5. Turn every mistake into a mechanism

**Any mistake made or found this iteration becomes a lesson before the task can close** —
your own errors included, and especially those.

Write `.orchestration/lessons/L-NNN.md` with `enforced_by` naming the mechanism that
prevents recurrence, strongest available first:

| | |
|---|---|
| `test` | cannot recur silently — **strongest** |
| `lint` | cannot be expressed |
| `hook` | blocked at write time |
| `gate` | caught before the turn ends |
| `example` | a worked reference to pattern-match |
| `rule` | path-scoped, loaded when relevant |
| `doc` | a CLAUDE.md line — **weakest** |

Then **build that mechanism**. `pnpm verify` fails if a lesson names enforcement that does
not exist, or if an under-enforced lesson passes its grace window.

A lesson recorded as prose is worse than none: it costs context on every turn and gets
missed anyway. Six agents read a self-contradicting comment in `schema.ts` and not one
fixed it, because nothing made them.

### 6. Record the outcome

```bash
node scripts/loop-guard.mjs record-success <task-id>
# or, on a red gate:
node scripts/loop-guard.mjs record-failure <task-id> "<verify output>"
```

Not bookkeeping. `record-failure` is what trips the circuit breakers and exits 2 when one
fires. Skipping it disables the loop's only real safety system.

### 7. Checkpoint the state

```bash
pnpm loop:status
```

Rewrites `RESUME.md` and `status.md` from real repository state. Run it after every step,
not once at the end.

### 8. Land

- `pnpm verify` green, then commit with a message explaining *why*.
- Push. Confirm CI green before considering the task done.
- Set `status: done`, remove the lock, append a journal entry naming the friction found.

### 9. Checkpoint with the human

Stop and report after **every completed testbed feature**, not every task. Say what
shipped, what friction it exposed, what Keel work that generated, and what is next.

Individual Keel tasks pulled mid-feature need no checkpoint.

---

## Validating with fresh agents

Every third feature, and before declaring any Keel phase complete, spawn 1–3 cold
subagents in worktrees to build the next feature without being told how. Ask each for a
friction log including their own errors, how many files they read before writing correct
code, and which read unblocked them.

Two prior runs found an unimplementable rule, a missing migration baseline, a security
hazard in `'use server'` exports, and a circuit-breaker condition caused by the design
itself. None were visible from the inside.

**Spawning an agent into another directory:** it inherits *this* session's CLAUDE.md, not
the one where it is working. Tell it explicitly to read the CLAUDE.md in its worktree. See
`.orchestration/lessons/L-006.md`.

---

## Circuit breakers — halt immediately

Enforced by `scripts/loop-guard.mjs`, which writes `.orchestration/blocked/<task>.md` and
exits 2.

| Trip | Threshold |
|---|---|
| Identical verify failure | 3× |
| Iterations on one task | 8 |
| Gate red at the end of consecutive turns | 2 |
| Run iteration budget | `KEEL_LOOP_MAX_ITERATIONS`, default 60 |
| A fix requires changing a shipped design | any — stop and ask |
| Validation agents contradict the design | any — a design problem, not a bug |
| Cannot satisfy an acceptance item and cannot say why | any |

A blocked report must contain what was attempted, the exact failure, what was ruled out,
and the specific decision needed — enough that triage needs no transcript.

---

## Crash safety

**This run can end without warning** — credit exhaustion, a session limit, a closed
terminal — and the next session starts with **zero memory**, possibly days later.

- **State is derived, never remembered.** `pnpm loop:status` reconstructs everything from
  task frontmatter, locks and git history. Never hand-maintain status; never rely on
  cleanup code running at exit.
- **Commit in working increments.** Uncommitted work is ambiguous to the next session; a
  `wip:` commit is unambiguous and recoverable.
- **Push before long operations.** Unpushed commits exist on one machine only.
- **Never stop with the gate red.** Red plus no context is the worst handoff. Get to
  green — reverting is allowed — then write what happened to the journal.
- **Locks expire at 45 minutes.** A killed process must never wedge the loop.
- **Leave a breadcrumb** in the journal before anything multi-minute.

### Resuming after an interruption

1. `pnpm loop:status`
2. Read `RESUME.md` — it says whether the stop was clean or mid-task.
3. If mid-task: `pnpm verify`. Green means commit and continue; red means finish or revert
   to the last green commit. Never build on a red gate.
4. Reclaim stale locks, then continue from step 2 above.

---

## Rules for the loop itself

**Never mark a task done with unmet acceptance items.** Partial completion is a blocker.
If an item is wrong, say so and propose a change — do not silently drop it.

**Never edit acceptance criteria to match what you built.** The most tempting failure
available to an autonomous loop, and it silently destroys the entire gate.

**Never build a `predicted` task because it is next.** Wait for demand.

**Adopt before building.** If an existing tool does the generic half, use it and build
only the layer above.

**Report honestly.** If something is skipped, say so. If a test is flaky, say so. A loop
that reports success it did not achieve is worse than a loop that stops.
