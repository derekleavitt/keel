'use server';

import { requireUserId } from '@keel/auth/session';
import { retryDeadJob } from '@keel/jobs';
import { revalidatePath } from 'next/cache';

/** Put a dead job back in the queue once its cause is fixed. */
export async function retryJobAction(id: unknown) {
  await requireUserId();
  if (typeof id !== 'string') return { ok: false as const, error: 'Invalid job' };

  const retried = await retryDeadJob(id);
  if (!retried) return { ok: false as const, error: 'That job is no longer dead' };

  revalidatePath('/admin/jobs', 'layout');
  return { ok: true as const };
}
