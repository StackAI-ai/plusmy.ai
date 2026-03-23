import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { getAuthorizedWorkspace, listUserWorkspaces, signProviderState } from '@plusmy/core';
import { getIntegration } from '@plusmy/integrations';

export const runtime = 'nodejs';

function canManageWorkspace(role: string | undefined) {
  return role === 'owner' || role === 'admin';
}

type ProviderConfigSpec = {
  providerKey: 'instanceUrl' | 'tenantUrl';
  queryParamNames: string[];
  inputLabel: string;
  queryNameHint: string;
  requireHttps?: boolean;
  messageBase: string;
};

const instanceConfigSpecs: Record<string, ProviderConfigSpec> = {
  servicenow: {
    providerKey: 'instanceUrl',
    queryParamNames: ['instance_url', 'instanceUrl'],
    inputLabel: 'ServiceNow instance URL',
    queryNameHint: 'instance_url',
    requireHttps: true,
    messageBase: 'ServiceNow'
  },
  okta: {
    providerKey: 'tenantUrl',
    queryParamNames: ['tenant_url', 'tenantUrl'],
    inputLabel: 'Okta tenant URL',
    queryNameHint: 'tenant_url',
    requireHttps: true,
    messageBase: 'Okta'
  },
  zendesk: {
    providerKey: 'instanceUrl',
    queryParamNames: ['instance_url', 'instanceUrl', 'zendesk_url', 'zendeskUrl'],
    inputLabel: 'Zendesk instance URL',
    queryNameHint: 'instance_url',
    requireHttps: true,
    messageBase: 'Zendesk'
  }
};

function normalizeInstanceUrl(candidate: string | null) {
  if (!candidate) return '';
  try {
    const normalized = new URL(candidate.trim());
    return normalized.origin.replace(/\/$/, '');
  } catch {
    return '';
  }
}

function buildProviderConfig(provider: string, searchParams: URLSearchParams) {
  const spec = instanceConfigSpecs[provider];
  if (!spec) return undefined;

  const rawValue = spec.queryParamNames.map((name) => searchParams.get(name)).find((value) => Boolean(value));
  if (!rawValue) return null;

  const normalized = normalizeInstanceUrl(rawValue);
  if (!normalized) {
    return { error: `Invalid ${spec.inputLabel}: use a valid URL with https scheme.` };
  }

  if (spec.requireHttps && normalized.startsWith('http://')) {
    return { error: `${spec.inputLabel} must be https.` };
  }

  return {
    [spec.providerKey]: normalized
  };
}

function buildMissingConfigError(provider: string) {
  const spec = instanceConfigSpecs[provider];
  if (!spec) return null;
  return {
    provider,
    error: 'missing_provider_config',
    message: `${spec.messageBase} connect requires query param ${spec.queryNameHint}=<https://...>.`
  };
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

  const providerConfig = buildProviderConfig(provider, url.searchParams);
  if (providerConfig && 'error' in providerConfig) {
    return NextResponse.json(
      {
        provider,
        error: 'invalid_provider_config',
        message: providerConfig.error
      },
      { status: 400 }
    );
  }

  const missingConfigError = providerConfig == null ? buildMissingConfigError(provider) : null;
  if (missingConfigError && instanceConfigSpecs[provider]) {
    return NextResponse.json(missingConfigError, { status: 400 });
  }

  const redirectUri = `${url.origin}/api/integrations/${provider}/callback`;
  const state = await signProviderState({
    provider,
    userId: user.id,
    workspaceId: workspace.id,
    connectionScope,
    redirectTo: url.searchParams.get('redirect_to') ?? '/connections',
    providerConfig:
      providerConfig && !('error' in providerConfig) ? (providerConfig as Record<string, string> | undefined) : undefined
  });

  return NextResponse.redirect(
    integration.buildAuthorizationUrl({
      redirectUri,
      state,
      scopes: integration.oauth.defaultScopes.slice()
    })
  );
}
