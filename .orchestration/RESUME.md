# Resume here

_Written for someone with **no memory of previous sessions**. Everything needed to
continue is in this file or linked from it. Regenerate with `pnpm loop:status`._

Generated 2026-08-27 02:55 UTC.

---

## 1. What this project is

Keel — an agent-native Next.js starter with a spec-driven build harness. Phase 0 is
shipped and green. Phases 1-6 are being built by a loop.

- Why it is shaped this way: `docs/architecture.md`
- How one loop iteration works: `.orchestration/loop-protocol.md`
- Conventions you must follow: `CLAUDE.md`

## 2. State of the working tree

**MID-TASK.** A previous session stopped before finishing. Handle these first:

1. There are uncommitted changes:

```
M .orchestration/loop-protocol.md
 M CLAUDE.md
 M package.json
?? .orchestration/RESUME.md
?? .orchestration/status.md
?? scripts/loop-status.mjs
```

Run `pnpm verify`. If green, commit them. If red, decide whether to finish the work or run `git checkout -- .` and restart the task cleanly.

## 3. Do this next

**P1-01 — Pilot code graph engines against this repo**

```bash
cat .orchestration/tasks/P1-01.md
```

Then follow `.orchestration/loop-protocol.md` from step 2 (Claim). The task's
**Acceptance** list is the definition of done — never edit it to match what was built.

## 4. Before you stop

Credit and session limits end a run without warning, so **leave the repo resumable at all
times**:

- Commit working increments as you go. Uncommitted work is ambiguous to the next session.
- Run `pnpm loop:status` after every step — it rewrites this file from actual state.
- Never leave the gate red at a stopping point. Red plus no context is the worst handoff.
- If you stop mid-task, write why in `.orchestration/journal/`.

## 5. Progress

- Phase 1: 0/5
- Phase 2: 0/4
- Phase 3: 0/3
- Phase 4: 0/5
- Phase 5: 0/3
- Phase 6: 0/3

Full dashboard: `.orchestration/status.md`
