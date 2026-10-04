import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verify } from '../src/verify.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, '..', 'src', 'verify.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-test-'));
let n = 0;
function file(content) {
  const p = path.join(dir, `f${n++}.txt`);
  fs.writeFileSync(p, content);
  return p;
}
const range = (k) => Array.from({ length: k }, (_, i) => i + 1);
function run(content, expected) {
  return verify(file(content), expected);
}
function has(result, prefix) {
  return result.failures.some((f) => f.startsWith(prefix));
}

test('correct 1,2,3 passes and returns the documented shape', () => {
  const r = run('1,2,3', range(3));
  assert.deepEqual(r, { ok: true, failures: [], found: 3, expected: 3 });
});

test('empty file with empty expected passes', () => {
  const r = run('', []);
  assert.equal(r.ok, true);
  assert.equal(r.found, 0);
});

test('empty file with non-empty expected fails complete (missing)', () => {
  const r = run('', range(3));
  assert.equal(r.ok, false);
  assert.ok(has(r, 'missing 3'));
  assert.ok(!has(r, 'file not found'));
});

test('missing file reports file not found, distinct from empty', () => {
  const r = verify(path.join(dir, 'nope.txt'), range(2));
  assert.equal(r.ok, false);
  assert.ok(has(r, 'file not found'));
  assert.ok(has(r, 'missing 2'));
});

test('missing file fails even with empty expected', () => {
  const r = verify(path.join(dir, 'nope2.txt'), []);
  assert.equal(r.ok, false);
  assert.ok(has(r, 'file not found'));
});

test('single value passes', () => {
  assert.equal(run('1', [1]).ok, true);
});

test('trailing newline and surrounding whitespace pass', () => {
  assert.equal(run('1,2,3\n', range(3)).ok, true);
  assert.equal(run('\n\n1,2,3\n\n', range(3)).ok, true);
});

test('complete: lost update (missing value) is detected', () => {
  const r = run('1,2,4,5', range(5));
  assert.equal(r.ok, false);
  assert.ok(has(r, 'missing 1: [3]'));
  assert.equal(r.found, 4);
  assert.equal(r.expected, 5);
});

test('complete: missing list is capped at 10 entries but count is full', () => {
  const r = run('', range(20));
  assert.ok(has(r, 'missing 20: [1,2,3,4,5,6,7,8,9,10]'));
});

test('sorted: out of order is detected with position', () => {
  const r = run('1,3,2', range(3));
  assert.equal(r.ok, false);
  assert.ok(has(r, 'out of order at position 3: 3 then 2'));
});

test('sorted: only the first inversion is reported', () => {
  const r = run('3,2,1', range(3));
  assert.equal(r.failures.filter((f) => f.startsWith('out of order')).length, 1);
});

test('duplicate values are detected', () => {
  const r = run('1,2,2,3', range(3));
  assert.equal(r.ok, false);
  assert.ok(has(r, 'duplicated: [2]'));
  assert.ok(!has(r, 'missing'));
});

test('invented value is reported as unexpected', () => {
  const r = run('1,2,3,99', range(3));
  assert.equal(r.ok, false);
  assert.ok(has(r, 'unexpected: [99]'));
});

test('negative number is unexpected', () => {
  const r = run('-1,1,2', range(2));
  assert.equal(r.ok, false);
  assert.ok(has(r, 'unexpected: [-1]'));
  assert.ok(!has(r, 'malformed'));
});

test('malformed: torn write ",," is detected', () => {
  const r = run('1,,3', range(3));
  assert.equal(r.ok, false);
  assert.ok(has(r, 'malformed fields: [""]'));
});

test('malformed: trailing comma', () => {
  const r = run('1,2,3,', range(3));
  assert.equal(r.ok, false);
  assert.ok(has(r, 'malformed fields: [""]'));
});

test('malformed: leading comma', () => {
  const r = run(',1,2,3', range(3));
  assert.equal(r.ok, false);
  assert.ok(has(r, 'malformed fields'));
});

