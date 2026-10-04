import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractIntegers, parseSingle, parseList, shuffled, runAgents, mockTransport, report } from '../src/agents.mjs';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'agents.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-test-'));
let counter = 0;
const out = () => path.join(tmp, `out-${counter++}.txt`);

/** A scripted model: `reply(prompt)` returns whatever the test wants the "agent" to say. */
const scripted = (reply) => async (prompt) => reply(prompt);
const wanted = (prompt) => Number(prompt.match(/-?\d+/)[0]);

test('parsing: newline-separated list is three numbers, not 123', () => {
  assert.deepEqual(extractIntegers('1\n2\n3'), [1, 2, 3]);
  assert.deepEqual(parseList('1\n2\n3', 3), { ok: true, values: [1, 2, 3] });
});

test('parsing: empty, null and non-numeric are rejected, never zero', () => {
  for (const bad of ['', '   ', null, undefined, "I can't help with that.", 'seven']) {
    const r = parseSingle(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.ok(r.reason);
  }
});

test('parsing: prose-wrapped single number is accepted; ambiguous prose is not', () => {
  assert.deepEqual(parseSingle('The number is 7.'), { ok: true, value: 7 });
  assert.equal(parseSingle('Between 6 and 8, I pick 7').ok, false);
});

test('parsing: wrong count of list entries is rejected', () => {
  assert.equal(parseList('1,2', 3).ok, false);
  assert.equal(parseList('', 1).ok, false);
});

test('shuffled is a permutation and honours the injected rng', () => {
  const s = shuffled(50);
  assert.deepEqual([...s].sort((a, b) => a - b), Array.from({ length: 50 }, (_, i) => i + 1));
  assert.deepEqual(shuffled(4, () => 0), [2, 3, 4, 1]);
});

for (const topology of ['partitioned', 'shared-lock']) {
  for (const mode of ['clean', 'prose', 'newline']) {
    test(`${topology}: mock ${mode} passes`, async () => {
      const outcome = await runAgents({ topology, agents: 8, call: mockTransport(mode), file: out() });
      assert.equal(outcome.ok, true, JSON.stringify(outcome.oracle.failures));
      assert.deepEqual(outcome.rejected, []);
    });
  }
}

test('partitioned: empty replies are rejected per agent and never become 0', async () => {
  const file = out();
  const outcome = await runAgents({ topology: 'partitioned', agents: 5, call: scripted(() => ''), file });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.rejected.length, 5);
  assert.deepEqual(outcome.rejected.map((r) => r.agent).sort(), [1, 2, 3, 4, 5]);
  assert.equal(fs.readFileSync(file, 'utf8'), '');
  const text = report({ topology: 'partitioned', model: 'm', agents: 5, outcome });
  assert.match(text, /missing/);
  assert.match(text, /harness rejected it/);
  assert.doesNotMatch(text, /unexpected/);
});

test('partitioned: one refusal among good replies is attributed to that agent only', async () => {
  const outcome = await runAgents({
    topology: 'partitioned',
    agents: 6,
    file: out(),
    call: scripted((p) =>
      wanted(p) === 4 ? "I'm sorry, I can't help with that." : String(wanted(p))),
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.rejected.length, 1);
  assert.equal(outcome.rejected[0].agent, 4);
  assert.match(outcome.rejected[0].reply, /sorry/);
  assert.match(outcome.rejected[0].reason, /no integer/);
  assert.deepEqual(outcome.oracle.failures.filter((f) => /unexpected|duplicated/.test(f)), []);
});

test('partitioned: a wrong but parseable number is the oracle\'s finding (model failure), not a rejection', async () => {
  const outcome = await runAgents({
    topology: 'partitioned', agents: 3, file: out(),
    call: scripted((p) => (wanted(p) === 2 ? '9' : String(wanted(p)))),
  });
  assert.equal(outcome.rejected.length, 0);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.oracle.failures.some((f) => /unexpected/.test(f)));
});

test('shared-lock: refusal leaves the file intact and is attributed', async () => {
  const mock = mockTransport('clean');
  const file = out();
  const outcome = await runAgents({
    topology: 'shared-lock', agents: 5, file, numbers: [1, 2, 3, 4, 5],
    call: scripted((p) => (p.includes('Insert 3 ') ? 'I cannot do that.' : mock(p))),
  });
  assert.equal(outcome.rejected.length, 1);
  assert.equal(outcome.rejected[0].agent, 3);
  assert.equal(fs.readFileSync(file, 'utf8'), '1,2,4,5');
  assert.equal(outcome.ok, false);
  assert.ok(outcome.oracle.failures.some((f) => /missing 1: \[3\]/.test(f)));
  assert.ok(!outcome.oracle.failures.some((f) => /malformed|unexpected/.test(f)));
});

