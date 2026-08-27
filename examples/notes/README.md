# Reference slice: notes

**Copy this shape.** It exists because three independent agents, building three features
against this repo, each invented a different answer to the same question — and each one
flagged it as the highest-consequence decision they made with no guidance.

Rules describe. Examples demonstrate. This is the demonstration.

| File | Pattern it establishes |
|---|---|
| `schema.ts` | Table shape: `userId` on every row, timestamps, cascades pointing inward |
| `contract.ts` | Zod schemas with **no `userId` field**, and why the barrel is never imported here |
| `queries.ts` | **The one to read first** — the database seam, handle placement, structural scoping |
| `queries.test.ts` | Two users, always. Cross-user isolation on every operation |

## The three things that were being reinvented

**The database seam.** `db()` returns a postgres-js handle, `createTestDatabase()` a
PGlite one. `PgDatabase<PgQueryResultHKT, typeof schema>` is the supertype both satisfy,
so one helper runs in production and in tests. Without it the query layer — where
security actually lives — can only be typechecked.

**Where the handle goes.** `userId` must be first, `db()` must stay lazy. So the handle
is a trailing parameter defaulting to `db()`. The default evaluates per call, so
importing opens no connection and the gate still passes with no `.env`.

**How scoping is enforced.** `userId` is the branded `UserId`, so a raw string will not
compile. Every statement routes through `ownedBy()`, so forgetting the scope means
writing no predicate at all rather than a leaky one.

## Deliberate deviation

A real feature's table lives in `packages/db/src/schema/<feature>.ts` with two lines added
to `schema/index.ts`. This example keeps its table local so a cloned template does not
inherit a stray `example_note` table — and its test creates the table directly. That is
the only place this slice differs from a real feature.

## Deleting this

It is a workspace package, so `pnpm verify` covers it and it cannot rot. Remove
`examples/notes` and the `examples/*` entry in `pnpm-workspace.yaml` once your own
features are the better reference.
