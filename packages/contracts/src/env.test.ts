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
  it('makes a deployed instance refuse to start', () => {
    const result = serverSchema.safeParse({
      ...BASE,
      NODE_ENV: 'production',
      BETTER_AUTH_URL: 'https://app.example.com',
      WEBHOOK_ALLOW_PRIVATE_HOSTS: '1',
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('must not be set on a deployed');
  });

  /*
   * A production *build* on the developer's own machine is not a deployment. `next start`
   * sets NODE_ENV=production, so refusing on that alone made it impossible to run or test
   * your own build — and a guard that blocks testing is a guard someone deletes.
   */
  it('allows a production build served from localhost', () => {
    expect(
      serverSchema.safeParse({
        ...BASE,
        NODE_ENV: 'production',
        BETTER_AUTH_URL: 'http://localhost:3000',
        WEBHOOK_ALLOW_PRIVATE_HOSTS: '1',
      }).success,
    ).toBe(true);
  });

  /*
   * Not asserted here: an unparseable `BETTER_AUTH_URL`. `z.url()` rejects it at the field
   * before the refinement ever runs, so a test claiming to cover the "treat it as deployed"
   * fallback would be passing for the wrong reason. That branch is defensive only.
   */

  it('is fine in production when unset', () => {
    expect(
      serverSchema.safeParse({
        ...BASE,
        NODE_ENV: 'production',
        BETTER_AUTH_URL: 'https://app.example.com',
      }).success,
    ).toBe(true);
  });
});
