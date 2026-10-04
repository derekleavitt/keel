/*
 * Fails when README.md stops matching the code.
 *
 * Almost everything here works the same way: run the real tool, parse what it prints, parse the
 * matching claim out of the README, compare. Nothing is compared against a number written in
 * this file. The final test says what this file cannot pin (prose judgements, timings, and the
 * reasons the README gives for a result).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { project, TOPOLOGY_NAMES, KIND_NAMES, SWEEP_WORKS } from '../src/cost-model.mjs';
import { MODELS, PRICING_CHECKED } from '../src/pricing.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const src = (...p) => path.join(root, 'src', ...p);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sortlab-readme-'));

function node(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** Section of the README under `## heading`, up to the next `## ` heading. */
function section(heading) {
  const start = readme.indexOf(`\n## ${heading}\n`);
  assert.notEqual(start, -1, `README has no "## ${heading}" section`);
  const rest = readme.slice(start + 1);
  const next = rest.indexOf('\n## ', 1);
  return next === -1 ? rest : rest.slice(0, next);
}

/** Rows of the first markdown table in `text`, as arrays of trimmed cells, header excluded. */
function tableRows(text) {
  const lines = text.split('\n');
  const first = lines.findIndex((l) => /^\|.*\|$/.test(l));
  assert.notEqual(first, -1, 'no table found');
  const rows = [];
  for (let i = first + 2; i < lines.length && /^\|.*\|$/.test(lines[i]); i += 1) {
    rows.push(lines[i].slice(1, -1).split('|').map((c) => c.replace(/\*/g, '').trim()));
  }
  return rows;
}

// Started at import so the slow ones overlap; the whole file stays well under 20s.
const costTable = node([src('cost-model.mjs'), '--agents', '100']);
const crossoverOut = node([src('cost-model.mjs'), '--agents', '100', '--crossover']);
const strategies = ['naive', 'lockfile', 'append', 'hierarchical'];
// The runner writes under <its own root>/runs. Run it from a copy of src/ in the scratch
// directory so these trials never share runs/ with the real test files that run alongside this
// one (test/hierarchical.test.mjs asserts runs/ holds no group files at that moment).
fs.cpSync(src(), path.join(scratch, 'src'), { recursive: true });
const runs = Object.fromEntries(
  strategies.map((s) => [s, node([path.join(scratch, 'src', 'run.mjs'), '--agents', '12', '--strategy', s, '--trials', '6'])]),
);
const hierarchicalMock = node([
  src('agents.mjs'), '--agents', '12', '--topology', 'hierarchical', '--fanout', '3',
  '--mock', 'clean', '--out', path.join(scratch, 'out.txt'),
]);
const badMock = node([src('agents.mjs'), '--agents', '2', '--mock', 'bogus']);

test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

/* ---- cost table: every cell, against both the CLI's text and project() ------------------ */

