'use server';

import { forgetActiveOrganization } from '@keel/organizations/scope';

/** Clear the active workspace on sign-out. See `forgetActiveOrganization`. */
export async function forgetActiveOrganizationAction(): Promise<void> {
  await forgetActiveOrganization();
}
