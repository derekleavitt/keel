#!/usr/bin/env node
/**
 * What N agents would cost, and how long they'd take, before you spend anything.
 *
 *   node src/cost-model.mjs --agents 100
 *   node src/cost-model.mjs --agents 100 --model haiku --verbose
 *
 * --verbose adds one line under each row: the fixed overhead per call, the average input and
 * output per call, and the number of sequential rounds the time figure is built from.
 *
 * These are projections, not measurements. Every number here comes from published per-token
 * pricing and an explicit token estimate, and it is labelled that way on purpose — the point
 * is to decide whether a run is worth paying for, then compare the real numbers against it.
 *
 * ## The finding this exists to make visible
 *
 * Topology decides token cost, not just wall-clock. An agent that has to see the current
 * state carries O(N) tokens of context; an agent that only needs its own input carries O(1).
 * Across N agents that's the difference between O(N²) and O(N) total tokens — so the
 * coordination strategy is a cost decision before it's ever a correctness one.
 */
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { MODELS, warnIfPricingStale } from './pricing.mjs';

/**
 * Fixed prompt overhead per agent call, in tokens.
 *
 * A bare API call carries a short instruction and little else. A Claude Code agent carries a
 * system prompt, tool definitions and any project instructions before it reads a single line
 * of the task — which is why the same job costs two orders of magnitude more as a coding
 * agent than as an API call, and why "how many agents" has no answer without saying what an
 * agent is.
 */
const OVERHEAD = {
  api: 200,
  'claude-code': 15_000,
};

/** Digits plus a comma, tokenised. Close enough for a projection; real runs will differ. */
const TOKENS_PER_NUMBER = 2.5;

/**
 * Generation speed, output tokens per second. An assumption, not a measurement: it is what
 * makes a call's duration depend on the work it does. A model that must emit N numbers cannot
 * do so in constant time, and without this term no topology could ever beat `solo` on time.
 */
const OUTPUT_TOKENS_PER_SECOND = 100;

/**
 * How much context each agent needs, and how many rounds the work takes.
 *
 * `rounds` is what turns into wall-clock: agents inside one round run concurrently, rounds
 * run one after another.
 */
const TOPOLOGIES = {
  /**
   * One agent does the whole job. The baseline that most distribution proposals lose to, and
   * the one people skip measuring.
   */
  solo: (n) => ({
    calls: 1,
    inputPerCall: (i) => 0,
    outputPerCall: (i) => n * TOKENS_PER_NUMBER,
    roundOutputs: [n * TOKENS_PER_NUMBER],
    // One agent does every unit of work itself, so its work is n times one agent's.
    workPerCall: () => n,
    workRounds: [n],
  }),

  /**
   * N agents, each reading the current file and inserting into it. Correctness needs a lock,
   * and the lock makes it serial — so this is the worst of both: N spin-ups *and* N rounds.
   *
   * The kth agent reads k-1 numbers and writes k, so context grows as the run proceeds and
   * total tokens land at O(N²).
   */
  'shared-lock': (n) => ({
    calls: n,
    inputPerCall: (i) => i * TOKENS_PER_NUMBER,
    outputPerCall: (i) => (i + 1) * TOKENS_PER_NUMBER,
    // One call per round, so each round's longest call is that call: round i writes i+1 numbers.
    roundOutputs: Array.from({ length: n }, (_, i) => (i + 1) * TOKENS_PER_NUMBER),
    workPerCall: () => 1,
    workRounds: Array.from({ length: n }, () => 1),
  }),

  /**
   * N agents that never see shared state — each emits only its own number, and a coordinator
   * merges. No contention, so one round, and every agent carries O(1) context.
   *
   * The catch is that the agents aren't doing the sorting any more. The merge is, and the
   * merge is ordinary code. Worth being honest that this wins partly by removing the work
   * from the agents.
   */
  partitioned: (n) => ({
    calls: n,
    inputPerCall: () => 0,
    outputPerCall: () => TOKENS_PER_NUMBER,
    roundOutputs: [TOKENS_PER_NUMBER],
    workPerCall: () => 1,
    workRounds: [1],
  }),

  /**
   * Agents in groups of `fanout`, each group merged by an agent, then those merged by
   * further agents, until one root merger holds everything.
   *
   * Level 0 is N leaf agents holding one number each. Each later level has ceil(count/fanout)
   * mergers; a merger reads the numbers its children produced and writes the merged run, so
   * its input and output are both (numbers under it) x TOKENS_PER_NUMBER. Every merger sees at
   * most `fanout` children, but a merger at height h covers up to fanout^h numbers, and the
   * root reads all N. There are ceil(log_fanout N) merge levels and every level handles all N
   * numbers once, so total tokens are O(N log_fanout N), not O(N). What stays small is the
   * number of children per agent, not the number of tokens.
   */
  hierarchical: (n, fanout = 10) => {
    const merger = []; // numbers covered by each merger, in call order, after the n leaves
    const roundOutputs = [TOKENS_PER_NUMBER]; // longest call in each round
    let covered = Array.from({ length: n }, () => 1); // numbers under each node of the level below
    while (covered.length > 1) {
      const next = [];
      for (let i = 0; i < covered.length; i += fanout) {
        next.push(covered.slice(i, i + fanout).reduce((a, b) => a + b, 0));
      }
      merger.push(...next);
      roundOutputs.push(Math.max(...next) * TOKENS_PER_NUMBER);
      covered = next;
    }
    return {
      calls: n + merger.length,
      inputPerCall: (i) => (i < n ? 0 : merger[i - n] * TOKENS_PER_NUMBER),
      outputPerCall: (i) => (i < n ? TOKENS_PER_NUMBER : merger[i - n] * TOKENS_PER_NUMBER),
      roundOutputs,
      // Only the leaves do the real work; mergers just merge, and their cost is topology overhead.
      workPerCall: (i) => (i < n ? 1 : 0),
      workRounds: roundOutputs.map((_, k) => (k === 0 ? 1 : 0)),
    };
  },
};

