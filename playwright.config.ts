import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke-only by design. The gate needs a fast, honest signal that the app boots —
 * exhaustive browser coverage belongs in feature-level suites, not the hot path.
 */
export default defineConfig({
  testDir: './apps/web/e2e',
  /*
   * Browser tests are `.spec.ts`; `.test.ts` beside them is a Vitest check *about* the
   * specs (see `e2e/scoping.test.ts`). Playwright's default testMatch would claim both.
   */
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  /*
   * Three, not the default `cpus / 2`.
   *
   * Each worker is a full Chromium sharing a machine with the Next server the suite is
   * hitting, and at five they contend badly enough that ordinary page loads exceed their
   * timeouts — failures that look like application bugs and are not. Measured on a 10-core
   * machine: five workers failed five tests, three passed all of them and the whole suite
   * still finishes in under four minutes. A gate that fails at random is worse than a gate
   * that takes another minute.
   */
  workers: 3,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:3000', trace: 'on-first-retry' },
  /*
   * Sign-up is CPU-bound — Better Auth hashes a password on a single-threaded server — so
   * with several workers signing up at once a legitimate response takes a couple of
   * seconds. The default 5s left almost no margin above that and produced failures that
   * looked like bugs. This is headroom for a known cost, not a way to wait out a slow app:
   * a page load here is under 300ms.
   */
  expect: { timeout: 10_000 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    /*
     * `build && start`, not `dev`.
     *
     * Against `next dev` every run pays to compile each route the moment a test first
     * touches it, and that cost lands *inside* the first assertion that hits the page. It
     * grew with the app: four concurrent sign-ups took 27 seconds cold and 2.6 warm, and
     * the tests that failed were the ones unlucky enough to arrive first.
     *
     * Building first removes the compiler from the measurement entirely, and has the
     * larger benefit of exercising the production bundle — the thing that actually ships,
     * with its own caching and rendering behaviour. `pnpm verify` builds immediately
     * before this step, so Turbo serves it from cache and the extra command costs about a
     * second. See `.orchestration/lessons/L-039.md`.
     */
    command: 'pnpm --filter @keel/web build && pnpm --filter @keel/web start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