test('cost table: every row matches `cost-model.mjs --agents 100` cell for cell', async () => {
  const { code, stdout } = await costTable;
  assert.equal(code, 0);
  const printed = [];
  for (const line of stdout.split('\n')) {
    const m = line.match(/^(api|claude-code)\s+(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+\$(\d+\.\d+)\s+(\S+)$/);
    if (m) printed.push({ kind: m[1], topology: m[2], calls: m[3], input: m[4], output: m[5], cost: m[6], time: m[7] });
  }
  assert.equal(printed.length, KIND_NAMES.length * TOPOLOGY_NAMES.length, 'CLI printed an unexpected number of rows');

  const rows = tableRows(section('What it costs'));
  assert.equal(rows.length, printed.length, 'README table has a different number of rows than the CLI prints');
  for (const p of printed) {
    const row = rows.find((r) => r[0] === p.kind && r[1] === p.topology);
    assert.ok(row, `README table is missing ${p.kind} ${p.topology}`);
    const strip = (s) => s.replace(/[$,]/g, '');
    assert.deepEqual(
      [row[2], strip(row[3]), strip(row[4]), strip(row[5]), row[6]],
      [p.calls, p.input, p.output, p.cost, p.time],
      `${p.kind} ${p.topology}`,
    );
    // And against the library, so the CLI text and project() cannot drift apart unnoticed.
    const r = project({ agents: 100, model: 'haiku', kind: p.kind, topology: p.topology });
    assert.equal(Number(strip(row[2])), r.calls);
    assert.equal(Number(strip(row[3])), r.input);
    assert.equal(Number(strip(row[4])), r.output);
    assert.equal(strip(row[5]), r.cost.toFixed(4));
  }
});

test('cost prose: ratios, dollar figures, and the hierarchical-slower-than-solo claim', async () => {
  const { stdout } = await costTable;
  const cost = (kind, topology) => project({ agents: 100, kind, topology });
  const text = section('What it costs');
  const flat = text.replace(/\s+/g, ' ');

  // "shared-lock costs 66x what one agent costs, and takes 69x as long" is printed by the tool.
  const cli = stdout.match(/shared-lock costs (\d+)x what one agent costs, and takes (\d+)x as long/);
  assert.ok(cli, 'the tool no longer prints the solo ratio line');
  assert.ok(flat.includes(`is ${cli[1]}× the cost and ${cli[2]}× the time`), 'README must quote the solo ratios the tool prints');

  const vsPartitioned = flat.match(/([\d.]+)× the cost \*and\* (\d+)× the time of `partitioned`/);
  assert.ok(vsPartitioned, 'README must state shared-lock against partitioned');
  const s = cost('api', 'shared-lock');
  const p = cost('api', 'partitioned');
  assert.equal(vsPartitioned[1], (s.cost / p.cost).toFixed(1));
  assert.equal(vsPartitioned[2], String(Math.round(s.seconds / p.seconds)));

  const fmt = (x) => (x < 100 ? `${x.toFixed(1)}s` : `${Math.round(x)}s`);
  assert.ok(flat.includes(`$${p.cost.toFixed(4)} as API calls and $${cost('claude-code', 'partitioned').cost.toFixed(4)} as Claude Code`));
  assert.ok(flat.includes(`costs $${cost('api', 'solo').cost.toFixed(4)}.`));
  assert.ok(flat.includes(`takes ${fmt(cost('api', 'solo').seconds)}, not 1.5s`));

  // The rewritten hierarchical claim: slower than solo at zero work, in both kinds, and dearer
  // than partitioned. If a model change flips any of these the prose is wrong.
  for (const kind of KIND_NAMES) {
    assert.ok(cost(kind, 'hierarchical').seconds > cost(kind, 'solo').seconds, `${kind}: hierarchical must be slower than solo`);
    assert.ok(cost(kind, 'hierarchical').cost > cost(kind, 'partitioned').cost, `${kind}: hierarchical must cost more than partitioned`);
  }
  assert.ok(flat.includes(`${fmt(cost('api', 'hierarchical').seconds)} against ${fmt(cost('api', 'solo').seconds)} as API`));
  assert.ok(flat.includes(`${fmt(cost('claude-code', 'hierarchical').seconds)} against ${fmt(cost('claude-code', 'solo').seconds)} as Claude Code`));
});

/* ---- crossover ------------------------------------------------------------------------- */

test('crossover table matches `--crossover`, including "never" and the cost-check point count', async () => {
  const { code, stdout } = await crossoverOut;
  assert.equal(code, 0);
  const found = {}; // kind -> topology -> "work >= n" | "never"
  let kind;
  for (const line of stdout.split('\n')) {
    const k = line.match(/^kind: (\S+)/);
    if (k) kind = k[1];
    const m = line.match(/^\s+(\S+) beats solo on time(?: at work >= (\d+)|: never within sweep)/);
    if (m) (found[kind] ??= {})[m[1]] = m[2] === undefined ? 'never' : `work >= ${m[2]}`;
  }
  const rows = tableRows(section('Where distribution wins on time'));
  assert.equal(rows.length, TOPOLOGY_NAMES.length - 1);
  assert.equal(Object.keys(found.api).length, rows.length);
  for (const [topology, api, cc] of rows) {
    assert.equal(api, found.api[topology], `api ${topology}`);
    assert.equal(cc, found['claude-code'][topology], `claude-code ${topology}`);
  }

  const check = stdout.match(/every topology cost >= solo at all (\d+) sweep points/);
  assert.ok(check, 'the tool no longer reports an unviolated cost check');
  assert.equal(Number(check[1]), SWEEP_WORKS.length);
  assert.ok(readme.replace(/\s+/g, ' ').includes(`at all ${check[1]} sweep points`));
  assert.ok(readme.replace(/\s+/g, " ").includes(`at ${check[1]} work sizes`));
  // The asymmetry the README insists on is still printed by the tool itself.
  assert.match(stdout, /merge is ordinary code, not an agent: not timed or priced/);
});

/* ---- process results table: reruns the experiment ------------------------------------- */

test('results table: pass counts match a fresh run of each documented command', async () => {
  const rows = tableRows(section('The coordination problem, measured'));
  assert.deepEqual(rows.map((r) => r[0]), strategies);
  for (const [strategy, passedCell, median] of rows) {
    const { stdout } = await runs[strategy];
    const m = stdout.match(/passed:\s+(\d+)\/(\d+)\s+median: (\d+)ms/);
    assert.ok(m, `no summary from ${strategy}:\n${stdout}`);
    assert.equal(passedCell, `${m[1]}/${m[2]}`, `${strategy} pass count`);
    assert.equal(m[2], '6', 'the README documents --trials 6');
    assert.match(median, /^\d+ms$/); // the value itself is timing; shape only
  }
  assert.ok(readme.includes('node src/run.mjs --agents 12 --strategy naive --trials 6'));
});

/* ---- hierarchical level counts --------------------------------------------------------- */

test('hierarchical level block is verbatim what agents.mjs prints (fanout 3, 12 agents, mock)', async () => {
  const { code, stdout } = await hierarchicalMock;
  assert.equal(code, 0, stdout);
  const block = readme.match(/--mock clean\n((?:  L\d .*\n)+)```/);
  assert.ok(block, 'README level block not found');
  const printed = stdout.split('\n').filter((l) => /^  L\d /.test(l));
  assert.deepEqual(block[1].trimEnd().split('\n'), printed);

  // The structural claims in the prose, derived from the printed numbers.
  const levels = printed.map((l) => {
    const m = l.match(/^  L(\d) (\w+)\s+x(\d+)\s+max children (\d+)\s+max in (\d+)\s+max out (\d+)/);
    return { role: m[2], children: Number(m[4]), in: Number(m[5]), out: Number(m[6]) };
  });
  const root = levels.at(-1);
  assert.equal(root.role, 'root');
  assert.equal(root.in, 12, 'root sees all N values');
  assert.equal(root.out, 12, 'root emits all N values');
  assert.ok(Math.max(...levels.map((l) => l.children)) <= 3, 'children never exceed fanout');
  const midMax = Math.max(...levels.filter((l) => l.role === 'merger').map((l) => l.in));
  assert.equal(midMax, 9, 'a mid-level merger sees fanout squared values');
  assert.ok(readme.replace(/\s+/g, ' ').includes('below the root sees nine values, not three'));
  assert.match(stdout, /tokens\s+0 in \/ 0 out/);
  assert.match(stdout, /cost\s+\$0\.0000/);
});

/* ---- flags and env vars: both directions ---------------------------------------------- */

test('every flag and SORTLAB_ variable read by the source is documented, and every documented one exists', () => {
  const files = ['run.mjs', 'worker.mjs', 'agents.mjs', 'cost-model.mjs'];
  const flags = new Set();
  for (const f of files) {
    const text = fs.readFileSync(src(f), 'utf8');
    for (const m of text.matchAll(/\b(?:arg|num|numberArg)\(\s*'([a-z][a-z-]*)'/g)) flags.add(m[1]);
    for (const m of text.matchAll(/argv\.includes\(\s*'--([a-z][a-z-]*)'/g)) flags.add(m[1]);
  }
  const expected = ['agents', 'strategy', 'trials', 'delay', 'slow', 'slow-ms', 'faulty', 'fault', 'crash-at', 'timeout', 'keep', 'work', 'crossover', 'verbose', 'fanout', 'mock', 'out', 'model', 'topology', 'concurrency'];
  for (const flag of expected) assert.ok(flags.has(flag), `flag extraction missed --${flag}; the regexes need updating`);

  // worker.mjs's own --file/--value/--hang are internal: run.mjs spawns it, nobody types them.
  const internal = new Set(['file', 'value', 'hang']);
  for (const flag of flags) {
    if (internal.has(flag)) continue;
    assert.ok(new RegExp(`--${flag}(?![a-z-])`).test(readme), `--${flag} is read by the source but not mentioned in README.md`);
  }

  const env = new Set();
  for (const f of fs.readdirSync(src(), { recursive: true })) {
    if (f.endsWith('.mjs')) for (const m of fs.readFileSync(src(f), 'utf8').matchAll(/\bSORTLAB_[A-Z_]+/g)) env.add(m[0]);
  }
  for (const v of ['SORTLAB_STALE_MS', 'SORTLAB_RETRY_MS', 'SORTLAB_FANOUT']) assert.ok(env.has(v), `extraction missed ${v}`);
  for (const v of env) assert.ok(readme.includes(v), `${v} is read by the source but not mentioned in README.md`);

  // The other direction: a flag in the README's flag table must still be read somewhere.
  const documented = [...readme.matchAll(/^\| `--([a-z-]+)/gm)].map((m) => m[1]);
  assert.ok(documented.length >= 8);
  for (const flag of documented) assert.ok(flags.has(flag), `README documents --${flag} but no source reads it`);
});

