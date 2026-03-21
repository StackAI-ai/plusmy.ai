import Link from 'next/link';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@plusmy/ui';
import { createServerSupabaseClient } from '@plusmy/supabase';
import {
  getAuthorizedWorkspace,
  getWorkspaceOverview,
  listConnectionsForWorkspace,
  listOAuthClients,
  listUserWorkspaces
} from '@plusmy/core';
import { getSearchParam, type AppSearchParams } from '../_lib/search-params';

export default async function OnboardingPage({ searchParams }: { searchParams?: AppSearchParams }) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const workspaces = user ? await listUserWorkspaces(user.id) : [];
  const requestedWorkspaceId = await getSearchParam(searchParams, 'workspace');
  const workspace = user ? await getAuthorizedWorkspace(user.id, requestedWorkspaceId) : null;
  const overview = workspace && user ? await getWorkspaceOverview(workspace.id, user.id) : null;
  const connections = workspace && user ? await listConnectionsForWorkspace(workspace.id, user.id) : [];
  const clients = user ? await listOAuthClients(user.id) : [];

  const workspaceLabel = workspace
    ? workspace.name
    : workspaces.length > 0
      ? String(workspaces.length) + ' workspace(s)'
      : 'Create your first workspace';

  const checklist = [
    {
      label: 'Create a workspace',
      done: workspaces.length > 0,
      href: '/workspaces',
      detail: workspaces.length > 0 ? String(workspaces.length) + ' workspace(s) ready' : 'Seed tenancy and default prompts'
    },
    {
      label: 'Invite operators',
      done: workspace != null,
      href: workspace ? '/workspaces?workspace=' + workspace.id : '/workspaces',
      detail: workspace ? 'Manage members inside ' + workspace.name : 'Open a workspace first'
    },
    {
      label: 'Install providers',
      done: connections.length > 0,
      href: workspace ? '/connections?workspace=' + workspace.id : '/connections',
      detail: connections.length > 0 ? String(connections.length) + ' connection record(s)' : 'Connect Google, Slack, or Notion'
    },
    {
      label: 'Load context and prompts',
      done: (overview?.assets ?? 0) > 0 || (overview?.prompts ?? 0) > 0 || (overview?.skills ?? 0) > 0,
      href: workspace ? '/context?workspace=' + workspace.id : '/context',
      detail: workspace
        ? String(overview?.assets ?? 0) + ' assets • ' + String(overview?.prompts ?? 0) + ' prompts • ' + String(overview?.skills ?? 0) + ' skills'
        : 'Choose a workspace to manage context'
    },
    {
      label: 'Register an MCP client',
      done: clients.length > 0,
      href: workspace ? '/mcp-clients?workspace=' + workspace.id : '/mcp-clients',
      detail: clients.length > 0 ? String(clients.length) + ' client(s) registered' : 'Create a client for OAuth + PKCE'
    },
    {
      label: 'Finish MCP connection setup',
      done: clients.length > 0 && connections.length > 0,
      href: workspace ? '/mcp-setup?workspace=' + workspace.id : '/mcp-setup',
      detail: workspace ? 'Use ' + workspace.name + ' for MCP consent and discovery' : 'Select a workspace before connecting a client'
    }
  ];

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4 space-y-0">
          <div className="space-y-3">
            <CardTitle className="text-2xl">Launch sequence</CardTitle>
            <CardDescription>
              The onboarding surface now reflects the actual state of your selected workspace instead of a
              static checklist.
            </CardDescription>
          </div>
          <Badge tone={workspace ? 'moss' : 'brass'}>{workspaceLabel}</Badge>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Workspace checklist</CardTitle>
          <CardDescription>Each step links directly to the operator surface that advances setup.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {checklist.map((step, index) => (
            <div key={step.label} className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-border/70 bg-card/90 p-4 shadow-sm">
              <div className="flex min-w-0 items-start gap-3">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/70 bg-background font-semibold">
                  {index + 1}
                </span>
                <div>
                  <p className="font-semibold text-ink">{step.label}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{step.detail}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={step.done ? 'moss' : 'brass'}>{step.done ? 'ready' : 'pending'}</Badge>
                <Button asChild size="sm" variant="outline">
                  <Link href={step.href}>Open</Link>
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base uppercase tracking-[0.22em] text-muted-foreground">Workspace</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-7 text-muted-foreground">
              `workspaces`, member roles, invites, and join links are the tenancy boundary for every provider and
              MCP grant.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base uppercase tracking-[0.22em] text-muted-foreground">Connections</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-7 text-muted-foreground">
              Provider installs, refresh flows, revocation, and workspace-vs-personal scope all resolve through
              the connection vault.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base uppercase tracking-[0.22em] text-muted-foreground">MCP</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-7 text-muted-foreground">
              Client registration, consent, and the protected `/mcp` endpoint are ready to layer on top of the
              selected workspace.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
