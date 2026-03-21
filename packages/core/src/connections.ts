import { randomUUID } from 'node:crypto';
import type {
  AuditActorType,
  AuditLogRecord,
  ConnectionJobRecord,
  ConnectionJobStatus,
  ConnectionRecord,
  ConnectionScope,
  Json,
  ProviderId,
  ProviderTokenSet,
  ResolvedConnectionCredentials,
  ToolInvocationRecord
} from '@plusmy/contracts';
import { getIntegration } from '@plusmy/integrations';
import { createServiceRoleClient } from '@plusmy/supabase';

const REFRESH_SKEW_MS = 5 * 60 * 1000;

export interface AuditLogFilters {
  limit?: number;
  status?: string | null;
  actorType?: AuditActorType | null;
  actorClientId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  actionPrefix?: string | null;
  clientId?: string | null;
}

export interface ToolInvocationFilters {
  limit?: number;
  status?: string | null;
  provider?: string | null;
  toolName?: string | null;
  actorClientId?: string | null;
  actorUserId?: string | null;
}

export interface ConnectionJobFilters {
  limit?: number;
  status?: ConnectionJobStatus | null;
  jobType?: string | null;
  connectionId?: string | null;
}

function normalizeLimit(value: number | null | undefined, fallback: number) {
  const limit = Number(value ?? fallback);
  if (!Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(Math.trunc(limit), 1), 200);
}

function auditRecordClientId(record: AuditLogRecord) {
  if (record.actor_client_id) return record.actor_client_id;
  const metadata = record.metadata;
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') return null;
  const value = metadata.client_id;
  return typeof value === 'string' ? value : null;
}

function asJsonObject(value: Json | null | undefined) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return {} as Record<string, Json>;
  }

  return value as Record<string, Json>;
}

function calculateRetryDelaySeconds(attempts: number) {
  return Math.min(60 * 2 ** Math.max(attempts - 1, 0), 60 * 60);
}

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
  actorType: AuditActorType;
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

export async function listConnectionJobs(workspaceId: string, optionsOrLimit: number | ConnectionJobFilters = 25) {
  const supabase = createServiceRoleClient();
  const options = typeof optionsOrLimit === 'number' ? { limit: optionsOrLimit } : optionsOrLimit;
  const limit = normalizeLimit(options.limit, 25);

  const { data: connections } = await supabase.schema('app').from('connections').select('id').eq('workspace_id', workspaceId);
  const connectionIds = (connections ?? []).map((connection) => String(connection.id ?? ''));
  if (connectionIds.length === 0) return [] as ConnectionJobRecord[];

  let query = supabase
    .schema('app')
    .from('connection_sync_jobs')
    .select('*')
    .in('connection_id', connectionIds)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (options.status) {
    query = query.eq('status', options.status);
  }

  if (options.jobType) {
    query = query.eq('job_type', options.jobType);
  }

  if (options.connectionId) {
    query = query.eq('connection_id', options.connectionId);
  }

  const { data } = await query;
  return (data ?? []) as ConnectionJobRecord[];
}

export async function scheduleConnectionJob(input: {
  connectionId: string;
  jobType: string;
  payload?: Record<string, Json>;
  runAfter?: string | null;
  maxAttempts?: number;
  actorUserId?: string | null;
}) {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.schema('app').rpc('schedule_connection_job', {
    p_connection_id: input.connectionId,
    p_job_type: input.jobType,
    p_payload: input.payload ?? {},
    p_run_after: input.runAfter ?? new Date().toISOString(),
    p_max_attempts: input.maxAttempts ?? 3
  });
  if (error) throw error;

  const jobId = String(data ?? '');
  const connection = await getConnectionById(input.connectionId);
  if (connection) {
    await logAuditEvent({
      workspaceId: connection.workspace_id,
      actorType: input.actorUserId ? 'user' : 'system',
      actorUserId: input.actorUserId ?? null,
      action: 'connection_job.queued',
      resourceType: 'connection_job',
      resourceId: jobId,
      metadata: {
        connection_id: input.connectionId,
        job_type: input.jobType,
        run_after: input.runAfter ?? null,
        max_attempts: input.maxAttempts ?? 3
      }
    });
  }

  return jobId;
}

