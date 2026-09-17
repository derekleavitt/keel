import { defineConfig } from 'vitest/config';
import { sharedTest } from '../../vitest.shared.ts';

export default defineConfig({
  test: {
    ...sharedTest,
    // Playwright owns e2e/. Vitest must not try to collect those specs.
    include: ['**/*.test.ts', '**/*.test.tsx'],
    // Excludes the browser specs, not the whole directory: `e2e/*.test.ts` are
    // Vitest checks over the specs themselves.
    exclude: ['**/node_modules/**', '**/.next/**', 'e2e/**/*.spec.ts'],
  },
});
