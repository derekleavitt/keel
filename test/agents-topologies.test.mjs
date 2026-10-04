import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TOPOLOGY_NAMES } from '../src/cost-model.mjs';
import { runAgents, mockTransport, report, diagnoseSolo, IMPLEMENTED_TOPOLOGIES } from '../src/agents.mjs';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'agents.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-topo-'));
let counter = 0;
const out = () => path.join(tmp, `out-${counter++}.txt`);

function cli(...args) {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return spawnSync(process.execPath, [script, ...args, '--out', out()], { encoding: 'utf8', env });
}
const range = (n) => Array.from({ length: n }, (_, i) => i + 1);
const isSolo = (p) => p.startsWith('Output every integer');
const isMerge = (p) => p.startsWith('Merge these numbers');
const mergeData = (p) => p.split('\n')[1].split(',').map(Number);

// The two files cannot silently diverge ------------------------------------------------------

test('every topology the cost model projects is implemented and accepted in mock mode', () => {
  assert.deepEqual([...IMPLEMENTED_TOPOLOGIES].sort(), [...TOPOLOGY_NAMES].sort());
  for (const topology of TOPOLOGY_NAMES) {
    const r = cli('--mock', 'clean', '--agents', '12', '--topology', topology);
    assert.equal(r.status, 0, `${topology}: ${r.stdout}${r.stderr}`);
  }
});

test('cli: solo is exactly 1 call', () => {
  const r = cli('--mock', 'clean', '--agents', '30', '--topology', 'solo');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^calls {4}1$/m);
});

test('cli: hierarchical 30 agents fanout 10 is 30 + 3 + 1 = 34 calls', () => {
  const r = cli('--mock', 'clean', '--agents', '30', '--topology', 'hierarchical', '--fanout', '10');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^calls {4}34$/m);
});

test('cli: fanout defaults to 10, and bad fanout exits 2', () => {
  assert.match(cli('--mock', 'clean', '--agents', '30', '--topology', 'hierarchical').stdout, /^calls {4}34$/m);
  assert.match(cli('--mock', 'clean', '--agents', '30', '--topology', 'hierarchical', '--fanout', '5').stdout, /^calls {4}39$/m); // 30 + 6 + 2 + 1
  assert.equal(cli('--mock', 'clean', '--agents', '30', '--topology', 'hierarchical', '--fanout', '1').status, 2);
});

for (const mode of ['newline', 'prose']) {
  test(`cli: hierarchical mock ${mode} exits 0 (parser exercised at merge level)`, () => {
    assert.equal(cli('--mock', mode, '--agents', '30', '--topology', 'hierarchical').status, 0);
  });
}

test('cli: solo mock newline and prose exit 0; empty exits 1', () => {
  assert.equal(cli('--mock', 'newline', '--agents', '30', '--topology', 'solo').status, 0);
  assert.equal(cli('--mock', 'prose', '--agents', '30', '--topology', 'solo').status, 0);
  assert.equal(cli('--mock', 'empty', '--agents', '30', '--topology', 'solo').status, 1);
});

// hierarchical: call counts follow the cost model's tree --------------------------------------

test('hierarchical: call counts match the cost model tree for several (N, fanout)', async () => {
  const expected = (n, f) => {
    let calls = n;
    let count = n;
    while (count > 1) { count = Math.ceil(count / f); calls += count; }
    return calls;
  };
  for (const [n, f] of [[1, 10], [2, 10], [10, 10], [11, 10], [100, 10], [30, 3], [17, 4], [64, 2]]) {
    const o = await runAgents({ topology: 'hierarchical', agents: n, fanout: f, call: mockTransport('clean'), file: out() });
    assert.equal(o.ok, true, `${n}/${f}: ${o.oracle.failures}`);
    assert.equal(o.usage.calls, expected(n, f), `${n}/${f}`);
  }
  assert.equal(expected(100, 10), 111); // README table
});

// hierarchical: measuring what each participant sees ------------------------------------------

test('hierarchical: measured maxima - workers and group mergers are bounded by fanout, the root is not', async () => {
  const o = await runAgents({ topology: 'hierarchical', agents: 100, fanout: 10, call: mockTransport('clean'), file: out() });
  assert.equal(o.ok, true);
  const [leaf, group, root] = o.levels;
  assert.equal(leaf.maxValuesIn, 1);
  assert.equal(leaf.maxValuesOut, 1);
  assert.equal(group.participants, 10);
  assert.ok(group.maxChildren <= 10 && group.maxValuesIn <= 10 && group.maxValuesOut <= 10);
  assert.equal(root.role, 'root');
  assert.equal(root.maxChildren, 10);
  assert.equal(root.maxValuesIn, 100); // the root reads all N
  assert.equal(root.maxValuesOut, 100); // and emits all N
  assert.match(report({ topology: 'hierarchical', model: 'm', agents: 100, outcome: o, fanout: 10 }), /L2 root\s+x1\s+max children 10\s+max in 100\s+max out 100/);
});

