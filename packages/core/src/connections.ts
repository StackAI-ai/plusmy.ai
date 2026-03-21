import { randomUUID } from 'node:crypto';
import type { ConnectionRecord, ConnectionScope, ProviderId, ProviderTokenSet, ResolvedConnectionCredentials } from '@plusmy/contracts';
import { getIntegration } from '@plusmy/integrations';
import { createServiceRoleClient } from '@plusmy/supabase';

const REFRESH_SKEW_MS = 5 * 60 * 1000;

export function buildConnectionKey(input: {
  workspaceId: string;
  provider: ProviderId;
  scope: ConnectionScope;
  ownerUserId?: string | null;
  externalAccountId?: string | null;
}) {
  return [
    input.workspaceId,
    input.provider,
    input.scope,
    input.scope === 'personal' ? input.ownerUserId ?? 'none' : 'workspace',
    input.externalAccountId ?? 'default'
  ].join(':');
}

export async function logAuditEvent(input: {
  workspaceId: string;
  actorType: 'user' | 'mcp_client' | 'system';
  actorUserId?: string | null;
  actorClientId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  status?: string;
  metadata?: Record<string, unknown>;
}) {
  const supabase = createServiceRoleClient();
  await supabase.schema('app').from('audit_logs').insert({
    workspace_id: input.workspaceId,
    actor_type: input.actorType,
    actor_user_id: input.actorUserId ?? null,
    actor_client_id: input.actorClientId ?? null,
    action: input.action,
    resource_type: input.resourceType,
    resource_id: input.resourceId ?? null,
    status: input.status ?? 'success',
    metadata: input.metadata ?? {}
  });
}

async function putSecret(existingSecretId: string | null | undefined, value: string | null | undefined, name: string, description: string) {
  if (!value) return existingSecretId ?? null;
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.schema('app').rpc('put_secret', {
    p_secret: value,
    p_existing_secret_id: existingSecretId ?? null,
    p_name: name,
    p_description: description
  });
  if (error) throw error;
  return data as string;
}

async function resolveSecret(secretId: string | null | undefined) {
  if (!secretId) return null;
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.schema('app').rpc('resolve_secret', {
    p_secret_id: secretId
  });
  if (error) throw error;
  return (data as string | null) ?? null;
}

export async function listConnectionsForWorkspace(workspaceId: string, userId?: string | null) {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .schema('app')
    .from('connections')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });

  const rows = (data ?? []) as ConnectionRecord[];
  return rows.filter((row) => row.scope === 'workspace' || row.owner_user_id === userId);
}

export async function getConnectionById(connectionId: string) {
  const supabase = createServiceRoleClient();
  const { data } = await supabase.schema('app').from('connections').select('*').eq('id', connectionId).maybeSingle();
  return (data as ConnectionRecord | null) ?? null;
}

export async function pickConnectionForProvider(workspaceId: string, userId: string | null | undefined, provider: ProviderId) {
  const connections = await listConnectionsForWorkspace(workspaceId, userId);
  const ranked = connections
    .filter((connection) => connection.provider === provider && connection.status === 'active')
    .sort((left, right) => {
      if (left.scope === right.scope) return 0;
      return left.scope === 'personal' ? -1 : 1;
    });

  return ranked[0] ?? null;
}

export async function resolveConnectionCredentials(connectionId: string): Promise<ResolvedConnectionCredentials> {
  const supabase = createServiceRoleClient();
  const { data: credentialRow } = await supabase
    .schema('app')
    .from('connection_credentials')
    .select('*')
    .eq('connection_id', connectionId)
    .maybeSingle();

  if (!credentialRow) return {};

  return {
    accessToken: await resolveSecret(credentialRow.access_token_secret_id),
    refreshToken: await resolveSecret(credentialRow.refresh_token_secret_id),
    apiKey: await resolveSecret(credentialRow.api_key_secret_id),
    tokenType: credentialRow.token_type,
    expiresAt: credentialRow.expires_at
  };
}

export async function markConnectionReauthRequired(connectionId: string, reason: string) {
  const supabase = createServiceRoleClient();
  await supabase
    .schema('app')
    .from('connections')
    .update({ status: 'reauth_required', reauth_required_reason: reason })
    .eq('id', connectionId);
}

