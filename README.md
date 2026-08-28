# Keel

Anybody can catch fish in June.

High water, big hatch coming off, the fish are stupid and eating everything. You could throw a
cigarette butt out there and hang one. That's hour one with any new starter — everything works,
the demo runs, you feel pretty good about yourself.

August is the test. Water's low and clear, the fish have seen every fly in the shop, and you
find out whether you actually know the river or just got lucky in June.

Most starters optimise June. This is about the ten thousandth run — two years in, when nobody
remembers why a constraint is there, half the docs quietly stopped being true, and the thing
about to rewrite your billing code has never laid eyes on the codebase.

## Know what you're working with

If you're building something big and mostly pointing agents at it, be honest about the crew.

They forget everything. Every session starts cold. No tenure, no "we tried that in '24," nobody
to ask. They see a sliver — a context window holds a few percent of a real codebase, and
whatever the agent knows about your system it picked up four minutes ago from whatever files it
happened to open. And if parallelism is the whole point, sooner or later you've got several of
them working at once, sharing no memory, unable to coordinate except through the repo itself.

That's not going to change. It's the weather, not a bug.

So the useful question isn't how to help an agent understand the codebase. It's this: what has
to be true of a codebase for it to be safely extended by workers who will never understand it?

## The thesis

Correctness should be local. Verification should be structural.

Local, so an agent can be right about its own patch of water without knowing what's happening
around the bend. Structural, so the checks can't be sweet-talked by whoever's trying to knock
off for the day. Get both and you can point an endless supply of forgetful, half-blind workers
at the thing and it holds.

The test isn't how fast week one goes. It's whether feature ten thousand goes in as safely as
feature one, and whether the tenth agent to touch your auth code is as trustworthy as the first.

## Where it goes sideways

### Correctness is global when it needs to be local

In most codebases, changing X safely means knowing about Y and Z. That's fine for somebody who's
been around two years with the map in their head. It's hopeless for an agent holding three
percent of the repo.

The failure isn't bad code. It's locally plausible code with consequences somewhere else — a
query that forgets the tenant filter, a migration that takes down the deploy because the old
version's still serving, a cascade that quietly empties a table three joins away. Every one of
them looks fine in the diff.

Writing down the invariants doesn't fix it, because the agent doesn't know to go look. That's
the whole problem. It doesn't know what it doesn't know.

What works is making the rule unbreakable from inside the water the agent can actually see. Make
tenancy a branded type, demand it in every query signature, and an agent that's read none of
your documentation still can't write an unscoped query. The compiler won't have it. The
knowledge lives in the type instead of in somebody's head, which means it's still there long
after everybody who knew it has moved on.

The river doesn't care what you meant to do.

### Nobody grades their own homework

Generating code is cheap now. Knowing whether it's right is the expensive part, and a human
reading every line is exactly the thing that doesn't scale.

So the obvious move is to have the agent write tests. Except the same agent wrote the code, and
if a test is standing between it and being finished, that test can be adjusted. Not out of
malice. A failing check just looks like an obstacle instead of information.

You want checks that can't be satisfied by weakening them. Types. Module resolution. Constraints
in the database. Places where the only way through is to actually be right. Then a hard stop
wired into wherever the agent decides it's done, so finishing on a broken repo isn't an option
rather than just poor form.

Two things matter as much as having the gate at all. It has to be quick, because a slow gate is
a gate somebody switches off — speed is a correctness property here, not a nicety. And it has to
be the same gate CI runs, or your agent and your pipeline will disagree about whether the code
works, which is its own kind of afternoon.

### A thousand reasonable calls make an unreasonable codebase

Session one puts authorisation here. Session four hundred puts it over there. Neither is wrong.
Together they're a mess, and there's no single commit you can point at and blame.

People handle this with culture and review and somebody around long enough to say we don't do it
that way. Agents have none of that. A convention held together by habit doesn't survive
contributors with no memory.

