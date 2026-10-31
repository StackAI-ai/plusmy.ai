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
  ProviderHealthSnapshot,
  ProviderTokenSet,
  ResolvedConnectionCredentials,
  ToolInvocationRecord
} from '@plusmy/contracts';
import { getIntegration } from '@plusmy/integrations';
import { getServerEnv } from '@plusmy/config';
import { createServiceRoleClient } from '@plusmy/supabase';
import { sanitizeConnectionMetadata } from './connection-metadata';

const REFRESH_SKEW_MS = 5 * 60 * 1000;

export function canManageConnection(connection: ConnectionRecord, actorUserId: string, role: string | undefined) {
  return connection.scope === 'personal'
    ? connection.owner_user_id === actorUserId
    : role === 'owner' || role === 'admin';
}

export interface AuditLogFilters {
  limit?: number;
  status?: string | null;
  actorType?: AuditActorType | null;
  actorClientId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  actionPrefix?: string | null;
  clientId?: string | null;
  cursor?: string | null;
  direction?: 'next' | 'prev' | null;
}

export interface AuditExportFilters {
  limit?: number;
  status?: string | null;
  actorType?: AuditActorType | null;
  resourceType?: string | null;
  resourceId?: string | null;
  actionPrefix?: string | null;
  clientId?: string | null;
  from?: string | null;
  to?: string | null;
  order?: 'asc' | 'desc';
}

export interface ToolInvocationFilters {
  limit?: number;
  status?: string | null;
  provider?: string | null;
  toolName?: string | null;
  actorClientId?: string | null;
  actorUserId?: string | null;
  connectionId?: string | null;
  cursor?: string | null;
  direction?: 'next' | 'prev' | null;
}