export async function scheduleConnectionSyncJob(input: {
  connectionId: string;
  actorUserId?: string | null;
  payload?: Record<string, Json>;
}) {
  return await scheduleConnectionJob({
    connectionId: input.connectionId,
    jobType: 'sync_connection',
    payload: input.payload,
    maxAttempts: 4,
    actorUserId: input.actorUserId ?? null
  });
}

export async function scheduleTokenRefreshJob(connectionId: string, expiresAt: string | null | undefined, reason = 'scheduled') {
  if (!expiresAt) return null;

  const refreshAt = new Date(expiresAt).getTime() - REFRESH_SKEW_MS;
  const runAfter = new Date(Math.max(refreshAt, Date.now())).toISOString();

  return await scheduleConnectionJob({
    connectionId,
    jobType: 'token_refresh',
    payload: { reason, expires_at: expiresAt },
    runAfter,
    maxAttempts: 5
  });
}

async function cancelActiveConnectionJobs(connectionId: string, reason: string, jobType?: string | null) {
  const supabase = createServiceRoleClient();
  let query = supabase
    .schema('app')
    .from('connection_sync_jobs')
    .update({
      status: 'canceled',
      worker_id: null,
      completed_at: new Date().toISOString(),
      last_error: reason
    })
    .eq('connection_id', connectionId)
    .in('status', ['queued', 'processing']);

  if (jobType) {
    query = query.eq('job_type', jobType);
  }

  await query;
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
  await cancelActiveConnectionJobs(connectionId, reason, 'token_refresh');
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
  scheduleTokenRefreshJob?: boolean;
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

  if (input.scheduleTokenRefreshJob !== false && input.credentials.refreshToken && input.credentials.expiresAt) {
    await scheduleTokenRefreshJob(connection.id, input.credentials.expiresAt, existingConnection ? 'credential_updated' : 'connection_installed');
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

async function performRefresh(
  connection: ConnectionRecord,
  credentials: ResolvedConnectionCredentials,
  options?: { scheduleNextJob?: boolean }
) {
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
      metadata: (connection.metadata as Record<string, unknown>) ?? {},
      scheduleTokenRefreshJob: false
    });

    if (options?.scheduleNextJob !== false && refreshed.expiresAt) {
      await scheduleTokenRefreshJob(connection.id, refreshed.expiresAt, 'scheduled_after_refresh');
    }

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

export async function forceRefreshConnection(connectionId: string, options?: { scheduleNextJob?: boolean }) {
  const connection = await getConnectionById(connectionId);
  if (!connection) throw new Error('Connection not found.');
  const credentials = await resolveConnectionCredentials(connectionId);
  return await performRefresh(connection, credentials, options);
}

async function finalizeConnectionJob(input: {
  jobId: string;
  status: ConnectionJobStatus;
  lastError?: string | null;
  workerId?: string | null;
  runAfter?: string | null;
}) {
  const supabase = createServiceRoleClient();
  const completed = input.status === 'succeeded' || input.status === 'failed' || input.status === 'canceled';
  await supabase
    .schema('app')
    .from('connection_sync_jobs')
    .update({
      status: input.status,
      last_error: input.lastError ?? null,
      worker_id: input.workerId ?? null,
      run_after: input.runAfter ?? undefined,
      started_at: input.status === 'queued' ? null : undefined,
      completed_at: completed ? new Date().toISOString() : null
    })
    .eq('id', input.jobId);
}

async function runConnectionSyncJob(job: ConnectionJobRecord, connection: ConnectionRecord) {
  const supabase = createServiceRoleClient();
  const integration = getIntegration(connection.provider);
  if (!integration) {
    throw new Error(`Unsupported provider ${connection.provider}.`);
  }

  const credentials = await resolveConnectionCredentials(connection.id);
  const freshCredentials = await refreshConnectionIfNeeded(connection, credentials);
  const handler = integration.syncJobs?.find((entry) => entry.jobType === job.job_type);
  if (!handler && job.job_type !== 'sync_connection') {
    throw new Error(`Unsupported connection job type ${job.job_type}.`);
  }
  const payload = asJsonObject(job.payload);
  const result = handler
    ? await handler.run({
        connection,
        credentials: freshCredentials,
        payload
      })
    : null;

  const metadata = {
    ...asJsonObject(connection.metadata),
    ...(result?.metadata ?? {}),
    sync: {
      completed_at: new Date().toISOString(),
      job_id: job.id,
      job_type: job.job_type,
      payload
    }
  } satisfies Record<string, Json>;

  const update: Record<string, unknown> = {
    last_validated_at: new Date().toISOString(),
    metadata,
    reauth_required_reason: null
  };

  if (connection.status !== 'revoked') {
    update.status = 'active';
  }

  if (result?.displayName) {
    update.display_name = result.displayName;
  }

  if (result?.externalAccountId) {
    update.external_account_id = result.externalAccountId;
  }

  if (result && 'externalAccountEmail' in result) {
    update.external_account_email = result.externalAccountEmail ?? null;
  }

  await supabase.schema('app').from('connections').update(update).eq('id', connection.id);
}

export async function processDueConnectionJobs(input?: { limit?: number; workerId?: string }) {
  const supabase = createServiceRoleClient();
  const workerId = input?.workerId ?? randomUUID();
  const limit = normalizeLimit(input?.limit, 10);
  const { data, error } = await supabase.schema('app').rpc('claim_connection_sync_jobs', {
    p_worker_id: workerId,
    p_limit: limit
  });
  if (error) throw error;

  const jobs = (data ?? []) as ConnectionJobRecord[];
  const processed: Array<{ id: string; status: ConnectionJobStatus; jobType: string; connectionId: string }> = [];

  for (const job of jobs) {
    const connection = await getConnectionById(job.connection_id);
    if (!connection) {
      await finalizeConnectionJob({
        jobId: job.id,
        status: 'failed',
        lastError: 'Connection not found.',
        workerId
      });
      processed.push({ id: job.id, status: 'failed', jobType: job.job_type, connectionId: job.connection_id });
      continue;
    }

    try {
      if (job.job_type === 'token_refresh') {
        await forceRefreshConnection(job.connection_id, { scheduleNextJob: false });
      } else {
        await runConnectionSyncJob(job, connection);
      }

      await finalizeConnectionJob({
        jobId: job.id,
        status: 'succeeded',
        workerId
      });

      if (job.job_type === 'token_refresh') {
        const refreshedConnection = await getConnectionById(job.connection_id);
        if (refreshedConnection?.expires_at) {
          await scheduleTokenRefreshJob(job.connection_id, refreshedConnection.expires_at, 'scheduled_after_refresh');
        }
      }

      await logAuditEvent({
        workspaceId: connection.workspace_id,
        actorType: 'system',
        action: 'connection_job.succeeded',
        resourceType: 'connection_job',
        resourceId: job.id,
        metadata: {
          connection_id: job.connection_id,
          job_type: job.job_type,
          attempts: job.attempts
        }
      });

      processed.push({ id: job.id, status: 'succeeded', jobType: job.job_type, connectionId: job.connection_id });
    } catch (error) {
      const latestConnection = await getConnectionById(job.connection_id);
      const shouldRetry =
        job.attempts < job.max_attempts &&
        latestConnection?.status !== 'reauth_required' &&
        latestConnection?.status !== 'revoked';
      const message = error instanceof Error ? error.message : 'Connection job failed.';

      if (shouldRetry) {
        const retryDelaySeconds = calculateRetryDelaySeconds(job.attempts);
        await finalizeConnectionJob({
          jobId: job.id,
          status: 'queued',
          lastError: message,
          workerId: null,
          runAfter: new Date(Date.now() + retryDelaySeconds * 1000).toISOString()
        });
        await logAuditEvent({
          workspaceId: connection.workspace_id,
          actorType: 'system',
          action: 'connection_job.retry_scheduled',
          resourceType: 'connection_job',
          resourceId: job.id,
          status: 'error',
          metadata: {
            connection_id: job.connection_id,
            job_type: job.job_type,
            attempts: job.attempts,
            retry_delay_seconds: retryDelaySeconds,
            error: message
          }
        });
        processed.push({ id: job.id, status: 'queued', jobType: job.job_type, connectionId: job.connection_id });
        continue;
      }

      await finalizeConnectionJob({
        jobId: job.id,
        status: latestConnection?.status === 'revoked' ? 'canceled' : 'failed',
        lastError: message,
        workerId
      });
      await logAuditEvent({
        workspaceId: connection.workspace_id,
        actorType: 'system',
        action: 'connection_job.failed',
        resourceType: 'connection_job',
        resourceId: job.id,
        status: 'error',
        metadata: {
          connection_id: job.connection_id,
          job_type: job.job_type,
          attempts: job.attempts,
          error: message
        }
      });
      processed.push({
        id: job.id,
        status: latestConnection?.status === 'revoked' ? 'canceled' : 'failed',
        jobType: job.job_type,
        connectionId: job.connection_id
      });
    }
  }

  return {
    workerId,
    claimed: jobs.length,
    processed
  };
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
  actorUserId?: string | null;
  actorClientId?: string | null;
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
    actor_user_id: input.actorUserId ?? null,
    actor_client_id: input.actorClientId ?? null,
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

export async function listAuditLogs(workspaceId: string, optionsOrLimit: number | AuditLogFilters = 25) {
  const supabase = createServiceRoleClient();
  const options = typeof optionsOrLimit === 'number' ? { limit: optionsOrLimit } : optionsOrLimit;
  const limit = normalizeLimit(options.limit, 25);
  const queryLimit = options.clientId && !options.actorClientId ? Math.min(limit * 4, 200) : limit;

  let query = supabase
    .schema('app')
    .from('audit_logs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(queryLimit);

  if (options.status) {
    query = query.eq('status', options.status);
  }

  if (options.actorType) {
    query = query.eq('actor_type', options.actorType);
  }

  if (options.actorClientId) {
    query = query.eq('actor_client_id', options.actorClientId);
  }

  if (options.resourceType) {
    query = query.eq('resource_type', options.resourceType);
  }

  if (options.resourceId) {
    query = query.eq('resource_id', options.resourceId);
  }

  if (options.actionPrefix) {
    query = query.ilike('action', `${options.actionPrefix}%`);
  }

  const { data } = await query;
  let rows = (data ?? []) as AuditLogRecord[];

  if (options.clientId) {
    rows = rows.filter((record) => auditRecordClientId(record) === options.clientId);
  }

  return rows.slice(0, limit);
}

export async function listToolInvocations(workspaceId: string, optionsOrLimit: number | ToolInvocationFilters = 25) {
  const supabase = createServiceRoleClient();
  const options = typeof optionsOrLimit === 'number' ? { limit: optionsOrLimit } : optionsOrLimit;
  const limit = normalizeLimit(options.limit, 25);

  let query = supabase
    .schema('app')
    .from('tool_invocations')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (options.status) {
    query = query.eq('status', options.status);
  }

  if (options.provider) {
    query = query.eq('provider', options.provider);
  }

  if (options.toolName) {
    query = query.eq('tool_name', options.toolName);
  }

  if (options.actorClientId) {
    query = query.eq('actor_client_id', options.actorClientId);
  }

  if (options.actorUserId) {
    query = query.eq('actor_user_id', options.actorUserId);
  }

  const { data } = await query;
  return (data ?? []) as ToolInvocationRecord[];
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
  await cancelActiveConnectionJobs(input.connectionId, 'Connection revoked by workspace operator.');

  await logAuditEvent({
    workspaceId: input.workspaceId,
    actorType: 'user',
    actorUserId: input.actorUserId,
    action: 'connection.revoked',
    resourceType: 'connection',
    resourceId: input.connectionId
  });
}
