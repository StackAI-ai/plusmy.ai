import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@plusmy/ui';
import Link from 'next/link';
import { getPlatformCounts, getProviderMetadata, plannedProviderPlatforms, supportedProviders } from '@plusmy/contracts';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { getAuthorizedWorkspace, listConnectionJobs, listConnectionsForWorkspace, listUserWorkspaces } from '@plusmy/core';
import { RefreshConnectionButton } from './refresh-button';
import { DisconnectConnectionButton } from './disconnect-button';
import { SyncConnectionButton } from './sync-button';
import { getSearchParam, type AppSearchParams } from '../_lib/search-params';
import { buildAuditHref } from '../_lib/audit-href';
import {
  buildConnectionsHref,
  connectionHealthFilters,
  connectionProviderFilters,
  filterConnections,
  getConnectionHealth,
  normalizeConnectionHealthFilter,
  normalizeConnectionProviderFilter
} from './filters';

function jobTone(status: string) {
  if (status === 'succeeded') return 'moss' as const;
  if (status === 'failed' || status === 'dead_letter' || status === 'canceled') return 'brass' as const;
  return 'default' as const;
}

function formatTimestamp(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleString();
}

function buildReconnectHref(workspaceId: string, provider: string, scope: 'workspace' | 'personal') {
  const redirectTo = encodeURIComponent(`/connections?workspace=${workspaceId}`);
  return `/api/integrations/${provider}/connect?workspace_id=${workspaceId}&scope=${scope}&redirect_to=${redirectTo}`;
}

