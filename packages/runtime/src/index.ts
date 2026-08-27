/**
 * Framework APIs that feature packages are allowed to use.
 *
 * Feature packages must not depend on `next` directly — a package that imports the
 * framework cannot be tested, reused, or reasoned about independently, and every feature
 * that reaches for one invents its own way of doing it. This package is the single
 * sanctioned crossing point.
 *
 * Adding a re-export here is a deliberate decision, not a convenience. Each one needs a
 * reason recorded below. If a feature package needs something absent from this list, that
 * absence is a design question — not a licence to add `next` to its dependencies.
 *
 * Deliberately NOT re-exported:
 *
 * - `headers()` / `cookies()` — use `@keel/auth/session`. A feature package wanting raw
 *   headers almost always wants the session, and should say so.
 * - `redirect()` — a feature package deciding where the user goes next is a layering
 *   mistake. Return a result; let the route decide.
 * - Route handlers, middleware, `NextRequest` — those belong to `apps/web`.
 */

/**
 * Invalidate a cached path after a mutation.
 *
 * Allowed because cache invalidation is inseparable from the mutation that caused it.
 * Moving it to the app layer means every caller must remember to invalidate, and the one
 * that forgets produces a stale page nobody can reproduce.
 */
export { revalidatePath, revalidateTag } from 'next/cache';