export async function upsertInstalledConnection(input: {
  workspaceId: string;
  ownerUserId: string | null;
  provider: ProviderId;
  scope: ConnectionScope;
  externalAccountId: string;
  externalAccountEmail: string | null;
  displayName: string;
  grantedScopes: string[];
  credentials: ProviderTokenSet;
  metadata?: Record<string, unknown>;
}) {
  const supabase = createServiceRoleClient();
  const connectionKey = buildConnectionKey({
    workspaceId: input.workspaceId,
    provider: input.provider,
    scope: input.scope,
    ownerUserId: input.ownerUserId,
    externalAccountId: input.externalAccountId
  });

  const { data: existingConnection } = await supabase
    .schema('app')
    .from('connections')
    .select('id')
    .eq('connection_key', connectionKey)
    .maybeSingle();

  const { data: connection, error } = await supabase
    .schema('app')
    .from('connections')
    .upsert(
      {
        connection_key: connectionKey,
        workspace_id: input.workspaceId,
        owner_user_id: input.ownerUserId,
        provider: input.provider,
        scope: input.scope,
        status: 'active',
        display_name: input.displayName,
        external_account_id: input.externalAccountId,
        external_account_email: input.externalAccountEmail,
        granted_scopes: input.grantedScopes,
        expires_at: input.credentials.expiresAt ?? null,
        reauth_required_reason: null,
        last_refreshed_at: new Date().toISOString(),
        last_validated_at: new Date().toISOString(),
        metadata: input.metadata ?? {}
      },
      { onConflict: 'connection_key' }
    )
    .select('*')
    .single();

  if (error || !connection) {
    throw error ?? new Error('Failed to upsert connection.');
  }

  const { data: existingCredentials } = await supabase
    .schema('app')
    .from('connection_credentials')
    .select('*')
    .eq('connection_id', connection.id)
    .maybeSingle();

  const accessTokenSecretId = await putSecret(existingCredentials?.access_token_secret_id, input.credentials.accessToken, `${connection.id}-access-token`, `${input.provider} access token`);
  const refreshTokenSecretId = await putSecret(existingCredentials?.refresh_token_secret_id, input.credentials.refreshToken, `${connection.id}-refresh-token`, `${input.provider} refresh token`);
  const apiKeySecretId = await putSecret(existingCredentials?.api_key_secret_id, input.credentials.apiKey, `${connection.id}-api-key`, `${input.provider} api key`);

  await supabase.schema('app').from('connection_credentials').upsert(
    {
      connection_id: connection.id,
      access_token_secret_id: accessTokenSecretId,
      refresh_token_secret_id: refreshTokenSecretId,
      api_key_secret_id: apiKeySecretId,
      token_type: input.credentials.tokenType ?? 'Bearer',
      expires_at: input.credentials.expiresAt ?? null,
      version: existingCredentials ? Number(existingCredentials.version ?? 0) + 1 : 1
    },
    { onConflict: 'connection_id' }
  );

  await supabase.schema('app').from('connection_grants').delete().eq('connection_id', connection.id);
  if (input.grantedScopes.length) {
    await supabase.schema('app').from('connection_grants').insert(
      input.grantedScopes.map((scope) => ({ connection_id: connection.id, scope, granted: true }))
    );
  }

  await logAuditEvent({
    workspaceId: input.workspaceId,
    actorType: 'system',
    action: existingConnection ? 'connection.updated' : 'connection.created',
    resourceType: 'connection',
    resourceId: connection.id,
    metadata: { provider: input.provider, scope: input.scope }
  });

  return connection as ConnectionRecord;
}

async function acquireRefreshLock(connectionId: string) {
  const supabase = createServiceRoleClient();
  const lockId = randomUUID();
  const { data, error } = await supabase.schema('app').rpc('acquire_connection_refresh_lock', {
    p_connection_id: connectionId,
    p_lock_id: lockId,
    p_ttl_seconds: 30
  });
  if (error) throw error;
  return data ? lockId : null;
}

async function releaseRefreshLock(connectionId: string, lockId: string) {
  const supabase = createServiceRoleClient();
  await supabase.schema('app').rpc('release_connection_refresh_lock', {
    p_connection_id: connectionId,
    p_lock_id: lockId
  });
}

