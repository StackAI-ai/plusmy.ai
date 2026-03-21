import Link from 'next/link';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@plusmy/ui';
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
        <CardHeader>
          <CardTitle className="text-2xl">Workspaces</CardTitle>
          <CardDescription>
            Sign in first. Workspace creation is tied directly to your Supabase identity and seeds default prompt
            and skill records.
          </CardDescription>
        </CardHeader>
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
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4 space-y-0">
            <div className="space-y-3">
              <CardTitle className="text-2xl">Your workspaces</CardTitle>
              <CardDescription>
                Each workspace is the security and context boundary for integrations, prompts, skills, audit logs,
                and MCP authorization decisions.
              </CardDescription>
            </div>
            <Badge tone="moss">{workspaces.length} total</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {workspaces.length === 0 ? (
              <p className="text-sm text-muted-foreground">No workspaces yet. Create the first one on the right.</p>
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
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/workspaces?workspace=${workspace.id}`}>Open workspace</Link>
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
        <CreateWorkspaceForm />
      </div>

      <div className="grid gap-5 md:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4 space-y-0">
            <div className="space-y-3">
              <CardTitle>Members and invites</CardTitle>
              <CardDescription>
                {activeWorkspace
                  ? `Active workspace: ${activeWorkspace.name}. Owners and admins can manage membership and issue invites.`
                  : 'Create a workspace before managing team access.'}
              </CardDescription>
            </div>
            <Badge tone="moss">{members.length} members</Badge>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <p className="text-sm uppercase tracking-[0.22em] text-muted-foreground">Members</p>
              {members.length === 0 ? (
                <p className="text-sm text-muted-foreground">No members yet.</p>
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
              <p className="text-sm uppercase tracking-[0.22em] text-muted-foreground">Open invites</p>
              {invites.length === 0 ? (
                <p className="text-sm text-muted-foreground">No outstanding invites.</p>
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
          </CardContent>
        </Card>
        {activeWorkspace ? (
          canManageMembers ? (
            <InviteForm workspaceId={activeWorkspace.id} />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Member management is restricted</CardTitle>
                <CardDescription>
                  Only owners and admins can issue invites or change member roles in this workspace.
                </CardDescription>
              </CardHeader>
            </Card>
          )
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Create a workspace first</CardTitle>
            </CardHeader>
          </Card>
        )}
      </div>
    </div>
  );
}
