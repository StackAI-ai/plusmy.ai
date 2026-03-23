import Link from 'next/link';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '@plusmy/ui';
import { plannedProviderPlatforms, getPlatformCounts, getProviderMetadata, supportedProviders } from '@plusmy/contracts';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { getAuthorizedWorkspace, listConnectionsForWorkspace, listUserWorkspaces } from '@plusmy/core';
import { DisconnectConnectionButton } from './disconnect-button';
import { RefreshConnectionButton } from './refresh-button';
import { SyncConnectionButton } from './sync-button';
import { getSearchParam, type AppSearchParams } from '../_lib/search-params';
import { getConnectionHealth } from './filters';
import { redirect } from 'next/navigation';

const providerInstanceConfig = {
  servicenow: {
    key: 'instanceUrl',
    param: 'instance_url',
    label: 'ServiceNow instance URL',
    placeholder: 'https://your-instance.service-now.com'
  },
  okta: {
    key: 'tenantUrl',
    param: 'tenant_url',
    label: 'Okta tenant URL',
    placeholder: 'https://your-org.okta.com'
  },
  zendesk: {
    key: 'instanceUrl',
    param: 'instance_url',
    label: 'Zendesk instance URL',
    placeholder: 'https://your-subdomain.zendesk.com'
  }
} as const;

type ProviderWithInstanceConfig = keyof typeof providerInstanceConfig;

function getProviderConnectSpec(provider: string) {
  return Object.hasOwn(providerInstanceConfig, provider)
    ? (providerInstanceConfig[provider as ProviderWithInstanceConfig])
    : null;
}

function getConnectionInstanceValue(
  connection: {
    metadata: unknown;
  },
  provider: ProviderWithInstanceConfig
) {
  const metadata = connection.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return '';
  }

  const record = metadata as Record<string, unknown>;
  const configKey = providerInstanceConfig[provider].key;
  const legacyKey = configKey === 'instanceUrl' ? 'instance_url' : 'tenant_url';
  const value = typeof record[configKey] === 'string' ? record[configKey] : '';
  const legacyValue = typeof record[legacyKey] === 'string' ? record[legacyKey] : '';
  return value.length > 0 ? value : legacyValue;
}

function buildConnectLink(input: {
  workspaceId: string;
  provider: string;
  scope: 'workspace' | 'personal';
  redirectTo: string;
  baseUrl?: string;
}) {
  const base = new URLSearchParams({
    workspace_id: input.workspaceId,
    scope: input.scope,
    redirect_to: input.redirectTo
  });

  if (input.baseUrl) {
    base.set(getProviderConnectSpec(input.provider)?.param ?? 'provider_base_url', input.baseUrl);
  }

  return `/api/integrations/${input.provider}/connect?${base.toString()}`;
}

function buildReconnectHref(
  workspaceId: string,
  connection: {
    provider: string;
    metadata: unknown;
    scope: 'workspace' | 'personal';
  }
) {
  const spec = getProviderConnectSpec(connection.provider);
  const baseValue = spec ? getConnectionInstanceValue(connection, connection.provider as ProviderWithInstanceConfig) : '';
  return buildConnectLink({
    workspaceId,
    provider: connection.provider,
    scope: connection.scope,
    redirectTo: `/connections?workspace=${workspaceId}`,
    baseUrl: spec ? baseValue : undefined
  });
}

