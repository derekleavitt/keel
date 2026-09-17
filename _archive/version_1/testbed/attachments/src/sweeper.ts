import { db, type KeelDatabase } from '@keel/db';
import { orphanedBlob } from '@keel/db/schema';
import { enqueue, type JobHandler } from '@keel/jobs';
import { storage } from '@keel/storage';
import { asc, eq } from 'drizzle-orm';

/**
 * Delete blobs whose rows are gone.
 *
 * Storage and the database are separate systems that cannot be updated atomically. The
 * choice is which way they are allowed to disagree, and this codebase always chooses
 * "blob outlives its row": an unreferenced file costs storage until swept, whereas a row
 * pointing at a missing file is a download that fails in front of a user.
 *
 * The sweeper is therefore not an optimisation — it is the second half of every delete.
 */
export const SWEEP_BLOBS = 'attachments.sweep';

export const sweepBlobsHandler: JobHandler<{ limit?: number }> = {
  kind: SWEEP_BLOBS,
  handle: async (payload, { database }) => {
    const limit = payload.limit ?? 100;
    const rows = await database
      .select()
      .from(orphanedBlob)
      .orderBy(asc(orphanedBlob.createdAt))
      .limit(limit);

    for (const row of rows) {
      await storage().remove(row.storageKey);
      // Removed after the blob is gone. If the process dies between the two, the entry
      // survives and the next sweep retries — `remove` on a missing key is a no-op, so
      // repeating it is harmless.
      await database.delete(orphanedBlob).where(eq(orphanedBlob.storageKey, row.storageKey));
    }
  },
};

export const attachmentHandlers = [sweepBlobsHandler];

export async function scheduleSweep(database: KeelDatabase = db()) {
  return enqueue(
    SWEEP_BLOBS,
    {},
    { uniqueKey: `sweep:${new Date().toISOString().slice(0, 13)}` },
    database,
  );
}
