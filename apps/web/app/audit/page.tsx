import Link from 'next/link';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@plusmy/ui';
import type { AuditLogRecord, ToolInvocationRecord } from '@plusmy/contracts';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { getAuthorizedWorkspace, listAuditLogs, listToolInvocations, listUserWorkspaces } from '@plusmy/core';
import { getSearchParam, type AppSearchParams } from '../_lib/search-params';
import { buildAuditHref } from '../_lib/audit-href';

const pageSizeOptions = [25, 50, 100] as const;

function canManageWorkspace(role: string | undefined) {
  return role === 'owner' || role === 'admin';
}

function readParam(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === 'string' ? value : null;
}

function normalizeLimit(value: string | null, fallback = 50) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), 100);
}

function normalizePage(value: string | null) {
  const parsed = Number(value ?? 1);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(Math.trunc(parsed), 1);
}

function buildFeedHref(
  workspaceId: string,
  currentFilters: Record<string, string | null | undefined>,
  updates: Record<string, string | null | undefined>
) {
  return buildAuditHref(workspaceId, updates, currentFilters);
}

function buildFeedPaginationHref(input: {
  workspaceId: string;
  currentFilters: Record<string, string | null | undefined>;
  cursorKey: 'audit_cursor' | 'invocation_cursor';
  directionKey: 'audit_direction' | 'invocation_direction';
  pageKey: 'audit_page' | 'invocation_page';
  cursor: string | null;
  direction: 'next' | 'prev';
  page: number;
}) {
  return buildFeedHref(input.workspaceId, input.currentFilters, {
    [input.cursorKey]: input.cursor,
    [input.directionKey]: input.cursor ? input.direction : null,
    [input.pageKey]: String(Math.max(input.page, 1))
  });
}

