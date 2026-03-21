import Link from 'next/link';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@plusmy/ui';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { getAuthorizedWorkspace, listUserWorkspaces } from '@plusmy/core';
import { getSearchParam, type AppSearchParams } from '../../_lib/search-params';
import { getAppOrigin } from '../../_lib/origin';
import { CopyButton } from '../../_components/copy-button';

type QuickstartItem = {
  title: string;
  detail: string;
};

export default async function McpQuickstartPage({ searchParams }: { searchParams?: AppSearchParams }) {
  const baseUrl = await getAppOrigin();
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const requestedWorkspaceId = await getSearchParam(searchParams, 'workspace');
  const workspaces = user ? await listUserWorkspaces(user.id) : [];
  const workspace = user ? await getAuthorizedWorkspace(user.id, requestedWorkspaceId) : null;
  const workspaceHref = workspace ? `/mcp-setup?workspace=${workspace.id}` : '/mcp-setup';
  const clientRedirectUri = 'http://localhost:3000/callback';
  const authorizeUrl = `${baseUrl}/authorize?response_type=code&client_id=YOUR_CLIENT_ID&redirect_uri=${encodeURIComponent(clientRedirectUri)}&scope=mcp%3Atools%20mcp%3Aresources${workspace ? `&workspace_id=${workspace.id}` : ''}&code_challenge=REPLACE_WITH_PKCE_CHALLENGE&code_challenge_method=S256`;

  const steps: QuickstartItem[] = [
    {
      title: 'Confirm the active workspace',
      detail: workspace
        ? `Use ${workspace.name} so the MCP grant lands in the right tenancy boundary.`
        : workspaces.length
          ? 'Pick a workspace first so consent and discovery resolve against the right scope.'
          : 'Create a workspace before you register or authorize any MCP client.'
    },
    {
      title: 'Register the client',
      detail: 'Use the MCP clients surface to create the OAuth client record and store its redirect URI.'
    },
    {
      title: 'Authorize with PKCE',
      detail: 'Open the authorize URL, complete consent, and let the client exchange the code for tokens.'
    },
    {
      title: 'Point the client at plusmy.ai',
      detail: 'Use the discovery endpoints and `/mcp` resource URL below when configuring the client.'
    }
  ];

  return (
    <div className="space-y-5">
      <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4 space-y-0">
          <div className="space-y-3">
            <Badge tone={workspace ? 'moss' : 'brass'}>{workspace ? workspace.name : `${workspaces.length} workspaces available`}</Badge>
            <CardTitle className="text-3xl">MCP quickstart</CardTitle>
            <CardDescription>
              A compact operator guide for connecting an MCP-capable client to plusmy.ai. Use this page when you need the canonical URLs, the authorize template, and the exact flow in one place.
            </CardDescription>
            <p className="text-sm leading-6 text-muted-foreground">
              Example callback URI: <span className="font-mono text-xs">{clientRedirectUri}</span>
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href={workspaceHref}>Open setup page</Link>
          </Button>
        </CardHeader>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Setup steps</CardTitle>
            <CardDescription>Keep the workspace query parameter on the URL so the right tenancy stays selected.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {steps.map((step, index) => (
              <div key={step.title} className="rounded-2xl border border-border/70 bg-background/70 p-4">
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-card font-semibold">
                    {index + 1}
                  </span>
                  <div>
                    <p className="font-semibold text-foreground">{step.title}</p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{step.detail}</p>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base uppercase tracking-[0.22em] text-muted-foreground">Discovery URLs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: 'Authorization server', value: `${baseUrl}/.well-known/oauth-authorization-server` },
                { label: 'Protected resource', value: `${baseUrl}/.well-known/oauth-protected-resource` },
                { label: 'MCP endpoint', value: `${baseUrl}/mcp` }
              ].map((item) => (
                <div key={item.label} className="flex flex-col gap-2 rounded-2xl border border-border/70 bg-background/70 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{item.label}</p>
                    <p className="mt-1 break-all font-mono text-xs leading-6 text-muted-foreground">{item.value}</p>
                  </div>
                  <CopyButton value={item.value} label="Copy URL" copiedLabel="Copied" />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base uppercase tracking-[0.22em] text-muted-foreground">Authorize template</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
                <p className="break-all font-mono text-xs leading-6 text-muted-foreground">{authorizeUrl}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <CopyButton value={authorizeUrl} label="Copy template" />
                <CopyButton value="mcp:tools mcp:resources" label="Copy scopes" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What to verify</CardTitle>
          <CardDescription>Use these checks to confirm the client is wired correctly before handing it off.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {[
            'The client redirects back to the registered callback URI.',
            'The consent screen shows the current workspace name, not a default placeholder.',
            'The client stores a token and can call `/mcp` with bearer auth.'
          ].map((item) => (
            <div key={item} className="rounded-2xl border border-border/70 bg-secondary/70 p-4 text-sm leading-6 text-muted-foreground">
              {item}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
