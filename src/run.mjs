#!/usr/bin/env node
/**
 * The orchestrator.
 *
 * Spawns N workers against one shared file, waits for them, and asks the oracle whether the
 * result is correct. That is the entire loop.
 *
 *   node src/run.mjs --agents 8 --strategy naive
 *   node src/run.mjs --agents 8 --strategy naive --trials 20
 *
 * `--trials` matters more than it looks. A concurrency bug that shows up one run in five is
 * still a bug, and a single green run proves nothing. Reporting "17/20 passed" is the honest
 * unit of measurement here.
 *
 * Non-uniform workers and failure injection:
 *   --slow <k> --slow-ms <ms>   k workers get --delay <slow-ms> instead of --delay
 *   --faulty <k>                k workers are faulty (distinct from the slow ones)
 *   --fault <crash|hang>        what a faulty worker does (default crash)
 *   --crash-at <ms>             when a crashing worker dies (default 10)
 *   --timeout <ms>              SIGKILL anything still running after this long (default 30000)
 *   --keep                      keep trial files after passing and print a `file:` line per trial
 *                               (used by tests to observe output paths; off by default)
 *
 * Faulty workers' values are excluded from the oracle's expected set: a worker that was
 * supposed to die has not promised anything. If its value shows up in the file anyway the
 * oracle reports it as `unexpected`. Any *non-faulty* worker that exits non-zero or is killed
 * by the timeout fails the trial. Outcomes are reported separately: crashed, hung (killed by
 * the timeout), and errored (a healthy worker that failed).
 *
 * Exit codes: 0 all trials passed, 1 some failed, 2 bad arguments.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { verify } from './verify.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

function arg(flag, fallback) {
  const index = process.argv.indexOf(`--${flag}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function bad(message) {
  console.error(`run: ${message}`);
  process.exit(2);
}

function num(flag, fallback, { min = 0, integer = false } = {}) {
  const raw = arg(flag);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(n) || n < min || (integer && !Number.isInteger(n))) {
    bad(`--${flag} must be ${integer ? 'an integer' : 'a number'} >= ${min}, got "${raw}"`);
  }
  return n;
}

const agents = num('agents', 8, { min: 1, integer: true });
const strategy = arg('strategy', 'naive');
const trials = num('trials', 1, { min: 1, integer: true });
const delay = num('delay', 25);
const slow = num('slow', 0, { integer: true });
const slowMs = num('slow-ms', 500);
const faulty = num('faulty', 0, { integer: true });
const fault = arg('fault', 'crash');
const crashAt = num('crash-at', 10);
const timeout = num('timeout', 30_000, { min: 1 });
const keep = process.argv.includes('--keep');

if (!/^[a-z0-9_-]+$/i.test(strategy) || !fs.existsSync(path.join(here, 'strategies', `${strategy}.mjs`))) {
  bad(`unknown --strategy "${strategy}"`);
}
if (fault !== 'crash' && fault !== 'hang') bad(`--fault must be crash or hang, got "${fault}"`);
if (slow + faulty > agents) bad(`--slow (${slow}) + --faulty (${faulty}) exceeds --agents (${agents})`);

/** Shuffle, so nobody is accidentally writing in sorted order and hiding the problem. */
function shuffled(n) {
  const values = Array.from({ length: n }, (_, i) => i + 1);
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

/** Spawn one worker; always resolves, with how it ended. Never rejects. */
function runWorker(file, value, role) {
  return new Promise((resolve) => {
    const args = [
      path.join(here, 'worker.mjs'),
      '--file', file,
      '--value', String(value),
      '--strategy', strategy,
      '--delay', String(role === 'slow' ? slowMs : delay),
    ];
    if (role === 'crash') args.push('--crash-at', String(crashAt));
    if (role === 'hang') args.push('--hang');

    const child = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let killed = false;
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, timeout);
    const done = (code, signal) => {
      clearTimeout(timer);
      resolve({ value, role, code, signal, killed, stderr: stderr.trim() });
    };
    child.on('error', (error) => {
      stderr += error.message;
      done(-1, null);
    });
    child.on('close', done);
  });
}

