import Link from 'next/link';
import { Card, Badge } from '@plusmy/ui';
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
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Launch sequence</h1>
            <p className="mt-3 text-sm leading-7 text-slate-700">
              The onboarding surface now reflects the actual state of your selected workspace instead of a static checklist.
            </p>
          </div>
          <Badge tone={workspace ? 'moss' : 'brass'}>{workspaceLabel}</Badge>
        </div>
      </Card>

      <Card>
        <div className="space-y-4">
          {checklist.map((step, index) => (
            <div key={step.label} className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-black/5 bg-white/70 p-4">
              <div className="flex min-w-0 items-start gap-3">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-white font-semibold">
                  {index + 1}
                </span>
                <div>
                  <p className="font-semibold text-ink">{step.label}</p>
                  <p className="mt-1 text-sm text-slate-700">{step.detail}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={step.done ? 'moss' : 'brass'}>{step.done ? 'ready' : 'pending'}</Badge>
                <Link href={step.href} className="text-sm font-medium text-ink underline decoration-black/20 underline-offset-4">
                  Open
                </Link>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Workspace</p>
          <p className="mt-4 text-sm leading-7 text-slate-700">
            `workspaces`, member roles, invites, and join links are the tenancy boundary for every provider and MCP grant.
          </p>
        </Card>
        <Card>
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Connections</p>
          <p className="mt-4 text-sm leading-7 text-slate-700">
            Provider installs, refresh flows, revocation, and workspace-vs-personal scope all resolve through the connection vault.
          </p>
        </Card>
        <Card>
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">MCP</p>
          <p className="mt-4 text-sm leading-7 text-slate-700">
            Client registration, consent, and the protected `/mcp` endpoint are ready to layer on top of the selected workspace.
          </p>
        </Card>
      </div>
    </div>
  );
}
