import { z } from 'zod';

/**
 * PATTERN: contracts.
 *
 * Note what is absent: no `userId` field. Ownership is a query-layer concern. Putting it
 * on the wire shape invites callers to pass their own, which is exactly the leak the
 * branded-id discipline exists to prevent.
 *
 * Also note this module imports nothing from `@keel/contracts`'s barrel. It takes
 * `userIdSchema` from the leaf module `@keel/contracts/ids` — importing the barrel here
 * would be a temporal-dead-zone crash, since the barrel re-exports this kind of module.
 */
export const noteTitleSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1, 'Title is required').max(120));

export const noteBodySchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().max(10_000))
  .nullable();

export const createNoteSchema = z.object({
  title: noteTitleSchema,
  body: noteBodySchema.optional(),
});

/** Absent means "leave alone"; explicit null means "clear it". */
export const updateNoteSchema = z
  .object({
    title: noteTitleSchema.optional(),
    body: noteBodySchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export type CreateNote = z.infer<typeof createNoteSchema>;
export type UpdateNote = z.infer<typeof updateNoteSchema>;
