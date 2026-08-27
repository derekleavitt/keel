#!/usr/bin/env node
/**
 * Circuit breakers, as code.
 *
 * The loop protocol describes these in prose. Prose is not enforcement: a loop told to
 * stop after three identical failures does so only if it chooses to. When something
 * absolutely must not happen, an instruction is the wrong tool.
 *
 * State lives in .orchestration/loop-state.json and survives process death, because the
 * loop can be killed at any instant by credit exhaustion or a closed terminal.
 *
 * Usage:
 *   loop-guard record-failure <task> <output-file>   after a red verify
 *   loop-guard record-success <task>                 after a green verify
 *   loop-guard check <task>                          exits 2 if a breaker has tripped
 *   loop-guard reset <task>                          on task completion
 *   loop-guard budget                                report spend against limits
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const orch = path.join(root, '.orchestration');
const stateFile = path.join(orch, 'loop-state.json');

const LIMITS = {
  identicalFailures: 3,
  taskIterations: 8,
  consecutiveRedTurns: 2,
  maxIterationsPerRun: Number(process.env.KEEL_LOOP_MAX_ITERATIONS ?? 60),
};

function load() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return { tasks: {}, run: { iterations: 0, startedAt: new Date().toISOString() } };
  }
}

function save(state) {
  fs.mkdirSync(orch, { recursive: true });
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

function taskState(state, task) {
  state.tasks[task] ??= { iterations: 0, consecutiveRed: 0, failures: {}, lastFailure: null };
  return state.tasks[task];
}

/**
 * Normalise a failure so cosmetic differences do not read as distinct problems.
 * Timings, paths, hashes and line numbers vary between otherwise identical runs.
 */
function fingerprint(output) {
  const normalised = output
    .replace(/\d+(\.\d+)?m?s\b/g, 'T')
    .replace(/\/[^\s:]+\//g, '/P/')
    .replace(/\b[0-9a-f]{7,40}\b/g, 'H')
    .replace(/:\d+:\d+/g, ':L:C')
    .replace(/\s+/g, ' ')
    .trim();
  return crypto.createHash('sha256').update(normalised).digest('hex').slice(0, 16);
}

function trip(task, reason, detail) {
  const dir = path.join(orch, 'blocked');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${task}.md`);
  fs.writeFileSync(
    file,
    `---
task: ${task}
tripped: ${new Date().toISOString()}
breaker: ${reason}
---
# Circuit breaker: ${reason}

${detail}

## What a human needs to decide

The loop stopped rather than continuing, because continuing past this point produces
confident wrong work rather than progress.

Before resuming:

1. Read the failure above and decide whether the task, the acceptance criteria, or the
   design is wrong. All three are possible; only one is likely.
2. If a mistake was made, record it in \`.orchestration/lessons/\` with an
   \`enforced_by\` mechanism, so it cannot recur silently.
3. Clear this breaker with \`node scripts/loop-guard.mjs reset ${task}\`.

Do not clear it without addressing the cause. The breaker is the only thing standing
between a wrong turn and twenty iterations built on top of it.
`,
  );
  console.error(`\nCIRCUIT BREAKER: ${reason}`);
  console.error(detail);
  console.error(`\nWritten to .orchestration/blocked/${task}.md — the loop must stop.`);
  process.exit(2);
}

const [, , command, task, arg] = process.argv;
const state = load();

switch (command) {
  case 'record-failure': {
    if (!task) throw new Error('record-failure needs a task id');
    const output = arg && fs.existsSync(arg) ? fs.readFileSync(arg, 'utf8') : (arg ?? '');
    const ts = taskState(state, task);
    const fp = fingerprint(output);

    ts.iterations += 1;
    ts.consecutiveRed += 1;
    ts.failures[fp] = (ts.failures[fp] ?? 0) + 1;
    ts.lastFailure = { fingerprint: fp, at: new Date().toISOString() };
    state.run.iterations += 1;
    save(state);

    const repeats = ts.failures[fp];
    console.log(`loop-guard: ${task} — iteration ${ts.iterations}, failure ${fp} seen ${repeats}x`);

    if (repeats >= LIMITS.identicalFailures) {
      trip(
        task,
        `identical verify failure ${repeats}x`,
        `The same failure (fingerprint ${fp}) has now occurred ${repeats} times on ${task}.\n` +
          `Repeating an approach that has failed identically three times will not work a fourth.\n` +
          `The problem is upstream of the fix being attempted.\n\n` +
          `Last output:\n\n\`\`\`\n${output.slice(-2000)}\n\`\`\``,
      );
    }
    if (ts.iterations >= LIMITS.taskIterations) {
      trip(
        task,
        `task exceeded ${LIMITS.taskIterations} iterations`,
        `${task} has run ${ts.iterations} iterations without completing.\n` +
          `This usually means the task was mis-scoped at decomposition, not that the work is hard.`,
      );
    }
    if (ts.consecutiveRed >= LIMITS.consecutiveRedTurns) {
      trip(
        task,
        `gate red at the end of ${ts.consecutiveRed} consecutive turns`,
        `Never build on top of a red gate. Revert to the last green commit and restart the task.`,
      );
    }
    break;
  }

  case 'record-success': {
    if (!task) throw new Error('record-success needs a task id');
    const ts = taskState(state, task);
    ts.consecutiveRed = 0;
    ts.iterations += 1;
    state.run.iterations += 1;
    save(state);
    console.log(`loop-guard: ${task} green — iteration ${ts.iterations}`);
    if (state.run.iterations >= LIMITS.maxIterationsPerRun) {
      trip(
        task,
        `run budget exhausted (${state.run.iterations} iterations)`,
        `The run has used its iteration budget. This is a spend guard, not a failure.\n` +
          `Review progress in .orchestration/status.md and raise KEEL_LOOP_MAX_ITERATIONS to continue.`,
      );
    }
    break;
  }

  case 'check': {
    const blocked = path.join(orch, 'blocked', `${task}.md`);
    if (fs.existsSync(blocked)) {
      console.error(`loop-guard: ${task} is BLOCKED — see .orchestration/blocked/${task}.md`);
      process.exit(2);
    }
    const ts = state.tasks[task];
    console.log(
      ts
        ? `loop-guard: ${task} clear — ${ts.iterations} iteration(s), ${ts.consecutiveRed} consecutive red`
        : `loop-guard: ${task} clear — not started`,
    );
    break;
  }

  case 'reset': {
    if (!task) throw new Error('reset needs a task id');
    delete state.tasks[task];
    save(state);
    const blocked = path.join(orch, 'blocked', `${task}.md`);
    if (fs.existsSync(blocked)) fs.unlinkSync(blocked);
    console.log(`loop-guard: ${task} reset`);
    break;
  }

  case 'budget': {
    const used = state.run.iterations;
    const max = LIMITS.maxIterationsPerRun;
    console.log(
      `loop-guard: ${used}/${max} iterations used this run (since ${state.run.startedAt.slice(0, 16).replace('T', ' ')})`,
    );
    if (used / max > 0.8) console.log('  ! over 80% of the iteration budget consumed');
    break;
  }

  default:
    console.error(
      'usage: loop-guard <record-failure|record-success|check|reset|budget> <task> [output]',
    );
    process.exit(1);
}
