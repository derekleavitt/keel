import type { SessionUser, UserId } from '@keel/contracts';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from './index.ts';
import { isPlatformAdmin, type PlatformActor } from './platform.ts';

/**
 * Session helpers for server components and server actions.
 *
 * These live here, in the package that owns auth, so feature packages never have to
 * roll their own session resolution — and never have to take a dependency on `next`
 * to do it. Any territory may call these; none should reimplement them.
 */

/** The signed-in user, or null. Never throws on an anonymous request. */
export async function currentUser(): Promise<SessionUser | null> {
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  const { id, email, name, image } = session.user;
  return {
    id: id as UserId,
    email,
    name: name ?? null,
    image: image ?? null,
  };
}

/** The signed-in user's id, or null. */
export async function currentUserId(): Promise<UserId | null> {
  return (await currentUser())?.id ?? null;
}

/**
 * The signed-in user, or throw.
 *
 * Use this at the top of any server action that must not run anonymously. Throwing
 * rather than returning null keeps the happy path unindented and makes an unauthenticated
 * call a loud failure instead of a silent no-op.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new Error('Not authenticated');
  return user;
}

/** The signed-in user's id, or throw. The common case in query helpers. */
export async function requireUserId(): Promise<UserId> {
  return (await requireUser()).id;
}

/**
 * The signed-in user, or send them to sign in.
 *
 * Use this in pages and layouts. `requireUser()` throws, which is right for a server
 * action — an unauthenticated mutation is a bug or an attack, and should be loud. But a
 * person opening a protected page while logged out is doing something completely
 * ordinary, and a 500 is the wrong answer.
 *
 * `next` is a dependency of this package precisely so feature packages and the app never
 * need one to reach `headers()` or `redirect()`.
 */
export async function requireUserOrRedirect(returnTo?: string): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) {
    // `typedRoutes` checks route literals, so the destination is written out rather
    // than assembled from a parameter. Only the query string varies.
    redirect(returnTo ? `/sign-in?next=${encodeURIComponent(returnTo)}` : '/sign-in');
  }
  return user;
}

export class NotPlatformAdminError extends Error {
  constructor() {
    super('Not a platform administrator');
  }
}

/**
 * The caller, if they are staff. Throws otherwise.
 *
 * Throwing rather than returning null is deliberate: every admin route funnels through
 * this, and a boolean that a caller can forget to check is the shape this exact class of
 * bug takes. There is no variant that returns false.
 */
export async function requirePlatformAdmin(): Promise<PlatformActor> {
  const caller = await requireUser();
  if (!(await isPlatformAdmin(caller.id))) throw new NotPlatformAdminError();
  return { id: caller.id, email: caller.email };
}
