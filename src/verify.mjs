#!/usr/bin/env node
/**
 * The oracle.
 *
 * The whole reason this problem is worth using as a testbed: success is decidable. Four
 * properties, each true or false. No judgement about whether a run went well.
 *
 * Format is one line, comma separated: `1,2,3,...,N`. That is not a cosmetic choice. With one
 * number per line, concurrent appends can't corrupt each other and a final `sort` fixes
 * everything — the coordination problem mostly evaporates. On a single line it doesn't:
 * appends land in arrival order inside one line, so somebody has to decide where each number
 * goes, and that decision needs to see the current state.
 */
import fs from 'node:fs';
import process from 'node:process';

export function verify(path, expected) {
  const raw = fs.existsSync(path) ? fs.readFileSync(path, 'utf8').trim() : '';
  const failures = [];

  // One line. Two means somebody appended with a newline and broke the format.
  const lines = raw.split('\n').filter((line) => line.trim() !== '');
  if (lines.length > 1) failures.push(`expected 1 line, found ${lines.length}`);

  const fields = raw === '' ? [] : (lines[0] ?? '').split(',');

  /*
   * Well-formed. Two appends that interleave mid-field give "1213" or ",,". Checking this
   * first means a torn write reads as a torn write rather than as one missing number and one
   * mysterious extra.
   */
  const malformed = fields.filter((field) => !/^-?\d+$/.test(field.trim()));
  if (malformed.length > 0) {
    failures.push(`malformed fields: ${JSON.stringify(malformed.slice(0, 5))}`);
  }

  const values = fields
    .filter((field) => /^-?\d+$/.test(field.trim()))
    .map((field) => Number(field.trim()));

  // Sorted.
  for (let i = 1; i < values.length; i += 1) {
    const previous = values[i - 1] ?? 0;
    const current = values[i] ?? 0;
    if (previous > current) {
      failures.push(`out of order at position ${i + 1}: ${previous} then ${current}`);
      break;
    }
  }

  /*
   * Complete. This is where a lost update shows up and nowhere else — two workers read the
   * same state, both write, one contribution vanishes. The file is still sorted, still
   * well-formed, nothing errored. Only the missing number gives it away.
   */
  const present = new Set(values);
  const missing = expected.filter((n) => !present.has(n));
  if (missing.length > 0) {
    failures.push(`missing ${missing.length}: ${JSON.stringify(missing.slice(0, 10))}`);
  }

  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const duplicated = [...counts].filter(([, n]) => n > 1).map(([v]) => v);
  if (duplicated.length > 0) {
    failures.push(`duplicated: ${JSON.stringify(duplicated.slice(0, 10))}`);
  }

  const expectedSet = new Set(expected);
  const extra = values.filter((v) => !expectedSet.has(v));
  if (extra.length > 0) {
    failures.push(`unexpected: ${JSON.stringify(extra.slice(0, 10))}`);
  }

  return { ok: failures.length === 0, failures, found: values.length, expected: expected.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , file = 'numbers.txt', count = '10'] = process.argv;
  const expected = Array.from({ length: Number(count) }, (_, i) => i + 1);
  const result = verify(file, expected);
  console.log(result.ok ? 'PASS' : 'FAIL');
  for (const failure of result.failures) console.log(`  ${failure}`);
  process.exit(result.ok ? 0 : 1);
}
