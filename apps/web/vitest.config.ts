import { defineConfig } from 'vitest/config';
import { sharedTest } from '../../vitest.shared.ts';

export default defineConfig({
  test: {
    ...sharedTest,
    // Playwright owns e2e/. Vitest must not try to collect those specs.
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['**/node_modules/**', '**/.next/**', 'e2e/**'],
  },
});
