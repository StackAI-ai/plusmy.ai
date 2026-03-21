import { Badge, Button, Card } from '@plusmy/ui';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { getAuthorizedWorkspace, listConnectionJobs, listConnectionsForWorkspace, listUserWorkspaces } from '@plusmy/core';
import { RefreshConnectionButton } from './refresh-button';
import { DisconnectConnectionButton } from './disconnect-button';
import { SyncConnectionButton } from './sync-button';
import { getSearchParam, type AppSearchParams } from '../_lib/search-params';

const providerCapabilities = {
  google: ['google.search_drive', 'google.get_document'],
  slack: ['slack.list_channels', 'slack.read_channel_history', 'slack.post_message'],
  notion: ['notion.search', 'notion.get_page', 'notion.create_page']
} as const;

function jobTone(status: string) {
  if (status === 'succeeded') return 'moss' as const;
  if (status === 'failed' || status === 'canceled') return 'brass' as const;
  return 'default' as const;
}

function isStaleRefresh(value: string | null, maxAgeDays = 14) {
  if (!value) return true;
  const ageMs = Date.now() - new Date(value).getTime();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  return ageMs > maxAgeMs;
}

function formatTimestamp(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleString();
}

export default async function ConnectionsPage({ searchParams }: { searchParams?: AppSearchParams }) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <Card>
        <h1 className="text-2xl font-semibold">Connections</h1>
        <p className="mt-3 text-sm leading-7 text-slate-700">
          Sign in to attach Google, Slack, or Notion accounts. Connection state is stored in workspace-scoped tables and secrets are kept in Vault.
        </p>
      </Card>
    );
  }

  const workspaces = await listUserWorkspaces(user.id);
  const requestedWorkspaceId = await getSearchParam(searchParams, 'workspace');
  const provider = await getSearchParam(searchParams, 'provider');
  const status = await getSearchParam(searchParams, 'status');
  const message = await getSearchParam(searchParams, 'message');
  const workspace = await getAuthorizedWorkspace(user.id, requestedWorkspaceId);
  const activeMembership = workspace ? workspaces.find((entry) => entry.id === workspace.id) : null;
  const canManageWorkspaceConnections = activeMembership?.role === 'owner' || activeMembership?.role === 'admin';
  const connections = workspace ? await listConnectionsForWorkspace(workspace.id, user.id) : [];
  const connectionJobs = workspace ? await listConnectionJobs(workspace.id, 40) : [];
  const jobsByConnection = new Map<string, typeof connectionJobs>();
  for (const job of connectionJobs) {
    const existing = jobsByConnection.get(job.connection_id) ?? [];
    existing.push(job);
    jobsByConnection.set(job.connection_id, existing);
  }
  const queuedJobs = connectionJobs.filter((job) => job.status === 'queued').length;
  const processingJobs = connectionJobs.filter((job) => job.status === 'processing').length;
  const failedJobs = connectionJobs.filter((job) => job.status === 'failed').length;
  const staleConnections = connections.filter(
    (connection) => connection.status === 'active' && isStaleRefresh(connection.last_refreshed_at)
  ).length;
  const reauthRequiredConnections = connections.filter((connection) => connection.status === 'reauth_required').length;
  const revokedConnections = connections.filter((connection) => connection.status === 'revoked').length;
  const healthTone = reauthRequiredConnections || failedJobs || staleConnections ? 'brass' : 'moss';
  const statusTone = status === 'connected' ? 'moss' : 'brass';

  return (
    <div className="space-y-5">
      {status ? (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Connection callback</h2>
              <p className="mt-2 text-sm text-slate-700">
                {provider ? `${provider} reported ${status}.` : `Provider callback reported ${status}.`}
              </p>
              {message ? <p className="mt-2 text-sm text-slate-600">{message}</p> : null}
            </div>
            <Badge tone={statusTone}>{status}</Badge>
          </div>
        </Card>
      ) : null}

      <Card>
        <h1 className="text-2xl font-semibold">Connection vault</h1>
        <p className="mt-3 text-sm leading-7 text-slate-700">
          {workspace
            ? `Active workspace: ${workspace.name}. Install providers at the workspace level for shared tools or at the personal level for delegated access.`
            : 'Create a workspace first, then connect providers via the OAuth callback routes.'}
        </p>
        {workspace ? (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge tone={processingJobs ? 'brass' : 'moss'}>{processingJobs} processing</Badge>
              <Badge tone={queuedJobs ? 'default' : 'moss'}>{queuedJobs} queued</Badge>
              <Badge tone={failedJobs ? 'brass' : 'moss'}>{failedJobs} failed</Badge>
              <Badge tone={healthTone}>{staleConnections} stale refreshes</Badge>
              <Badge tone={revokedConnections ? 'brass' : 'moss'}>{revokedConnections} revoked</Badge>
            </div>
            {reauthRequiredConnections ? (
              <p className="text-sm text-red-700">{reauthRequiredConnections} connection(s) need re-auth.</p>
            ) : null}
          </div>
        ) : null}
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {Object.entries(providerCapabilities).map(([providerKey, tools]) => {
          const providerConnections = connections.filter((item) => item.provider === providerKey);
          const activeCount = providerConnections.filter((item) => item.status === 'active').length;
          const redirectTo = workspace ? encodeURIComponent(`/connections?workspace=${workspace.id}`) : '';
          const workspaceConnectHref = workspace
            ? `/api/integrations/${providerKey}/connect?workspace_id=${workspace.id}&scope=workspace&redirect_to=${redirectTo}`
            : '/workspaces';
          const personalConnectHref = workspace
            ? `/api/integrations/${providerKey}/connect?workspace_id=${workspace.id}&scope=personal&redirect_to=${redirectTo}`
            : '/workspaces';

          return (
            <Card key={providerKey}>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-semibold capitalize">{providerKey}</h2>
                <Badge tone={activeCount ? 'moss' : 'brass'}>{activeCount ? `${activeCount} active` : 'not connected'}</Badge>
              </div>
              {providerConnections.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">No provider installs yet.</p>
              ) : null}
              <ul className="mt-4 space-y-2 text-sm text-slate-700">
                {tools.map((tool) => (
                  <li key={tool}>{tool}</li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                {(() => {
                  const providerConnectionIds = providerConnections.map((connection) => connection.id);
                  const providerJobs = providerConnectionIds.flatMap((connectionId) => jobsByConnection.get(connectionId) ?? []);
                  const providerFailedJobs = providerJobs.filter((job) => job.status === 'failed').length;
                  const providerQueuedJobs = providerJobs.filter((job) => job.status === 'queued').length;
                  const providerProcessingJobs = providerJobs.filter((job) => job.status === 'processing').length;

                  return (
                    <>
                      <Badge tone={providerFailedJobs ? 'brass' : 'moss'}>{providerFailedJobs} failed jobs</Badge>
                      <Badge tone={providerQueuedJobs ? 'default' : 'moss'}>{providerQueuedJobs} queued jobs</Badge>
                      <Badge tone={providerProcessingJobs ? 'brass' : 'moss'}>{providerProcessingJobs} processing</Badge>
                    </>
                  );
                })()}
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
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
                <p className="mt-3 text-xs text-slate-500">Workspace installs require an owner or admin role.</p>
              ) : null}
              <div className="mt-5 space-y-3">
                {providerConnections.length === 0 ? (
                  <p className="text-sm text-slate-700">No connection records for this provider yet.</p>
                ) : (
                  providerConnections.map((connection) => {
                    const recentJobs = (jobsByConnection.get(connection.id) ?? []).slice(0, 3);
                    return (
                      <div key={connection.id} className="rounded-2xl border border-black/5 bg-white/70 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-ink">{connection.display_name}</p>
                          <p className="text-sm text-slate-700">
                            {connection.scope} • {connection.status}
                          </p>
                          {connection.external_account_email ? (
                            <p className="text-sm text-slate-700">{connection.external_account_email}</p>
                          ) : null}
                          {connection.reauth_required_reason ? (
                            <p className="mt-2 text-xs text-red-700">{connection.reauth_required_reason}</p>
                          ) : null}
                          {connection.status === 'active' && isStaleRefresh(connection.last_refreshed_at) ? (
                            <p className="mt-2 text-xs text-amber-700">Token refresh is stale and may need manual recheck.</p>
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
            </Card>
          );
        })}
      </div>
    </div>
  );
}
