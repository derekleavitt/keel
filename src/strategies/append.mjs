/**
 * Don't coordinate. Append your line and leave.
 *
 * No read, so there is no read-write window to lose. Every worker writes only what it knows —
 * its own number — and never touches anybody else's contribution. The thing two workers were
 * fighting over has been removed rather than protected.
 *
 * This works because an `O_APPEND` write is atomic for regular files on POSIX: the kernel does
 * the seek-to-end and the write as one operation, so two appends interleave between lines but
 * never inside one. That guarantee is doing real work here — it is why the file never contains
 * "1213". `PIPE_BUF` (4096 bytes on most systems) is cited only as the conservative size bound
 * used here: it is the POSIX atomicity limit for pipes, not a documented limit for regular
 * files, but each payload below is a handful of bytes, far under it. Whether larger payloads
 * stay unsplit depends on the filesystem and on the write completing in one call; this code
 * does not rely on, and no test here checks, anything past that bound.
 *
 * The honest cost: the file is not sorted while this is running, and nothing sorts it. That
 * needs a compaction pass after the last worker finishes, which means somebody has to know
 * when that is. The contention didn't disappear; it moved into a coordinator that has to
 * decide the run is over.
 *
 * Whether that trade is good depends entirely on whether the invariant has to hold *during*
 * the run or only at the end of it. Worth being explicit about, because the naive and lockfile
 * strategies both maintain it continuously and this one does not.
 */
import fs from 'node:fs';

export const name = 'append';

export async function contribute({ file, value, delay }) {
  // The delay goes *before* the write rather than inside a read-modify-write, because there
  // is no window to widen. Kept so the strategies are timed against the same work.
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

  /*
   * A comma-separated append, so the file is one line throughout. The leading comma is the
   * whole trick: writing ',N' rather than 'N,' means no worker ever has to know whether it is
   * first, which would require reading — and reading is what this strategy exists to avoid.
   * The stray leading comma is the compaction step's problem.
   */
  fs.appendFileSync(file, `,${value}`);
}

/**
 * Sort what the workers left behind.
 *
 * Runs once, after everyone has finished, from whoever is coordinating.
 *
 * What is guaranteed: the sorted result is written to `<file>.tmp` and renamed into place, so a
 * reader sees either the old file or the new one, never half of one. With no concurrent
 * writers, running it twice produces byte-identical content (duplicates are kept, not removed).
 *
 * What is NOT guaranteed: safety against a worker still appending. This is a read-sort-write,
 * the same shape as the naive strategy, so an append landing between the read and the rename
 * would be lost. As best-effort detection it compares the file size before the read and again
 * just before the rename, and throws "compacted during writes" instead of overwriting. That
 * catches any append that lands inside the window except one that lands between the second
 * stat and the rename itself, and it cannot see a worker that opened the old file and appends
 * after the rename (that write goes to the replaced inode and is lost silently). "Idempotent" is
 * therefore only true once every worker is done, which is the very thing a coordinator
 * gets wrong; treat the throw as a coordinator error and rerun compact after the stragglers end.
 *
 * Empty file, a lone ",", and a trailing "," all compact to an empty file (no values). A missing
 * file is treated as empty and created.
 *
 * `hooks.beforeRename` exists only so tests can inject an append at the vulnerable moment.
 */
export function compact(file, hooks = {}) {
  const sizeOf = () => (fs.existsSync(file) ? fs.statSync(file).size : 0);
  const tmp = `${file}.tmp`;

  const sizeBefore = sizeOf();
  const raw = sizeBefore > 0 ? fs.readFileSync(file, 'utf8') : '';
  const values = raw
    .trim()
    .split(',')
    .map((field) => field.trim())
    .filter((field) => field !== '')
    .map(Number)
    .sort((a, b) => a - b);

  try {
    fs.writeFileSync(tmp, values.join(','));
    if (hooks.beforeRename) hooks.beforeRename();
    if (sizeOf() !== sizeBefore) {
      throw new Error(`${file} compacted during writes: size changed from ${sizeBefore} to ${sizeOf()} bytes`);
    }
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}
