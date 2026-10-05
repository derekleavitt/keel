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
import { MODELS, PRICING_CHECKED, warnIfPricingStale } from '../src/pricing.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const src = (...p) => path.join(root, 'src', ...p);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sortlab-readme-'));

function node(args, env = {}) {
  return new Promise((resolve) => {
    // An env value of undefined removes the variable from the child's environment.
    const childEnv = { ...process.env, ...env };
    for (const k of Object.keys(childEnv)) if (childEnv[k] === undefined) delete childEnv[k];
    const child = spawn(process.execPath, args, { cwd: root, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
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
// directory so these trials never write into the real runs/, which is shared with
// test/run-isolation.test.mjs and its own concurrent runs.
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
  const expected = ['agents', 'strategy', 'trials', 'delay', 'slow', 'slow-ms', 'faulty', 'fault', 'crash-at', 'timeout', 'keep', 'work', 'crossover', 'verbose', 'fanout', 'mock', 'out', 'model', 'topology', 'concurrency', 'record', 'dry-run', 'max-spend'];
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
  assert.match(open, /^- Measure it\./m);
  assert.match(open, /--mock/);
  assert.match(open, /API key/);
  assert.doesNotMatch(open, /Non-uniform agents\.\*\*|Failure injection\.\*\*|Where's the crossover/, 'answered items must not be listed as open');
  // Beyond this, nothing can verify that no agent figure is presented as measured: the cost
  // table is labelled a projection and the real-agents section says no call was ever made.
  assert.ok(section('What it costs').includes('**These are projections, not measurements**'));
  assert.ok(section('Running real agents').includes('It has never made a real API call'));
});

/* ---- mission and architecture: stated as intent, separated from what is measured ------- */

const MEASURED_SECTIONS = ['What it costs', 'Where distribution wins on time', 'The coordination problem, measured', 'Running real agents', 'What this cannot measure'];

test('the mission and architecture sections come first and say they are not built', () => {
  const at = (h) => readme.indexOf(`\n## ${h}\n`);
  for (const h of ['The mission', 'What a system like that needs', 'Why the first instrument sorts a list', 'What is built and what is not']) {
    assert.notEqual(at(h), -1, `README has no "## ${h}" section`);
    assert.ok(at(h) < at('What it costs'), `"## ${h}" must come before the measured sections`);
  }
  assert.ok(section('The mission').includes('This repository does not do that.'));
  assert.ok(section('What a system like that needs').startsWith('## What a system like that needs\n\nNone of this is built.'));
  // The architecture cites this file's size as a prototype; that number is counted, not written.
  const checks = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').match(/^test\(/gm).length;
  assert.ok(section('What a system like that needs').includes(`a ${checks}-check prototype`), `README must say this file is a ${checks}-check prototype`);
  // The status table is the boundary, and the limits section says so.
  assert.ok(section('What this cannot measure').includes('Nothing above the `What is built and what is not` table is measured by anything'));
  // No dollar figure or token count appears in the sections that are intent: those belong below the table.
  for (const h of ['The mission', 'What a system like that needs', 'Why the first instrument sorts a list']) {
    assert.doesNotMatch(section(h), /\$\d/, `"## ${h}" must not quote a dollar figure`);
    assert.doesNotMatch(section(h), /^\|/m, `"## ${h}" must not contain a table`);
  }
});

test('status table: every state is one of four, every cited path exists, and "not built" cites nothing', () => {
  const rows = tableRows(section('What is built and what is not'));
  assert.ok(rows.length >= 10);
  const states = new Set(['measured', 'projected', 'tested offline', 'not built']);
  const seen = new Set();
  for (const [component, state, where] of rows) {
    assert.ok(states.has(state), `${component}: unknown state "${state}"`);
    seen.add(state);
    const paths = [...where.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    if (state === 'not built') {
      assert.equal(where, '—', `${component}: a "not built" row must cite no path`);
    } else {
      assert.ok(paths.length > 0, `${component}: a built row must cite where it lives`);
      for (const p of paths) assert.ok(fs.existsSync(path.join(root, p)), `${component} cites ${p}, which does not exist`);
    }
  }
  assert.deepEqual([...seen].sort(), [...states].sort(), 'the table must use all four states so the legend below it is true');
  // The flag-table test treats any row beginning with a backticked flag as a flag row; this table has none.
  for (const [component] of rows) assert.doesNotMatch(component, /^`--/);
});

test('the measured sections make no claim of scale: swarm words appear only where intent is stated', () => {
  for (const h of MEASURED_SECTIONS) {
    assert.doesNotMatch(section(h), /\b(thousands?|millions?|swarms?|infinite)\b/i, `"## ${h}" must not describe scale this code has not run at`);
    assert.doesNotMatch(section(h), /\bWindows\b/, `"## ${h}" must not name the codebase the mission is sized against`);
  }
  // The headline sentence about the largest run is computed from every command in the file.
  const sizes = [...readme.matchAll(/--agents (\d+)/g)].map((m) => Number(m[1]));
  assert.ok(sizes.length >= 5);
  const largest = Math.max(...sizes);
  assert.ok(readme.includes(`The largest \`--agents\` value in any command in this file is ${largest}.`), `README must state the largest --agents it uses: ${largest}`);
  // And that number is reached only by commands that are a projection, a mock, or the never-run real command.
  for (const line of readme.split('\n').filter((l) => l.includes(`--agents ${largest}`))) {
    assert.ok(/--dry-run|--mock|ANTHROPIC_API_KEY=\.\.\.|cost-model\.mjs/.test(line), `a command at --agents ${largest} that is neither projection, mock nor the credentialed example: ${line}`);
  }
});

/* ---- concurrency: the condition the headline result depends on ------------------------- */

const cost20 = node([src('cost-model.mjs'), '--agents', '100', '--concurrency', '20']);
const crossover20 = node([src('cost-model.mjs'), '--agents', '100', '--crossover', '--concurrency', '20']);

test('concurrency table: unlimited and concurrency-20 times match the tool, cell for cell', async () => {
  const unlimited = await costTable;
  const limited = await cost20;
  assert.equal(limited.code, 0);
  const times = (stdout) => {
    const out = {};
    for (const line of stdout.split('\n')) {
      const m = line.match(/^(api|claude-code)\s+(\S+)\s+\d+\s+\d+\s+\d+\s+\$\d+\.\d+\s+(\S+)$/);
      if (m) out[`${m[1]} ${m[2]}`] = m[3];
    }
    return out;
  };
  const u = times(unlimited.stdout);
  const l = times(limited.stdout);
  assert.equal(Object.keys(l).length, KIND_NAMES.length * TOPOLOGY_NAMES.length);
  assert.ok(readme.includes('node src/cost-model.mjs --agents 100 --concurrency 20'));
  // The concurrency table is the second one in the section: the first is the cost table.
  const text = section('What it costs');
  const tables = text.split('\n\n').filter((b) => /^\| kind \| topology \| unlimited/.test(b));
  assert.equal(tables.length, 1, 'README has no concurrency table');
  const rows = tableRows(tables[0]);
  assert.equal(rows.length, Object.keys(l).length);
  for (const [kind, topology, unl, lim] of rows) {
    assert.equal(unl, u[`${kind} ${topology}`], `${kind} ${topology} unlimited`);
    assert.equal(lim, l[`${kind} ${topology}`], `${kind} ${topology} at concurrency 20`);
  }
  // Library check, and the claims in the prose that rest on these numbers.
  const secs = (topology, concurrency) => project({ agents: 100, kind: 'api', topology, concurrency }).seconds;
  const fmt = (x) => (x < 100 ? `${x.toFixed(1)}s` : `${Math.round(x)}s`);
  assert.equal(l['api partitioned'], fmt(secs('partitioned', 20)));
  assert.ok(secs('partitioned', 20) > secs('solo', 20), 'partitioned must lose to solo at the harness default');
  const flat = text.replace(/\s+/g, ' ');
  assert.ok(flat.includes(`so it is ${l['api partitioned']} as API calls against \`solo\`'s ${l['api solo']}`));
  // "at least 50 calls in flight": the smallest concurrency where partitioned beats solo.
  let breakeven;
  for (let c = 1; c <= 100; c += 1) {
    if (secs('partitioned', c) < secs('solo', c)) { breakeven = c; break; }
  }
  assert.ok(flat.includes(`faster only when at least ${breakeven} calls can be in flight`), `README must say the breakeven is ${breakeven}`);
  assert.ok(flat.includes('`src/agents.mjs` keeps at most 20 calls in flight by default'));
  assert.match(fs.readFileSync(src('agents.mjs'), 'utf8'), /arg\('concurrency', 20\)/);
  // The cost-model default really is unlimited, and the README says the first table assumes it.
  assert.equal(project({ agents: 100 }).seconds, project({ agents: 100, concurrency: Infinity }).seconds);
  assert.ok(flat.includes('The ~time column assumes unlimited concurrency'));
});

test('concurrency-20 crossover table equals `--crossover --concurrency 20`, and the prose thresholds are the tool\'s', async () => {
  const { code, stdout } = await crossover20;
  assert.equal(code, 0);
  const found = {};
  let kind;
  for (const line of stdout.split('\n')) {
    const k = line.match(/^kind: (\S+)/);
    if (k) kind = k[1];
    const m = line.match(/^\s+(\S+) beats solo on time(?: at work >= (\d+)|: never within sweep)/);
    if (m) (found[kind] ??= {})[m[1]] = m[2] === undefined ? 'never' : `work >= ${m[2]}`;
  }
  assert.ok(readme.includes('node src/cost-model.mjs --agents 100 --crossover --concurrency 20'));
  const text = section('Where distribution wins on time');
  const tables = text.split('\n\n').filter((b) => /^\| topology \| api \| claude-code \|/.test(b));
  assert.equal(tables.length, 2, 'expected the default and the concurrency-20 crossover tables');
  const rows = tableRows(tables[1]);
  assert.equal(rows.length, TOPOLOGY_NAMES.length - 1);
  for (const [topology, api, cc] of rows) {
    assert.equal(api, found.api[topology], `api ${topology} at concurrency 20`);
    assert.equal(cc, found['claude-code'][topology], `claude-code ${topology} at concurrency 20`);
  }
  // The two tables must actually differ for partitioned, or the correction is empty.
  const first = tableRows(tables[0]);
  assert.notEqual(first.find((r) => r[0] === 'partitioned')[1], rows.find((r) => r[0] === 'partitioned')[1]);
  // The prose names the api and claude-code partitioned thresholds.
  const flat = text.replace(/\s+/g, ' ');
  const n = (s) => s.match(/\d+/)[0];
  assert.ok(flat.includes(`needs at least ${n(found.api.partitioned)} tokens of real work per agent as API calls, and ${n(found['claude-code'].partitioned)} as Claude Code agents`));
  assert.ok(flat.includes('This table holds only at unlimited concurrency'));
  assert.match(stdout, /every topology cost >= solo at all \d+ sweep points/);
});

/* ---- the agent harness guardrails: flags, exit codes, record, compare ------------------ */

const dryRun = node([src('agents.mjs'), '--agents', '100', '--topology', 'partitioned', '--model', 'haiku', '--dry-run']);
const refused = node([src('agents.mjs'), '--agents', '100', '--topology', 'partitioned', '--max-spend', '0.01']);
const dryRunBadModel = node([src('agents.mjs'), '--agents', '5', '--model', 'no-such-model', '--dry-run']);
const badSpend = node([src('agents.mjs'), '--agents', '5', '--max-spend', 'lots']);
const mockRejected = node([src('agents.mjs'), '--agents', '3', '--mock', 'empty', '--out', path.join(scratch, 'rej.txt')]);
const recordFile = path.join(scratch, 'mock-record.jsonl');
const mockWithCeiling = node([
  src('agents.mjs'), '--agents', '4', '--mock', 'clean', '--max-spend', '0.01',
  '--out', path.join(scratch, 'ceil.txt'), '--record', recordFile,
]);
const compareMock = mockWithCeiling.then(() => node([src('compare.mjs'), recordFile]));
const comparePartitioned = node([src('compare.mjs'), path.join(root, 'test', 'fixtures', 'record-partitioned.jsonl')]);
const compareHierarchical = node([src('compare.mjs'), path.join(root, 'test', 'fixtures', 'record-hierarchical.jsonl')]);

test('--dry-run: the documented block is the tool\'s first two lines; the SDK line reports a real import attempt', async () => {
  const { code, stdout } = await dryRun;
  assert.equal(code, 0);
  const lines = stdout.trimEnd().split('\n');
  const block = readme.match(/```\n(dry run .*\nprojected .*)\n```/);
  assert.ok(block, 'README dry-run block not found');
  assert.deepEqual(block[1].split('\n'), lines.slice(0, 2));
  assert.match(lines[2], /^sdk +(installed|not installed \(run npm install\))/);
  assert.equal(lines.at(-1), 'no calls made');
  // The projection printed is project() at the harness concurrency, not at unlimited.
  const p = project({ agents: 100, model: 'haiku', kind: 'api', topology: 'partitioned', concurrency: 20 });
  assert.ok(lines[1].includes(`cost $${p.cost.toFixed(4)}`));
  assert.ok(lines[1].includes(`time ${p.seconds.toFixed(1)}s`));
  assert.ok(lines[1].endsWith('(concurrency 20)'));
  assert.ok(readme.replace(/\s+/g, ' ').includes('`--dry-run` reports whether the SDK is present by attempting the import'));
  assert.match(fs.readFileSync(src('agents.mjs'), 'utf8'), /import\('@anthropic-ai\/sdk'\)/);
});

test('npm install is required: the SDK is a declared dependency and the README says to install it before a real run', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.dependencies['@anthropic-ai/sdk']);
  const real = section('Running real agents');
  assert.ok(real.includes('npm install'));
  assert.ok(real.indexOf('npm install') < real.indexOf('ANTHROPIC_API_KEY=...'), '`npm install` must come before the real-run command');
  assert.ok(real.includes('only the `api` kind'));
  assert.ok(real.includes('claude-code'));
  assert.ok(real.includes('It has never made a real API call'));
});

test('--max-spend: preflight refusal text and exit 3, bad value exit 2, mock run cannot trip the mid-run ceiling', async () => {
  const r = await refused;
  assert.equal(r.code, 3);
  assert.equal(r.stdout, '');
  const quoted = readme.match(/^(refused {3}projected cost .*)$/m);
  assert.ok(quoted, 'README refusal line not found');
  // agents.mjs calls warnIfPricingStale() before anything else, and that writes a line to stderr
  // once PRICING_CHECKED is more than STALE_AFTER_DAYS old. Comparing all of stderr by equality
  // would have turned this suite red on 2027-01-03 (91 days after 2026-10-04) with no file
  // changed. The refusal line is compared on its own; the next test pins the warning's prefix.
  const stderrLines = r.stderr.trimEnd().split('\n').filter((l) => !l.startsWith('warning: model pricing'));
  assert.deepEqual(stderrLines, [quoted[1]]);
  assert.equal((await badSpend).code, 2);
  assert.equal((await dryRunBadModel).code, 2);

  const m = await mockWithCeiling;
  assert.equal(m.code, 0, m.stdout + m.stderr);
  assert.match(m.stdout, /tokens\s+0 in \/ 0 out/);

  const flat = section('Running real agents').replace(/\s+/g, ' ');
  for (const phrase of [
    'it is enforced twice',
    'This compares one projection with a number you chose',
    'This check does not use the projection, so it holds even if the model is wrong',
    'the overshoot is bounded at that many calls',
    'Under `--mock` this check can never trip, because mock calls report zero tokens',
  ]) assert.ok(flat.includes(phrase), `README lost: ${phrase}`);
  const text = fs.readFileSync(src('agents.mjs'), 'utf8');
  assert.match(text, /overshoot is at most --concurrency calls/);
});

test('the stderr filter above is sound: a stale pricing date writes a line beginning "warning: model pricing"', () => {
  const day = 86_400_000;
  const written = [];
  const at = (days) => new Date(Date.parse(PRICING_CHECKED) + days * day);
  assert.equal(warnIfPricingStale(at(91), (s) => written.push(s)), true);
  assert.equal(written.length, 1);
  assert.ok(written[0].startsWith('warning: model pricing'), written[0]);
  assert.ok(written[0].endsWith('\n'));
  // And the boundary the date arithmetic in the comment depends on: 90 days is still fresh.
  assert.equal(warnIfPricingStale(at(90), (s) => written.push(s)), false);
  assert.equal(written.length, 1);
});

test('exit-code table: 0, 1, 2 and 3 are what the tool returns', async () => {
  const rows = tableRows(section('Running real agents').slice(section('Running real agents').indexOf('| code | meaning |')));
  assert.deepEqual(rows.map((r) => r[0]), ['0', '1', '2', '3']);
  assert.equal((await dryRun).code, 0);
  assert.equal((await mockRejected).code, 1, 'an oracle failure must exit 1');
  assert.equal((await badMock).code, 2);
  assert.equal((await refused).code, 3);
  const text = fs.readFileSync(src('agents.mjs'), 'utf8');
  for (const doc of [/0  ran and passed/, /1  ran and failed the oracle, or stopped by the spend ceiling mid-run/, /3  refused before any call/]) {
    assert.match(text, doc, 'the source header no longer describes the exit codes the README table does');
  }
});

test('--record and compare.mjs: a mock record is refused, fixtures print their banner, the three states appear', async () => {
  const record = fs.readFileSync(recordFile, 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l));
  const summary = record.at(-1);
  assert.equal(summary.summary, true);
  assert.ok(summary.model.startsWith('mock:'));
  assert.equal(summary.inputTokens, 0);
  assert.equal(record.length - 1, summary.calls);

  const refusedMock = await compareMock;
  assert.equal(refusedMock.code, 2);
  assert.match(refusedMock.stderr, /record is from a mock run/);
  assert.equal(refusedMock.stdout, '');

  const part = await comparePartitioned;
  const hier = await compareHierarchical;
  assert.equal(part.code, 0);
  assert.equal(hier.code, 0);
  for (const out of [part.stdout, hier.stdout]) assert.match(out, /SYNTHETIC RECORD/);
  const states = new Set([...(part.stdout + hier.stdout).matchAll(/^ {4}(measured|upper-bound|not-identifiable):/gm)].map((m) => m[1]));
  assert.deepEqual([...states].sort(), ['measured', 'not-identifiable', 'upper-bound']);
  // Partitioned identifies the intercept (as an upper bound) and not the slope.
  assert.match(part.stdout, /latencyMs[^\n]*\n {4}upper-bound:/);
  assert.match(part.stdout, /outputTokensPerSecond[^\n]*measured -[^\n]*\n {4}not-identifiable:/);
  assert.match(hier.stdout, /outputTokensPerSecond[^\n]*\n {4}measured:/);
  // One-variable fit folds prefill into the intercept.
  assert.match(hier.stdout, /prefill is folded into the intercept/);

  const flat = readme.replace(/\s+/g, ' ');
  for (const phrase of ['`measured`', '`upper-bound`', '`not-identifiable`', 'it identifies the intercept and nothing else', 'A mock record is refused outright with exit 2', 'SYNTHETIC RECORD banner', 'LATENCY` and `OUTPUT_TOKENS_PER_SECOND` are the intercept and slope']) {
    assert.ok(flat.includes(phrase), `README lost: ${phrase}`);
  }
  // The flags are read by the source, and the fixtures the README names are on disk.
  for (const f of ['test/fixtures/record-partitioned.jsonl', 'test/fixtures/record-hierarchical.jsonl']) assert.ok(readme.includes(f) && fs.existsSync(path.join(root, f)));
});

/* ---- what this cannot measure ---------------------------------------------------------- */

test('"what this cannot measure": each limitation is still true of the code', async () => {
  const limits = section('What this cannot measure').replace(/\s+/g, ' ');
  const { ASSUMPTIONS } = await import('../src/cost-model.mjs');
  const { UNCHECKED } = await import('../src/compare.mjs');

  // OVERHEAD.api: README says 200 assumed, 45 implied; the live tool prints both.
  const part = await comparePartitioned;
  const hier = await compareHierarchical;
  for (const out of [part.stdout, hier.stdout]) {
    const m = out.match(/^overhead\.api\s+assumed (\d+)\s+measured (\d+)/m);
    assert.ok(m);
    assert.equal(Number(m[1]), ASSUMPTIONS.OVERHEAD.api);
    assert.ok(limits.includes(`may be ${m[2]} rather than the assumed ${m[1]}`), 'README must state the overhead the fixtures imply');
    assert.ok(limits.includes(`a factor of about ${(m[1] / m[2]).toFixed(1)}`));
  }

  // Four machine-readable keys, named; three structural assumptions that are prose only.
  assert.deepEqual(Object.keys(ASSUMPTIONS).sort(), ['LATENCY', 'OUTPUT_TOKENS_PER_SECOND', 'OVERHEAD', 'TOKENS_PER_NUMBER']);
  assert.ok(limits.includes('`ASSUMPTIONS` has four machine-readable keys'));
  assert.ok(readme.includes('`OVERHEAD`, `TOKENS_PER_NUMBER`,\n`OUTPUT_TOKENS_PER_SECOND`, `LATENCY`'));
  for (const marker of [/50\/50/, /prefill/, /untimed/]) assert.ok(UNCHECKED.some((u) => marker.test(u)), `compare.mjs no longer lists ${marker}`);
  assert.ok(limits.includes('Three further structural assumptions'));
  assert.ok(limits.includes('(50/50)') && limits.includes('the partitioned merge, which is untimed and unpriced'));

  // project() honours fanout, and compare.mjs hands it the record's own: the T-020 paragraph is gone.
  const withFanout = project({ agents: 12, topology: 'hierarchical', fanout: 3 });
  const without = project({ agents: 12, topology: 'hierarchical' });
  assert.ok(withFanout.calls > without.calls, 'fanout 3 builds a taller tree than the default, so it makes more calls');
  assert.match(fs.readFileSync(src('cost-model.mjs'), 'utf8'), /hierarchical: \(n, fanout\) =>/);
  assert.match(fs.readFileSync(src('compare.mjs'), 'utf8'), /fanout: summary\.fanout/);
  assert.doesNotMatch(limits, /hardcodes|T-020/, 'the fanout limitation was fixed; the README must not still state it');

  // Not streamed: the one-variable fit says it folds prefill into the intercept.
  assert.match(hier.stdout, /latencyMs[^\n]*\n {4}upper-bound: intercept of a one-variable fit: includes input prefill/);
  assert.ok(limits.includes('Calls are not streamed'));

  // The race is closed: test/hierarchical.test.mjs runs from a scratch copy of src/ and never
  // reads the project's runs/, and the README no longer claims a surviving race or a flake rate.
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  assert.match(read('test/hierarchical.test.mjs'), /path\.join\(scratch, 'runs'\)/);
  assert.doesNotMatch(read('test/hierarchical.test.mjs'), /path\.join\(root, 'runs'\)/);
  assert.match(read('test/run-isolation.test.mjs'), /runs\//);
  assert.doesNotMatch(readme.replace(/\s+/g, ' '), /test race|failure in \d+ full|full suite runs/);

  // Said at the point of use, not once: the sections that quote agent figures label them.
  assert.ok(limits.includes('There is no credential in this environment, and no real run has ever happened'));
  assert.ok(section('Running real agents').includes('Every agent figure in this README is a projection'));
  assert.ok(section('What it costs').includes('**These are projections, not measurements**'));
  assert.ok(section('Where distribution wins on time').replace(/\s+/g, ' ').includes('All of these are projections'));
});

test('Open section: "Measure it" gives the procedure in order, and the overhead constant is named', () => {
  const open = section('Open');
  const at = ['--dry-run', '--record', 'compare.mjs'].map((s) => open.indexOf(s));
  assert.ok(at.every((i) => i !== -1), 'Open must mention --dry-run, --record and compare.mjs');
  assert.ok(at[0] < at[1] && at[1] < at[2], 'Open must mention them in that order');
  const flat = open.replace(/\s+/g, ' ');
  assert.ok(flat.includes('the model assumes 200 input tokens per call'));
  assert.doesNotMatch(open, /probably wrong somewhere/);
});

/* ---- wave seven: fanout, the harness's refusals, the pid in --out, the closed residual ----- */

const fanout3 = node([src('cost-model.mjs'), '--agents', '12', '--fanout', '3']);
const fanoutDefault = node([src('cost-model.mjs'), '--agents', '12']);
const fanoutOne = node([src('cost-model.mjs'), '--agents', '12', '--fanout', '1']);
const costInfinity = node([src('cost-model.mjs'), '--agents', '12', '--concurrency', 'Infinity']);
const costFraction = node([src('cost-model.mjs'), '--agents', '12', '--concurrency', '2.5']);
const noKey = { ANTHROPIC_API_KEY: undefined };
const refuse = (...args) => node([src('agents.mjs'), ...args], noKey);
const hierDry = refuse('--agents', '12', '--topology', 'hierarchical', '--fanout', '3', '--dry-run');
const zeroAgents = refuse('--agents', '0');
const concurrencyText = refuse('--agents', '5', '--concurrency', 'abc');
const concurrencyInfinity = refuse('--agents', '5', '--concurrency', 'Infinity');
const concurrencyFraction = refuse('--agents', '5', '--concurrency', '2.5');
const unpriced = refuse('--agents', '5', '--model', 'claude-sonnet-4-5');
// No --out: the harness names its file with its own pid, under <its root>/runs (the scratch copy).
const defaultOut = node([path.join(scratch, 'src', 'agents.mjs'), '--agents', '3', '--mock', 'clean']);

function hierarchicalRow(stdout) {
  const m = stdout.match(/^api\s+hierarchical\s+(\d+)\s+(\d+)\s+(\d+)\s+\$/m);
  assert.ok(m, 'no api hierarchical row');
  return { calls: Number(m[1]), input: Number(m[2]) };
}

test('--fanout on the cost model: documented flag, 19 calls at 3 against 15 at the default, 1 refused', async () => {
  const f3 = await fanout3;
  const fd = await fanoutDefault;
  assert.equal(f3.code, 0);
  const a = hierarchicalRow(f3.stdout);
  const b = hierarchicalRow(fd.stdout);
  assert.equal(a.calls, project({ agents: 12, topology: 'hierarchical', fanout: 3 }).calls);
  assert.equal(b.calls, project({ agents: 12, topology: 'hierarchical' }).calls);
  assert.notEqual(a.calls, b.calls);
  const flat = readme.replace(/\s+/g, ' ');
  assert.ok(flat.includes(`the default gives ${b.calls} \`hierarchical\` calls and ${b.input} input tokens as API calls, and \`--fanout 3\` gives ${a.calls} calls and ${a.input}`));
  assert.ok(readme.includes('node src/cost-model.mjs --agents 12 --fanout 3'));
  assert.ok(flat.includes('`--fanout N` (hierarchical only: the group size of the merge tree; an integer >= 2, default 10'));
  assert.ok(flat.includes('and 1 is refused because a fanout of 1 never reduces'));
  const one = await fanoutOne;
  assert.equal(one.code, 2);
  assert.match(one.stderr, /--fanout/);
  assert.equal(one.stdout, '');
  assert.throws(() => project({ agents: 12, topology: 'hierarchical', fanout: 1 }), /fanout/);
});

test('--concurrency has different valid values in the cost model and the harness, as the README says', async () => {
  // Cost model: any positive number, Infinity only by leaving the flag out (and through project()).
  const inf = await costInfinity;
  assert.equal(inf.code, 2);
  assert.match(inf.stderr, /--concurrency/);
  assert.equal((await costFraction).code, 0);
  assert.equal(typeof project({ agents: 12, concurrency: Infinity }).seconds, 'number');
  // Harness: an integer >= 1; Infinity, text and fractions are refused with the flag named.
  for (const r of [await concurrencyInfinity, await concurrencyText, await concurrencyFraction]) {
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /--concurrency must be an integer >= 1/);
    assert.equal(r.stdout, '');
  }
  const flat = readme.replace(/\s+/g, ' ');
  for (const phrase of [
    'the literal `Infinity` is refused with exit 2 (the library function `project()` does accept `Infinity`, which is its default)',
    'On the agent harness it is an integer >= 1 with a default of 20, and `Infinity`, `0`, a fraction or text exit 2',
    '`--agents` and `--concurrency` must be integers >= 1',
  ]) assert.ok(flat.includes(phrase), `README lost: ${phrase}`);
});

test('harness refusals: --agents 0, an unpriced model, and bad concurrency exit 2 with the flag named and no call', async () => {
  const z = await zeroAgents;
  assert.equal(z.code, 2);
  assert.match(z.stderr, /--agents must be an integer >= 1/);
  const u = await unpriced;
  assert.equal(u.code, 2);
  assert.match(u.stderr, /not in src\/pricing\.mjs/);
  assert.doesNotMatch(u.stderr, /ANTHROPIC_API_KEY|credential/i, 'the price refusal must come before the credential check');
  for (const r of [z, u]) {
    assert.equal(r.stdout, '', 'a refused run prints no report');
    assert.doesNotMatch(r.stdout + r.stderr, /\$0\.0000/);
  }
  assert.equal(MODELS.haiku.id, 'claude-haiku-4-5');
  assert.ok(!Object.values(MODELS).some((m) => m.id === 'claude-sonnet-4-5'), 'the unpriced id used above became priced; pick another');
  const flat = readme.replace(/\s+/g, ' ');
  for (const phrase of [
    'or a raw model id that appears in `src/pricing.mjs`',
    'A bad value exits 2 with the flag named, before any call',
    'A model with no price in `src/pricing.mjs` also exits 2 before the credential check',
  ]) assert.ok(flat.includes(phrase), `README lost: ${phrase}`);
});

test('--dry-run at --fanout 3 projects the same 19 calls as the cost model, and the first line names the fanout', async () => {
  const d = await hierDry;
  assert.equal(d.code, 0, d.stderr);
  const lines = d.stdout.split('\n');
  assert.match(lines[0], /^dry run   hierarchical   claude-haiku-4-5   12 agents   fanout 3   kind api$/);
  const calls = Number(lines[1].match(/calls (\d+)/)[1]);
  assert.equal(calls, hierarchicalRow((await fanout3).stdout).calls);
  assert.equal(calls, project({ agents: 12, topology: 'hierarchical', fanout: 3 }).calls);
  const flat = readme.replace(/\s+/g, ' ');
  assert.ok(flat.includes(`\`--agents 12 --topology hierarchical --fanout 3 --dry-run\` prints \`calls ${calls}\``));
});

test('default --out carries the pid, in the source, in the README, and in the file a run leaves', async () => {
  assert.match(fs.readFileSync(src('agents.mjs'), 'utf8'), /`agents-\$\{topology\}-\$\{agents\}-\$\{process\.pid\}\.txt`/);
  assert.ok(readme.includes('`runs/agents-<topology>-<agents>-<pid>.txt`'));
  assert.ok(!readme.includes('<agents>.txt'), 'the old pid-less default path is still in the README');
  const r = await defaultOut;
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const left = fs.readdirSync(path.join(scratch, 'runs')).filter((f) => /^agents-partitioned-3-\d+\.txt$/.test(f));
  assert.equal(left.length, 1, `expected one pid-named output file, found ${left}`);
});

test('compare.mjs projects the tree that ran, and the hierarchical fixture\'s token gap closes exactly', async () => {
  const hier = (await compareHierarchical).stdout;
  const n = (re) => Number(hier.match(re)[1]);
  const projected = n(/^tokens in\s+projected (\d+)/m);
  const measured = n(/^tokens in\s+projected \d+\s+measured (\d+)/m);
  const overhead = n(/^overhead\.api\s+assumed \d+\s+measured (\d+)/m);
  const perNumber = n(/^tokensPerNumber\.list\s+assumed [\d.]+\s+measured ([\d.]+)/m);
  const calls = n(/(\d+) calls\n/);

  // The projection is the cost model's, at the record's own fanout (3) and not the default.
  const tree = project({ agents: 12, topology: 'hierarchical', fanout: 3 });
  assert.equal(projected, tree.input);
  assert.notEqual(projected, project({ agents: 12, topology: 'hierarchical' }).input);
  assert.equal(calls, tree.calls);

  // 36 is the number of values the merger and root calls read, taken from the fixture itself.
  const rows = fs.readFileSync(path.join(root, 'test', 'fixtures', 'record-hierarchical.jsonl'), 'utf8')
    .split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).filter((r) => !r.summary);
  const values = rows.filter((r) => r.role !== 'leaf').reduce((a, r) => a + r.valuesIn, 0);
  assert.equal(rows.length, calls);
  const { ASSUMPTIONS } = await import('../src/cost-model.mjs');
  assert.equal(calls * ASSUMPTIONS.OVERHEAD.api + values * ASSUMPTIONS.TOKENS_PER_NUMBER, projected);
  assert.equal(calls * overhead + values * perNumber, measured);
  assert.equal(ASSUMPTIONS.OVERHEAD.api, 200, 'OVERHEAD.api is deliberately unchanged; see the README');

  const flat = readme.replace(/\s+/g, ' ');
  assert.ok(flat.includes(`projects ${projected} input tokens against ${measured} measured`));
  assert.ok(flat.includes(`${projected} = ${calls} x ${ASSUMPTIONS.OVERHEAD.api} + ${values} x ${ASSUMPTIONS.TOKENS_PER_NUMBER} and ${measured} = ${calls} x ${overhead} + ${values} x ${perNumber}`));
  assert.ok(section('What this cannot measure').replace(/\s+/g, ' ').includes(`(${projected} projected against ${measured} measured, above)`));
  assert.ok(flat.includes('with nothing about the tree left in it'));

  // A record whose fanout cannot be used gets no projection and a warning, not a guessed tree.
  const bad = path.join(scratch, 'bad-fanout.jsonl');
  const original = fs.readFileSync(path.join(root, 'test', 'fixtures', 'record-hierarchical.jsonl'), 'utf8');
  assert.ok(original.includes('"fanout":3'));
  fs.writeFileSync(bad, original.replace('"fanout":3', '"fanout":1'));
  const r = await node([src('compare.mjs'), bad]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^tokens in\s+projected -\s+measured \d+/m);
  assert.match(r.stdout, /warning: could not project this run: invalid fanout 1/);
  assert.ok(flat.includes('If that fanout is missing or unusable (below 2, for instance), the projection columns print a dash and a warning says why, and no tree is guessed'));
});
