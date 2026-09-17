import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit runs outside Next, which is the only thing in this repo that loads `.env`
 * on its own. Without this, `pnpm db:migrate` reads an empty DATABASE_URL and fails with
 * a message that does not mention the environment at all — the documented getting-started
 * path could never work.
 */
for (const candidate of ['.env', '../.env', '../../.env']) {
  const resolved = path.resolve(process.cwd(), candidate);
  if (fs.existsSync(resolved)) {
    process.loadEnvFile(resolved);
    break;
  }
}

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});
