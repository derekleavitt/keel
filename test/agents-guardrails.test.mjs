import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn as spawnAsync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runAgents, mockTransport, main } from '../src/agents.mjs';
import { project } from '../src/cost-model.mjs';
import { MODELS } from '../src/pricing.mjs';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'agents.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-guard-'));
let counter = 0;
const out = () => path.join(tmp, `out-${counter++}.txt`);
const wanted = (prompt) => Number(prompt.match(/-?\d+/)[0]);

/** A transport that counts how often it is called. */
function counting(inner = async (p) => String(wanted(p))) {
  const t = async (prompt, max) => { t.count += 1; return inner(prompt, max); };
  t.count = 0;
  return t;
}

/** Run the exported CLI in-process, capturing stdout/stderr. */
async function cli(argv, deps) {
  const log = console.log; const err = console.error;
  const stdout = []; const stderr = [];
  console.log = (...a) => stdout.push(a.join(' '));
  console.error = (...a) => stderr.push(a.join(' '));
  try {
    const code = await main(argv, deps);
    return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
  } finally {
    console.log = log; console.error = err;
  }
}

function spawn(args, env = {}) {
  const e = { ...process.env, ...env };
  delete e.ANTHROPIC_API_KEY; delete e.ANTHROPIC_AUTH_TOKEN;
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: e });
}

test('--dry-run makes zero calls and writes nothing, even with a transport available', async () => {
  const t = counting();
  const file = out();
  const r = await cli(['--agents', '12', '--topology', 'shared-lock', '--dry-run', '--out', file], { transport: t });
  assert.equal(r.code, 0);
  assert.equal(t.count, 0);
  assert.equal(fs.existsSync(file), false, 'runAgents would have created the output file');
  assert.match(r.stdout, /no calls made/);
});

test('--dry-run passes the harness concurrency (default 20) to project(), not Infinity', async () => {
  for (const [extra, c] of [[[], 20], [['--concurrency', '3'], 3]]) {
    const r = await cli(['--agents', '100', '--topology', 'partitioned', '--dry-run', ...extra]);
    const p = project({ agents: 100, model: 'haiku', kind: 'api', topology: 'partitioned', concurrency: c });
    assert.ok(r.stdout.includes(`time ${p.seconds.toFixed(1)}s  (concurrency ${c})`), r.stdout);
  }
  const unlimited = project({ agents: 100, model: 'haiku', kind: 'api', topology: 'partitioned' });
  const limited = project({ agents: 100, model: 'haiku', kind: 'api', topology: 'partitioned', concurrency: 20 });
  assert.notEqual(unlimited.seconds, limited.seconds, 'the distinction under test must exist');
});

test('--dry-run output equals project() for every topology, via the real CLI, no credentials', () => {
  const cases = [
    { topology: 'partitioned', extra: [], fanout: undefined },
    { topology: 'hierarchical', extra: ['--fanout', '3'], fanout: 3 },
    { topology: 'solo', extra: [], fanout: undefined },
    { topology: 'shared-lock', extra: [], fanout: undefined },
  ];
  for (const c of cases) {
    const r = spawn(['--agents', '12', '--topology', c.topology, '--dry-run', ...c.extra]);
    assert.equal(r.status, 0, r.stderr);
    const p = project({ agents: 12, model: 'haiku', kind: 'api', topology: c.topology, concurrency: 20, fanout: c.fanout });
    assert.ok(
      r.stdout.includes(`projected  calls ${p.calls}  tokens ${p.input} in / ${p.output} out  cost $${p.cost.toFixed(4)}  time ${p.seconds.toFixed(1)}s  (concurrency 20)`),
      `${c.topology}\n${r.stdout}`,
    );
    assert.match(r.stdout, /kind api/);
    assert.match(r.stdout, /^sdk {2}(installed|not installed \(run npm install\))$/m);
  }
});

test('--dry-run prints the full model id for an alias; an unknown id exits 2', () => {
  const ok = spawn(['--dry-run', '--model', 'sonnet']);
  assert.equal(ok.status, 0);
  assert.ok(ok.stdout.includes(MODELS.sonnet.id));
  const bad = spawn(['--dry-run', '--model', 'gpt-nope']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown model id; cost cannot be projected/);
});

test('--max-spend below the projection exits 3 with zero calls, naming both figures', async () => {
  const t = counting();
  const file = out();
  const p = project({ agents: 12, model: 'haiku', kind: 'api', topology: 'shared-lock', concurrency: 20 });
  const ceiling = p.cost / 2;
  const r = await cli(['--agents', '12', '--topology', 'shared-lock', '--max-spend', String(ceiling), '--out', file], { transport: t });
  assert.equal(r.code, 3);
  assert.equal(t.count, 0);
  assert.equal(fs.existsSync(file), false);
  assert.ok(r.stderr.includes(`$${p.cost.toFixed(4)}`), r.stderr);
  assert.ok(r.stderr.includes(`$${ceiling}`), r.stderr);
});

