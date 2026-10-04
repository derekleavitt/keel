#!/usr/bin/env node
/**
 * Compare a recorded run against the cost model's assumptions.
 *
 *   node src/compare.mjs <record.jsonl>           one line per assumption, then totals
 *   node src/compare.mjs <record.jsonl> --json    the compare() result as JSON, nothing else
 *
 * `record.jsonl` is what `node src/agents.mjs ... --record <file>` writes: one line per call,
 * then a summary line. This file only reads; it changes no constant, no record, no source.
 * When a real record exists, this output is what the constants in cost-model.mjs get
 * adjusted from.
 *
 * ## What it can and cannot tell you
 *
 * - A record from `--mock` is REFUSED. Its tokens are zero by construction, and its model
 *   label exists only on the summary line, so the summary is read first. Fitting it would
 *   produce confident, wrong constants.
 * - A record whose calls all emit about the same number of tokens (any partitioned run) has
 *   no slope to fit. `outputTokensPerSecond` is then reported as not identifiable, not as a
 *   number. The intercept is reported only as an upper bound on LATENCY.
 * - Calls are not streamed, so `ms` = latency + prefill (input tokens) + generation (output
 *   tokens). When the record has enough independent variation in inputTokens, ms is fitted
 *   on both (two-variable fit) and `latencyMs` is the true intercept. When it does not, ms is
 *   fitted on outputTokens alone and `latencyMs` silently includes prefill; the note says so.
 * - `ms` includes SDK retries and there is no field that marks them. After the first fit,
 *   calls whose residual is far above the rest (more than 3 robust sigmas, and at least
 *   250 ms) are dropped as suspected retries and the fit is repeated once, at most 10% of
 *   points. Their count is reported. Calls with stopReason `max_tokens` are excluded from
 *   every fit (their output is capped, not chosen), and errored and rejected calls are
 *   excluded (only `accepted` calls are used).
 * - Only the four keys of ASSUMPTIONS can be checked. The structural assumptions (the 50/50
 *   work split, ignored prefill time, the untimed partitioned merge) are not keys, and a
 *   record cannot confirm them; they are listed under `unchecked` in every result.
 * - One synthetic fixture can validate the arithmetic here, never a constant. Fixture files
 *   mark themselves with a `# SYNTHETIC` comment line, which this reader reports.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ASSUMPTIONS, project } from './cost-model.mjs';
import { MODELS } from './pricing.mjs';

export class CompareError extends Error {}

const LIST_ROLES = new Set(['merger', 'root', 'shared', 'solo']);
const MIN_DISTINCT_OUTPUTS = 3;
/** Above this |correlation| between inputTokens and outputTokens, the two cannot be separated. */
const COLLINEAR = 0.98;
const RETRY_FLOOR_MS = 250;
const MAX_DROP_FRACTION = 0.1;

export const UNCHECKED = Object.freeze([
  'work split 50/50 between input and output: a record has no `work` field, so it cannot be checked',
  'input prefill time ignored by project(): checked only through prefillMsPerInputToken, and only when the fit can separate it',
  'partitioned merge is untimed and unpriced: a record holds agent calls only, so merge cost is invisible',
  'OVERHEAD["claude-code"] and LATENCY["claude-code"]: --record is written by the API harness, so only the api kind is measurable',
]);

function median(xs) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const ratioOf = (measured, assumed) =>
  Number.isFinite(measured) && Number.isFinite(assumed) && assumed !== 0 ? measured / assumed : null;

/** Least squares of y on the columns of X (with an intercept column prepended). Null if singular. */
function ols(columns, y) {
  const n = y.length;
  const k = columns.length + 1;
  const X = y.map((_, r) => [1, ...columns.map((c) => c[r])]);
  const A = Array.from({ length: k }, (_, i) =>
    Array.from({ length: k + 1 }, (_, j) => {
      let s = 0;
      for (let r = 0; r < n; r += 1) s += X[r][i] * (j < k ? X[r][j] : y[r]);
      return s;
    }),
  );
  for (let c = 0; c < k; c += 1) {
    let p = c;
    for (let r = c + 1; r < k; r += 1) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-9) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < k; r += 1) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let j = c; j <= k; j += 1) A[r][j] -= f * A[c][j];
    }
  }
  const beta = A.map((row, i) => row[k] / row[i]);
  const residuals = y.map((v, r) => v - X[r].reduce((s, x, i) => s + x * beta[i], 0));
  return { beta, residuals };
}