/** Fixed round-trip latency per call (connection, queueing, time to first token), seconds. */
const LATENCY = { api: 1.5, 'claude-code': 8 };

export const TOPOLOGY_NAMES = Object.keys(TOPOLOGIES);
export const MODEL_NAMES = Object.keys(MODELS);
export const KIND_NAMES = Object.keys(OVERHEAD);

function lookup(table, key, what) {
  if (typeof key !== 'string' || !Object.hasOwn(table, key)) {
    throw new Error(`unknown ${what} ${JSON.stringify(key)}; valid ${what}s: ${Object.keys(table).join(', ')}`);
  }
  return table[key];
}

/**
 * `work` is the real work one agent's share of the job takes, in input+output tokens, split
 * evenly between input (read) and output (generated). Total work is agents x work in every
 * topology; what differs is who does it. `solo` does all of it in one call, so its time grows
 * with agents x work; distributed topologies do `work` per agent, concurrently where they can.
 * Merge steps that are agents add no work of their own.
 */
export function project({ agents, model = 'haiku', kind = 'api', topology = 'partitioned', work = 0 }) {
  if (typeof work !== 'number' || !Number.isFinite(work) || work < 0) {
    throw new Error(`invalid work ${JSON.stringify(work)}; must be a non-negative number of tokens`);
  }
  if (!Number.isInteger(agents) || agents < 1) {
    throw new Error(`invalid agents ${JSON.stringify(agents)}; must be a positive integer`);
  }
  const price = lookup(MODELS, model, 'model');
  const overhead = lookup(OVERHEAD, kind, 'kind');
  const latency = LATENCY[kind];
  const shape = lookup(TOPOLOGIES, topology, 'topology')(agents);

  let rawInput = 0;
  let rawOutput = 0;
  for (let i = 0; i < shape.calls; i += 1) {
    const units = shape.workPerCall(i);
    rawInput += overhead + shape.inputPerCall(i) + (work / 2) * units;
    rawOutput += shape.outputPerCall(i) + (work / 2) * units;
  }

  /*
   * Round to whole tokens. TOKENS_PER_NUMBER is 2.5, so odd N produces half tokens (1452.5)
   * that no tokenizer or invoice can report. Rounding the totals, not each call, keeps the
   * error under half a token, and the cost is computed from the rounded figures so every
   * dollar amount can be reproduced by hand from the printed token counts.
   */
  const input = Math.round(rawInput);
  const output = Math.round(rawOutput);

  const cost = (input / 1_000_000) * price.input + (output / 1_000_000) * price.output;

  /*
   * Wall-clock is the sum over rounds of that round's slowest call. A call takes fixed latency
   * plus the time to generate its output, so duration scales with the tokens the call emits.
   * Calls inside a round are assumed fully concurrent; real runs hit rate limits and
   * connection caps, so treat this as a floor. Input prefill time is ignored.
   */
  const rounds = shape.roundOutputs.length;
  const seconds = shape.roundOutputs.reduce(
    (sum, out, k) => sum + latency + (out + (work / 2) * shape.workRounds[k]) / OUTPUT_TOKENS_PER_SECOND,
    0,
  );

  return { topology, model: price.id, kind, agents, calls: shape.calls, input, output, cost, seconds, rounds, overhead, work };
}

/** Upper end of the crossover sweep, tokens of work per agent. */
export const MAX_SWEEP_WORK = 1_000_000;

/** The work values a sweep visits: 0, then powers of ten with 2x and 5x steps, up to the max. */
export const SWEEP_WORKS = [0, ...[1, 10, 100, 1000, 10_000, 100_000].flatMap((d) => [d, 2 * d, 5 * d]), MAX_SWEEP_WORK];

/**
 * For each non-solo topology, the smallest whole number of work tokens per agent at which its
 * projected seconds fall below solo's, or null if none does by MAX_SWEEP_WORK. Solo's time
 * grows faster in work than any distributed topology's whenever agents > 1, so the gap only
 * widens and bisection is valid.
 */
