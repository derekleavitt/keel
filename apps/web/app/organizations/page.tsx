import { listMembers, listOrganizations } from '@keel/testbed-orgs';
import { requireScopeOrRedirect } from '@keel/testbed-orgs/scope';
import Link from 'next/link';
import { SignOutButton } from '../sign-out-button.tsx';
import { WorkspaceManager } from './workspace-manager.tsx';

export const dynamic = 'force-dynamic';

export default async function OrganizationsPage() {
  const scope = await requireScopeOrRedirect('/organizations');
  const [workspaces, members] = await Promise.all([
    listOrganizations(scope.userId),
    listMembers(scope),
  ]);

  const active = workspaces.find((workspace) => workspace.id === scope.organizationId);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="font-mono text-xs uppercase tracking-widest text-accent">Workspaces</p>
          <h1 className="text-2xl font-semibold tracking-tight">{active?.name ?? 'Workspace'}</h1>
          <Link href="/lists" className="text-sm text-accent underline underline-offset-4">
            All lists
          </Link>
        </div>
        <SignOutButton />
      </header>

      <WorkspaceManager
        workspaces={workspaces.map(({ id, name, role, isPersonal }) => ({
          id,
          name,
          role,
          isPersonal,
        }))}
        activeId={scope.organizationId}
        members={members}
        canInvite={active ? !active.isPersonal : false}
      />
    </main>
  );
}
