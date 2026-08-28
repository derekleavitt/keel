import { authenticateApiKey } from '@keel/auth/api-key';
import { requireUserId, requireUserOrRedirect } from '@keel/auth/session';
import type { Scope } from '@keel/contracts/ids';
import { clearPreference, readPreference, writePreference } from '@keel/runtime';
import { resolveScope, scopeFor } from './queries.ts';

/** The cookie holding the active organization. Never trusted without a membership check. */
export const ACTIVE_ORGANIZATION_COOKIE = 'keel_org';

/**
 * The scope for the current request.
 *
 * Reads the active organization from a cookie and **verifies membership before trusting
 * it**. A stale or forged value falls back to the user's personal workspace rather than
 * erroring — and, critically, rather than resolving to a tenant they do not belong to.
 *
 * This is the single place a request turns into a `Scope`. Every query in every package
 * receives one, so getting this right once is what makes cross-tenant access impossible
 * everywhere else.
 */
export async function requireScope(): Promise<Scope> {
  const userId = await requireUserId();
  const requested = await readPreference(ACTIVE_ORGANIZATION_COOKIE);

  const scope = await resolveScope(userId, requested);
  if (!scope) throw new Error('No organization available for this user');
  return scope;
}

/**
 * The scope for a page, redirecting a signed-out visitor to sign in.
 *
 * `requireScope()` throws, which is right for a server action — an unauthenticated
 * mutation is a bug or an attack. A page must redirect instead, and it must do so *before*
 * resolving tenancy: calling `requireScope()` first turns an ordinary signed-out visit
 * into a 500, because resolving an organization for nobody is meaningless.
 *
 * Same split as `requireUser` / `requireUserOrRedirect`, for the same reason.
 */
export async function requireScopeOrRedirect(returnTo?: string): Promise<Scope> {
  const user = await requireUserOrRedirect(returnTo);
  const requested = await readPreference(ACTIVE_ORGANIZATION_COOKIE);

  const scope = await resolveScope(user.id, requested);
  if (!scope) throw new Error('No organization available for this user');
  return scope;
}

/** Switch the active organization. Membership is verified on the next read, not here. */
export async function setActiveOrganization(organizationId: string): Promise<void> {
  await writePreference(ACTIVE_ORGANIZATION_COOKIE, organizationId);
}

/**
 * Forget the active organization.
 *
 * **Must be called on sign-out.** The cookie is per-browser, not per-session, so without
 * this the next person to sign in on the same machine inherits the previous user's
 * workspace selection. `resolveScope` would refuse it if they were not a member — but if
 * they happen to share a workspace, they land somewhere they did not choose, with no
 * indication why.
 */
export async function forgetActiveOrganization(): Promise<void> {
  await clearPreference(ACTIVE_ORGANIZATION_COOKIE);
}

/**
 * The scope for a machine request: an API key, falling back to a session cookie.
 *
 * ## Why this is not `requireScope()` with a different reader
 *
 * `requireScope()` ends in `resolveScope()`, which **falls back to the caller's personal
 * workspace** when the requested organization is not one they belong to. For a browser
 * that is right: a stale cookie should land the user somewhere sensible rather than
 * erroring.
 *
 * For a key it is a security hole. A key issued for Acme, presented after its owner was
 * removed from Acme, would quietly start operating on that person's private workspace —
 * succeeding, with a 200, against data the integration was never pointed at.
 *
 * So the shared path is one layer down: `scopeFor()`, the strict membership check both
 * mechanisms already used. Session auth keeps its fallback because a human can be
 * redirected; key auth fails closed because a script cannot.
 *
 * The membership check runs on **every** request rather than being trusted from the key's
 * row, which is what makes removing someone from an organization revoke their keys for it
 * immediately, with nothing to invalidate.
 */
export async function scopeFromRequest(request: Request): Promise<Scope | null> {
  const header = request.headers.get('authorization');

  if (header?.startsWith('Bearer ')) {
    const identity = await authenticateApiKey(header.slice('Bearer '.length).trim());
    if (!identity) return null;
    // Strict: no fallback. A key whose organization is no longer available is dead, not
    // redirected somewhere else.
    return scopeFor(identity.userId, identity.organizationId);
  }

  // No key presented: fall back to the session cookie, so the same endpoints are usable
  // from the app itself and from a browser devtools console during development.
  try {
    return await requireScope();
  } catch {
    return null;
  }
}
