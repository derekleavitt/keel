import { z } from 'zod';
import { userIdSchema } from './ids.ts';

export * from './env.ts';
export * from './ids.ts';
export * from './list.ts';

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
