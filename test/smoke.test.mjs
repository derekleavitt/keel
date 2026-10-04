import { test } from 'node:test';
import assert from 'node:assert/strict';

test('verify.mjs exports a function named verify', async () => {
  const mod = await import('../src/verify.mjs');
  assert.equal(typeof mod.verify, 'function');
  assert.equal(mod.verify.name, 'verify');
});

test('cost-model.mjs exports a function named project', async () => {
  const mod = await import('../src/cost-model.mjs');
  assert.equal(typeof mod.project, 'function');
  assert.equal(mod.project.name, 'project');
});
