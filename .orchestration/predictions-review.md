# Predictions, reviewed against 24 iterations

The loop protocol says a prediction never demanded should be deleted, and that the deletion
is itself a finding. This reviews all 21 remaining `P-*` tasks against what actually happened
while building the testbed.

**One boundary is drawn deliberately.** Four of these predictions restate goals stated at the
outset — a self-updating graph, self-maintaining documentation, multi-agent territories, and
PRD-driven backlog generation. Evidence that the testbed never demanded them is not authority
to delete them: "the app I chose to build did not need it" and "the person who asked for it
was wrong" are different claims, and only the first is supported here. Those are marked
**recommendation** rather than deleted, with the evidence laid out for a decision that is not
mine.

---

## P1-01 … P1-05 — the code graph

**Prediction:** a queryable graph of the codebase, wired as an MCP server, consulted before
file search, and used by a `graph validate` step in the gate.

**Evidence: ten iterations, none of which wanted it.** Every feature from T-11 onward was
checked against the question "would a graph have helped here?" Nine journal entries carry the
answer. Each was a case the prediction names explicitly — a cross-cutting concern spanning
every package:

| Task | What it touched | What actually found the problem |
|---|---|---|
| T-11 | orgs across every package | `tsc` — 62 compile errors formed a complete worklist |
| T-14 | every mutation in every feature | `grep` for `.returning()`; a type signature |
| T-15 | a second auth mechanism | `tsc` refusing an import; reading twelve lines of `resolveScope` |
| T-16 | queue, schema, three packages | running it — two driver incompatibilities |
| T-17 | schema, two packages, worker, app | a failing assertion and DST cases written by hand |
| T-18 | a second authorization model | knowing every customer owns an organization |
| T-19 | every package | `uptime`, `ps`, a per-file timing |
| T-20 | first stateful connection | `NOTIFY` has no replay; `0` is a real cursor |
| T-21 | billing across features | **Turbo's cycle check** — already in the gate, free |
| T-22 | shared runtime state | read-then-write races; an office shares an IP |

The pattern is consistent and worth stating precisely: **the failures were semantic, not
structural.** A graph answers "what references this?" Not one of these tasks was blocked on
that question. They were blocked on what a function *does in its failure branch*, what a
provider guarantees, what `0` means, and what happens under concurrency — none of which is in
a call graph.

The one case that genuinely needed structural analysis, T-21's dependency cycle, was caught by
`turbo` on the next build, for free.

**Also relevant:** the codebase is now 26 workspace packages and roughly 380 unit tests, past
the size the design predicted would make a graph necessary. It did not become necessary.

**Recommendation: delete P1-01 through P1-05.** The strongest evidence available over ten
iterations says the gate's existing tools — `tsc`, Turbo, lint, and tests — occupy this space
completely. Flagged rather than deleted because a self-updating graph was an explicit goal.

---

## P2-01 … P2-04 — documentation validation and generation

**Prediction:** node IDs, doc frontmatter with signature hashing, a `docs validate` gate step,
and generated documentation.

**Evidence: mixed, and the most interesting of the set.**

Against: documentation has stayed accurate across 24 iterations without any mechanism, because
each task updated its own. No reader has been misled by a stale document.

For: **staleness did happen twice, and neither was caught.**

- `/admin/jobs` carried a comment saying proper role-gating would arrive with T-18. It was
  accurate, dated, and sat in the tree for six tasks while every customer could read every
  tenant's failing job payloads.
- `docs/platform-readiness.md` had four rows built long ago and never marked done. Harmless,
  but it is exactly the drift the prediction describes.

Neither would have been caught by signature hashing, which detects *code changing under a
document*. Both were documents describing a state that had changed, with no code edit to
trigger a check.

**Recommendation: delete P2-01, P2-02 and P2-04; keep the idea behind P2-03 in a narrower
form.** What the evidence supports is not generated docs or hashing — it is a check that a
document claiming "arrives with T-18" fails once T-18 is done. That is a five-line grep over
task references, not a documentation graph.