export interface ToolInvocationExportFilters {
  limit?: number;
  status?: string | null;
  provider?: string | null;
  toolName?: string | null;
  actorClientId?: string | null;
  actorUserId?: string | null;
  connectionId?: string | null;
  from?: string | null;
  to?: string | null;
  order?: 'asc' | 'desc';
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

function normalizeExportLimit(value: number | null | undefined, fallback: number) {
  const limit = Number(value ?? fallback);
  if (!Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(Math.trunc(limit), 1), 10000);
}

function normalizeCursorDirection(value: 'next' | 'prev' | null | undefined) {
  return value === 'prev' ? 'prev' : 'next';
}

type CursorRecord = {
  id: string;
  created_at: string;
};

type PageInfo = {
  limit: number;
  olderCursor: string | null;
  newerCursor: string | null;
  hasOlderPage: boolean;
  hasNewerPage: boolean;
};

export interface CursorPageResult<T> {
  items: T[];
  pageInfo: PageInfo;
}

function encodeCursor(record: CursorRecord) {
  return Buffer.from(JSON.stringify({ id: record.id, created_at: record.created_at }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | null | undefined): CursorRecord | null {
  if (!cursor) return null;

  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<CursorRecord>;
    if (typeof parsed?.id !== 'string' || typeof parsed?.created_at !== 'string') {
      return null;
    }

    return { id: parsed.id, created_at: parsed.created_at };
  } catch {
    return null;
  }
}

function applyCursorFilter<T extends { or: (filter: string) => T }>(
  query: T,
  cursor: CursorRecord | null,
  direction: 'next' | 'prev'
) {
  if (!cursor) return query;

  const comparator = direction === 'prev' ? 'gt' : 'lt';
  return query.or(`created_at.${comparator}.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.${comparator}.${cursor.id})`);
}

function buildPageInfo<T extends CursorRecord>(
  items: T[],
  limit: number,
  direction: 'next' | 'prev',
  cursor: CursorRecord | null,
  hasMore: boolean
): PageInfo {
  const firstItem = items[0] ?? null;
  const lastItem = items.at(-1) ?? null;
  const hasOlderPage = direction === 'prev' ? Boolean(cursor) : hasMore;
  const hasNewerPage = direction === 'prev' ? hasMore : Boolean(cursor);

  return {
    limit,
    olderCursor: hasOlderPage && lastItem ? encodeCursor(lastItem) : null,
    newerCursor: hasNewerPage && firstItem ? encodeCursor(firstItem) : null,
    hasOlderPage,
    hasNewerPage
  };
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

function withConnectionAuditMetadata(
  connection: {
    id: string;
    provider: string;
  },
  metadata: Record<string, unknown> = {}
) {
  return {
    ...metadata,
    provider: connection.provider,
    connection_id: connection.id
  };
}

function calculateRetryDelaySeconds(jobType: string, attempts: number) {
  const normalizedAttempts = Math.max(attempts - 1, 0);
  const isTokenRefresh = jobType === 'token_refresh';
  const baseDelaySeconds = isTokenRefresh ? 5 * 60 : 60;
  const cappedDelaySeconds = isTokenRefresh ? 6 * 60 * 60 : 60 * 60;
  const exponentialDelaySeconds = Math.min(baseDelaySeconds * 2 ** normalizedAttempts, cappedDelaySeconds);
  const jitterWindowSeconds = Math.max(Math.round(exponentialDelaySeconds * 0.2), isTokenRefresh ? 30 : 10);
  const jitterOffsetSeconds = Math.floor(Math.random() * (jitterWindowSeconds * 2 + 1)) - jitterWindowSeconds;
  return Math.max(baseDelaySeconds, exponentialDelaySeconds + jitterOffsetSeconds);
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

function buildFallbackConnectionHealth(connection: ConnectionRecord): ProviderHealthSnapshot {
  const status =
    connection.status === 'reauth_required' || connection.status === 'revoked'
      ? connection.status
      : connection.status === 'active'
        ? 'healthy'
        : 'attention';

  const summaryMap: Record<ProviderHealthSnapshot['status'], string> = {
    healthy: 'Connection is active and ready for MCP tool execution.',
    attention: 'Connection is pending validation or has degraded state.',
    reauth_required: 'Connection requires reauthorization before MCP tool execution can resume.',
    revoked: 'Connection has been revoked.',
    inactive: 'Connection is inactive.'
  };

  return {
    provider: connection.provider,
    connectionId: connection.id,
    displayName: connection.display_name,
    status,
    summary: summaryMap[status],
    signals: connection.reauth_required_reason ? [connection.reauth_required_reason] : [],
    requiredScopes: [],
    missingScopes: [],
    lastValidatedAt: connection.last_validated_at
  };
}

export async function listConnectionHealthSnapshots(workspaceId: string, userId?: string | null) {
  const connections = await listConnectionsForWorkspace(workspaceId, userId);
  return await Promise.all(
    connections.map(async (connection) => {
      const integration = getIntegration(connection.provider);
      if (!integration?.health) {
        return buildFallbackConnectionHealth(connection);
      }

      try {
        return await integration.health(connection);
      } catch (error) {
        return {
          ...buildFallbackConnectionHealth(connection),
          status: connection.status === 'active' ? 'attention' : connection.status,
          summary: error instanceof Error ? error.message : 'Failed to compute provider health snapshot.',
          signals: [
            error instanceof Error ? error.message : 'Failed to compute provider health snapshot.'
          ]
        };
      }
    })
  );
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
  generation?: string;
}) {
  const supabase = createServiceRoleClient();
  const connection = await getConnectionById(input.connectionId);
  if (!connection) return null;
  const generation = input.generation ?? connection.job_generation;
  if (!generation) throw new Error('Connection job fencing migration is required.');
  const { data, error } = await supabase.schema('app').rpc('schedule_connection_job_v2', {
    p_connection_id: input.connectionId,
    p_job_type: input.jobType,
    p_payload: input.payload ?? {},
    p_run_after: input.runAfter ?? new Date().toISOString(),
    p_max_attempts: input.maxAttempts ?? 3,
    p_generation: generation
  });
  if (error) throw error;

  if (!data) return null;
  const jobId = String(data);
  if (connection) {
    await logAuditEvent({
      workspaceId: connection.workspace_id,
      actorType: input.actorUserId ? 'user' : 'system',
      actorUserId: input.actorUserId ?? null,
      action: 'connection_job.queued',
      resourceType: 'connection_job',
      resourceId: jobId,
      metadata: {
        ...withConnectionAuditMetadata(connection, {}),
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
  workspaceId: string;
  generation: string;
  actorUserId: string;
  payload?: Record<string, Json>;
}) {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.schema('app').rpc('schedule_connection_sync_for_actor', {
    p_connection_id: input.connectionId,
    p_generation: input.generation,
    p_workspace_id: input.workspaceId,
    p_actor_user_id: input.actorUserId,
    p_payload: input.payload ?? {}
  });
  if (error) throw error;
  if (!data) return null;
  if (typeof data.job_id !== 'string' || typeof data.provider !== 'string' || typeof data.run_after !== 'string') {
    throw new Error('Connection sync scheduling returned an invalid result.');
  }
  await logAuditEvent({
    workspaceId: input.workspaceId,
    actorType: 'user',
    actorUserId: input.actorUserId,
    action: 'connection_job.queued',
    resourceType: 'connection_job',
    resourceId: data.job_id,
    metadata: withConnectionAuditMetadata({ id: input.connectionId, provider: data.provider }, {
      job_type: 'sync_connection', run_after: data.run_after, max_attempts: 4
    })
  });
  return data.job_id as string;
}

export async function scheduleTokenRefreshJob(
  connectionId: string, expiresAt: string | null | undefined, reason = 'scheduled', generation?: string
) {
  if (!expiresAt) return null;

  const refreshAt = new Date(expiresAt).getTime() - REFRESH_SKEW_MS;
  const runAfter = new Date(Math.max(refreshAt, Date.now())).toISOString();

  return await scheduleConnectionJob({
    connectionId,
    jobType: 'token_refresh',
    payload: { reason, expires_at: expiresAt },
    runAfter,
    maxAttempts: 5,
    generation
  });
}

async function cancelActiveConnectionJobs(connectionId: string, generation: string, reason: string, jobType?: string | null) {
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
    .eq('connection_generation', generation)
    .in('status', ['queued', 'processing']);

  if (jobType) {
    query = query.eq('job_type', jobType);
  }

  const { error } = await query;
  if (error) throw error;
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
  const { data, error } = await supabase
    .schema('app')
    .from('connections')
    .update({ status: 'reauth_required', reauth_required_reason: reason })
    .eq('id', connectionId)
    .eq('status', 'active')
    .select('job_generation')
    .maybeSingle();
  if (error) throw error;
  if (data?.job_generation) await cancelActiveConnectionJobs(connectionId, data.job_generation, reason, 'token_refresh');
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

  const { data, error } = await supabase.schema('app').rpc('install_connection_credentials_v2', {
    p_connection_key: connectionKey,
    p_workspace_id: input.workspaceId,
    p_owner_user_id: input.ownerUserId,
    p_provider: input.provider,
    p_scope: input.scope,
    p_display_name: input.displayName,
    p_external_account_id: input.externalAccountId,
    p_external_account_email: input.externalAccountEmail,
    p_scopes: input.grantedScopes,
    p_expires_at: input.credentials.expiresAt ?? null,
    p_metadata: sanitizeConnectionMetadata(input.metadata, [
      input.credentials.accessToken, input.credentials.refreshToken, input.credentials.apiKey
    ]),
    p_access_token: input.credentials.accessToken ?? null,
    p_refresh_token: input.credentials.refreshToken ?? null,
    p_api_key: input.credentials.apiKey ?? null,
    p_token_type: input.credentials.tokenType ?? null,
    p_schedule_refresh: input.scheduleTokenRefreshJob !== false
  });
  const connection = data?.connection as ConnectionRecord | undefined;
  const existingConnection = Boolean(data?.existing);
  if (error || !connection) {
    throw new Error('Failed to install connection credentials.');
  }

  if (input.scheduleTokenRefreshJob !== false && input.credentials.refreshToken && input.credentials.expiresAt
    && (typeof data.refresh_job_id !== 'string' || typeof data.refresh_run_after !== 'string')) {
    throw new Error('Installed connection refresh scheduling could not be confirmed.');
  }
  if (data.refresh_job_id != null) {
    if (typeof data.refresh_job_id !== 'string' || typeof data.refresh_run_after !== 'string') {
      throw new Error('Installed connection refresh scheduling returned an invalid result.');
    }
    await logAuditEvent({
      workspaceId: input.workspaceId,
      actorType: 'system',
      action: 'connection_job.queued',
      resourceType: 'connection_job',
      resourceId: data.refresh_job_id,
      metadata: withConnectionAuditMetadata(connection, {
        job_type: 'token_refresh', run_after: data.refresh_run_after, max_attempts: 5
      })
    });
  }

  await logAuditEvent({
    workspaceId: input.workspaceId,
    actorType: 'system',
    action: existingConnection ? 'connection.updated' : 'connection.created',
    resourceType: 'connection',
    resourceId: connection.id,
    metadata: {
      ...withConnectionAuditMetadata(connection, {
        scope: input.scope
      })
    }
  });

  return connection as ConnectionRecord;
}

async function acquireRefreshLock(connectionId: string, job?: ConnectionJobRecord) {
  const supabase = createServiceRoleClient();
  const lockId = randomUUID();
  let data;
  try {
    const result = await supabase.schema('app').rpc(job ? 'begin_connection_job_refresh' : 'begin_connection_refresh', {
      ...(job ? { p_job_id: job.id, p_claim_id: job.claim_id } : { p_connection_id: connectionId }),
      p_lock_id: lockId,
      p_ttl_seconds: 30
    });
    if (result.error) throw result.error;
    data = result.data;
  } catch (error) {
    // The begin may have committed before its response was lost. No provider
    // request has started, so only this invocation's lease can be released.
    await releaseRefreshLock(connectionId, lockId);
    throw error;
  }
  if (data && (!data.connection || !data.credentials)) await releaseRefreshLock(connectionId, lockId);
  return data?.connection && data?.credentials
    ? { lockId, connection: data.connection as ConnectionRecord, credentials: data.credentials as ResolvedConnectionCredentials }
    : null;
}

async function releaseRefreshLock(connectionId: string, lockId: string) {
  const supabase = createServiceRoleClient();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { error } = await supabase.schema('app').rpc('release_connection_refresh_lock', {
        p_connection_id: connectionId,
        p_lock_id: lockId
      });
      if (!error) return;
    } catch {
      // A release is idempotent and matches only this lock ID.
    }
  }
  throw new Error('Connection refresh lock could not be safely released. Retry or reconnect.');
}

async function performRefresh(
  connection: ConnectionRecord,
  options?: { scheduleNextJob?: boolean; force?: boolean; job?: ConnectionJobRecord }
) {
  const integration = getIntegration(connection.provider);
  if (!integration) throw new Error('Unsupported connection provider.');

  const attempt = await acquireRefreshLock(connection.id, options?.job);
  if (!attempt) throw new Error('Connection refresh is unavailable or already in progress. Retry or reconnect.');
  const { lockId, credentials, connection: lockedConnection } = attempt;

  let providerCallStarted = false;
  let refreshed: ProviderTokenSet;
  try {
    if (!credentials.refreshToken) throw new Error('Missing refresh token.');
    if (!options?.force && credentials.expiresAt && new Date(credentials.expiresAt).getTime() - Date.now() > REFRESH_SKEW_MS) {
      return credentials;
    }

    providerCallStarted = true;
    refreshed = await integration.refreshTokens({
      refreshToken: credentials.refreshToken,
      metadata: asJsonObject(lockedConnection.metadata)
    });
    if (!refreshed.accessToken) throw new Error('Provider returned no access token.');
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase.schema('app').rpc(options?.job ? 'commit_connection_job_refresh' : 'commit_connection_refresh', {
      ...(options?.job ? { p_job_id: options.job.id, p_claim_id: options.job.claim_id } : { p_connection_id: connection.id }),
      p_lock_id: lockId,
      p_access_token: refreshed.accessToken ?? null,
      p_refresh_token: refreshed.refreshToken ?? null,
      p_api_key: refreshed.apiKey ?? null,
      p_token_type: refreshed.tokenType ?? null,
      p_expires_at: refreshed.expiresAt ?? null,
      p_scopes: refreshed.scopes
    });
    if (error || data !== 'committed') throw new Error('Connection refresh could not be committed safely.');
  } catch {
    if (providerCallStarted) {
      // Do not release an uncertain lease if this RPC fails; expiry requires reconnect.
      const supabase = createServiceRoleClient();
      const { data: marked } = await supabase.schema('app').rpc(options?.job ? 'fail_connection_job_refresh' : 'fail_connection_refresh', {
        ...(options?.job ? { p_job_id: options.job.id, p_claim_id: options.job.claim_id } : { p_connection_id: connection.id }),
        p_lock_id: lockId
      });
      if (marked) {
        await logAuditEvent({
          workspaceId: connection.workspace_id,
          actorType: 'system',
          action: 'connection.reauth_required',
          resourceType: 'connection',
          resourceId: connection.id,
          status: 'error',
          metadata: {
            ...withConnectionAuditMetadata(connection, {
              reason: 'Token refresh did not finish safely. Reconnect this account.'
            })
          }
        });
      }
      throw new Error('Connection refresh did not finish safely. Retry or reconnect.');
    }
    throw new Error('Connection credentials could not be loaded for refresh.');
  } finally {
    if (!providerCallStarted) await releaseRefreshLock(connection.id, lockId);
  }

  if (options?.scheduleNextJob !== false && refreshed.expiresAt) {
    await scheduleTokenRefreshJob(connection.id, refreshed.expiresAt, 'scheduled_after_refresh', lockedConnection.job_generation);
  }
  return {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    apiKey: refreshed.apiKey,
    tokenType: refreshed.tokenType,
    expiresAt: refreshed.expiresAt
  } satisfies ResolvedConnectionCredentials;
}

export async function refreshConnectionIfNeeded(
  connection: ConnectionRecord, credentials: ResolvedConnectionCredentials, job?: ConnectionJobRecord
) {
  if (connection.status !== 'active') throw new Error('Connection is not active.');
  if (!credentials.accessToken || !credentials.expiresAt) return credentials;
  const expiresAt = new Date(credentials.expiresAt).getTime();
  if (expiresAt - Date.now() > REFRESH_SKEW_MS) return credentials;
  if (!credentials.refreshToken) return credentials;
  return await performRefresh(connection, { job, scheduleNextJob: !job });
}

export async function forceRefreshConnection(connectionId: string, options?: { scheduleNextJob?: boolean }) {
  const connection = await getConnectionById(connectionId);
  if (!connection) throw new Error('Connection not found.');
  if (connection.status !== 'active') throw new Error('Connection is not active.');
  return await performRefresh(connection, { ...options, force: true });
}

async function finalizeConnectionJob(input: {
  job: ConnectionJobRecord;
  status: ConnectionJobStatus;
  lastError?: string | null;
  runAfter?: string | null;
  connectionUpdate?: Record<string, unknown> | null;
}) {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.schema('app').rpc('finish_connection_job', {
    p_job_id: input.job.id,
    p_claim_id: input.job.claim_id,
    p_status: input.status,
    p_last_error: input.lastError ?? null,
    p_run_after: input.runAfter ?? null,
    p_connection_update: input.connectionUpdate ?? null
  });
  if (error) throw error;
  return (data as ConnectionJobStatus | null) ?? null;
}

export async function dispatchPendingConnectionJobAlerts() {
  const { APP_URL, OPERATOR_ALERT_WEBHOOK_URL } = getServerEnv();
  if (!OPERATOR_ALERT_WEBHOOK_URL) {
    return { configured: false, claimed: 0, delivered: 0, failed: 0 };
  }

  const webhook = new URL(OPERATOR_ALERT_WEBHOOK_URL);
  if (webhook.protocol !== 'https:' && !(webhook.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(webhook.hostname))) {
    throw new Error('Operator alert webhook must use HTTPS outside local development.');
  }

  const supabase = createServiceRoleClient();
  const claimId = randomUUID();
  const { data, error } = await supabase.schema('app').rpc('claim_connection_job_alerts', {
    p_claim_id: claimId,
    p_limit: 3
  });
  if (error) throw error;

  const jobs = (data ?? []) as ConnectionJobRecord[];
  let delivered = 0;
  let failed = 0;

  for (const job of jobs) {
    const connection = await getConnectionById(job.connection_id);
    if (!connection) {
      await supabase.schema('app').rpc('release_connection_job_alert', { p_job_id: job.id, p_claim_id: claimId });
      continue;
    }

    let responseStatus: number | null = null;
    try {
      const auditUrl = APP_URL ? new URL('/audit', APP_URL) : null;
      auditUrl?.searchParams.set('workspace', connection.workspace_id);
      auditUrl?.searchParams.set('resource', 'connection_job');
      auditUrl?.searchParams.set('resource_id', job.id);
      const response = await fetch(webhook, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-plusmy-alert-id': job.id
        },
        body: JSON.stringify({
          event: 'connection_job.dead_lettered',
          workspace_id: connection.workspace_id,
          connection_id: connection.id,
          provider: connection.provider,
          job_id: job.id,
          job_type: job.job_type,
          attempts: job.attempts,
          dashboard_url: auditUrl?.toString() ?? null
        }),
        signal: AbortSignal.timeout(4000)
      });
      responseStatus = response.status;
      if (!response.ok) throw new Error('Operator alert delivery failed.');

      const { data: completed, error: completeError } = await supabase.schema('app').rpc('complete_connection_job_alert', {
        p_job_id: job.id,
        p_claim_id: claimId
      });
      if (completeError) throw completeError;
      if (!completed) throw new Error('Operator alert claim expired before completion.');

      delivered += 1;
    } catch {
      failed += 1;
      await supabase.schema('app').rpc('release_connection_job_alert', { p_job_id: job.id, p_claim_id: claimId });
      await logAuditEvent({
        workspaceId: connection.workspace_id,
        actorType: 'system',
        action: 'connection_job.alert_failed',
        resourceType: 'connection_job',
        resourceId: job.id,
        status: 'error',
        metadata: { provider: connection.provider, connection_id: connection.id, http_status: responseStatus }
      });
      continue;
    }

    await logAuditEvent({
      workspaceId: connection.workspace_id,
      actorType: 'system',
      action: 'connection_job.alert_delivered',
      resourceType: 'connection_job',
      resourceId: job.id,
      metadata: { provider: connection.provider, connection_id: connection.id, http_status: responseStatus }
    });
  }

  return { configured: true, claimed: jobs.length, delivered, failed };
}

async function runConnectionSyncJob(job: ConnectionJobRecord, connection: ConnectionRecord) {
  const integration = getIntegration(connection.provider);
  if (!integration) {
    throw new Error(`Unsupported provider ${connection.provider}.`);
  }

  const credentials = await resolveConnectionCredentials(connection.id);
  const freshCredentials = await refreshConnectionIfNeeded(connection, credentials, job);
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

  const metadata = sanitizeConnectionMetadata({
    ...asJsonObject(connection.metadata),
    ...(result?.metadata ?? {}),
    sync: {
      completed_at: new Date().toISOString(),
      job_id: job.id,
      job_type: job.job_type,
      payload
    }
  }, [freshCredentials.accessToken, freshCredentials.refreshToken, freshCredentials.apiKey]);

  const update: Record<string, unknown> = { metadata };

  if (result?.displayName) {
    update.display_name = result.displayName;
  }

  if (result?.externalAccountId) {
    update.external_account_id = result.externalAccountId;
  }

  if (result && 'externalAccountEmail' in result) {
    update.external_account_email = result.externalAccountEmail ?? null;
  }

  return update;
}

export async function processDueConnectionJobs(input?: { limit?: number; workerId?: string }) {
  const supabase = createServiceRoleClient();
  const workerId = input?.workerId ?? randomUUID();
  const limit = normalizeLimit(input?.limit, 10);
  const { data, error } = await supabase.schema('app').rpc('claim_connection_sync_jobs_v2', {
    p_worker_id: workerId,
    p_limit: limit
  });
  if (error) throw error;

  const jobs = (data ?? []) as ConnectionJobRecord[];
  if (jobs.some((job) => !job.claim_id || !job.connection_generation)) {
    throw new Error('Connection job fencing migration is required.');
  }
  const processed: Array<{ id: string; status: ConnectionJobStatus; jobType: string; connectionId: string }> = [];
  const fenced: string[] = [];

  for (const job of jobs) {
    const connection = await getConnectionById(job.connection_id);
    if (!connection || connection.job_generation !== job.connection_generation) {
      fenced.push(job.id);
      continue;
    }

    let status: ConnectionJobStatus = 'succeeded';
    let message: string | null = null;
    let runAfter: string | null = null;
    let retryDelaySeconds: number | null = null;
    let connectionUpdate: Record<string, unknown> | null = null;
    try {
      if (connection.status !== 'active') throw new Error('Connection is not active.');
      if (job.job_type === 'token_refresh') {
        if (!job.refresh_schedule_pending) {
          await performRefresh(connection, { scheduleNextJob: false, force: true, job });
        }
      } else {
        connectionUpdate = await runConnectionSyncJob(job, connection);
      }
    } catch (error) {
      message = error instanceof Error ? error.message : 'Connection job failed.';
      status = job.attempts < job.max_attempts ? 'queued' : 'dead_letter';
      if (status === 'queued') {
        retryDelaySeconds = calculateRetryDelaySeconds(job.job_type, job.attempts);
        runAfter = new Date(Date.now() + retryDelaySeconds * 1000).toISOString();
      }
    }

    // Completion, sync metadata, and refresh rescheduling share one DB fence.
    // An RPC/ack error is not a provider failure and must not retry completed work.
    const finalStatus = await finalizeConnectionJob({ job, status, lastError: message, runAfter, connectionUpdate });
    if (!finalStatus) {
      fenced.push(job.id);
      continue;
    }
    const action = finalStatus === 'succeeded' ? 'connection_job.succeeded'
      : finalStatus === 'queued' ? 'connection_job.retry_scheduled'
        : finalStatus === 'dead_letter' ? 'connection_job.dead_lettered' : 'connection_job.failed';
    await logAuditEvent({
      workspaceId: connection.workspace_id,
      actorType: 'system',
      action,
      resourceType: 'connection_job',
      resourceId: job.id,
      status: finalStatus === 'succeeded' ? 'success' : 'error',
      metadata: {
        ...withConnectionAuditMetadata(connection),
        job_type: job.job_type,
        attempts: job.attempts,
        max_attempts: job.max_attempts,
        ...(finalStatus === 'queued' ? { retry_delay_seconds: retryDelaySeconds } : {}),
        ...(message && finalStatus !== 'succeeded' ? { error: message } : {})
      }
    });
    processed.push({ id: job.id, status: finalStatus, jobType: job.job_type, connectionId: job.connection_id });
  }

  return {
    workerId,
    claimed: jobs.length,
    processed,
    fenced,
    alerts: await dispatchPendingConnectionJobAlerts()
  };
}

export async function resolveProviderConnection(workspaceId: string, userId: string | null | undefined, provider: ProviderId) {
  const connection = await pickConnectionForProvider(workspaceId, userId, provider);
  if (!connection) {
    throw new Error(`No active ${provider} connection available for this workspace.`);
  }
  return connection;
}

export async function resolveProviderExecutionContext(workspaceId: string, userId: string | null | undefined, provider: ProviderId) {
  const connection = await resolveProviderConnection(workspaceId, userId, provider);
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

export async function listAuditLogs(workspaceId: string, optionsOrLimit: number | AuditLogFilters = 25): Promise<CursorPageResult<AuditLogRecord>> {
  const supabase = createServiceRoleClient();
  const options = typeof optionsOrLimit === 'number' ? { limit: optionsOrLimit } : optionsOrLimit;
  const limit = normalizeLimit(options.limit, 25);
  const direction = normalizeCursorDirection(options.direction);
  const cursor = decodeCursor(options.cursor);
  const batchLimit = options.clientId && !options.actorClientId ? 200 : limit + 1;

  const collected: AuditLogRecord[] = [];
  let exhausted = false;
  let rawCursor = cursor;

  while (collected.length < limit + 1 && !exhausted) {
    let query = supabase
      .schema('app')
      .from('audit_logs')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: direction === 'prev' })
      .order('id', { ascending: direction === 'prev' })
      .limit(batchLimit);

    query = applyCursorFilter(query, rawCursor, direction);

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
    const rawRows = (data ?? []) as AuditLogRecord[];
    if (rawRows.length === 0) {
      exhausted = true;
      break;
    }

    rawCursor = rawRows.at(-1) ?? rawCursor;

    const matchingRows = options.clientId
      ? rawRows.filter((record) => auditRecordClientId(record) === options.clientId)
      : rawRows;

    collected.push(...matchingRows);

    if (rawRows.length < batchLimit) {
      exhausted = true;
    }
  }

  const hasMore = collected.length > limit;
  const pageItems = collected.slice(0, limit);
  const items = direction === 'prev' ? [...pageItems].reverse() : pageItems;

  return {
    items,
    pageInfo: buildPageInfo(items, limit, direction, cursor, hasMore)
  };
}

export async function listToolInvocations(
  workspaceId: string,
  optionsOrLimit: number | ToolInvocationFilters = 25
): Promise<CursorPageResult<ToolInvocationRecord>> {
  const supabase = createServiceRoleClient();
  const options = typeof optionsOrLimit === 'number' ? { limit: optionsOrLimit } : optionsOrLimit;
  const limit = normalizeLimit(options.limit, 25);
  const direction = normalizeCursorDirection(options.direction);
  const cursor = decodeCursor(options.cursor);

  let query = supabase
    .schema('app')
    .from('tool_invocations')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: direction === 'prev' })
    .order('id', { ascending: direction === 'prev' })
    .limit(limit + 1);

  query = applyCursorFilter(query, cursor, direction);

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

  if (options.connectionId) {
    query = query.eq('connection_id', options.connectionId);
  }

  const { data } = await query;
  const rows = (data ?? []) as ToolInvocationRecord[];
  const hasMore = rows.length > limit;
  const pageItems = rows.slice(0, limit);
  const items = direction === 'prev' ? [...pageItems].reverse() : pageItems;

  return {
    items,
    pageInfo: buildPageInfo(items, limit, direction, cursor, hasMore)
  };
}