export default async function ConnectionsPage({ searchParams }: { searchParams?: AppSearchParams }) {
  const currentSearchParams: Record<string, string | string[] | undefined> = searchParams ? await searchParams : {};
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Connections</CardTitle>
          <CardDescription>
            Sign in to attach Google, Slack, or Notion accounts. Connection state is stored in workspace-scoped
            tables and secrets are kept in Vault.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const workspaces = await listUserWorkspaces(user.id);
  const requestedWorkspaceId = await getSearchParam(searchParams, 'workspace');
  const provider = await getSearchParam(searchParams, 'provider');
  const health = await getSearchParam(searchParams, 'health');
  const status = await getSearchParam(searchParams, 'status');
  const message = await getSearchParam(searchParams, 'message');
  const workspace = await getAuthorizedWorkspace(user.id, requestedWorkspaceId);
  const activeMembership = workspace ? workspaces.find((entry) => entry.id === workspace.id) : null;
  const canManageWorkspaceConnections = activeMembership?.role === 'owner' || activeMembership?.role === 'admin';
  const connections = workspace ? await listConnectionsForWorkspace(workspace.id, user.id) : [];
  const connectionJobs = workspace ? await listConnectionJobs(workspace.id, 40) : [];
  const selectedProvider = normalizeConnectionProviderFilter(provider);
  const selectedHealth = normalizeConnectionHealthFilter(health);
  const visibleConnections = filterConnections(connections, selectedProvider, selectedHealth);
  const jobsByConnection = new Map<string, typeof connectionJobs>();
  for (const job of connectionJobs) {
    const existing = jobsByConnection.get(job.connection_id) ?? [];
    existing.push(job);
    jobsByConnection.set(job.connection_id, existing);
  }
  const queuedJobs = connectionJobs.filter((job) => job.status === 'queued').length;
  const processingJobs = connectionJobs.filter((job) => job.status === 'processing').length;
  const failedJobs = connectionJobs.filter((job) => job.status === 'failed').length;
  const deadLetterJobs = connectionJobs.filter((job) => job.status === 'dead_letter').length;
  const staleConnections = connections.filter(
    (connection) => getConnectionHealth(connection).value === 'stale'
  ).length;
  const reauthRequiredConnections = connections.filter((connection) => connection.status === 'reauth_required').length;
  const revokedConnections = connections.filter((connection) => connection.status === 'revoked').length;
  const matchingProviders = new Set(visibleConnections.map((connection) => connection.provider));
  const hasActiveFilters = selectedProvider !== 'all' || selectedHealth !== 'all';
  const healthTone = reauthRequiredConnections || failedJobs || staleConnections ? 'brass' : 'moss';
  const statusTone = status === 'connected' ? 'moss' : 'brass';
  const platformCounts = getPlatformCounts();
  const visibleConnectionCount = visibleConnections.length;
  const visibleProviderCatalog =
    selectedProvider === 'all'
      ? supportedProviders
      : supportedProviders.filter((entry) => entry.providerId === selectedProvider);
  const reauthConnectionsHref = workspace
    ? buildConnectionsHref(workspace.id, currentSearchParams, { health: 'reauth_required' })
    : '/connections';
  const failedJobsAuditHref = workspace
    ? buildAuditHref(workspace.id, { resource: 'connection_job', action: 'connection_job.', status: 'error' })
    : '/audit';
  const deadLetterJobsAuditHref = workspace
    ? buildAuditHref(workspace.id, { resource: 'connection_job', action: 'connection_job.dead_lettered', status: 'error' })
    : '/audit';
  const staleConnectionsHref = workspace
    ? buildConnectionsHref(workspace.id, currentSearchParams, { health: 'stale' })
    : '/connections';
  const revokedConnectionsHref = workspace
    ? buildConnectionsHref(workspace.id, currentSearchParams, { health: 'revoked' })
    : '/connections';
  const deadLetterAlerts = connections
    .map((connection) => {
      const job = (jobsByConnection.get(connection.id) ?? []).find((entry) => entry.status === 'dead_letter');
      return job ? { connection, job } : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  const needsAttentionConnections = connections.filter((connection) => {
    const health = getConnectionHealth(connection).value;
    return connection.status === 'reauth_required' || connection.status === 'revoked' || health === 'stale';
  });

  return (
    <div className="space-y-5">
      {status ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
            <div className="space-y-2">
              <CardTitle className="text-lg">Connection callback</CardTitle>
              <CardDescription>
                {provider ? `${provider} reported ${status}.` : `Provider callback reported ${status}.`}
              </CardDescription>
              {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
            </div>
            <Badge tone={statusTone}>{status}</Badge>
          </CardHeader>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Connection vault</CardTitle>
          <CardDescription>
            {workspace
              ? `Active workspace: ${workspace.name}. Install providers at the workspace level for shared tools or at the personal level for delegated access.`
              : 'Create a workspace first, then connect providers via the OAuth callback routes.'}
          </CardDescription>
        </CardHeader>
        {workspace ? (
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge tone={processingJobs ? 'brass' : 'moss'}>{processingJobs} processing</Badge>
              <Badge tone={queuedJobs ? 'default' : 'moss'}>{queuedJobs} queued</Badge>
              <Link className="inline-flex" href={reauthConnectionsHref}>
                <Badge tone={reauthRequiredConnections ? 'brass' : 'moss'}>{reauthRequiredConnections} need reauth</Badge>
              </Link>
              <Link className="inline-flex" href={failedJobsAuditHref}>
                <Badge tone={failedJobs ? 'brass' : 'moss'}>{failedJobs} failed</Badge>
              </Link>
              <Link className="inline-flex" href={deadLetterJobsAuditHref}>
                <Badge tone={deadLetterJobs ? 'brass' : 'moss'}>{deadLetterJobs} dead-lettered</Badge>
              </Link>
              <Link className="inline-flex" href={staleConnectionsHref}>
                <Badge tone={healthTone}>{staleConnections} stale refreshes</Badge>
              </Link>
              <Link className="inline-flex" href={revokedConnectionsHref}>
                <Badge tone={revokedConnections ? 'brass' : 'moss'}>{revokedConnections} revoked</Badge>
              </Link>
            </div>
          </CardContent>
        ) : null}
      </Card>

      {workspace ? (
        <Card className="space-y-5">
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
            <div className="space-y-2">
              <CardTitle className="text-lg">Filters</CardTitle>
              <CardDescription>Use provider and health filters to isolate installs, reauth loops, and stale tokens.</CardDescription>
            </div>
            {hasActiveFilters ? (
              <Button asChild size="sm" variant="outline">
                <Link href={buildConnectionsHref(workspace.id, currentSearchParams, { provider: null, health: null })}>
                  Clear filters
                </Link>
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {connectionProviderFilters.map((filter) => {
                const active = selectedProvider === filter.value;
                return (
                  <Button key={filter.value} asChild size="sm" variant={active ? 'default' : 'outline'}>
                    <Link href={buildConnectionsHref(workspace.id, currentSearchParams, { provider: filter.value === 'all' ? null : filter.value })}>
                      {filter.label}
                    </Link>
                  </Button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2">
              {connectionHealthFilters.map((filter) => {
                const active = selectedHealth === filter.value;
                return (
                  <Button key={filter.value} asChild size="sm" variant={active ? 'default' : 'outline'}>
                    <Link href={buildConnectionsHref(workspace.id, currentSearchParams, { health: filter.value === 'all' ? null : filter.value })}>
                      {filter.label}
                    </Link>
                  </Button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="moss">{visibleConnectionCount} matching connections</Badge>
              <Badge tone={matchingProviders.size ? 'moss' : 'brass'}>{matchingProviders.size} matching providers</Badge>
              {hasActiveFilters ? <Badge tone="brass">Filtered view</Badge> : <Badge>All installs</Badge>}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {workspace && deadLetterAlerts.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Operator alerts</CardTitle>
            <CardDescription>
              These jobs exhausted their retry budget and need an owner or admin to inspect the connection, fix the provider issue, and queue a fresh sync.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {deadLetterAlerts.slice(0, 5).map(({ connection, job }) => (
              <div key={job.id} className="rounded-2xl border border-border/70 bg-background/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-foreground">{connection.display_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {connection.provider} · {connection.scope} · {job.job_type.replaceAll('_', ' ')}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone="brass">Retry budget exhausted</Badge>
                    <Badge>{job.attempts}/{job.max_attempts} attempts</Badge>
                  </div>
                </div>
                {job.last_error ? <p className="mt-2 text-sm text-red-700">{job.last_error}</p> : null}
                <div className="mt-3 flex flex-wrap gap-3 text-sm">
                  <Link className="text-foreground underline-offset-4 hover:underline" href={deadLetterJobsAuditHref}>
                    Open audit trail
                  </Link>
                  <Link className="text-foreground underline-offset-4 hover:underline" href={buildConnectionsHref(workspace.id, currentSearchParams, { provider: connection.provider })}>
                    Filter this provider
                  </Link>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {workspace && needsAttentionConnections.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Connection notifications</CardTitle>
            <CardDescription>
              Provider installs that need an operator action now, including expired consent, revoked access, and stale refresh posture.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {needsAttentionConnections.slice(0, 5).map((connection) => {
              const health = getConnectionHealth(connection);
              const canReconnect = connection.scope === 'personal' || canManageWorkspaceConnections;
              const reconnectHref = canReconnect ? buildReconnectHref(workspace.id, connection.provider, connection.scope) : null;
              return (
                <div key={connection.id} className="rounded-2xl border border-border/70 bg-background/70 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-foreground">{connection.display_name}</p>
                        <Badge tone={health.tone}>{health.label}</Badge>
                        <Badge tone={connection.scope === 'workspace' ? 'moss' : 'default'}>{connection.scope}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {connection.status === 'revoked'
                          ? 'This connection was revoked and must be linked again before tools can run.'
                          : connection.status === 'reauth_required'
                            ? connection.reauth_required_reason ?? 'Provider consent or token state requires reauthorization.'
                            : 'Refresh posture is stale. Reconnect now if the provider grant may have changed.'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {reconnectHref ? (
                        <Button asChild size="sm">
                          <a href={reconnectHref}>Reconnect</a>
                        </Button>
                      ) : (
                        <Badge tone="brass">Owner or admin required</Badge>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Platform coverage</CardTitle>
          <CardDescription>
            Current provider support comes from the live integration registry. The roadmap list below highlights
            reviewed gaps that fit the same workspace-aware OAuth and Vault model.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Badge tone="moss">{platformCounts.liveProviders} live providers</Badge>
            <Badge>{supportedProviders.length} visible here</Badge>
            <Badge tone="brass">{platformCounts.plannedPlatforms} coming next</Badge>
          </div>
          <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
            {plannedProviderPlatforms.slice(0, 6).map((platform) => (
              <Badge key={platform.id}>{platform.name}</Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {visibleProviderCatalog.map((provider) => {
          const providerConnections = visibleConnections.filter((item) => item.provider === provider.providerId);
          const activeCount = providerConnections.filter((item) => item.status === 'active').length;
          const redirectTo = workspace ? encodeURIComponent(`/connections?workspace=${workspace.id}`) : '';
          const workspaceConnectHref = workspace
            ? `/api/integrations/${provider.providerId}/connect?workspace_id=${workspace.id}&scope=workspace&redirect_to=${redirectTo}`
            : '/workspaces';
          const personalConnectHref = workspace
            ? `/api/integrations/${provider.providerId}/connect?workspace_id=${workspace.id}&scope=personal&redirect_to=${redirectTo}`
            : '/workspaces';
          const providerMetadata = getProviderMetadata(provider.providerId);

          return (
            <Card key={provider.id}>
              <CardHeader className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-xl">{provider.name}</CardTitle>
                  <Badge tone={providerConnections.length ? 'moss' : 'brass'}>
                    {hasActiveFilters
                      ? `${providerConnections.length} matching`
                      : activeCount
                        ? `${activeCount} active`
                        : 'not connected'}
                  </Badge>
                </div>
                <CardDescription>{provider.summary}</CardDescription>
                {hasActiveFilters && providerConnections.length === 0 ? (
                  <CardDescription>No installs match the current provider and health filters.</CardDescription>
                ) : providerConnections.length === 0 ? (
                  <CardDescription>No provider installs yet.</CardDescription>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex flex-wrap gap-2">
                  <Badge>{provider.category.replaceAll('_', ' ')}</Badge>
                  {providerMetadata?.capabilities.map((capability) => (
                    <Badge key={capability.label} tone="moss">
                      {capability.label}
                    </Badge>
                  ))}
                </div>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {provider.capabilities.map((capability) => (
                    <li key={capability.label}>
                      <span className="font-medium text-foreground">{capability.label}:</span> {capability.detail}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  {(() => {
                    const providerConnectionIds = providerConnections.map((connection) => connection.id);
                    const providerJobs = providerConnectionIds.flatMap((connectionId) => jobsByConnection.get(connectionId) ?? []);
                    const providerFailedJobs = providerJobs.filter((job) => job.status === 'failed').length;
                    const providerQueuedJobs = providerJobs.filter((job) => job.status === 'queued').length;
                    const providerProcessingJobs = providerJobs.filter((job) => job.status === 'processing').length;

                    return (
                      <>
                        <Link
                          className="inline-flex"
                          href={
                            workspace
                              ? buildConnectionsHref(workspace.id, currentSearchParams, {
                                  provider: provider.providerId,
                                  health: 'attention'
                                })
                              : '/connections'
                          }
                        >
                          <Badge tone={providerFailedJobs ? 'brass' : 'moss'}>{providerFailedJobs} failed jobs</Badge>
                        </Link>
                        <Badge tone={providerQueuedJobs ? 'default' : 'moss'}>{providerQueuedJobs} queued jobs</Badge>
                        <Badge tone={providerProcessingJobs ? 'brass' : 'moss'}>{providerProcessingJobs} processing</Badge>
                      </>
                    );
                  })()}
                </div>
                <div className="flex flex-wrap gap-3">
                  {canManageWorkspaceConnections ? (
                    <Button asChild>
                      <a href={workspaceConnectHref}>Connect workspace</a>
                    </Button>
                  ) : null}
                  <Button asChild tone="secondary">
                    <a href={personalConnectHref}>Connect personal</a>
                  </Button>
                </div>
                {canManageWorkspaceConnections === false && workspace ? (
                  <p className="text-xs text-muted-foreground">Workspace installs require an owner or admin role.</p>
                ) : null}
                <div className="space-y-3">
                  {providerConnections.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {hasActiveFilters ? 'No connection records match these filters for this provider yet.' : 'No connection records for this provider yet.'}
                    </p>
                  ) : (
                    providerConnections.map((connection) => {
                      const recentJobs = (jobsByConnection.get(connection.id) ?? []).slice(0, 3);
                      const connectionHealth = getConnectionHealth(connection);
                      const canReconnect = connection.scope === 'personal' || canManageWorkspaceConnections;
                      const reconnectHref = workspace ? buildReconnectHref(workspace.id, connection.provider, connection.scope) : null;
                      const connectionAuditHref = workspace
                        ? buildAuditHref(workspace.id, {
                            resource: 'connection',
                            resource_id: connection.id,
                            action: 'connection.',
                            connection: connection.id
                          })
                        : '/audit';
                      return (
                        <div key={connection.id} className="rounded-2xl border border-black/5 bg-white/70 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-ink">{connection.display_name}</p>
                              <p className="text-sm text-slate-700">
                                {connection.scope} • {connection.status}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <Link className="inline-flex" href={connectionAuditHref}>
                                  <Badge tone={connectionHealth.tone}>{connectionHealth.label}</Badge>
                                </Link>
                                <Badge tone={connection.scope === 'workspace' ? 'moss' : 'default'}>{connection.scope}</Badge>
                              </div>
                              {connection.external_account_email ? (
                                <p className="text-sm text-slate-700">{connection.external_account_email}</p>
                              ) : null}
                              {connection.reauth_required_reason ? (
                                <p className="mt-2 text-xs text-red-700">{connection.reauth_required_reason}</p>
                              ) : null}
                              {connection.status === 'active' && connectionHealth.value === 'stale' ? (
                                <p className="mt-2 text-xs text-amber-700">
                                  Token refresh is stale and may need manual recheck.{' '}
                                  <Link className="font-medium underline underline-offset-4" href={connectionAuditHref}>
                                    Inspect audit trail
                                  </Link>
                                </p>
                              ) : null}
                              {connection.status === 'revoked' ? (
                                <p className="mt-2 text-xs text-amber-700">
                                  Provider access was revoked. Reconnect this install before MCP clients can use it again.
                                </p>
                              ) : null}
                              <div className="mt-3 flex flex-wrap gap-2">
                                {(connection.granted_scopes as string[] | null | undefined)?.map((scope) => (
                                  <Badge key={scope} tone="brass">
                                    {scope}
                                  </Badge>
                                ))}
                              </div>
                              <div className="mt-3 space-y-1 text-xs text-slate-500">
                                {connection.last_refreshed_at ? <p>Last refreshed: {formatTimestamp(connection.last_refreshed_at)}</p> : null}
                                {connection.last_validated_at ? <p>Last validated: {formatTimestamp(connection.last_validated_at)}</p> : null}
                              </div>
                              <div className="mt-4 space-y-2">
                                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Background jobs</p>
                                {recentJobs.length === 0 ? (
                                  <p className="text-xs text-slate-500">No background jobs recorded for this connection yet.</p>
                                ) : (
                                  recentJobs.map((job) => (
                                    <div key={job.id} className="rounded-2xl border border-black/5 bg-black/5 p-3">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <p className="text-sm font-medium text-ink">{job.job_type.replaceAll('_', ' ')}</p>
                                        <Badge tone={jobTone(job.status)}>{job.status}</Badge>
                                      </div>
                                      <p className="mt-1 text-xs text-slate-500">
                                        Attempt {job.attempts} of {job.max_attempts}
                                      </p>
                                      <p className="mt-1 text-xs text-slate-500">
                                        {job.status === 'queued'
                                          ? `Run after ${formatTimestamp(job.run_after)}`
                                          : job.completed_at
                                            ? `Completed ${formatTimestamp(job.completed_at)}`
                                            : `Started ${formatTimestamp(job.started_at)}`}
                                      </p>
                                      {job.last_error ? <p className="mt-2 text-xs text-red-700">{job.last_error}</p> : null}
                                    </div>
                                  ))
                                )}
                              </div>
                            </div>
                            {workspace ? (
                              <div className="flex flex-col items-end gap-2">
                                {canReconnect && reconnectHref ? (
                                  <Button asChild size="sm">
                                    <a href={reconnectHref}>
                                      {connection.status === 'revoked' || connection.status === 'reauth_required' ? 'Reconnect now' : 'Reconnect'}
                                    </a>
                                  </Button>
                                ) : null}
                                {connection.status !== 'revoked' ? (
                                  <>
                                    <SyncConnectionButton workspaceId={workspace.id} connectionId={connection.id} />
                                    <RefreshConnectionButton workspaceId={workspace.id} connectionId={connection.id} />
                                    <DisconnectConnectionButton workspaceId={workspace.id} connectionId={connection.id} />
                                  </>
                                ) : (
                                  <Badge tone="brass">revoked</Badge>
                                )}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
