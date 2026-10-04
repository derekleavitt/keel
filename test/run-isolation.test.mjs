import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const runs = path.join(root, 'runs');
const script = path.join(root, 'src', 'run.mjs');

function run(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code) => resolve({ code, stdout, stderr, pid: child.pid }));
  });
}

const filesOf = (out) => [...out.matchAll(/^file: (.+)$/gm)].map((m) => m[1]);
const cleanup = (...outs) => {
  for (const out of outs) for (const f of filesOf(out.stdout)) fs.rmSync(f, { force: true });
};

test('two concurrent invocations both exit 0', async () => {
  const args = ['--agents', '12', '--strategy', 'append', '--trials', '4'];
  const [a, b] = await Promise.all([run(args), run(args)]);
  assert.equal(a.code, 0, a.stdout + a.stderr);
  assert.equal(b.code, 0, b.stdout + b.stderr);
  assert.match(a.stdout, /^passed:\s+4\/4/m);
  assert.match(b.stdout, /^passed:\s+4\/4/m);
});

test('concurrent invocations write to disjoint paths, none of them a bare trial-N.txt', async () => {
  const args = ['--agents', '6', '--strategy', 'append', '--trials', '3', '--keep'];
  const [a, b] = await Promise.all([run(args), run(args)]);
  try {
    assert.equal(a.code, 0, a.stdout + a.stderr);
    assert.equal(b.code, 0, b.stdout + b.stderr);
    const fa = filesOf(a.stdout);
    const fb = filesOf(b.stdout);
    assert.equal(fa.length, 3);
    assert.equal(fb.length, 3);
    assert.equal(new Set([...fa, ...fb]).size, 6, 'paths must be disjoint');
    for (const f of [...fa, ...fb]) {
      assert.equal(path.dirname(f), runs, 'output stays inside runs/');
      assert.match(path.basename(f), /^trial-\d+-\d+\.txt$/);
    }
    // Each file carries its own process's pid, not the other's.
    for (const f of fa) assert.ok(path.basename(f).startsWith(`trial-${a.pid}-`));
    for (const f of fb) assert.ok(path.basename(f).startsWith(`trial-${b.pid}-`));
  } finally {
    cleanup(a, b);
  }
});

test('hierarchical group files inherit isolation: a foreign stale group file is not merged in', async () => {
  fs.mkdirSync(runs, { recursive: true });
  // Planted under pids no live run can have (above the OS pid range on macOS and Linux defaults),
  // for every trial index, with a value that would fail the oracle if it were merged.
  const stale = [0, 1, 2].map((i) => path.join(runs, `trial-99999999-${i}.txt.g1`));
  for (const f of stale) fs.writeFileSync(f, ',777');
  try {
    const args = ['--agents', '12', '--strategy', 'hierarchical', '--trials', '3'];
    const [a, b] = await Promise.all([run(args, { SORTLAB_FANOUT: '4' }), run(args, { SORTLAB_FANOUT: '4' })]);
    assert.equal(a.code, 0, a.stdout + a.stderr);
    assert.equal(b.code, 0, b.stdout + b.stderr);
    for (const f of stale) assert.equal(fs.readFileSync(f, 'utf8'), ',777', 'foreign file untouched');
  } finally {
    for (const f of stale) fs.rmSync(f, { force: true });
  }
});

test('trial index prefixes do not capture each other (trial-P-1 vs trial-P-10)', async () => {
  // 11 trials: trial 1's cleanup/compact globs must not touch trial 10's group files.
  const r = await run(['--agents', '6', '--strategy', 'hierarchical', '--trials', '11'], { SORTLAB_FANOUT: '2' });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^passed:\s+11\/11/m);
});

test('a passing run leaves nothing behind in runs/', async () => {
  const before = new Set(fs.existsSync(runs) ? fs.readdirSync(runs) : []);
  const r = await run(['--agents', '6', '--strategy', 'hierarchical', '--trials', '2'], { SORTLAB_FANOUT: '2' });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const own = fs.readdirSync(runs).filter((n) => n.startsWith(`trial-${r.pid}-`));
  assert.deepEqual(own, []);
  assert.ok(fs.readdirSync(runs).every((n) => before.has(n) || !n.startsWith(`trial-${r.pid}-`)));
});

test('runs/ is gitignored', () => {
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split('\n').map((l) => l.trim());
  assert.ok(ignore.some((l) => l === 'runs/' || l === '/runs/' || l === 'runs' || l === '/runs'));
});
