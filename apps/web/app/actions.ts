'use server';

import { forgetActiveOrganization } from '@keel/testbed-orgs/scope';

/** Clear the active workspace on sign-out. See `forgetActiveOrganization`. */
export async function forgetActiveOrganizationAction(): Promise<void> {
  await forgetActiveOrganization();
}