Two things help and you want both. Structural: if a package doesn't declare a dependency,
importing it fails the build, and there's no comment that makes that go away. Physical beats
procedural, every time. And contextual: hang the constraints on the paths they govern, so the
schema rules turn up when something touches the schema and stay out of it otherwise. Context
burned reading instructions that don't apply is context not spent on the actual work.

### The why evaporates, and this one's hard

A codebase is a pile of decisions. Why's this column nullable? Why doesn't that one cascade?
What's this apparently redundant check doing here?

A person asks somebody. An agent's got nobody to ask, so it does the sensible thing and tidies
up whatever looks redundant. Then three months later something breaks somewhere else and looks
completely unrelated.

Writing it down is necessary and nowhere near enough. Nobody reads fifty documents, least of all
something trying to finish the task in front of it. And written knowledge rots — a doc that's
confidently wrong is worse than none at all, because now the agent goes and acts on it.

There's a piece of this I think you can actually solve. Make every recorded lesson name the
mechanism that keeps it from happening again — a test, a lint rule, a type — and fail the build
when that mechanism isn't there. A lesson claiming enforcement it doesn't have is worse than one
claiming none, so you end up with an integrity constraint on your own knowledge. It gives you a
pecking order worth following, too: a test beats a lint rule beats a hook beats a written rule
beats a note in a file. "We should remember to" is where you land when nothing better is
available, not where you start.

The other half I don't have a good answer for. Storage without retrieval is a filing cabinet.
How does an agent showing up cold find the three decisions that bear on what it's about to
change, without reading everything? Scoping rules by path is a rough proxy — it assumes
relevance follows the directory tree, which is often true and occasionally very wrong. There's
something better out there. I haven't found it yet.

### Two agents, two kinds of collision

The physical one is boring. Two agents in the same file. You mostly fix that with layout: give
every feature its own schema file and its own package, and concurrent work rarely lands in the
same lines. Duller than a locking protocol and it works better.

The semantic one is meaner. Agent B builds on a contract agent A just changed. Both of them are
right, both pass their own checks, and the thing still doesn't work. Narrow interfaces that
break loudly help. So does admitting some surfaces are genuinely shared and putting work on
those in single file, instead of pretending everything runs in parallel.

## What falls out of all that

A few principles, roughly in order of what they buy you.

Put invariants in the compiler, the module system, or the database. If it matters, it doesn't
belong in prose that might never get read.

Make done executable. A definition of done that's a judgement call gets judged generously by
something that wants to stop.

Keep the entry point short and hang everything else off the paths where it applies.

Record the why, and put a constraint on it. Knowledge that can quietly go false is a liability,
not an asset.

Prefer layout to protocol. An arrangement where collisions are rare beats a mechanism for
sorting them out.

Ship worked examples instead of instructions. You don't teach somebody a river by handing them a
diagram of it — you take them out and show them one run, properly, and they figure out the rest.
A vertical slice that compiles does the same job, and it can't drift, because it's in the build.

One more thing worth saying plainly: prebuilt subsystems aren't the point, and reading them as a
time-saver misses what they're for. Multi-tenancy in the box isn't "saves you a week." It's
there so every query signature demands a scope, which means the compiler now enforces tenancy
for code nobody has written yet. Same code, completely different argument.

## What I'm still chewing on

None of this makes an agent trustworthy. It makes a codebase where an untrustworthy agent does
less damage and gets caught sooner. That's a different goal and a more achievable one.

A few things are genuinely open. How does an agent find the decisions that matter to the change
it's making without reading the whole cabinet? How do you retire one — a lesson that was true and
isn't anymore looks exactly like a lesson that still holds. What's the right unit of parallelism:
a feature, a package, a file? Too coarse and you waste the labour, too fine and the semantic
collisions come right back. Can you make documentation staleness structural the same way lesson
enforcement is — some check that fails when a document describes a world that's moved on?

And the big one. Does any of this hold at ten agents? Everything above is reasoned out from the
properties of the workers, sitting at a desk. That's a theory about the river. It isn't a day on
it.

## License

MIT
