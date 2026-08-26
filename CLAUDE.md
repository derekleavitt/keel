# Keel

An agent-native Next.js monorepo. Read this file, then use the commands below to
retrieve what you need — do not read the tree exhaustively.

## The one rule

`pnpm verify` defines done. It runs on the Stop hook, so a turn cannot finish while
it is red. Do not work around it, weaken a check, or delete a failing test to get
past it — fix the cause or report the blocker.

```bash
pnpm verify          # lint · typecheck · unit · build   (~2s warm)
pnpm verify unit     # iterate on one step
KEEL_E2E=1 pnpm verify   # include the browser smoke test
```

## Layout

| Path | Owns |
|---|---|
| `apps/web` | Routes and composition only. Keep it thin. |
| `packages/contracts` | Zod schemas, shared types, the env contract. Changes here affect everyone. |
| `packages/db` | Drizzle schema, migrations, the `db()` handle. |
| `packages/auth` | Better Auth config. Nothing else may import `better-auth`. |
| `packages/ui` | Shared components and design tokens. No business logic. |

Internal packages export TypeScript source directly — there is no build step between
editing a package and seeing the effect. Do not add one.

## Conventions that will bite you if you miss them

- **Nothing throws at import time.** `serverEnv()`, `db()` and `auth()` are lazy
  functions, not module-level constants, because `next build` and `pnpm verify` must
  succeed on a clean checkout with no `.env`. Never hoist them to top-level constants.
- **Packages that use Node APIs declare `"types": ["node"]`** in their tsconfig.
  TypeScript 7 does not auto-include ambient types.
- **Import Node builtins explicitly** — `import process from 'node:process'`.
- **Use `.ts` / `.tsx` extensions in relative imports.** `allowImportingTsExtensions`
  is on; imports without extensions will not resolve.
- **New env var?** Add it to `packages/contracts/src/env.ts` *and* `.env.example`.
  Reading `process.env` anywhere else is a bug.
- **Cross-package boundaries are real.** If `apps/web` needs a vendor API, re-export
  it from the owning package rather than adding the vendor as a direct dependency.
  See `packages/auth/src/next.ts` for the pattern.

## Commands

```bash
pnpm dev             # all dev servers
pnpm db:generate     # create a migration from schema changes
pnpm db:migrate      # apply migrations
pnpm lint:fix        # format and autofix
```

## Adding a package

1. `packages/<name>/package.json` with `"exports": { ".": "./src/index.ts" }`
2. `tsconfig.json` extending `../../tsconfig.base.json`
3. `typecheck` and `test:unit` scripts (Turbo discovers them automatically)
4. Add to `transpilePackages` in `apps/web/next.config.ts` if the app consumes it

## Status

Phase 0 of 6. The graph layer, doc-staleness gate, territories, task ledger and
autonomous build loop are designed but not yet built — see `docs/architecture.md`.
Do not assume those mechanisms exist yet.
