import { Badge, Card } from '@plusmy/ui';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { getAuthorizedWorkspace, listOAuthClients, listUserWorkspaces } from '@plusmy/core';
import { ClientRegistrationForm } from './client-registration-form';
import { getSearchParam, type AppSearchParams } from '../_lib/search-params';

export default async function McpClientsPage({ searchParams }: { searchParams?: AppSearchParams }) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <Card>
        <h1 className="text-2xl font-semibold">MCP clients</h1>
        <p className="mt-3 text-sm leading-7 text-slate-700">
          Sign in first. Dynamic client registration is tied to the current authenticated user.
        </p>
      </Card>
    );
  }

  const clients = await listOAuthClients(user.id);
  const workspaces = await listUserWorkspaces(user.id);
  const requestedWorkspaceId = await getSearchParam(searchParams, 'workspace');
  const workspace = await getAuthorizedWorkspace(user.id, requestedWorkspaceId);
  const baseUrl = process.env.APP_URL ?? 'http://localhost:3000';

  return (
    <div className="space-y-5">
      <div className="grid gap-5 md:grid-cols-[1.2fr_1fr]">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">Registered MCP clients</h1>
              <p className="mt-3 text-sm leading-7 text-slate-700">
                These clients can use the plusmy.ai authorization server and request delegated access to your workspace tools and resources.
              </p>
            </div>
            <Badge tone="moss">{clients.length} clients</Badge>
          </div>
          <div className="mt-6 space-y-3">
            {clients.length === 0 ? (
              <p className="text-sm text-slate-700">No registered clients yet.</p>
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
          </div>
        </Card>
        <ClientRegistrationForm />
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Quickstart</p>
          <Badge tone={workspace ? 'moss' : 'brass'}>{workspace ? workspace.name : `${workspaces.length} workspaces available`}</Badge>
        </div>
        <ol className="mt-4 space-y-3 text-sm leading-7 text-slate-700">
          <li>1. Register a client with a valid redirect URI.</li>
          <li>2. Use `{baseUrl}/.well-known/oauth-authorization-server` for discovery.</li>
          <li>3. Send users through `{baseUrl}/authorize` with PKCE and include `workspace_id` when you want a specific workspace context.</li>
          <li>4. Exchange the code at `{baseUrl}/token` and call `{baseUrl}/mcp` with the bearer token.</li>
        </ol>
      </Card>
    </div>
  );
}
