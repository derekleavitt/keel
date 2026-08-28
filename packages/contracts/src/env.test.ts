import { describe, expect, it } from 'vitest';
import { serverSchema } from './env.ts';

const BASE = {
  DATABASE_URL: 'postgres://localhost/keel',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
};

describe('the webhook escape hatch', () => {
  it('is off unless explicitly set', () => {
    const parsed = serverSchema.parse(BASE);
    expect(parsed.WEBHOOK_ALLOW_PRIVATE_HOSTS).toBe(false);
  });

  it('can be turned on in development', () => {
    const parsed = serverSchema.parse({
      ...BASE,
      NODE_ENV: 'development',
      WEBHOOK_ALLOW_PRIVATE_HOSTS: '1',
    });
    expect(parsed.WEBHOOK_ALLOW_PRIVATE_HOSTS).toBe(true);
  });

  /*
   * The guarantee that makes the hatch acceptable: it cannot be switched on in production
   * by accident, by a copied `.env`, or by a deploy script that forwards every variable.
   * The application refuses to start rather than running with the SSRF guard disabled.
   */
  it('makes the application refuse to start in production', () => {
    const result = serverSchema.safeParse({
      ...BASE,
      NODE_ENV: 'production',
      WEBHOOK_ALLOW_PRIVATE_HOSTS: '1',
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('must not be set in production');
  });

  it('is fine in production when unset', () => {
    expect(serverSchema.safeParse({ ...BASE, NODE_ENV: 'production' }).success).toBe(true);
  });
});
