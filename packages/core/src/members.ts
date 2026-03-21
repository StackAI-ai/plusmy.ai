import { createHash, randomBytes } from 'node:crypto';
import { createServiceRoleClient } from '@plusmy/supabase';
import { logAuditEvent } from './connections';

function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export async function listWorkspaceMembers(workspaceId: string) {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .schema('app')
    .from('workspace_members')
    .select('id,role,user_id,created_at,profile:profiles(id,display_name,avatar_url)')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true });

  return (data ?? []).map((entry) => ({
    ...entry,
    profile: Array.isArray(entry.profile) ? entry.profile[0] ?? null : entry.profile
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
    ...data,
    invite_token: rawToken
  };
}

export async function acceptWorkspaceInvite(input: { token: string; userId: string; email?: string | null }) {
  const supabase = createServiceRoleClient();
  const tokenHash = hashToken(input.token);
  const { data: invite } = await supabase
    .schema('app')
    .from('workspace_invites')
    .select('*')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (!invite) throw new Error('Invite not found.');
  if (invite.accepted_at) throw new Error('Invite already accepted.');
  if (new Date(invite.expires_at).getTime() < Date.now()) throw new Error('Invite expired.');
  if (input.email && invite.email.toLowerCase() !== input.email.toLowerCase()) {
    throw new Error('Invite email does not match current user.');
  }

  const { data: existingMember } = await supabase
    .schema('app')
    .from('workspace_members')
    .select('id,role')
    .eq('workspace_id', invite.workspace_id)
    .eq('user_id', input.userId)
    .maybeSingle();

  if (existingMember) {
    throw new Error('You are already a member of this workspace.');
  }

  await supabase.schema('app').from('workspace_members').upsert(
    {
      workspace_id: invite.workspace_id,
      user_id: input.userId,
      role: invite.role
    },
    { onConflict: 'workspace_id,user_id' }
  );

  await supabase
    .schema('app')
    .from('workspace_invites')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invite.id);

  await logAuditEvent({
    workspaceId: invite.workspace_id,
    actorType: 'user',
    actorUserId: input.userId,
    action: 'workspace.invite_accepted',
    resourceType: 'workspace_invite',
    resourceId: invite.id,
    metadata: { email: invite.email, role: invite.role }
  });

  return invite;
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
