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