export async function listAuditLogsForExport(
  workspaceId: string,
  options: AuditExportFilters = {}
): Promise<AuditLogRecord[]> {
  const supabase = createServiceRoleClient();
  const limit = normalizeExportLimit(options.limit, 5000);
  const order = options.order === 'asc' ? 'asc' : 'desc';
  const direction: 'next' | 'prev' = order === 'asc' ? 'prev' : 'next';
  const batchLimit = options.clientId ? Math.min(limit + 1, 2000) : Math.min(limit, 2000);

  const collected: AuditLogRecord[] = [];
  let exhausted = false;
  let cursor: CursorRecord | null = null;

  while (collected.length < limit && !exhausted) {
    let query = supabase
      .schema('app')
      .from('audit_logs')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: order === 'asc' })
      .order('id', { ascending: order === 'asc' })
      .limit(batchLimit);

    query = applyCursorFilter(query, cursor, direction);

    if (options.status) {
      query = query.eq('status', options.status);
    }

    if (options.actorType) {
      query = query.eq('actor_type', options.actorType);
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

    if (options.from) {
      query = query.gte('created_at', options.from);
    }

    if (options.to) {
      query = query.lte('created_at', options.to);
    }

    const { data } = await query;
    const rawRows = (data ?? []) as AuditLogRecord[];
    if (rawRows.length === 0) {
      exhausted = true;
      break;
    }

    cursor = rawRows.at(-1) ?? cursor;

    const matchingRows = options.clientId
      ? rawRows.filter((record) => auditRecordClientId(record) === options.clientId)
      : rawRows;

    collected.push(...matchingRows);

    if (rawRows.length < batchLimit) {
      exhausted = true;
    }
  }

  return collected.slice(0, limit);
}

