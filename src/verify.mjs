#!/usr/bin/env node
/**
 * The oracle.
 *
 * This is the point of the whole exercise: success is decidable. Not "looks right", not
 * "the tests pass" — four properties, each true or false, checked against the set of numbers
 * that were supposed to be contributed.
 *
 * Everything else here exists to be judged by this file.
 */
import fs from 'node:fs';
import process from 'node:process';

export function verify(path, expected) {
  const raw = fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '';
  const lines = raw.split('\n').filter((line) => line.trim() !== '');

  const failures = [];

  /*
   * 1. Well-formed.
   *
   * Two overlapping appends can interleave mid-line and produce "1213" out of 12 and 13.
   * Checking this first means a torn write is reported as a torn write, rather than as a
   * missing number plus a mysterious extra one.
   */
  const malformed = lines.filter((line) => !/^-?\d+$/.test(line.trim()));
  if (malformed.length > 0) {
    failures.push(`malformed lines: ${JSON.stringify(malformed.slice(0, 5))}`);
  }

  const values = lines
    .filter((line) => /^-?\d+$/.test(line.trim()))
    .map((line) => Number(line.trim()));

  // 2. Sorted.
  for (let i = 1; i < values.length; i += 1) {
    const previous = values[i - 1] ?? 0;
    const current = values[i] ?? 0;
    if (previous > current) {
      failures.push(`out of order at line ${i + 1}: ${previous} then ${current}`);
      break;
    }
  }

  /*
   * 3. Complete.
   *
   * This is where a lost update shows up, and nowhere else. Two agents read the same state,
   * both write, and one contribution vanishes. The file is still sorted. It is still
   * well-formed. Nothing errored. The only evidence is a number that should be there and
   * isn't — which is exactly why this problem is worth a testbed.
   */
  const present = new Set(values);
  const missing = expected.filter((n) => !present.has(n));
  if (missing.length > 0) {
    failures.push(`missing ${missing.length}: ${JSON.stringify(missing.slice(0, 10))}`);
  }

  // 4. Nothing duplicated, nothing invented.
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const duplicated = [...counts].filter(([, n]) => n > 1).map(([v]) => v);
  if (duplicated.length > 0) {
    failures.push(`duplicated: ${JSON.stringify(duplicated.slice(0, 10))}`);
  }

  const expectedSet = new Set(expected);
  const extra = values.filter((v) => !expectedSet.has(v));
  if (extra.length > 0) {
    failures.push(`unexpected values: ${JSON.stringify(extra.slice(0, 10))}`);
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