export function crossover({ agents, model = 'haiku', kind = 'api' }) {
  const secs = (topology, work) => project({ agents, model, kind, topology, work }).seconds;
  return TOPOLOGY_NAMES.filter((t) => t !== 'solo').map((topology) => {
    const wins = (w) => secs(topology, w) < secs('solo', w);
    let at = null;
    if (wins(MAX_SWEEP_WORK)) {
      let lo = 0;
      let hi = MAX_SWEEP_WORK;
      if (wins(0)) hi = 0;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (wins(mid)) hi = mid;
        else lo = mid + 1;
      }
      at = hi;
    }
    return { topology, kind, at, timeAtZero: secs(topology, 0), soloAtZero: secs('solo', 0) };
  });
}

const CROSSOVER_NOTES = {
  partitioned: 'merge is ordinary code, not an agent: not timed or priced here. The only topology whose time can fall.',
  hierarchical: 'root agent must still read and emit all N values, so it carries a generation floor solo does not pay twice.',
  'shared-lock': 'N serial rounds each add latency; solo pays the same work once. Never catches up.',
};

function runCrossover(agents, model) {
  console.log(`\nCrossover for ${agents} agents, model ${MODELS[model].id}   (projection, not measurement)`);
  console.log(`work = input+output tokens of real work per agent; swept 0..${MAX_SWEEP_WORK}\n`);
  let violations = 0;
  for (const kind of KIND_NAMES) {
    console.log(`kind: ${kind}`);
    for (const c of crossover({ agents, model, kind })) {
      console.log(
        c.at === null
          ? `  ${c.topology} beats solo on time: never within sweep`
          : `  ${c.topology} beats solo on time at work >= ${c.at}`,
      );
      console.log(`      ${CROSSOVER_NOTES[c.topology]}`);
    }
    console.log('\n  work/agent  ' + TOPOLOGY_NAMES.map((t) => t.padStart(13)).join(' '));
    for (const work of SWEEP_WORKS) {
      const rows = TOPOLOGY_NAMES.map((topology) => project({ agents, model, kind, topology, work }));
      const solo = rows[0];
      for (const r of rows) if (r.cost < solo.cost) violations += 1;
      if ([0, 10, 100, 1000, 10_000, 100_000, MAX_SWEEP_WORK].includes(work)) {
        console.log(`  ${String(work).padStart(10)}  ` + rows.map((r) => formatSeconds(r.seconds).padStart(13)).join(' '));
      }
    }
    console.log('');
  }
  console.log(
    violations === 0
      ? `Cost check: every topology cost >= solo at all ${SWEEP_WORKS.length} sweep points. Distribution is still not a cost saving.\n`
      : `!!! COST CLAIM VIOLATED at ${violations} sweep point(s): a topology cost LESS than solo. This is a finding, not a bug in the check.\n`,
  );
  return violations;
}

function arg(flag, fallback) {
  const index = process.argv.indexOf(`--${flag}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function formatSeconds(s) {
  return s < 100 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
}

export function run() {
  const agents = Number(arg('agents', 100));
  const model = arg('model', 'haiku');
  const verbose = process.argv.includes('--verbose');
  const work = Number(arg('work', 0));
  if (process.argv.includes('--crossover')) {
    lookup(MODELS, model, 'model');
    runCrossover(agents, model);
    return;
  }

  const rows = [];
  for (const kind of KIND_NAMES) {
    for (const topology of TOPOLOGY_NAMES) {
      rows.push(project({ agents, model, kind, topology, work }));
    }
  }

  console.log(`\nProjected cost for ${agents} agents contributing 1..${agents}`);
  console.log(`model: ${rows[0].model}   (projection, not measurement)${work > 0 ? `   work: ${work} tokens/agent` : ''}\n`);

  console.log('kind          topology       calls    tokens in   tokens out       cost     ~time');
  console.log('─'.repeat(84));
  for (const r of rows) {
    console.log(
      `${r.kind.padEnd(13)} ${r.topology.padEnd(14)} ${String(r.calls).padStart(5)}  ${String(r.input).padStart(11)}  ${String(r.output).padStart(11)}   ${`$${r.cost.toFixed(4)}`.padStart(9)}  ${formatSeconds(r.seconds).padStart(8)}`,
    );
    if (verbose) {
      console.log(
        `    overhead ${r.overhead}/call, avg ${Math.round(r.input / r.calls)} in / ${Math.round(r.output / r.calls)} out per call, ${r.rounds} rounds`,
      );
    }
  }

  const solo = rows.find((r) => r.kind === 'api' && r.topology === 'solo');
  const shared = rows.find((r) => r.kind === 'api' && r.topology === 'shared-lock');
  console.log(
    `\nshared-lock costs ${(shared.cost / solo.cost).toFixed(0)}x what one agent costs, and takes ${(shared.seconds / solo.seconds).toFixed(0)}x as long.`,
  );
  console.log('Distribution is a latency tool. It is never a cost saving.\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  warnIfPricingStale();
  try {
    run();
  } catch (err) {
    console.error(`cost-model: ${err.message}`);
    process.exit(2);
  }
}