test('--max-spend above the projection runs normally; --mock output is identical to no ceiling', async () => {
  for (const topology of ['solo', 'partitioned', 'hierarchical', 'shared-lock']) {
    const a = await cli(['--agents', '8', '--topology', topology, '--mock', 'clean', '--out', out()]);
    const b = await cli(['--agents', '8', '--topology', topology, '--mock', 'clean', '--max-spend', '1000', '--out', out()]);
    assert.equal(a.code, 0);
    assert.equal(b.code, 0);
    assert.equal(b.stdout.replace(/latency .*/, '').replace(/time .*/, ''), a.stdout.replace(/latency .*/, '').replace(/time .*/, ''));
  }
});

test('--dry-run with --max-spend reports the verdict, exits 0 and makes no call', async () => {
  const t = counting();
  const r = await cli(['--agents', '100', '--topology', 'shared-lock', '--dry-run', '--max-spend', '0.01'], { transport: t });
  assert.equal(r.code, 0);
  assert.equal(t.count, 0);
  assert.match(r.stdout, /would be refused \(exit 3\)/);
});

test('--max-spend validation: non-positive, non-numeric or missing exits 2', () => {
  for (const bad of [['--max-spend', '0'], ['--max-spend', '-1'], ['--max-spend', 'abc'], ['--max-spend']]) {
    const r = spawn(['--mock', 'clean', '--out', out(), ...bad]);
    assert.equal(r.status, 2, JSON.stringify(bad));
  }
});

test('runAgents maxSpend: stops starting calls once measured spend exceeds it (concurrency 1)', async () => {
  const haiku = MODELS.haiku;
  const perCall = (100 / 1e6) * haiku.input + (5 / 1e6) * haiku.output;
  const t = counting(async (p) => ({ text: String(wanted(p)), inputTokens: 100, outputTokens: 5 }));
  const outcome = await runAgents({
    topology: 'partitioned', agents: 10, call: t, file: out(), concurrency: 1,
    maxSpend: perCall * 4, model: haiku.id,
  });
  assert.equal(outcome.usage.calls, 5);
  assert.equal(t.count, 5, 'the sixth call never started');
  assert.equal(outcome.ok, false);
  assert.match(outcome.stopped, /spend ceiling/);
  assert.equal(outcome.errored.length, 0, 'unstarted calls are not errors');
});

test('runAgents maxSpend: accounting is from reported usage, not the projection', async () => {
  // A transport that reports 1000x the tokens the projection expects trips the ceiling at once,
  // although the projection for this run is far below it.
  const p = project({ agents: 10, model: 'haiku', kind: 'api', topology: 'partitioned', concurrency: 1 });
  const t = counting(async (q) => ({ text: String(wanted(q)), inputTokens: 1_000_000, outputTokens: 0 }));
  const outcome = await runAgents({
    topology: 'partitioned', agents: 10, call: t, file: out(), concurrency: 1,
    maxSpend: p.cost * 10, model: 'haiku',
  });
  assert.ok(outcome.usage.calls <= 2, `calls ${outcome.usage.calls}`);
  assert.match(outcome.stopped, /spend ceiling/);
});

test('runAgents maxSpend: works across serial and hierarchical topologies and rejects unknown models', async () => {
  for (const topology of ['solo', 'hierarchical', 'shared-lock']) {
    const t = counting(async (q) => {
      const base = mockTransport('clean');
      return { text: await base(q), inputTokens: 1000, outputTokens: 10 };
    });
    const outcome = await runAgents({
      topology, agents: 12, fanout: 3, call: t, file: out(), concurrency: 1,
      maxSpend: 0.0001, model: MODELS.haiku.id,
    });
    assert.equal(outcome.ok, false, topology);
    assert.ok(outcome.stopped, topology);
    assert.ok(t.count <= 2, `${topology}: ${t.count}`);
  }
  await assert.rejects(
    runAgents({ topology: 'solo', agents: 3, call: counting(), file: out(), maxSpend: 1, model: 'nope' }),
    /known model/,
  );
});

test('CLI mid-run stop prints the stopped line and exits 1', async () => {
  const p = project({ agents: 10, model: 'haiku', kind: 'api', topology: 'partitioned', concurrency: 1 });
  const ceiling = p.cost * 2; // passes the preflight...
  const t = counting(async (q) => ({ text: String(wanted(q)), inputTokens: 1_000_000, outputTokens: 0 })); // ...but real usage is far higher
  const r = await cli(['--agents', '10', '--topology', 'partitioned', '--concurrency', '1', '--max-spend', String(ceiling), '--out', out()], { transport: t });
  assert.equal(r.code, 1);
  assert.ok(t.count >= 1 && t.count < 10, `calls ${t.count}`);
  assert.match(r.stdout, /^stopped {3}spend ceiling \$.* reached after \d+ calls \(\$.* spent\); up to 1 further calls may have been in flight$/m);
});