test('shared-lock: a reply that drops a number is rejected, not written', async () => {
  const file = out();
  const outcome = await runAgents({
    topology: 'shared-lock', agents: 3, file, numbers: [1, 2, 3],
    call: scripted((p) => (p.includes('Insert 2 ') ? '1' : p.includes('Insert 3 ') ? '3' : '1')),
  });
  assert.equal(fs.readFileSync(file, 'utf8'), '1');
  assert.equal(outcome.rejected.length, 2);
});

test('call failures are recorded as errors, not as rejections or model failures', async () => {
  const outcome = await runAgents({
    topology: 'partitioned', agents: 2, file: out(),
    call: async () => { throw new Error('503 overloaded'); },
  });
  assert.equal(outcome.errored.length, 2);
  assert.equal(outcome.rejected.length, 0);
  assert.equal(outcome.ok, false);
});

test('token usage from object replies is totalled; string replies count as zero', async () => {
  const outcome = await runAgents({
    topology: 'partitioned', agents: 3, file: out(),
    call: async (p) => ({ text: String(wanted(p)), inputTokens: 10, outputTokens: 2 }),
  });
  assert.deepEqual(outcome.usage, { input: 30, output: 6, calls: 3 });
});

// CLI -------------------------------------------------------------------------------------

function cli(...args) {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return spawnSync(process.execPath, [script, ...args, '--out', out()], { encoding: 'utf8', env });
}

test('cli: --mock clean partitioned exits 0 with no credentials and prints cost', () => {
  const r = cli('--mock', 'clean', '--agents', '20', '--topology', 'partitioned');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /cost\s+\$0\.0000/);
  assert.match(r.stdout, /0 in \/ 0 out/);
});

test('cli: --mock newline shared-lock exits 0 (regression: "1\\n2\\n3" -> 123)', () => {
  const r = cli('--mock', 'newline', '--agents', '10', '--topology', 'shared-lock');
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('cli: --mock prose exits 0 for both topologies', () => {
  for (const topology of ['partitioned', 'shared-lock']) {
    assert.equal(cli('--mock', 'prose', '--agents', '6', '--topology', topology).status, 0, topology);
  }
});

test('cli: --mock empty partitioned exits 1, says missing, never unexpected: [0]', () => {
  const r = cli('--mock', 'empty', '--agents', '5', '--topology', 'partitioned');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /missing/);
  assert.match(r.stdout, /agent \d returned "" — harness rejected it/);
  assert.doesNotMatch(r.stdout, /unexpected: \[0\]/);
});

test('cli: without --mock and without credentials exits 2 with a credential message', () => {
  const r = cli('--agents', '5');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /No credentials/);
  assert.doesNotMatch(r.stderr, /ERR_MODULE_NOT_FOUND/);
});

test('cli: unknown mock mode exits 2', () => {
  assert.equal(cli('--mock', 'bogus').status, 2);
});

// Per-call records (T-015) ----------------------------------------------------------------

const CALL_KEYS = ['agent', 'role', 'level', 'startedMs', 'ms', 'inputTokens', 'outputTokens', 'stopReason', 'outcome', 'valuesIn', 'valuesOut'];

/** A clock that advances by `step` ms on every read, so every duration and offset is exact. */
const steppedClock = (step) => { let t = 1000; return () => { const v = t; t += step; return v; }; };

test('records: scripted clock gives exact startedMs and ms (serial shared-lock)', async () => {
  const outcome = await runAgents({
    topology: 'shared-lock', agents: 3, numbers: [2, 1, 3], file: out(),
    call: mockTransport('clean'), now: steppedClock(10),
  });
  // reads: run start, then (before, after) per call => each call lasts 10ms, starts 20ms apart.
  assert.deepEqual(outcome.calls.map((c) => [c.startedMs, c.ms]), [[10, 10], [30, 10], [50, 10]]);
  assert.deepEqual(outcome.calls.map((c) => c.agent), ['2', '1', '3']);
  assert.ok(outcome.calls.every((c) => c.role === 'shared' && c.level === 0 && c.outcome === 'accepted'));
});

