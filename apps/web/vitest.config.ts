import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Playwright owns e2e/. Vitest must not try to collect those specs.
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['**/node_modules/**', '**/.next/**', 'e2e/**'],
  },
});
