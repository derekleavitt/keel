'use server';

import { requireScope } from '@keel/testbed-orgs/scope';
import { type Agenda, buildAgenda } from '@keel/testbed-views';

/** Re-read the agenda for a timezone only the browser knows. */
export async function agendaForTimeZone(timeZone: unknown): Promise<Agenda> {
  const scope = await requireScope();
  const zone = typeof timeZone === 'string' && timeZone.length > 0 ? timeZone : 'UTC';
  return buildAgenda(scope, zone);
}
