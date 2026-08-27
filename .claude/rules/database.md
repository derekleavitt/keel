---
description: Rules for schema and migrations
paths: ["packages/db/**"]
---

# Schema changes are migrations

- Never edit a file under `packages/db/drizzle/` by hand. Change `src/schema.ts`, then
  run `pnpm db:generate`.
- A baseline migration is committed. Your `db:generate` should produce a small delta —
  if it emits every table in the repo, something is wrong; stop and say so.
- The `user`, `session`, `account` and `verification` tables are dictated by the Better
  Auth adapter. Do not rename their columns.
- **Use `.default(value)`, not `.$defaultFn()`, for any column that is NOT NULL.**
  `$defaultFn` is a JavaScript-side default that never reaches SQL, so the generated
  migration adds the column with no `DEFAULT` and fails on any table that already has
  rows. An empty test database cannot catch this — a static check over migration SQL does.
  See `.orchestration/lessons/L-018.md`.
- `db()` is lazy and must stay that way — importing this package must never open a
  connection, or `pnpm verify` breaks on a clean checkout.

## Migrations are generated at integration time, not on your branch

**On a feature branch: do not run `pnpm db:generate`.** Change the schema only.

**On `main`, you are the integrator: generate it.** That is the one place migrations are
created, and the distinction is the whole rule — three parallel branches each generating a
correct delta still collide on `meta/_journal.json` and on identically-numbered snapshots.
See `.orchestration/lessons/L-005.md`.

> **The commit history contradicts this and it is not a licence.** T-02, T-03 and T-04
> each landed a migration beside their feature, because that work happened directly on
> `main` where generating is correct. Nothing in those commits says so, so from a branch
> the history reads as "committing migrations is normal". It is not. A cold agent found
> this exact ambiguity and nearly followed the precedent over the rule.

### Testing schema changes on a branch

Your new tables exist in `schema` and in no migration, so `createTestDatabase()` cannot see
them — which would make a table's own tests unreachable on the branch that wrote it.

`@keel/db/testing` closes that: `applyPendingSchema()` derives the delta between the newest
committed snapshot and the live schema using the same `drizzle-kit` machinery as
`db:generate`, and applies it to the test database only. Nothing is written to `drizzle/`.
It no-ops when everything is already migrated.

You do not need to call it — `createTestDatabase()` does. See
`.orchestration/lessons/L-019.md`.

### Running the app on a branch

`pnpm db:migrate` applies committed migrations only, so your development database has no
tables for schema you have not migrated — the unit suite passes while every page touching
them returns a 500, and the default gate skips e2e so nothing says so.

```bash
pnpm db:sync     # push the current schema straight to the dev database
```

**Local development only.** It writes no migration and can drop columns to match; never
point it at anything you care about. When the work merges, the integrator generates the
real migration on `main`.

**Your tables are still testable before that migration exists.** `createTestDatabase()`
derives the pending delta from `schema` and applies it, so a branch tests its new tables
against real Postgres with real foreign keys and real cascades. You do not need to commit
a migration, and you must not hand-write `CREATE TABLE` in a test to work around it — that
asserts against DDL the test invented rather than against the schema. See
`.orchestration/lessons/L-017.md`.

## Where feature tables go

**One file per area, under `packages/db/src/schema/`.**

This is deliberate and is not the same as "packages own their code". `drizzle.config.ts`
reads only this module, and `db()` hands the assembled `schema` object to the Better Auth
adapter. Defining a table in `packages/<feature>` would require `@keel/db` to import that
feature package — a workspace dependency cycle, which Turbo hard-fails.

To add tables without fighting other branches:

1. Create `packages/db/src/schema/<feature>.ts` — a **new file**, which cannot conflict.
2. Export a group from it: `export const todoTables = { todo, todoTag };`
3. Add **two** lines to `schema/index.ts`: one `export * from './<feature>.ts';` and one
   `...todoTables,` spread.

Never add tables to a file another feature also touches. Appending to a shared module
conflicts on the import line and on adjacent table bodies even when each addition is
self-contained — measured, not theorised.

Everything else about your feature — queries, actions, validation — belongs in your own
package. Only the table definitions live here.