test('hierarchical: three merge levels - a mid-level merger covers fanout^2 values, not fanout', async () => {
  const o = await runAgents({ topology: 'hierarchical', agents: 100, fanout: 3, call: mockTransport('clean'), file: out() });
  const byLevel = Object.fromEntries(o.levels.map((l) => [l.level, l]));
  assert.equal(byLevel[1].maxValuesIn, 3);
  assert.equal(byLevel[2].maxValuesIn, 9);
  assert.ok(Object.values(byLevel).every((l) => l.maxChildren <= 3));
  assert.equal(Math.max(...o.levels.map((l) => l.maxValuesIn)), 100);
});

test('hierarchical: measurement comes from the prompts the model received, not from the structure', async () => {
  const seen = [];
  const o = await runAgents({
    topology: 'hierarchical', agents: 20, fanout: 5, file: out(),
    call: async (p) => { if (isMerge(p)) seen.push(mergeData(p).length); return mockTransport('clean')(p); },
  });
  assert.equal(Math.max(...seen), 20);
  assert.equal(o.levels.at(-1).maxValuesIn, 20);
});

// hierarchical: blame --------------------------------------------------------------------------

test('hierarchical: an unparseable merger reply is a rejection naming the merger, its reply and the dropped values', async () => {
  const mock = mockTransport('clean');
  const o = await runAgents({
    topology: 'hierarchical', agents: 30, fanout: 10, file: out(),
    call: async (p) => (isMerge(p) && mergeData(p).length === 10 && mergeData(p).includes(1) ? 'I am unable to merge these.' : mock(p)),
  });
  assert.equal(o.ok, false);
  assert.equal(o.rejected.length, 1);
  assert.match(o.rejected[0].agent, /^merger L1\./);
  assert.match(o.rejected[0].reply, /unable to merge/);
  assert.match(o.rejected[0].reason, /no integer.*10 values it was given are dropped/);
  assert.equal(o.errored.length, 0);
  assert.ok(o.oracle.failures.some((f) => /missing 10/.test(f)));
  assert.ok(!o.oracle.failures.some((f) => /unexpected|duplicated|malformed/.test(f)));
  const text = report({ topology: 'hierarchical', model: 'm', agents: 30, outcome: o, fanout: 10 });
  assert.match(text, /merger L1\.\d+ returned "I am unable to merge these\." — harness rejected it/);
});

test('hierarchical: a merger returning the wrong count is a rejection, a root rejection leaves the file empty', async () => {
  const mock = mockTransport('clean');
  const file = out();
  const o = await runAgents({
    topology: 'hierarchical', agents: 30, fanout: 10, file,
    call: async (p) => (isMerge(p) && mergeData(p).length === 30 ? '1,2,3' : mock(p)),
  });
  assert.equal(o.rejected.length, 1);
  assert.match(o.rejected[0].agent, /^root L2\.0$/);
  assert.match(o.rejected[0].reason, /3 integers, expected 30/);
  assert.equal(fs.readFileSync(file, 'utf8'), '');
});

test('hierarchical: call failures are errors, not rejections; surviving subtrees still merge', async () => {
  const mock = mockTransport('clean');
  const o = await runAgents({
    topology: 'hierarchical', agents: 30, fanout: 10, file: out(), numbers: range(30),
    call: async (p) => { if (p === 'Output the number 7. Nothing else.') throw new Error('503 overloaded'); return mock(p); },
  });
  assert.equal(o.errored.length, 1);
  assert.equal(o.errored[0].agent, 7);
  assert.equal(o.rejected.length, 0);
  assert.equal(o.usage.calls, 33); // failed call not counted; the group merger just gets 9 values
  assert.ok(o.oracle.failures.some((f) => /missing 1: \[7\]/.test(f)));
});

test('hierarchical: a merger that reorders wrongly is the oracle\'s finding (model), not a rejection; code does not re-sort', async () => {
  const mock = mockTransport('clean');
  const o = await runAgents({
    topology: 'hierarchical', agents: 10, fanout: 10, file: out(),
    call: async (p) => (isMerge(p) ? mergeData(p).sort((a, b) => b - a).join(',') : mock(p)),
  });
  assert.equal(o.rejected.length, 0);
  assert.equal(o.ok, false);
  assert.ok(o.oracle.failures.some((f) => /out of order/.test(f)));
});

// solo: the failure modes -----------------------------------------------------------------------

