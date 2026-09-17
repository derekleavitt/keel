/**
 * Don't coordinate. Append your line and leave.
 *
 * No read, so there is no read-write window to lose. Every worker writes only what it knows —
 * its own number — and never touches anybody else's contribution. The thing two workers were
 * fighting over has been removed rather than protected.
 *
 * This works because a single `O_APPEND` write below the pipe buffer is atomic on POSIX: the
 * kernel does the seek-to-end and the write as one operation, so two appends interleave
 * between lines but never inside one. That guarantee is doing real work here — it is why the
 * file never contains "1213" — and it is also the limit. Append a payload larger than a few
 * kilobytes and it stops holding.
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
 * Runs once, after everyone has finished, from whoever is coordinating. Idempotent, so running
 * it twice is harmless — which matters because "did the last worker finish" is exactly the
 * question a coordinator gets wrong.
 */
export function compact(file) {
  const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const values = raw
    .trim()
    .split(',')
    .map((field) => field.trim())
    .filter((field) => field !== '')
    .map(Number)
    .sort((a, b) => a - b);

  fs.writeFileSync(file, values.join(','));
}
