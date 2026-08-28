import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { OrganizationId, UserId } from '@keel/contracts/ids';
import { db, type KeelDatabase } from '@keel/db';
import { apiKey } from '@keel/db/schema';
import { and, desc, eq, isNull } from 'drizzle-orm';

/**
 * API key authentication.
 *
 * Session cookies do not work for machines: there is no browser to hold one, no redirect
 * to follow, and no user to re-authenticate when it expires. A key is a bearer credential
 * with none of those needs — and, because it never expires on its own, revocation has to
 * be the mechanism that ends it.
 *
 * This module answers exactly one question: *which identity is presenting this token*. It
 * deliberately does not answer "and may they act in this organization" — that is a
 * membership question, and routing it through the same check the browser uses is what
 * keeps one authorization path rather than two. See `testbed/orgs/src/scope.ts`.
 */

/** `keel_sk_` + 16 hex selector + 48 hex verifier. */
const PREFIX = 'keel_sk_';
const SELECTOR_CHARS = 16;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Split a presented token into its lookup half and its secret half.
 *
 * Returns null for anything malformed, so a garbage `Authorization` header costs one
 * string comparison rather than a database round trip.
 */
function parseToken(token: string): { selector: string; verifier: string } | null {
  if (!token.startsWith(PREFIX)) return null;
  const body = token.slice(PREFIX.length);
  if (body.length <= SELECTOR_CHARS || !/^[0-9a-f]+$/.test(body)) return null;
  return { selector: body.slice(0, SELECTOR_CHARS), verifier: body.slice(SELECTOR_CHARS) };
}

export interface IssuedKey {
  id: string;
  name: string;
  /** The only time this value exists. Nothing stored can reconstruct it. */
  token: string;
  createdAt: Date;
}

/**
 * Mint a key for an organization.
 *
 * The caller is responsible for having established that this user may act in this
 * organization — issuing is a mutation like any other and goes through the same scope.
 */
export async function issueApiKey(
  input: { organizationId: OrganizationId; userId: UserId; name: string },
  database: KeelDatabase = db(),
): Promise<IssuedKey> {
  const selector = randomBytes(SELECTOR_CHARS / 2).toString('hex');
  const verifier = randomBytes(24).toString('hex');

  const [row] = await database
    .insert(apiKey)
    .values({
      id: `key_${randomBytes(12).toString('hex')}`,
      organizationId: input.organizationId,
      userId: input.userId,
      name: input.name,
      selector,
      verifierHash: sha256(verifier),
    })
    .returning({ id: apiKey.id, name: apiKey.name, createdAt: apiKey.createdAt });
  if (!row) throw new Error('issueApiKey inserted no row');

  return { ...row, token: `${PREFIX}${selector}${verifier}` };
}

export interface KeyIdentity {
  keyId: string;
  userId: UserId;
  organizationId: OrganizationId;
}

/**
 * Identify the holder of a token, or null.
 *
 * Null for every failure — unknown selector, wrong verifier, revoked key — with no way for
 * a caller to tell them apart. Distinguishing "no such key" from "wrong secret" tells an
 * attacker which half of a guess was right.
 */
export async function authenticateApiKey(
  token: string,
  database: KeelDatabase = db(),
): Promise<KeyIdentity | null> {
  const parsed = parseToken(token);
  if (!parsed) return null;

  const [row] = await database
    .select({
      id: apiKey.id,
      userId: apiKey.userId,
      organizationId: apiKey.organizationId,
      verifierHash: apiKey.verifierHash,
      revokedAt: apiKey.revokedAt,
    })
    .from(apiKey)
    .where(eq(apiKey.selector, parsed.selector))
    .limit(1);

  if (!row || row.revokedAt) return null;

  /*
   * Constant-time comparison. Both sides are fixed-length SHA-256 hex, so the buffers are
   * always the same size and `timingSafeEqual` cannot throw. A `===` here leaks how many
   * leading characters of a guess were correct, which is enough to recover a key one byte
   * at a time given enough requests.
   */
  const presented = Buffer.from(sha256(parsed.verifier), 'utf8');
  const stored = Buffer.from(row.verifierHash, 'utf8');
  if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) return null;

  /*
   * Fire-and-forget: a failure to record last-used must not fail the request it is
   * describing, and the value is advisory. Awaiting it would put a write on the critical
   * path of every read in the API.
   */
  void database
    .update(apiKey)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKey.id, row.id))
    .catch(() => {});

  return {
    keyId: row.id,
    userId: row.userId as UserId,
    organizationId: row.organizationId as OrganizationId,
  };
}

/** Keys for an organization, newest first. Never returns anything secret. */
export async function listApiKeys(organizationId: OrganizationId, database: KeelDatabase = db()) {
  return database
    .select({
      id: apiKey.id,
      name: apiKey.name,
      selector: apiKey.selector,
      lastUsedAt: apiKey.lastUsedAt,
      revokedAt: apiKey.revokedAt,
      createdAt: apiKey.createdAt,
    })
    .from(apiKey)
    .where(eq(apiKey.organizationId, organizationId))
    .orderBy(desc(apiKey.createdAt));
}

/**
 * Revoke a key. Scoped by organization, so one tenant cannot revoke another's keys.
 *
 * Idempotent: revoking an already-revoked key returns false rather than moving its
 * timestamp, so the record of when it was first revoked survives a double click.
 */
export async function revokeApiKey(
  organizationId: OrganizationId,
  id: string,
  database: KeelDatabase = db(),
): Promise<boolean> {
  const rows = await database
    .update(apiKey)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(apiKey.id, id), eq(apiKey.organizationId, organizationId), isNull(apiKey.revokedAt)),
    )
    .returning({ id: apiKey.id });
  return rows.length > 0;
}

/** The displayable stub of a key: enough to recognise it, not enough to use it. */
export function keyHint(selector: string): string {
  return `${PREFIX}${selector.slice(0, 6)}…`;
}
