import { z } from 'zod';
import { listColourSchema } from './list.ts';
import { todoIdSchema } from './todo.ts';

/**
 * Tag contracts.
 *
 * No `userId` field, and — just as deliberately — **no `listId` field anywhere**. Tags
 * are global to the user. A tag scoped to a list could not do the one job tags exist for,
 * which is slicing across lists, and once a `listId` reached the wire shape every caller
 * would start passing one.
 *
 * Imports come from the leaf modules `./list.ts` and `./todo.ts`, never from the barrel
 * that re-exports this file.
 */
export const tagIdSchema = z.string().min(1).brand<'TagId'>();
export type TagId = z.infer<typeof tagIdSchema>;

/**
 * Tag names are trimmed and internally collapsed, so `"  waiting  on "` and
 * `"waiting on"` are the same tag rather than two that look identical in the UI. The
 * unique index on `(user_id, name)` is what makes inline creation well defined: "reuse it
 * if it exists" needs the database to agree on what "exists" means.
 *
 * Case is preserved rather than folded — users write "Urgent" and expect to see "Urgent".
 */
export const tagNameSchema = z
  .string()
  .transform((value) => value.trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(1, 'Tag name is required').max(40, 'Tag name is too long'));

/**
 * The same six-digit hex rule lists use, reused rather than copied.
 *
 * `@keel/testbed-todos` takes `positionBetween` from `@keel/testbed-lists` for the same
 * reason: a second copy of a rule is where the two versions first drift apart. That the
 * canonical hex-colour schema is called `listColourSchema` is a naming wart, not a
 * boundary — colour validation is not a list concept.
 */
export const tagColourSchema = listColourSchema;

export const createTagSchema = z.object({
  name: tagNameSchema,
  colour: tagColourSchema.optional(),
});

/** Absent means "leave alone"; explicit null means "clear it". */
export const updateTagSchema = z
  .object({
    name: tagNameSchema.optional(),
    colour: tagColourSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');

/** Attaching and detaching name both ends; neither invents a position or an order. */
export const tagAssignmentSchema = z.object({
  todoId: todoIdSchema,
  tagId: tagIdSchema,
});

/**
 * Inline creation: tag a todo with a name, making the tag if the user does not have it.
 *
 * This is a separate shape from `tagAssignmentSchema` on purpose. Overloading one action
 * to take "an id, or else a name" pushes the branch onto the client and makes the
 * server's contract untypeable.
 */
export const tagTodoByNameSchema = z.object({
  todoId: todoIdSchema,
  name: tagNameSchema,
  colour: tagColourSchema.optional(),
});

export type CreateTag = z.infer<typeof createTagSchema>;
export type UpdateTag = z.infer<typeof updateTagSchema>;
export type TagAssignment = z.infer<typeof tagAssignmentSchema>;
export type TagTodoByName = z.infer<typeof tagTodoByNameSchema>;
