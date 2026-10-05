import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// The runner writes under <its own root>/runs, and keeps the files of failing trials on purpose.
// This file runs failing trials deliberately, so it runs the harness from a copy of src/ in a
// scratch directory: its trials land in <scratch>/runs, never in the real runs/ (which
// test/hierarchical.test.mjs scans for group files while other tests are running).
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-run-'));
fs.cpSync(path.join(root, 'src'), path.join(scratch, 'src'), { recursive: true });
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const run = (args) => spawnSync(process.execPath, [path.join(scratch, 'src/run.mjs'), ...args], { encoding: 'utf8', timeout: 30_000 });
const worker = (args) => spawnSync(process.execPath, [path.join(scratch, 'src/worker.mjs'), ...args], { encoding: 'utf8', timeout: 10_000 });
const medianOf = (out) => Number(/median: (\d+)ms/.exec(out)[1]);

test('append survives two hung workers and finishes under 10s', () => {
  const started = Date.now();
  const r = run(['--agents', '8', '--strategy', 'append', '--faulty', '2', '--fault', 'hang', '--timeout', '2000', '--trials', '2']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(Date.now() - started < 10_000);
  assert.match(r.stdout, /passed:\s+2\/2/);
  assert.match(r.stdout, /hung \(killed\): 4/);
});

test('naive fails, lockfile passes (pins the README table)', () => {
  assert.equal(run(['--agents', '8', '--strategy', 'naive', '--trials', '3']).status, 1);
  assert.equal(run(['--agents', '8', '--strategy', 'lockfile', '--trials', '3']).status, 0);
});

test('a crashed worker is reported as crashed and its elapsed time is real, not 0', () => {
  const r = run(['--agents', '6', '--strategy', 'append', '--faulty', '1', '--fault', 'crash', '--trials', '3']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /crashed: 3 /);
  assert.ok(medianOf(r.stdout) > 0);
});

test('a slow worker still lets lockfile pass', () => {
  const r = run(['--agents', '5', '--strategy', 'lockfile', '--slow', '1', '--slow-ms', '300', '--trials', '1']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('a thrown trial records real elapsed time, not 0', () => {
  // Mid-trial failure: strategy file exists but run dir is unusable is hard to force, so use a
  // healthy worker that is killed by the timeout: it fails the trial and must report time > 0.
  const r = run(['--agents', '3', '--strategy', 'append', '--slow', '1', '--slow-ms', '3000', '--timeout', '300', '--trials', '1']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /timed out/);
  assert.ok(medianOf(r.stdout) >= 300);
});

test('worker rejects missing --file and non-numeric --value with exit 2', () => {
  let r = worker(['--value', '1']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--file/);
  r = worker(['--file', 'x.txt']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--value/);
  r = worker(['--file', 'x.txt', '--value', 'abc']);
  assert.equal(r.status, 2);
});

test('worker --crash-at exits 3', () => {
  const r = worker(['--file', path.join(scratch, 'runs/crash-test.txt'), '--value', '1', '--strategy', 'append', '--delay', '500', '--crash-at', '10']);
  assert.equal(r.status, 3);
});

test('run rejects bad arguments with exit 2', () => {
  assert.equal(run(['--agents', '2', '--faulty', '3']).status, 2);
  assert.equal(run(['--fault', 'explode']).status, 2);
});
