# Keel

Most starters optimise the first hour. This one is about the ten thousandth run.

Hour one is easy. Any scaffold gets you a running app, and every starter competes on how fast
that happens. But the first hour was never the hard part. The hard part is two years in, when
nobody remembers why a constraint exists, half the documentation quietly stopped being true,
and the thing about to change your billing code has never seen the codebase before.

That's the problem this is about.

## Start from what your workers actually are

If you're building a large platform mostly with coding agents, it helps to be blunt about what
you're working with. They forget everything — every session starts from zero, there's no
tenure, no "we tried that in 2024," nobody to ask. They see a sliver: a context window holds
maybe a few percent of a big codebase, and whatever the agent knows about your system it
learned four minutes ago from whatever files it happened to open. And if the whole point is
parallelism, you'll eventually have several of them running at once, with no shared memory and
no way to coordinate except through the repo itself.

None of that is going to change. It's not a limitation to engineer around, it's the weather.

Which means the useful question isn't "how do we help the agent understand the codebase." It's:
what has to be true of a codebase for it to be safely extended by workers who will never
understand it?

## The thesis

Correctness should be local, and verification should be structural.

Local, so an agent can be right about its slice without knowing the rest. Structural, so the
checks can't be talked around by whoever is trying to finish. Get both and you can point an
unbounded number of forgetful, half-blind workers at the thing and it survives.

The test isn't velocity in week one. It's whether feature ten thousand is as safe to add as
feature one, and whether the tenth agent to touch your auth code is as trustworthy as the
first.

## What actually goes wrong

### Correctness is global when it needs to be local

In most codebases, changing X safely means knowing about Y and Z. That's fine for someone
who's been around two years and has the map in their head. It's hopeless for an agent holding
3% of the repo.

The failure mode isn't that agents write bad code. They write locally plausible code with
non-local consequences — a query that forgets the tenant filter, a migration that breaks the
deploy because the old version is still serving, a cascade that quietly empties a table three
joins away. Every one of those looks fine in the diff.

"Write down the invariants" doesn't fix it, because the agent doesn't know to look. That's the
whole problem: it doesn't know what it doesn't know.

What does work is making the invariant unbreakable from inside the slice the agent *can* see.
If tenancy is a branded type and every query signature demands it, then an agent that has read
none of your docs still can't write an unscoped query. The compiler won't let it. The knowledge
lives in the type rather than in someone's head, which means it's still there long after
everyone who knew it has gone.

### You can't grade your own homework

Generating code is cheap now. Knowing whether it's right is the expensive part, and a human
reviewing everything is exactly the thing that doesn't scale.

So the obvious move is "have the agent write tests." Except the agent that wrote the code wrote
the test, and if the test is in the way of finishing, it can be adjusted. Not out of malice —
a failing check just looks like an obstacle rather than information.

You need checks that can't be satisfied by weakening them. Types. Module resolution. Database
constraints. Things where the only route through is to actually be correct. And then a hard
stop wired into wherever the agent decides it's done, so that finishing on a broken repo isn't
possible rather than merely frowned upon.

Two things matter as much as having that gate. It has to be fast, because a slow gate is a gate
somebody turns off — speed is a correctness property here, not a nicety. And it has to be the
same gate CI runs, or your agent and your pipeline will disagree about whether the code works,
which is its own special kind of afternoon.

### A thousand reasonable decisions make an unreasonable codebase

Session one puts authorisation here. Session four hundred puts it there. Neither is wrong.
Together they're mud, and there's no single commit you can point at.

Human teams handle this with culture and review and people who've been around long enough to
say "we don't do it that way." Agents have none of that. A convention held together by habit
doesn't survive contributors with no memory.

Two things help, and you need both. Structural enforcement: if a package doesn't declare a
dependency, importing it fails the build, and there's no comment that makes that go away.
Physical beats procedural every time. And contextual delivery: constraints attached to the
paths they govern, so the rules about schema design show up when something touches the schema
and stay quiet otherwise. Context spent reading irrelevant instructions is context not spent on
the actual problem.

### The why evaporates, and this is the hard one

A codebase is a pile of decisions. Why is this column nullable? Why doesn't this one cascade?
Why is there an apparently redundant check right here?

A person asks someone. An agent has nobody to ask, so it does the sensible thing and tidies up
whatever looks redundant — and the consequence shows up three months later, somewhere else,
looking like an unrelated bug.

Writing it down is necessary and nowhere near enough. Nobody reads fifty documents, least of
all something optimising for the task in front of it. And written knowledge rots: a document
that's confidently wrong is worse than one that doesn't exist, because now the agent acts on it.

There's a piece of this I think is tractable. Make every recorded lesson name the mechanism
that stops it recurring — a test, a lint rule, a type — and fail the build if that mechanism
isn't there. A lesson claiming enforcement it doesn't have is worse than one claiming none, so
you put an integrity constraint on your own knowledge base. It also gives you a ladder worth
following: a test beats a lint rule beats a hook beats a written rule beats a note in a file.
"We should remember to" is where you end up when nothing better is available, not where you
start.

The other half I don't have a good answer for. Storage without retrieval is a filing cabinet.
How does an arriving agent load the three decisions that bear on what it's about to change,
without reading everything? Scoping rules by path is a crude proxy — it assumes relevance
follows directory structure, which is often true and sometimes badly wrong. Something better
probably exists. I don't know what it looks like yet.

### Two agents, two kinds of collision

The physical one is boring: two agents editing the same file. You mostly solve it with layout.
If every feature owns its own schema file and its own package, concurrent work rarely lands in
the same lines. Duller than a locking protocol, and it works better.

The semantic one is nastier. Agent B builds on a contract that agent A just changed. Both are
individually correct, both pass their own checks, and the result doesn't work. Narrow
interfaces that fail loudly help. So does admitting that some surfaces are genuinely shared and
serialising work on those, rather than pretending everything parallelises.

## What follows from all that

A handful of principles, roughly in order of how much they buy you.

Make invariants structural. If something really matters, it belongs in the compiler, the module
system, or the database — not in prose that may never be read.

Make "done" executable, because a definition of done that's a judgement call will get judged
generously by something that wants to stop.

Keep the entry point short and scope everything else to where it applies.

Record the why, and put an integrity constraint on it. Knowledge that can silently become false
is a liability.

Prefer layout to protocol — an arrangement that makes collisions rare beats a mechanism for
resolving them.

Ship worked examples rather than instructions. A vertical slice that compiles teaches shape
faster than a page describing it, and it can't drift, because it's in the build.

One thing worth being clear about: prebuilt subsystems are not the point, and reading them as
a time-saver misses what they're for. Multi-tenancy shipped in the box isn't "saves you a
week." It's there so that every query signature demands a scope, which means the compiler now
enforces tenancy for code nobody has written yet. Same code, entirely different argument.

## What I'm still unsure about

None of this makes an agent trustworthy. It makes a codebase where an untrustworthy agent does
less damage and gets caught sooner, which is a different and more achievable goal.

And a few things are genuinely open:

How does an agent find the decisions that matter to the change it's making, without reading
everything? How do you retire a decision — a lesson that was true and no longer is looks
identical to one that still holds. What's the right unit of parallelism: a feature, a package,
a file? Too coarse and you waste the labour, too fine and the semantic collisions come back.
Can documentation staleness be made structural the way lesson enforcement can — some check that
fails when a document describes a world that's moved on?

And the big one: does any of this hold up at ten agents? Everything above is reasoned from the
properties of the workers. Reasoning isn't evidence.

## License

MIT
