import { z } from 'zod';

export * from './env.ts';

/** Stable identifier for a user across every package. */
export const userIdSchema = z.string().min(1).brand<'UserId'>();
export type UserId = z.infer<typeof userIdSchema>;

/** The shape every package agrees on when it talks about a signed-in person. */
export const sessionUserSchema = z.object({
  id: userIdSchema,
  email: z.email(),
  name: z.string().nullable(),
  image: z.url().nullable(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

/** Envelope for server action results. Errors are values, not exceptions. */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function err<T = never>(error: string): ActionResult<T> {
  return { ok: false, error };
}
