---
description: Rules for the shared contract layer
paths: ["packages/contracts/**"]
---

# Contracts are the blast wall

Every other package depends on this one, so a change here has the widest possible
impact.

- Treat every exported schema as a published API. Widening a type is safe; narrowing
  one, renaming a field, or changing a default is a breaking change.
- Before changing an existing schema, find its consumers and say what will break.
- `env.ts` is the only legitimate reader of `process.env` in the entire repository.
  Add new variables here first, then to `.env.example`.
- Keep this package dependency-free apart from `zod`. It must stay importable from
  server, client and test contexts alike.
