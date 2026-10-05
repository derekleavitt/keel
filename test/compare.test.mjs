import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compare, parseRecord, CompareError } from '../src/compare.mjs';
import { ASSUMPTIONS } from '../src/cost-model.mjs';

/*
 * The two fixtures under test/fixtures are SYNTHETIC: hand-written, never measured. Tests that
 * read them prove this tool's arithmetic is right, nothing about any model constant. The
 * inline records below are synthetic for the same reason.
 */
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = (n) => path.join(root, 'test', 'fixtures', `record-${n}.jsonl`);
const load = (n) => parseRecord(fs.readFileSync(fixture(n), 'utf8'));
const byName = (r, name) => r.assumptions.find((a) => a.name === name);
const cli = (...args) => spawnSync(process.execPath, [path.join(root, 'src', 'compare.mjs'), ...args], { encoding: 'utf8' });
const within = (x, target, frac) => Math.abs(x - target) <= frac * target;

const call = (o = {}) => ({
  agent: '0', role: 'leaf', level: 0, startedMs: 0, ms: 1520, inputTokens: 45, outputTokens: 2,
  stopReason: 'end_turn', outcome: 'accepted', valuesIn: 1, valuesOut: 1, ...o,
});
const summary = (o = {}) => ({
  summary: true, topology: 'solo', model: 'claude-haiku-4-5', agents: 10, fanout: null, concurrency: 20,
  calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 1000, ok: true, ...o,
});

test('fixtures are labelled synthetic in the file itself', () => {
  for (const n of ['partitioned', 'hierarchical']) {
    assert.ok(load(n).comments.some((c) => /^SYNTHETIC FIXTURE/.test(c)), n);
  }
});

test('hierarchical fixture: the law is recovered, and the fit method is stated', () => {
  const r = compare(load('hierarchical').records);
  assert.ok(within(byName(r, 'latencyMs').measured, 1500, 0.01));
  assert.ok(within(byName(r, 'outputTokensPerSecond').measured, 100, 0.01));
  assert.equal(byName(r, 'overhead.api').measured, 45);
  assert.equal(byName(r, 'tokensPerNumber.list').measured, 2);
  assert.equal(byName(r, 'tokensPerNumber.single').measured, 2);
  assert.equal(byName(r, 'overhead.api').assumed, ASSUMPTIONS.OVERHEAD.api);
  assert.match(byName(r, 'latencyMs').note, /one-variable|two-variable/);
  assert.equal(r.run.fanout, 3);
  assert.equal(r.totals.input, 927);
  assert.equal(r.totals.output, 96);
});

test('hierarchical totals project the tree that ran: no fanout warning, 3890 input', () => {
  const r = compare(load('hierarchical').records);
  assert.ok(!r.warnings.some((w) => /fanout/.test(w)), r.warnings.join('|'));
  // 19 calls of api overhead, plus 36 non-leaf covered values (see test/cost-model.test.mjs).
  assert.equal(r.projected.input, 19 * ASSUMPTIONS.OVERHEAD.api + 36 * ASSUMPTIONS.TOKENS_PER_NUMBER);
  assert.equal(r.projected.input, 3890);
});

test('a hierarchical record with an unusable fanout warns instead of projecting a guess', () => {
  const recs = load('hierarchical').records.map((x) => (x.summary ? { ...x, fanout: 1 } : x));
  const r = compare(recs);
  assert.equal(r.projected.input, null);
  assert.ok(r.warnings.some((w) => /could not project.*fanout/.test(w)));
});

test('no note repeats its own status prefix', () => {
  for (const n of ['partitioned', 'hierarchical']) {
    for (const a of compare(load(n).records).assumptions) {
      assert.doesNotMatch(a.note, /^not[- ]identifiable/i, `${n} ${a.name}`);
    }
  }
});

