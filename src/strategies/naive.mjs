/**
 * Read the file, insert your number, write the file back.
 *
 * This is what anybody writes first, and it is what an agent told "keep the file sorted"
 * will do unprompted. It is correct with one worker and wrong with two, and the wrongness is
 * invisible from inside: every individual worker reads valid state, computes a valid result,
 * and writes a valid file.
 *
 * The window is between the read and the write. Anything another worker commits in that gap
 * is gone — not corrupted, not conflicted, just silently absent from the state this worker
 * based its answer on.
 *
 * Here as the baseline. It is supposed to fail.
 */
import fs from 'node:fs';

export const name = 'naive';

export async function contribute({ file, value, delay }) {
  const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const values =
    raw.trim() === '' ? [] : raw.trim().split(',').map((field) => Number(field.trim()));

  // Widen the read-write window so the race is reliable rather than occasional. Without it
  // the failure is real but rare, which is the worst way to learn about it.
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

  values.push(value);
  values.sort((a, b) => a - b);

  fs.writeFileSync(file, values.join(','));
}
