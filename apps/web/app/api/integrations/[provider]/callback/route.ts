import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedWorkspace, listUserWorkspaces, upsertInstalledConnection, verifyProviderState } from '@plusmy/core';
import { getIntegration } from '@plusmy/integrations';

export const runtime = 'nodejs';

function canManageWorkspace(role: string | undefined) {
  return role === 'owner' || role === 'admin';
}

function buildStatusRedirect(basePath: string, origin: string, provider: string, status: string, message?: string) {
  const redirectUrl = new URL(basePath, origin);
  redirectUrl.searchParams.set('provider', provider);
  redirectUrl.searchParams.set('status', status);
  if (message) redirectUrl.searchParams.set('message', message);
  return redirectUrl;
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

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const redirectUri = `${url.origin}/api/integrations/${provider}/callback`;

  if (code == null || state == null) {
    return NextResponse.json({ error: 'invalid_callback' }, { status: 400 });
  }

  const decodedState = await verifyProviderState(state);
  const stateIsValid = decodedState != null && decodedState.provider === provider;
  if (stateIsValid === false) {
    return NextResponse.json({ error: 'invalid_state' }, { status: 400 });
  }

  const workspace = await getAuthorizedWorkspace(decodedState.userId, decodedState.workspaceId);
  const memberships = await listUserWorkspaces(decodedState.userId);
  const membership = memberships.find((entry) => entry.id === decodedState.workspaceId);
  if (workspace == null) {
    return NextResponse.redirect(buildStatusRedirect(decodedState.redirectTo, url.origin, provider, 'error', 'Workspace access lost'));
  }

  const needsAdminAccess = decodedState.connectionScope === 'workspace';
  const hasAdminAccess = canManageWorkspace(membership?.role);
  if (needsAdminAccess && hasAdminAccess === false) {
    return NextResponse.redirect(buildStatusRedirect(decodedState.redirectTo, url.origin, provider, 'error', 'Admin access required'));
  }

  try {
    const tokenSet = await integration.exchangeAuthorizationCode({ code, redirectUri });
    const account = await integration.resolveAccount(tokenSet);

    await upsertInstalledConnection({
      workspaceId: workspace.id,
      ownerUserId: decodedState.connectionScope === 'personal' ? decodedState.userId : null,
      provider: integration.id,
      scope: decodedState.connectionScope,
      externalAccountId: account.externalAccountId,
      externalAccountEmail: account.externalAccountEmail ?? null,
      displayName: account.displayName ?? integration.displayName,
      grantedScopes: tokenSet.scopes,
      credentials: tokenSet,
      metadata: account.metadata
    });

    return NextResponse.redirect(buildStatusRedirect(decodedState.redirectTo, url.origin, provider, 'connected'));
  } catch (error) {
    return NextResponse.redirect(
      buildStatusRedirect(
        decodedState.redirectTo,
        url.origin,
        provider,
        'error',
        error instanceof Error ? error.message : 'Connection failed'
      )
    );
  }
}
