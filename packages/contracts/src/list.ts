import { z } from 'zod';

/**
 * List contracts.
 *
 * No `userId` field anywhere. Ownership is a query-layer concern; putting it on the wire
 * shape invites callers to supply their own. Imports come from the leaf module
 * `./ids.ts`, never from the barrel that re-exports this file.
 */
export const listIdSchema = z.string().min(1).brand<'ListId'>();
export type ListId = z.infer<typeof listIdSchema>;

export const listNameSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1, 'Name is required').max(80, 'Name is too long'));

/** Six-digit hex, lowercased so `#4F46E5` and `#4f46e5` are the same colour. */
export const listColourSchema = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.string().regex(/^#[0-9a-f]{6}$/, 'Use a six-digit hex colour'))
  .nullable();

export const createListSchema = z.object({
  name: listNameSchema,
  colour: listColourSchema.optional(),
});

/** Absent means "leave alone"; explicit null means "clear it". */
export const updateListSchema = z
  .object({
    name: listNameSchema.optional(),
    colour: listColourSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');

/**
 * Reorder by naming the neighbour to sit after, never by sending a position. A client
 * that picks its own float can collide two rows or invent an order that does not exist.
 */
export const reorderListSchema = z.object({
  id: listIdSchema,
  afterId: listIdSchema.nullable(),
});

export type CreateList = z.infer<typeof createListSchema>;
export type UpdateList = z.infer<typeof updateListSchema>;
