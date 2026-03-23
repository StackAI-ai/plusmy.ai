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
  authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  defaultScopes: ['offline_access', 'Files.Read.All', 'Sites.Read.All', 'User.Read']
};

function getCredentials() {
  const env = getServerEnv();
  if (!env.MICROSOFT365_CLIENT_ID || !env.MICROSOFT365_CLIENT_SECRET) {
    throw new Error('Microsoft 365 OAuth credentials are missing.');
  }
  return { clientId: env.MICROSOFT365_CLIENT_ID, clientSecret: env.MICROSOFT365_CLIENT_SECRET };
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

function getMicrosoftErrorMessage(data: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }

  const error = (data as Record<string, unknown>).error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) {
    return null;
  }

  const message = (error as Record<string, unknown>).message;
  return typeof message === 'string' && message.length > 0 ? message : null;
}

const graphHeaders = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
  Accept: 'application/json',
  'Content-Type': 'application/json'
});

async function exchange(code: string, redirectUri: string) {
  const { clientId, clientSecret } = getCredentials();
  const response = await fetch(oauth.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code
    })
  });

  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(data.error_description ?? data.error ?? 'Microsoft 365 token exchange failed.'));
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

async function refreshTokens(refreshToken: string) {
  const { clientId, clientSecret } = getCredentials();
  const response = await fetch(oauth.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: oauth.defaultScopes.join(' ')
    })
  });

  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(data.error_description ?? data.error ?? 'Microsoft 365 token refresh failed.'));
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

async function resolveAccount(accessToken: string): Promise<ResolvedProviderAccount> {
  const response = await fetch('https://graph.microsoft.com/v1.0/me', { headers: graphHeaders(accessToken) });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(getMicrosoftErrorMessage(data) ?? 'Microsoft 365 account resolve failed.');
  }

  return {
    externalAccountId: String(data.id ?? 'microsoft-365-user'),
    displayName: String(data.displayName ?? 'Microsoft 365 user'),
    externalAccountEmail: typeof data.mail === 'string' ? data.mail : null,
    metadata: data
  };
}

async function syncConnection({ credentials }: SyncJobHandlerInput) {
  const accessToken = credentials.accessToken;
  if (!accessToken) throw new Error('Missing Microsoft 365 access token.');

  const account = await resolveAccount(accessToken);
  return {
    displayName: account.displayName,
    externalAccountId: account.externalAccountId,
    externalAccountEmail: account.externalAccountEmail ?? null,
    metadata: account.metadata as Record<string, Json>
  };
}

const tools: McpToolDefinition[] = [
  {
    name: 'microsoft365.search_onedrive',
    title: 'Search OneDrive',
    description: 'Search OneDrive files using Microsoft Graph.',
    requiredProviderScopes: ['Files.Read.All'],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', default: 10 }
      },
      required: ['query']
    }
  },
  {
    name: 'microsoft365.read_sharepoint_document',
    title: 'Read SharePoint document',
    description: 'Read a SharePoint document by siteId and itemId.',
    requiredProviderScopes: ['Sites.Read.All'],
    inputSchema: {
      type: 'object',
      properties: {
        siteId: { type: 'string' },
        itemId: { type: 'string' }
      },
      required: ['siteId', 'itemId']
    }
  }
];

const liveScopes = ['Files.Read.All', 'Sites.Read.All', 'User.Read'];

function buildHealthSnapshot(connection: ConnectionRecord): ProviderHealthSnapshot {
  if (connection.status === 'revoked') {
    return {
      provider: 'microsoft365',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'revoked',
      summary: 'Microsoft 365 access was revoked.',
      signals: [connection.reauth_required_reason ?? 'Reconnect Microsoft 365 before OneDrive and SharePoint workflows run again.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  if (connection.status === 'reauth_required') {
    return {
      provider: 'microsoft365',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'reauth_required',
      summary: 'Microsoft 365 needs reauthorization.',
      signals: [connection.reauth_required_reason ?? 'Microsoft 365 flagged this install for reauthorization.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  const missingScopes = getMissingScopes(liveScopes, connection.granted_scopes);
  if (missingScopes.length > 0) {
    return {
      provider: 'microsoft365',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'attention',
      summary: 'Microsoft 365 is missing one or more required scopes.',
      signals: [`Missing scopes: ${missingScopes.join(', ')}`, 'Reconnect to restore document search/read workflows.'],
      requiredScopes: liveScopes,
      missingScopes,
      lastValidatedAt: connection.last_validated_at
    };
  }

  return {
    provider: 'microsoft365',
    connectionId: connection.id,
    displayName: connection.display_name,
    status: 'healthy',
    summary: 'Microsoft 365 document workflows are healthy.',
    signals: ['OAuth grant active', 'Graph API access present'],
    requiredScopes: liveScopes,
    missingScopes: [],
    lastValidatedAt: connection.last_validated_at
  };
}

export const microsoft365Integration: IntegrationDefinition = {
  id: 'microsoft365',
  displayName: 'Microsoft 365',
  oauth,
  buildAuthorizationUrl({ redirectUri, state, scopes }: AuthorizationUrlInput) {
    const { clientId } = getCredentials();
    const url = new URL(oauth.authorizationUrl);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', scopes.join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('response_mode', 'query');
    return url.toString();
  },
  exchangeAuthorizationCode({ code, redirectUri }: AuthorizationCodeInput) {
    return exchange(code, redirectUri);
  },
  refreshTokens({ refreshToken }) {
    return refreshTokens(refreshToken);
  },
  resolveAccount(tokenSet: ProviderTokenSet) {
    return resolveAccount(tokenSet.accessToken ?? '');
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
    if (!accessToken) throw new Error('Missing Microsoft 365 access token.');

    if (toolName === 'microsoft365.search_onedrive') {
      const query = String(input.query ?? '').trim();
      const limit = Number(input.limit ?? 10);
      const response = await fetch(
        `https://graph.microsoft.com/v1.0/me/drive/root/search(q='${query}')?$top=${Number.isFinite(limit) ? limit : 10}`,
        { headers: graphHeaders(accessToken) }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(getMicrosoftErrorMessage(data) ?? 'Microsoft 365 search failed.');
      }
      return data;
    }

    if (toolName === 'microsoft365.read_sharepoint_document') {
      const siteId = String(input.siteId ?? '').trim();
      const itemId = String(input.itemId ?? '').trim();
      if (!siteId || !itemId) {
        throw new Error('siteId and itemId are required for SharePoint document reads.');
      }
      const response = await fetch(`https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(siteId)}/drive/items/${encodeURIComponent(itemId)}`, {
        headers: graphHeaders(accessToken)
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(getMicrosoftErrorMessage(data) ?? 'Microsoft 365 document read failed.');
      }
      return data;
    }

    throw new Error(`Unknown Microsoft 365 tool: ${toolName}`);
  }
};
