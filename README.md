# Keel

**Most starters optimise the first hour. Keel is about the ten-thousandth run.**

Hour one is easy — any scaffold gets you a running app. What decides whether a large platform
survives is what happens two years in, when nobody remembers why a constraint exists, the
documentation quietly stopped being true, and the thing about to change it has never seen the
codebase before.

This document is about that problem, not about a feature list.

---

## The permanent condition

If you are building a large platform primarily with coding agents, your workers have three
properties that will not change:

**They forget everything.** Every session begins from nothing. There is no tenure, no "I
remember when we tried that," no colleague to ask.

**They see a fraction.** A context window holds a slice of a large codebase, and never the
whole. Whatever the agent knows about your system, it learned in the last few minutes, from
whatever it happened to open.

**Eventually there are many at once.** The value of agent labour is parallelism. That means
concurrent writers with no shared memory and no ability to coordinate by talking.

These are not limitations to engineer around. They are the operating conditions. So the
question is not "how do we help an agent understand the codebase?" — it is:

> **What must be true of a codebase for it to be safely extensible by workers who will never
> understand it?**

## The thesis

> A codebase where **correctness is local** and **verification is structural**, so that an
> unbounded number of forgetful, partially-sighted workers can extend it safely, in parallel,
> indefinitely.

The measure of success is not velocity in week one. It is whether **feature ten thousand is as
safe to add as feature one** — and whether the tenth agent to touch a subsystem is as
trustworthy as the first.

## Five problems

### 1. Correctness is global, and it needs to be local

In most codebases, changing X safely requires knowing about Y and Z. A human accumulates that
map over years. An agent has minutes and 3% of the repo.

The consequence is not that agents write bad code — it is that they write *locally plausible*
code with non-local consequences. A query that forgets a tenant filter. A migration that
breaks a deploy because the old version is still running. A cascade that deletes something
three tables away.

**Why the obvious fix fails.** "Document the invariants" doesn't work, because the agent
doesn't know to look — the whole problem is that it doesn't know what it doesn't know.

**The shape of a solution:** make the invariant impossible to violate *from inside the slice
the agent can see.* If tenancy is a branded type that every query signature demands, an agent
that has read none of your documentation still cannot write an unscoped query — the compiler
refuses. The knowledge lives in the type, not in a person.

### 2. Verification is the bottleneck, and self-graded work doesn't count

Generation is cheap now. Knowing whether the output is right is the constraint, and a human
reviewing everything is the thing that doesn't scale.

The trap: "the agent writes tests" is self-graded homework. An agent that can weaken a check
to make it pass will eventually do so, not from malice but because a failing check looks like
an obstacle rather than information.

**The shape of a solution:** verification the agent cannot satisfy by weakening it. Types,
module resolution, database constraints — checks where the only way through is to be correct.
And a **hard stop**: a gate wired into the agent's termination path, so finishing a turn on a
broken repository is not possible rather than merely discouraged.

Two properties matter as much as the gate's existence. It must be **fast** — a slow gate gets
disabled, so speed is a correctness property. And it must be **the same gate CI runs**, or the
agent and the pipeline will disagree about reality.

### 3. Entropy from locally-reasonable choices

Session 1 puts authorization here. Session 400 puts it there. Neither is wrong. Together they
are mud, and no single commit is the culprit.

Human teams solve this with culture, review, and people who have been there a while. Agents
have none of those. Convention held only by habit does not survive contributors with no
memory.

**The shape of a solution:** conventions that are mechanically enforced, and *discoverable at
the moment of writing* rather than at review. Two mechanisms, and both are needed:

- **Structural** — if a package doesn't declare a dependency, importing it fails the build.
  There is no comment that suppresses that. Physical enforcement beats procedural politeness.
- **Contextual** — constraints scoped to paths, so the rules about schema design surface when
  something touches the schema, and stay out of the way otherwise. Context spent reading
  irrelevant instructions is context not spent on the problem.

### 4. The "why" evaporates — and this is the hard one

