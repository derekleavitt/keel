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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verify } from './verify.mjs';
import { MODELS as PRICING_MODELS, warnIfPricingStale } from './pricing.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

/** Rates by full model id, derived from the shared table in pricing.mjs. */
const PRICE = Object.fromEntries(
  Object.values(PRICING_MODELS).map(({ id, input, output }) => [id, { input, output }]),
);
/** alias -> model id; raw ids are still accepted by --model. */
const MODELS = Object.fromEntries(Object.entries(PRICING_MODELS).map(([alias, m]) => [alias, m.id]));

const SYSTEM =
  'You perform one small step of a larger job. Reply with the requested value only — no ' +
  'explanation, no code fences, no surrounding prose.';

/* ---------------------------------------------------------------------------------------
 * Blame. Every reply ends up in exactly one of three places, and the report keeps them apart:
 *
 *   accepted  the harness parsed it into numbers and used them. If those numbers are wrong,
 *             the oracle says so, and that one *is* the model's doing.
 *   rejected  the harness could not turn the reply into numbers (empty, refusal, prose with
 *             no digits, or the wrong count of them) and refused to guess. Nothing was
 *             written. The agent, the raw reply and the reason are recorded.
 *   errored   the call itself failed (network, API error). Neither the model's answer nor
 *             the parser's.
 *
 * What must never happen is a reply being coerced into a number it did not contain.
 * ------------------------------------------------------------------------------------- */

/** Integers in a reply. `1\n2\n3` is three numbers, not 123; `1-2` is 1 and 2, not 1 and -2. */
export function extractIntegers(text) {
  return (String(text ?? '').match(/(?<!\d)-?\d+/g) ?? []).map(Number);
}

/** One number expected (partitioned). Returns {ok, value} or {ok:false, reason}. */
export function parseSingle(text) {
  const numbers = extractIntegers(text);
  if (numbers.length === 0) return { ok: false, reason: 'no integer in reply' };
  if (numbers.length > 1) {
    return { ok: false, reason: `ambiguous: ${numbers.length} integers in reply, expected 1` };
  }
  return { ok: true, value: numbers[0] };
}

/** A list expected (shared-lock): exactly `expectedCount` integers, in any separator style. */
export function parseList(text, expectedCount) {
  const numbers = extractIntegers(text);
  if (numbers.length === 0) return { ok: false, reason: 'no integer in reply' };
  if (numbers.length !== expectedCount) {
    return {
      ok: false,
      reason: `reply contained ${numbers.length} integers, expected ${expectedCount}`,
    };
  }
  return { ok: true, values: numbers };
}

function describe(text) {
  const s = String(text ?? '');
  return JSON.stringify(s.length > 60 ? `${s.slice(0, 60)}...` : s);
}

