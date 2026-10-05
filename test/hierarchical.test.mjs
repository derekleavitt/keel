import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { contribute, compact, groupFile, name } from '../src/strategies/hierarchical.mjs';
import { verify } from '../src/verify.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// The runner writes under <its own root>/runs. Run it from a scratch copy of src/ so this test
// asserts on its own trials only, never on the real runs/ that other tests write to concurrently.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sortlab-hier-'));
fs.cpSync(path.join(root, 'src'), path.join(scratch, 'src'), { recursive: true });
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hier-')), 'trial.txt');

test('exports the strategy name', () => assert.equal(name, 'hierarchical'));

test('values land in group files by ceil(value / fanout)', async () => {
  const file = tmp();
  assert.equal(groupFile(file, 1), `${file}.g1`);
  assert.equal(groupFile(file, 10), `${file}.g1`);
  assert.equal(groupFile(file, 11), `${file}.g2`);
  assert.equal(groupFile(file, 100), `${file}.g10`);
  await contribute({ file, value: 11, delay: 0 });
  await contribute({ file, value: 3, delay: 0 });
  assert.equal(fs.readFileSync(`${file}.g2`, 'utf8'), ',11');
  assert.equal(fs.readFileSync(`${file}.g1`, 'utf8'), ',3');
});

test('SORTLAB_FANOUT changes the grouping', () => {
  const file = tmp();
  process.env.SORTLAB_FANOUT = '4';
  try {
    assert.equal(groupFile(file, 4), `${file}.g1`);
    assert.equal(groupFile(file, 5), `${file}.g2`);
  } finally {
    delete process.env.SORTLAB_FANOUT;
  }
});

test('compact of 100 shuffled values passes the oracle, no group file sees more than fanout', async () => {
  const file = tmp();
  fs.writeFileSync(file, '');
  const values = Array.from({ length: 100 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);
  await Promise.all(values.map((value) => contribute({ file, value, delay: 0 })));
  const stats = compact(file);
  const result = verify(file, Array.from({ length: 100 }, (_, i) => i + 1));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(stats.groups, 10);
  assert.ok(stats.maxGroupValues <= 10);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['trial.txt']);
});

test('real processes via the runner leave no group files', () => {
  const run = spawnSync(process.execPath, [path.join(scratch, 'src/run.mjs'), '--agents', '25', '--strategy', 'hierarchical', '--trials', '2'], {
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const left = fs.readdirSync(path.join(scratch, 'runs')).filter((f) => /\.txt\.g\d+$/.test(f));
  assert.deepEqual(left, []);
});
