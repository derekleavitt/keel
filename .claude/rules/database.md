---
description: Rules for schema and migrations
paths: ["packages/db/**"]
---

# Schema changes are migrations

- Never edit a file under `packages/db/drizzle/` by hand. Change `src/schema.ts`, then
  run `pnpm db:generate`.
- The `user`, `session`, `account` and `verification` tables are dictated by the Better
  Auth adapter. Do not rename their columns.
- Application tables belong in their own feature package, not appended to `schema.ts`.
- `db()` is lazy and must stay that way — importing this package must never open a
  connection, or `pnpm verify` breaks on a clean checkout.