/* ---- T-022: refuse bad arguments and unpriced models before spending ---- */

test('bad --agents / --concurrency exit 2 with empty stdout, naming the flag, and make zero calls', async () => {
  for (const [flag, values] of [['--agents', ['abc', '0', '2.5', '-1']], ['--concurrency', ['abc', '0', 'Infinity', '2.5']]]) {
    for (const v of values) {
      const r = spawn(['--mock', 'clean', '--out', out(), flag, v]);
      assert.equal(r.status, 2, `${flag} ${v}`);
      assert.equal(r.stdout, '', `${flag} ${v}`);
      assert.ok(r.stderr.includes(flag), r.stderr);
      assert.ok(r.stderr.includes(JSON.stringify(v)), r.stderr);
      const t = counting();
      const file = out();
      const c = await cli([flag, v, '--out', file], { transport: t });
      assert.equal(c.code, 2, `${flag} ${v}`);
      assert.equal(t.count, 0, `${flag} ${v}: calls were made`);
      assert.equal(fs.existsSync(file), false);
    }
  }
  const missing = spawn(['--mock', 'clean', '--out', out(), '--agents']);
  assert.equal(missing.status, 2);
});

test('runAgents throws on a non-integer or non-positive agents or concurrency, with no calls', async () => {
  for (const agents of [NaN, 0, 2.5, -1]) {
    const t = counting();
    await assert.rejects(runAgents({ topology: 'partitioned', agents, call: t, file: out() }), /agents must be an integer >= 1/);
    assert.equal(t.count, 0);
  }
  for (const concurrency of [NaN, 0, Infinity, 2.5, -1]) {
    const t = counting();
    await assert.rejects(runAgents({ topology: 'partitioned', agents: 4, concurrency, call: t, file: out() }), /concurrency must be an integer >= 1/);
    assert.equal(t.count, 0);
  }
});

test('an unpriced model on a real run exits 2 before the credential check, with zero calls', async () => {
  const bad = spawn(['--agents', '3', '--model', 'claude-sonnet-4-5', '--out', out()]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /src\/pricing\.mjs/);
  assert.doesNotMatch(bad.stderr, /No credentials/);
  const t = counting(async (p) => ({ text: String(wanted(p)), inputTokens: 3000, outputTokens: 3000 }));
  const file = out();
  const r = await cli(['--agents', '3', '--model', 'claude-sonnet-4-5', '--out', file], { transport: t });
  assert.equal(r.code, 2);
  assert.equal(t.count, 0);
  assert.equal(fs.existsSync(file), false);
  assert.equal(r.stdout, '');
});

test('priced models still run: alias, full id, and --mock (unaffected by --model)', async () => {
  for (const model of ['sonnet', MODELS.sonnet.id]) {
    const t = counting();
    const r = await cli(['--agents', '3', '--topology', 'partitioned', '--model', model, '--out', out()], { transport: t });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(t.count, 3);
  }
  const r = spawn(['--agents', '3', '--mock', 'clean', '--model', 'not-a-model', '--out', out()]);
  assert.equal(r.status, 0, r.stderr);
  // no credential: an unset key with a priced model reaches the credential message
  assert.match(spawn(['--agents', '3', '--model', 'haiku']).stderr, /No credentials/);
});

test('default --out includes the process id; concurrent runs of the same shape write different files', async () => {
  const runsDir = path.join(path.dirname(script), '..', 'runs');
  const run = () => new Promise((resolve) => {
    const e = { ...process.env }; delete e.ANTHROPIC_API_KEY;
    const child = spawnAsync(process.execPath, [script, '--agents', '4', '--topology', 'shared-lock', '--mock', 'clean'], { env: e });
    child.on('close', (code) => resolve({ code, pid: child.pid }));
  });
  const [a, b] = await Promise.all([run(), run()]);
  const fa = path.join(runsDir, `agents-shared-lock-4-${a.pid}.txt`);
  const fb = path.join(runsDir, `agents-shared-lock-4-${b.pid}.txt`);
  try {
    assert.equal(a.code, 0); assert.equal(b.code, 0);
    assert.notEqual(fa, fb);
    assert.ok(fs.existsSync(fa), fa);
    assert.ok(fs.existsSync(fb), fb);
  } finally {
    fs.rmSync(fa, { force: true }); fs.rmSync(fb, { force: true });
  }
});
