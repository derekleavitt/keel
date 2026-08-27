import { defineConfig } from 'vitest/config';

/**
 * Shared test configuration.
 *
 * The timeout is deliberately generous. Suites backed by PGlite start a WebAssembly
 * Postgres, and a loaded CI runner is several times slower than a warm laptop — vitest's
 * 5s default produced a test that passed locally and failed in CI, which is the fastest
 * way to teach people to stop trusting the gate.
 *
 * This is a safety net, not the fix. `@keel/db/testing` snapshots the migrated database
 * once per process so tests restore rather than re-migrate; if a suite ever needs this
 * much time, something has regressed.
 */
export const sharedTest = {
  testTimeout: 30_000,
  hookTimeout: 30_000,
};

export default defineConfig({ test: sharedTest });