/** Fisher-Yates, as in run.mjs. `random` is injectable for deterministic tests. */
export function shuffled(n, random = Math.random) {
  const values = Array.from({ length: n }, (_, i) => i + 1);
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

/**
 * Topologies this file implements. `test/agents-topologies.test.mjs` compares it with
 * `TOPOLOGY_NAMES` from the cost model, so the projection and the implementation cannot
 * silently diverge again.
 */
export const IMPLEMENTED_TOPOLOGIES = ['solo', 'partitioned', 'hierarchical', 'shared-lock'];

/**
 * What went wrong inside a `solo` reply that did parse as integers. These are findings about
 * the model (or about the max_tokens ceiling the harness set), reported in `faults`; they are
 * not rejections, because the numbers were written and the oracle judges them.
 *
 *   truncated      stop_reason was max_tokens: the cap ended the reply, not the model.
 *   stopped-early  reply ended normally but the sequence stops short (1..k, k < N).
 *   dropped        numbers missing from inside the sequence.
 *   duplicated     a number emitted more than once.
 *   invented       a number outside 1..N.
 *   out-of-order   not ascending.
 */
export function diagnoseSolo(values, n, stopReason) {
  const faults = [];
  const add = (kind, detail) => faults.push({ agent: 'solo', kind, detail });
  const truncated = stopReason === 'max_tokens';

  const seen = new Map();
  for (const v of values) seen.set(v, (seen.get(v) ?? 0) + 1);
  const dup = [...seen].filter(([, c]) => c > 1).map(([v]) => v);
  const invented = values.filter((v) => v < 1 || v > n);
  if (dup.length > 0) add('duplicated', `emitted more than once: ${JSON.stringify(dup.slice(0, 10))}`);
  if (invented.length > 0) add('invented', `outside 1..${n}: ${JSON.stringify(invented.slice(0, 10))}`);
  for (let i = 1; i < values.length; i += 1) {
    if (values[i - 1] > values[i]) {
      add('out-of-order', `position ${i + 1}: ${values[i - 1]} then ${values[i]}`);
      break;
    }
  }

  const missing = [];
  for (let v = 1; v <= n; v += 1) if (!seen.has(v)) missing.push(v);
  if (truncated) {
    add('truncated', `stop_reason max_tokens after ${values.length} numbers; the ceiling ended the reply, not the model`);
  } else if (missing.length > 0) {
    const top = Math.max(0, ...values.filter((v) => v >= 1 && v <= n));
    const tailOnly = missing.every((v) => v > top);
    if (tailOnly) add('stopped-early', `reply ended normally after ${values.length} numbers (highest ${top}); ${missing.length} never emitted`);
    else add('dropped', `missing from inside the sequence: ${JSON.stringify(missing.slice(0, 10))}${missing.length > 10 ? ' ...' : ''}`);
  }
  return faults;
}

/** Run tasks with a ceiling on in-flight requests, so a hundred agents don't all hit at once. */
async function pooled(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= tasks.length) return;
        results[index] = await tasks[index]();
      }
    }),
  );

  return results;
}

/**
 * Run one experiment. `call(prompt, maxTokens)` is the model, injected: it returns a string,
 * or `{ text, inputTokens, outputTokens, stopReason }`. Tests pass scripted replies; the CLI
 * passes the Anthropic SDK or a `--mock` transport.
 */
