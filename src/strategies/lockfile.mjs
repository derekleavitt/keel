/**
 * Take an exclusive lock, then read-modify-write.
 *
 * The obvious fix. It works, and getting it to work took two attempts, which is the
 * interesting part.
 *
 * ## The first version, and why it lost updates anyway
 *
 * It created the lock and then wrote the holder's timestamp into it:
 *
 *   const handle = fs.openSync(lockPath, 'wx');   // atomic create
 *   fs.writeSync(handle, String(Date.now()));     // ...and a separate step
 *
 * Between those two lines the lock file exists and is empty. A worker checking for staleness
 * in that gap reads '', `Number('')` is 0, and `Date.now() - 0` is fifty-six years — so it
 * concludes the lock was abandoned, deletes it, and takes it. Two workers then hold the lock,
 * and the read-modify-write race is back with a lock sitting on top of it pretending to
 * prevent it.
 *
 * Five trials in twelve. Every failure was a clean lost update: file sorted, well-formed,
 * one number missing.
 *
 * Two separate mistakes stacked there. The create was atomic but the *lock* wasn't, because a
 * lock is its content as well as its existence. And the staleness check failed open — it
 * treated "I cannot tell how old this is" as "it is old", when the only safe reading of an
 * unparseable lock is that somebody holds it.
 *
 * ## The version below
 *
 * Write the timestamp into a private temp file first, then `link()` it into place. `link` is
 * atomic and fails with EEXIST if the target is taken, so the lock becomes visible already
 * containing its content. There is no window to read it empty, because it never is empty.
 *
 * And the staleness check now fails closed: anything it cannot parse is treated as held.
 *
 * ## What it still costs
 *
 * Every worker waits for every other worker. Throughput is one contributor at a time no
 * matter how many you run, so adding agents adds latency and nothing else. With a
 * thirty-second agent turn rather than a one-millisecond file write, that is the difference
 * between running ten agents and running one, slowly.
 *
 * And the expiry is load-bearing: without it a crashed holder blocks everyone forever, with
 * it a slow holder can have its lock taken while it still believes it owns it. That problem
 * arrived because of the lock. The naive strategy didn't have it, and neither does `append`.
 */
import fs from 'node:fs';
import process from 'node:process';

export const name = 'lockfile';

const STALE_MS = 10_000;
const RETRY_MS = 5;

async function acquire(lockPath) {
  const scratch = `${lockPath}.${process.pid}`;

  for (;;) {
    // Content first, in a file only this process knows about.
    fs.writeFileSync(scratch, String(Date.now()));

    try {
      // Atomic, and fails if the target exists. The lock appears fully formed or not at all.
      fs.linkSync(scratch, lockPath);
      fs.unlinkSync(scratch);
      return;
    } catch (error) {
      fs.unlinkSync(scratch);
      if (error.code !== 'EEXIST') throw error;

      try {
        const heldSince = Number(fs.readFileSync(lockPath, 'utf8').trim());
        // Fail closed. Unparseable means "I don't know", and the only safe reading of "I
        // don't know" is that somebody is holding it.
        if (Number.isFinite(heldSince) && heldSince > 0 && Date.now() - heldSince > STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        // Released between our link attempt and our read. Retry.
      }

      await new Promise((resolve) => setTimeout(resolve, RETRY_MS + Math.random() * RETRY_MS));
    }
  }
}

export async function contribute({ file, value, delay }) {
  const lockPath = `${file}.lock`;
  await acquire(lockPath);

  try {
    const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const values = raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .map(Number);

    // The same window the naive strategy loses to. Held under the lock it is harmless, which
    // is why both strategies are measured with the same delay.
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

    values.push(value);
    values.sort((a, b) => a - b);
    fs.writeFileSync(file, `${values.join('\n')}\n`);
  } finally {
    // `finally`, so a throw inside the critical section doesn't wedge everyone else until the
    // staleness timeout.
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // Already gone — somebody treated us as stale. Nothing useful to do here.
    }
  }
}
