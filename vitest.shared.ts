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
  /**
   * Two forks per package, not one per core.
   *
   * Every PGlite suite boots its own WebAssembly Postgres, so a fork is expensive in memory
   * as well as in CPU. Vitest sizes its pool to the machine and Turbo runs the packages
   * concurrently, which multiplies: a dozen packages each claiming ten cores drove the load
   * average past sixty on a ten-core laptop, and files that finish in twelve seconds on
   * their own took over ten minutes together.
   *
   * The parallelism that pays here is *across* packages, which Turbo already provides.
   * Within a package the suites spend most of their time waiting on WASM Postgres, so a
   * third fork buys very little and costs a core something else needed.
   *
   * See `.orchestration/lessons/L-041.md`.
   */
  poolOptions: { forks: { maxForks: 2, minForks: 1 } },
};

export default defineConfig({ test: sharedTest });
