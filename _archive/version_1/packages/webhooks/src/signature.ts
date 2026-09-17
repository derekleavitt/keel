import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Request signing.
 *
 * A receiver has no other way to know a POST came from us: the URL is often public, and
 * anything that can reach it can forge a body. The signature is over `timestamp.body`
 * rather than the body alone, so a captured request cannot be replayed indefinitely —
 * signing only the body makes every delivery valid forever.
 *
 * Header format follows the shape most receivers already implement:
 *
 * ```
 * keel-signature: t=1756329600,v1=<hex hmac-sha256>
 * ```
 *
 * The scheme is versioned (`v1=`) so a future algorithm can be sent alongside the old one
 * during a migration rather than breaking every receiver at once.
 */
export const SIGNATURE_HEADER = 'keel-signature';

/** Reject anything older than this, so a captured delivery is not replayable forever. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

export function signPayload(secret: string, body: string, at: Date = new Date()): string {
  const timestamp = Math.floor(at.getTime() / 1000);
  const digest = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

/**
 * Verify a signature header. **Exported for receivers**, and used by the tests that prove
 * a delivery is verifiable — a signing scheme with no shipped verifier is a scheme every
 * integrator implements slightly differently.
 */
export function verifySignature(
  secret: string,
  body: string,
  header: string | null,
  options: { toleranceSeconds?: number; now?: Date } = {},
): boolean {
  if (!header) return false;

  const parts = Object.fromEntries(
    header.split(',').map((part) => {
      const index = part.indexOf('=');
      return index === -1
        ? [part.trim(), '']
        : [part.slice(0, index).trim(), part.slice(index + 1)];
    }),
  );
  const timestamp = Number(parts.t);
  const provided = parts.v1;
  if (!Number.isFinite(timestamp) || !provided) return false;

  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = Math.floor((options.now ?? new Date()).getTime() / 1000);
  // Absolute difference: a timestamp far in the *future* is as suspicious as an old one,
  // and accepting it would defeat the expiry entirely.
  if (Math.abs(now - timestamp) > tolerance) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  // Constant time: a `===` here leaks the correct prefix one character at a time.
  return a.length === b.length && timingSafeEqual(a, b);
}
