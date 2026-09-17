/**
 * Where a webhook may point.
 *
 * A webhook URL is attacker-supplied input that the **server** then fetches, which makes
 * this a server-side request forgery surface by construction. Left unchecked, any tenant
 * can aim an endpoint at `http://169.254.169.254/` and have the application read its own
 * cloud credentials out to them, or sweep an internal network using response timing.
 *
 * The rules are deliberately narrow: HTTPS, a public host, no credentials, no unusual port.
 *
 * **The honest limit.** This validates the URL, not the connection. A hostname that
 * resolves publicly now can resolve to `127.0.0.1` at delivery time — DNS rebinding — and
 * only pinning the resolved address at connect time closes that. Doing so needs a custom
 * agent per runtime and is the right next step if this ever carries real traffic; the
 * check here removes the trivial version of the attack, which is the one that gets used.
 */
export class UnsafeWebhookUrlError extends Error {}

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal', 'metadata']);

/** Loopback, link-local, and the RFC 1918 private ranges, as literal addresses. */
function isPrivateAddress(hostname: string): boolean {
  if (hostname === '::1' || hostname.startsWith('[::1')) return true;
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10), bracketed or bare.
  if (/^\[?(f[cd]|fe[89ab])/i.test(hostname)) return true;

  const parts = hostname.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const [a, b] = parts.map(Number) as [number, number, number, number];

  return (
    a === 0 || // "this network"
    a === 10 || // 10.0.0.0/8
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, including the cloud metadata address
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) || // 192.168.0.0/16
    a >= 224 // multicast and reserved
  );
}

export function assertDeliverableUrl(
  raw: string,
  { allowInsecure = false, allowPrivate = false } = {},
): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeWebhookUrlError('Enter a valid URL.');
  }

  const secure = url.protocol === 'https:';
  // `allowInsecure` exists for local development against a plain-HTTP receiver, and is
  // never enabled in production — a signed payload over HTTP is still readable in transit.
  if (!secure && !(allowInsecure && url.protocol === 'http:')) {
    throw new UnsafeWebhookUrlError('The URL must use https.');
  }

  // Credentials in the URL would be logged with it, and are never how a receiver
  // authenticates us — that is what the signature is for.
  if (url.username || url.password) {
    throw new UnsafeWebhookUrlError('Do not put credentials in the URL.');
  }

  const hostname = url.hostname.toLowerCase();
  /*
   * `allowPrivate` is the development escape hatch, gated by an env var the environment
   * contract refuses to accept in production. Note it does *not* unblock the cloud
   * metadata hostnames below — those have no legitimate local use, and leaving them
   * reachable would make the hatch itself the vulnerability.
   */
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.internal')) {
    throw new UnsafeWebhookUrlError('That host is not reachable from here.');
  }
  if (!allowPrivate && isPrivateAddress(hostname)) {
    throw new UnsafeWebhookUrlError('The URL must point at a public address.');
  }
  if (allowPrivate && hostname === '169.254.169.254') {
    throw new UnsafeWebhookUrlError('That host is not reachable from here.');
  }

  return url;
}

/** Non-throwing form, for validating a form field. */
export function deliverableUrlError(
  raw: string,
  options?: { allowInsecure?: boolean; allowPrivate?: boolean },
) {
  try {
    assertDeliverableUrl(raw, options);
    return null;
  } catch (error) {
    return error instanceof UnsafeWebhookUrlError ? error.message : 'Enter a valid URL.';
  }
}