---

## P3-01 … P3-03 — extracting the harness

**Prediction:** the orchestration harness as a portable plugin, with core skills and subagent
definitions.

**Evidence: never demanded, and no friction pointing at it.** The harness worked throughout.
Extracting it is packaging for reuse elsewhere, which is a real goal and an entirely separate
project — nothing in building the testbed asked for it.

**Delete P3-01, P3-02, P3-03.** Not because they are bad ideas, but because there is no
evidence from this build either way, and carrying an untested prediction in a backlog is how
it eventually gets built for its own sake.

---

## P4-01 … P4-05 — territories and multi-agent fan-out

**Prediction:** territory schemas, a `PreToolUse` guard, atomic task claims, worktree flow, and
`graph_disjoint` for safe parallel fan-out.

**Evidence: absence, not contradiction.** These were never exercised because every iteration
after the Phase 0.1 experiment ran as a single agent. That is not evidence they are
unnecessary — it is no evidence at all.

What the early three-agent run *did* establish, and what the codebase has since preserved
structurally: merge conflicts were eliminated by making schema files one-per-feature rather
than by any territory mechanism. Run 1 had eight shared files and two of three merges
conflicted; run 2 had none. The problem territories exist to solve was solved by file layout.

**Recommendation: delete P4-05 (`graph_disjoint`), which depends on the graph and inherits its
evidence. Keep P4-01 through P4-04 pending an actual multi-agent run.** Multiple simultaneous
agents was an explicit goal, and the only honest way to test these is to run several and see
what breaks — which has not been done since Phase 0.1.

---

## P5-01 … P5-03 — PRD ingestion and backlog generation

**Prediction:** ingest a PRD, detect judgment calls, propose a domain model and schema,
generate a backlog and agent definitions.

**Evidence: never exercised.** The backlog here was written by hand from an architecture
document. The generation path has never been run, so nothing is known about whether it
produces a usable backlog.

**Recommendation: keep, untested.** This is the "initiation step" that makes the template a
template rather than one application — the thing a second user would touch first. Deleting it
would remove the feature that distinguishes this from a finished app, and it is the one
prediction whose value is *entirely* about the second user, who by definition has not appeared
yet.

---

## P6-02 — requirement traceability and termination

**Prediction:** trace requirements to tasks and decide when the loop is finished.

**Evidence: solved differently, and better.** `docs/platform-readiness.md` became the
termination condition — a capability list where every row is annotated with what proved it.
The loop finished when that list did, not when the task count reached a number, exactly as the
protocol intended.

**Delete.** The requirement was real; the prediction's mechanism was heavier than what worked.

---

## P7-01 — promote organizations out of the testbed

**Evidence: observed twice, unfixed.** `Scope` is a platform primitive that every package
takes, and the queries producing it live in `testbed/orgs`. `testbed/admin` exists in the
testbed only because it must reach them, despite being Keel machinery a template user would
want. T-24 then found that package had no unit tests at all.

**Keep.** This is the only prediction in the set written *from* observed friction rather than
before it, and it is still true.

---

## Summary

| Outcome | Predictions |
|---|---|
| Delete — evidence says the space is occupied | P1-01…05, P2-01, P2-02, P2-04, P4-05, P6-02 |
| Delete — no evidence either way, and no demand | P3-01, P3-02, P3-03 |
| Keep — narrowed by evidence | P2-03 |
| Keep — untested, and the goal predates this build | P4-01…04, P5-01…03 |
| Keep — observed friction | P7-01 |

Fourteen of twenty-one predictions did not survive contact with the work. That number is the
point of the exercise rather than an embarrassment: the alternative was building all
twenty-one first and discovering it afterwards, or never discovering it.

The single most transferable finding, from ten deliberate checks: **a type system, a fast
gate, and running the code occupied nearly all the space the graph was predicted to fill.**
The failures that actually cost time were semantic — what a function does when it fails, what
a provider guarantees, what a sentinel collides with — and structural analysis does not see
any of them.
