import Link from 'next/link';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@plusmy/ui';
import type { AuditLogRecord, OAuthClientApprovalRecord, ToolInvocationRecord } from '@plusmy/contracts';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { getAuthorizedWorkspace, listAuditLogs, listOAuthClientApprovals, listOAuthClients, listToolInvocations, listUserWorkspaces } from '@plusmy/core';
import { ClientRegistrationForm } from './client-registration-form';
import { RevokeApprovalButton } from './revoke-approval-button';
import { getSearchParam, type AppSearchParams } from '../_lib/search-params';

const staleApprovalWindowDays = 14;
const approvalExchangeGraceWindowDays = 3;

function canManageWorkspace(role: string | undefined) {
  return role === 'owner' || role === 'admin';
}

function isRecent(isoTimestamp: string | null | undefined, windowDays: number) {
  if (!isoTimestamp) return false;
  return Date.now() - new Date(isoTimestamp).getTime() <= windowDays * 24 * 60 * 60 * 1000;
}

function isStaleApproval(approval: OAuthClientApprovalRecord) {
  return approval.status === 'active' && !isRecent(approval.last_used_at, staleApprovalWindowDays) && !isApprovalAwaitingTokenExchange(approval);
}

function isApprovalAwaitingTokenExchange(approval: OAuthClientApprovalRecord) {
  if (approval.status !== 'active' || !isRecent(approval.approved_at, approvalExchangeGraceWindowDays)) {
    return false;
  }

  if (!approval.last_used_at) {
    return true;
  }

  return new Date(approval.last_used_at).getTime() < new Date(approval.approved_at).getTime();
}

function extractAuditClientId(entry: AuditLogRecord) {
  if (entry.actor_client_id) return entry.actor_client_id;
  const metadata = entry.metadata;
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') return null;
  const value = metadata.client_id;
  return typeof value === 'string' ? value : null;
}

function latestTimestamp(left: string | null, right: string | null) {
  if (!left) return right;
  if (!right) return left;
  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

function buildClientAuditHref(workspaceId: string, clientId: string) {
  const params = new URLSearchParams({
    workspace: workspaceId,
    client: clientId
  });
  return `/audit?${params.toString()}`;
}

function getApprovalMetadataString(approval: OAuthClientApprovalRecord, key: string) {
  const metadata = approval.metadata;
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') return null;

  const value = (metadata as Record<string, unknown>)[key];
  if (typeof value !== 'string') return null;

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

function buildApprovalAuthorizeHref(workspaceId: string, approval: OAuthClientApprovalRecord) {
  const storedRedirectUri = getApprovalMetadataString(approval, 'redirect_uri');
  if (!storedRedirectUri) return null;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: approval.client_id,
    redirect_uri: storedRedirectUri,
    scope: approval.scopes.join(' '),
    workspace_id: workspaceId,
    source: 'operator_ui'
  });

  return `/authorize?${params.toString()}`;
}

function getRedirectHostLabel(redirectUri: string | null) {
  if (!redirectUri) return null;

  try {
    return new URL(redirectUri).host;
  } catch {
    return redirectUri;
  }
}

function getApprovalHealth(approval: OAuthClientApprovalRecord) {
  if (approval.status === 'revoked') {
    return {
      tone: 'brass' as const,
      label: 'Revoked',
      detail: approval.revoked_at ? `Revoked at ${approval.revoked_at}.` : 'This approval has already been revoked.'
    };
  }

  if (isApprovalAwaitingTokenExchange(approval)) {
    return {
      tone: 'default' as const,
      label: 'Awaiting token exchange',
      detail: 'Recently approved or reauthorized. The client still needs to exchange a fresh code before token activity updates.'
    };
  }

  if (isStaleApproval(approval)) {
    return {
      tone: 'brass' as const,
      label: 'Stale approval',
      detail: `No token usage recorded in the last ${staleApprovalWindowDays} days.`
    };
  }

  if (isRecent(approval.last_used_at, 7)) {
    return {
      tone: 'moss' as const,
      label: 'Recently used',
      detail: 'Token usage was recorded during the last 7 days.'
    };
  }

  return {
    tone: 'moss' as const,
    label: 'Active',
    detail: 'This approval can still mint or refresh MCP access tokens.'
  };
}