function summarizeErrorsByProvider(invocations: ToolInvocationRecord[]) {
  const counts = new Map<string, number>();
  for (const invocation of invocations) {
    if (invocation.status !== 'error') continue;
    counts.set(invocation.provider, (counts.get(invocation.provider) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((left, right) => right[1] - left[1]);
}

function summarizeErrorsByAction(audit: AuditLogRecord[]) {
  const counts = new Map<string, number>();
  for (const entry of audit) {
    if (entry.status !== 'error') continue;
    counts.set(entry.action, (counts.get(entry.action) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5);
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
        <CardHeader>
          <CardTitle className="text-2xl">Audit and rate control</CardTitle>
          <CardDescription>
            Sign in to inspect OAuth approvals, MCP tool calls, refresh failures, and workspace administration events.
          </CardDescription>
        </CardHeader>
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
        <CardHeader>
          <CardTitle className="text-2xl">Audit and rate control</CardTitle>
          <CardDescription>Select a workspace to inspect operator and MCP activity.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!canManageWorkspace(activeMembership?.role)) {
    return (
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4 space-y-0">
          <div className="space-y-3">
            <CardTitle className="text-2xl">Audit and rate control</CardTitle>
            <CardDescription>
              Workspace owners and admins can review audit events, approval activity, and MCP tool execution history.
            </CardDescription>
          </div>
          <Badge tone="brass">{workspace.name}</Badge>
        </CardHeader>
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
  const connectionId = readParam(resolvedSearchParams, 'connection');
  const limit = normalizeLimit(readParam(resolvedSearchParams, 'limit'));
  const auditCursor = readParam(resolvedSearchParams, 'audit_cursor');
  const auditDirection = readParam(resolvedSearchParams, 'audit_direction') === 'prev' ? 'prev' : 'next';
  const invocationCursor = readParam(resolvedSearchParams, 'invocation_cursor');
  const invocationDirection = readParam(resolvedSearchParams, 'invocation_direction') === 'prev' ? 'prev' : 'next';
  const auditPage = normalizePage(readParam(resolvedSearchParams, 'audit_page'));
  const invocationPage = normalizePage(readParam(resolvedSearchParams, 'invocation_page'));
  const currentFilters = {
    status,
    actor: actorType,
    resource: resourceType,
    resource_id: resourceId,
    action: actionPrefix,
    client: clientId,
    provider,
    tool: toolName,
    connection: connectionId,
    limit: String(limit),
    audit_cursor: auditCursor,
    audit_direction: auditCursor ? auditDirection : null,
    audit_page: String(auditPage),
    invocation_cursor: invocationCursor,
    invocation_direction: invocationCursor ? invocationDirection : null,
    invocation_page: String(invocationPage)
  };

  const [auditResult, invocationResult] = workspace
    ? await Promise.all([
        listAuditLogs(workspace.id, {
          limit,
          status,
          actorType: actorType as 'user' | 'mcp_client' | 'system' | null,
          resourceType,
          resourceId,
          actionPrefix,
          clientId,
          cursor: auditCursor,
          direction: auditDirection
        }),
        listToolInvocations(workspace.id, {
          limit,
          status,
          provider,
          toolName,
          actorClientId: clientId,
          connectionId,
          cursor: invocationCursor,
          direction: invocationDirection
        })
      ])
    : [
        { items: [] as AuditLogRecord[], pageInfo: { limit, olderCursor: null, newerCursor: null, hasOlderPage: false, hasNewerPage: false } },
        {
          items: [] as ToolInvocationRecord[],
          pageInfo: { limit, olderCursor: null, newerCursor: null, hasOlderPage: false, hasNewerPage: false }
        }
      ];
  const audit = auditResult.items;
  const invocations = invocationResult.items;
  const auditErrorCount = audit.filter((entry) => entry.status === 'error').length;
  const invocationErrorCount = invocations.filter((entry) => entry.status === 'error').length;
  const invocationErrorsByProvider = summarizeErrorsByProvider(invocations);
  const auditErrorsByAction = summarizeErrorsByAction(audit);
  const focusedView =
    clientId ?? connectionId ?? resourceId ?? toolName ?? provider ?? resourceType ?? actionPrefix ?? actorType ?? status ?? null;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4 space-y-0">
          <div className="space-y-3">
            <CardTitle className="text-2xl">Audit and rate control</CardTitle>
            <CardDescription>
              Filter recent operator events, OAuth approval changes, MCP client activity, and tool execution
              outcomes for {workspace.name}.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {focusedView ? <Badge tone="brass">Focused</Badge> : null}
            <Badge tone="moss">{workspace.name}</Badge>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <Card className="space-y-2">
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Audit events</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold text-foreground">{audit.length}</p>
            <p className="text-sm text-muted-foreground">Recent events after current filters.</p>
          </CardContent>
        </Card>
        <Card className="space-y-2">
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Audit errors</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold text-foreground">{auditErrorCount}</p>
            <p className="text-sm text-muted-foreground">Includes refresh failures, rate limits, and tool failures.</p>
          </CardContent>
        </Card>
        <Card className="space-y-2">
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Tool calls</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold text-foreground">{invocations.length}</p>
            <p className="text-sm text-muted-foreground">Per-client MCP execution history for the selected workspace.</p>
          </CardContent>
        </Card>
        <Card className="space-y-2">
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Tool errors</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold text-foreground">{invocationErrorCount}</p>
            <p className="text-sm text-muted-foreground">Failed calls after provider, client, and status filters.</p>
          </CardContent>
        </Card>
        <Card className="space-y-2">
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Combined error load</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold text-foreground">{auditErrorCount + invocationErrorCount}</p>
            <p className="text-sm text-muted-foreground">Cross-table failures in the active filter window.</p>
          </CardContent>
        </Card>
      </div>

      <Card className="space-y-3">
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-2">
            <CardTitle>Error focus</CardTitle>
            <CardDescription>Top failure signals for immediate remediation.</CardDescription>
          </div>
          <Badge tone={invocationErrorCount || auditErrorCount ? 'brass' : 'moss'}>
            {invocationErrorCount || auditErrorCount ? 'Attention needed' : 'Healthy'}
          </Badge>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Errors by provider</p>
            {invocationErrorsByProvider.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No failing tool calls.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {invocationErrorsByProvider.map(([entryProvider, count]) => (
                  <li key={entryProvider} className="text-sm text-slate-700">
                    <span className="font-semibold text-ink">{entryProvider}</span>{' '}
                    <span>{count} failed invocations</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Top audit actions</p>
            {auditErrorsByAction.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No failing audit events.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {auditErrorsByAction.map(([action, count]) => (
                  <li key={action} className="text-sm text-slate-700">
                    <span className="font-semibold text-ink">{action}</span>{' '}
                    <span>{count} failed</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="space-y-5">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div className="space-y-2">
            <CardTitle>Filters</CardTitle>
            <CardDescription>Focus the feed by approval lifecycle, actor type, client, or provider.</CardDescription>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link
              href={buildAuditHref(workspace.id, {
                status: null,
                actor: null,
                resource: null,
                resource_id: null,
                action: null,
                client: null,
                provider: null,
                tool: null,
                connection: null,
                audit_cursor: null,
                audit_direction: null,
                audit_page: '1',
                invocation_cursor: null,
                invocation_direction: null,
                invocation_page: '1'
              }, currentFilters)}
            >
              Reset filters
            </Link>
          </Button>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant={!resourceType && !actionPrefix ? 'default' : 'outline'}>
              <Link href={buildAuditHref(workspace.id, { resource: null, action: null }, currentFilters)}>All activity</Link>
            </Button>
            <Button asChild size="sm" variant={resourceType === 'oauth_client_approval' ? 'default' : 'outline'}>
              <Link href={buildAuditHref(workspace.id, { resource: 'oauth_client_approval', action: 'oauth_client.' }, currentFilters)}>Approvals</Link>
            </Button>
            <Button asChild size="sm" variant={resourceType === 'connection' ? 'default' : 'outline'}>
              <Link href={buildAuditHref(workspace.id, { resource: 'connection', action: 'connection.' }, currentFilters)}>Connections</Link>
            </Button>
            <Button asChild size="sm" variant={resourceType === 'context_binding' ? 'default' : 'outline'}>
              <Link href={buildAuditHref(workspace.id, { resource: 'context_binding', action: 'context.' }, currentFilters)}>Context bindings</Link>
            </Button>
            <Button asChild size="sm" variant={resourceType === 'connection_job' ? 'default' : 'outline'}>
              <Link href={buildAuditHref(workspace.id, { resource: 'connection_job', action: 'connection_job.' }, currentFilters)}>Background jobs</Link>
            </Button>
            <Button asChild size="sm" variant={actorType === 'mcp_client' ? 'default' : 'outline'}>
              <Link href={buildAuditHref(workspace.id, { actor: 'mcp_client', action: 'mcp.' }, currentFilters)}>MCP clients</Link>
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant={!status ? 'default' : 'outline'}>
              <Link href={buildAuditHref(workspace.id, { status: null }, currentFilters)}>Any status</Link>
            </Button>
            <Button asChild size="sm" variant={status === 'success' ? 'default' : 'outline'}>
              <Link href={buildAuditHref(workspace.id, { status: 'success' }, currentFilters)}>Success</Link>
            </Button>
            <Button asChild size="sm" variant={status === 'error' ? 'default' : 'outline'}>
              <Link href={buildAuditHref(workspace.id, { status: 'error' }, currentFilters)}>Error</Link>
            </Button>
            <Button asChild size="sm" variant={!actorType ? 'default' : 'outline'}>
              <Link href={buildAuditHref(workspace.id, { actor: null }, currentFilters)}>Any actor</Link>
            </Button>
            <Button asChild size="sm" variant={actorType === 'user' ? 'default' : 'outline'}>
              <Link href={buildAuditHref(workspace.id, { actor: 'user' }, currentFilters)}>Users</Link>
            </Button>
            <Button asChild size="sm" variant={actorType === 'system' ? 'default' : 'outline'}>
              <Link href={buildAuditHref(workspace.id, { actor: 'system' }, currentFilters)}>System</Link>
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {pageSizeOptions.map((size) => (
              <Button key={size} asChild size="sm" variant={limit === size ? 'default' : 'outline'}>
                <Link
                  href={buildFeedHref(workspace.id, currentFilters, {
                    limit: String(size),
                    audit_cursor: null,
                    audit_direction: null,
                    audit_page: '1',
                    invocation_cursor: null,
                    invocation_direction: null,
                    invocation_page: '1'
                  })}
                >
                  {size} rows
                </Link>
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant={!provider && !toolName ? 'default' : 'outline'}>
              <Link href={buildAuditHref(workspace.id, { provider: null, tool: null }, currentFilters)}>All providers</Link>
            </Button>
            <Button asChild size="sm" variant={provider === 'google' ? 'default' : 'outline'}>
              <Link href={buildAuditHref(workspace.id, { provider: 'google', tool: null }, currentFilters)}>Google</Link>
            </Button>
            <Button asChild size="sm" variant={provider === 'slack' ? 'default' : 'outline'}>
              <Link href={buildAuditHref(workspace.id, { provider: 'slack', tool: null }, currentFilters)}>Slack</Link>
            </Button>
            <Button asChild size="sm" variant={provider === 'notion' ? 'default' : 'outline'}>
              <Link href={buildAuditHref(workspace.id, { provider: 'notion', tool: null }, currentFilters)}>Notion</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <div className="space-y-1">
              <CardTitle className="text-lg">Audit events</CardTitle>
              <CardDescription>
                Page {auditPage} • {audit.length} rows • sorted by newest event first.
              </CardDescription>
            </div>
            <Badge tone="moss">{audit.length}</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {audit.length === 0 ? (
              <p className="text-sm text-muted-foreground">No audit events yet.</p>
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
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
              {auditResult.pageInfo.newerCursor ? (
                <Button asChild size="sm" variant="outline">
                  <Link
                    href={buildFeedPaginationHref({
                      workspaceId: workspace.id,
                      currentFilters,
                      cursorKey: 'audit_cursor',
                      directionKey: 'audit_direction',
                      pageKey: 'audit_page',
                      cursor: auditResult.pageInfo.newerCursor,
                      direction: 'prev',
                      page: auditPage - 1
                    })}
                  >
                    Newer
                  </Link>
                </Button>
              ) : (
                <Button size="sm" variant="outline" disabled>
                  Newer
                </Button>
              )}
              {auditResult.pageInfo.olderCursor ? (
                <Button asChild size="sm" variant="outline">
                  <Link
                    href={buildFeedPaginationHref({
                      workspaceId: workspace.id,
                      currentFilters,
                      cursorKey: 'audit_cursor',
                      directionKey: 'audit_direction',
                      pageKey: 'audit_page',
                      cursor: auditResult.pageInfo.olderCursor,
                      direction: 'next',
                      page: auditPage + 1
                    })}
                  >
                    Older
                  </Link>
                </Button>
              ) : (
                <Button size="sm" variant="outline" disabled>
                  Older
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <div className="space-y-1">
              <CardTitle className="text-lg">Tool invocations</CardTitle>
              <CardDescription>
                Page {invocationPage} • {invocations.length} rows • deterministic newest-first ordering.
              </CardDescription>
            </div>
            <Badge tone="moss">{invocations.length}</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {invocations.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tool invocations yet.</p>
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
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
              {invocationResult.pageInfo.newerCursor ? (
                <Button asChild size="sm" variant="outline">
                  <Link
                    href={buildFeedPaginationHref({
                      workspaceId: workspace.id,
                      currentFilters,
                      cursorKey: 'invocation_cursor',
                      directionKey: 'invocation_direction',
                      pageKey: 'invocation_page',
                      cursor: invocationResult.pageInfo.newerCursor,
                      direction: 'prev',
                      page: invocationPage - 1
                    })}
                  >
                    Newer
                  </Link>
                </Button>
              ) : (
                <Button size="sm" variant="outline" disabled>
                  Newer
                </Button>
              )}
              {invocationResult.pageInfo.olderCursor ? (
                <Button asChild size="sm" variant="outline">
                  <Link
                    href={buildFeedPaginationHref({
                      workspaceId: workspace.id,
                      currentFilters,
                      cursorKey: 'invocation_cursor',
                      directionKey: 'invocation_direction',
                      pageKey: 'invocation_page',
                      cursor: invocationResult.pageInfo.olderCursor,
                      direction: 'next',
                      page: invocationPage + 1
                    })}
                  >
                    Older
                  </Link>
                </Button>
              ) : (
                <Button size="sm" variant="outline" disabled>
                  Older
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
