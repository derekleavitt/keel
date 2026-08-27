import { describe, expect, it } from 'vitest';
import * as barrel from './index.ts';

/**
 * The barrel must stay a barrel.
 *
 * Shared primitives defined here rather than in a leaf module force any feature contract
 * that needs them into a temporal-dead-zone crash at module evaluation — because the
 * barrel re-exports that same feature module. It produces no lint error and no type
 * error, so this test is the only defence.
 *
 * See .orchestration/lessons/L-002.md.
 */
describe('contracts barrel', () => {
  it('re-exports the id primitives from their leaf module', () => {
    expect(barrel.userIdSchema).toBeDefined();
  });

  it('parses a branded user id', () => {
    expect(barrel.userIdSchema.parse('usr_1')).toBe('usr_1');
    expect(barrel.userIdSchema.safeParse('').success).toBe(false);
  });

  it('keeps the action-result envelope intact', () => {
    expect(barrel.ok(1)).toEqual({ ok: true, data: 1 });
    expect(barrel.err('nope')).toEqual({ ok: false, error: 'nope' });
  });
});
