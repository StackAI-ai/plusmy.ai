import Link from 'next/link';
import { Badge, Card } from '@plusmy/ui';
import type { AuditLogRecord, ToolInvocationRecord } from '@plusmy/contracts';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { getAuthorizedWorkspace, listAuditLogs, listToolInvocations, listUserWorkspaces } from '@plusmy/core';
import { getSearchParam, type AppSearchParams } from '../_lib/search-params';

function canManageWorkspace(role: string | undefined) {
  return role === 'owner' || role === 'admin';
}

function readParam(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === 'string' ? value : null;
}

function buildAuditHref(
  workspaceId: string | null | undefined,
  current: Record<string, string | null>,
  updates: Record<string, string | null | undefined>
) {
  const params = new URLSearchParams();

  if (workspaceId) {
    params.set('workspace', workspaceId);
  }

  for (const [key, value] of Object.entries(current)) {
    if (value) {
      params.set(key, value);
    }
  }

  for (const [key, value] of Object.entries(updates)) {
    if (!value) {
      params.delete(key);
      continue;
    }

    params.set(key, value);
  }

  const query = params.toString();
  return query ? `/audit?${query}` : '/audit';
}

function filterLinkClass(active: boolean) {
  return [
    'rounded-full border px-4 py-2 text-sm font-medium transition',
    active ? 'border-[#13201d] bg-[#13201d] text-white' : 'border-black/10 bg-white/80 text-slate-700 hover:bg-white'
  ].join(' ');
}

function describeAuditActor(entry: AuditLogRecord) {
  if (entry.actor_type === 'mcp_client') {
    return entry.actor_client_id ? `MCP client ${entry.actor_client_id}` : 'MCP client';
  }

  if (entry.actor_type === 'user') {
    return entry.actor_user_id ? `User ${entry.actor_user_id}` : 'User';
  }

  return 'System';
}

function describeInvocationActor(entry: ToolInvocationRecord) {
  if (entry.actor_client_id) {
    return `MCP client ${entry.actor_client_id}`;
  }

  if (entry.actor_user_id) {
    return `User ${entry.actor_user_id}`;
  }

  return 'System';
}

