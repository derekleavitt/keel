#!/usr/bin/env node
/**
 * One worker. Knows its number, knows the file, knows nothing else.
 *
 * Deliberately has no view of the other workers, no shared memory, and no way to talk to
 * them. Whatever coordination happens has to happen through the file — which is the same
 * constraint real agents operate under.
 *
 * Flags:
 *   --file <path>        required. The shared file.
 *   --value <n>          required, numeric. The number this worker contributes.
 *   --strategy <name>    naive | lockfile | append (default naive)
 *   --delay <ms>         work time inside the strategy (default 0)
 *   --crash-at <ms>      failure injection: process.exit(3) after this many ms, racing the
 *                        strategy. With the default 25ms delay, --crash-at 10 dies before the
 *                        write in every strategy. A crash *after* the write is not a worker
 *                        failure the oracle can excuse: the value is in the file but not in the
 *                        expected set, so it surfaces as `unexpected: [v]`, which is the
 *                        correct reading — the work happened and the worker still died.
 *   --hang               failure injection: never contributes, never exits. Only a SIGKILL
 *                        from the runner (--timeout) ends it.
 *
 * Exit codes: 0 ok, 1 strategy threw, 2 bad arguments, 3 injected crash.
 */
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function arg(flag, fallback) {
  const index = process.argv.indexOf(`--${flag}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function usage(message) {
  console.error(`worker: ${message}`);
  process.exit(2);
}

function numberArg(flag, fallback) {
  const raw = arg(flag);
  if (raw === undefined) return fallback;
  if (raw.trim() === '' || !Number.isFinite(Number(raw))) usage(`--${flag} must be numeric, got "${raw}"`);
  return Number(raw);
}

const file = arg('file');
if (file === undefined || file.startsWith('--') || file === '') usage('missing required --file <path>');

const rawValue = arg('value');
if (rawValue === undefined || rawValue.trim() === '' || !Number.isFinite(Number(rawValue))) {
  usage(`--value must be numeric, got ${rawValue === undefined ? 'nothing' : `"${rawValue}"`}`);
}
const value = Number(rawValue);

const strategyName = arg('strategy', 'naive');
if (!/^[a-z0-9_-]+$/i.test(strategyName)) usage(`bad --strategy "${strategyName}"`);
const delay = numberArg('delay', 0);
const crashAt = numberArg('crash-at', null);
const hang = process.argv.includes('--hang');

if (hang) {
  // Alive forever, doing nothing. The interval keeps the event loop from draining.
  setInterval(() => {}, 1 << 30);
  await new Promise(() => {});
}

if (crashAt !== null) {
  // Not unref'd and not cleared: it races the strategy and wins if the strategy is slower.
  setTimeout(() => process.exit(3), crashAt);
}

let strategy;
try {
  strategy = await import(path.join(here, 'strategies', `${strategyName}.mjs`));
} catch (error) {
  usage(`cannot load strategy "${strategyName}": ${error.message}`);
}

try {
  await strategy.contribute({ file, value, delay });
  process.exit(0);
} catch (error) {
  console.error(`worker ${value}: ${error.message}`);
  process.exit(1);
}
