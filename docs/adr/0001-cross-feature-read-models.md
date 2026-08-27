# 1. Cross-feature read models live in a composition package

**Status:** accepted · 2026-08-27 · forced by T-07

## Context

The agenda — everything due today or overdue — reads todos, the lists they belong to, and
the tags on them. It spans three feature packages and belongs to none.

The question was left open at decomposition, recorded as unresolved, and deliberately
deferred rather than guessed at. T-07 was scheduled specifically to force it, because a
made-up answer would have been indistinguishable from a considered one until something
real depended on it.

Every non-trivial application hits this. Search, an admin surface, a dashboard, an export —
each reads across boundaries that writes respect.

## Decision

**A cross-feature read model lives in a package that depends on several features and is
depended on by nothing except the app.** It is a leaf in the dependency graph.

`testbed/agenda` depends on `testbed/todos`, `testbed/lists` and `testbed/tags`. Nothing
depends on it but `apps/web`. The graph stays acyclic and no feature package ever learns
about another.

It writes **no SQL of its own**. It calls each feature's own read functions and merges the
results, so every table keeps exactly one package that knows how to query it.

## Alternatives rejected

**Put it in the most-involved feature.** The first draft did this: `listAgenda` lived in
`todos` and joined `list` for a name. It works, and it is how the erosion starts — the next
cross-feature field makes todos read a third table, and "the todos package" quietly becomes
"the package that knows about everything". Ownership decays one reasonable commit at a time.

**Put it in `apps/web`.** The app composes components, not queries. Query logic there
cannot be unit-tested against a database, and `.claude/rules/web.md` already says the app
stays thin. This would have been the path of least resistance and the least reversible.

**A shared "core" package everything depends on.** Inverts the dependency: features would
depend on the composer, so the composer must know all of them *and* be importable by all of
them. That is a cycle waiting to happen and the usual origin of a god package.

## Consequences

**Cost: one round trip per feature instead of one join.** The agenda makes three queries
where a hand-written join would make one. That is the right trade at this size, and the
escape hatch — a join written inside the composition package — is available without moving
any ownership, because the package already depends on everything it would need.

**Composition packages are read-only.** A package that writes across features is a
distributed transaction wearing a disguise. Writes stay with the feature that owns the
table.

**This generalises.** T-18 (admin), T-19 (search) and any dashboard are the same shape and
should follow it rather than re-deriving an answer.

**`KeelDatabase` moved to `@keel/db`.** Composition packages need the database type without
writing SQL, and five identical `XDatabase` aliases were five reasons for packages to
depend on drizzle directly.
