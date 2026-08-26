import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetServerEnv, serverEnv, serverSchema } from './env.ts';

const valid = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://localhost:5432/keel',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:3000',
};

describe('serverSchema', () => {
  it('accepts a complete environment', () => {
    expect(serverSchema.parse(valid).DATABASE_URL).toBe(valid.DATABASE_URL);
  });

  it('rejects a short auth secret', () => {
    const result = serverSchema.safeParse({ ...valid, BETTER_AUTH_SECRET: 'too-short' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-URL auth URL', () => {
    const result = serverSchema.safeParse({ ...valid, BETTER_AUTH_URL: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('defaults the auth URL', () => {
    const { BETTER_AUTH_URL: _omitted, ...rest } = valid;
    expect(serverSchema.parse(rest).BETTER_AUTH_URL).toBe('http://localhost:3000');
  });
});

describe('serverEnv', () => {
  const snapshot = { ...process.env };

  beforeEach(() => resetServerEnv());
  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, snapshot);
    resetServerEnv();
  });

  it('names every missing variable in one message', () => {
    // biome-ignore lint/performance/noDelete: removing the key is the point of the test
    delete process.env.DATABASE_URL;
    // biome-ignore lint/performance/noDelete: removing the key is the point of the test
    delete process.env.BETTER_AUTH_SECRET;

    let message = '';
    try {
      serverEnv();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('BETTER_AUTH_SECRET');
  });

  it('memoises a valid environment', () => {
    Object.assign(process.env, valid);
    expect(serverEnv()).toBe(serverEnv());
  });
});
