#!/usr/bin/env node
/**
 * The gate.
 *
 * Everything else in this repository is scaffolding around this command. It runs on
 * the Claude Code Stop hook, in pre-push, and in CI — one definition of "green", so
 * an agent, a developer and the pipeline can never disagree about whether work is done.
 *
 * Steps are ordered cheapest-first so failures surface fast.
 */
import { spawn } from 'node:child_process';
import process from 'node:process';

const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

/** @type {{ id: string, label: string, cmd: string, args: string[], when?: () => boolean, skipNote?: string }[]} */
const STEPS = [
  { id: 'lint', label: 'lint & format', cmd: 'pnpm', args: ['exec', 'biome', 'check', '.'] },
  { id: 'typecheck', label: 'typecheck', cmd: 'pnpm', args: ['exec', 'turbo', 'typecheck'] },
  { id: 'unit', label: 'unit tests', cmd: 'pnpm', args: ['exec', 'turbo', 'test:unit'] },
  { id: 'build', label: 'build', cmd: 'pnpm', args: ['exec', 'turbo', 'build'] },
  {
    id: 'e2e',
    label: 'e2e smoke',
    cmd: 'pnpm',
    args: ['exec', 'playwright', 'test'],
    when: () => process.env.KEEL_E2E === '1',
    skipNote: 'set KEEL_E2E=1 to include',
  },
];

function run(step) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(step.cmd, step.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('close', (code) => {
      resolve({ code: code ?? 1, output, ms: Date.now() - started });
    });
  });
}

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const started = Date.now();
const results = [];

console.log(`\n${BOLD}keel verify${RESET}${DIM}  ${new Date().toLocaleTimeString()}${RESET}\n`);

for (const step of STEPS) {
  if (only.length > 0 && !only.includes(step.id)) continue;

  if (step.when && !step.when()) {
    console.log(
      `  ${YELLOW}○${RESET} ${step.label.padEnd(16)} ${DIM}skipped — ${step.skipNote}${RESET}`,
    );
    results.push({ step, skipped: true });
    continue;
  }

  process.stdout.write(`  ${DIM}·${RESET} ${step.label.padEnd(16)} ${DIM}running…${RESET}`);
  const result = await run(step);
  process.stdout.write('\r\x1b[K');

  const seconds = `${(result.ms / 1000).toFixed(1)}s`;
  if (result.code === 0) {
    console.log(`  ${GREEN}✓${RESET} ${step.label.padEnd(16)} ${DIM}${seconds}${RESET}`);
    results.push({ step, ok: true });
  } else {
    console.log(`  ${RED}✗${RESET} ${step.label.padEnd(16)} ${DIM}${seconds}${RESET}\n`);
    console.log(result.output.trimEnd());
    console.log(
      `\n${RED}${BOLD}verify failed${RESET} at ${BOLD}${step.label}${RESET}` +
        `${DIM} — fix the above, then re-run \`pnpm verify\`${RESET}` +
        `${DIM}\n(to iterate on just this step: \`pnpm verify ${step.id}\`)${RESET}\n`,
    );
    process.exit(1);
  }
}

const total = ((Date.now() - started) / 1000).toFixed(1);
const passed = results.filter((r) => r.ok).length;
console.log(`\n${GREEN}${BOLD}verify passed${RESET} ${DIM}${passed} checks in ${total}s${RESET}\n`);
