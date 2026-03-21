import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { getAuthorizedWorkspace, listUserWorkspaces, signProviderState } from '@plusmy/core';
import { getIntegration } from '@plusmy/integrations';

export const runtime = 'nodejs';

function canManageWorkspace(role: string | undefined) {
  return role === 'owner' || role === 'admin';
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const integration = getIntegration(provider);
  if (integration == null) {
    return NextResponse.json({ error: 'unknown_provider' }, { status: 404 });
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user == null) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }

  const url = new URL(request.url);
  const requestedWorkspaceId = url.searchParams.get('workspace_id');
  const connectionScope = url.searchParams.get('scope') === 'personal' ? 'personal' : 'workspace';
  const workspace = await getAuthorizedWorkspace(user.id, requestedWorkspaceId);
  if (workspace == null) {
    return NextResponse.json({ error: 'workspace_required' }, { status: 403 });
  }

  const memberships = await listUserWorkspaces(user.id);
  const membership = memberships.find((entry) => entry.id === workspace.id);
  const needsAdminAccess = connectionScope === 'workspace';
  const hasAdminAccess = canManageWorkspace(membership?.role);
  if (needsAdminAccess && hasAdminAccess === false) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const redirectUri = `${url.origin}/api/integrations/${provider}/callback`;
  const state = await signProviderState({
    provider,
    userId: user.id,
    workspaceId: workspace.id,
    connectionScope,
    redirectTo: url.searchParams.get('redirect_to') ?? '/connections'
  });

  return NextResponse.redirect(
    integration.buildAuthorizationUrl({
      redirectUri,
      state,
      scopes: integration.oauth.defaultScopes.slice()
    })
  );
}
