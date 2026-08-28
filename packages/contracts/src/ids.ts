import { z } from 'zod';

/**
 * Branded identifiers.
 *
 * These live in a leaf module, not the barrel. A feature contract needing `userIdSchema`
 * must be able to import it without importing `index.ts` — which re-exports that same
 * feature module, and would therefore be a temporal-dead-zone crash at module evaluation.
 * That failure produces no lint error and no type error, so the only defence is keeping
 * shared primitives out of the barrel entirely.
 */

/** Stable identifier for a user across every package. */
export const userIdSchema = z.string().min(1).brand<'UserId'>();
export type UserId = z.infer<typeof userIdSchema>;

/** Stable identifier for a tenant. */
export const organizationIdSchema = z.string().min(1).brand<'OrganizationId'>();
export type OrganizationId = z.infer<typeof organizationIdSchema>;

/**
 * Who is asking, and which tenant they are asking about.
 *
 * Every query helper takes a `Scope` rather than a bare `userId`. Both halves are branded,
 * so neither can be supplied as a plain string and the two cannot be swapped — and because
 * it is a single object, adding a dimension later (a role, an impersonation marker) does
 * not change 43 signatures again.
 *
 * The important property is that a query cannot be *partially* scoped. There is no
 * signature that accepts a user without a tenant, so "forgot the organization" is not a
 * mistake this codebase can express.
 */
export interface Scope {
  readonly userId: UserId;
  readonly organizationId: OrganizationId;
}

export const scopeSchema = z.object({
  userId: userIdSchema,
  organizationId: organizationIdSchema,
});
