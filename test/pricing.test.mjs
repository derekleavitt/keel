import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODELS,
  PRICING_SOURCE,
  PRICING_CHECKED,
  STALE_AFTER_DAYS,
  pricingAgeDays,
  warnIfPricingStale,
} from '../src/pricing.mjs';
import { MODEL_NAMES as COST_MODELS } from '../src/cost-model.mjs';

test('every model has an id and finite positive rates', () => {
  assert.ok(Object.keys(MODELS).length > 0);
  for (const [alias, m] of Object.entries(MODELS)) {
    assert.ok(typeof m.id === 'string' && m.id.length > 0, `${alias} id`);
    for (const k of ['input', 'output']) {
      assert.ok(Number.isFinite(m[k]) && m[k] > 0, `${alias}.${k}`);
    }
  }
});

test('model ids are unique', () => {
  const ids = Object.values(MODELS).map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('provenance: source is a URL and checked date is a valid ISO date', () => {
  assert.match(PRICING_SOURCE, /^https:\/\//);
  assert.match(PRICING_CHECKED, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(!Number.isNaN(Date.parse(PRICING_CHECKED)));
  assert.ok(pricingAgeDays() >= 0, 'checked date is not in the future');
});

test('staleness warning fires only past the threshold', () => {
  const day = 86_400_000;
  const base = Date.parse(PRICING_CHECKED);
  const out = [];
  assert.equal(warnIfPricingStale(new Date(base + STALE_AFTER_DAYS * day), (s) => out.push(s)), false);
  assert.equal(out.length, 0);
  assert.equal(warnIfPricingStale(new Date(base + (STALE_AFTER_DAYS + 1) * day), (s) => out.push(s)), true);
  assert.match(out[0], new RegExp(PRICING_CHECKED));
  assert.match(out[0], /pricing\.mjs/);
});

test('cost-model exposes exactly the shared aliases', () => {
  assert.deepEqual(COST_MODELS, Object.keys(MODELS));
});