export default async function AuditPage({ searchParams }: { searchParams?: AppSearchParams }) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <Card>
        <h1 className="text-2xl font-semibold">Audit and rate control</h1>
        <p className="mt-3 text-sm leading-7 text-slate-700">
          Sign in to inspect OAuth approvals, MCP tool calls, refresh failures, and workspace administration events.
        </p>
      </Card>
    );
  }

  const workspaces = await listUserWorkspaces(user.id);
  const requestedWorkspaceId = await getSearchParam(searchParams, 'workspace');
  const workspace = await getAuthorizedWorkspace(user.id, requestedWorkspaceId);
  const activeMembership = workspace ? workspaces.find((entry) => entry.id === workspace.id) : null;

  if (!workspace) {
    return (
      <Card>
        <h1 className="text-2xl font-semibold">Audit and rate control</h1>
        <p className="mt-3 text-sm leading-7 text-slate-700">Select a workspace to inspect operator and MCP activity.</p>
      </Card>
    );
  }

  if (!canManageWorkspace(activeMembership?.role)) {
    return (
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Audit and rate control</h1>
            <p className="mt-3 text-sm leading-7 text-slate-700">
              Workspace owners and admins can review audit events, approval activity, and MCP tool execution history.
            </p>
          </div>
          <Badge tone="brass">{workspace.name}</Badge>
        </div>
      </Card>
    );
  }

  const resolvedSearchParams = (searchParams ? await searchParams : {}) ?? {};
  const status = readParam(resolvedSearchParams, 'status');
  const actorType = readParam(resolvedSearchParams, 'actor');
  const resourceType = readParam(resolvedSearchParams, 'resource');
  const resourceId = readParam(resolvedSearchParams, 'resource_id');
  const actionPrefix = readParam(resolvedSearchParams, 'action');
  const clientId = readParam(resolvedSearchParams, 'client');
  const provider = readParam(resolvedSearchParams, 'provider');
  const toolName = readParam(resolvedSearchParams, 'tool');
  const currentFilters = {
    status,
    actor: actorType,
    resource: resourceType,
    resource_id: resourceId,
    action: actionPrefix,
    client: clientId,
    provider,
    tool: toolName
  };

  const [audit, invocations] = workspace
    ? await Promise.all([
        listAuditLogs(workspace.id, {
          limit: 50,
          status,
          actorType: actorType as 'user' | 'mcp_client' | 'system' | null,
          resourceType,
          resourceId,
          actionPrefix,
          clientId
        }),
        listToolInvocations(workspace.id, {
          limit: 50,
          status,
          provider,
          toolName,
          actorClientId: clientId
        })
      ])
    : [[], []];
  const auditErrorCount = audit.filter((entry) => entry.status === 'error').length;
  const invocationErrorCount = invocations.filter((entry) => entry.status === 'error').length;
  const focusedView =
    clientId ?? resourceId ?? toolName ?? provider ?? resourceType ?? actionPrefix ?? actorType ?? status ?? null;

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Audit and rate control</h1>
            <p className="mt-3 text-sm leading-7 text-slate-700">
              Filter recent operator events, OAuth approval changes, MCP client activity, and tool execution outcomes for{' '}
              {workspace.name}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {focusedView ? <Badge tone="brass">Focused</Badge> : null}
            <Badge tone="moss">{workspace.name}</Badge>
          </div>
        </div>
      </Card>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <Card className="space-y-2">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Audit events</p>
          <p className="text-4xl font-semibold text-ink">{audit.length}</p>
          <p className="text-sm text-slate-700">Recent events after current filters.</p>
        </Card>
        <Card className="space-y-2">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Audit errors</p>
          <p className="text-4xl font-semibold text-ink">{auditErrorCount}</p>
          <p className="text-sm text-slate-700">Includes refresh failures, rate limits, and tool failures.</p>
        </Card>
        <Card className="space-y-2">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Tool calls</p>
          <p className="text-4xl font-semibold text-ink">{invocations.length}</p>
          <p className="text-sm text-slate-700">Per-client MCP execution history for the selected workspace.</p>
        </Card>
        <Card className="space-y-2">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Tool errors</p>
          <p className="text-4xl font-semibold text-ink">{invocationErrorCount}</p>
          <p className="text-sm text-slate-700">Failed calls after provider, client, and status filters.</p>
        </Card>
      </div>

      <Card className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Filters</h2>
            <p className="mt-2 text-sm text-slate-700">Focus the feed by approval lifecycle, actor type, client, or provider.</p>
          </div>
          <Link
            href={buildAuditHref(workspace.id, currentFilters, {
              status: null,
              actor: null,
              resource: null,
              resource_id: null,
              action: null,
              client: null,
              provider: null,
              tool: null
            })}
            className={filterLinkClass(false)}
          >
            Reset filters
          </Link>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Link href={buildAuditHref(workspace.id, currentFilters, { resource: null, action: null })} className={filterLinkClass(!resourceType && !actionPrefix)}>
              All activity
            </Link>
            <Link href={buildAuditHref(workspace.id, currentFilters, { resource: 'oauth_client_approval', action: 'oauth_client.' })} className={filterLinkClass(resourceType === 'oauth_client_approval')}>
              Approvals
            </Link>
            <Link href={buildAuditHref(workspace.id, currentFilters, { resource: 'connection', action: 'connection.' })} className={filterLinkClass(resourceType === 'connection')}>
              Connections
            </Link>
            <Link href={buildAuditHref(workspace.id, currentFilters, { resource: 'context_binding', action: 'context.' })} className={filterLinkClass(resourceType === 'context_binding')}>
              Context bindings
            </Link>
            <Link href={buildAuditHref(workspace.id, currentFilters, { actor: 'mcp_client', action: 'mcp.' })} className={filterLinkClass(actorType === 'mcp_client')}>
              MCP clients
            </Link>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link href={buildAuditHref(workspace.id, currentFilters, { status: null })} className={filterLinkClass(!status)}>
              Any status
            </Link>
            <Link href={buildAuditHref(workspace.id, currentFilters, { status: 'success' })} className={filterLinkClass(status === 'success')}>
              Success
            </Link>
            <Link href={buildAuditHref(workspace.id, currentFilters, { status: 'error' })} className={filterLinkClass(status === 'error')}>
              Error
            </Link>
            <Link href={buildAuditHref(workspace.id, currentFilters, { actor: null })} className={filterLinkClass(!actorType)}>
              Any actor
            </Link>
            <Link href={buildAuditHref(workspace.id, currentFilters, { actor: 'user' })} className={filterLinkClass(actorType === 'user')}>
              Users
            </Link>
            <Link href={buildAuditHref(workspace.id, currentFilters, { actor: 'system' })} className={filterLinkClass(actorType === 'system')}>
              System
            </Link>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link href={buildAuditHref(workspace.id, currentFilters, { provider: null, tool: null })} className={filterLinkClass(!provider && !toolName)}>
              All providers
            </Link>
            <Link href={buildAuditHref(workspace.id, currentFilters, { provider: 'google', tool: null })} className={filterLinkClass(provider === 'google')}>
              Google
            </Link>
            <Link href={buildAuditHref(workspace.id, currentFilters, { provider: 'slack', tool: null })} className={filterLinkClass(provider === 'slack')}>
              Slack
            </Link>
            <Link href={buildAuditHref(workspace.id, currentFilters, { provider: 'notion', tool: null })} className={filterLinkClass(provider === 'notion')}>
              Notion
            </Link>
          </div>
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Audit events</h2>
            <Badge tone="moss">{audit.length}</Badge>
          </div>
          <div className="mt-4 space-y-3">
            {audit.length === 0 ? (
              <p className="text-sm text-slate-700">No audit events yet.</p>
            ) : (
              audit.map((entry) => (
                <div key={entry.id} className="rounded-2xl border border-black/5 bg-white/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-ink">{entry.action}</p>
                    <Badge tone={entry.status === 'error' ? 'brass' : 'moss'}>{entry.status}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-slate-700">
                    {entry.resource_type}
                    {entry.resource_id ? ` • ${entry.resource_id}` : ''}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{describeAuditActor(entry)}</p>
                  {entry.metadata && Object.keys(entry.metadata).length ? (
                    <pre className="mt-3 overflow-x-auto rounded-2xl bg-black/5 p-3 text-xs text-slate-600">
                      {JSON.stringify(entry.metadata, null, 2)}
                    </pre>
                  ) : null}
                  <p className="mt-3 text-xs uppercase tracking-[0.2em] text-slate-500">{entry.created_at}</p>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Tool invocations</h2>
            <Badge tone="moss">{invocations.length}</Badge>
          </div>
          <div className="mt-4 space-y-3">
            {invocations.length === 0 ? (
              <p className="text-sm text-slate-700">No tool invocations yet.</p>
            ) : (
              invocations.map((entry) => (
                <div key={entry.id} className="rounded-2xl border border-black/5 bg-white/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-ink">{entry.tool_name}</p>
                    <Badge tone={entry.status === 'error' ? 'brass' : 'moss'}>{entry.status}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-slate-700">
                    {entry.provider}
                    {entry.connection_id ? ` • ${entry.connection_id}` : ''}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {describeInvocationActor(entry)}
                    {typeof entry.latency_ms === 'number' ? ` • ${entry.latency_ms} ms` : ''}
                  </p>
                  {entry.error_message ? <p className="mt-2 text-sm text-red-700">{entry.error_message}</p> : null}
                  <p className="mt-3 text-xs uppercase tracking-[0.2em] text-slate-500">{entry.created_at}</p>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
