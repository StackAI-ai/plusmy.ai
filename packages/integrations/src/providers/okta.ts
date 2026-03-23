import { getServerEnv } from '@plusmy/config';
import type {
  ConnectionRecord,
  Json,
  McpResourceDefinition,
  McpToolDefinition,
  ProviderHealthSnapshot,
  ProviderTokenSet
} from '@plusmy/contracts';
import type {
  AuthorizationCodeInput,
  AuthorizationUrlInput,
  IntegrationDefinition,
  ProviderCallContext,
  ResolvedProviderAccount,
  SyncJobHandlerInput
} from '../types';
import { getMissingScopes } from '../scope-drift';

const oauth = {
  authorizationUrl: '/oauth2/v1/authorize',
  tokenUrl: '/oauth2/v1/token',
  defaultScopes: ['okta.users.read', 'okta.groups.read', 'openid', 'profile']
};

function getCredentials() {
  const env = getServerEnv();
  if (!env.OKTA_CLIENT_ID || !env.OKTA_CLIENT_SECRET) {
    throw new Error('Okta OAuth credentials are missing.');
  }
  return { clientId: env.OKTA_CLIENT_ID, clientSecret: env.OKTA_CLIENT_SECRET };
}

function getTenantUrl(providerConfig: Record<string, string> | undefined, metadata?: Record<string, Json> | null) {
  const raw = providerConfig?.tenantUrl ?? String(metadata?.tenantUrl ?? '');
  if (!raw) {
    throw new Error('Okta tenant URL is required.');
  }
  return new URL(raw).origin.replace(/\/$/, '');
}

function parseScopes(value: unknown, fallback: string[]) {
  if (typeof value !== 'string' || value.length === 0) {
    return fallback;
  }
  return value
    .split(/[ ,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function getRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

async function exchangeAuthorizationCode(
  code: string,
  redirectUri: string,
  providerConfig?: Record<string, string>
) {
  const { clientId, clientSecret } = getCredentials();
  const tenantUrl = getTenantUrl(providerConfig);
  const response = await fetch(`${tenantUrl}/oauth2/v1/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret
    })
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(data.error_description ?? data.error ?? 'Okta token exchange failed.'));
  }

  const expiresIn = Number(data.expires_in ?? 3600);
  return {
    accessToken: String(data.access_token ?? ''),
    refreshToken: data.refresh_token ? String(data.refresh_token) : null,
    tokenType: String(data.token_type ?? 'Bearer'),
    expiresAt: Number.isFinite(expiresIn) ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    scopes: parseScopes(data.scope, oauth.defaultScopes),
    raw: data as Json
  } satisfies ProviderTokenSet;
}

async function refreshTokens(refreshToken: string, metadata?: Record<string, Json> | null) {
  const { clientId, clientSecret } = getCredentials();
  const tenantUrl = getTenantUrl(undefined, metadata);
  const response = await fetch(`${tenantUrl}/oauth2/v1/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret
    })
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(data.error_description ?? data.error ?? 'Okta token refresh failed.'));
  }

  const expiresIn = Number(data.expires_in ?? 3600);
  return {
    accessToken: String(data.access_token ?? ''),
    refreshToken: data.refresh_token ? String(data.refresh_token) : refreshToken,
    tokenType: String(data.token_type ?? 'Bearer'),
    expiresAt: Number.isFinite(expiresIn) ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    scopes: parseScopes(data.scope, oauth.defaultScopes),
    raw: data as Json
  };
}

