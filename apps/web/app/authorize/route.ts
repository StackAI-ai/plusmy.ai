import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { createAuthorizationCode, getAuthorizedWorkspace, getOAuthClient } from '@plusmy/core';

export const runtime = 'nodejs';

function renderConsentPage(input: {
  clientName: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string | null;
  workspaceId: string;
  workspaceName: string;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
}) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Authorize ${input.clientName}</title>
    <style>
      body{font-family:ui-serif,Georgia,serif;background:#f4efe6;color:#13201d;margin:0;padding:32px}
      .panel{max-width:680px;margin:0 auto;background:rgba(255,255,255,.86);backdrop-filter:blur(12px);border-radius:28px;padding:32px;box-shadow:0 20px 60px rgba(19,32,29,.12)}
      button{border:0;border-radius:999px;padding:14px 18px;font:inherit;font-weight:600;cursor:pointer}
      .primary{background:#13201d;color:#fff}.secondary{background:#fff;color:#13201d;border:1px solid rgba(19,32,29,.12)}
      .muted{color:#55635f;font-size:14px;line-height:1.8}
    </style>
  </head>
  <body>
    <div class="panel">
      <p style="letter-spacing:.2em;text-transform:uppercase;font-size:12px;color:#55635f">plusmy.ai MCP authorization</p>
      <h1 style="font-size:38px;line-height:1.15;margin:14px 0 10px">Authorize ${input.clientName}</h1>
      <p class="muted">This MCP client will receive delegated access to workspace resources and integration tools for <strong>${input.workspaceName}</strong>.</p>
      <p class="muted"><strong>Requested scopes:</strong> ${input.scope || 'mcp:tools mcp:resources'}</p>
      <form method="post" action="/authorize" style="margin-top:24px;display:flex;gap:12px;flex-wrap:wrap">
        <input type="hidden" name="client_id" value="${input.clientId}" />
        <input type="hidden" name="redirect_uri" value="${input.redirectUri}" />
        <input type="hidden" name="scope" value="${input.scope}" />
        <input type="hidden" name="state" value="${input.state ?? ''}" />
        <input type="hidden" name="workspace_id" value="${input.workspaceId}" />
        <input type="hidden" name="code_challenge" value="${input.codeChallenge ?? ''}" />
        <input type="hidden" name="code_challenge_method" value="${input.codeChallengeMethod ?? ''}" />
        <button class="primary" type="submit" name="decision" value="approve">Approve access</button>
        <button class="secondary" type="submit" name="decision" value="deny">Deny</button>
      </form>
    </div>
  </body>
</html>`;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get('client_id');
  const redirectUri = url.searchParams.get('redirect_uri');
  const scope = url.searchParams.get('scope') ?? 'mcp:tools mcp:resources';
  const state = url.searchParams.get('state');
  const codeChallenge = url.searchParams.get('code_challenge');
  const codeChallengeMethod = url.searchParams.get('code_challenge_method');
  const requestedWorkspaceId = url.searchParams.get('workspace_id');

  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: 'invalid_request', error_description: 'Missing client_id or redirect_uri.' }, { status: 400 });
  }

  const client = await getOAuthClient(clientId);
  if (!client || !client.redirect_uris.includes(redirectUri)) {
    return NextResponse.json({ error: 'invalid_client', error_description: 'Unknown client or redirect URI.' }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'login_required', error_description: 'Sign in to approve this MCP client.' }, { status: 401 });
  }

  const workspace = await getAuthorizedWorkspace(user.id, requestedWorkspaceId);
  if (!workspace) {
    return NextResponse.json({ error: 'access_denied', error_description: 'You do not belong to any authorized workspace.' }, { status: 403 });
  }

  return new NextResponse(
    renderConsentPage({
      clientName: client.client_name,
      clientId,
      redirectUri,
      scope,
      state,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      codeChallenge,
      codeChallengeMethod
    }),
    { headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const decision = String(form.get('decision') ?? 'deny');
  const clientId = String(form.get('client_id') ?? '');
  const redirectUri = String(form.get('redirect_uri') ?? '');
  const scope = String(form.get('scope') ?? 'mcp:tools mcp:resources');
  const state = String(form.get('state') ?? '');
  const workspaceId = String(form.get('workspace_id') ?? '');
  const codeChallenge = String(form.get('code_challenge') ?? '');
  const codeChallengeMethod = String(form.get('code_challenge_method') ?? 'S256');

  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }

  const redirect = new URL(redirectUri);
  if (decision !== 'approve') {
    redirect.searchParams.set('error', 'access_denied');
    if (state) redirect.searchParams.set('state', state);
    return NextResponse.redirect(redirect);
  }

  const workspace = await getAuthorizedWorkspace(user.id, workspaceId);
  if (!workspace) {
    return NextResponse.json({ error: 'access_denied' }, { status: 403 });
  }

  const code = await createAuthorizationCode({
    clientId,
    userId: user.id,
    workspaceId: workspace.id,
    redirectUri,
    scope: scope.split(' ').filter(Boolean),
    codeChallenge: codeChallenge || null,
    codeChallengeMethod: codeChallengeMethod || null
  });

  redirect.searchParams.set('code', code);
  if (state) redirect.searchParams.set('state', state);
  return NextResponse.redirect(redirect);
}
