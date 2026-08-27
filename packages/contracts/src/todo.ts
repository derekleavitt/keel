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

/**
 * Priority, least-to-most urgent. The order matches the Postgres enum declaration, so
 * ranking here and sorting in the database cannot disagree.
 */
export const TODO_PRIORITIES = ['none', 'low', 'medium', 'high'] as const;
export const todoPrioritySchema = z.enum(TODO_PRIORITIES);
export type TodoPriority = z.infer<typeof todoPrioritySchema>;

export const TODO_PRIORITY_RANK: Record<TodoPriority, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

/**
 * A calendar date, not an instant.
 *
 * Regex first so the shape is right, then a UTC round-trip so 2026-02-30 and 2026-13-01
 * are rejected rather than silently rolled forward. Parsing in local time would shift the
 * day for anyone west of UTC.
 */
export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Not a real date')
  .nullable();

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
  dueDate: calendarDateSchema.optional(),
  priority: todoPrioritySchema.optional(),
});

/**
 * Absent means "leave alone"; explicit null means "clear it". Without that distinction a
 * due date can be set but never removed.
 */
export const updateTodoSchema = z
  .object({
    title: todoTitleSchema.optional(),
    notes: todoNotesSchema.optional(),
    dueDate: calendarDateSchema.optional(),
    priority: todoPrioritySchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');

/** Filters for a list view. Every field optional; absent means "do not narrow". */
export const todoFilterSchema = z.object({
  done: z.boolean().optional(),
  priority: z.array(todoPrioritySchema).optional(),
  dueOnOrBefore: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type TodoFilter = z.infer<typeof todoFilterSchema>;

export const setTodoDoneSchema = z.object({
  id: todoIdSchema,
  done: z.boolean(),
});

export type CreateTodo = z.infer<typeof createTodoSchema>;
export type UpdateTodo = z.infer<typeof updateTodoSchema>;
