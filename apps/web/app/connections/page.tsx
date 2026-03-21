import { Badge, Button, Card } from '@plusmy/ui';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { getAuthorizedWorkspace, listConnectionsForWorkspace, listUserWorkspaces } from '@plusmy/core';
import { RefreshConnectionButton } from './refresh-button';
import { DisconnectConnectionButton } from './disconnect-button';
import { getSearchParam, type AppSearchParams } from '../_lib/search-params';

const providerCapabilities = {
  google: ['google.search_drive', 'google.get_document'],
  slack: ['slack.list_channels', 'slack.read_channel_history', 'slack.post_message'],
  notion: ['notion.search', 'notion.get_page', 'notion.create_page']
} as const;

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
              <ul className="mt-4 space-y-2 text-sm text-slate-700">
                {tools.map((tool) => (
                  <li key={tool}>{tool}</li>
                ))}
              </ul>
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
                  providerConnections.map((connection) => (
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
                          <div className="mt-3 flex flex-wrap gap-2">
                            {(connection.granted_scopes as string[] | null | undefined)?.map((scope) => (
                              <Badge key={scope} tone="brass">
                                {scope}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        {workspace ? (
                          <div className="flex flex-col items-end gap-2">
                            {connection.status !== 'revoked' ? (
                              <>
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
                  ))
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
