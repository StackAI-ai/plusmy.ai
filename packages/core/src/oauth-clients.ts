import { nanoid } from 'nanoid';
import { createServiceRoleClient } from '@plusmy/supabase';
import { hashOpaqueToken } from './auth-context';
import { registerDynamicClient } from './oauth';
import { logAuditEvent } from './connections';
import type { OAuthClientApprovalRecord, OAuthClientRegistrationInput } from '@plusmy/contracts';

const approvalSelect =
  'id,client_id,workspace_id,user_id,scopes,status,approved_at,last_used_at,revoked_at,metadata,created_at,updated_at,oauth_clients(client_name,token_endpoint_auth_method)';

function mapApprovalRecord(row: Record<string, unknown>): OAuthClientApprovalRecord {
  const client = Array.isArray(row.oauth_clients) ? row.oauth_clients[0] : row.oauth_clients;

  return {
    id: String(row.id),
    client_id: String(row.client_id),
    workspace_id: String(row.workspace_id),
    user_id: String(row.user_id),
    scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : [],
    status: String(row.status) as OAuthClientApprovalRecord['status'],
    approved_at: String(row.approved_at),
    last_used_at: row.last_used_at ? String(row.last_used_at) : null,
    revoked_at: row.revoked_at ? String(row.revoked_at) : null,
    metadata: (row.metadata as OAuthClientApprovalRecord['metadata']) ?? {},
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    client_name:
      client && typeof client === 'object' && 'client_name' in client && typeof client.client_name === 'string'
        ? client.client_name
        : null,
    token_endpoint_auth_method:
      client &&
      typeof client === 'object' &&
      'token_endpoint_auth_method' in client &&
      typeof client.token_endpoint_auth_method === 'string'
        ? client.token_endpoint_auth_method
        : null
  };
}

type WorkspaceMemberIdentity = {
  user_id: string;
  profile: {
    display_name: string | null;
    avatar_url: string | null;
  } | null;
};

type RefreshTokenTelemetry = {
  latest_refresh_token_issued_at: string | null;
  latest_refresh_token_expires_at: string | null;
  latest_refresh_token_revoked_at: string | null;
};

async function listWorkspaceMemberIdentities(workspaceId: string) {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .schema('app')
    .from('workspace_members')
    .select('user_id,profile:profiles(display_name,avatar_url)')
    .eq('workspace_id', workspaceId);

  return (data ?? []).map((entry) => ({
    user_id: String(entry.user_id),
    profile: Array.isArray(entry.profile) ? entry.profile[0] ?? null : entry.profile
  })) as WorkspaceMemberIdentity[];
}

function enrichApprovalWithIdentity(
  approval: OAuthClientApprovalRecord,
  identities: Map<string, WorkspaceMemberIdentity>
): OAuthClientApprovalRecord {
  const identity = identities.get(approval.user_id);
  return {
    ...approval,
    approved_by_display_name: identity?.profile?.display_name ?? null,
    approved_by_avatar_url: identity?.profile?.avatar_url ?? null
  };
}