test('records: tokens and stop reason land in the record; throwing call is errored', async () => {
  let n = 0;
  const outcome = await runAgents({
    topology: 'partitioned', agents: 3, numbers: [1, 2, 3], file: out(),
    call: async (p) => {
      n += 1;
      if (n === 2) throw new Error('boom');
      return { text: String(wanted(p)), inputTokens: 11, outputTokens: 4, stopReason: 'end_turn' };
    },
  });
  assert.equal(outcome.calls.length, outcome.usage.calls + outcome.errored.length);
  const [a, b, c] = outcome.calls;
  assert.deepEqual(Object.keys(a), CALL_KEYS);
  assert.equal(a.inputTokens, 11);
  assert.equal(a.outputTokens, 4);
  assert.equal(a.stopReason, 'end_turn');
  assert.equal(b.outcome, 'errored');
  assert.equal(b.inputTokens, 0);
  assert.equal(b.stopReason, null);
  assert.equal(b.valuesOut, 0);
  assert.equal(c.outcome, 'accepted');
});

test('records: rejected replies are marked rejected; string replies carry zero tokens and null stop', async () => {
  const outcome = await runAgents({
    topology: 'partitioned', agents: 2, numbers: [1, 2], file: out(),
    call: async (p) => (wanted(p) === 1 ? '' : '2'),
  });
  assert.deepEqual(outcome.calls.map((c) => c.outcome), ['rejected', 'accepted']);
  assert.ok(outcome.calls.every((c) => c.inputTokens === 0 && c.outputTokens === 0 && c.stopReason === null));
});

test('records: solo with no integers is rejected; hierarchical roles and levels are recorded', async () => {
  const solo = await runAgents({ topology: 'solo', agents: 4, call: async () => 'none', file: out() });
  assert.equal(solo.calls.length, 1);
  assert.equal(solo.calls[0].role, 'solo');
  assert.equal(solo.calls[0].outcome, 'rejected');

  const h = await runAgents({ topology: 'hierarchical', agents: 9, fanout: 3, call: mockTransport('clean'), file: out() });
  const tally = {};
  for (const c of h.calls) tally[`${c.role}${c.level}`] = (tally[`${c.role}${c.level}`] ?? 0) + 1;
  assert.deepEqual(tally, { leaf0: 9, merger1: 3, root2: 1 });
});

test('cli: --record writes 19 call lines + summary for 12 agents / fanout 3, and nothing without it', () => {
  const rec = path.join(tmp, 'rec', 'run.jsonl');
  const outFile = out();
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  const r = spawnSync(process.execPath, [script, '--agents', '12', '--topology', 'hierarchical', '--fanout', '3', '--mock', 'clean', '--record', rec, '--out', outFile], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /time .*\nlatency  median \d+ms  p95 \d+ms  per call\nresult/);
  const lines = fs.readFileSync(rec, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 20);
  const calls = lines.slice(0, 19);
  for (const c of calls) assert.deepEqual(Object.keys(c), CALL_KEYS);
  assert.equal(calls.filter((c) => c.role === 'leaf' && c.level === 0).length, 12);
  assert.equal(calls.filter((c) => c.role === 'merger' && c.level === 1).length, 4);
  assert.equal(calls.filter((c) => c.role === 'merger' && c.level === 2).length, 2);
  assert.equal(calls.filter((c) => c.role === 'root' && c.level === 3).length, 1);
  const s = lines[19];
  assert.deepEqual(Object.keys(s), ['summary', 'topology', 'model', 'agents', 'fanout', 'concurrency', 'calls', 'inputTokens', 'outputTokens', 'costUsd', 'elapsedMs', 'ok']);
  assert.equal(s.summary, true);
  assert.equal(s.model, 'mock:clean');
  assert.equal(s.fanout, 3);
  assert.equal(s.calls, 19);
  assert.equal(s.costUsd, 0);
  assert.equal(s.ok, true);

  // Without --record: only the --out file appears in its directory.
  const dir = fs.mkdtempSync(path.join(tmp, 'norec-'));
  const f = path.join(dir, 'only.txt');
  const r2 = spawnSync(process.execPath, [script, '--agents', '5', '--mock', 'clean', '--out', f], { encoding: 'utf8', env });
  assert.equal(r2.status, 0);
  assert.deepEqual(fs.readdirSync(dir), ['only.txt']);
});

test('cli: --record with no path exits 2', () => {
  const r = cli('--mock', 'clean', '--record');
  assert.equal(r.status, 2);
});