function correlation(a, b) {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i += 1) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return saa === 0 || sbb === 0 ? 0 : sab / Math.sqrt(saa * sbb);
}

/**
 * ms against outputTokens (and inputTokens when separable). Returns what was fitted, how, and
 * which assumptions it identifies; never a slope it cannot support.
 */
function fitTiming(points) {
  const out = { n: points.length, dropped: 0, method: null, latencyMs: null, msPerOutputToken: null, msPerInputToken: null, reasons: {} };
  const distinct = new Set(points.map((p) => p.out)).size;
  if (points.length === 0) {
    out.reasons.latency = out.reasons.slope = out.reasons.prefill = 'no accepted calls with tokens to fit';
    return out;
  }
  if (distinct < MIN_DISTINCT_OUTPUTS) {
    // Degenerate: every call is about the same size, so ms has one level and no slope.
    // The level is latency + prefill + generation of those few tokens, an upper bound on LATENCY.
    out.method = 'level only (degenerate: no slope)';
    out.level = median(points.map((p) => p.ms));
    out.reasons.slope = `degenerate: ${distinct} distinct outputTokens value(s) in ${points.length} calls, need ${MIN_DISTINCT_OUTPUTS}; the slope is not identifiable from this record`;
    out.reasons.latency = `median ms of calls at ${[...new Set(points.map((p) => p.out))].join('/')} output tokens: an upper bound on LATENCY (still contains prefill and generation time that cannot be subtracted without a slope)`;
    out.reasons.prefill = 'not identifiable: no slope to separate it from';
    return out;
  }

  const attempt = (pts) => {
    const outs = pts.map((p) => p.out);
    const ins = pts.map((p) => p.inp);
    const ms = pts.map((p) => p.ms);
    const twoVar = new Set(ins).size >= 2 && Math.abs(correlation(ins, outs)) < COLLINEAR;
    const f = (twoVar && ols([outs, ins], ms)) || null;
    if (f) return { ...f, twoVar: true };
    const g = ols([outs], ms);
    return g ? { ...g, twoVar: false } : null;
  };

  let used = points;
  let fit = attempt(used);
  if (!fit) {
    out.reasons.latency = out.reasons.slope = out.reasons.prefill = 'least-squares system is singular';
    return out;
  }
  // Suspected retries: positive outliers only, since a retry only ever adds time.
  const absRes = fit.residuals.map(Math.abs);
  const sigma = 1.4826 * median(absRes);
  const cut = Math.max(3 * sigma, RETRY_FLOOR_MS);
  const order = fit.residuals.map((r, i) => [r, i]).filter(([r]) => r > cut).sort((a, b) => b[0] - a[0]);
  const drop = new Set(order.slice(0, Math.floor(points.length * MAX_DROP_FRACTION)).map(([, i]) => i));
  if (drop.size > 0) {
    const kept = points.filter((_, i) => !drop.has(i));
    if (new Set(kept.map((p) => p.out)).size >= MIN_DISTINCT_OUTPUTS) {
      const refit = attempt(kept);
      if (refit) {
        used = kept;
        fit = refit;
        out.dropped = drop.size;
      }
    }
  }
  out.n = used.length;
  out.method = fit.twoVar
    ? 'ms ~ latency + a*outputTokens + b*inputTokens (two-variable: prefill separated)'
    : 'ms ~ latency + a*outputTokens (one-variable: prefill is folded into the intercept)';
  out.latencyMs = fit.beta[0];
  out.msPerOutputToken = fit.beta[1];
  if (fit.twoVar) out.msPerInputToken = fit.beta[2];
  else out.reasons.prefill = 'not identifiable: inputTokens is constant or collinear with outputTokens in this record, so prefill is part of latencyMs';
  if (!(out.msPerOutputToken > 0)) {
    out.reasons.slope = `fitted slope ${out.msPerOutputToken.toFixed(3)} ms/token is not positive: noise or retries dominate; no rate reported`;
    out.msPerOutputToken = null;
  }
  if (!fit.twoVar) out.reasons.latency = 'intercept of a one-variable fit: includes input prefill time, so it overstates pure LATENCY';
  return out;
}

