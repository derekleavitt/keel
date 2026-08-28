/**
 * The full schema, assembled from one file per area.
 *
 * **Adding tables for a feature:** create `schema/<feature>.ts`, export a
 * `<feature>Tables` object from it, then add two lines here — one re-export and one
 * spread. Never add tables to an existing file that another feature also touches.
 *
 * This split exists because of measured merge behaviour, not taste. When three parallel
 * branches appended tables to a single module, git conflicted on the shared import line
 * and on adjacent table bodies even though each addition was self-contained. Separate
 * files cannot conflict at all; only the two lines below can, and those are trivial.
 *
 * Tables live in this package rather than in feature packages because `drizzle.config.ts`
 * reads only this module and `db()` hands the assembled object to the Better Auth
 * adapter. A table defined in a feature package would require `@keel/db` to import that
 * package — a workspace dependency cycle, which Turbo hard-fails.
 */

export * from './api-key.ts';
export * from './attachment.ts';
export * from './audit.ts';
export * from './auth.ts';
export * from './job.ts';
export * from './list.ts';
export * from './organization.ts';
export * from './tag.ts';
export * from './todo.ts';

import { apiKeyTables } from './api-key.ts';
import { attachmentTables } from './attachment.ts';
import { auditTables } from './audit.ts';
import { authTables } from './auth.ts';
import { jobTables } from './job.ts';
import { listTables } from './list.ts';
import { organizationTables } from './organization.ts';
import { tagTables } from './tag.ts';
import { todoTables } from './todo.ts';

export const schema = {
  ...authTables,
  ...organizationTables,
  ...jobTables,
  ...attachmentTables,
  ...apiKeyTables,
  ...auditTables,
  ...listTables,
  ...todoTables,
  ...tagTables,
};
