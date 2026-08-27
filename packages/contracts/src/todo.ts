import { z } from 'zod';
import { listIdSchema } from './list.ts';

/**
 * Todo contracts. As ever, no `userId` on the wire — ownership is a query-layer concern.
 */
export const todoIdSchema = z.string().min(1).brand<'TodoId'>();
export type TodoId = z.infer<typeof todoIdSchema>;

export const todoTitleSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1, 'Title is required').max(200, 'Title is too long'));

export const todoNotesSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().max(10_000))
  .nullable();

/** Quick add: a title is the only thing required. Everything else is editable later. */
export const createTodoSchema = z.object({
  listId: listIdSchema,
  title: todoTitleSchema,
  notes: todoNotesSchema.optional(),
});

export const updateTodoSchema = z
  .object({
    title: todoTitleSchema.optional(),
    notes: todoNotesSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');

export const setTodoDoneSchema = z.object({
  id: todoIdSchema,
  done: z.boolean(),
});

export type CreateTodo = z.infer<typeof createTodoSchema>;
export type UpdateTodo = z.infer<typeof updateTodoSchema>;