async function resolveAccount(accessToken: string, tenantUrl: string): Promise<ResolvedProviderAccount> {
  const userResponse = await fetch(`${tenantUrl}/api/v1/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const userData = (await userResponse.json()) as Record<string, unknown>;
  if (!userResponse.ok) {
    throw new Error(String((userData.errorSummary ?? userData.error) ?? 'Failed to resolve Okta account.'));
  }

  const profile = getRecord(userData.profile);
  const displayName = typeof profile?.displayName === 'string'
    ? profile.displayName
    : typeof profile?.login === 'string'
      ? profile.login
      : 'Okta tenant user';
  const email = typeof profile?.email === 'string' && profile.email.length > 0 ? profile.email : null;

  return {
    externalAccountId: String((userData as Record<string, unknown>).id ?? 'okta-user'),
    displayName,
    externalAccountEmail: email,
    metadata: { ...(userData as Record<string, unknown>), tenantUrl }
  };
}

async function syncConnection({ credentials, connection }: SyncJobHandlerInput) {
  const accessToken = credentials.accessToken;
  if (!accessToken) throw new Error('Missing Okta access token.');

  const tenantUrl = getTenantUrl(undefined, connection.metadata as Record<string, Json> | null | undefined);
  const account = await resolveAccount(accessToken, tenantUrl);
  return {
    displayName: account.displayName,
    externalAccountId: account.externalAccountId,
    externalAccountEmail: account.externalAccountEmail ?? null,
    metadata: account.metadata as Record<string, Json>
  };
}

const tools: McpToolDefinition[] = [
  {
    name: 'okta.lookup_user',
    title: 'Lookup Okta user',
    description: 'Find users by search query and email.',
    requiredProviderScopes: ['okta.users.read'],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', default: 25 }
      },
      required: ['query']
    }
  },
  {
    name: 'okta.list_groups',
    title: 'List Okta groups',
    description: 'List groups in an Okta tenant for access-review workflows.',
    requiredProviderScopes: ['okta.groups.read'],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', default: 50 }
      }
    }
  }
];

const liveScopes = ['okta.users.read', 'okta.groups.read', 'openid', 'profile'];

function buildHealthSnapshot(connection: ConnectionRecord): ProviderHealthSnapshot {
  if (connection.status === 'revoked') {
    return {
      provider: 'okta',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'revoked',
      summary: 'This Okta connection was revoked.',
      signals: [connection.reauth_required_reason ?? 'Reconnect Okta before identity tools run again.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  if (connection.status === 'reauth_required') {
    return {
      provider: 'okta',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'reauth_required',
      summary: 'Okta requires reauthorization.',
      signals: [connection.reauth_required_reason ?? 'Okta flagged this install for reauthorization.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  const missingScopes = getMissingScopes(liveScopes, connection.granted_scopes);
  if (missingScopes.length > 0) {
    return {
      provider: 'okta',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'attention',
      summary: 'Okta is missing scopes for one or more identity tools.',
      signals: [`Missing scopes: ${missingScopes.join(', ')}`, 'Reconnect Okta to restore user and group workflows.'],
      requiredScopes: liveScopes,
      missingScopes,
      lastValidatedAt: connection.last_validated_at
    };
  }

  return {
    provider: 'okta',
    connectionId: connection.id,
    displayName: connection.display_name,
    status: 'healthy',
    summary: 'Okta identity access is healthy.',
    signals: ['OAuth grant active', 'Tenant metadata present'],
    requiredScopes: liveScopes,
    missingScopes: [],
    lastValidatedAt: connection.last_validated_at
  };
}

export const oktaIntegration: IntegrationDefinition = {
  id: 'okta',
  displayName: 'Okta',
  oauth,
  buildAuthorizationUrl({ redirectUri, state, scopes, providerConfig }) {
    if (!providerConfig?.tenantUrl) {
      throw new Error('Okta tenant URL is required.');
    }
    const tenantUrl = new URL(providerConfig.tenantUrl).origin.replace(/\/$/, '');
    const { clientId } = getCredentials();
    const url = new URL(`${tenantUrl}/oauth2/v1/authorize`);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', scopes.join(' '));
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return url.toString();
  },
  exchangeAuthorizationCode({ code, redirectUri, providerConfig }) {
    return exchangeAuthorizationCode(code, redirectUri, providerConfig);
  },
  async refreshTokens({ refreshToken, metadata }) {
    return refreshTokens(refreshToken, metadata as Record<string, Json> | null | undefined);
  },
  async resolveAccount(tokenSet: ProviderTokenSet) {
    const raw = (tokenSet.raw as Record<string, unknown>) ?? {};
    const tenantUrl = getTenantUrl(undefined, { tenantUrl: String(raw.tenant_url ?? raw.tenantUrl ?? '') } as Record<string, Json> | null);
    const accessToken = tokenSet.accessToken ?? '';
    if (!accessToken) throw new Error('Missing Okta access token.');
    return resolveAccount(accessToken, tenantUrl);
  },
  listTools(_connection: ConnectionRecord) {
    return tools;
  },
  listResources(_connection: ConnectionRecord): McpResourceDefinition[] {
    return [];
  },
  health(connection: ConnectionRecord) {
    return buildHealthSnapshot(connection);
  },
  syncJobs: [{ jobType: 'sync_connection', run: syncConnection }],
  async callTool(toolName: string, input: Record<string, unknown>, context: ProviderCallContext) {
    const accessToken = context.credentials.accessToken;
    if (!accessToken) throw new Error('Missing Okta access token.');

    const tenantUrl = getTenantUrl(undefined, context.connection.metadata as Record<string, Json> | null | undefined);
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json'
    };

    if (toolName === 'okta.lookup_user') {
      const query = String(input.query ?? '').trim();
      const limit = Number(input.limit ?? 25);
      const queryString = new URLSearchParams({
        search: query,
        limit: Number.isFinite(limit) ? String(limit) : '25'
      });
      const response = await fetch(`${tenantUrl}/api/v1/users?${queryString.toString()}`, { headers });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(String((data as Record<string, string>).errorSummary ?? 'Okta user lookup failed.'));
      }
      return data;
    }

    if (toolName === 'okta.list_groups') {
      const query = String(input.query ?? '').trim();
      const searchParams = new URLSearchParams({
        limit: String(Number.isFinite(Number(input.limit ?? 50)) ? Number(input.limit ?? 50) : 50)
      });
      if (query) searchParams.set('search', query);

      const response = await fetch(`${tenantUrl}/api/v1/groups?${searchParams.toString()}`, { headers });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(String((data as Record<string, string>).errorSummary ?? 'Okta group list failed.'));
      }
      return data;
    }

    throw new Error(`Unknown Okta tool: ${toolName}`);
  }
};
