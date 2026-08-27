'use server';

import { requireUserId } from '@keel/auth/session';
import { type Agenda, buildAgenda } from '@keel/testbed-views';

/** Re-read the agenda for a timezone only the browser knows. */
export async function agendaForTimeZone(timeZone: unknown): Promise<Agenda> {
  const userId = await requireUserId();
  const zone = typeof timeZone === 'string' && timeZone.length > 0 ? timeZone : 'UTC';
  return buildAgenda(userId, zone);
}