test('run.mjs flag table: documented defaults are the defaults in the source', () => {
  const text = fs.readFileSync(src('run.mjs'), 'utf8');
  const sourceDefault = (flag) => text.match(new RegExp(`num\\('${flag}', ([\\d_]+)`))?.[1].replace(/_/g, "");
  // Anchored: the flag name must end at a space or the closing backtick, so --fault cannot
  // match the --faulty row, nor --slow the --slow-ms row.
  const rowFor = (flag) => readme.match(new RegExp(`^\\| \`--${flag}(?: [^\`]*)?\`[^|]*\\| [^|]* \\| ([^|]+) \\|$`, 'm'))?.[1].trim();
  for (const flag of ['delay', 'slow', 'slow-ms', 'faulty', 'crash-at', 'timeout']) {
    assert.ok(sourceDefault(flag), `could not find the default of --${flag} in run.mjs`);
    assert.equal(rowFor(flag), sourceDefault(flag), `--${flag} default`);
  }
  assert.equal(rowFor('fault'), text.match(/arg\('fault', '(\w+)'/)[1]);
});

test('--mock modes and the agent harness defaults named in the README are the real ones', async () => {
  const { stderr, code } = await badMock;
  assert.equal(code, 2);
  const modes = stderr.match(/\(([a-z|]+)\)/)[1];
  assert.ok(readme.includes(`\`${modes}\``), `README must list the mock modes: ${modes}`);
  const text = fs.readFileSync(src('agents.mjs'), 'utf8');
  const flat = readme.replace(/\s+/g, ' ');
  for (const [flag, value, phrase] of [
    ['agents', 10, '`--agents N` (default 10)'],
    ['concurrency', 20, 'calls in flight at once, default 20'],
    ['fanout', 10, 'integer >= 2, default 10'],
  ]) {
    assert.ok(text.includes(`arg('${flag}', ${value})`), `agents.mjs default for --${flag} changed`);
    assert.ok(flat.includes(phrase), `README no longer states the default for --${flag}`);
  }
});

/* ---- pricing --------------------------------------------------------------------------- */

test('pricing: README quotes the checked date, says the URL is unverified, and does not repeat the URL', () => {
  assert.ok(readme.includes(`(${PRICING_CHECKED})`), `README must state the PRICING_CHECKED date ${PRICING_CHECKED}`);
  assert.ok(MODELS.haiku.id.includes('haiku-4-5') && readme.includes('Haiku 4.5'));
  assert.match(readme.replace(/\s+/g, ' '), /written from memory and has never been verified/);
  const url = fs.readFileSync(src('pricing.mjs'), 'utf8').match(/PRICING_SOURCE = '([^']+)'/)[1];
  assert.ok(!readme.includes(url), 'README must not repeat the unverified source URL as if it were fact');
});

