/**
 * Guards the test suite against silently shrinking.
 *
 * Why this file exists. While README.md was briefly absent from the tree, `npm test` reported
 * 195 tests and one failure. The honest number was 222 tests: `test/readme.test.mjs` reads the
 * README at module scope, so it threw during import and its 27 tests never registered at all.
 * A gate watching only the failure count saw one red test, not 27 missing checks. That is the
 * worst shape a gate can fail in, because the suite looks nearly green at the moment it stops
 * verifying anything.
 *
 * Nothing inside `test/readme.test.mjs` can catch this: a file that fails to load cannot report
 * on itself. So the check lives here, and deliberately depends on nothing but the filesystem.
 *
 * These are floors, not exact counts. An exact total would have to be edited by every task that
 * adds a test, and a number that must be edited constantly is a number people edit without
 * reading. A floor only moves when it is raised on purpose.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);

/** Raise these only when the suite has genuinely grown. Never lower them to make a gate pass. */
const MIN_TEST_FILES = 15;
const MIN_DECLARED_TESTS = 210;

const testFiles = () => fs.readdirSync(here).filter((f) => f.endsWith('.test.mjs')).sort();

const declaredIn = (file) => (fs.readFileSync(path.join(here, file), 'utf8').match(/^test\(/gm) ?? []).length;

test('every test file declares at least one test', () => {
  for (const f of testFiles()) {
    assert.ok(declaredIn(f) > 0, `${f} declares no tests; it was emptied or its tests were commented out`);
  }
});

test('the suite has not lost files', () => {
  const found = testFiles();
  assert.ok(
    found.length >= MIN_TEST_FILES,
    `only ${found.length} test files, expected at least ${MIN_TEST_FILES}: ${found.join(', ')}`,
  );
});

test('the suite has not lost tests', () => {
  const total = testFiles().reduce((n, f) => n + declaredIn(f), 0);
  assert.ok(
    total >= MIN_DECLARED_TESTS,
    `only ${total} declared tests, expected at least ${MIN_DECLARED_TESTS}`,
  );
});

test('the files other tests read at module scope exist', () => {
  // Each of these is read at import time by some test file. A missing one does not fail that
  // file's tests -- it stops them existing, which is why they are asserted here instead.
  const required = [
    'README.md',
    'package.json',
    'test/fixtures/record-partitioned.jsonl',
    'test/fixtures/record-hierarchical.jsonl',
  ];
  for (const rel of required) {
    const p = path.join(root, rel);
    assert.ok(fs.existsSync(p), `${rel} is missing; tests that read it at module scope will not register`);
    assert.ok(fs.statSync(p).size > 0, `${rel} is empty`);
  }
});

test('README.md is a document, not a stub', () => {
  // A one-line README would keep readme.test.mjs loading while making most of its pins vacuous.
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.ok(readme.length > 10_000, `README.md is ${readme.length} bytes; it was 48908 when this was written`);
  assert.ok(/^# keel/m.test(readme), 'README.md has lost its title');
});

test('every source file the layout documents still exists', () => {
  // Catches a src file being deleted or moved without the suite noticing, which would otherwise
  // only surface as whichever test happened to import it.
  for (const dir of ['src', 'src/strategies']) {
    const files = fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.mjs'));
    assert.ok(files.length > 0, `${dir} contains no .mjs files`);
  }
  for (const rel of ['src/verify.mjs', 'src/cost-model.mjs', 'src/agents.mjs', 'src/compare.mjs', 'src/pricing.mjs']) {
    assert.ok(fs.existsSync(path.join(root, rel)), `${rel} is missing`);
  }
});
