#!/usr/bin/env node
/**
 * The same experiment with real agents instead of processes.
 *
 *   ANTHROPIC_API_KEY=... node src/agents.mjs --agents 100 --topology partitioned
 *   ANTHROPIC_API_KEY=... node src/agents.mjs --agents 20 --topology shared-lock --model sonnet
 *
 * Reports measured tokens, measured dollars and measured wall-clock — the three things the
 * cost model only projects. Compare the two; where they disagree, the model is wrong.
 *
 * ## Why this is a different experiment, not just a slower one
 *
 * A process follows the protocol exactly. That makes it the right tool for finding races and
 * the wrong tool for everything else, because the failures a *model* produces are different
 * in kind:
 *
 *   - It can misread the protocol and do something reasonable that nobody specified.
 *   - It can decide the file looks wrong and helpfully repair it.
 *   - It can return the right answer in the wrong format.
 *   - It can be correct and slow in a way that trips a lock's staleness timeout.
 *
 * None of those appear in the process harness, and all of them are what actually goes wrong
 * when you point agents at shared state.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { verify } from './verify.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const MODELS = {
  opus: 'claude-opus-5',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5',
};

/** Published per-million rates, for turning measured tokens into measured dollars. */
const PRICE = {
  'claude-opus-5': { input: 5.0, output: 25.0 },
  'claude-sonnet-5': { input: 2.0, output: 10.0 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
};

function arg(flag, fallback) {
  const index = process.argv.indexOf(`--${flag}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const agents = Number(arg('agents', 10));
const model = MODELS[arg('model', 'haiku')] ?? arg('model', 'haiku');
const topology = arg('topology', 'partitioned');
const concurrency = Number(arg('concurrency', 20));

if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.error('No credentials. Export ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) and retry.');
  process.exit(2);
}

const { default: Anthropic } = await import('@anthropic-ai/sdk');
const client = new Anthropic();

const usage = { input: 0, output: 0, calls: 0, failures: [] };

/**
 * One agent: one number in, its contribution out.
 *
 * `max_tokens` is deliberately small. The task is to emit a few characters, and a large
 * ceiling on a trivial task is an invitation to explain itself at length — which costs output
 * tokens at five times the input rate.
 */
async function ask(prompt, maxTokens = 512) {
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system:
      'You perform one small step of a larger job. Reply with the requested value only — no ' +
      'explanation, no code fences, no surrounding prose.',
    messages: [{ role: 'user', content: prompt }],
  });

  usage.calls += 1;
  usage.input += response.usage.input_tokens;
  usage.output += response.usage.output_tokens;

  const text = response.content.find((block) => block.type === 'text');
  return (text?.text ?? '').trim();
}

/** Run tasks with a ceiling on in-flight requests, so a hundred agents don't all hit at once. */
async function pooled(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;

  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= tasks.length) return;
        results[index] = await tasks[index]();
      }
    }),
  );

  return results;
}

const file = path.join(root, 'runs', `agents-${topology}-${agents}.txt`);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, '');

const numbers = Array.from({ length: agents }, (_, i) => i + 1).sort(() => Math.random() - 0.5);
const started = Date.now();

if (topology === 'partitioned') {
  /*
   * Every agent emits only its own number, in parallel, and code merges. Each call carries
   * O(1) context — which is the entire cost argument for this topology.
   *
   * Worth being honest that the agents are not doing the sorting here. The merge is, and the
   * merge is four lines of JavaScript.
   */
  const answers = await pooled(
    numbers.map((n) => () => ask(`Output the number ${n}. Nothing else.`, 16)),
    concurrency,
  );

  const parsed = answers
    .map((answer) => Number(String(answer).replace(/[^\d-]/g, '')))
    .filter((n) => Number.isFinite(n));

  fs.writeFileSync(file, parsed.sort((a, b) => a - b).join(','));
} else if (topology === 'shared-lock') {
  /*
   * Each agent sees the current file and returns the whole thing with its number inserted.
   * Serial by construction, and context grows as the run proceeds — O(N²) tokens overall.
   *
   * This is where model-specific failures show up: a reformatted list, a dropped number, a
   * helpful explanation wrapped around the answer.
   */
  for (const n of numbers) {
    const current = fs.readFileSync(file, 'utf8').trim();
    const answer = await ask(
      current === ''
        ? `Output exactly: ${n}`
        : `Here is a sorted comma-separated list:\n${current}\n\n` +
            `Insert ${n} into the correct position. Output the complete new list, ` +
            `comma-separated, nothing else.`,
      Math.max(64, agents * 6),
    );

    const cleaned = answer.replace(/[^\d,\-]/g, '').replace(/^,|,$/g, '');
    if (cleaned === '') {
      usage.failures.push(`agent ${n} returned nothing usable: ${JSON.stringify(answer.slice(0, 60))}`);
      continue;
    }
    fs.writeFileSync(file, cleaned);
  }
} else {
  console.error(`Unknown topology: ${topology}`);
  process.exit(2);
}

const elapsed = (Date.now() - started) / 1000;
const price = PRICE[model] ?? { input: 0, output: 0 };
const cost = (usage.input / 1e6) * price.input + (usage.output / 1e6) * price.output;
const result = verify(file, Array.from({ length: agents }, (_, i) => i + 1));

console.log(`\n${topology}   ${model}   ${agents} agents`);
console.log(`calls    ${usage.calls}`);
console.log(`tokens   ${usage.input} in / ${usage.output} out`);
console.log(`cost     $${cost.toFixed(4)}   ($${(cost / agents).toFixed(5)} per agent)`);
console.log(`time     ${elapsed.toFixed(1)}s`);
console.log(`result   ${result.ok ? 'PASS' : 'FAIL'}`);

for (const failure of [...usage.failures, ...result.failures]) console.log(`  ${failure}`);
process.exit(result.ok ? 0 : 1);
