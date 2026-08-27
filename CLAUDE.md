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
  See `packages/auth/src/next.ts` for the pattern. This runs both ways: a feature package
  needing a framework API is the same smell — the owning package should expose it.
- **Every export from a `'use server'` file is a public HTTP endpoint.** Never export
  helpers from one, and never take `userId` as an argument. See
  `.claude/rules/server-actions.md`.

## Where things are written down

Read these when they apply. Nothing else will point you at them, and agents that skipped
them have shipped wrong code.

| File | What only it tells you |
|---|---|
| `.claude/rules/*.md` | Per-area constraints — schema placement, server-action security, app thinness. Path-scoped, so check the ones matching files you touch. |
| `docs/architecture.md` | Why the repo is shaped this way, and what is designed but not yet built. |
| `docs/decomposition-log.md` | If present: the architectural decisions behind the current backlog — ordering strategy, auth enforcement, cascade directions. Read it before designing anything. |
| `.orchestration/territories.yaml` | If present: who owns what, and which files are serialized. |
| `.orchestration/RESUME.md` | Where the last session stopped and what to do next. **Run `pnpm loop:status` first to generate it, then read it.** It is not committed — a checked-in copy would describe someone else's machine. |
| `.orchestration/loop-protocol.md` | How one build iteration works, and why the testbed drives Keel rather than the other way round. |
| `testbed/README.md` | The todo app Keel is developed against. Friction building it is what generates Keel's backlog. |
| `examples/notes` | The reference vertical slice. **Copy this shape** for any feature package. |

## House idioms

- **Run `pnpm lint:fix` before `pnpm verify`.** Most first-attempt failures are import
  ordering and line wrapping. Fixing them by hand costs a full cycle.
- **`noNonNullAssertion` is on**, so drizzle's `and()` returning `SQL | undefined` cannot
  be `and(...)!`. Write `and(scope, ...narrowing) ?? scope` — the fallback is the user
  scope rather than match-everything, which is safer as well as legal.
- **Adding a new workspace package needs a second `pnpm install`** before typecheck can
  resolve it. The first run reports the lockfile as up to date and skips resolution.
- **Never import from a barrel that re-exports you.** `contracts/src/index.ts` re-exports
  the feature modules, so importing from it inside one of them is a TDZ crash at module
  eval — not a lint error.
- **Session access is `@keel/auth/session`** — `requireUser()`, `requireUserId()`,
  `currentUser()`. Do not write your own, and do not add `next` to a feature package to
  get at `headers()`.

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
5. Run `pnpm install` a second time so the workspace link resolves

## Status

Keel is developed **demand-driven**: a todo application in `testbed/` is built on it, and
friction encountered building that app is what generates Keel's backlog. Nothing is built
because a design document predicted it.

`.orchestration/tasks/` holds two backlogs. `T-*` are testbed features and they drive.
`P-*` are predictions about what Keel will need — they are pulled to `open` only when a
feature actually demands them, and deleted if they never are.

The graph layer, doc-staleness gate and territory enforcement are designed but not built.
Do not assume they exist. Circuit breakers, the lesson ledger, the verify gate, PGlite
testing and crash-safe resume are built and working.
