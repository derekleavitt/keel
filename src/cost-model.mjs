#!/usr/bin/env node
/**
 * What N agents would cost, and how long they'd take, before you spend anything.
 *
 *   node src/cost-model.mjs --agents 100
 *   node src/cost-model.mjs --agents 100 --model haiku --verbose
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
import process from 'node:process';

/** Published per-million-token rates. Input, output. */
const MODELS = {
  opus: { id: 'claude-opus-5', input: 5.0, output: 25.0 },
  sonnet: { id: 'claude-sonnet-5', input: 2.0, output: 10.0 },
  haiku: { id: 'claude-haiku-4-5', input: 1.0, output: 5.0 },
};

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
    rounds: 1,
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
    rounds: n,
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
    rounds: 1,
  }),

  /**
   * Agents in groups of `fanout`, each group merged by an agent, then merged again.
   *
   * The interesting middle: agents still do the merging, so it isn't a code shortcut, but no
   * agent sees more than `fanout` numbers. Cost is O(N) with a constant, and rounds are
   * logarithmic rather than linear.
   */
  hierarchical: (n, fanout = 10) => {
    const groups = Math.ceil(n / fanout);
    return {
      calls: n + groups + 1,
      inputPerCall: (i) => (i < n ? 0 : fanout * TOKENS_PER_NUMBER),
      outputPerCall: (i) => (i < n ? TOKENS_PER_NUMBER : fanout * TOKENS_PER_NUMBER),
      rounds: 1 + Math.ceil(Math.log(n) / Math.log(fanout)),
    };
  },
};

/** Round-trip latency for one call, in seconds. A rough constant; measure and replace it. */
const LATENCY = { api: 1.5, 'claude-code': 8 };

export function project({ agents, model = 'haiku', kind = 'api', topology = 'partitioned' }) {
  const price = MODELS[model];
  const overhead = OVERHEAD[kind];
  const shape = TOPOLOGIES[topology](agents);

  let input = 0;
  let output = 0;
  for (let i = 0; i < shape.calls; i += 1) {
    input += overhead + shape.inputPerCall(i);
    output += shape.outputPerCall(i);
  }

  const cost = (input / 1_000_000) * price.input + (output / 1_000_000) * price.output;

  /*
   * Wall-clock assumes calls inside a round are fully concurrent. Real runs hit rate limits
   * and connection caps, so treat this as a floor.
   */
  const seconds = shape.rounds * LATENCY[kind];

  return { topology, model: price.id, kind, agents, calls: shape.calls, input, output, cost, seconds };
}

function arg(flag, fallback) {
  const index = process.argv.indexOf(`--${flag}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const agents = Number(arg('agents', 100));
  const model = arg('model', 'haiku');

  console.log(`\nProjected cost for ${agents} agents contributing 1..${agents}`);
  console.log(`model: ${MODELS[model].id}   (projection, not measurement)\n`);

  const rows = [];
  for (const kind of ['api', 'claude-code']) {
    for (const topology of Object.keys(TOPOLOGIES)) {
      rows.push(project({ agents, model, kind, topology }));
    }
  }

  console.log('kind          topology       calls    tokens in   tokens out       cost     ~time');
  console.log('─'.repeat(84));
  for (const r of rows) {
    console.log(
      `${r.kind.padEnd(13)} ${r.topology.padEnd(14)} ${String(r.calls).padStart(5)}  ${String(r.input).padStart(11)}  ${String(Math.round(r.output)).padStart(11)}   ${`$${r.cost.toFixed(4)}`.padStart(9)}  ${`${r.seconds}s`.padStart(8)}`,
    );
  }

  const solo = rows.find((r) => r.kind === 'api' && r.topology === 'solo');
  const shared = rows.find((r) => r.kind === 'api' && r.topology === 'shared-lock');
  console.log(
    `\nshared-lock costs ${(shared.cost / solo.cost).toFixed(0)}x what one agent costs, and takes ${(shared.seconds / solo.seconds).toFixed(0)}x as long.`,
  );
  console.log('Distribution is a latency tool. It is never a cost saving.\n');
}