async function performRefresh(connection: ConnectionRecord, credentials: ResolvedConnectionCredentials) {
  const integration = getIntegration(connection.provider);
  if (!integration) return credentials;
  if (!credentials.refreshToken) throw new Error('Missing refresh token.');

  const lockId = await acquireRefreshLock(connection.id);
  if (!lockId) return credentials;

  try {
    const refreshed = await integration.refreshTokens({ refreshToken: credentials.refreshToken });
    await upsertInstalledConnection({
      workspaceId: connection.workspace_id,
      ownerUserId: connection.owner_user_id,
      provider: connection.provider,
      scope: connection.scope,
      externalAccountId: connection.external_account_id ?? `${connection.provider}-account`,
      externalAccountEmail: connection.external_account_email,
      displayName: connection.display_name,
      grantedScopes: refreshed.scopes,
      credentials: refreshed,
      metadata: (connection.metadata as Record<string, unknown>) ?? {}
    });

    return {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      apiKey: refreshed.apiKey,
      tokenType: refreshed.tokenType,
      expiresAt: refreshed.expiresAt
    } satisfies ResolvedConnectionCredentials;
  } catch (error) {
    await markConnectionReauthRequired(connection.id, error instanceof Error ? error.message : 'Token refresh failed.');
    await logAuditEvent({
      workspaceId: connection.workspace_id,
      actorType: 'system',
      action: 'connection.reauth_required',
      resourceType: 'connection',
      resourceId: connection.id,
      status: 'error',
      metadata: { reason: error instanceof Error ? error.message : 'Token refresh failed.' }
    });
    throw error;
  } finally {
    await releaseRefreshLock(connection.id, lockId);
  }
}

export async function refreshConnectionIfNeeded(connection: ConnectionRecord, credentials: ResolvedConnectionCredentials) {
  if (!credentials.accessToken || !credentials.expiresAt) return credentials;
  const expiresAt = new Date(credentials.expiresAt).getTime();
  if (expiresAt - Date.now() > REFRESH_SKEW_MS) return credentials;
  if (!credentials.refreshToken) return credentials;
  return await performRefresh(connection, credentials);
}

export async function forceRefreshConnection(connectionId: string) {
  const connection = await getConnectionById(connectionId);
  if (!connection) throw new Error('Connection not found.');
  const credentials = await resolveConnectionCredentials(connectionId);
  return await performRefresh(connection, credentials);
}

export async function resolveProviderExecutionContext(workspaceId: string, userId: string | null | undefined, provider: ProviderId) {
  const connection = await pickConnectionForProvider(workspaceId, userId, provider);
  if (!connection) {
    throw new Error(`No active ${provider} connection available for this workspace.`);
  }
  const credentials = await resolveConnectionCredentials(connection.id);
  const freshCredentials = await refreshConnectionIfNeeded(connection, credentials);
  return { connection, credentials: freshCredentials };
}

export async function recordToolInvocation(input: {
  workspaceId: string;
  connectionId: string;
  provider: string;
  toolName: string;
  status: string;
  latencyMs: number;
  requestPayload?: Record<string, unknown>;
  responsePayload?: Record<string, unknown>;
  errorMessage?: string | null;
}) {
  const supabase = createServiceRoleClient();
  await supabase.schema('app').from('tool_invocations').insert({
    workspace_id: input.workspaceId,
    connection_id: input.connectionId,
    provider: input.provider,
    tool_name: input.toolName,
    status: input.status,
    latency_ms: input.latencyMs,
    input: input.requestPayload ?? {},
    output: input.responsePayload ?? {},
    error_message: input.errorMessage ?? null
  });
}

export async function consumeRateLimit(input: {
  workspaceId: string;
  subject: string;
  action: string;
  windowSeconds: number;
  limit: number;
}) {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.schema('app').rpc('consume_rate_limit', {
    p_workspace_id: input.workspaceId,
    p_subject: input.subject,
    p_action: input.action,
    p_window_seconds: input.windowSeconds,
    p_limit: input.limit
  });
  if (error) throw error;
  return data as { allowed: boolean; remaining: number; count: number };
}

export async function listAuditLogs(workspaceId: string, limit = 25) {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .schema('app')
    .from('audit_logs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit);

  return data ?? [];
}

export async function revokeConnection(input: {
  workspaceId: string;
  connectionId: string;
  actorUserId: string;
}) {
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .schema('app')
    .from('connections')
    .update({
      status: 'revoked',
      reauth_required_reason: 'Connection revoked by workspace operator.'
    })
    .eq('id', input.connectionId)
    .eq('workspace_id', input.workspaceId);

  if (error) throw error;

  await logAuditEvent({
    workspaceId: input.workspaceId,
    actorType: 'user',
    actorUserId: input.actorUserId,
    action: 'connection.revoked',
    resourceType: 'connection',
    resourceId: input.connectionId
  });
}