async function trial(index) {
  const file = path.join(root, 'runs', `trial-${process.pid}-${index}.txt`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
  // A previous trial's killed worker may have left a lock or scratch file behind.
  for (const name of fs.readdirSync(path.dirname(file))) {
    if (name.startsWith(`trial-${process.pid}-${index}.txt`) && name !== path.basename(file)) fs.rmSync(path.join(path.dirname(file), name), { force: true });
  }

  // Resolved before spawning so a bad strategy module fails the trial, not the process.
  const module = await import(`./strategies/${strategy}.mjs`);

  const assignment = shuffled(agents);
  const roles = assignment.map((_, i) => (i < faulty ? fault : i < faulty + slow ? 'slow' : 'normal'));
  const faultyValues = new Set(assignment.filter((_, i) => roles[i] === fault && i < faulty));

  /*
   * Separate OS processes, not promises in one event loop.
   *
   * Concurrency inside a single Node process is cooperative — it interleaves only where the
   * code happens to await. Real agents are separate processes with no shared runtime, and the
   * races they hit are the ones a single process cannot reproduce.
   */
  const outcomes = await Promise.all(assignment.map((value, i) => runWorker(file, value, roles[i])));

  /*
   * Let a strategy finish the job after its workers are done.
   *
   * `append` needs this — it deliberately leaves the file unsorted and relies on a coordinator
   * to know the run is over. Making that an explicit hook rather than something the runner
   * always does keeps the cost visible: only one strategy needs a coordinator, and you can see
   * which one from here.
   */
  if (typeof module.compact === 'function') module.compact(file);

  const expected = assignment.filter((v) => !faultyValues.has(v)).sort((a, b) => a - b);
  const result = verify(file, expected);

  const isFaulty = (o) => faultyValues.has(o.value);
  const crashed = outcomes.filter((o) => isFaulty(o) && !o.killed && o.code !== 0);
  const hung = outcomes.filter((o) => o.killed);
  const errored = outcomes.filter((o) => !isFaulty(o) && (o.killed || o.code !== 0));
  const failures = [...result.failures];
  for (const o of errored) {
    failures.push(
      o.killed
        ? `worker ${o.value} (${o.role}) timed out after ${timeout}ms and was killed`
        : `worker ${o.value} exited ${o.code}${o.stderr ? `: ${o.stderr}` : ''}`,
    );
  }

  const kept = result.ok;
  const final = {
    ...result,
    ok: result.ok && errored.length === 0,
    failures,
    file,
    crashed: crashed.length,
    hung: hung.filter(isFaulty).length,
    errored: errored.length,
  };
  // Per-process file names mean concurrent invocations never share state; tidy up after passing.
  if (kept && errored.length === 0 && !keep) {
    for (const name of fs.readdirSync(path.dirname(file))) {
      if (name.startsWith(`trial-${process.pid}-${index}.txt`)) fs.rmSync(path.join(path.dirname(file), name), { force: true });
    }
  }
  return final;
}

const results = [];
for (let i = 0; i < trials; i += 1) {
  // Timed out here rather than inside trial(), so a trial that throws still reports the time
  // it actually took instead of 0.
  const started = Date.now();
  try {
    const result = await trial(i);
    results.push({ ...result, elapsed: Date.now() - started });
  } catch (error) {
    results.push({
      ok: false,
      failures: [String(error.message)],
      elapsed: Date.now() - started,
      crashed: 0,
      hung: 0,
      errored: 0,
    });
  }
}

const passed = results.filter((r) => r.ok).length;
const median = results.map((r) => r.elapsed).sort((a, b) => a - b)[Math.floor(results.length / 2)];
const sum = (key) => results.reduce((total, r) => total + (r[key] ?? 0), 0);

console.log(`\nstrategy: ${strategy}   agents: ${agents}   trials: ${trials}`);
console.log(`passed:   ${passed}/${trials}   median: ${median}ms\n`);
if (slow || faulty) {
  console.log(
    `injected: slow=${slow} (${slowMs}ms) faulty=${faulty} (${fault})   ` +
      `crashed: ${sum('crashed')}   hung (killed): ${sum('hung')}   errored: ${sum('errored')}\n`,
  );
}

if (keep) for (const result of results) if (result.file) console.log(`file: ${result.file}`);

for (const [index, result] of results.entries()) {
  if (result.ok) continue;
  console.log(`  trial ${index}: ${result.found ?? 0}/${result.expected ?? agents} present`);
  for (const failure of result.failures) console.log(`    ${failure}`);
}

process.exit(passed === trials ? 0 : 1);
