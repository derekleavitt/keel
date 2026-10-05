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
 *
 * ## Stolen locks (the second bug, found by reading the code, not by running it)
 *
 * The version above stored only a timestamp and released unconditionally. A holder slower than
 * the staleness timeout had its lock taken by a waiter; on waking it (a) wrote its stale
 * read-modify-write over the new holder's data and (b) `unlink`ed the lock, which by then
 * belonged to the *new* holder, admitting a third worker while the second still believed it
 * held the lock. Nothing tested any of it, partly because `STALE_MS` was a ten-second constant.
 *
 * Now the lock is `<pid>:<random token>:<timestamp>` and a holder only acts on a lock whose
 * token is its own:
 *
 *   - Before publishing its result it re-reads the lock. Not ours: throw `LockLostError`
 *     having written nothing. The data file is written to a temp name and renamed in after
 *     that check, so the check-to-publish window is two syscalls, not the whole critical section.
 *   - `release` re-reads and unlinks only if the token matches; otherwise `LockLostError`.
 *   - `contribute` treats a loss *before* the write as retryable (nothing happened; reacquire
 *     and redo the work, up to `attempts`), and a loss *after* the write as fatal, because
 *     redoing would duplicate the value. The worker then exits non-zero.
 *
 * `KEEL_STALE_MS` and `KEEL_RETRY_MS` override the timings so theft can be provoked in
 * milliseconds. They are read at call time.
 *
 * ## Test hook
 *
 * `contribute({ ..., stallAfterAcquire: ms })` sleeps *while holding the lock*, after the read
 * and before the write. This is the "hang while holding" injection the runner cannot do from
 * outside: a runner flag can pass it through to the worker (not wired yet).
 *
 * ## What stays best-effort
 *
 * POSIX has no compare-and-unlink. The ownership check and the write/unlink that follows are
 * separate syscalls, and the stale-reclaim path (read old content, re-read to confirm it is
 * unchanged, unlink) can still delete a fresh lock if it lands inside that gap. These windows
 * are narrowed to microseconds, not closed. A lock with an expiry cannot be made fully safe
 * against a holder that outlives it; the layout that cannot contend (`append`) is the real fix.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import process from 'node:process';

export const name = 'lockfile';

export class LockLostError extends Error {
  constructor(message, { wrote = false } = {}) {
    super(message);
    this.name = 'LockLostError';
    this.wrote = wrote;
  }
}

function envMs(key, fallback) {
  const n = Number(process.env[key]);
  return process.env[key] !== undefined && process.env[key].trim() !== '' && Number.isFinite(n) && n >= 0
    ? n
    : fallback;
}
export const staleMs = () => envMs('KEEL_STALE_MS', 10_000);
export const retryMs = () => envMs('KEEL_RETRY_MS', 5);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Returns { token, since } or null if unparseable (callers must treat null as "held"). */
function parse(content) {
  const parts = content.trim().split(':');
  if (parts.length !== 3) return null;
  const since = Number(parts[2]);
  if (!/^\d+$/.test(parts[0]) || parts[1] === '' || !Number.isFinite(since) || since <= 0) return null;
  return { token: parts[1], since };
}

function readLock(lockPath) {
  try {
    return fs.readFileSync(lockPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** Take the lock; resolves to the token that proves ownership. */
export async function acquire(lockPath) {
  const token = crypto.randomBytes(8).toString('hex');
  const scratch = `${lockPath}.${process.pid}.${token}`;

  for (;;) {
    // Content first, in a file only this acquisition knows about.
    fs.writeFileSync(scratch, `${process.pid}:${token}:${Date.now()}`);

    try {
      // Atomic, and fails if the target exists. The lock appears fully formed or not at all.
      fs.linkSync(scratch, lockPath);
      fs.unlinkSync(scratch);
      return token;
    } catch (error) {
      fs.unlinkSync(scratch);
      if (error.code !== 'EEXIST') throw error;

      const seen = readLock(lockPath);
      const parsed = seen === null ? null : parse(seen);
      // Fail closed. Unparseable means "I don't know", and the only safe reading of "I
      // don't know" is that somebody is holding it.
      if (parsed && Date.now() - parsed.since > staleMs()) {
        // Re-read and compare so we don't delete a lock replaced since we looked. Not atomic:
        // see header.
        if (readLock(lockPath) === seen) {
          try {
            fs.unlinkSync(lockPath);
          } catch {
            // Already gone.
          }
        }
        continue;
      }

      await sleep(retryMs() + Math.random() * retryMs());
    }
  }
}

function holdsLock(lockPath, token) {
  const content = readLock(lockPath);
  return content !== null && parse(content)?.token === token;
}

/** Release only a lock we still hold; throws LockLostError if it is no longer ours. */
export function release(lockPath, token) {
  if (!holdsLock(lockPath, token)) {
    throw new LockLostError(`lock ${lockPath} is no longer held by token ${token}`);
  }
  fs.unlinkSync(lockPath);
}

async function attempt({ file, value, delay, stallAfterAcquire }) {
  const lockPath = `${file}.lock`;
  const token = await acquire(lockPath);
  let wrote = false;

  try {
    const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const values =
      raw.trim() === '' ? [] : raw.trim().split(',').map((field) => Number(field.trim()));

    // The same window the naive strategy loses to. Held under the lock it is harmless, which
    // is why both strategies are measured with the same delay.
    if (delay > 0) await sleep(delay);
    if (stallAfterAcquire > 0) await sleep(stallAfterAcquire);

    values.push(value);
    values.sort((a, b) => a - b);

    const tmp = `${file}.${token}.tmp`;
    fs.writeFileSync(tmp, values.join(','));
    try {
      if (!holdsLock(lockPath, token)) {
        throw new LockLostError(`lock stolen before write of ${value}; nothing written`);
      }
      fs.renameSync(tmp, file);
      wrote = true;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  } catch (error) {
    // Do not release a lock that is not ours; only free it if we still hold it.
    if (!(error instanceof LockLostError) && holdsLock(lockPath, token)) {
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // Gone already.
      }
    }
    throw error;
  }

  try {
    release(lockPath, token);
  } catch (error) {
    if (error instanceof LockLostError) {
      throw new LockLostError(`lock lost after writing ${value}; write may have raced`, { wrote });
    }
    throw error;
  }
}

export async function contribute({ file, value, delay, stallAfterAcquire = 0, attempts = 5 }) {
  for (let n = 1; ; n += 1) {
    try {
      return await attempt({ file, value, delay, stallAfterAcquire });
    } catch (error) {
      // Lost before writing: nothing happened, so redo. Lost after: redoing would duplicate.
      if (error instanceof LockLostError && !error.wrote && n < attempts && /nothing written/.test(error.message)) {
        continue;
      }
      throw error;
    }
  }
}
