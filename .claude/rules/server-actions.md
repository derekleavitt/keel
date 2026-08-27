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
