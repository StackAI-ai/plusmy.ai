import { createHash, randomBytes } from 'node:crypto';
import { createServiceRoleClient } from '@plusmy/supabase';
import { logAuditEvent } from './connections';

function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

type AcceptedWorkspaceInvite = {
  id: string;
  workspace_id: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  accepted_at: string;
};

export async function listWorkspaceMembers(workspaceId: string) {
  const supabase = createServiceRoleClient();
  const { data: members, error: membersError } = await supabase
    .schema('app')
    .from('workspace_members')
    .select('id,role,user_id,created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true });
  if (membersError) throw membersError;
  if (!members?.length) return [];

  const { data: profiles, error: profilesError } = await supabase
    .schema('app')
    .from('profiles')
    .select('id,display_name,avatar_url')
    .in('id', members.map((member) => member.user_id));
  if (profilesError) throw profilesError;

  const profilesById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  return members.map((entry) => ({
    ...entry,
    profile: profilesById.get(entry.user_id) ?? null
  }));
}

export async function listWorkspaceInvites(workspaceId: string) {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .schema('app')
    .from('workspace_invites')
    .select('id,email,role,accepted_at,expires_at,created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });

  return data ?? [];
}

export async function createWorkspaceInvite(input: {
  workspaceId: string;
  invitedBy: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
}) {
  const supabase = createServiceRoleClient();
  const rawToken = randomBytes(24).toString('hex');
  const tokenHash = hashToken(rawToken);

  const { data, error } = await supabase
    .schema('app')
    .from('workspace_invites')
    .insert({
      workspace_id: input.workspaceId,
      email: input.email.toLowerCase(),
      role: input.role,
      invited_by: input.invitedBy,
      token_hash: tokenHash
    })
    .select('*')
    .single();

  if (error || !data) throw error ?? new Error('Failed to create invite.');

  await logAuditEvent({
    workspaceId: input.workspaceId,
    actorType: 'user',
    actorUserId: input.invitedBy,
    action: 'workspace.invite_created',
    resourceType: 'workspace_invite',
    resourceId: data.id,
    metadata: { email: data.email, role: data.role }
  });

  return {
    id: data.id,
    workspace_id: data.workspace_id,
    email: data.email,
    role: data.role,
    expires_at: data.expires_at,
    invite_token: rawToken
  };
}

export async function acceptWorkspaceInvite(input: { token: string; userId: string }) {
  const supabase = createServiceRoleClient();
  const tokenHash = hashToken(input.token);
  const { data: invite, error } = await supabase
    .schema('app')
    .rpc('accept_workspace_invite', { p_token_hash: tokenHash, p_user_id: input.userId })
    .single();
  if (error || !invite) throw error ?? new Error('Invite not found.');
  const acceptedInvite = invite as AcceptedWorkspaceInvite;

  await logAuditEvent({
    workspaceId: acceptedInvite.workspace_id,
    actorType: 'user',
    actorUserId: input.userId,
    action: 'workspace.invite_accepted',
    resourceType: 'workspace_invite',
    resourceId: acceptedInvite.id,
    metadata: { email: acceptedInvite.email, role: acceptedInvite.role }
  });

  return acceptedInvite;
}

export async function removeWorkspaceMember(input: {
  workspaceId: string;
  memberId: string;
  actorUserId: string;
}) {
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .schema('app')
    .from('workspace_members')
    .delete()
    .eq('id', input.memberId)
    .eq('workspace_id', input.workspaceId);
  if (error) throw error;

  await logAuditEvent({
    workspaceId: input.workspaceId,
    actorType: 'user',
    actorUserId: input.actorUserId,
    action: 'workspace.member_removed',
    resourceType: 'workspace_member',
    resourceId: input.memberId
  });
}

export async function updateWorkspaceMemberRole(input: {
  workspaceId: string;
  memberId: string;
  role: 'owner' | 'admin' | 'member';
  actorUserId: string;
}) {
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .schema('app')
    .from('workspace_members')
    .update({ role: input.role })
    .eq('id', input.memberId)
    .eq('workspace_id', input.workspaceId);

  if (error) throw error;

  await logAuditEvent({
    workspaceId: input.workspaceId,
    actorType: 'user',
    actorUserId: input.actorUserId,
    action: 'workspace.member_role_updated',
    resourceType: 'workspace_member',
    resourceId: input.memberId,
    metadata: { role: input.role }
  });
}

export async function revokeWorkspaceInvite(input: {
  workspaceId: string;
  inviteId: string;
  actorUserId: string;
}) {
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .schema('app')
    .from('workspace_invites')
    .delete()
    .eq('id', input.inviteId)
    .eq('workspace_id', input.workspaceId);

  if (error) throw error;

  await logAuditEvent({
    workspaceId: input.workspaceId,
    actorType: 'user',
    actorUserId: input.actorUserId,
    action: 'workspace.invite_revoked',
    resourceType: 'workspace_invite',
    resourceId: input.inviteId
  });
}
