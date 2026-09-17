'use client';

import {
  createOrganizationAction,
  inviteMemberAction,
  switchOrganizationAction,
} from '@keel/organizations/actions';
import { Button, useSerialMutations } from '@keel/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Workspace = { id: string; name: string; role: string; isPersonal: boolean };
type Member = { userId: string; email: string; name: string | null; role: string };

export function WorkspaceManager({
  workspaces,
  activeId,
  members,
  canInvite,
}: {
  workspaces: Workspace[];
  activeId: string;
  members: Member[];
  canInvite: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { enqueue, pending } = useSerialMutations({
    onSettled: () => router.refresh(),
    onError: setError,
  });

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Workspaces</h2>
        <ul className="flex flex-col gap-px overflow-hidden rounded-lg border border-line bg-line">
          {workspaces.map((workspace) => (
            <li key={workspace.id} className="flex items-center gap-3 bg-surface px-4 py-3">
              <span className="flex-1 text-sm">
                {workspace.name}
                <span className="text-muted">
                  {' '}
                  · {workspace.isPersonal ? 'personal' : workspace.role}
                </span>
              </span>
              {workspace.id === activeId ? (
                <span className="font-mono text-xs text-accent">active</span>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  aria-label={`Switch to ${workspace.name}`}
                  onClick={() => {
                    setError(null);
                    enqueue(() => switchOrganizationAction(workspace.id));
                  }}
                >
                  Switch
                </Button>
              )}
            </li>
          ))}
        </ul>

        <form
          className="flex gap-2"
          action={(data) => {
            setError(null);
            enqueue(() => createOrganizationAction({ name: String(data.get('name') ?? '') }));
          }}
        >
          <input
            name="name"
            required
            placeholder="New workspace"
            aria-label="New workspace name"
            className="h-9 flex-1 rounded-md border border-line bg-surface px-3 text-sm"
          />
          <Button type="submit" size="sm" disabled={pending}>
            Create
          </Button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Members</h2>
        <ul className="flex flex-col gap-px overflow-hidden rounded-lg border border-line bg-line">
          {members.map((member) => (
            <li key={member.userId} className="flex items-center gap-3 bg-surface px-4 py-3">
              {/*
               * Both name and email. A member list showing only display names is
               * ambiguous the moment two people share one, and the email is the thing
               * an admin actually matches against when deciding who to remove.
               */}
              <span className="flex-1 text-sm">
                {member.name ?? member.email}
                <span className="text-muted">
                  {member.name ? ` · ${member.email}` : ''} · {member.role}
                </span>
              </span>
            </li>
          ))}
        </ul>

        {canInvite ? (
          <form
            className="flex flex-wrap gap-2"
            action={(data) => {
              setError(null);
              enqueue(() =>
                inviteMemberAction({
                  email: String(data.get('email') ?? ''),
                  role: String(data.get('role') ?? 'member') as 'admin' | 'member',
                }),
              );
            }}
          >
            <input
              name="email"
              type="email"
              required
              placeholder="their@email.com"
              aria-label="Invite by email"
              className="h-9 flex-1 rounded-md border border-line bg-surface px-3 text-sm"
            />
            <select
              name="role"
              aria-label="Member role"
              defaultValue="member"
              className="h-9 rounded-md border border-line bg-surface px-2 text-sm"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <Button type="submit" size="sm" disabled={pending}>
              Invite
            </Button>
          </form>
        ) : (
          <p className="text-xs text-muted">
            A personal workspace has exactly one member. Create a workspace to collaborate.
          </p>
        )}
      </section>

      {error && (
        <p role="alert" className="rounded-md border border-line bg-surface-2 px-3 py-2 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