export async function runAgents({
  topology,
  agents,
  call,
  file,
  concurrency = 20,
  numbers = shuffled(agents),
  now = Date.now,
  fanout = 10,
}) {
  if (!IMPLEMENTED_TOPOLOGIES.includes(topology)) {
    throw new Error(`Unknown topology: ${topology}`);
  }
  if (topology === 'hierarchical' && !(Number.isInteger(fanout) && fanout >= 2)) {
    throw new Error(`--fanout must be an integer >= 2, got ${fanout}`);
  }

  const usage = { input: 0, output: 0, calls: 0 };
  const rejected = []; // harness refused the reply
  const errored = []; // the call itself failed
  const faults = []; // solo only: what was wrong inside a reply that did parse (model findings)
  const participants = []; // hierarchical only: what each call was actually shown and returned
  let levels;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');

  /** One agent: returns the reply text, or null if the call failed (already recorded). */
  async function ask(agent, prompt, maxTokens) {
    let reply;
    try {
      reply = await call(prompt, maxTokens);
    } catch (error) {
      errored.push({ agent, error: String(error?.message ?? error) });
      return null;
    }
    usage.calls += 1;
    if (typeof reply === 'string') return { text: reply.trim() };
    usage.input += reply?.inputTokens ?? 0;
    usage.output += reply?.outputTokens ?? 0;
    return { text: String(reply?.text ?? '').trim(), stopReason: reply?.stopReason };
  }

  function reject(agent, reply, reason) {
    const stop = reply.stopReason && reply.stopReason !== 'end_turn' ? ` (stop_reason ${reply.stopReason})` : '';
    rejected.push({ agent, reply: reply.text, reason: reason + stop });
  }

  const started = now();

  if (topology === 'solo') {
    /*
     * One call emits all N numbers. The baseline every other topology is measured against, and
     * the place a model most plausibly drops, repeats or abandons a number. The reply is NOT
     * rejected for having the wrong count: whatever integers it contains are written, so the
     * oracle reports exactly what is wrong, and `faults` says which kind of wrong it is.
     * Only a reply with no integers at all is a rejection (nothing to write, nothing to guess).
     */
    const reply = await ask('solo', `Output every integer from 1 to ${agents} in ascending order, comma-separated. Nothing else.`, Math.max(64, agents * 6));
    if (reply !== null) {
      let values = extractIntegers(reply.text);
      if (values.length === 0) {
        reject('solo', reply, 'no integer in reply');
      } else {
        // A reply cut off by the cap may end mid-number ("...,4" for "...,45"): drop that one.
        if (reply.stopReason === 'max_tokens') values = values.slice(0, -1);
        faults.push(...diagnoseSolo(values, agents, reply.stopReason));
        fs.writeFileSync(file, values.join(','));
      }
    }
  } else if (topology === 'hierarchical') {
    /*
     * Same shape as src/strategies/hierarchical.mjs and the cost model: N leaf calls, then
     * ceil(count/fanout) mergers per level until one root remains. Leaves are grouped by
     * position. A merger is shown the numbers its children returned and must return them as one
     * ascending list; the code never sorts. The root reads and emits all N values, so nothing
     * here assumes "no participant sees more than fanout values": every call records how many
     * integers its prompt contained and its reply contained, and `levels` reports the maxima.
     */
    const record = (level, role, index, children, data, replyText) => {
      participants.push({
        level, role, index, children,
        valuesIn: extractIntegers(data).length,
        valuesOut: extractIntegers(replyText).length,
      });
    };

    const leafReplies = await pooled(
      numbers.map((n) => () => ask(n, `Output the number ${n}. Nothing else.`, 16)),
      concurrency,
    );
    let nodes = leafReplies.map((reply, i) => {
      if (reply === null) return { values: [] };
      record(0, 'leaf', i, 0, String(numbers[i]), reply.text);
      const parsed = parseSingle(reply.text);
      if (parsed.ok) return { values: [parsed.value] };
      reject(numbers[i], reply, parsed.reason);
      return { values: [] };
    });

    let level = 0;
    while (nodes.length > 1) {
      level += 1;
      const groups = [];
      for (let i = 0; i < nodes.length; i += fanout) groups.push(nodes.slice(i, i + fanout));
      const isRoot = groups.length === 1;
      const lvl = level;
      nodes = await pooled(
        groups.map((group, g) => async () => {
          const input = group.flatMap((node) => node.values);
          if (input.length === 0) return { values: [] }; // everything below already failed and was recorded
          const label = `${isRoot ? 'root' : 'merger'} L${lvl}.${g}`;
          const data = input.join(',');
          const reply = await ask(
            label,
            `Merge these numbers into one list in ascending order. Output the complete list, comma-separated, nothing else.\n${data}`,
            Math.max(64, input.length * 6),
          );
          if (reply === null) return { values: [] };
          record(lvl, isRoot ? 'root' : 'merger', g, group.length, data, reply.text);
          const parsed = parseList(reply.text, input.length);
          if (!parsed.ok) {
            reject(label, reply, `${parsed.reason}; the ${input.length} values it was given are dropped`);
            return { values: [] };
          }
          return { values: parsed.values };
        }),
        concurrency,
      );
    }
    fs.writeFileSync(file, nodes[0].values.join(','));

    levels = [];
    for (const p of participants) {
      let row = levels.find((l) => l.level === p.level);
      if (!row) {
        row = { level: p.level, role: p.role, participants: 0, maxChildren: 0, maxValuesIn: 0, maxValuesOut: 0 };
        levels.push(row);
      }
      row.participants += 1;
      row.maxChildren = Math.max(row.maxChildren, p.children);
      row.maxValuesIn = Math.max(row.maxValuesIn, p.valuesIn);
      row.maxValuesOut = Math.max(row.maxValuesOut, p.valuesOut);
    }
    levels.sort((a, b) => a.level - b.level);
  } else if (topology === 'partitioned') {
    /*
     * Every agent emits only its own number, in parallel, and code merges. Each call carries
     * O(1) context — which is the entire cost argument for this topology.
     *
     * The agents are not doing the sorting here. The merge is, and the merge is a sort.
     */
    const replies = await pooled(
      numbers.map((n) => () => ask(n, `Output the number ${n}. Nothing else.`, 16)),
      concurrency,
    );

    const accepted = [];
    replies.forEach((reply, i) => {
      if (reply === null) return;
      const parsed = parseSingle(reply.text);
      if (parsed.ok) accepted.push(parsed.value);
      else reject(numbers[i], reply, parsed.reason);
    });

    fs.writeFileSync(file, accepted.sort((a, b) => a - b).join(','));
  } else {
    /*
     * Each agent sees the current file and returns the whole thing with its number inserted.
     * Serial by construction, and context grows as the run proceeds — O(N²) tokens overall.
     *
     * This is where model-specific failures show up: a reformatted list, a dropped number, a
     * helpful explanation wrapped around the answer. A reply the harness cannot parse into
     * exactly the expected count leaves the file untouched, so one bad agent doesn't poison
     * every agent after it.
     */
    for (const n of numbers) {
      const current = fs.readFileSync(file, 'utf8').trim();
      const have = current === '' ? 0 : current.split(',').length;
      const reply = await ask(
        n,
        current === ''
          ? `Output exactly: ${n}`
          : `Here is a sorted comma-separated list:\n${current}\n\n` +
              `Insert ${n} into the correct position. Output the complete new list, ` +
              `comma-separated, nothing else.`,
        Math.max(64, agents * 6),
      );
      if (reply === null) continue;

      const parsed = parseList(reply.text, have + 1);
      if (!parsed.ok) {
        reject(n, reply, parsed.reason);
        continue;
      }
      fs.writeFileSync(file, parsed.values.join(','));
    }
  }

  const elapsed = (now() - started) / 1000;
  const result = verify(file, Array.from({ length: agents }, (_, i) => i + 1));
  const ok = result.ok && rejected.length === 0 && errored.length === 0;
  return { ok, oracle: result, usage, rejected, errored, faults, participants, levels, elapsed };
}

