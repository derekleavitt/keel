'use server';

import { organizationIdSchema } from '@keel/contracts/ids';
import { revalidatePath } from '@keel/runtime';
import { z } from 'zod';
import { addMember, createOrganization, scopeFor } from './queries.ts';
import { requireScope, setActiveOrganization } from './scope.ts';

const createSchema = z.object({
  name: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1, 'Name is required').max(80)),
});

const inviteSchema = z.object({
  email: z
    .string()
    .transform((value) => value.trim().toLowerCase())
    .pipe(z.email('Enter a valid email address')),
  role: z.enum(['admin', 'member']),
});

/** Create an organization and switch to it, so the user lands somewhere useful. */
export async function createOrganizationAction(input: unknown) {
  const scope = await requireScope();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }

  const slug = `${parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;
  const created = await createOrganization(scope.userId, { name: parsed.data.name, slug });
  await setActiveOrganization(created.id);

  revalidatePath('/', 'layout');
  return { ok: true as const };
}

export async function switchOrganizationAction(organizationId: unknown) {
  const scope = await requireScope();
  const parsed = organizationIdSchema.safeParse(organizationId);
  if (!parsed.success) return { ok: false as const, error: 'Unknown organization' };

  // Verify membership before switching, so a forged id cannot even be stored.
  const target = await scopeFor(scope.userId, parsed.data);
  if (!target) return { ok: false as const, error: 'You are not a member of that workspace' };

  await setActiveOrganization(parsed.data);
  revalidatePath('/', 'layout');
  return { ok: true as const };
}

export async function inviteMemberAction(input: unknown) {
  const scope = await requireScope();
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }

  const result = await addMember(scope, parsed.data);
  if (!result.ok) {
    /*
     * The seat message is built rather than looked up, because it carries the numbers — "no
     * seats left" without saying how many there are is a message nobody can act on.
     */
    if (result.reason === 'no-seats') {
      const seats = result.seats;
      return {
        ok: false as const,
        error: `Your ${seats?.plan} plan includes ${seats?.limit} seats and ${seats?.used} are in use. Upgrade to invite more people.`,
      };
    }

    const messages = {
      'not-allowed': 'Only owners and admins can invite',
      'no-such-user': 'No account with that email',
      personal: 'A personal workspace cannot have other members',
    } as const;
    return { ok: false as const, error: messages[result.reason] };
  }

  revalidatePath('/', 'layout');
  return { ok: true as const };
}