/**
 * @param {object[]} records parsed call lines plus the summary line (T-015 format)
 * @returns {{assumptions, totals, projected, fit, warnings, unchecked, run}}
 */
export function compare(records) {
  if (!Array.isArray(records)) throw new CompareError('compare() needs the parsed array of record objects');
  // Summary first: the model label lives only there, and mock data must never reach a fit.
  const summary = records.find((r) => r && r.summary === true);
  if (!summary) throw new CompareError('no summary line (a line with "summary":true); is this a --record file?');
  if (typeof summary.model === 'string' && summary.model.startsWith('mock:')) {
    throw new CompareError(
      `record is from a mock run (model ${JSON.stringify(summary.model)}): its tokens are zero by construction and fitting it would produce confident, wrong constants. Record a real run.`,
    );
  }
  const calls = records.filter((r) => r && r.summary !== true);
  const warnings = [];
  if (calls.length !== summary.calls) warnings.push(`summary says ${summary.calls} calls but the record has ${calls.length} call lines`);

  const concurrency = summary.concurrency == null ? Infinity : summary.concurrency; // JSON turns Infinity into null
  const accepted = calls.filter((c) => c.outcome === 'accepted');
  const truncated = accepted.filter((c) => c.stopReason === 'max_tokens');
  const usable = accepted.filter((c) => c.stopReason !== 'max_tokens' && (c.inputTokens > 0 || c.outputTokens > 0));
  const zeroTokens = calls.every((c) => !(c.inputTokens > 0) && !(c.outputTokens > 0));
  if (truncated.length) warnings.push(`${truncated.length} call(s) hit max_tokens and were excluded from every fit`);
  if (calls.length - accepted.length) warnings.push(`${calls.length - accepted.length} rejected/errored call(s) excluded; only accepted calls are fitted`);

  const noTokens = 'zero tokens in every call line; nothing to measure';
  const A = (name, assumed, measured, note, status = measured === null ? 'not-identifiable' : 'measured') => ({
    name, assumed, measured, ratio: ratioOf(measured, assumed), note, status,
  });

  const leaves = usable.filter((c) => c.role === 'leaf');
  const lists = usable.filter((c) => LIST_ROLES.has(c.role) && c.valuesOut > 0);
  const singles = leaves.filter((c) => c.valuesOut > 0);

  const overhead = zeroTokens ? null : median(leaves.map((c) => c.inputTokens));
  const single = zeroTokens ? null : median(singles.map((c) => c.outputTokens / c.valuesOut));
  const listOut = lists.reduce((s, c) => s + c.outputTokens, 0);
  const listVals = lists.reduce((s, c) => s + c.valuesOut, 0);
  const list = zeroTokens || listVals === 0 ? null : listOut / listVals;

  const fit = zeroTokens
    ? fitTiming([])
    : fitTiming(usable.map((c) => ({ out: c.outputTokens, inp: c.inputTokens, ms: c.ms })));
  if (zeroTokens) fit.reasons.latency = fit.reasons.slope = fit.reasons.prefill = noTokens;
  if (fit.dropped) warnings.push(`${fit.dropped} call(s) dropped as suspected SDK retries (residual above 3 robust sigmas and 250 ms); ms has no retry field, so this is inference`);

  const latencyBound = fit.method?.startsWith('level only');
  const latencyMeasured = zeroTokens ? null : latencyBound ? fit.level : fit.latencyMs;
  const opsMeasured = fit.msPerOutputToken ? 1000 / fit.msPerOutputToken : null;

  const assumptions = [
    A('overhead.api', ASSUMPTIONS.OVERHEAD.api, overhead,
      zeroTokens ? noTokens
        : leaves.length === 0 ? 'no accepted leaf calls: not identifiable'
          : `median inputTokens of ${leaves.length} leaf calls: system prompt plus the one number shown, so it slightly overstates pure overhead`),
    A('tokensPerNumber.single', ASSUMPTIONS.TOKENS_PER_NUMBER, single,
      zeroTokens ? noTokens : singles.length === 0 ? 'no accepted leaf calls with a value out: not identifiable' : `median outputTokens/valuesOut of ${singles.length} leaf calls`),
    A('tokensPerNumber.list', ASSUMPTIONS.TOKENS_PER_NUMBER, list,
      zeroTokens ? noTokens : list === null ? 'no merger/root/shared/solo calls with values out (a partitioned run has none): not identifiable' : `outputTokens/valuesOut pooled over ${lists.length} merger/root/shared/solo calls`),
    A('latencyMs', ASSUMPTIONS.LATENCY.api * 1000, latencyMeasured,
      [fit.reasons.latency, fit.method && `fit: ${fit.method}, ${fit.n} calls`].filter(Boolean).join('; '),
      zeroTokens ? 'not-identifiable' : latencyBound || (fit.latencyMs !== null && !fit.method.includes('two-variable')) ? 'upper-bound' : 'measured'),
    A('outputTokensPerSecond', ASSUMPTIONS.OUTPUT_TOKENS_PER_SECOND, opsMeasured,
      fit.reasons.slope ?? `1000 / fitted ms per output token over ${fit.n} calls`),
    A('prefillMsPerInputToken', 0, fit.msPerInputToken,
      fit.reasons.prefill ?? 'coefficient on inputTokens; project() assumes prefill time is zero (ratio undefined against 0)'),
  ];

  // Totals. Cost is priced from pricing.mjs by the summary's model id, as report() does.
  const alias = Object.entries(MODELS).find(([, m]) => m.id === summary.model)?.[0];
  const rate = alias ? MODELS[alias] : null;
  const costUsd = rate
    ? (summary.inputTokens / 1e6) * rate.input + (summary.outputTokens / 1e6) * rate.output
    : summary.costUsd ?? null;
  if (rate && Number.isFinite(summary.costUsd) && Math.abs(summary.costUsd - costUsd) > 1e-9 + 1e-6 * costUsd) {
    warnings.push(`summary costUsd ${summary.costUsd} differs from the price recomputed from pricing.mjs (${costUsd}); using the recomputed value`);
  }
  const totals = { input: summary.inputTokens, output: summary.outputTokens, costUsd, seconds: summary.elapsedMs / 1000 };

  let projected = { input: null, output: null, cost: null, seconds: null };
  if (!alias) {
    warnings.push(`model ${JSON.stringify(summary.model)} is not in pricing.mjs; no projection`);
  } else {
    try {
      const p = project({ agents: summary.agents, topology: summary.topology, model: alias, kind: 'api', concurrency });
      projected = { input: p.input, output: p.output, cost: p.cost, seconds: p.seconds };
    } catch (error) {
      warnings.push(`could not project this run: ${error.message}`);
    }
    if (summary.topology === 'hierarchical' && summary.fanout !== 10) {
      warnings.push(`project() has no fanout parameter and projects hierarchical at its default fanout 10; this run used fanout ${summary.fanout}, so the projected column is for a different tree and its ratios are not comparable`);
    }
  }
  if (summary.topology === 'partitioned') {
    warnings.push('partitioned merge is ordinary code outside the record: its time and cost are in neither column');
  }

  return {
    assumptions,
    totals,
    projected,
    fit: { method: fit.method, calls: fit.n, droppedAsRetries: fit.dropped },
    run: { topology: summary.topology, model: summary.model, agents: summary.agents, fanout: summary.fanout, concurrency: summary.concurrency, calls: summary.calls },
    warnings,
    unchecked: [...UNCHECKED],
  };
}

