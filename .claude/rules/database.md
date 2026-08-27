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

## Where feature tables go

**In this file.** All tables live in `packages/db/src/schema.ts`.

This is deliberate and is not the same as "packages own their code". `drizzle.config.ts`
reads only this module, and `db()` hands the assembled `schema` object to the Better Auth
adapter. Defining a table in `packages/<feature>` would require `@keel/db` to import that
feature package — a workspace dependency cycle, which Turbo hard-fails.

To add tables without fighting other branches:

1. Define your tables in this file.
2. Group them: `export const todoTables = { todo, todoTag };`
3. Add **one** spread line to the `schema` object: `...todoTables,`

Parallel branches then append distinct lines instead of all editing the same literal,
which turns the most collision-prone line in the repo into a mechanical merge.

Everything else about your feature — queries, actions, validation — belongs in your own
package. Only the table definitions live here.