test('partitioned fixture: slope is not identifiable and latency is only a bound', () => {
  const r = compare(load('partitioned').records);
  const ops = byName(r, 'outputTokensPerSecond');
  assert.equal(ops.measured, null);
  assert.equal(ops.ratio, null);
  assert.match(ops.note, /degenerate|distinct/);
  assert.equal(byName(r, 'latencyMs').status, 'upper-bound');
  assert.equal(byName(r, 'latencyMs').measured, 1520);
  assert.equal(byName(r, 'tokensPerNumber.list').measured, null);
  assert.equal(byName(r, 'prefillMsPerInputToken').measured, null);
});

test('assumptions always has the five required names, and lists what it cannot check', () => {
  for (const n of ['partitioned', 'hierarchical']) {
    const r = compare(load(n).records);
    const names = r.assumptions.map((a) => a.name);
    for (const want of ['overhead.api', 'tokensPerNumber.single', 'tokensPerNumber.list', 'latencyMs', 'outputTokensPerSecond']) {
      assert.ok(names.includes(want), want);
    }
    assert.ok(r.unchecked.some((u) => /50\/50/.test(u)));
    assert.ok(r.unchecked.some((u) => /prefill/.test(u)));
    assert.ok(r.unchecked.some((u) => /merge/.test(u)));
  }
});

test('a mock record is refused, not fitted', () => {
  const mock = [
    ...Array.from({ length: 4 }, (_, i) => call({ agent: String(i), inputTokens: 0, outputTokens: 0, stopReason: null })),
    summary({ model: 'mock:clean', calls: 4 }),
  ];
  assert.throws(() => compare(mock), (e) => e instanceof CompareError && /mock/.test(e.message));
  // the label is on the summary only, so it must be caught even when the summary is not last
  assert.throws(() => compare([mock[4], ...mock.slice(0, 4)]), /mock/);
});