/* ------------------------------ transports ------------------------------------------- */

/**
 * Scripted stand-ins for the model, selected with `--mock`. They read the prompt, so they know
 * the "right" answer, and then misformat it in one specific way. No tokens are counted.
 */
export function mockTransport(mode) {
  const modes = new Set(['clean', 'prose', 'newline', 'empty']);
  if (!modes.has(mode)) throw new Error(`Unknown --mock mode: ${mode} (clean|prose|newline|empty)`);

  return async (prompt) => {
    if (mode === 'empty') return '';
    const insert = prompt.match(/Insert (-?\d+) into/);
    const solo = prompt.match(/^Output every integer from 1 to (\d+)/);
    let values;
    if (solo) {
      values = Array.from({ length: Number(solo[1]) }, (_, i) => i + 1);
    } else if (prompt.startsWith('Merge these numbers')) {
      values = prompt.split('\n')[1].split(',').map(Number).sort((a, b) => a - b);
    } else if (insert) {
      const list = prompt.split('\n')[1].split(',').map(Number);
      values = [...list, Number(insert[1])].sort((a, b) => a - b);
    } else {
      values = [Number(prompt.match(/-?\d+/)[0])];
    }
    if (mode === 'newline') return values.join('\n');
    if (mode === 'prose') return `Sure, here is the result: ${values.join(',')}. Hope that helps!`;
    return values.join(',');
  };
}

/** The real thing. Throws a clear error if the SDK is not installed. */
export async function anthropicTransport(model) {
  let Anthropic;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error('@anthropic-ai/sdk is not installed. Run `npm install` and retry.');
    }
    throw error;
  }
  const client = new Anthropic();

  /*
   * `max_tokens` is deliberately small. The task is to emit a few characters, and a large
   * ceiling on a trivial task is an invitation to explain itself at length — which costs
   * output tokens at five times the input rate.
   */
  return async (prompt, maxTokens = 512) => {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = response.content.find((b) => b.type === 'text');
    return {
      text: block?.text ?? '',
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      stopReason: response.stop_reason,
    };
  };
}

/* ---------------------------------- CLI ---------------------------------------------- */

