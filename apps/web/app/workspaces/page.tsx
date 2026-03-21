import Link from 'next/link';
import { Badge, Card } from '@plusmy/ui';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { getAuthorizedWorkspace, listUserWorkspaces, listWorkspaceInvites, listWorkspaceMembers } from '@plusmy/core';
import { CreateWorkspaceForm } from './create-workspace-form';
import { InviteForm } from './invite-form';
import { RemoveMemberButton } from './remove-member-button';
import { MemberRoleSelect } from './member-role-select';
import { RevokeInviteButton } from './revoke-invite-button';
import { getSearchParam, type AppSearchParams } from '../_lib/search-params';

export default async function WorkspacesPage({ searchParams }: { searchParams?: AppSearchParams }) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <Card>
        <h1 className="text-2xl font-semibold">Workspaces</h1>
        <p className="mt-3 text-sm leading-7 text-slate-700">
          Sign in first. Workspace creation is tied directly to your Supabase identity and seeds default prompt and skill records.
        </p>
      </Card>
    );
  }

  const workspaces = await listUserWorkspaces(user.id);
  const requestedWorkspaceId = await getSearchParam(searchParams, 'workspace');
  const activeWorkspace = await getAuthorizedWorkspace(user.id, requestedWorkspaceId);
  const activeMembership = activeWorkspace ? workspaces.find((workspace) => workspace.id === activeWorkspace.id) : null;
  const canManageMembers = activeMembership?.role === 'owner' || activeMembership?.role === 'admin';
  const [members, invites] = activeWorkspace
    ? await Promise.all([listWorkspaceMembers(activeWorkspace.id), listWorkspaceInvites(activeWorkspace.id)])
    : [[], []];

  return (
    <div className="space-y-5">
      <div className="grid gap-5 md:grid-cols-[1.2fr_1fr]">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">Your workspaces</h1>
              <p className="mt-3 text-sm leading-7 text-slate-700">
                Each workspace is the security and context boundary for integrations, prompts, skills, audit logs, and MCP authorization decisions.
              </p>
            </div>
            <Badge tone="moss">{workspaces.length} total</Badge>
          </div>
          <div className="mt-6 space-y-3">
            {workspaces.length === 0 ? (
              <p className="text-sm text-slate-700">No workspaces yet. Create the first one on the right.</p>
            ) : (
              workspaces.map((workspace) => (
                <div
                  key={workspace.id}
                  className={`rounded-2xl border p-4 ${workspace.id === activeWorkspace?.id ? 'border-ink/20 bg-ink/5' : 'border-black/5 bg-white/70'}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">{workspace.name}</p>
                      <p className="text-sm text-slate-700">/{workspace.slug}</p>
                    </div>
                    <div className="flex gap-2">
                      <Badge>{workspace.plan}</Badge>
                      <Badge tone="brass">{workspace.role}</Badge>
                      {workspace.id === activeWorkspace?.id ? <Badge tone="moss">active</Badge> : null}
                    </div>
                  </div>
                  <div className="mt-4">
                    <Link
                      href={`/workspaces?workspace=${workspace.id}`}
                      className="text-sm font-medium text-ink underline decoration-black/20 underline-offset-4"
                    >
                      Open workspace
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
        <CreateWorkspaceForm />
      </div>

      <div className="grid gap-5 md:grid-cols-[1.2fr_1fr]">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">Members and invites</h2>
              <p className="mt-3 text-sm leading-7 text-slate-700">
                {activeWorkspace
                  ? `Active workspace: ${activeWorkspace.name}. Owners and admins can manage membership and issue invites.`
                  : 'Create a workspace before managing team access.'}
              </p>
            </div>
            <Badge tone="moss">{members.length} members</Badge>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Members</p>
              {members.length === 0 ? (
                <p className="text-sm text-slate-700">No members yet.</p>
              ) : (
                members.map((member) => (
                  <div key={member.id} className="rounded-2xl border border-black/5 bg-white/70 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-ink">{member.profile?.display_name ?? member.user_id}</p>
                        <p className="text-sm text-slate-700">{member.user_id === user.id ? `You • ${member.role}` : member.role}</p>
                      </div>
                      {activeWorkspace && canManageMembers ? (
                        <div className="flex flex-col items-end gap-2">
                          <MemberRoleSelect
                            workspaceId={activeWorkspace.id}
                            memberId={member.id}
                            currentRole={member.role}
                            canAssignOwner={activeMembership?.role === 'owner'}
                          />
                          {member.user_id !== user.id ? (
                            <RemoveMemberButton workspaceId={activeWorkspace.id} memberId={member.id} />
                          ) : null}
                        </div>
                      ) : (
                        <Badge tone="brass">{member.role}</Badge>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="space-y-3">
              <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Open invites</p>
              {invites.length === 0 ? (
                <p className="text-sm text-slate-700">No outstanding invites.</p>
              ) : (
                invites.map((invite) => (
                  <div key={invite.id} className="rounded-2xl border border-black/5 bg-white/70 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-ink">{invite.email}</p>
                        <p className="text-sm text-slate-700">{invite.role}</p>
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">expires {invite.expires_at}</p>
                      </div>
                      {activeWorkspace && canManageMembers ? (
                        <RevokeInviteButton workspaceId={activeWorkspace.id} inviteId={invite.id} />
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </Card>
        {activeWorkspace ? (
          canManageMembers ? (
            <InviteForm workspaceId={activeWorkspace.id} />
          ) : (
            <Card>
              <h3 className="text-lg font-semibold">Member management is restricted</h3>
              <p className="mt-3 text-sm leading-7 text-slate-700">
                Only owners and admins can issue invites or change member roles in this workspace.
              </p>
            </Card>
          )
        ) : (
          <Card>Create a workspace first.</Card>
        )}
      </div>
    </div>
  );
}
