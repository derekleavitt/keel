import { describe, expect, it } from 'vitest';
import { signPayload, verifySignature } from './signature.ts';

const SECRET = 'whsec_test';
const BODY = JSON.stringify({ event: 'todo.created', data: { id: 'tdo_1' } });

describe('signing', () => {
  it('round-trips', () => {
    expect(verifySignature(SECRET, BODY, signPayload(SECRET, BODY))).toBe(true);
  });

  it('rejects a tampered body', () => {
    const header = signPayload(SECRET, BODY);
    expect(verifySignature(SECRET, `${BODY} `, header)).toBe(false);
  });

  it('rejects the wrong secret', () => {
    expect(verifySignature('whsec_other', BODY, signPayload(SECRET, BODY))).toBe(false);
  });

  it.each([
    ['missing', null],
    ['empty', ''],
    ['no version', 't=1756329600'],
    ['no timestamp', 'v1=abc'],
    ['garbage', 'nonsense'],
  ])('rejects a %s header', (_label, header) => {
    expect(verifySignature(SECRET, BODY, header)).toBe(false);
  });

  /*
   * The reason the timestamp is inside the signed string rather than beside it. Signing
   * only the body would make every captured delivery valid forever.
   */
  it('rejects a replayed delivery once it is stale', () => {
    const signedAt = new Date('2026-08-27T12:00:00Z');
    const header = signPayload(SECRET, BODY, signedAt);

    const soonAfter = new Date(signedAt.getTime() + 60_000);
    expect(verifySignature(SECRET, BODY, header, { now: soonAfter })).toBe(true);

    const muchLater = new Date(signedAt.getTime() + 3_600_000);
    expect(verifySignature(SECRET, BODY, header, { now: muchLater })).toBe(false);
  });

  /** A future timestamp is as suspicious as an old one; accepting it defeats the expiry. */
  it('rejects a timestamp from the future', () => {
    const header = signPayload(SECRET, BODY, new Date('2026-08-27T13:00:00Z'));
    expect(verifySignature(SECRET, BODY, header, { now: new Date('2026-08-27T12:00:00Z') })).toBe(
      false,
    );
  });

  it('cannot be forged by moving the timestamp', () => {
    const header = signPayload(SECRET, BODY, new Date('2026-08-27T12:00:00Z'));
    const digest = header.split('v1=')[1];
    const now = new Date('2026-08-27T12:00:30Z');
    const restamped = `t=${Math.floor(now.getTime() / 1000)},v1=${digest}`;

    // Fresh timestamp, but the digest was computed over the old one.
    expect(verifySignature(SECRET, BODY, restamped, { now })).toBe(false);
  });
});
