import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { acquire, release, contribute, LockLostError } from '../src/strategies/lockfile.mjs';
import { verify } from '../src/verify.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lockfile-')), 'numbers.txt');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const range = (n) => Array.from({ length: n }, (_, i) => i + 1);

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  Object.assign(process.env, vars);
  const restore = () => {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  };
  return Promise.resolve().then(fn).finally(restore);
}

function run(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(root, 'src/run.mjs'), ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (out += c));
    child.on('close', (code) => resolve({ code, out }));
  });
}

test('fail closed: an unparseable lock is not taken within 200ms', async () => {
  await withEnv({ SORTLAB_STALE_MS: '50', SORTLAB_RETRY_MS: '2' }, async () => {
    const lockPath = `${tmpFile()}.lock`;
    fs.writeFileSync(lockPath, 'garbage');
    let got = null;
    const p = acquire(lockPath).then((t) => (got = t));
    await sleep(200);
    assert.equal(got, null);
    assert.equal(fs.readFileSync(lockPath, 'utf8'), 'garbage');
    fs.unlinkSync(lockPath); // let the pending acquire finish
    await p;
    release(lockPath, got);
  });
});

test('fail closed: an empty lock is not taken either', async () => {
  await withEnv({ SORTLAB_STALE_MS: '50', SORTLAB_RETRY_MS: '2' }, async () => {
    const lockPath = `${tmpFile()}.lock`;
    fs.writeFileSync(lockPath, '');
    let got = null;
    const p = acquire(lockPath).then((t) => (got = t));
    await sleep(200);
    assert.equal(got, null);
    fs.unlinkSync(lockPath);
    await p;
  });
});

test('a lock older than SORTLAB_STALE_MS is taken', async () => {
  await withEnv({ SORTLAB_STALE_MS: '100', SORTLAB_RETRY_MS: '2' }, async () => {
    const lockPath = `${tmpFile()}.lock`;
    fs.writeFileSync(lockPath, `99999:deadbeef:${Date.now() - 1000}`);
    const token = await acquire(lockPath);
    assert.match(fs.readFileSync(lockPath, 'utf8'), new RegExp(`^${process.pid}:${token}:\\d+$`));
    release(lockPath, token);
    assert.ok(!fs.existsSync(lockPath));
  });
});

test('SORTLAB_STALE_MS is honoured: a fresh lock is not taken', async () => {
  await withEnv({ SORTLAB_STALE_MS: '60000', SORTLAB_RETRY_MS: '2' }, async () => {
    const lockPath = `${tmpFile()}.lock`;
    fs.writeFileSync(lockPath, `1:abc:${Date.now()}`);
    let got = null;
    const p = acquire(lockPath).then((t) => (got = t));
    await sleep(150);
    assert.equal(got, null);
    fs.unlinkSync(lockPath);
    await p;
  });
});

test('release by a non-owner throws LockLostError and leaves the real holder\'s lock', async () => {
  const lockPath = `${tmpFile()}.lock`;
  const mine = await acquire(lockPath);
  fs.unlinkSync(lockPath); // stolen
  const theirs = await acquire(lockPath);
  assert.throws(() => release(lockPath, mine), LockLostError);
  assert.ok(fs.existsSync(lockPath), 'new holder\'s lock must survive');
  release(lockPath, theirs);
  assert.throws(() => release(lockPath, theirs), LockLostError); // already gone
});

test('a holder whose lock was stolen writes nothing and does not delete the thief\'s lock', async () => {
  await withEnv({ SORTLAB_STALE_MS: '80', SORTLAB_RETRY_MS: '2' }, async () => {
    const file = tmpFile();
    const lockPath = `${file}.lock`;
    fs.writeFileSync(file, '10');

    const slow = contribute({ file, value: 1, delay: 0, stallAfterAcquire: 400, attempts: 1 });
    const outcome = slow.then(() => null, (e) => e);
    await sleep(200); // slow holds a lock now > STALE_MS old
    const thief = await acquire(lockPath); // steals it
    const thiefLock = fs.readFileSync(lockPath, 'utf8');
    fs.writeFileSync(file, '10,20'); // the thief's work

    const err = await outcome;
    assert.ok(err instanceof LockLostError, String(err));
    assert.equal(err.wrote, false);
    assert.equal(fs.readFileSync(file, 'utf8'), '10,20', 'stale RMW must not overwrite');
    assert.equal(fs.readFileSync(lockPath, 'utf8'), thiefLock, 'thief\'s lock must survive');
    assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((n) => n.endsWith('.tmp')), []);
    release(lockPath, thief);
  });
});

test('contribute retries after a pre-write loss and the value lands exactly once', async () => {
  await withEnv({ SORTLAB_STALE_MS: '80', SORTLAB_RETRY_MS: '2' }, async () => {
    const file = tmpFile();
    const slow = contribute({ file, value: 1, delay: 0, stallAfterAcquire: 300 });
    await sleep(20);
    await Promise.all([2, 3, 4].map((value) => contribute({ file, value, delay: 5 })));
    await slow;
    const r = verify(file, range(4));
    assert.ok(r.ok, r.failures.join('; '));
  });
});

test('30 concurrent in-process contributors all land', async () => {
  const file = tmpFile();
  await Promise.all(range(30).map((value) => contribute({ file, value, delay: 1 })));
  const r = verify(file, range(30));
  assert.ok(r.ok, r.failures.join('; '));
  assert.ok(!fs.existsSync(`${file}.lock`));
});

// Started together at import time (they use separate trial files) to keep the file under ~20s.
const slowRun = run(
  ['--agents', '8', '--strategy', 'lockfile', '--slow', '1', '--slow-ms', '1500', '--trials', '5'],
  { SORTLAB_STALE_MS: '500' },
);
const twentyRun = run(['--agents', '20', '--strategy', 'lockfile', '--trials', '10']);

test('harness: slow holder with SORTLAB_STALE_MS=500 passes 5/5 (--slow 1 --slow-ms 1500)', async () => {
  const { code, out } = await slowRun;
  assert.equal(code, 0, out);
  assert.match(out, /passed:\s+5\/5/);
});

test('harness: twenty agents, 10/10 (pins the README claim)', async () => {
  const { code, out } = await twentyRun;
  assert.equal(code, 0, out);
  assert.match(out, /passed:\s+10\/10/);
});
