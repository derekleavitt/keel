#!/usr/bin/env node
/**
 * One worker. Knows its number, knows the file, knows nothing else.
 *
 * Deliberately has no view of the other workers, no shared memory, and no way to talk to
 * them. Whatever coordination happens has to happen through the file — which is the same
 * constraint real agents operate under.
 */
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function arg(flag, fallback) {
  const index = process.argv.indexOf(`--${flag}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const file = arg('file');
const value = Number(arg('value'));
const strategyName = arg('strategy', 'naive');
const delay = Number(arg('delay', 0));

const strategy = await import(path.join(here, 'strategies', `${strategyName}.mjs`));

try {
  await strategy.contribute({ file, value, delay });
  process.exit(0);
} catch (error) {
  console.error(`worker ${value}: ${error.message}`);
  process.exit(1);
}