const solo = (reply, agents = 20) =>
  runAgents({ topology: 'solo', agents, file: out(), call: async () => reply });
const kinds = (o) => o.faults.map((f) => f.kind);

test('solo: clean reply passes with one call and no faults', async () => {
  const o = await solo(range(20).join(','));
  assert.equal(o.ok, true);
  assert.equal(o.usage.calls, 1);
  assert.deepEqual(o.faults, []);
});

test('solo: a dropped number is "dropped" (inside the sequence), written, and found by the oracle', async () => {
  const o = await solo(range(20).filter((n) => n !== 9).join(','));
  assert.equal(o.ok, false);
  assert.deepEqual(kinds(o), ['dropped']);
  assert.match(o.faults[0].detail, /\[9\]/);
  assert.equal(o.rejected.length, 0);
  assert.ok(o.oracle.failures.some((f) => /missing 1: \[9\]/.test(f)));
});

test('solo: a duplicated number is "duplicated" and not a drop', async () => {
  const o = await solo([...range(20).slice(0, 10), 10, ...range(20).slice(10)].join(','));
  assert.deepEqual(kinds(o), ['duplicated']);
  assert.ok(o.oracle.failures.some((f) => /duplicated: \[10\]/.test(f)));
  assert.equal(o.rejected.length, 0);
});

test('solo: stopping early on a normal end_turn is "stopped-early", not "truncated"', async () => {
  const o = await solo({ text: range(12).join(','), stopReason: 'end_turn', outputTokens: 30 });
  assert.deepEqual(kinds(o), ['stopped-early']);
  assert.match(o.faults[0].detail, /after 12 numbers.*8 never emitted/);
  assert.ok(o.oracle.failures.some((f) => /missing 8/.test(f)));
});

test('solo: hitting max_tokens is "truncated", the harness cap is named, and the possibly-cut last number is not written', async () => {
  const file = out();
  const o = await runAgents({
    topology: 'solo', agents: 20, file,
    call: async () => ({ text: '1,2,3,4,5,6,7,8,9,1', stopReason: 'max_tokens' }), // "1" is the start of 10, cut mid-number
  });
  assert.deepEqual(kinds(o), ['truncated']);
  assert.match(o.faults[0].detail, /max_tokens.*ceiling ended the reply, not the model/);
  assert.equal(fs.readFileSync(file, 'utf8'), '1,2,3,4,5,6,7,8,9');
  assert.ok(!o.oracle.failures.some((f) => /duplicated|unexpected/.test(f)));
});

test('solo: max_tokens is requested proportional to N', async () => {
  let cap;
  await runAgents({ topology: 'solo', agents: 500, file: out(), call: async (p, m) => { cap = m; return range(500).join(','); } });
  assert.equal(cap, 3000);
});

test('solo: out-of-order and invented values are named', async () => {
  assert.ok(kinds(await solo('2,1,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20')).includes('out-of-order'));
  const o = await solo(range(19).join(',') + ',99');
  assert.deepEqual(kinds(o).sort(), ['invented', 'stopped-early']); // 20 never emitted; 99 is not a stand-in for it
});

test('solo: a reply with no integers is a rejection (harness), not a fault; a thrown call is an error', async () => {
  const r = await solo("I'm sorry, I can't do that.");
  assert.equal(r.rejected.length, 1);
  assert.equal(r.rejected[0].agent, 'solo');
  assert.deepEqual(r.faults, []);
  const e = await runAgents({ topology: 'solo', agents: 5, file: out(), call: async () => { throw new Error('timeout'); } });
  assert.equal(e.errored.length, 1);
  assert.equal(e.rejected.length, 0);
  assert.equal(e.usage.calls, 0);
});

test('solo: token usage is totalled from the single call and faults appear in the report', async () => {
  const o = await runAgents({
    topology: 'solo', agents: 10, file: out(),
    call: async () => ({ text: '1,2,4,5,6,7,8,9,10', inputTokens: 40, outputTokens: 25, stopReason: 'end_turn' }),
  });
  assert.deepEqual(o.usage, { input: 40, output: 25, calls: 1 });
  assert.match(report({ topology: 'solo', model: 'm', agents: 10, outcome: o }), /solo: dropped/);
});

test('diagnoseSolo: clean input yields no faults', () => {
  assert.deepEqual(diagnoseSolo(range(5), 5, 'end_turn'), []);
});

test('unknown topology and bad fanout throw from runAgents', async () => {
  await assert.rejects(runAgents({ topology: 'bogus', agents: 2, file: out(), call: async () => '' }), /Unknown topology/);
  await assert.rejects(runAgents({ topology: 'hierarchical', agents: 2, fanout: 1, file: out(), call: async () => '' }), /fanout/);
});