type ClientActivitySummary = {
  clientId: string;
  clientName: string;
  approvals: number;
  activeApprovals: number;
  revokedApprovals: number;
  recentAuditEvents: number;
  recentToolCalls: number;
  recentErrors: number;
  lastActivityAt: string | null;
};

function buildClientActivitySummaries(
  approvals: OAuthClientApprovalRecord[],
  audit: AuditLogRecord[],
  invocations: ToolInvocationRecord[]
) {
  const summaries = new Map<string, ClientActivitySummary>();

  for (const approval of approvals) {
    const entry = summaries.get(approval.client_id) ?? {
      clientId: approval.client_id,
      clientName: approval.client_name ?? approval.client_id,
      approvals: 0,
      activeApprovals: 0,
      revokedApprovals: 0,
      recentAuditEvents: 0,
      recentToolCalls: 0,
      recentErrors: 0,
      lastActivityAt: null
    };

    entry.approvals += 1;
    entry.activeApprovals += approval.status === 'active' ? 1 : 0;
    entry.revokedApprovals += approval.status === 'revoked' ? 1 : 0;
    entry.lastActivityAt = latestTimestamp(entry.lastActivityAt, approval.last_used_at ?? approval.approved_at);
    summaries.set(approval.client_id, entry);
  }

  for (const entry of audit) {
    const clientId = extractAuditClientId(entry);
    if (!clientId) continue;
    const summary = summaries.get(clientId);
    if (!summary) continue;
    summary.recentAuditEvents += 1;
    summary.recentErrors += entry.status === 'error' ? 1 : 0;
    summary.lastActivityAt = latestTimestamp(summary.lastActivityAt, entry.created_at);
  }

  for (const invocation of invocations) {
    if (!invocation.actor_client_id) continue;
    const summary = summaries.get(invocation.actor_client_id);
    if (!summary) continue;
    summary.recentToolCalls += 1;
    summary.recentErrors += invocation.status === 'error' ? 1 : 0;
    summary.lastActivityAt = latestTimestamp(summary.lastActivityAt, invocation.created_at);
  }

  return Array.from(summaries.values()).sort((left, right) => {
    if (!left.lastActivityAt && !right.lastActivityAt) return left.clientName.localeCompare(right.clientName);
    if (!left.lastActivityAt) return 1;
    if (!right.lastActivityAt) return -1;
    return new Date(right.lastActivityAt).getTime() - new Date(left.lastActivityAt).getTime();
  });
}

