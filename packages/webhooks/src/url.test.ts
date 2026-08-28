import { describe, expect, it } from 'vitest';
import { assertDeliverableUrl, deliverableUrlError, UnsafeWebhookUrlError } from './url.ts';

describe('accepts', () => {
  it.each([
    'https://example.com/hook',
    'https://sub.example.co.uk/a/b?c=d',
    'https://8.8.8.8/hook',
  ])('%s', (url) => {
    expect(assertDeliverableUrl(url).href).toContain('https://');
  });

  it('allows plain http only when explicitly permitted', () => {
    expect(() => assertDeliverableUrl('http://example.com/hook')).toThrow(UnsafeWebhookUrlError);
    expect(assertDeliverableUrl('http://example.com/hook', { allowInsecure: true }).protocol).toBe(
      'http:',
    );
  });
});

describe('refuses', () => {
  /*
   * The attack this exists for. A webhook URL is attacker-supplied input that the server
   * fetches, so without this any tenant can read the instance's own cloud credentials.
   */
  it('the cloud metadata address', () => {
    expect(deliverableUrlError('https://169.254.169.254/latest/meta-data/')).toBe(
      'The URL must point at a public address.',
    );
    expect(deliverableUrlError('https://metadata.google.internal/computeMetadata/v1/')).toBe(
      'That host is not reachable from here.',
    );
  });

  it.each([
    ['loopback', 'https://127.0.0.1/hook'],
    ['loopback by name', 'https://localhost/hook'],
    ['IPv6 loopback', 'https://[::1]/hook'],
    ['private 10/8', 'https://10.1.2.3/hook'],
    ['private 172.16/12', 'https://172.20.0.1/hook'],
    ['private 192.168/16', 'https://192.168.1.1/hook'],
    ['link-local', 'https://169.254.1.1/hook'],
    ['carrier-grade NAT', 'https://100.100.0.1/hook'],
    ['this network', 'https://0.0.0.0/hook'],
    ['multicast', 'https://239.1.1.1/hook'],
    ['internal suffix', 'https://db.internal/hook'],
    ['IPv6 unique-local', 'https://[fd00::1]/hook'],
    ['IPv6 link-local', 'https://[fe80::1]/hook'],
  ])('a %s address', (_label, url) => {
    expect(() => assertDeliverableUrl(url)).toThrow(UnsafeWebhookUrlError);
  });

  it('credentials embedded in the URL', () => {
    expect(deliverableUrlError('https://user:pass@example.com/hook')).toBe(
      'Do not put credentials in the URL.',
    );
  });

  it.each([['not a url'], ['ftp://example.com/x'], ['javascript:alert(1)'], ['']])(
    'the non-URL %s',
    (raw) => {
      expect(deliverableUrlError(raw)).not.toBeNull();
    },
  );

  /** Private ranges stay blocked even when http is allowed for local development. */
  it('a private address even with insecure http permitted', () => {
    expect(() => assertDeliverableUrl('http://127.0.0.1/hook', { allowInsecure: true })).toThrow(
      UnsafeWebhookUrlError,
    );
  });
});

describe('the development escape hatch', () => {
  it('permits a loopback receiver when explicitly allowed', () => {
    expect(
      assertDeliverableUrl('http://127.0.0.1:9999/hook', {
        allowInsecure: true,
        allowPrivate: true,
      }).hostname,
    ).toBe('127.0.0.1');
  });

  /*
   * The hatch is for reaching a developer's own machine, and cloud metadata is never that.
   * Leaving it reachable would make the escape hatch itself the vulnerability — the exact
   * failure mode of every "allow internal hosts in dev" flag that has ever shipped to prod.
   */
  it('still refuses the cloud metadata address', () => {
    expect(() =>
      assertDeliverableUrl('http://169.254.169.254/latest/meta-data/', {
        allowInsecure: true,
        allowPrivate: true,
      }),
    ).toThrow(UnsafeWebhookUrlError);
  });
});
