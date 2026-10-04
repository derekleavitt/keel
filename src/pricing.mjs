/**
 * The single table of model ids and per-million-token rates. cost-model.mjs (projection) and
 * agents.mjs (measurement) both price tokens from here, so they cannot disagree about what the
 * same run costs.
 *
 * Prices go stale without anything failing, so the table carries its provenance:
 *   PRICING_SOURCE   where the rates are published
 *   PRICING_CHECKED  the date they were last verified (ISO, YYYY-MM-DD)
 * Update both whenever you re-verify, even if no rate changed. `pricingAgeDays()` and
 * `warnIfPricingStale()` turn the date into a signal: the scripts print a warning to stderr
 * (stdout is left untouched) once the table is older than STALE_AFTER_DAYS.
 *
 * Last verification: 2026-10-04 against the rate table supplied with task T-011 (the vendor
 * pricing page could not be reached from the sandbox that made the change). Re-check against
 * PRICING_SOURCE directly when you next can.
 */

export const PRICING_SOURCE = 'https://docs.anthropic.com/en/docs/about-claude/pricing';
export const PRICING_CHECKED = '2026-10-04';
export const STALE_AFTER_DAYS = 90;

/** alias -> { id, input, output }; rates are USD per million tokens. */
export const MODELS = Object.freeze({
  opus: Object.freeze({ id: 'claude-opus-5', input: 5.0, output: 25.0 }),
  sonnet: Object.freeze({ id: 'claude-sonnet-5', input: 2.0, output: 10.0 }),
  haiku: Object.freeze({ id: 'claude-haiku-4-5', input: 1.0, output: 5.0 }),
});

/** Whole days between PRICING_CHECKED and `now` (a Date). */
export function pricingAgeDays(now = new Date()) {
  return Math.floor((now.getTime() - Date.parse(PRICING_CHECKED)) / 86_400_000);
}

/** Write a one-line warning to stderr if the table is older than STALE_AFTER_DAYS. */
export function warnIfPricingStale(now = new Date(), write = (s) => process.stderr.write(s)) {
  const age = pricingAgeDays(now);
  if (age <= STALE_AFTER_DAYS) return false;
  write(`warning: model pricing last verified ${PRICING_CHECKED} (${age} days ago); re-check ${PRICING_SOURCE} and update src/pricing.mjs\n`);
  return true;
}