A codebase is a pile of decisions. Why is this column nullable? Why doesn't this cascade? Why
is this apparently redundant check here?

A human asks someone. An agent has nobody, so it does the reasonable thing: it tidies up
something load-bearing, and the failure appears three months later somewhere else.

**Why the obvious fix fails.** Writing it down is necessary and nowhere near sufficient. Nobody
reads fifty documents, least of all a worker optimising for the task in front of it. Worse,
written knowledge decays — and a document that is confidently wrong is more dangerous than one
that doesn't exist.

**The shape of a solution has two halves, and the second is the unsolved one:**

**Storage that cannot lie.** Every recorded lesson names the mechanism that prevents its
recurrence — a test, a lint rule, a type — and the build fails if that mechanism is absent.
A lesson claiming enforcement it does not have is worse than one claiming none. This turns a
knowledge base into something with an integrity constraint, and gives a promotion ladder worth
following: *a test beats a lint rule beats a hook beats a gate beats an example beats a
written rule beats a note.* "We should remember to…" is the last resort, not the first.

**Retrieval at the point of need.** Storage without retrieval is a filing cabinet. The
open question is how an arriving agent loads exactly the relevant *why* — the three decisions
that bear on what it is about to change — without reading everything. Path-scoped rules are a
crude first version. A richer index over decisions, contracts and lessons is the obvious next
step and is genuinely unsolved.

### 5. Collisions, physical and semantic

Parallel agents fail in two different ways, and they need different answers.

**Physical** — two agents editing the same file. Solvable by layout: if every feature owns its
own schema file and its own package, concurrent work rarely touches the same lines. This is
duller and more effective than a locking protocol.

**Semantic** — agent B builds on a contract agent A just changed. This one is nastier, because
both agents are individually correct and the result still doesn't work. The mitigations are
narrow interfaces that fail loudly when broken, and serialising the genuinely shared surfaces
rather than pretending everything is parallelisable.

## What follows

The design principles that fall out of the above, in rough order of leverage:

1. **Make invariants structural.** If it matters, it should be enforced by the compiler, the
   module system, or the database — not by prose an agent may never read.
2. **Make done executable.** A definition of done that is a judgement call will be judged
   generously by something that wants to finish.
3. **Keep the entry point short.** Context spent on instructions is context not spent on the
   problem. Scope the rest to the paths where it applies.
4. **Record why, with an integrity constraint.** Knowledge that can silently become false is a
   liability, not an asset.
5. **Prefer layout to protocol.** A file arrangement that makes collisions rare beats a
   mechanism that resolves them.
6. **Ship worked examples, not instructions.** A vertical slice that compiles teaches shape
   faster than a page describing it — and it cannot drift, because it is in the build.

## What this is not

**It is not a feature list.** Prebuilt subsystems earn their place by *establishing
invariants* — multi-tenancy exists so that every query signature demands a scope, and the
compiler then enforces that for code nobody has written yet. Read as a time-saver, the same
code is just another starter.

**It is not a promise of autonomy.** None of this makes an agent trustworthy. It makes a
codebase where an untrustworthy agent does less damage and gets corrected faster.

**It is not finished thinking.** Retrieval of the *why* is genuinely open. So is proving that
parallel agents hold up under real load rather than in principle.

## Open questions

The honest list of what this thesis does not yet answer:

- **How does an agent find the three decisions that matter** to the change it is making,
  without reading everything? Path-scoping is a crude proxy for relevance.
- **How is a decision retired?** A lesson that was true and no longer is has the same shape as
  one that is still true.
- **What is the right unit of parallelism?** A feature, a package, a file? Too coarse wastes
  the labour; too fine reintroduces semantic collisions.
- **Can documentation staleness be made structural**, the way lesson enforcement is — a check
  that fails when a document describes a world that has moved?
- **Does any of this hold at ten agents?** Everything above is reasoned from the properties of
  the workers. Reasoning is not evidence.

## License

MIT
