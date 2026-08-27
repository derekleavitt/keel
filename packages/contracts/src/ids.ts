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