export default async function McpClientsPage({ searchParams }: { searchParams?: AppSearchParams }) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">MCP clients</CardTitle>
          <CardDescription>
            Sign in first. Dynamic client registration is tied to the current authenticated user.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const clients = await listOAuthClients(user.id);
  const workspaces = await listUserWorkspaces(user.id);
  const requestedWorkspaceId = await getSearchParam(searchParams, 'workspace');
  const workspace = await getAuthorizedWorkspace(user.id, requestedWorkspaceId);
  const activeMembership = workspace ? workspaces.find((entry) => entry.id === workspace.id) : null;
  const canReviewWorkspaceApprovals = canManageWorkspace(activeMembership?.role);
  const [approvals, approvalActivity, recentInvocations] = workspace
    ? await Promise.all([
        listOAuthClientApprovals({
          workspaceId: workspace.id,
          userId: user.id,
          includeWorkspaceApprovals: canReviewWorkspaceApprovals
        }),
        canReviewWorkspaceApprovals
          ? listAuditLogs(workspace.id, {
              limit: 40,
              resourceType: 'oauth_client_approval',
              actionPrefix: 'oauth_client.'
            })
          : Promise.resolve<AuditLogRecord[]>([]),
        canReviewWorkspaceApprovals ? listToolInvocations(workspace.id, { limit: 40 }) : Promise.resolve<ToolInvocationRecord[]>([])
      ])
    : [[], [], []];
  const baseUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const activeApprovals = approvals.filter((approval) => approval.status === 'active').length;
  const revokedApprovals = approvals.filter((approval) => approval.status === 'revoked').length;
  const recentlyUsedApprovals = approvals.filter((approval) => isRecent(approval.last_used_at, 7)).length;
  const staleApprovals = approvals.filter((approval) => isStaleApproval(approval)).length;
  const awaitingTokenExchangeApprovals = approvals.filter((approval) => isApprovalAwaitingTokenExchange(approval)).length;
  const reauthorizableApprovals = approvals.filter((approval) => approval.status === 'active' && approval.user_id === user.id).length;
  const clientActivity = buildClientActivitySummaries(approvals, approvalActivity, recentInvocations);
  const activeClients = clientActivity.filter((entry) => entry.recentToolCalls > 0 || entry.recentAuditEvents > 0).length;

  return (
    <div className="space-y-5">
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <Card className="space-y-2">
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Registered clients</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold text-foreground">{clients.length}</p>
            <p className="text-sm text-muted-foreground">OAuth clients created by the current operator account.</p>
          </CardContent>
        </Card>
        <Card className="space-y-2">
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Active approvals</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold text-foreground">{activeApprovals}</p>
            <p className="text-sm text-muted-foreground">
              Delegated grants that can still mint or refresh tokens. {revokedApprovals} revoked.
            </p>
          </CardContent>
        </Card>
        <Card className="space-y-2">
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Used in the last 7 days</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold text-foreground">{recentlyUsedApprovals}</p>
            <p className="text-sm text-muted-foreground">Approvals with recent token usage recorded on the approval itself.</p>
          </CardContent>
        </Card>
        <Card className="space-y-2">
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Stale approvals</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold text-foreground">{staleApprovals}</p>
            <p className="text-sm text-muted-foreground">
            Active approvals with no token usage in the last {staleApprovalWindowDays} days. {awaitingTokenExchangeApprovals} awaiting client exchange.
            </p>
          </CardContent>
        </Card>
        <Card className="space-y-2">
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Recent active clients</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold text-foreground">{canReviewWorkspaceApprovals ? activeClients : 0}</p>
            <p className="text-sm text-muted-foreground">
              {canReviewWorkspaceApprovals ? 'Clients with recent approval or tool activity in this workspace.' : 'Detailed activity requires owner or admin access.'}
            </p>
          </CardContent>
        </Card>
        <Card className="space-y-2">
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-[0.18em] text-muted-foreground">You can renew</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold text-foreground">{reauthorizableApprovals}</p>
            <p className="text-sm text-muted-foreground">Only the original approving user can reauthorize an active approval.</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 md:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4 space-y-0">
            <div className="space-y-3">
              <CardTitle className="text-2xl">Registered MCP clients</CardTitle>
              <CardDescription>
                These clients can use the plusmy.ai authorization server and request delegated access to your
                workspace tools and resources.
              </CardDescription>
            </div>
            <Badge tone="moss">{clients.length} clients</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {clients.length === 0 ? (
              <p className="text-sm text-muted-foreground">No registered clients yet.</p>
            ) : (
              clients.map((client) => {
                const primaryRedirectUri = client.redirect_uris[0] ?? 'http://localhost:3000/callback';
                const authorizeUrl = `${baseUrl}/authorize?response_type=code&client_id=${client.client_id}&redirect_uri=${encodeURIComponent(primaryRedirectUri)}&scope=mcp%3Atools%20mcp%3Aresources${workspace ? `&workspace_id=${workspace.id}` : ''}&code_challenge=REPLACE_WITH_PKCE_CHALLENGE&code_challenge_method=S256`;

                return (
                  <div key={client.client_id} className="rounded-2xl border border-black/5 bg-white/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-ink">{client.client_name}</p>
                        <p className="text-sm text-slate-700">{client.client_id}</p>
                      </div>
                      <Badge tone={client.token_endpoint_auth_method === 'none' ? 'brass' : 'moss'}>
                        {client.token_endpoint_auth_method}
                      </Badge>
                    </div>
                    <div className="mt-3 space-y-1 text-sm text-slate-700">
                      {client.redirect_uris.map((uri: string) => (
                        <p key={uri}>{uri}</p>
                      ))}
                    </div>
                    {workspace ? (
                      <div className="mt-4 rounded-2xl border border-black/5 bg-black/5 p-3 text-xs text-slate-700">
                        <p className="font-semibold text-ink">Workspace-scoped authorize URL</p>
                        <p className="mt-2 break-all">{authorizeUrl}</p>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
        <ClientRegistrationForm />
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div className="space-y-3">
            <CardTitle>Delegated approvals</CardTitle>
            <CardDescription>
              {workspace
                ? canReviewWorkspaceApprovals
                  ? `Review and revoke MCP client approvals granted inside ${workspace.name}.`
                  : `Review the MCP client approvals you granted inside ${workspace.name}.`
                : 'Select a workspace to inspect delegated approvals.'}
            </CardDescription>
          </div>
          <Badge tone={approvals.length ? 'moss' : 'brass'}>{approvals.length} approvals</Badge>
        </CardHeader>
        {workspace ? (
          <CardContent className="space-y-3">
            {canReviewWorkspaceApprovals === false ? (
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Showing approvals you personally granted.</p>
            ) : null}
            {canReviewWorkspaceApprovals ? (
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Recent tool calls now record MCP client IDs for approval-to-runtime correlation.</p>
            ) : null}
            {approvals.length === 0 ? (
              <p className="text-sm text-muted-foreground">No approvals recorded for this workspace yet.</p>
            ) : (
              approvals.map((approval) => {
                const canRevoke = approval.status === 'active' && (approval.user_id === user.id || canReviewWorkspaceApprovals);
                const canReauthorize = approval.status === 'active' && approval.user_id === user.id;
                const summary = clientActivity.find((entry) => entry.clientId === approval.client_id);
                const approvalHealth = getApprovalHealth(approval);
                const storedRedirectUri = getApprovalMetadataString(approval, 'redirect_uri');
                const reauthorizeHref = canReauthorize ? buildApprovalAuthorizeHref(workspace.id, approval) : null;
                const redirectHostLabel = getRedirectHostLabel(storedRedirectUri);

                return (
                  <div key={approval.id} className="rounded-2xl border border-black/5 bg-white/70 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-ink">{approval.client_name ?? approval.client_id}</p>
                        <p className="text-sm text-slate-700">{approval.client_id}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {approval.token_endpoint_auth_method ? <Badge>{approval.token_endpoint_auth_method}</Badge> : null}
                        <Badge tone={approval.status === 'revoked' ? 'brass' : 'moss'}>{approval.status}</Badge>
                        <Badge tone={approvalHealth.tone}>{approvalHealth.label}</Badge>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {approval.scopes.map((scope) => (
                        <Badge key={scope} tone="brass">
                          {scope}
                        </Badge>
                      ))}
                    </div>
                    <div className="mt-4 space-y-1 text-sm text-slate-700">
                      <p>{approval.user_id === user.id ? 'Approved by you' : `Approved by ${approval.user_id}`}</p>
                      <p>Approved at {approval.approved_at}</p>
                      <p>{approval.last_used_at ? `Last token issued ${approval.last_used_at}` : 'No token exchanges recorded yet.'}</p>
                      <p className={approvalHealth.tone === 'brass' ? 'text-amber-700' : 'text-slate-700'}>{approvalHealth.detail}</p>
                      {redirectHostLabel ? <p>Reauthorization returns to {redirectHostLabel}.</p> : null}
                      {approval.status === 'active' && isStaleApproval(approval) && approval.user_id !== user.id ? (
                        <p className="text-amber-700">Only the original approving user can renew this stale approval.</p>
                      ) : null}
                      {approval.status === 'active' && isStaleApproval(approval) && canReauthorize && !reauthorizeHref ? (
                        <p className="text-amber-700">No stored redirect URI is available, so renewal must start from the client itself.</p>
                      ) : null}
                      {approval.revoked_at ? <p>Revoked at {approval.revoked_at}</p> : null}
                      {summary && canReviewWorkspaceApprovals ? (
                        <p>
                          Recent MCP calls {summary.recentToolCalls} • audit events {summary.recentAuditEvents} • errors {summary.recentErrors}
                        </p>
                      ) : null}
                    </div>
                    {canReviewWorkspaceApprovals ? (
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <Button asChild size="sm" variant="outline">
                          <Link href={buildClientAuditHref(workspace.id, approval.client_id)}>Inspect audit trail</Link>
                        </Button>
                        {reauthorizeHref ? (
                          <Button asChild size="sm" variant="outline">
                            <Link href={reauthorizeHref} target="_blank" rel="noreferrer">
                              {isStaleApproval(approval) ? 'Reauthorize now' : 'Open consent flow'}
                            </Link>
                          </Button>
                        ) : null}
                      </div>
                    ) : reauthorizeHref ? (
                      <div className="mt-4">
                        <Button asChild size="sm" variant="outline">
                          <Link href={reauthorizeHref} target="_blank" rel="noreferrer">
                            {isStaleApproval(approval) ? 'Reauthorize now' : 'Open consent flow'}
                          </Link>
                        </Button>
                      </div>
                    ) : null}
                    {canRevoke ? (
                      <div className="mt-4">
                        <RevokeApprovalButton workspaceId={workspace.id} approvalId={approval.id} />
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </CardContent>
        ) : null}
      </Card>

      {workspace && canReviewWorkspaceApprovals ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
            <div className="space-y-3">
              <CardTitle>Recent client activity</CardTitle>
              <CardDescription>
                Review which registered clients are actively calling MCP tools and generating approval lifecycle
                events.
              </CardDescription>
            </div>
            <Badge tone={clientActivity.length ? 'moss' : 'brass'}>{clientActivity.length} tracked clients</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {clientActivity.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent approval or invocation activity for this workspace yet.</p>
            ) : (
              clientActivity.map((entry) => (
                <div key={entry.clientId} className="rounded-2xl border border-black/5 bg-white/70 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">{entry.clientName}</p>
                      <p className="text-sm text-slate-700">{entry.clientId}</p>
                    </div>
                    <Badge tone={entry.recentErrors ? 'brass' : 'moss'}>{entry.recentErrors ? `${entry.recentErrors} errors` : 'healthy'}</Badge>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Approvals</p>
                      <p className="mt-1 text-lg font-semibold text-ink">{entry.activeApprovals}</p>
                      <p className="text-xs text-slate-500">{entry.revokedApprovals} revoked</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Tool calls</p>
                      <p className="mt-1 text-lg font-semibold text-ink">{entry.recentToolCalls}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Audit events</p>
                      <p className="mt-1 text-lg font-semibold text-ink">{entry.recentAuditEvents}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Last activity</p>
                      <p className="mt-1 text-sm font-medium text-slate-700">{entry.lastActivityAt ?? 'No activity yet'}</p>
                    </div>
                  </div>
                  <div className="mt-4">
                    <Button asChild size="sm" variant="outline">
                      <Link href={buildClientAuditHref(workspace.id, entry.clientId)}>Open filtered audit view</Link>
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <p className="text-sm uppercase tracking-[0.22em] text-muted-foreground">Quickstart</p>
          <Badge tone={workspace ? 'moss' : 'brass'}>{workspace ? workspace.name : `${workspaces.length} workspaces available`}</Badge>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3 text-sm leading-7 text-muted-foreground">
            <li>1. Register a client with a valid redirect URI.</li>
            <li>2. Use `{baseUrl}/.well-known/oauth-authorization-server` for discovery.</li>
            <li>3. Send users through `{baseUrl}/authorize` with PKCE and include `workspace_id` when you want a specific workspace context.</li>
            <li>4. Exchange the code at `{baseUrl}/token` and call `{baseUrl}/mcp` with the bearer token.</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