async function listApprovalRefreshTokenTelemetry(workspaceId: string) {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .schema('app')
    .from('oauth_refresh_tokens')
    .select('client_id,user_id,workspace_id,created_at,expires_at,revoked_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });

  const telemetry = new Map<string, RefreshTokenTelemetry>();
  for (const row of data ?? []) {
    const key = `${row.client_id}:${row.workspace_id}:${row.user_id}`;
    if (telemetry.has(key)) continue;
    telemetry.set(key, {
      latest_refresh_token_issued_at: row.created_at ? String(row.created_at) : null,
      latest_refresh_token_expires_at: row.expires_at ? String(row.expires_at) : null,
      latest_refresh_token_revoked_at: row.revoked_at ? String(row.revoked_at) : null
    });
  }

  return telemetry;
}

function enrichApprovalWithRefreshTokenTelemetry(
  approval: OAuthClientApprovalRecord,
  telemetry: Map<string, RefreshTokenTelemetry>
): OAuthClientApprovalRecord {
  const key = `${approval.client_id}:${approval.workspace_id}:${approval.user_id}`;
  const entry = telemetry.get(key);
  return {
    ...approval,
    latest_refresh_token_issued_at: entry?.latest_refresh_token_issued_at ?? null,
    latest_refresh_token_expires_at: entry?.latest_refresh_token_expires_at ?? null,
    latest_refresh_token_revoked_at: entry?.latest_refresh_token_revoked_at ?? null
  };
}

export async function listOAuthClients(createdBy: string) {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .schema('app')
    .from('oauth_clients')
    .select('client_id,client_name,redirect_uris,grant_types,response_types,token_endpoint_auth_method,created_at')
    .eq('created_by', createdBy)
    .order('created_at', { ascending: false });

  return data ?? [];
}

export async function createOAuthClient(createdBy: string, input: OAuthClientRegistrationInput) {
  return await registerDynamicClient(input, createdBy);
}

export async function rotateOAuthClientSecret(input: { clientId: string; actorUserId: string }) {
  const supabase = createServiceRoleClient();
  const { data: client } = await supabase
    .schema('app')
    .from('oauth_clients')
    .select('client_id,client_name,token_endpoint_auth_method,created_by,metadata')
    .eq('client_id', input.clientId)
    .maybeSingle();

  if (!client) {
    throw new Error('OAuth client not found.');
  }

  if (client.created_by == null || String(client.created_by) !== input.actorUserId) {
    throw new Error('forbidden');
  }

  const authMethod = String(client.token_endpoint_auth_method ?? 'none');
  if (authMethod === 'none') {
    throw new Error('Client does not use a secret.');
  }

  const rotatedAt = new Date().toISOString();
  const clientSecret = nanoid(48);
  const metadata =
    client.metadata && typeof client.metadata === 'object' && !Array.isArray(client.metadata)
      ? { ...(client.metadata as Record<string, unknown>) }
      : {};

  metadata.last_secret_rotation_at = rotatedAt;
  metadata.last_secret_rotation_by = input.actorUserId;

  const { error } = await supabase
    .schema('app')
    .from('oauth_clients')
    .update({
      client_secret_hash: hashOpaqueToken(clientSecret),
      metadata
    })
    .eq('client_id', input.clientId);

  if (error) {
    throw error;
  }

  const { data: approvals } = await supabase
    .schema('app')
    .from('oauth_client_approvals')
    .select('workspace_id')
    .eq('client_id', input.clientId);

  const workspaceIds = Array.from(new Set((approvals ?? []).map((entry) => String(entry.workspace_id))));
  for (const workspaceId of workspaceIds) {
    await logAuditEvent({
      workspaceId,
      actorType: 'user',
      actorUserId: input.actorUserId,
      action: 'oauth_client.secret_rotated',
      resourceType: 'oauth_client',
      resourceId: String(client.client_id),
      metadata: {
        client_id: input.clientId,
        token_endpoint_auth_method: authMethod,
        rotated_at: rotatedAt
      }
    });
  }

  return {
    client_id: String(client.client_id),
    client_name: String(client.client_name),
    token_endpoint_auth_method: authMethod,
    rotated_at: rotatedAt,
    client_secret: clientSecret
  };
}

export async function getOAuthClientApproval(input: {
  clientId: string;
  workspaceId: string;
  userId: string;
}) {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .schema('app')
    .from('oauth_client_approvals')
    .select(approvalSelect)
    .eq('client_id', input.clientId)
    .eq('workspace_id', input.workspaceId)
    .eq('user_id', input.userId)
    .maybeSingle();

  const approval = data ? mapApprovalRecord(data as Record<string, unknown>) : null;
  if (!approval) return null;

  const identities = await listWorkspaceMemberIdentities(input.workspaceId);
  const identityMap = new Map(identities.map((entry) => [entry.user_id, entry]));
  const telemetry = await listApprovalRefreshTokenTelemetry(input.workspaceId);
  return enrichApprovalWithRefreshTokenTelemetry(enrichApprovalWithIdentity(approval, identityMap), telemetry);
}

export async function getOAuthClientApprovalById(approvalId: string) {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .schema('app')
    .from('oauth_client_approvals')
    .select(approvalSelect)
    .eq('id', approvalId)
    .maybeSingle();

  const approval = data ? mapApprovalRecord(data as Record<string, unknown>) : null;
  if (!approval) return null;

  const identities = await listWorkspaceMemberIdentities(approval.workspace_id);
  const identityMap = new Map(identities.map((entry) => [entry.user_id, entry]));
  const telemetry = await listApprovalRefreshTokenTelemetry(approval.workspace_id);
  return enrichApprovalWithRefreshTokenTelemetry(enrichApprovalWithIdentity(approval, identityMap), telemetry);
}

export async function listOAuthClientApprovals(input: {
  workspaceId: string;
  userId: string;
  includeWorkspaceApprovals?: boolean;
  includeMemberIdentity?: boolean;
}) {
  const supabase = createServiceRoleClient();
  let query = supabase
    .schema('app')
    .from('oauth_client_approvals')
    .select(approvalSelect)
    .eq('workspace_id', input.workspaceId)
    .order('approved_at', { ascending: false });

  if (!input.includeWorkspaceApprovals) {
    query = query.eq('user_id', input.userId);
  }

  const { data } = await query;
  const approvals = (data ?? []).map((row) => mapApprovalRecord(row as Record<string, unknown>));
  if (!input.includeMemberIdentity || approvals.length === 0) {
    const telemetry = await listApprovalRefreshTokenTelemetry(input.workspaceId);
    return approvals.map((approval) => enrichApprovalWithRefreshTokenTelemetry(approval, telemetry));
  }

  const identities = await listWorkspaceMemberIdentities(input.workspaceId);
  const identityMap = new Map(identities.map((entry) => [entry.user_id, entry]));
  const telemetry = await listApprovalRefreshTokenTelemetry(input.workspaceId);
  return approvals.map((approval) =>
    enrichApprovalWithRefreshTokenTelemetry(enrichApprovalWithIdentity(approval, identityMap), telemetry)
  );
}

export async function upsertOAuthClientApproval(input: {
  clientId: string;
  workspaceId: string;
  userId: string;
  scopes: string[];
  metadata?: Record<string, unknown>;
}) {
  const supabase = createServiceRoleClient();
  const existingApproval = await getOAuthClientApproval({
    clientId: input.clientId,
    workspaceId: input.workspaceId,
    userId: input.userId
  });

  const { error } = await supabase.schema('app').from('oauth_client_approvals').upsert(
    {
      client_id: input.clientId,
      workspace_id: input.workspaceId,
      user_id: input.userId,
      scopes: input.scopes,
      status: 'active',
      approved_at: new Date().toISOString(),
      revoked_at: null,
      metadata: input.metadata ?? {}
    },
    { onConflict: 'client_id,workspace_id,user_id' }
  );

  if (error) {
    throw error;
  }

  const approval = await getOAuthClientApproval({
    clientId: input.clientId,
    workspaceId: input.workspaceId,
    userId: input.userId
  });
  if (!approval) {
    throw new Error('Approval was not persisted.');
  }

  await logAuditEvent({
    workspaceId: input.workspaceId,
    actorType: 'user',
    actorUserId: input.userId,
    action: 'oauth_client.approved',
    resourceType: 'oauth_client_approval',
    resourceId: approval.id,
    metadata: {
      client_id: input.clientId,
      scopes: input.scopes,
      renewed: existingApproval != null
    }
  });

  return approval;
}

export async function revokeOAuthClientApproval(input: {
  approvalId: string;
  workspaceId: string;
  actorUserId: string;
}) {
  const approval = await getOAuthClientApprovalById(input.approvalId);
  if (!approval) {
    throw new Error('Approval not found.');
  }

  if (approval.workspace_id !== input.workspaceId) {
    throw new Error('Approval does not belong to this workspace.');
  }

  const supabase = createServiceRoleClient();
  const revocationReason =
    input.actorUserId === approval.user_id ? 'Revoked by approving user.' : 'Revoked by workspace operator.';

  const { error } = await supabase.schema('app').rpc('revoke_oauth_client_approval', {
    p_approval_id: approval.id,
    p_workspace_id: input.workspaceId,
    p_actor_user_id: input.actorUserId,
    p_revocation_reason: revocationReason
  });

  if (error) {
    throw error;
  }

  await logAuditEvent({
    workspaceId: input.workspaceId,
    actorType: 'user',
    actorUserId: input.actorUserId,
    action: 'oauth_client.approval_revoked',
    resourceType: 'oauth_client_approval',
    resourceId: approval.id,
    metadata: {
      client_id: approval.client_id,
      approved_user_id: approval.user_id
    }
  });

  return await getOAuthClientApprovalById(approval.id);
}