export function report({ topology, model, agents, outcome, fanout }) {
  const { usage, oracle, rejected, errored, elapsed } = outcome;
  const price = PRICE[model] ?? { input: 0, output: 0 };
  const cost = (usage.input / 1e6) * price.input + (usage.output / 1e6) * price.output;
  const lines = [
    `\n${topology}   ${model}   ${agents} agents${fanout !== undefined ? `   fanout ${fanout}` : ''}`,
    `calls    ${usage.calls}`,
    `tokens   ${usage.input} in / ${usage.output} out`,
    `cost     $${cost.toFixed(4)}   ($${(cost / agents).toFixed(5)} per agent)`,
    `time     ${elapsed.toFixed(1)}s`,
    `result   ${outcome.ok ? 'PASS' : 'FAIL'}`,
  ];
  if (outcome.levels) {
    lines.push('what each level was shown (integers in prompt / in reply, measured per call):');
    for (const l of outcome.levels) {
      lines.push(`  L${l.level} ${l.role.padEnd(6)} x${String(l.participants).padEnd(4)} max children ${String(l.maxChildren).padEnd(3)} max in ${String(l.maxValuesIn).padEnd(5)} max out ${l.maxValuesOut}`);
    }
  }
  if (outcome.faults?.length > 0) {
    lines.push('model/ceiling findings inside replies that were parsed and written:');
    for (const f of outcome.faults) lines.push(`  ${f.agent}: ${f.kind} — ${f.detail}`);
  }
  if (rejected.length > 0) {
    lines.push(`harness rejected ${rejected.length} repl${rejected.length === 1 ? 'y' : 'ies'} (not written; oracle "missing" below follows from these):`);
    for (const r of rejected) lines.push(`  agent ${r.agent} returned ${describe(r.reply)} — harness rejected it: ${r.reason}`);
  }
  if (errored.length > 0) {
    lines.push(`${errored.length} call(s) failed before any reply (transport, not model or parser):`);
    for (const e of errored) lines.push(`  agent ${e.agent}: ${e.error}`);
  }
  if (oracle.failures.length > 0) {
    lines.push('oracle:');
    for (const f of oracle.failures) lines.push(`  ${f}`);
  }
  return lines.join('\n');
}

async function main(argv) {
  warnIfPricingStale();
  const arg = (flag, fallback) => {
    const index = argv.indexOf(`--${flag}`);
    return index === -1 ? fallback : argv[index + 1];
  };

  const agents = Number(arg('agents', 10));
  const modelName = arg('model', 'haiku');
  const model = MODELS[modelName] ?? modelName;
  const topology = arg('topology', 'partitioned');
  const concurrency = Number(arg('concurrency', 20));
  const mock = arg('mock', undefined);
  const file = arg('out', path.join(root, 'runs', `agents-${topology}-${agents}.txt`));

  const fanout = Number(arg('fanout', 10));

  if (!IMPLEMENTED_TOPOLOGIES.includes(topology)) {
    console.error(`Unknown topology: ${topology}`);
    return 2;
  }
  if (topology === 'hierarchical' && !(Number.isInteger(fanout) && fanout >= 2)) {
    console.error(`--fanout must be an integer >= 2, got ${arg('fanout')}`);
    return 2;
  }

  let call;
  if (mock !== undefined) {
    try {
      call = mockTransport(mock);
    } catch (error) {
      console.error(error.message);
      return 2;
    }
  } else {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      console.error('No credentials. Export ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) and retry.');
      return 2;
    }
    try {
      call = await anthropicTransport(model);
    } catch (error) {
      console.error(error.message);
      return 2;
    }
  }

  const outcome = await runAgents({ topology, agents, call, file, concurrency, fanout });
  console.log(report({
    topology, model: mock !== undefined ? `mock:${mock}` : model, agents, outcome,
    fanout: topology === 'hierarchical' ? fanout : undefined,
  }));
  return outcome.ok ? 0 : 1;
}

// Compare as URLs so paths containing a space still match (same approach as verify.mjs).
function isMain() {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return pathToFileURL(process.argv[1]).href === import.meta.url;
  }
}

if (isMain()) process.exit(await main(process.argv.slice(2)));