test('a real mock run written by agents.mjs --record is refused by the CLI with exit 2', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-mock-'));
  try {
    const rec = path.join(dir, 'rec.jsonl');
    const gen = spawnSync(process.execPath, [
      path.join(root, 'src', 'agents.mjs'), '--agents', '12', '--topology', 'hierarchical', '--fanout', '3',
      '--mock', 'clean', '--record', rec, '--out', path.join(dir, 'out.txt'),
    ], { encoding: 'utf8' });
    assert.equal(gen.status, 0, gen.stderr);
    const r = cli(rec);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /mock/);
    assert.equal(r.stdout, '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a non-mock record with zero tokens reports every token-derived assumption as null', () => {
  const recs = [call({ inputTokens: 0, outputTokens: 0, stopReason: null }), call({ agent: '1', inputTokens: 0, outputTokens: 0, stopReason: null }), summary({ calls: 2 })];
  const r = compare(recs);
  for (const n of ['overhead.api', 'tokensPerNumber.single', 'tokensPerNumber.list', 'latencyMs', 'outputTokensPerSecond']) {
    const a = byName(r, n);
    assert.equal(a.measured, null, n);
    assert.equal(a.ratio, null, n);
    assert.match(a.note, /zero tokens/, n);
  }
});

test('two-variable fit separates prefill from latency (synthetic law, varied inputs)', () => {
  // ms = 1200 + 8 * out + 0.5 * in; inputs and outputs vary independently
  const pts = [[10, 50], [200, 20], [60, 400], [400, 100], [30, 900], [500, 600], [90, 250], [350, 40]];
  const calls = pts.map(([o, i], k) => call({ agent: String(k), role: 'solo', inputTokens: i, outputTokens: o, ms: 1200 + 8 * o + 0.5 * i, valuesOut: o / 2 }));
  const r = compare([...calls, summary({ calls: calls.length })]);
  assert.ok(Math.abs(byName(r, 'latencyMs').measured - 1200) < 1e-6);
  assert.ok(Math.abs(byName(r, 'outputTokensPerSecond').measured - 125) < 1e-6);
  assert.ok(Math.abs(byName(r, 'prefillMsPerInputToken').measured - 0.5) < 1e-6);
  assert.match(byName(r, 'latencyMs').note, /two-variable/);
  assert.equal(byName(r, 'latencyMs').status, 'measured');
});

test('a one-variable fit attributes prefill to latency and says so', () => {
  const calls = [2, 10, 40, 90, 150].map((o, k) => call({ agent: String(k), role: 'merger', inputTokens: 45 + o, outputTokens: o, ms: 1500 + 10 * o + 0.5 * (45 + o), valuesOut: o / 2 }));
  const r = compare([...calls, summary({ calls: calls.length })]);
  const lat = byName(r, 'latencyMs');
  assert.match(lat.note, /one-variable/);
  assert.match(lat.note, /prefill/);
  assert.equal(lat.status, 'upper-bound');
  assert.ok(lat.measured > 1500);
});

test('retry-inflated calls are dropped from the fit and counted; max_tokens calls are excluded', () => {
  const sizes = [2, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190];
  const calls = sizes.map((o, k) => call({ agent: String(k), role: 'merger', inputTokens: 45, outputTokens: o, ms: 1500 + 10 * o, valuesOut: o / 2 }));
  calls[7].ms += 8000; // an SDK retry: nothing in the record says so
  calls.push(call({ agent: 'cap', role: 'solo', outputTokens: 4096, ms: 1500 + 10 * 4096 + 9000, stopReason: 'max_tokens', valuesOut: 1 }));
  const r = compare([...calls, summary({ calls: calls.length })]);
  assert.equal(r.fit.droppedAsRetries, 1);
  assert.ok(within(byName(r, 'latencyMs').measured, 1500, 0.01));
  assert.ok(within(byName(r, 'outputTokensPerSecond').measured, 100, 0.01));
  assert.ok(r.warnings.some((w) => /max_tokens/.test(w)));
  assert.ok(r.warnings.some((w) => /retries/.test(w)));
});

test('compare() does not modify its input', () => {
  const { records } = load('hierarchical');
  const before = JSON.stringify(records);
  compare(records);
  assert.equal(JSON.stringify(records), before);
});

test('CLI prints one assumption line each and four totals lines, exit 0, on both fixtures', () => {
  for (const n of ['partitioned', 'hierarchical']) {
    const r = cli(fixture(n));
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.split('\n');
    for (const name of ['overhead.api', 'tokensPerNumber.single', 'tokensPerNumber.list', 'latencyMs', 'outputTokensPerSecond']) {
      const l = lines.find((x) => x.startsWith(name));
      assert.ok(l, `${n}: ${name}`);
      assert.match(l, /^\S+\s+assumed \S+\s+measured \S+\s+ratio \S+/);
    }
    for (const label of ['tokens in', 'tokens out', 'cost', 'time']) {
      const l = lines.find((x) => x.startsWith(label));
      assert.ok(l, `${n}: ${label}`);
      assert.match(l, /^(tokens in|tokens out|cost|time)\s+projected \S+\s+measured \S+\s+ratio \S+/);
    }
    assert.match(r.stdout, /SYNTHETIC RECORD/);
    assert.match(r.stdout, /not checked by this tool/);
  }
  assert.match(cli(fixture('partitioned')).stdout, /outputTokensPerSecond\s+assumed 100\s+measured -\s+ratio -/);
});

test('--json prints the compare() result and nothing else', () => {
  const r = cli(fixture('hierarchical'), '--json');
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), JSON.parse(JSON.stringify(compare(load('hierarchical').records))));
});

test('missing file, no summary line and non-JSON all exit 2 with a message naming the problem', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-bad-'));
  try {
    const m = cli(path.join(dir, 'nope.jsonl'));
    assert.equal(m.status, 2);
    assert.match(m.stderr, /cannot read/);

    const noSummary = path.join(dir, 'a.jsonl');
    fs.writeFileSync(noSummary, JSON.stringify(call()) + '\n');
    const s = cli(noSummary);
    assert.equal(s.status, 2);
    assert.match(s.stderr, /no summary/);

    const bad = path.join(dir, 'b.jsonl');
    fs.writeFileSync(bad, JSON.stringify(call()) + '\nthis is not json\n');
    const b = cli(bad);
    assert.equal(b.status, 2);
    assert.match(b.stderr, /line 2 is not JSON/);

    assert.equal(cli().status, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
