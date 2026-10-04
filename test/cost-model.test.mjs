import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { project, TOPOLOGY_NAMES } from '../src/cost-model.mjs';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/cost-model.mjs');
const cli = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

test('pinned token totals for 100 api agents', () => {
  const pins = {
    solo: [200, 250],
    partitioned: [20000, 250],
    'shared-lock': [32375, 12625],
  };
  for (const [topology, [input, output]] of Object.entries(pins)) {
    const r = project({ agents: 100, kind: 'api', topology });
    assert.equal(r.input, input, `${topology} input`);
    assert.equal(r.output, output, `${topology} output`);
  }
});

test('hierarchical input follows the explicit level formula', () => {
  // 100 leaves (overhead only) + 10 mergers reading 10 numbers + root reading all 100.
  const expected = 100 * 200 + 10 * (200 + 10 * 2.5) + (200 + 100 * 2.5);
  assert.equal(expected, 22700);
  const r = project({ agents: 100, topology: 'hierarchical', kind: 'api' });
  assert.equal(r.input, expected);
  assert.equal(r.output, 750);
  assert.equal(r.rounds, 3);
});

test('hierarchical has log_fanout(N) merge levels', () => {
  assert.equal(project({ agents: 1000, topology: 'hierarchical' }).calls, 1000 + 100 + 10 + 1);
  assert.equal(project({ agents: 1000, topology: 'hierarchical' }).rounds, 4);
  // Root reads all N numbers, so tokens grow faster than linearly in N.
  const small = project({ agents: 100, topology: 'hierarchical', kind: 'api' });
  const big = project({ agents: 1000, topology: 'hierarchical', kind: 'api' });
  assert.ok(big.output / small.output > 10);
});

test('latency scales with tokens generated: solo gets slower, distribution can win', () => {
  const soloSmall = project({ agents: 100, topology: 'solo' });
  const soloBig = project({ agents: 100_000, topology: 'solo' });
  assert.ok(soloBig.seconds > soloSmall.seconds * 100);
  const parted = project({ agents: 100_000, topology: 'partitioned' });
  assert.ok(parted.seconds < soloBig.seconds, 'partitioned beats solo at large N');
  // The hierarchical root still has to emit all N numbers, so its critical path is never
  // shorter than solo's generation time: agent-merging cannot win on time in this model.
  const hier = project({ agents: 100_000, topology: 'hierarchical' });
  assert.ok(hier.seconds > soloBig.seconds, 'hierarchical root emits O(N) tokens, like solo');
  assert.ok(project({ agents: 100, topology: 'solo' }).seconds < project({ agents: 100, topology: 'shared-lock' }).seconds);
});

test('project rejects unknown names', () => {
  assert.throws(() => project({ agents: 10, model: 'gpt' }), /unknown model/);
  assert.throws(() => project({ agents: 10, topology: 'ring' }), /unknown topology/);
  assert.throws(() => project({ agents: 10, kind: 'x' }), /unknown kind/);
  assert.throws(() => project({ agents: 10, model: 'constructor' }), /unknown model/);
  assert.throws(() => project({ agents: 0 }), /invalid agents/);
});

test('topology names are exported', () => {
  assert.deepEqual([...TOPOLOGY_NAMES].sort(), ['hierarchical', 'partitioned', 'shared-lock', 'solo']);
});

test('token counts are integers for odd N', () => {
  for (const topology of TOPOLOGY_NAMES) {
    for (const kind of ['api', 'claude-code']) {
      const r = project({ agents: 7, kind, topology });
      assert.ok(Number.isInteger(r.input), `${topology} input ${r.input}`);
      assert.ok(Number.isInteger(r.output), `${topology} output ${r.output}`);
    }
  }
});

test('CLI exits 2 with a message on an unknown model', () => {
  const r = cli('--model', 'gpt');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown model/);
  assert.match(r.stderr, /haiku/);
  assert.equal(r.stdout, '');
});

test('CLI prints 8 data rows and exits 0', () => {
  const r = cli('--agents', '100');
  assert.equal(r.status, 0);
  const rows = r.stdout.split('\n').filter((l) => /^(api|claude-code)\s/.test(l));
  assert.equal(rows.length, 8);
  assert.doesNotMatch(r.stdout, /overhead \d+\/call/);
});

test('--verbose prints overhead, per-call tokens and rounds under each row', () => {
  const r = cli('--agents', '100', '--verbose');
  assert.equal(r.status, 0);
  const lines = r.stdout.split('\n').filter((l) => /overhead \d+\/call, avg \d+ in \/ \d+ out per call, \d+ rounds/.test(l));
  assert.equal(lines.length, 8);
});

test('CLI with odd N prints no fractional tokens', () => {
  const r = cli('--agents', '7');
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /\d\.5\b/);
});

test('ASSUMPTIONS exposes the constants the model computes with, frozen and pinned', async () => {
  const { ASSUMPTIONS } = await import('../src/cost-model.mjs');
  assert.deepEqual(Object.keys(ASSUMPTIONS).sort(), ['LATENCY', 'OUTPUT_TOKENS_PER_SECOND', 'OVERHEAD', 'TOKENS_PER_NUMBER']);
  assert.ok(Object.isFrozen(ASSUMPTIONS));
  for (const k of ['api', 'claude-code']) {
    assert.equal(typeof ASSUMPTIONS.OVERHEAD[k], 'number');
    assert.equal(typeof ASSUMPTIONS.LATENCY[k], 'number');
  }
  assert.equal(ASSUMPTIONS.OUTPUT_TOKENS_PER_SECOND, 100);
  assert.equal(ASSUMPTIONS.TOKENS_PER_NUMBER, 2.5);
});

test('roundCalls sums to calls for every topology', () => {
  for (const n of [1, 7, 100, 1000]) {
    for (const topology of TOPOLOGY_NAMES) {
      const r = project({ agents: n, topology });
      // waves with concurrency 1 is the sum of roundCalls, which must equal calls
      assert.equal(project({ agents: n, topology, concurrency: 1 }).waves, r.calls, `${topology} N=${n}`);
      assert.equal(r.waves, r.rounds, 'unlimited concurrency is one wave per round');
    }
  }
});

test('concurrency validation and its effect on shared-lock and solo', () => {
  for (const bad of [0, -1, NaN, '20', null]) {
    assert.throws(() => project({ agents: 5, concurrency: bad }), /concurrency/, String(bad));
  }
  assert.doesNotThrow(() => project({ agents: 5, concurrency: Infinity }));
  for (const topology of ['solo', 'shared-lock']) {
    assert.equal(
      project({ agents: 100, topology, concurrency: 1 }).seconds,
      project({ agents: 100, topology, concurrency: Infinity }).seconds,
    );
  }
  const a = project({ agents: 100, topology: 'partitioned' });
  assert.equal(a.rounds, 1);
  assert.equal(project({ agents: 100, topology: 'partitioned', concurrency: 20 }).waves, 5);
});

test('CLI --concurrency 20 prints 7.6s for api partitioned; bad values exit 2 naming the flag', () => {
  const ok = cli('--agents', '100', '--concurrency', '20');
  assert.equal(ok.status, 0, ok.stderr);
  const row = ok.stdout.split('\n').find((l) => /^api\s+partitioned/.test(l));
  assert.match(row, /\s7\.6s$/);
  for (const bad of ['0', '-1', 'abc']) {
    const r = cli('--concurrency', bad);
    assert.equal(r.status, 2, bad);
    assert.match(r.stderr, /--concurrency/);
  }
});