/**
 * Parse record text. Blank lines are skipped; a line starting with `#` is a comment (only
 * hand-written fixtures have them; --record never writes one). Anything else must be JSON.
 */
export function parseRecord(text) {
  const records = [];
  const comments = [];
  text.split('\n').forEach((line, i) => {
    if (line.trim() === '') return;
    if (line.startsWith('#')) {
      comments.push(line.replace(/^#\s*/, ''));
      return;
    }
    try {
      records.push(JSON.parse(line));
    } catch {
      throw new CompareError(`line ${i + 1} is not JSON: ${line.slice(0, 60)}`);
    }
  });
  return { records, comments };
}

const fmt = (x) => (x === null || x === undefined ? '-' : Number(x.toPrecision(4)).toString());
const fmtCost = (x) => (x === null || x === undefined ? '-' : `$${x.toFixed(4)}`);

export function render(result, comments = []) {
  const lines = [];
  if (comments.some((c) => /synthetic/i.test(c))) {
    lines.push('*** SYNTHETIC RECORD: hand-written, no API call was made. These numbers test this tool\'s arithmetic;');
    lines.push('*** they say nothing about whether any constant is right. Do not cite them as measurements.');
    for (const c of comments) lines.push(`    ${c}`);
    lines.push('');
  }
  const r = result.run;
  lines.push(`record: ${r.topology}, ${r.agents} agents, model ${r.model}, concurrency ${r.concurrency ?? 'unlimited'}, ${r.calls} calls`);
  lines.push('assumptions (assumed = cost-model.mjs; measured = fitted from this record; ratio = measured/assumed)');
  for (const a of result.assumptions) {
    const bound = a.status === 'upper-bound';
    const m = a.measured === null ? '-' : `${bound ? '<=' : ''}${fmt(a.measured)}`;
    const q = a.ratio === null ? '-' : `${bound ? '<=' : ''}${fmt(a.ratio)}`;
    lines.push(`${a.name.padEnd(24)} assumed ${fmt(a.assumed).padEnd(7)} measured ${m.padEnd(8)} ratio ${q}`);
    lines.push(`    ${a.status}: ${a.note}`);
  }
  lines.push('');
  lines.push('totals');
  const row = (label, p, m, f) => `${label.padEnd(10)} projected ${f(p).padEnd(10)} measured ${f(m).padEnd(10)} ratio ${fmt(ratioOf(m, p))}`;
  lines.push(row('tokens in', result.projected.input, result.totals.input, fmt));
  lines.push(row('tokens out', result.projected.output, result.totals.output, fmt));
  lines.push(row('cost', result.projected.cost, result.totals.costUsd, fmtCost));
  lines.push(row('time', result.projected.seconds, result.totals.seconds, (x) => (x === null ? '-' : `${fmt(x)}s`)));
  if (result.warnings.length) {
    lines.push('');
    for (const w of result.warnings) lines.push(`warning: ${w}`);
  }
  lines.push('');
  lines.push('not checked by this tool (structural assumptions, or outside what a record holds):');
  for (const u of result.unchecked) lines.push(`  - ${u}`);
  return lines.join('\n');
}

export function main(argv) {
  const json = argv.includes('--json');
  const files = argv.filter((a) => !a.startsWith('--'));
  if (files.length !== 1) {
    console.error('usage: node src/compare.mjs <record.jsonl> [--json]');
    return 2;
  }
  try {
    let text;
    try {
      text = fs.readFileSync(files[0], 'utf8');
    } catch (error) {
      throw new CompareError(`cannot read ${files[0]}: ${error.code ?? error.message}`);
    }
    const { records, comments } = parseRecord(text);
    const result = compare(records);
    console.log(json ? JSON.stringify(result, null, 2) : render(result, comments));
    return 0;
  } catch (error) {
    if (!(error instanceof CompareError)) throw error;
    console.error(`compare: ${error.message}`);
    return 2;
  }
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
  }
}

if (isMain()) process.exit(main(process.argv.slice(2)));
