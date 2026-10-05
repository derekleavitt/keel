/**
 * Fan in through group files: workers in groups of FANOUT, each group merged, then the groups
 * merged.
 *
 * A worker never reads anything. It appends `,<value>` to the file for its group and leaves,
 * the same atomic small `O_APPEND` write `append` relies on. Groups are keyed by value, so
 * group g holds values (g-1)*FANOUT+1 .. g*FANOUT and no two groups ever touch the same file.
 * That is the difference from `lockfile`: nothing is shared across groups, so nothing
 * serialises. Within a group the appends are atomic and need no lock either.
 *
 * The difference from `append` is the compaction shape. Each group is sorted on its own, so
 * the group merger sees at most FANOUT values (when values are contiguous, as the runner
 * assigns them). The root then merges already-sorted group files rather than sorting the lot.
 * The root level is not bounded by FANOUT in values: it consumes every group's output. Only
 * the number of inputs per merger, and the leaf level, stay small.
 *
 * Like `append`, the final file is only correct after `compact`, and the group files exist
 * until then.
 */
import fs from 'node:fs';
import path from 'node:path';

export const name = 'hierarchical';

function fanout() {
  const n = Number(process.env.KEEL_FANOUT ?? 10);
  return Number.isInteger(n) && n > 0 ? n : 10;
}

/** Path of the group file a value belongs to. */
export function groupFile(file, value) {
  return `${file}.g${Math.ceil(value / fanout())}`;
}

export async function contribute({ file, value, delay }) {
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  fs.appendFileSync(groupFile(file, value), `,${value}`);
}

function parse(raw) {
  return raw
    .split(',')
    .map((field) => field.trim())
    .filter((field) => field !== '')
    .map(Number);
}

/** Existing group files for `file`, in numeric group order. */
function groupFiles(file) {
  const dir = path.dirname(file);
  const prefix = `${path.basename(file)}.g`;
  return fs
    .readdirSync(dir)
    .filter((entry) => entry.startsWith(prefix) && /^\d+$/.test(entry.slice(prefix.length)))
    .sort((a, b) => Number(a.slice(prefix.length)) - Number(b.slice(prefix.length)))
    .map((entry) => path.join(dir, entry));
}

/**
 * Sort each group file in place, k-way merge them into `file`, delete the group files.
 * Returns { groups, maxGroupValues, rootValues } so callers can measure what each level saw.
 */
export function compact(file) {
  const paths = groupFiles(file);
  const lists = [];
  let maxGroupValues = 0;

  // Level 1: each group merger sees only its own group file.
  for (const p of paths) {
    const values = parse(fs.readFileSync(p, 'utf8')).sort((a, b) => a - b);
    maxGroupValues = Math.max(maxGroupValues, values.length);
    fs.writeFileSync(p, values.join(','));
    lists.push(values);
  }

  // Level 2: k-way merge of sorted lists, advancing one cursor per list.
  const cursors = lists.map(() => 0);
  const merged = [];
  for (;;) {
    let best = -1;
    for (let i = 0; i < lists.length; i += 1) {
      if (cursors[i] < lists[i].length && (best === -1 || lists[i][cursors[i]] < lists[best][cursors[best]])) best = i;
    }
    if (best === -1) break;
    merged.push(lists[best][cursors[best]++]);
  }

  // Nothing to merge (already compacted, or no workers): leave the file alone.
  if (paths.length > 0) {
    fs.writeFileSync(file, merged.join(','));
    for (const p of paths) fs.unlinkSync(p);
  }
  return { groups: paths.length, maxGroupValues, rootValues: merged.length };
}
