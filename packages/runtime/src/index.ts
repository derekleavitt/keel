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
 * - `headers()` — use `@keel/auth/session`. A feature package wanting raw headers almost
 *   always wants the session, and should say so.
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

/**
 * Read a preference cookie.
 *
 * Allowed because some per-request state genuinely is not the session. The active
 * organization is the motivating case: the user chooses it with a switcher, it changes
 * what every page shows, and `@keel/auth/session` has no business knowing that tenancy
 * exists.
 *
 * **Not for session data.** Anything about *who* the user is comes from
 * `@keel/auth/session`; this is for what they have most recently chosen. And nothing read
 * here is trusted — a cookie is attacker-controlled, so the value must be validated
 * against the database before it scopes anything. See `scopeFor()` in
 * `@keel/organizations`, which returns null rather than trusting the id it was handed.
 */
export async function readPreference(name: string): Promise<string | undefined> {
  const { cookies } = await import('next/headers');
  return (await cookies()).get(name)?.value;
}

/** Clear a preference cookie. */
export async function clearPreference(name: string): Promise<void> {
  const { cookies } = await import('next/headers');
  (await cookies()).delete(name);
}

/** Write a preference cookie. Only valid inside a server action or route handler. */
export async function writePreference(name: string, value: string): Promise<void> {
  const { cookies } = await import('next/headers');
  (await cookies()).set(name, value, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
}
