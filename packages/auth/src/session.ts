import type { SessionUser, UserId } from '@keel/contracts';
import { headers } from 'next/headers';
import { auth } from './index.ts';

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
