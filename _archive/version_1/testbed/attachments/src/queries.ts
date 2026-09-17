import {
  ALLOWED_CONTENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  uploadAttachmentSchema,
} from '@keel/contracts/attachment';
import type { Scope } from '@keel/contracts/ids';
import { db, type KeelDatabase } from '@keel/db';
import { attachment, orphanedBlob, todo } from '@keel/db/schema';
import { storage } from '@keel/storage';
import { editableVia, visibleVia } from '@keel/testbed-lists';
import { and, asc, eq, type SQL } from 'drizzle-orm';

/**
 * Attachments inherit access from the todo, which inherits it from the list.
 *
 * There is no attachment-level permission. Adding one would mean a second access rule to
 * keep consistent with the first, and the two would eventually disagree — which is how a
 * file stays readable after the thing it belongs to stops being.
 */
function visible(scope: Scope, ...narrowing: (SQL | undefined)[]): SQL {
  const predicate = visibleVia(todo.listId, scope);
  return and(predicate, ...narrowing) ?? predicate;
}

export async function listAttachments(scope: Scope, todoId: string, database: KeelDatabase = db()) {
  return database
    .select({
      id: attachment.id,
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.size,
      createdAt: attachment.createdAt,
    })
    .from(attachment)
    .innerJoin(todo, eq(todo.id, attachment.todoId))
    .where(visible(scope, eq(attachment.todoId, todoId)))
    .orderBy(asc(attachment.createdAt));
}

export type UploadFailure =
  | 'not-found'
  | 'too-large'
  | 'unsupported-type'
  | 'empty'
  | 'invalid-name';

/**
 * Store a file against a todo.
 *
 * The size is measured from the bytes actually received, not taken from the request. A
 * client-declared length is a hint; the only number that means anything is the one counted
 * after the upload finished.
 *
 * The blob is written first and the row second, and the write is undone if the row fails.
 * The other order can leave a row pointing at nothing, which is a broken download; this
 * order's worst case is an unreferenced blob, which is a cleanup problem.
 */
export async function uploadAttachment(
  scope: Scope,
  input: { todoId: string; filename: string; contentType: string; data: Uint8Array },
  database: KeelDatabase = db(),
): Promise<{ ok: true; id: string } | { ok: false; reason: UploadFailure }> {
  const parsed = uploadAttachmentSchema.safeParse({
    todoId: input.todoId,
    filename: input.filename,
    contentType: input.contentType,
    size: input.data.byteLength,
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (input.data.byteLength === 0) return { ok: false, reason: 'empty' };
    if (input.data.byteLength > MAX_ATTACHMENT_BYTES) return { ok: false, reason: 'too-large' };
    if (!ALLOWED_CONTENT_TYPES.includes(input.contentType as never)) {
      return { ok: false, reason: 'unsupported-type' };
    }
    return { ok: false, reason: issue?.path[0] === 'filename' ? 'invalid-name' : 'not-found' };
  }

  // Edit rights on the todo's list, checked before a single byte is written.
  const [allowed] = await database
    .select({ id: todo.id })
    .from(todo)
    .where(and(eq(todo.id, input.todoId), editableVia(todo.listId, scope)))
    .limit(1);
  if (!allowed) return { ok: false, reason: 'not-found' };

  const stored = await storage().put(input.data, parsed.data.contentType);

  try {
    const id = `att_${crypto.randomUUID()}`;
    await database.insert(attachment).values({
      id,
      todoId: input.todoId,
      uploadedBy: scope.userId,
      filename: parsed.data.filename,
      contentType: parsed.data.contentType,
      size: stored.size,
      storageKey: stored.key,
      digest: stored.digest,
    });
    return { ok: true, id };
  } catch (error) {
    // The row failed, so the blob is already unreferenced. Remove it now rather than
    // leaving it for the sweeper — the sweeper exists for crashes, not for known failures.
    await storage().remove(stored.key);
    throw error;
  }
}

/** Read a file back. Returns null rather than throwing when it is not the caller's. */
export async function readAttachment(scope: Scope, id: string, database: KeelDatabase = db()) {
  const [row] = await database
    .select({
      filename: attachment.filename,
      contentType: attachment.contentType,
      storageKey: attachment.storageKey,
    })
    .from(attachment)
    .innerJoin(todo, eq(todo.id, attachment.todoId))
    .where(visible(scope, eq(attachment.id, id)))
    .limit(1);
  if (!row) return null;

  const data = await storage().get(row.storageKey);
  if (!data) return null;
  return { ...row, data };
}

/**
 * Delete an attachment.
 *
 * The row goes and the blob is queued for sweeping, both in one transaction. Deleting the
 * blob inline would mean a crash between the two leaves a row pointing at nothing.
 */
export async function deleteAttachment(
  scope: Scope,
  id: string,
  database: KeelDatabase = db(),
): Promise<boolean> {
  return database.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: attachment.id, storageKey: attachment.storageKey })
      .from(attachment)
      .innerJoin(todo, eq(todo.id, attachment.todoId))
      .where(and(eq(attachment.id, id), editableVia(todo.listId, scope)))
      .limit(1);
    if (!row) return false;

    await tx.delete(attachment).where(eq(attachment.id, row.id));
    await tx.insert(orphanedBlob).values({ storageKey: row.storageKey }).onConflictDoNothing();
    return true;
  });
}

/**
 * Record blobs whose rows were removed by a cascade.
 *
 * A todo deleted by cascade takes its attachment rows with it and never touches storage,
 * so nothing would otherwise know those blobs are unreferenced. Called before the delete,
 * inside the same transaction.
 */
export async function markAttachmentsOrphaned(
  todoId: string,
  database: KeelDatabase = db(),
): Promise<number> {
  const rows = await database
    .select({ storageKey: attachment.storageKey })
    .from(attachment)
    .where(eq(attachment.todoId, todoId));

  for (const row of rows) {
    await database.insert(orphanedBlob).values(row).onConflictDoNothing();
  }
  return rows.length;
}
