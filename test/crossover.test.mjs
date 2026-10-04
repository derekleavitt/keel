import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { project, crossover, TOPOLOGY_NAMES, KIND_NAMES, SWEEP_WORKS } from '../src/cost-model.mjs';

const CLI = new URL('../src/cost-model.mjs', import.meta.url).pathname;

test('cost is non-decreasing in work for every topology and kind', () => {
  for (const kind of KIND_NAMES) {
    for (const topology of TOPOLOGY_NAMES) {
      let prev = -Infinity;
      for (const work of SWEEP_WORKS) {
        const { cost } = project({ agents: 100, kind, topology, work });
        assert.ok(cost >= prev, `${kind}/${topology} cost fell at work=${work}`);
        prev = cost;
      }
    }
  }
});

test('work defaults to 0 and leaves cost unchanged', () => {
  for (const topology of TOPOLOGY_NAMES) {
    const a = project({ agents: 100, topology });
    const b = project({ agents: 100, topology, work: 0 });
    assert.deepEqual(a, b);
  }
  assert.throws(() => project({ agents: 5, work: -1 }), /work/);
});

test('cost >= solo at every sweep point (the cost claim)', () => {
  for (const agents of [2, 7, 100, 1000]) {
    for (const kind of KIND_NAMES) {
      for (const model of ['haiku', 'opus']) {
        for (const work of SWEEP_WORKS) {
          const solo = project({ agents, model, kind, topology: 'solo', work }).cost;
          for (const topology of TOPOLOGY_NAMES) {
            const c = project({ agents, model, kind, topology, work }).cost;
            assert.ok(c >= solo, `COST CLAIM VIOLATED: ${topology} ${c} < solo ${solo} (N=${agents}, ${kind}, ${model}, work=${work})`);
          }
        }
      }
    }
  }
});

test('crossover shape: partitioned wins, shared-lock never, and the reported point is exact', () => {
  for (const kind of KIND_NAMES) {
    const byName = Object.fromEntries(crossover({ agents: 100, kind }).map((c) => [c.topology, c]));
    assert.equal(byName.partitioned.at, 0);
    assert.equal(byName['shared-lock'].at, null);
    const h = byName.hierarchical.at;
    assert.ok(h > 0, 'hierarchical must not win at zero work');
    const secs = (topology, work) => project({ agents: 100, kind, topology, work }).seconds;
    assert.ok(secs('hierarchical', h) < secs('solo', h));
    assert.ok(secs('hierarchical', h - 1) >= secs('solo', h - 1));
  }
});

test('hierarchical is slower than solo at N=100,000 with no work', () => {
  const h = project({ agents: 100_000, topology: 'hierarchical' }).seconds;
  const s = project({ agents: 100_000, topology: 'solo' }).seconds;
  assert.ok(h > s);
});

test('--crossover exits 0 and prints verdict lines', () => {
  const r = spawnSync(process.execPath, [CLI, '--agents', '100', '--crossover'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^\s*\S+ beats solo on time at work >= \d+$/m);
  assert.match(r.stdout, /never within sweep/);
  assert.doesNotMatch(r.stdout, /COST CLAIM VIOLATED/);
});

test('--work 0 leaves cost columns identical; --work changes the cost', () => {
  const run = (...a) => spawnSync(process.execPath, [CLI, '--agents', '100', ...a], { encoding: 'utf8' }).stdout;
  const cols = (out) => out.split('\n').filter((l) => /^(api|claude-code) /.test(l)).map((l) => l.slice(0, 74));
  assert.deepEqual(cols(run('--work', '0')), cols(run()));
  assert.notDeepEqual(cols(run('--work', '500')), cols(run()));
});
