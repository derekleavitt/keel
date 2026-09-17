---
description: Rules for the Next.js app
paths: ["apps/web/**"]
---

# The app is thin

`apps/web` composes packages. Logic that could live in a package should.

- Server Components by default. Add `'use client'` only when you need state, effects
  or browser APIs, and push it as far down the tree as possible.
- Do not add a vendor dependency here to reach a feature. Re-export it from the owning
  package instead — `packages/auth/src/next.ts` is the reference.
- Anything reading the environment or the database must be dynamic, never prerendered.
- Styling comes from `@keel/ui` tokens. Do not introduce a second source of colour.

## Revalidate the segment you are actually on

`revalidatePath('/lists')` does **not** invalidate `/lists/[id]`. A mutation on a nested
dynamic route that revalidates only the parent leaves the client serving a cached payload,
which looks exactly like a write that never happened — while the database is perfectly
correct.

Use `revalidatePath('/lists', 'layout')` to invalidate a segment and everything under it.

If a change appears not to persist, **query the database before theorising about the
mechanism**. See `.orchestration/lessons/L-021.md`, where two plausible concurrency
theories were both wrong and one `psql` query settled it.

## Controls backed by server state need an optimistic path

A checkbox or toggle written as `checked={row.done}` with an `onChange` calling a server
action **does not move when clicked** — React re-renders it from props that have not
changed yet. Use React 19's `useOptimistic`, updated inside a transition, and sort the
client list the same way the query does so the row moves immediately too.

Only a browser test catches this; the query layer is correct the whole time. See
`.orchestration/lessons/L-015.md` and `apps/web/app/lists/[id]/todo-list.tsx`.

## Every repeated structure needs an accessible name

`page.getByRole('listitem')` in a browser spec is not "the todos" — it is "every list item
on the page", which is the same thing only until someone renders a second list. Adding the
activity feed to `/lists/[id]` broke nine tests across five files that had nothing to do
with the audit log.

Give each `<ul>`/`<ol>`/`<table>` an `aria-label`, and scope every role query to one:

```ts
page.getByRole('list', { name: 'Todos' }).getByRole('listitem')
```

The markup change and the test fix are the same change, and the page gets better for a
screen reader either way. `apps/web/e2e/scoping.test.ts` enforces this by reading the specs
— a browser test cannot, because it only fails once the breaking element already exists.
See `.orchestration/lessons/L-029.md`.

## Optimistic controls need a settled-state assertion too

`toBeChecked()` on a `useOptimistic` control passes before the server action returns. That
is fine while asserting on the same page, and a race as soon as the test navigates to a
server-rendered page that reads the result. Mutating controls are `disabled={pending}`, so
waiting for one to be enabled again is a direct observation that the round trip finished.
See `.orchestration/lessons/L-030.md`.
