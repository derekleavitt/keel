import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { contribute, compact } from '../src/strategies/append.mjs';
import { verify } from '../src/verify.mjs';

const range = (n) => Array.from({ length: n }, (_, i) => i + 1);
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'append-')), 'numbers.txt');
const read = (f) => fs.readFileSync(f, 'utf8');

test('50 concurrent contribute() then compact() passes the oracle; compact twice is byte-identical', async () => {
  const file = tmpFile();
  await Promise.all(range(50).map((value) => contribute({ file, value, delay: Math.random() * 5 })));
  compact(file);
  const result = verify(file, range(50));
  assert.ok(result.ok, result.failures.join('; '));
  const first = fs.readFileSync(file);
  compact(file);
  assert.deepEqual(fs.readFileSync(file), first);
  assert.ok(!fs.existsSync(`${file}.tmp`));
});

test('precondition: a naive read-sort-write compaction loses an append that lands mid-compaction', () => {
  let failures = 0;
  for (let trial = 0; trial < 20; trial += 1) {
    const file = tmpFile();
    fs.writeFileSync(file, ',3,1,2');
    // The old compact(): read, sort, write back; an append lands between read and write.
    const values = read(file).split(',').filter(Boolean).map(Number).sort((a, b) => a - b);
    fs.appendFileSync(file, ',4');
    fs.writeFileSync(file, values.join(','));
    if (!verify(file, range(4)).ok) failures += 1;
  }
  assert.equal(failures, 20);
});

test('compact() throws instead of overwriting when an append lands mid-compaction', () => {
  for (let trial = 0; trial < 20; trial += 1) {
    const file = tmpFile();
    fs.writeFileSync(file, ',3,1,2');
    assert.throws(
      () => compact(file, { beforeRename: () => fs.appendFileSync(file, ',4') }),
      /compacted during writes/,
    );
    // Nothing was eaten: the late append is still in the file, and no tmp file is left behind.
    assert.deepEqual(read(file).split(',').filter(Boolean).map(Number).sort(), [1, 2, 3, 4]);
    assert.ok(!fs.existsSync(`${file}.tmp`));
    // Rerunning once writers are done succeeds.
    compact(file);
    assert.ok(verify(file, range(4)).ok);
  }
});

test('compact() against real concurrent appender processes never corrupts the file (throws or succeeds)', async () => {
  const file = tmpFile();
  const total = 200;
  fs.writeFileSync(file, '');
  const script = `
    const fs = require('node:fs');
    const [file, from, to] = process.argv.slice(1);
    for (let v = +from; v <= +to; v++) fs.appendFileSync(file, ',' + v);
  `;
  const children = [0, 1, 2, 3].map((i) => new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', script, file, i * 50 + 1, i * 50 + 50], { stdio: 'inherit' });
    child.on('exit', resolve);
  }));
  let throws = 0; // informational: how often the guard fired
  let live = true;
  Promise.all(children).then(() => { live = false; });
  while (live) {
    try { compact(file); } catch (error) {
      assert.match(error.message, /compacted during writes/);
      throws += 1;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  compact(file); // writers are done; this one must succeed
  const result = verify(file, range(total));
  // A rename between a child's open and write can still swallow a value (documented limit),
  // so only assert what the guard promises: no corruption, no duplicates, nothing invented.
  assert.ok(!result.failures.some((f) => /malformed|duplicated|unexpected|out of order/.test(f)), result.failures.join('; '));
});

test('edge cases: empty file, lone comma, trailing comma, missing file', () => {
  for (const [content, expected] of [['', ''], [',', ''], [',,', ''], [',2,1,', '1,2'], [',2,1', '1,2']]) {
    const file = tmpFile();
    fs.writeFileSync(file, content);
    compact(file);
    assert.equal(read(file), expected, JSON.stringify(content));
  }
  const missing = tmpFile();
  compact(missing);
  assert.equal(read(missing), '');
});