export async function listToolInvocationsForExport(
  workspaceId: string,
  options: ToolInvocationExportFilters = {}
): Promise<ToolInvocationRecord[]> {
  const supabase = createServiceRoleClient();
  const limit = normalizeExportLimit(options.limit, 5000);
  const order = options.order === 'asc' ? 'asc' : 'desc';

  let query = supabase
    .schema('app')
    .from('tool_invocations')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: order === 'asc' })
    .order('id', { ascending: order === 'asc' })
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

  if (options.connectionId) {
    query = query.eq('connection_id', options.connectionId);
  }

  if (options.from) {
    query = query.gte('created_at', options.from);
  }

  if (options.to) {
    query = query.lte('created_at', options.to);
  }

  const { data } = await query;
  return (data ?? []) as ToolInvocationRecord[];
}

export async function purgeAuditLogs(workspaceId: string, before: string) {
  const supabase = createServiceRoleClient();
  const { count, error } = await supabase
    .schema('app')
    .from('audit_logs')
    .delete({ count: 'exact' })
    .eq('workspace_id', workspaceId)
    .lt('created_at', before);
  if (error) throw error;
  return count ?? 0;
}

export async function purgeToolInvocations(workspaceId: string, before: string) {
  const supabase = createServiceRoleClient();
  const { count, error } = await supabase
    .schema('app')
    .from('tool_invocations')
    .delete({ count: 'exact' })
    .eq('workspace_id', workspaceId)
    .lt('created_at', before);
  if (error) throw error;
  return count ?? 0;
}

export async function revokeConnection(input: {
  workspaceId: string;
  connectionId: string;
  actorUserId: string;
}) {
  const supabase = createServiceRoleClient();
  const connection = await getConnectionById(input.connectionId);
  const { error } = await supabase
    .schema('app')
    .from('connections')
    .update({
      status: 'revoked',
      reauth_required_reason: 'Connection revoked by workspace operator.',
      refresh_lock_id: null,
      refresh_lock_expires_at: null
    })
    .eq('id', input.connectionId)
    .eq('workspace_id', input.workspaceId);

  if (error) throw error;
  // The generation trigger cancels jobs in the same transaction as revoke.

  await logAuditEvent({
    workspaceId: input.workspaceId,
    actorType: 'user',
    actorUserId: input.actorUserId,
    action: 'connection.revoked',
    resourceType: 'connection',
    resourceId: input.connectionId,
    metadata: connection ? withConnectionAuditMetadata(connection, {}) : { connection_id: input.connectionId }
  });
}
