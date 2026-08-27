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
- `db()` is lazy and must stay that way — importing this package must never open a
  connection, or `pnpm verify` breaks on a clean checkout.

## Migrations are generated at integration time, not on your branch

**Do not run `pnpm db:generate` on a feature branch.** Change the schema only. The
integrator generates one migration after merging.

Three parallel branches each generating a correct delta still collide on
`meta/_journal.json` and on identically-numbered snapshots. A branch containing new files
under `drizzle/` will be rejected. See `.orchestration/lessons/L-005.md`.

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
