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

const agents = Number(arg('agents', 8));
const strategy = arg('strategy', 'naive');
const trials = Number(arg('trials', 1));
const delay = Number(arg('delay', 25));

/** Shuffle, so nobody is accidentally writing in sorted order and hiding the problem. */
function shuffled(n) {
  const values = Array.from({ length: n }, (_, i) => i + 1);
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

async function trial(index) {
  const file = path.join(root, 'runs', `trial-${index}.txt`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');

  const assignment = shuffled(agents);
  const started = Date.now();

  /*
   * Separate OS processes, not promises in one event loop.
   *
   * Concurrency inside a single Node process is cooperative — it interleaves only where the
   * code happens to await. Real agents are separate processes with no shared runtime, and the
   * races they hit are the ones a single process cannot reproduce.
   */
  await Promise.all(
    assignment.map(
      (value) =>
        new Promise((resolve, reject) => {
          const child = spawn(
            process.execPath,
            [path.join(here, 'worker.mjs'), '--file', file, '--value', String(value), '--strategy', strategy, '--delay', String(delay)],
            { stdio: ['ignore', 'ignore', 'pipe'] },
          );
          let stderr = '';
          child.stderr.on('data', (chunk) => {
            stderr += chunk;
          });
          child.on('close', (code) =>
            code === 0 ? resolve() : reject(new Error(`worker ${value} exited ${code}: ${stderr}`)),
          );
        }),
    ),
  );

  /*
   * Let a strategy finish the job after its workers are done.
   *
   * `append` needs this — it deliberately leaves the file unsorted and relies on a coordinator
   * to know the run is over. Making that an explicit hook rather than something the runner
   * always does keeps the cost visible: only one strategy needs a coordinator, and you can see
   * which one from here.
   */
  const module = await import(`./strategies/${strategy}.mjs`);
  if (typeof module.compact === 'function') module.compact(file);

  const elapsed = Date.now() - started;
  const result = verify(file, Array.from({ length: agents }, (_, i) => i + 1));
  return { ...result, elapsed, file };
}

const results = [];
for (let i = 0; i < trials; i += 1) {
  try {
    results.push(await trial(i));
  } catch (error) {
    results.push({ ok: false, failures: [String(error.message)], elapsed: 0 });
  }
}

const passed = results.filter((r) => r.ok).length;
const median = results.map((r) => r.elapsed).sort((a, b) => a - b)[Math.floor(results.length / 2)];

console.log(`\nstrategy: ${strategy}   agents: ${agents}   trials: ${trials}`);
console.log(`passed:   ${passed}/${trials}   median: ${median}ms\n`);

for (const [index, result] of results.entries()) {
  if (result.ok) continue;
  console.log(`  trial ${index}: ${result.found ?? 0}/${result.expected ?? agents} present`);
  for (const failure of result.failures) console.log(`    ${failure}`);
}

process.exit(passed === trials ? 0 : 1);