/* ---- layout ---------------------------------------------------------------------------- */

test('layout block lists every source file, and every listed path exists', () => {
  const block = readme.match(/## Layout\n\n```\n([\s\S]*?)```/)[1];
  const listed = block.split('\n').filter(Boolean).map((l) => l.split(/\s+/)[0]);
  for (const p of listed) assert.ok(fs.existsSync(path.join(root, p)), `Layout lists ${p}, which does not exist`);
  const actual = [
    ...fs.readdirSync(src()).filter((f) => f.endsWith('.mjs')).map((f) => `src/${f}`),
    ...fs.readdirSync(src('strategies')).map((f) => `src/strategies/${f}`),
  ];
  for (const f of actual) assert.ok(listed.includes(f), `${f} exists but is missing from the Layout block`);
  assert.ok(listed.includes('test/'));
  assert.ok(listed.includes('_archive/version_1'));
});

test('tests the README cites as pinning a claim exist and still contain that claim', () => {
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  for (const f of ['test/lockfile.test.mjs', 'test/run-isolation.test.mjs']) assert.ok(readme.includes(f), `README no longer cites ${f}`);
  assert.match(read('test/lockfile.test.mjs'), /30 concurrent in-process contributors/);
  assert.match(read('test/lockfile.test.mjs'), /twenty agents, 10\/10/);
  assert.match(read('test/run-isolation.test.mjs'), /runs\/ is gitignored/);
});

/* ---- what this file cannot pin --------------------------------------------------------- */

test('open section: mock exists, real measurement needs credentials, answered items are gone', () => {
  const open = section('Open');
  assert.match(open, /\*\*Measure it\.\*\*/);
  assert.match(open, /--mock/);
  assert.match(open, /API key/);
  assert.doesNotMatch(open, /Non-uniform agents\.\*\*|Failure injection\.\*\*|Where's the crossover/, 'answered items must not be listed as open');
  // Beyond this, nothing can verify that no agent figure is presented as measured: the cost
  // table is labelled a projection and the real-agents section says no call was ever made.
  assert.ok(section('What it costs').includes('**These are projections, not measurements**'));
  assert.ok(section('Running real agents').includes('It has never made a real API call'));
});