test('malformed: 2.0 is not an integer field', () => {
  const r = run('1,2.0,3', range(3));
  assert.equal(r.ok, false);
  assert.ok(has(r, 'malformed fields: ["2.0"]'));
});

test('malformed: non-numeric junk, and malformed fields are not counted as values', () => {
  const r = run('1,x,3', range(3));
  assert.ok(has(r, 'malformed fields: ["x"]'));
  assert.equal(r.found, 2);
});

test('malformed list is capped at 5 entries', () => {
  const r = run('a,b,c,d,e,f,g', []);
  assert.ok(has(r, 'malformed fields: ["a","b","c","d","e"]'));
});

test('multi-line input fails with expected 1 line', () => {
  const r = run('1,2\n3', range(3));
  assert.equal(r.ok, false);
  assert.ok(has(r, 'expected 1 line, found 2'));
});

test('multi-line input: only the first line is parsed, so the rest is also missing', () => {
  const r = run('1,2\n3', range(3));
  assert.ok(has(r, 'missing 1: [3]'));
  assert.equal(r.found, 2);
});

test('one-number-per-line format fails', () => {
  const r = run('1\n2\n3\n', range(3));
  assert.equal(r.ok, false);
  assert.ok(has(r, 'expected 1 line, found 3'));
});

test('pinned: whitespace-padded fields are currently accepted', () => {
  assert.equal(run('1, 2, 3', range(3)).ok, true);
  assert.equal(run(' 1 , 2 , 3 ', range(3)).ok, true);
});

test('pinned: leading zeros are currently accepted', () => {
  assert.equal(run('01,02,03', range(3)).ok, true);
});

test('pinned: whitespace-only field is malformed', () => {
  const r = run('1, ,3', range(3));
  assert.ok(has(r, 'malformed fields'));
});

test('several failure modes can be reported together', () => {
  const r = run('2,1,1,9', range(3));
  assert.ok(has(r, 'out of order'));
  assert.ok(has(r, 'missing 1: [3]'));
  assert.ok(has(r, 'duplicated: [1]'));
  assert.ok(has(r, 'unexpected: [9]'));
});

test('CLI works from a path containing a space (no silent false PASS)', () => {
  const spaced = fs.mkdtempSync(path.join(os.tmpdir(), 'verify space '));
  const good = path.join(spaced, 'numbers.txt');
  fs.writeFileSync(good, '1,2,3\n');
  const copy = path.join(spaced, 'verify.mjs');
  fs.copyFileSync(script, copy);
  for (const entry of [script, copy]) {
    const pass = spawnSync(process.execPath, [entry, good, '3'], { cwd: spaced, encoding: 'utf8' });
    assert.match(pass.stdout, /PASS/);
    assert.equal(pass.status, 0);
    const bad = path.join(spaced, 'bad.txt');
    fs.writeFileSync(bad, '1,3');
    const fail = spawnSync(process.execPath, [entry, bad, '3'], { cwd: spaced, encoding: 'utf8' });
    assert.match(fail.stdout, /FAIL/);
    assert.equal(fail.status, 1);
  }
});

test('CLI reports FAIL with file not found for a nonexistent file', () => {
  const r = spawnSync(process.execPath, [script, path.join(dir, 'absent.txt'), '2'], { encoding: 'utf8' });
  assert.match(r.stdout, /FAIL/);
  assert.match(r.stdout, /file not found/);
  assert.equal(r.status, 1);
});

test('CLI: relative script path works', () => {
  const good = file('1,2');
  const r = spawnSync(process.execPath, ['src/verify.mjs', good, '2'], {
    cwd: path.resolve(here, '..'),
    encoding: 'utf8',
  });
  assert.match(r.stdout, /PASS/);
});

test('importing the module does not run the CLI', () => {
  const r = spawnSync(process.execPath, ['-e', `import(${JSON.stringify(script)}).then(()=>console.log('imported'))`], { encoding: 'utf8' });
  assert.equal(r.stdout.trim(), 'imported');
});
