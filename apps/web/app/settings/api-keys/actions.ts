'use server';

import { audit } from '@keel/audit';
import { issueApiKey, revokeApiKey } from '@keel/auth/api-key';
import { createApiKeySchema } from '@keel/contracts/api-key';
import { requireScope } from '@keel/testbed-orgs/scope';
import { revalidatePath } from 'next/cache';

/** Every export is a public endpoint: no helpers, no ids from the caller, parse everything. */
export async function createApiKeyAction(input: unknown) {
  const scope = await requireScope();
  const parsed = createApiKeySchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };

  const issued = await issueApiKey({ ...scope, name: parsed.data.name }, undefined);

  await audit(scope, {
    action: 'api_key.created',
    targetType: 'api_key',
    targetId: issued.id,
    summary: `created the API key “${issued.name}”`,
  });
  revalidatePath('/settings/api-keys', 'layout');

  /*
   * The token is returned exactly once, here. It is never stored in a form of this
   * application's own state and cannot be re-read — the page shows it and the next
   * navigation loses it, which is the intended behaviour, not a gap.
   */
  return { ok: true as const, token: issued.token, name: issued.name };
}

export async function revokeApiKeyAction(id: unknown) {
  const scope = await requireScope();
  if (typeof id !== 'string') return { ok: false as const, error: 'Invalid key' };

  const revoked = await revokeApiKey(scope.organizationId, id);
  if (!revoked) return { ok: false as const, error: 'Key not found, or already revoked' };

  await audit(scope, {
    action: 'api_key.revoked',
    targetType: 'api_key',
    targetId: id,
    summary: 'revoked an API key',
  });
  revalidatePath('/settings/api-keys', 'layout');
  return { ok: true as const };
}
