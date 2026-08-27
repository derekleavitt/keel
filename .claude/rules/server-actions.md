---
description: Security rules for 'use server' modules
paths: ["**/actions.ts", "**/actions/**", "apps/web/**"]
---

# Every export from a 'use server' module is a public HTTP endpoint

This is the single most dangerous thing in the codebase to get wrong, and it fails
silently — there is no lint rule and no type error.

- **Never export a helper from a `'use server'` file.** Exporting `currentUserId()` from
  an actions module publishes the signed-in user's id as an endpoint anyone can call.
  Helpers go in a separate module; actions import them.
- **Never accept `userId` as an action argument.** Arguments are attacker-controlled.
  Resolve the user inside the action with `requireUser()` from `@keel/auth/session`.
- **Validate every argument with a contract schema** before it reaches a query. Do not
  trust shapes, and do not trust that the client sent what your form rendered.
- `'use server'` modules may only export async functions — so an actions file cannot go
  in a package's index barrel. Export it as its own subpath.

## Authorisation belongs in the query layer

The UI hiding a button is not a security control. Every query helper takes the branded
`UserId` from `@keel/contracts` as its first argument, so an unscoped query is a compile
error rather than a data leak. Preserve that property.

## Express the rule once, and compose it

`eq(table.userId, userId)` works exactly until two people touch one thing. Once anything is
shared, "can I see this" stops being a property of the row and becomes a question about a
grant — and a rule re-derived inline in each query is how one of them ends up quietly more
permissive than the rest.

`@keel/testbed-lists/access` is the reference: `visibleVia()` and `editableVia()` return
predicates every package composes, and they are **subqueries**, not fetched id lists. The
database re-evaluates them per statement, so revoking a grant takes effect on the next
query with no cache to invalidate and no window where a stale id list is still trusted.

Note what this means for row ownership: on a shared list, `todo.userId` records who
*created* a todo and no longer decides who may see it.
