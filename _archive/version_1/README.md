# Keel

Most starters optimise the first hour. This is about the ten thousandth run.

Hour one is easy. Any scaffold gets you a running app. The hard part shows up two years later,
when nobody remembers why a constraint is there, half the docs stopped being true, and the thing
about to change your billing code has never seen the codebase.

## What you're actually working with

If you're building something large and pointing coding agents at it, be blunt about the crew.

They forget everything. Every session starts cold — no tenure, no memory of what was tried
before, nobody to ask. They see a fraction: a context window holds a few percent of a real
codebase, and whatever the agent knows about your system it read four minutes ago from whatever
files it happened to open. And if parallelism is the point, you'll have several running at once
with no shared state, coordinating only through the repo.

That's not changing. So the question isn't how to help an agent understand the codebase. It's
what has to be true of a codebase for it to be safely extended by workers who never will.

## The thesis

Correctness should be local. Verification should be structural.

Local means an agent can be right about the code in front of it without knowing the rest of the
system. Structural means the checks can't be satisfied by weakening them.

The measure isn't week-one velocity. It's whether feature ten thousand goes in as safely as
feature one, and whether the tenth agent to touch your auth code is as trustworthy as the first.

## The problems

### Correctness is global when it needs to be local

In most codebases, changing X safely requires knowing about Y and Z. Fine for someone two years
in with the map in their head. Not fine for an agent holding three percent of the repo.

The failure isn't bad code. It's locally plausible code with non-local consequences:

- A query that reads correctly and forgets the tenant filter.
- A migration that drops a column while the previous version is still serving traffic.
- A cascade delete that empties a table three joins away.
- A cache invalidation covering the list route and not the detail route under it.

Each looks fine in the diff. Documenting the invariant doesn't help, because the agent doesn't
know to go looking — that's the actual problem.

What works is making the invariant unbreakable from inside the code the agent can see. Brand the
tenant identifier as a distinct type and require it in every query signature. Now an agent that
has read none of your documentation still can't write an unscoped query, because it won't
compile. The constraint lives in the type instead of in someone's memory.

Same principle elsewhere. Make the database handle and the environment lazy functions rather
than module-level constants, and a missing variable can't take down a build. Point cascades
inward only, and deleting a user can't reach sideways into another tenant's data.

### You can't grade your own homework

Generating code is cheap. Knowing whether it's right is the constraint, and a human reading
every line is what doesn't scale.

The obvious move is to have the agent write tests. But the agent that wrote the code wrote the
test, and if a test stands between it and finishing, the test can be adjusted. Not from malice —
a red check reads as an obstacle rather than as information.

So you want checks that can't be weakened into passing:

- **Types.** Strict, `noUncheckedIndexedAccess`, no non-null assertions.
- **Module resolution.** A package that doesn't declare a dependency fails to build when it
  imports one. There's no comment that suppresses that.
- **Database constraints.** Uniqueness, foreign keys, `NOT NULL`. If two things must not both
  exist, that belongs in an index, not an `if`.
- **A termination gate.** Wire the full check into wherever the agent decides it's done, so
  finishing on a broken repo isn't possible.

Two properties matter as much as the gate existing. It has to be fast — a slow gate gets turned
off, so speed is a correctness property. And it has to be the same command CI runs, or the agent
and the pipeline will disagree about whether the code works.

### A thousand reasonable decisions make an unreasonable codebase

Session one puts authorisation in the route handler. Session four hundred puts it in the query
layer. Neither is wrong. Together they mean you can't answer "is this endpoint safe" without
reading all of it, and there's no single commit to blame.

Teams handle this with review and people who've been around long enough to say we don't do it
that way. Agents have neither. A convention held together by habit doesn't survive contributors
with no memory.

Two mechanisms, and you want both.

**Structural.** Boundaries the build enforces. One schema file per feature so concurrent work
doesn't collide. Authorisation expressed once as a composable predicate and imported, never
re-derived inline — that's how one query ends up quietly more permissive than the rest.

**Contextual.** Constraints attached to the paths they govern, loaded only when something
touches those paths. Rules about migrations should appear when an agent edits the schema and
stay out of the way otherwise. Context spent reading instructions that don't apply is context
not spent on the work.

### The why evaporates

A codebase is a pile of decisions. Why is this column nullable. Why doesn't this one cascade.
What is this apparently redundant check doing.

A person asks somebody. An agent has nobody, so it removes what looks redundant, and the
consequence surfaces months later somewhere unrelated.

Writing it down is necessary and not sufficient. Nobody reads fifty documents, least of all
something trying to close the task in front of it. And prose rots — a document that's
confidently wrong is worse than none, because the agent acts on it.

Half of this is tractable. Require every recorded lesson to name the mechanism that prevents
recurrence — a specific test, lint rule, or type — and fail the build when that mechanism
doesn't exist. A lesson claiming enforcement it doesn't have is worse than one claiming none.
That gives you an integrity constraint on your own knowledge, and a promotion ladder:

```
test  >  lint rule  >  hook  >  build gate  >  worked example  >  written rule  >  note
```

"Remember to" is the bottom of that list, not the top. A lesson that sits there isn't a lesson
yet.

The other half I don't have a good answer for. Storage without retrieval is a filing cabinet.
How does an agent arriving cold find the three decisions bearing on the change it's about to
make, without reading everything? Path scoping is a rough proxy — it assumes relevance follows
directory structure, which is often true and sometimes badly wrong. Something better exists. I
haven't found it.

### Two agents, two kinds of collision

**Physical.** Two agents editing the same file. Mostly a layout problem: give every feature its
own schema file and its own package and concurrent work rarely touches the same lines. Duller
than a locking protocol and more effective.

**Semantic.** Agent B builds against a contract agent A just changed. Both are individually
correct, both pass their own checks, and the result is broken. Narrow interfaces that fail at
compile time help. So does identifying the genuinely shared surfaces and serialising work on
those instead of assuming everything parallelises.

## What follows

Roughly in order of leverage.

Put invariants in the compiler, the module system, or the database. If it matters, it doesn't
belong in prose that might not be read.

Make done executable. A definition of done that's a judgement call gets judged generously by
something that wants to stop.

Keep the entry point short and scope the rest to the paths where it applies.

Record decisions with a constraint attached. Knowledge that can silently go false is a
liability.

Prefer layout to protocol. An arrangement where collisions are rare beats a mechanism for
resolving them.

Ship a worked example instead of instructions. A vertical slice that compiles teaches the shape
faster than a page describing it, and it can't drift, because it's in the build.

One thing worth saying plainly. Prebuilt subsystems aren't a time-saver, and reading them that
way misses the point. Multi-tenancy in the box is there so every query signature demands a
scope, which means the compiler enforces tenancy for code nobody has written yet. Same code,
different argument entirely.

## Open questions

None of this makes an agent trustworthy. It makes a codebase where an untrustworthy agent does
less damage and gets caught sooner. Different goal, more achievable.

What's still unsolved:

- **Retrieval.** How an agent finds the decisions relevant to its change without reading
  everything. Path scoping is the crude version.
- **Retirement.** A decision that was true and no longer is looks identical to one that still
  holds. Nothing detects the difference.
- **Unit of parallelism.** Feature, package, file? Too coarse wastes the labour. Too fine and
  the semantic collisions come back.
- **Structural staleness.** Lesson enforcement can be checked mechanically. Whether the same
  trick works for documentation describing a world that's moved on, I don't know.
- **Scale.** All of the above is reasoned from the properties of the workers. That's an
  argument, not evidence. Whether it holds at ten agents is untested.

## License

MIT
