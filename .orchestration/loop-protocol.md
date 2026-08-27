# Loop protocol

One iteration of the build loop. Follow this exactly; do not improvise the order.

Backlog: `.orchestration/tasks/P*.md`. Journal: `.orchestration/journal/`.
Blockers: `.orchestration/blocked/`.

---

## One iteration

### 1. Orient (do not skip)

- Read `.orchestration/status.md` if present, and the last two journal entries.
- List open tasks whose `depends_on` are all `done`. Pick the lowest-numbered one.
- If none are unblocked, stop and report — that is a real finding, not a stall.

### 2. Claim

```bash
mkdir .orchestration/locks/<task-id>   # atomic; EEXIST means someone else has it
```

Set `status: claimed` in the task file.

### 3. Build

Implement against the task's **Acceptance** list. That list is the definition of done —
not your judgment of when it feels complete.

Rules that do not bend:

- `pnpm verify` must pass. Never weaken a check, delete a failing test, or add a
  suppression to get past it.
- Nothing throws at import time. `pnpm verify` must still pass with no `.env`.
- Any step added to the gate must keep warm verify under ~3s. The gate fires on every
  turn; a slow gate gets switched off, and then none of this works.

### 4. Validate with fresh agents

**This is the step that has actually caught things, twice. Do not skip it.**

Spawn 1–3 cold subagents in worktrees to use what you just built, without being told what
it should do. Ask each for: what they built, a friction log including their own errors,
how many files they read before writing correct code, and which read unblocked them.

Two prior runs found: an unimplementable rule, a missing migration baseline, a security
hazard in `'use server'` exports, and a circuit-breaker condition caused by the design
itself. None were visible from the inside.

Record results in the journal. If validation contradicts the design, **fix the design**
and say so — do not rationalise it.

### 5. Document

- Update `docs/architecture.md` where the phase changed it.
- Write an ADR for any real decision, including rejected options.
- Record field results in §12. Corrections belong in the doc, not just the commit.

### 6. Land

- `pnpm verify` green, then commit with a message explaining *why*, not just what.
- Push. Confirm CI green before considering the task done.
- Set `status: done`, remove the lock, append a journal entry.

### 7. Checkpoint

At the **end of a phase** (all its tasks done), stop and report to the human:
what shipped, what validation found, what changed in the design, what is next.

Do not begin the next phase until they respond. Individual tasks inside a phase need no
checkpoint.

---

## Circuit breakers — halt immediately

Write a full-context report to `.orchestration/blocked/<task-id>.md` and stop.

| Trip | Threshold |
|---|---|
| Identical verify failure | 3× |
| Iterations on one task | 8 |
| Verify red at the end of two consecutive iterations | 2 |
| A fix requires changing a completed phase's core design | any |
| Validation agents contradict the design | any — this is a design problem, not a bug |
| Warm verify exceeds 5s | any |
| Cannot satisfy an acceptance item and cannot say why | any |

A blocked report must contain: what was attempted, the exact failure, what was ruled out,
and the specific decision needed. Enough that triage needs no transcript.

---

## Rules for the loop itself

**Never mark a task done with unmet acceptance items.** Partial completion is a blocker,
not a pass. If an item turns out to be wrong, say so explicitly and propose a change —
do not silently drop it.

**Never edit the acceptance criteria to match what you built.** That is the single most
tempting failure mode available to an autonomous loop, and it silently destroys the
whole gate.

**Adopt before building.** Phase 1 exists because local-first code graphs are a mature
category. If an existing tool does the generic half, use it and build only the layer
above.

**Report honestly.** If something is skipped, say so. If a test is flaky, say so. A loop
that reports success it did not achieve is worse than a loop that stops.
