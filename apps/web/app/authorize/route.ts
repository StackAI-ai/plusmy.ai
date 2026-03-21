import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@plusmy/supabase';
import {
  createAuthorizationCode,
  getAuthorizedWorkspace,
  getOAuthClient,
  getOAuthClientApproval,
  logAuditEvent,
  upsertOAuthClientApproval
} from '@plusmy/core';

export const runtime = 'nodejs';

const defaultScopeString = 'mcp:tools mcp:resources';

function parseRequestedScopes(scope: string, client: Record<string, unknown>) {
  const requestedScopes = scope.split(' ').filter(Boolean);
  const allowedScopes = Array.isArray(client.scopes) ? client.scopes.map(String) : defaultScopeString.split(' ');

  if (requestedScopes.length === 0) {
    return allowedScopes;
  }

  const hasInvalidScope = requestedScopes.some((value) => !allowedScopes.includes(value));
  return hasInvalidScope ? null : requestedScopes;
}

function getClientRedirectUris(client: Record<string, unknown>) {
  return Array.isArray(client.redirect_uris) ? client.redirect_uris.map(String) : [];
}

function getClientName(client: Record<string, unknown>) {
  return typeof client.client_name === 'string' ? client.client_name : 'Unknown MCP client';
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return null;

  return (
    new Date(value).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC'
    }) + ' UTC'
  );
}

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
  source: string | null;
  existingApproval?: {
    approvedAt: string;
    lastUsedAt: string | null;
    scopes: string;
  } | null;
}) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Authorize ${input.clientName}</title>
    <style>
      :root{color-scheme:light}
      *{box-sizing:border-box}
      body{
        margin:0;
        min-height:100vh;
        padding:24px;
        font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
        color:#11221d;
        background:
          radial-gradient(circle at top, rgba(244,114,47,.2), transparent 34%),
          radial-gradient(circle at 15% 20%, rgba(63,126,97,.14), transparent 28%),
          linear-gradient(180deg, #fbf8f3 0%, #f4ecde 100%);
      }
      .panel{
        max-width:720px;
        margin:0 auto;
        border:1px solid rgba(191,181,162,.55);
        border-radius:32px;
        padding:32px;
        background:rgba(255,255,255,.82);
        backdrop-filter:blur(24px);
        box-shadow:0 28px 90px -42px rgba(15,23,42,.45);
      }
      .eyebrow{
        display:inline-flex;
        align-items:center;
        gap:8px;
        margin:0;
        padding:8px 12px;
        border:1px solid rgba(191,181,162,.7);
        border-radius:999px;
        background:rgba(255,255,255,.7);
        color:#4e5f58;
        font-size:11px;
        font-weight:700;
        letter-spacing:.24em;
        text-transform:uppercase;
      }
      .muted{color:#56655f;font-size:14px;line-height:1.8}
      .panel-card{
        margin-top:18px;
        border:1px solid rgba(191,181,162,.55);
        border-radius:22px;
        padding:16px;
        background:rgba(255,255,255,.55);
      }
      .operator-card{background:rgba(244,114,47,.08)}
      .actions{margin-top:28px;display:flex;gap:12px;flex-wrap:wrap}
      button{
        border:0;
        border-radius:14px;
        padding:14px 18px;
        font:inherit;
        font-weight:600;
        cursor:pointer;
        transition:transform .18s ease, background-color .18s ease;
      }
      button:hover{transform:translateY(-1px)}
      .primary{background:#18362d;color:#fff;box-shadow:0 16px 40px -24px rgba(24,54,45,.7)}
      .secondary{background:rgba(255,255,255,.82);color:#11221d;border:1px solid rgba(191,181,162,.8)}
    </style>
  </head>
  <body>
    <div class="panel">
      <p class="eyebrow">plusmy.ai MCP authorization</p>
      <h1 style="font-size:38px;line-height:1.15;margin:18px 0 10px">Authorize ${input.clientName}</h1>
      <p class="muted">This MCP client will receive delegated access to workspace resources and integration tools for <strong>${input.workspaceName}</strong>.</p>
      <p class="muted"><strong>Requested scopes:</strong> ${input.scope || defaultScopeString}</p>
      ${
        input.existingApproval
          ? `<div class="panel-card">
        <p style="margin:0;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#55635f">Existing approval on file</p>
        <p class="muted" style="margin:8px 0 0">Approved ${input.existingApproval.approvedAt}. ${
          input.existingApproval.lastUsedAt ? `Last token issued ${input.existingApproval.lastUsedAt}.` : 'No token has been exchanged from that approval yet.'
        }</p>
        <p class="muted" style="margin:8px 0 0"><strong>Previously approved scopes:</strong> ${input.existingApproval.scopes}</p>
      </div>`
          : ''
      }
      ${
        input.source === 'operator_ui'
          ? `<div class="panel-card operator-card">
        <p style="margin:0;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#55635f">Operator-initiated renewal</p>
        <p class="muted" style="margin:8px 0 0">This consent flow was opened from the MCP clients operator page. After approval, the client still needs to exchange the new authorization code before token activity appears as fresh usage.</p>
      </div>`
          : ''
      }
      <form method="post" action="/authorize" class="actions">
        <input type="hidden" name="client_id" value="${input.clientId}" />
        <input type="hidden" name="redirect_uri" value="${input.redirectUri}" />
        <input type="hidden" name="scope" value="${input.scope}" />
        <input type="hidden" name="state" value="${input.state ?? ''}" />
        <input type="hidden" name="workspace_id" value="${input.workspaceId}" />
        <input type="hidden" name="code_challenge" value="${input.codeChallenge ?? ''}" />
        <input type="hidden" name="code_challenge_method" value="${input.codeChallengeMethod ?? ''}" />
        <input type="hidden" name="source" value="${input.source ?? ''}" />
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
  const source = url.searchParams.get('source');

  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: 'invalid_request', error_description: 'Missing client_id or redirect_uri.' }, { status: 400 });
  }

  const client = await getOAuthClient(clientId);
  const redirectUris = client ? getClientRedirectUris(client) : [];
  if (!client || !redirectUris.includes(redirectUri)) {
    return NextResponse.json({ error: 'invalid_client', error_description: 'Unknown client or redirect URI.' }, { status: 400 });
  }
  const requestedScopes = parseRequestedScopes(scope, client);
  if (requestedScopes == null) {
    return NextResponse.json({ error: 'invalid_scope', error_description: 'Requested scope is not allowed for this client.' }, { status: 400 });
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

  const existingApproval = await getOAuthClientApproval({
    clientId,
    workspaceId: workspace.id,
    userId: user.id
  });

  return new NextResponse(
    renderConsentPage({
      clientName: getClientName(client),
      clientId,
      redirectUri,
      scope: requestedScopes.join(' '),
      state,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      codeChallenge,
      codeChallengeMethod,
      source,
      existingApproval: existingApproval && existingApproval.status === 'active'
        ? {
            approvedAt: formatTimestamp(existingApproval.approved_at) ?? existingApproval.approved_at,
            lastUsedAt: formatTimestamp(existingApproval.last_used_at),
            scopes: existingApproval.scopes.join(' ')
          }
        : null
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
  const source = String(form.get('source') ?? '');

  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }

  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const client = await getOAuthClient(clientId);
  const redirectUris = client ? getClientRedirectUris(client) : [];
  if (!client || !redirectUris.includes(redirectUri)) {
    return NextResponse.json({ error: 'invalid_client' }, { status: 400 });
  }

  const requestedScopes = parseRequestedScopes(scope, client);
  if (requestedScopes == null) {
    return NextResponse.json({ error: 'invalid_scope' }, { status: 400 });
  }

  const workspace = await getAuthorizedWorkspace(user.id, workspaceId);
  if (!workspace) {
    return NextResponse.json({ error: 'access_denied' }, { status: 403 });
  }

  const redirect = new URL(redirectUri);
  if (decision !== 'approve') {
    await logAuditEvent({
      workspaceId: workspace.id,
      actorType: 'user',
      actorUserId: user.id,
      action: 'oauth_client.denied',
      resourceType: 'oauth_client',
      resourceId: clientId,
      metadata: {
        redirect_uri: redirectUri,
        scopes: requestedScopes,
        source: source || null
      }
    });

    redirect.searchParams.set('error', 'access_denied');
    if (state) redirect.searchParams.set('state', state);
    return NextResponse.redirect(redirect);
  }

  await upsertOAuthClientApproval({
    clientId,
    workspaceId: workspace.id,
    userId: user.id,
    scopes: requestedScopes,
    metadata: {
      redirect_uri: redirectUri,
      source: source || null
    }
  });

  const code = await createAuthorizationCode({
    clientId,
    userId: user.id,
    workspaceId: workspace.id,
    redirectUri,
    scope: requestedScopes,
    codeChallenge: codeChallenge || null,
    codeChallengeMethod: codeChallengeMethod || null
  });

  redirect.searchParams.set('code', code);
  if (state) redirect.searchParams.set('state', state);
  return NextResponse.redirect(redirect);
}