export default async function ConnectionsPage({ searchParams }: { searchParams?: AppSearchParams }) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const workspaces = await listUserWorkspaces(user.id);
  const requestedWorkspaceId = await getSearchParam(searchParams, 'workspace');
  const providerFilter = await getSearchParam(searchParams, 'provider');
  const workspace = await getAuthorizedWorkspace(user.id, requestedWorkspaceId);
  const activeMembership = workspace ? workspaces.find((entry) => entry.id === workspace.id) : null;
  const canManageWorkspaceConnections = activeMembership?.role === 'owner' || activeMembership?.role === 'admin';
  const connections = workspace ? await listConnectionsForWorkspace(workspace.id, user.id) : [];
  const platformCounts = getPlatformCounts();
  const hasPlannedProviders = plannedProviderPlatforms.length > 0;
  const visibleProviderCatalog =
    providerFilter && supportedProviders.some((entry) => entry.providerId === providerFilter)
      ? supportedProviders.filter((entry) => entry.providerId === providerFilter)
      : supportedProviders;
  const visibleConnectionCount = providerFilter
    ? connections.filter((connection) => connection.provider === providerFilter).length
    : connections.length;

  if (!workspace) {
    return (
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Business tools</CardTitle>
            <CardDescription>Choose a workspace to connect business tools and expose governed MCP actions.</CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{hasPlannedProviders ? 'Growth roadmap' : 'Current coverage focus'}</CardTitle>
            <CardDescription>
              {hasPlannedProviders
                ? 'High-priority additions remain focused on finance, support, and execution tooling.'
                : 'The live catalog now covers the core business-tool set. Current work is hardening installs, health, and onboarding.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {(hasPlannedProviders
              ? plannedProviderPlatforms.slice(0, 8).map((platform) => platform.name)
              : supportedProviders
                  .filter((provider) => ['crm', 'support', 'finance', 'project_management', 'productivity'].includes(provider.category))
                  .slice(0, 8)
                  .map((provider) => provider.name)
            ).map((label) => (
              <Badge key={label}>{label}</Badge>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }
  const workspaceId = workspace.id;
  const redirectTo = `/connections?workspace=${workspaceId}`;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Business tools</CardTitle>
          <CardDescription>
            {workspace
              ? `Workspace: ${workspace.name}. Connect the tools used by your operations, sales, and engineering teams.`
              : 'Select a workspace to manage its business tool connections.'}
          </CardDescription>
        </CardHeader>
        {workspace ? (
          <CardContent className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Badge tone="moss">{platformCounts.liveProviders} live tools</Badge>
              <Badge>{hasPlannedProviders ? `${platformCounts.plannedPlatforms} planned tools` : 'Private beta hardening'}</Badge>
              <Badge tone={visibleConnectionCount ? 'moss' : 'brass'}>{visibleConnectionCount} active installs</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant={providerFilter == null ? 'default' : 'outline'}>
                <Link href={`/connections?workspace=${workspaceId}`} prefetch={false}>
                  All tools
                </Link>
              </Button>
              {supportedProviders.map((provider) => (
                <Button
                  key={provider.id}
                  asChild
                  size="sm"
                  variant={provider.providerId === providerFilter ? 'default' : 'outline'}
                >
                  <Link
                    href={
                      workspaceId
                        ? `/connections?${new URLSearchParams({
                            workspace: workspaceId,
                            provider: provider.providerId
                          }).toString()}`
                        : `/connections?provider=${provider.providerId}`
                    }
                  >
                    {provider.name}
                  </Link>
                </Button>
              ))}
            </div>
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{hasPlannedProviders ? 'Growth roadmap' : 'Current coverage focus'}</CardTitle>
          <CardDescription>
            {hasPlannedProviders
              ? 'High-priority additions remain focused on finance, support, and execution tooling.'
              : 'The live catalog now covers the core business-tool set. Current work is hardening installs, health, and onboarding.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {(hasPlannedProviders
            ? plannedProviderPlatforms.slice(0, 8).map((platform) => platform.name)
            : supportedProviders
                .filter((provider) => ['crm', 'support', 'finance', 'project_management', 'productivity'].includes(provider.category))
                .slice(0, 8)
                .map((provider) => provider.name)
          ).map((label) => (
            <Badge key={label}>{label}</Badge>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visibleProviderCatalog.map((provider) => {
          const providerConnections = connections.filter((item) => item.provider === provider.providerId);
          const providerMetadata = getProviderMetadata(provider.providerId);
          const instanceSpec = getProviderConnectSpec(provider.providerId);
          const defaultInstanceValue = providerConnections.find(Boolean)
            ? instanceSpec
              ? getConnectionInstanceValue(providerConnections[0], provider.providerId as ProviderWithInstanceConfig)
              : ''
            : '';

          return (
            <Card key={provider.id}>
              <CardHeader className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle>{provider.name}</CardTitle>
                  <Badge tone={providerConnections.length ? 'moss' : 'default'}>
                    {providerConnections.length ? `${providerConnections.length} installs` : 'not connected'}
                  </Badge>
                </div>
                <CardDescription>{provider.summary}</CardDescription>
                <div className="flex flex-wrap gap-2">
                  <Badge>{provider.category.replaceAll('_', ' ')}</Badge>
                  {providerMetadata?.capabilities.slice(0, 3).map((capability) => (
                    <Badge key={capability.label} tone="default">
                      {capability.label}
                    </Badge>
                  ))}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-3">
                  {canManageWorkspaceConnections ? (
                    instanceSpec ? (
                      <form method="GET" action={`/api/integrations/${provider.providerId}/connect`} className="space-y-2">
                        <input type="hidden" name="workspace_id" value={workspaceId} />
                        <input type="hidden" name="scope" value="workspace" />
                        <input type="hidden" name="redirect_to" value={redirectTo} />
                        <label htmlFor={`${provider.providerId}-workspace`} className="text-xs text-muted-foreground">
                          {instanceSpec.label}
                        </label>
                        <Input
                          id={`${provider.providerId}-workspace`}
                          name={instanceSpec.param}
                          type="url"
                          required
                          placeholder={instanceSpec.placeholder}
                          defaultValue={defaultInstanceValue ?? ''}
                        />
                        <Button type="submit" size="sm">
                          Connect workspace
                        </Button>
                      </form>
                    ) : (
                      <Button asChild size="sm">
                        <a href={buildConnectLink({ workspaceId, provider: provider.providerId, scope: 'workspace', redirectTo })}>
                          Connect workspace
                        </a>
                      </Button>
                    )
                  ) : null}
                  {instanceSpec ? (
                    <form method="GET" action={`/api/integrations/${provider.providerId}/connect`} className="space-y-2">
                      <input type="hidden" name="workspace_id" value={workspaceId} />
                      <input type="hidden" name="scope" value="personal" />
                      <input type="hidden" name="redirect_to" value={redirectTo} />
                      <label htmlFor={`${provider.providerId}-personal`} className="text-xs text-muted-foreground">
                        {instanceSpec.label}
                      </label>
                      <Input
                        id={`${provider.providerId}-personal`}
                        name={instanceSpec.param}
                        type="url"
                        required
                        placeholder={instanceSpec.placeholder}
                        defaultValue={defaultInstanceValue ?? ''}
                      />
                      <Button type="submit" size="sm" tone="secondary">
                        Connect personal
                      </Button>
                    </form>
                  ) : (
                    <Button asChild size="sm" tone="secondary">
                      <a
                        href={buildConnectLink({
                          workspaceId,
                          provider: provider.providerId,
                          scope: 'personal',
                          redirectTo
                        })}
                      >
                        Connect personal
                      </a>
                    </Button>
                  )}
                </div>

                {providerConnections.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No installs yet. Add this tool to enable governed MCP workflows.</p>
                ) : (
                  <div className="space-y-3">
                    {providerConnections.map((connection) => {
                      const health = getConnectionHealth(connection);
                      const canReconnect = connection.scope === 'personal' || canManageWorkspaceConnections;
                      const reconnectHref = workspaceId ? buildReconnectHref(workspaceId, connection) : null;
                      const needsBaseUrl = instanceSpec && !getConnectionInstanceValue(connection, provider.providerId as ProviderWithInstanceConfig);

                      return (
                        <div key={connection.id} className="rounded-2xl border border-border/70 p-4">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="space-y-1">
                                <p className="font-medium">{connection.display_name}</p>
                                <p className="text-sm text-muted-foreground">{connection.scope} scope</p>
                              </div>
                              <Badge tone={health.tone}>{health.label}</Badge>
                            </div>
                            {needsBaseUrl ? (
                              <p className="text-xs text-amber-700">
                                Reconnect required to restore base URL metadata for this instance-based provider.
                              </p>
                            ) : null}
                            {connection.reauth_required_reason ? <p className="text-sm text-amber-700">{connection.reauth_required_reason}</p> : null}
                            <div className="flex flex-wrap gap-2 pt-2">
                              {canReconnect && reconnectHref ? (
                                <Button asChild size="sm">
                                  <a href={reconnectHref}>Reconnect</a>
                                </Button>
                              ) : null}
                              {connection.status !== 'revoked' ? (
                                <>
                                  <SyncConnectionButton workspaceId={workspaceId} connectionId={connection.id} />
                                  <RefreshConnectionButton workspaceId={workspaceId} connectionId={connection.id} />
                                  <DisconnectConnectionButton workspaceId={workspaceId} connectionId={connection.id} />
                                </>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
