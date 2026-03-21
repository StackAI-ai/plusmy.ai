import { Badge, Card } from '@plusmy/ui';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { getAuthorizedWorkspace, listUserWorkspaces } from '@plusmy/core';
import { getSearchParam, type AppSearchParams } from '../_lib/search-params';

const exampleClient = {
  name: 'Cursor',
  redirectUri: 'http://localhost:3000/callback'
};

export default async function McpSetupPage({ searchParams }: { searchParams?: AppSearchParams }) {
  const baseUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const requestedWorkspaceId = await getSearchParam(searchParams, 'workspace');
  const workspaces = user ? await listUserWorkspaces(user.id) : [];
  const workspace = user ? await getAuthorizedWorkspace(user.id, requestedWorkspaceId) : null;
  const exampleAuthorizeUrl = `${baseUrl}/authorize?response_type=code&client_id=YOUR_CLIENT_ID&redirect_uri=${encodeURIComponent(exampleClient.redirectUri)}&scope=mcp%3Atools%20mcp%3Aresources${workspace ? `&workspace_id=${workspace.id}` : ''}&code_challenge=REPLACE_WITH_PKCE_CHALLENGE&code_challenge_method=S256`;

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">MCP setup</h1>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              plusmy.ai exposes a standard OAuth authorization server and a protected MCP resource endpoint. Register a client, then point your MCP-capable tool at the metadata URLs below.
            </p>
          </div>
          <Badge tone={workspace ? 'moss' : 'brass'}>{workspace ? workspace.name : `${workspaces.length} workspaces available`}</Badge>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Metadata</p>
          <div className="mt-4 space-y-3 text-sm text-muted-foreground">
            <p>Authorization server: {baseUrl}/.well-known/oauth-authorization-server</p>
            <p>Protected resource: {baseUrl}/.well-known/oauth-protected-resource</p>
            <p>MCP endpoint: {baseUrl}/mcp</p>
          </div>
        </Card>
        <Card>
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Example client</p>
          <div className="mt-4 space-y-3 text-sm text-muted-foreground">
            <p>Name: {exampleClient.name}</p>
            <p>Redirect URI: {exampleClient.redirectUri}</p>
            <p>Scopes: mcp:tools mcp:resources</p>
            <p>Workspace target: {workspace ? workspace.name : 'optional, chosen at consent time'}</p>
          </div>
        </Card>
      </div>

      <Card>
        <ol className="space-y-3 text-sm leading-7 text-muted-foreground">
          <li>1. Register your MCP client on the MCP clients page.</li>
          <li>2. Start the client’s OAuth connection flow.</li>
          <li>3. Approve access in plusmy.ai using your workspace session.</li>
          <li>4. The client stores the returned tokens and calls `{baseUrl}/mcp` with bearer auth.</li>
          <li>5. plusmy.ai resolves tools and resources from your workspace and connected providers.</li>
        </ol>
        <div className="mt-6 rounded-2xl border border-border/70 bg-secondary/70 p-4">
          <p className="text-sm font-semibold text-ink">Authorize URL template</p>
          <p className="mt-2 break-all text-xs leading-6 text-muted-foreground">{exampleAuthorizeUrl}</p>
        </div>
      </Card>
    </div>
  );
}
